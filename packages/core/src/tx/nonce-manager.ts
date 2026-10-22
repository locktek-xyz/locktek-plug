/**
 * Serialises nonce allocation per sender so concurrent transaction builds from one
 * address receive distinct, sequential nonces.
 *
 * Without this, two concurrent builds both read the same `pending` count from the
 * node, both sign at that nonce, and one transaction is silently dropped.
 *
 * Scope is this process only. Two processes signing for the same address must
 * coordinate themselves or supply `TransactionParams.nonce` explicitly.
 */
export class NonceManager {
  private readonly nextNonce = new Map<string, number>();
  private readonly queues = new Map<string, Promise<unknown>>();

  /**
   * Allocate the next nonce for `address`, reconciling against the chain's `pending`
   * count so local state can never drift below reality.
   */
  async allocate(address: string, fetchPending: () => Promise<number>): Promise<number> {
    const key = address.toLowerCase();

    const run = async (): Promise<number> => {
      const pending = await fetchPending();
      const cached = this.nextNonce.get(key);
      const nonce = cached === undefined ? pending : Math.max(cached, pending);
      this.nextNonce.set(key, nonce + 1);
      return nonce;
    };

    const chained = (this.queues.get(key) ?? Promise.resolve()).then(run, run);
    this.queues.set(
      key,
      chained.catch(() => undefined),
    );

    return chained;
  }

  /**
   * Roll back an allocation whose transaction was never broadcast, so the nonce is
   * not skipped and subsequent transactions do not stall behind a gap.
   */
  release(address: string, nonce: number): void {
    const key = address.toLowerCase();
    const next = this.nextNonce.get(key);
    if (next === nonce + 1) this.nextNonce.set(key, nonce);
  }

  /** Drop cached state for an address, forcing the next allocation to re-read the chain. */
  reset(address?: string): void {
    if (address) {
      this.nextNonce.delete(address.toLowerCase());
      return;
    }
    this.nextNonce.clear();
  }
}
