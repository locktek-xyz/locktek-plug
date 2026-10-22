import { LocktekError, ErrorCode } from '../types/common.js';
import type { IdempotencyStore } from './idempotency.js';
import type { Logger } from '../observability/logger.js';

/** A transaction signed once, whose exact bytes can be resent. */
export interface SignedBytes {
  readonly hash: string;
  readonly raw: string;
}

/** The chain-specific steps {@link sendOnce} sequences. */
export interface SendSteps {
  readonly chain: string;
  readonly logger?: Logger;
  /** Sign the transaction. Called at most once per idempotency key. */
  sign(): Promise<SignedBytes>;
  /** Broadcast signed bytes. Resending identical bytes must be harmless. */
  broadcast(raw: string): Promise<void>;
  /** True when the node reports it already holds this exact transaction. */
  isAlreadyKnown(error: unknown): boolean;
  /**
   * True when the node answered and refused the transaction, so it is in no mempool.
   * False for timeouts and transport failures, where it may still land.
   */
  isDefinitiveRejection(error: unknown): boolean;
  /** Convert an upstream failure into a LocktekError with chain-specific wording. */
  wrapError(error: unknown): LocktekError;
  /** Called when the transaction certainly never reached the network (e.g. roll back a nonce). */
  onNotBroadcast?(): void;
}

/**
 * Sign once, record, then broadcast.
 *
 * With an idempotency key the invariant is: one key, one signed transaction, ever.
 * The signed bytes are persisted before the broadcast, so a retry after a timeout
 * resends the same bytes (deduplicated by the network by hash) rather than signing a
 * new transfer that could land alongside the first. The key is released only when the
 * node definitively refused the first broadcast — the one case where nothing can land.
 */
export async function sendOnce(
  steps: SendSteps,
  store: IdempotencyStore | undefined,
  idempotencyKey: string | undefined,
): Promise<{ hash: string }> {
  if (!store || !idempotencyKey) return sendUnkeyed(steps);

  // Namespaced so one key reused on two chains cannot return the other chain's hash.
  const key = `${steps.chain}:${idempotencyKey}`;

  const existing = await store.get(key);
  if (existing?.state === 'broadcast') {
    steps.logger?.info?.('tx.idempotent_replay', { chain: steps.chain, hash: existing.hash });
    return { hash: existing.hash };
  }
  if (existing?.state === 'pending') return resend(steps, store, key, idempotencyKey, existing);

  if (!(await store.reserve(key))) {
    throw new LocktekError(
      `A transaction with idempotencyKey "${idempotencyKey}" is already being signed. ` +
        'Wait for it to complete rather than sending a second time.',
      ErrorCode.TRANSACTION_FAILED,
    );
  }

  let signed: SignedBytes;
  try {
    signed = await steps.sign();
    await store.set(key, { hash: signed.hash, state: 'pending', rawTransaction: signed.raw });
  } catch (error: unknown) {
    await store.release(key);
    steps.onNotBroadcast?.();
    throw steps.wrapError(error);
  }

  try {
    await broadcastTolerant(steps, signed.raw);
  } catch (error: unknown) {
    if (steps.isDefinitiveRejection(error)) {
      await store.release(key);
      steps.onNotBroadcast?.();
      throw steps.wrapError(error);
    }
    throw outcomeUnknown(steps, error, signed.hash, idempotencyKey);
  }

  await store.set(key, { hash: signed.hash, state: 'broadcast' });
  steps.logger?.info?.('tx.broadcast', { chain: steps.chain, hash: signed.hash });
  return { hash: signed.hash };
}

async function sendUnkeyed(steps: SendSteps): Promise<{ hash: string }> {
  let signed: SignedBytes;
  try {
    signed = await steps.sign();
  } catch (error: unknown) {
    steps.onNotBroadcast?.();
    throw steps.wrapError(error);
  }

  try {
    await broadcastTolerant(steps, signed.raw);
  } catch (error: unknown) {
    if (steps.isDefinitiveRejection(error)) {
      steps.onNotBroadcast?.();
      throw steps.wrapError(error);
    }
    throw outcomeUnknown(steps, error, signed.hash, undefined);
  }

  steps.logger?.info?.('tx.broadcast', { chain: steps.chain, hash: signed.hash });
  return { hash: signed.hash };
}

/** Resend the bytes a pending key is bound to. Never signs anything new. */
async function resend(
  steps: SendSteps,
  store: IdempotencyStore,
  key: string,
  idempotencyKey: string,
  record: { hash: string; rawTransaction?: string },
): Promise<{ hash: string }> {
  if (!record.rawTransaction) {
    throw outcomeUnknown(steps, undefined, record.hash, idempotencyKey);
  }

  try {
    await broadcastTolerant(steps, record.rawTransaction);
  } catch (error: unknown) {
    throw outcomeUnknown(steps, error, record.hash, idempotencyKey);
  }

  await store.set(key, { hash: record.hash, state: 'broadcast' });
  steps.logger?.info?.('tx.rebroadcast', { chain: steps.chain, hash: record.hash });
  return { hash: record.hash };
}

async function broadcastTolerant(steps: SendSteps, raw: string): Promise<void> {
  try {
    await steps.broadcast(raw);
  } catch (error: unknown) {
    if (steps.isAlreadyKnown(error)) return;
    throw error;
  }
}

function outcomeUnknown(
  steps: SendSteps,
  error: unknown,
  hash: string,
  idempotencyKey: string | undefined,
): LocktekError {
  const wrapped = steps.wrapError(error ?? new Error('previous broadcast outcome unknown'));
  const advice = idempotencyKey
    ? `Retrying with idempotencyKey "${idempotencyKey}" resends exactly this transaction; ` +
      'it never signs a new one.'
    : 'Check the chain before retrying. Pass an idempotencyKey to make retries safe.';

  return new LocktekError(
    `${wrapped.message} Transaction ${hash} was signed and may still confirm. ${advice}`,
    wrapped.code,
    error,
  );
}
