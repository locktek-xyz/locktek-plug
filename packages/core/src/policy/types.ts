import type { Chain } from '../types/chain.js';

/**
 * Constraints enforced by the SDK before a transaction is signed.
 *
 * These are enforced in-process, not advertised to a caller. An agent that can be
 * prompt-injected can ask for anything; a limit only helps if the code refuses.
 */
export interface TransactionPolicy {
  /** Largest single transfer, in whole units (e.g. "0.5"). */
  readonly maxAmountPerTransaction?: string;
  /** Largest cumulative transfer total for the life of this instance, in whole units. */
  readonly maxAmountPerSession?: string;
  /** If set, only these recipients may receive funds. Everything else is refused. */
  readonly allowedRecipients?: readonly string[];
  /** Recipients that are always refused, checked even when no allowlist is set. */
  readonly deniedRecipients?: readonly string[];
  /** Refuse every transfer. Useful for a read-only deployment. */
  readonly readOnly?: boolean;
}

export interface PolicyCheckInput {
  readonly chain: Chain;
  readonly to: string;
  /** Transfer amount in whole units. */
  readonly amount: string;
  /** Decimals of the asset being transferred (native or token). */
  readonly decimals: number;
  readonly tokenAddress?: string;
}

export type PolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly rule: string; readonly reason: string };

/** A record of one policy evaluation, for the audit trail. */
export interface PolicyAuditEntry {
  readonly at: string;
  readonly chain: Chain;
  readonly to: string;
  readonly amount: string;
  readonly tokenAddress?: string;
  readonly decision: 'allowed' | 'refused';
  readonly rule?: string;
  readonly reason?: string;
}
