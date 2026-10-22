import { createHash, randomUUID } from 'node:crypto';

export interface PendingTransfer {
  readonly chain: string;
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly tokenAddress?: string;
}

interface StoredToken {
  readonly fingerprint: string;
  readonly transfer: PendingTransfer;
  readonly expiresAt: number;
}

/**
 * Single-use tokens that bind a confirmation to the exact transfer that was simulated.
 *
 * The token carries a fingerprint of the transfer rather than an opaque id, so a
 * confirmation cannot be redeemed against different parameters than the human saw.
 */
export class ConfirmationStore {
  private readonly tokens = new Map<string, StoredToken>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  issue(transfer: PendingTransfer, now: number = Date.now()): string {
    const token = randomUUID();
    this.tokens.set(token, {
      fingerprint: fingerprintOf(transfer),
      transfer,
      expiresAt: now + this.ttlMs,
    });
    return token;
  }

  /**
   * Redeem a token, consuming it. Returns the transfer it was issued for, or an
   * explanation of why it cannot be used.
   */
  redeem(
    token: string,
    now: number = Date.now(),
  ): { ok: true; transfer: PendingTransfer } | { ok: false; reason: string } {
    const stored = this.tokens.get(token);

    if (!stored) {
      return {
        ok: false,
        reason: 'Unknown or already-used confirmation token. Simulate the transfer again.',
      };
    }

    // Consume first: a token is single-use whether or not it turns out to be valid.
    this.tokens.delete(token);

    if (stored.expiresAt <= now) {
      return {
        ok: false,
        reason:
          'Confirmation token has expired. Simulate the transfer again to refresh the fee estimate.',
      };
    }

    return { ok: true, transfer: stored.transfer };
  }

  /** Verify a token matches the transfer being requested, without consuming it. */
  matches(token: string, transfer: PendingTransfer): boolean {
    const stored = this.tokens.get(token);
    return stored?.fingerprint === fingerprintOf(transfer);
  }

  get size(): number {
    return this.tokens.size;
  }
}

function fingerprintOf(transfer: PendingTransfer): string {
  return createHash('sha256')
    .update(
      [
        transfer.chain,
        transfer.from.toLowerCase(),
        transfer.to.toLowerCase(),
        transfer.amount,
        transfer.tokenAddress?.toLowerCase() ?? '',
      ].join('|'),
    )
    .digest('hex');
}
