/**
 * Serialises nonce allocation per sender so concurrent signings from one address
 * receive distinct, sequential nonces.
 *
 * Without this, two concurrent sends both read the same `pending` count from the
 * node, both sign at that nonce, and one transaction is silently dropped.
 *
 * An allocation is a reservation with three possible ends:
 *
 * - {@link commit}: a node accepted the broadcast. The nonce is spent, and stays spent
 *   even if an endpoint briefly reports an older `pending` count.
 * - {@link release}: the transaction certainly never reached the network. The nonce is
 *   free again and is the next one handed out, so no gap forms.
 * - neither: the outcome is unknown (a timed-out broadcast may still land). The nonce
 *   is never reissued.
 *
 * Allocation hands out the lowest nonce at or above the chain's `pending` count that is
 * neither committed nor in flight. Committed nonces are tracked individually rather
 * than as a high-water mark: a nonce released after a later one committed must be
 * handed out again, because the node keeps that later transaction queued behind the
 * hole and nothing from the address mines until it is filled.
 *
 * Scope is this process only. Two processes signing for the same address must
 * coordinate themselves or supply `TransactionParams.nonce` explicitly.
 */
export class NonceManager {
  /** Nonces a node accepted, per address, kept until the chain's pending count passes them. */
  private readonly committed = new Map<string, Set<number>>();
  /** Nonces reserved but neither committed nor released, per address. */
  private readonly inFlight = new Map<string, Set<number>>();
  private readonly queues = new Map<string, Promise<unknown>>();

  /**
   * Reserve the lowest nonce for `address` that the chain, a committed broadcast, and
   * an in-flight reservation have not already claimed.
   */
  async allocate(address: string, fetchPending: () => Promise<number>): Promise<number> {
    const key = address.toLowerCase();

    const run = async (): Promise<number> => {
      const pending = await fetchPending();
      const committed = setFor(this.committed, key);
      const reserved = setFor(this.inFlight, key);

      // Anything below `pending` is already consumed on chain; forget it.
      prune(committed, pending);
      prune(reserved, pending);

      let nonce = pending;
      while (committed.has(nonce) || reserved.has(nonce)) nonce += 1;

      reserved.add(nonce);
      return nonce;
    };

    const chained = (this.queues.get(key) ?? Promise.resolve()).then(run, run);
    this.queues.set(
      key,
      chained.catch(() => undefined),
    );

    return chained;
  }

  /** Record that a node accepted the transaction signed at `nonce`. */
  commit(address: string, nonce: number): void {
    const key = address.toLowerCase();
    setFor(this.inFlight, key).delete(nonce);
    setFor(this.committed, key).add(nonce);
  }

  /**
   * Return a nonce whose transaction was never broadcast, so it is reused rather than
   * skipped and later transactions do not stall behind a gap.
   */
  release(address: string, nonce: number): void {
    setFor(this.inFlight, address.toLowerCase()).delete(nonce);
  }

  /** Drop cached state for an address, forcing the next allocation to re-read the chain. */
  reset(address?: string): void {
    if (address) {
      const key = address.toLowerCase();
      this.committed.delete(key);
      this.inFlight.delete(key);
      return;
    }
    this.committed.clear();
    this.inFlight.clear();
  }
}

function setFor(map: Map<string, Set<number>>, key: string): Set<number> {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  return set;
}

function prune(set: Set<number>, below: number): void {
  for (const nonce of set) if (nonce < below) set.delete(nonce);
}
