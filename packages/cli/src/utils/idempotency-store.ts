import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { IdempotencyRecord, IdempotencyStore } from '@locktek/core';

/**
 * A reservation with no signed transaction behind it, older than this, was left by a
 * run that crashed before signing. Reclaiming it is safe: nothing is broadcast until
 * the signed transaction has been recorded.
 */
const STALE_RESERVATION_MS = 60_000;

interface Reservation {
  readonly state: 'reserved';
  readonly reservedAt: number;
}

type StoredEntry = IdempotencyRecord | Reservation;

/** Where the CLI keeps state between runs. Override with LOCKTEK_STATE_DIR. */
export function defaultStateDir(): string {
  return process.env['LOCKTEK_STATE_DIR'] ?? join(homedir(), '.locktek');
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}

/**
 * Idempotency records on disk, one file per key, so `--idempotency-key` holds across
 * separate CLI runs on this machine.
 *
 * `reserve` is an exclusive create, which is atomic across processes. A record holds a
 * signed transaction and its hash, never a private key; files are still owner-only.
 */
export class FileIdempotencyStore implements IdempotencyStore {
  private readonly dir: string;

  constructor(dir: string = join(defaultStateDir(), 'idempotency')) {
    this.dir = dir;
  }

  async get(key: string): Promise<IdempotencyRecord | undefined> {
    const entry = await this.read(key);
    return entry && entry.state !== 'reserved' ? entry : undefined;
  }

  async reserve(key: string): Promise<boolean> {
    if (await this.tryCreate(key)) return true;

    const entry = await this.read(key);
    const isStale =
      entry?.state === 'reserved' && Date.now() - entry.reservedAt > STALE_RESERVATION_MS;
    if (!isStale) return false;

    await rm(this.pathFor(key), { force: true });
    // One more attempt only: if another process reclaimed it first, it owns the key.
    return this.tryCreate(key);
  }

  async set(key: string, value: IdempotencyRecord): Promise<void> {
    await this.write(key, value);
  }

  async release(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    return join(this.dir, `${createHash('sha256').update(key).digest('hex')}.json`);
  }

  private async tryCreate(key: string): Promise<boolean> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const reservation: Reservation = { state: 'reserved', reservedAt: Date.now() };

    try {
      const handle = await open(this.pathFor(key), 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(reservation));
      } finally {
        await handle.close();
      }
      return true;
    } catch (error: unknown) {
      if (isErrno(error, 'EEXIST')) return false;
      throw error;
    }
  }

  private async read(key: string): Promise<StoredEntry | undefined> {
    let content: string;
    try {
      content = await readFile(this.pathFor(key), 'utf8');
    } catch (error: unknown) {
      if (isErrno(error, 'ENOENT')) return undefined;
      throw error;
    }

    // A reservation is written in one call, so an empty file is one being created
    // right now: report it as held rather than as free.
    if (content.trim() === '') return { state: 'reserved', reservedAt: Date.now() };
    return JSON.parse(content) as StoredEntry;
  }

  /** Write via a temp file and rename, so a crash never leaves a half-written record. */
  private async write(key: string, entry: StoredEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const target = this.pathFor(key);
    const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temp, JSON.stringify(entry), { mode: 0o600 });
    await rename(temp, target);
  }
}
