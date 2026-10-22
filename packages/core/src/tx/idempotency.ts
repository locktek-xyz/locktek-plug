/**
 * What an idempotency key is bound to.
 *
 * A key is bound to exactly one signed transaction. The signed bytes are recorded
 * *before* the broadcast, so a retry after a timeout resends those same bytes —
 * which the network deduplicates — instead of signing a second transfer.
 */
export interface IdempotencyRecord {
  /** Hash of the signed transaction this key is bound to. */
  readonly hash: string;
  /**
   * `pending`: signed and possibly broadcast, outcome unknown.
   * `broadcast`: a node accepted the transaction.
   */
  readonly state: 'pending' | 'broadcast';
  /** The signed transaction, kept while `pending` so a retry can resend it unchanged. */
  readonly rawTransaction?: string;
}

/**
 * Durable map from idempotency key to the transaction it produced.
 *
 * Implementations must make `reserve` atomic: when two callers race on one key,
 * exactly one may receive `true`.
 */
export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | undefined>;
  /** Reserve an unused key. Returns false if the key is reserved or already bound. */
  reserve(key: string): Promise<boolean>;
  set(key: string, value: IdempotencyRecord): Promise<void>;
  /**
   * Forget a key. Called only when nothing was broadcast for it, or the node
   * definitively rejected the one transaction that was.
   */
  release(key: string): Promise<void>;
}

/**
 * Process-local idempotency store. Adequate for a single long-lived process (an MCP
 * server, a backend worker). It does not survive a restart, so a CLI or a multi-instance
 * backend must supply a durable implementation — see `FileIdempotencyStore` in
 * `@locktek/cli` for a single-machine example.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  private readonly reserved = new Set<string>();

  async get(key: string): Promise<IdempotencyRecord | undefined> {
    return this.records.get(key);
  }

  async reserve(key: string): Promise<boolean> {
    if (this.records.has(key) || this.reserved.has(key)) return false;
    this.reserved.add(key);
    return true;
  }

  async set(key: string, value: IdempotencyRecord): Promise<void> {
    this.records.set(key, value);
    this.reserved.delete(key);
  }

  async release(key: string): Promise<void> {
    this.records.delete(key);
    this.reserved.delete(key);
  }
}
