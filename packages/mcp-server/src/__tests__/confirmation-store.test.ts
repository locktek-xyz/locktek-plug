import { describe, it, expect } from 'vitest';
import { ConfirmationStore } from '../confirmation-store.js';

const TRANSFER = {
  chain: 'ethereum-sepolia',
  from: '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C',
  to: '0x0000000000000000000000000000000000000001',
  amount: '1.5',
};

describe('ConfirmationStore', () => {
  it('redeems a freshly issued token', () => {
    const store = new ConfirmationStore(60_000);
    const token = store.issue(TRANSFER);

    expect(store.redeem(token)).toEqual({ ok: true, transfer: TRANSFER });
  });

  it('is single-use', () => {
    const store = new ConfirmationStore(60_000);
    const token = store.issue(TRANSFER);

    store.redeem(token);
    expect(store.redeem(token).ok).toBe(false);
  });

  it('consumes an expired token rather than leaving it redeemable later', () => {
    const store = new ConfirmationStore(1_000);
    const token = store.issue(TRANSFER, 0);

    expect(store.redeem(token, 5_000)).toMatchObject({ ok: false });
    expect(store.size).toBe(0);
  });

  it('explains that an expired token needs a fresh simulation', () => {
    const store = new ConfirmationStore(1_000);
    const token = store.issue(TRANSFER, 0);
    const result = store.redeem(token, 5_000);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/expired/i);
  });

  it('rejects an unknown token', () => {
    expect(new ConfirmationStore(60_000).redeem('nope').ok).toBe(false);
  });

  it('binds a token to the exact transfer that was simulated', () => {
    const store = new ConfirmationStore(60_000);
    const token = store.issue(TRANSFER);

    expect(store.matches(token, TRANSFER)).toBe(true);
    expect(store.matches(token, { ...TRANSFER, amount: '999' })).toBe(false);
    expect(store.matches(token, { ...TRANSFER, to: '0xother' })).toBe(false);
  });

  it('issues distinct tokens for identical transfers', () => {
    const store = new ConfirmationStore(60_000);
    expect(store.issue(TRANSFER)).not.toBe(store.issue(TRANSFER));
  });
});
