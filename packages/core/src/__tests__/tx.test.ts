import { describe, it, expect } from 'vitest';
import { NonceManager } from '../tx/nonce-manager.js';
import { InMemoryIdempotencyStore } from '../tx/idempotency.js';

const ADDRESS = '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C';

describe('NonceManager', () => {
  it('returns the chain pending nonce for a first allocation', async () => {
    const manager = new NonceManager();
    await expect(manager.allocate(ADDRESS, async () => 12)).resolves.toBe(12);
  });

  it('gives concurrent allocations distinct sequential nonces', async () => {
    const manager = new NonceManager();
    // The chain keeps reporting the same pending nonce, which is exactly the
    // condition that makes two concurrent builds collide without serialisation.
    const nonces = await Promise.all(
      Array.from({ length: 5 }, () => manager.allocate(ADDRESS, async () => 3)),
    );

    expect([...nonces].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7]);
  });

  it('keeps separate sequences per address', async () => {
    const manager = new NonceManager();
    const other = '0x0000000000000000000000000000000000000001';

    await manager.allocate(ADDRESS, async () => 1);
    await expect(manager.allocate(other, async () => 9)).resolves.toBe(9);
  });

  it('treats addresses case-insensitively', async () => {
    const manager = new NonceManager();
    await manager.allocate(ADDRESS.toLowerCase(), async () => 4);
    await expect(manager.allocate(ADDRESS.toUpperCase(), async () => 4)).resolves.toBe(5);
  });

  it('never drifts below the chain, even if local state lags', async () => {
    const manager = new NonceManager();
    await manager.allocate(ADDRESS, async () => 1);
    // Another process advanced the account; the chain now reports 50.
    await expect(manager.allocate(ADDRESS, async () => 50)).resolves.toBe(50);
  });

  it('releases an unused nonce so the sequence has no gap', async () => {
    const manager = new NonceManager();
    const nonce = await manager.allocate(ADDRESS, async () => 7);

    manager.release(ADDRESS, nonce);
    await expect(manager.allocate(ADDRESS, async () => 7)).resolves.toBe(7);
  });

  it('ignores a release for a nonce that is not the most recent', async () => {
    const manager = new NonceManager();
    await manager.allocate(ADDRESS, async () => 7);
    await manager.allocate(ADDRESS, async () => 7);

    manager.release(ADDRESS, 7);
    await expect(manager.allocate(ADDRESS, async () => 7)).resolves.toBe(9);
  });

  it('re-reads the chain after a reset', async () => {
    const manager = new NonceManager();
    await manager.allocate(ADDRESS, async () => 7);
    manager.reset(ADDRESS);
    await expect(manager.allocate(ADDRESS, async () => 7)).resolves.toBe(7);
  });

  it('keeps serving later callers after one allocation fails', async () => {
    const manager = new NonceManager();

    await expect(
      manager.allocate(ADDRESS, async () => {
        throw new Error('rpc down');
      }),
    ).rejects.toThrow('rpc down');

    await expect(manager.allocate(ADDRESS, async () => 2)).resolves.toBe(2);
  });
});

describe('InMemoryIdempotencyStore', () => {
  it('returns nothing for an unknown key', async () => {
    await expect(new InMemoryIdempotencyStore().get('nope')).resolves.toBeUndefined();
  });

  it('reserves a key exactly once', async () => {
    const store = new InMemoryIdempotencyStore();
    await expect(store.reserve('k')).resolves.toBe(true);
    await expect(store.reserve('k')).resolves.toBe(false);
  });

  it('returns the recorded result after completion', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.reserve('k');
    await store.set('k', { hash: '0xabc' });

    await expect(store.get('k')).resolves.toEqual({ hash: '0xabc' });
    await expect(store.reserve('k')).resolves.toBe(false);
  });

  it('allows a retry after a released reservation', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.reserve('k');
    await store.release('k');

    await expect(store.reserve('k')).resolves.toBe(true);
  });
});
