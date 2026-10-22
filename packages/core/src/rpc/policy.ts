/** Tuning for timeouts, retries, and endpoint failover on every network call. */
export interface RpcPolicy {
  /** Hard upper bound on a single attempt, in milliseconds. */
  readonly timeoutMs: number;
  /** Total attempts for a retryable read, including the first. */
  readonly maxAttempts: number;
  /** Delay before the first retry; doubles each attempt. */
  readonly baseDelayMs: number;
  /** Ceiling for the backoff delay. */
  readonly maxDelayMs: number;
  /** How long a failing endpoint is deprioritised before being tried first again. */
  readonly endpointCooldownMs: number;
}

export const DEFAULT_RPC_POLICY: RpcPolicy = {
  timeoutMs: 15_000,
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  endpointCooldownMs: 60_000,
};

export function resolveRpcPolicy(overrides?: Partial<RpcPolicy>): RpcPolicy {
  return { ...DEFAULT_RPC_POLICY, ...overrides };
}

/**
 * Exponential backoff with full jitter.
 *
 * Jitter matters more than the backoff itself: without it, every client retrying a
 * struggling endpoint retries in lockstep and keeps it down.
 */
export function backoffDelayMs(attempt: number, policy: RpcPolicy): number {
  const exponential = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  return Math.floor(Math.random() * exponential);
}
