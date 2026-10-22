import { LocktekError, ErrorCode } from '../types/common.js';
import { EndpointPool, redactUrl, scrubUrls } from './endpoint-pool.js';
import { backoffDelayMs, resolveRpcPolicy, type RpcPolicy } from './policy.js';
import { classifyRpcError, isRetryableError } from './classify.js';
import { withTimeout, type CallContext } from './timeout.js';
import type { Logger } from '../observability/logger.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs chain calls with a timeout, and — for reads only — retry with backoff and
 * endpoint failover.
 *
 * Reads and writes are deliberately separate methods rather than one method with a
 * flag. A broadcast that times out may already have landed on chain, so retrying or
 * failing it over to a second endpoint can double-spend. `write` therefore gets the
 * timeout and nothing else; safe retry of a write is the caller's decision, made
 * explicit through an idempotency key.
 */
export class RpcExecutor {
  private readonly pool: EndpointPool;
  private readonly policy: RpcPolicy;
  private readonly chain: string;
  private readonly logger: Logger | undefined;

  constructor(
    chain: string,
    urls: readonly string[],
    policy?: Partial<RpcPolicy>,
    logger?: Logger,
  ) {
    this.policy = resolveRpcPolicy(policy);
    this.pool = new EndpointPool(urls, this.policy.endpointCooldownMs);
    this.chain = chain;
    this.logger = logger;
  }

  /** The endpoint a write should use. Writes never fail over. */
  get writeEndpoint(): string {
    return this.pool.primary();
  }

  get endpointCount(): number {
    return this.pool.size;
  }

  /**
   * Execute a read with timeout, retry-with-backoff, and failover across endpoints.
   * Safe because reads have no side effects.
   */
  async read<T>(
    operation: string,
    fn: (url: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const endpoints = this.pool.ordered();
    const failures: { endpoint: string; error: unknown }[] = [];

    for (const endpoint of endpoints) {
      try {
        const result = await this.attemptWithRetry(operation, endpoint, fn);
        this.pool.markSuccess(endpoint);
        return result;
      } catch (error: unknown) {
        failures.push({ endpoint, error });
        this.pool.markFailure(endpoint);

        if (!isRetryableError(error)) {
          throw this.wrap(operation, endpoint, error);
        }

        this.logger?.warn?.('rpc.endpoint_failover', {
          chain: this.chain,
          operation,
          endpoint: redactUrl(endpoint),
          remaining: endpoints.length - failures.length,
        });
      }
    }

    throw this.allEndpointsFailed(operation, failures);
  }

  /**
   * Execute a write with a timeout only — no retry, no failover.
   * A timed-out broadcast may still confirm; the error says so explicitly.
   */
  async write<T>(
    operation: string,
    fn: (url: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const endpoint = this.writeEndpoint;
    const context: CallContext = { operation, chain: this.chain, endpoint: redactUrl(endpoint) };
    const startedAt = Date.now();

    try {
      const result = await withTimeout(
        (signal) => fn(endpoint, signal),
        this.policy.timeoutMs,
        context,
      );
      this.pool.markSuccess(endpoint);
      this.logger?.debug?.('rpc.write_ok', {
        chain: this.chain,
        operation,
        endpoint: redactUrl(endpoint),
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error: unknown) {
      this.pool.markFailure(endpoint);

      if (error instanceof LocktekError && error.code === ErrorCode.TIMEOUT) {
        throw new LocktekError(
          `${error.message} The transaction may still have been broadcast — ` +
            'check the chain before retrying, or retry with the same idempotencyKey.',
          ErrorCode.TIMEOUT,
          error,
        );
      }

      // Writes rethrow the original error so the adapter can classify it with
      // domain-specific wording (insufficient funds, reverted, and so on).
      throw error;
    }
  }

  private async attemptWithRetry<T>(
    operation: string,
    endpoint: string,
    fn: (url: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const context: CallContext = { operation, chain: this.chain, endpoint: redactUrl(endpoint) };
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt++) {
      try {
        return await withTimeout((signal) => fn(endpoint, signal), this.policy.timeoutMs, context);
      } catch (error: unknown) {
        lastError = error;

        if (!isRetryableError(error) || attempt === this.policy.maxAttempts) break;

        const delay = backoffDelayMs(attempt, this.policy);
        this.logger?.debug?.('rpc.retry', {
          chain: this.chain,
          operation,
          endpoint: redactUrl(endpoint),
          attempt,
          delayMs: delay,
        });
        await sleep(delay);
      }
    }

    throw lastError;
  }

  private wrap(operation: string, endpoint: string, error: unknown): LocktekError {
    if (error instanceof LocktekError) return error;

    return new LocktekError(
      `${operation} failed on ${this.chain} via ${redactUrl(endpoint)}. ` +
        `${error instanceof Error ? scrubUrls(error.message) : 'Unknown error'}`,
      classifyRpcError(error),
      error,
    );
  }

  private allEndpointsFailed(
    operation: string,
    failures: readonly { endpoint: string; error: unknown }[],
  ): LocktekError {
    const detail = failures
      .map(
        (f) =>
          `${redactUrl(f.endpoint)}: ${f.error instanceof Error ? scrubUrls(f.error.message) : 'unknown'}`,
      )
      .join('; ');

    // Preserve the most specific cause: if every endpoint timed out, the caller needs
    // to know it was a timeout, not a generic RPC problem.
    const allTimedOut = failures.every(
      (f) => f.error instanceof LocktekError && f.error.code === ErrorCode.TIMEOUT,
    );

    return new LocktekError(
      `${operation} failed on ${this.chain}: all ${failures.length} RPC endpoint(s) ` +
        `${allTimedOut ? 'timed out' : 'were unreachable'}. Tried — ${detail}. ` +
        'Configure a dedicated RPC endpoint via the `rpc` option for production use.',
      allTimedOut ? ErrorCode.TIMEOUT : ErrorCode.RPC_ERROR,
      failures.map((f) => f.error),
    );
  }
}
