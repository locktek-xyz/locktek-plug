import { describe, it, expect, vi } from 'vitest';
import { EndpointPool } from '../rpc/endpoint-pool.js';
import { RpcExecutor } from '../rpc/executor.js';
import { withTimeout } from '../rpc/timeout.js';
import { classifyRpcError, isRetryableError } from '../rpc/classify.js';
import { backoffDelayMs, resolveRpcPolicy, DEFAULT_RPC_POLICY } from '../rpc/policy.js';
import { ErrorCode, LocktekError } from '../types/common.js';

const FAST = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, timeoutMs: 200 };

describe('rpc policy', () => {
  it('applies defaults for anything not overridden', () => {
    const policy = resolveRpcPolicy({ timeoutMs: 5 });
    expect(policy.timeoutMs).toBe(5);
    expect(policy.maxAttempts).toBe(DEFAULT_RPC_POLICY.maxAttempts);
  });

  it('never exceeds maxDelayMs and always applies jitter', () => {
    const policy = resolveRpcPolicy({ baseDelayMs: 1000, maxDelayMs: 2000 });
    const delays = Array.from({ length: 50 }, () => backoffDelayMs(5, policy));

    expect(Math.max(...delays)).toBeLessThanOrEqual(2000);
    // Full jitter means the values must not all be identical, which is what stops
    // every client retrying a struggling endpoint in lockstep.
    expect(new Set(delays).size).toBeGreaterThan(1);
  });
});

describe('error classification', () => {
  it.each([
    ['ETIMEDOUT'],
    ['socket hang up'],
    ['429 too many requests'],
    ['503 service unavailable'],
    ['ECONNREFUSED'],
  ])('treats %s as retryable', (message) => {
    expect(isRetryableError(new Error(message))).toBe(true);
  });

  it('treats a reverted call as permanent, so it is never retried', () => {
    const error = new Error('execution reverted');
    (error as { code?: string }).code = 'CALL_EXCEPTION';
    expect(isRetryableError(error)).toBe(false);
  });

  it('prefers the structured ethers code over message text', () => {
    const error = new Error('some entirely reworded upstream message');
    (error as { code?: string }).code = 'INSUFFICIENT_FUNDS';
    expect(classifyRpcError(error)).toBe(ErrorCode.INSUFFICIENT_FUNDS);
  });

  it('still detects insufficient funds from the message when no code is present', () => {
    expect(classifyRpcError(new Error('insufficient funds for gas'))).toBe(
      ErrorCode.INSUFFICIENT_FUNDS,
    );
  });

  it('classifies an unrecognised error as a network error', () => {
    expect(classifyRpcError(new Error('who knows'))).toBe(ErrorCode.NETWORK_ERROR);
  });
});

describe('withTimeout', () => {
  it('resolves when the operation finishes in time', async () => {
    await expect(withTimeout(async () => 'ok', 100, { operation: 'op', chain: 'c' })).resolves.toBe(
      'ok',
    );
  });

  it('throws TIMEOUT when the deadline passes', async () => {
    await expect(
      withTimeout(() => new Promise(() => undefined), 20, { operation: 'op', chain: 'c' }),
    ).rejects.toMatchObject({ code: ErrorCode.TIMEOUT });
  });

  it('aborts the signal so the underlying request is actually cancelled', async () => {
    let observed: AbortSignal | undefined;

    await expect(
      withTimeout(
        (signal) => {
          observed = signal;
          return new Promise(() => undefined);
        },
        20,
        { operation: 'op', chain: 'c' },
      ),
    ).rejects.toThrow();

    expect(observed?.aborted).toBe(true);
  });
});

describe('EndpointPool', () => {
  it('requires at least one endpoint', () => {
    expect(() => new EndpointPool([], 1000)).toThrow();
  });

  it('deprioritises a failed endpoint without removing it', () => {
    const pool = new EndpointPool(['a', 'b'], 1000);
    pool.markFailure('a', 0);

    expect(pool.ordered(500)).toEqual(['b', 'a']);
    expect(pool.size).toBe(2);
  });

  it('restores an endpoint once its cooldown elapses', () => {
    const pool = new EndpointPool(['a', 'b'], 1000);
    pool.markFailure('a', 0);
    expect(pool.ordered(2000)).toEqual(['a', 'b']);
  });

  it('still returns cooling endpoints when every endpoint is cooling', () => {
    const pool = new EndpointPool(['a', 'b'], 1000);
    pool.markFailure('a', 0);
    pool.markFailure('b', 0);
    expect(pool.ordered(100)).toHaveLength(2);
  });

  it('clears the failure record on success', () => {
    const pool = new EndpointPool(['a', 'b'], 1000);
    pool.markFailure('a', 0);
    pool.markSuccess('a');
    expect(pool.ordered(100)).toEqual(['a', 'b']);
  });
});

