import { describe, it, expect, vi } from 'vitest';
import { PolicyEngine } from '../policy/engine.js';
import { ErrorCode } from '../types/common.js';
import type { PolicyCheckInput } from '../policy/types.js';

const EVM_A = '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C';
const EVM_B = '0x0000000000000000000000000000000000000001';

const transfer = (overrides: Partial<PolicyCheckInput> = {}): PolicyCheckInput => ({
  chain: 'ethereum-sepolia',
  to: EVM_A,
  amount: '1',
  decimals: 18,
  ...overrides,
});

describe('PolicyEngine', () => {
  describe('unbounded default', () => {
    it('allows anything and reports itself as unbounded', () => {
      const engine = new PolicyEngine();
      expect(engine.isUnbounded).toBe(true);
      expect(engine.check(transfer({ amount: '1000' })).allowed).toBe(true);
    });
  });

  describe('per-transaction cap', () => {
    it('allows an amount at the limit', () => {
      const engine = new PolicyEngine({ maxAmountPerTransaction: '1' });
      expect(engine.check(transfer({ amount: '1' })).allowed).toBe(true);
    });

    it('refuses an amount above the limit', () => {
      const engine = new PolicyEngine({ maxAmountPerTransaction: '1' });
      const decision = engine.check(transfer({ amount: '1.000000000000000001' }));

      expect(decision).toMatchObject({ allowed: false, rule: 'maxAmountPerTransaction' });
    });

    it('rejects a malformed limit at construction, not at the first transfer', () => {
      expect(() => new PolicyEngine({ maxAmountPerTransaction: 'lots' })).toThrow(/Invalid policy/);
    });
  });

  describe('session cap', () => {
    it('accumulates spend across transfers', () => {
      const engine = new PolicyEngine({ maxAmountPerSession: '2' });

      expect(engine.reserve(transfer({ amount: '1' })).allowed).toBe(true);
      expect(engine.reserve(transfer({ amount: '1' })).allowed).toBe(true);
      expect(engine.reserve(transfer({ amount: '0.1' })).allowed).toBe(false);
    });

    it('holds the cap when concurrent transfers individually pass but jointly exceed it', () => {
      const engine = new PolicyEngine({ maxAmountPerSession: '1' });

      // reserve() checks and increments in one synchronous step, so there is no
      // read-then-write window for a second caller to slip through.
      const decisions = [
        engine.reserve(transfer({ amount: '0.6' })),
        engine.reserve(transfer({ amount: '0.6' })),
      ];

      expect(decisions.filter((d) => d.allowed)).toHaveLength(1);
    });

    it('rolls back a reservation whose transaction was never broadcast', () => {
      const engine = new PolicyEngine({ maxAmountPerSession: '1' });
      const input = transfer({ amount: '1' });

      expect(engine.reserve(input).allowed).toBe(true);
      engine.release(input);
      expect(engine.reserve(input).allowed).toBe(true);
    });

    it('never rolls back below zero', () => {
      const engine = new PolicyEngine({ maxAmountPerSession: '1' });
      const input = transfer({ amount: '1' });

      engine.release(input);
      expect(engine.reserve(input).allowed).toBe(true);
    });
  });

  describe('recipient rules', () => {
    it('refuses a recipient that is not on the allowlist', () => {
      const engine = new PolicyEngine({ allowedRecipients: [EVM_A] });
      expect(engine.check(transfer({ to: EVM_B })).allowed).toBe(false);
    });

    it('allows a listed recipient', () => {
      const engine = new PolicyEngine({ allowedRecipients: [EVM_A] });
      expect(engine.check(transfer({ to: EVM_A })).allowed).toBe(true);
    });

    it('cannot be bypassed by changing the capitalisation of an EVM address', () => {
      const engine = new PolicyEngine({ allowedRecipients: [EVM_A.toLowerCase()] });
      expect(engine.check(transfer({ to: EVM_A.toUpperCase() })).allowed).toBe(true);

      const denied = new PolicyEngine({ deniedRecipients: [EVM_A.toLowerCase()] });
      expect(denied.check(transfer({ to: EVM_A })).allowed).toBe(false);
    });

    it('applies the denylist even when no allowlist is configured', () => {
      const engine = new PolicyEngine({ deniedRecipients: [EVM_B] });
      expect(engine.check(transfer({ to: EVM_B })).allowed).toBe(false);
      expect(engine.check(transfer({ to: EVM_A })).allowed).toBe(true);
    });

    it('compares Tron addresses exactly, since base58 is case-sensitive', () => {
      const tron = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
      const engine = new PolicyEngine({ allowedRecipients: [tron] });

      expect(engine.check(transfer({ chain: 'tron', to: tron, decimals: 6 })).allowed).toBe(true);
      expect(
        engine.check(transfer({ chain: 'tron', to: tron.toUpperCase(), decimals: 6 })).allowed,
      ).toBe(false);
    });
  });

  describe('read-only mode', () => {
    it('refuses every transfer', () => {
      const engine = new PolicyEngine({ readOnly: true });
      expect(engine.check(transfer())).toMatchObject({ allowed: false, rule: 'readOnly' });
    });
  });

  describe('fail-closed behaviour', () => {
    it('refuses rather than allows when the amount cannot be parsed', () => {
      const engine = new PolicyEngine({ maxAmountPerTransaction: '1' });
      const decision = engine.check(transfer({ amount: 'not-a-number' }));

      expect(decision).toMatchObject({ allowed: false, rule: 'evaluation' });
    });
  });

  describe('assert', () => {
    it('throws POLICY_VIOLATION when a transfer is refused', () => {
      const engine = new PolicyEngine({ maxAmountPerTransaction: '0.5' });
      expect(() => engine.assert(transfer({ amount: '1' }))).toThrow(
        expect.objectContaining({ code: ErrorCode.POLICY_VIOLATION }),
      );
    });
  });

  describe('audit trail', () => {
    it('records refusals as well as approvals', () => {
      const engine = new PolicyEngine({ maxAmountPerTransaction: '0.5' });

      engine.reserve(transfer({ amount: '0.1' }));
      engine.reserve(transfer({ amount: '5' }));

      expect(engine.audit.map((entry) => entry.decision)).toEqual(['allowed', 'refused']);
      expect(engine.audit[1].rule).toBe('maxAmountPerTransaction');
    });

    it('returns a copy so callers cannot mutate the trail', () => {
      const engine = new PolicyEngine();
      engine.reserve(transfer());

      const snapshot = engine.audit as ReturnType<typeof engine.audit.slice>;
      snapshot.push({ ...snapshot[0] });

      expect(engine.audit).toHaveLength(1);
    });

    it('logs a refusal through the supplied logger', () => {
      const warn = vi.fn();
      const engine = new PolicyEngine({ readOnly: true }, { warn });

      engine.reserve(transfer());
      expect(warn).toHaveBeenCalledWith('policy.refused', expect.any(Object));
    });
  });
});
