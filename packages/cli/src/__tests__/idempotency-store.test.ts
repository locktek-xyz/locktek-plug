import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileIdempotencyStore } from '../utils/idempotency-store.js';

const PENDING = {
  hash: `0x${'aa'.repeat(32)}`,
  state: 'pending',
  rawTransaction: '0x02f8',
} as const;

describe('FileIdempotencyStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'locktek-idem-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lets exactly one of two concurrent callers reserve a key', async () => {
    const a = new FileIdempotencyStore(dir);
    const b = new FileIdempotencyStore(dir);

    const results = await Promise.all([a.reserve('k'), b.reserve('k')]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('survives a new process: a record written by one instance is seen by the next', async () => {
    const firstRun = new FileIdempotencyStore(dir);
    await firstRun.reserve('payout-1');
    await firstRun.set('payout-1', PENDING);

    const secondRun = new FileIdempotencyStore(dir);

    await expect(secondRun.get('payout-1')).resolves.toEqual(PENDING);
    await expect(secondRun.reserve('payout-1')).resolves.toBe(false);
  });

  it('reports a bare reservation as absent but still held', async () => {
    const store = new FileIdempotencyStore(dir);
    await store.reserve('k');

    await expect(store.get('k')).resolves.toBeUndefined();
    await expect(store.reserve('k')).resolves.toBe(false);
  });

  it('frees a key on release', async () => {
    const store = new FileIdempotencyStore(dir);
    await store.reserve('k');
    await store.release('k');

    await expect(store.reserve('k')).resolves.toBe(true);
  });

  it('reclaims a reservation left by a run that crashed before signing', async () => {
    const store = new FileIdempotencyStore(dir);
    await store.reserve('k');

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);

    await expect(store.reserve('k')).resolves.toBe(true);
  });

  it('never reclaims a key bound to a signed transaction, however old', async () => {
    const store = new FileIdempotencyStore(dir);
    await store.reserve('k');
    await store.set('k', PENDING);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000);

    await expect(store.reserve('k')).resolves.toBe(false);
  });

  it('treats an empty file as a reservation in progress, not a free key', async () => {
    const store = new FileIdempotencyStore(dir);
    await store.reserve('k');
    const [file] = readdirSync(dir);
    writeFileSync(join(dir, file!), '');

    await expect(store.reserve('k')).resolves.toBe(false);
  });

  it('writes records readable only by the owner and leaves no temp files', async () => {
    const store = new FileIdempotencyStore(dir);
    await store.reserve('k');
    await store.set('k', PENDING);

    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);
    expect(statSync(join(dir, files[0]!)).mode & 0o077).toBe(0);
  });
});
