import { LocktekError, ErrorCode } from '../types/common.js';
import { parseNativeAmount } from '../utils/format.js';
import type { Logger } from '../observability/logger.js';
import type {
  PolicyAuditEntry,
  PolicyCheckInput,
  PolicyDecision,
  TransactionPolicy,
} from './types.js';

const ALLOWED: PolicyDecision = { allowed: true };

const refuse = (rule: string, reason: string): PolicyDecision => ({
  allowed: false,
  rule,
  reason,
});

/**
 * Enforces spend caps and recipient rules before a transaction is signed.
 *
 * `reserve` performs the check and the session-total increment in a single
 * synchronous step. That matters: a check that reads the total, awaits, then writes
 * it lets two concurrent transfers each pass a cap they jointly exceed.
 *
 * Every failure path refuses. A policy that cannot be evaluated is a policy that
 * has not been satisfied.
 */
export class PolicyEngine {
  private readonly policy: TransactionPolicy;
  private readonly logger: Logger | undefined;
  private readonly auditLog: PolicyAuditEntry[] = [];
  private sessionSpendByDecimals = new Map<number, bigint>();

  constructor(policy: TransactionPolicy = {}, logger?: Logger) {
    this.policy = policy;
    this.logger = logger;
    this.assertPolicyParses();
  }

  /** True when no constraint of any kind is configured. */
  get isUnbounded(): boolean {
    return (
      !this.policy.readOnly &&
      this.policy.maxAmountPerTransaction === undefined &&
      this.policy.maxAmountPerSession === undefined &&
      !this.policy.allowedRecipients?.length &&
      !this.policy.deniedRecipients?.length
    );
  }

  /** Evaluate without recording anything. Used by simulation and dry-run paths. */
  check(input: PolicyCheckInput): PolicyDecision {
    try {
      return this.evaluate(input);
    } catch (error: unknown) {
      return refuse(
        'evaluation',
        `Policy could not be evaluated, so the transfer was refused: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /**
   * Evaluate and, if allowed, atomically count the amount against the session cap.
   * Call {@link release} if the transaction is subsequently not broadcast.
   */
  reserve(input: PolicyCheckInput): PolicyDecision {
    const decision = this.check(input);
    this.record(input, decision);

    if (!decision.allowed) {
      this.logger?.warn?.('policy.refused', {
        chain: input.chain,
        to: input.to,
        amount: input.amount,
        rule: decision.rule,
      });
      return decision;
    }

    if (this.policy.maxAmountPerSession !== undefined) {
      const amount = parseNativeAmount(input.amount, input.decimals);
      const current = this.sessionSpendByDecimals.get(input.decimals) ?? 0n;
      this.sessionSpendByDecimals.set(input.decimals, current + amount);
    }

    return decision;
  }

  /** Roll back a reservation whose transaction was never broadcast. */
  release(input: PolicyCheckInput): void {
    if (this.policy.maxAmountPerSession === undefined) return;

    try {
      const amount = parseNativeAmount(input.amount, input.decimals);
      const current = this.sessionSpendByDecimals.get(input.decimals) ?? 0n;
      const next = current - amount;
      this.sessionSpendByDecimals.set(input.decimals, next > 0n ? next : 0n);
    } catch {
      // An unparseable amount was never reserved, so there is nothing to roll back.
    }
  }

  /** Enforce the policy, throwing rather than returning a decision. */
  assert(input: PolicyCheckInput): void {
    const decision = this.reserve(input);
    if (decision.allowed) return;

    throw new LocktekError(
      `Transaction refused by policy (${decision.rule}): ${decision.reason}`,
      ErrorCode.POLICY_VIOLATION,
    );
  }

  /** Immutable copy of every policy evaluation performed by this instance. */
  get audit(): readonly PolicyAuditEntry[] {
    return [...this.auditLog];
  }

  private evaluate(input: PolicyCheckInput): PolicyDecision {
    if (this.policy.readOnly) {
      return refuse('readOnly', 'This Locktek instance is configured read-only.');
    }

    const denied = this.matches(this.policy.deniedRecipients, input.to);
    if (denied) {
      return refuse('deniedRecipients', `Recipient ${input.to} is on the denylist.`);
    }

    if (this.policy.allowedRecipients?.length) {
      if (!this.matches(this.policy.allowedRecipients, input.to)) {
        return refuse(
          'allowedRecipients',
          `Recipient ${input.to} is not on the allowlist of ${this.policy.allowedRecipients.length} address(es).`,
        );
      }
    }

    const amount = parseNativeAmount(input.amount, input.decimals);

    if (this.policy.maxAmountPerTransaction !== undefined) {
      const limit = parseNativeAmount(this.policy.maxAmountPerTransaction, input.decimals);
      if (amount > limit) {
        return refuse(
          'maxAmountPerTransaction',
          `Amount ${input.amount} exceeds the per-transaction limit of ${this.policy.maxAmountPerTransaction}.`,
        );
      }
    }

    if (this.policy.maxAmountPerSession !== undefined) {
      const limit = parseNativeAmount(this.policy.maxAmountPerSession, input.decimals);
      const spent = this.sessionSpendByDecimals.get(input.decimals) ?? 0n;
      if (spent + amount > limit) {
        return refuse(
          'maxAmountPerSession',
          `Amount ${input.amount} would take session spend past the limit of ${this.policy.maxAmountPerSession}.`,
        );
      }
    }

    return ALLOWED;
  }

  /**
   * EVM addresses are compared case-insensitively so an allowlist cannot be
   * bypassed by changing capitalisation. Tron base58 addresses are case-sensitive
   * and compared exactly.
   */
  private matches(list: readonly string[] | undefined, address: string): boolean {
    if (!list?.length) return false;

    const target = normaliseForComparison(address);
    return list.some((entry) => normaliseForComparison(entry) === target);
  }

  private record(input: PolicyCheckInput, decision: PolicyDecision): void {
    this.auditLog.push({
      at: new Date().toISOString(),
      chain: input.chain,
      to: input.to,
      amount: input.amount,
      tokenAddress: input.tokenAddress,
      decision: decision.allowed ? 'allowed' : 'refused',
      ...(decision.allowed ? {} : { rule: decision.rule, reason: decision.reason }),
    });
  }

  /** Fail at construction rather than on the first transfer if a limit is malformed. */
  private assertPolicyParses(): void {
    for (const [field, value] of [
      ['maxAmountPerTransaction', this.policy.maxAmountPerTransaction],
      ['maxAmountPerSession', this.policy.maxAmountPerSession],
    ] as const) {
      if (value === undefined) continue;
      try {
        parseNativeAmount(value, 18);
      } catch {
        throw new LocktekError(
          `Invalid policy.${field}: "${value}". Expected a positive decimal in whole units (e.g. "0.5").`,
          ErrorCode.INVALID_CONFIG,
        );
      }
    }
  }
}

/**
 * EVM addresses are hex and case-insensitive, so they are compared lowercased —
 * including the `0x` prefix itself, since `0X…` is still an EVM address and must not
 * slip past an allowlist. Tron base58 addresses are case-sensitive and compared as-is.
 */
function normaliseForComparison(address: string): string {
  return /^0x/i.test(address) ? address.toLowerCase() : address;
}