describe('RpcExecutor', () => {
  describe('read', () => {
    it('fails over to the next endpoint', async () => {
      const executor = new RpcExecutor('test', ['a', 'b'], FAST);
      const seen: string[] = [];

      const result = await executor.read('op', async (url) => {
        seen.push(url);
        if (url === 'a') throw new Error('ECONNREFUSED');
        return 'ok';
      });

      expect(result).toBe('ok');
      expect(seen).toContain('b');
    });

    it('retries the same endpoint before moving on', async () => {
      const executor = new RpcExecutor('test', ['a'], FAST);
      let attempts = 0;

      const result = await executor.read('op', async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('429');
        return 'ok';
      });

      expect(result).toBe('ok');
      expect(attempts).toBe(3);
    });

    it('does not retry a permanent failure', async () => {
      const executor = new RpcExecutor('test', ['a', 'b'], FAST);
      let attempts = 0;

      await expect(
        executor.read('op', async () => {
          attempts += 1;
          const error = new Error('reverted');
          (error as { code?: string }).code = 'CALL_EXCEPTION';
          throw error;
        }),
      ).rejects.toThrow();

      expect(attempts).toBe(1);
    });

    it('reports TIMEOUT rather than a generic RPC error when every endpoint times out', async () => {
      const executor = new RpcExecutor('test', ['a', 'b'], {
        maxAttempts: 1,
        baseDelayMs: 1,
        timeoutMs: 20,
      });

      await expect(executor.read('op', () => new Promise(() => undefined))).rejects.toMatchObject({
        code: ErrorCode.TIMEOUT,
      });
    });

    it('names every endpoint it tried when all of them fail', async () => {
      const executor = new RpcExecutor(
        'test',
        ['https://alpha.example/v2/KEY-ALPHA', 'https://beta.example/v2/KEY-BETA'],
        FAST,
      );

      await expect(
        executor.read('op', async () => {
          throw new Error('ETIMEDOUT');
        }),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/alpha\.example.*beta\.example/),
      });
    });

    it('never puts an API key from an endpoint URL into an error message', async () => {
      const url = 'https://rpc.example/v2/KEY-SECRET?apikey=KEY-QUERY';
      const executor = new RpcExecutor('test', [url], FAST);

      const error = await executor
        .read('op', async () => {
          throw new Error(`request to ${url} failed: ECONNRESET`);
        })
        .catch((e: unknown) => e as Error);

      expect(error.message).toContain('https://rpc.example/…');
      expect(error.message).not.toContain('KEY-SECRET');
      expect(error.message).not.toContain('KEY-QUERY');
    });
  });

  describe('write', () => {
    it('never fails over — a broadcast that may have landed must not be repeated', async () => {
      const executor = new RpcExecutor('test', ['a', 'b'], FAST);
      const seen: string[] = [];

      await expect(
        executor.write('send', async (url) => {
          seen.push(url);
          throw new Error('ECONNREFUSED');
        }),
      ).rejects.toThrow();

      expect(seen).toEqual(['a']);
    });

    it('never retries', async () => {
      const executor = new RpcExecutor('test', ['a'], FAST);
      let attempts = 0;

      await expect(
        executor.write('send', async () => {
          attempts += 1;
          throw new Error('429 too many requests');
        }),
      ).rejects.toThrow();

      expect(attempts).toBe(1);
    });

    it('warns that a timed-out broadcast may still have landed', async () => {
      const executor = new RpcExecutor('test', ['a'], { timeoutMs: 20 });

      await expect(
        executor.write('send', () => new Promise(() => undefined)),
      ).rejects.toMatchObject({
        code: ErrorCode.TIMEOUT,
        message: expect.stringContaining('may still have been broadcast'),
      });
    });

    it('rethrows the original error so the adapter can classify it', async () => {
      const executor = new RpcExecutor('test', ['a'], FAST);
      const original = new Error('node said no');

      await expect(executor.write('send', async () => Promise.reject(original))).rejects.toBe(
        original,
      );
    });
  });

  it('logs a failover through the supplied logger', async () => {
    const warn = vi.fn();
    const executor = new RpcExecutor(
      'test',
      ['https://a.example/key-a', 'https://b.example/key-b'],
      FAST,
      { warn },
    );

    await executor.read('op', async (url) => {
      if (url === 'https://a.example/key-a') throw new Error('ECONNREFUSED');
      return 'ok';
    });

    expect(warn).toHaveBeenCalledWith(
      'rpc.endpoint_failover',
      expect.objectContaining({
        endpoint: 'https://a.example/…',
      }),
    );
  });

  it('surfaces a LocktekError from the callback untouched', async () => {
    const executor = new RpcExecutor('test', ['a'], FAST);
    const original = new LocktekError('nope', ErrorCode.INVALID_ADDRESS);

    await expect(executor.read('op', async () => Promise.reject(original))).rejects.toBe(original);
  });
});
