import { createHash } from 'node:crypto';
import type { UnsignedTransaction } from '../types/transaction.js';

/** EVM hex is case-insensitive; Tron base58 is not, so only `0x` values are folded. */
function normalise(value: string | undefined): string {
  if (!value) return '';
  return /^0x/i.test(value) ? value.toLowerCase() : value;
}

/**
 * What an idempotency key promises: this chain, this sender, this recipient, this
 * amount of this asset, this calldata.
 *
 * Nonce and fees are deliberately left out. Rebuilding the same transfer — a CLI
 * rerun, a retry after a crash — produces a fresh nonce and fee estimate, and must
 * still be recognised as the same request.
 */
export function transferFingerprint(tx: UnsignedTransaction): string {
  const { params } = tx;
  const parts = [
    tx.chain,
    normalise(params.from),
    normalise(params.to),
    tx.baseUnitAmount ?? params.amount,
    normalise(params.tokenAddress),
    normalise(params.data),
  ];
  return digest(parts);
}

/**
 * EVM fingerprint taken from the transaction that will actually be signed — recipient
 * or token contract, value, calldata, chain ID — plus the sender. Unlike the params,
 * `tx.data` cannot disagree with the signed bytes: an edited recipient is a different
 * transfer, and an incidental `params.data` on a token transfer (which the calldata
 * ignores) is not.
 */
export function evmTransferFingerprint(tx: UnsignedTransaction): string {
  const signed = JSON.parse(tx.data) as Record<string, unknown>;
  return digest([
    tx.chain,
    String(signed.chainId ?? tx.chainId),
    normalise(tx.params.from),
    normalise(String(signed.to ?? '')),
    String(signed.value ?? '0'),
    normalise(String(signed.data ?? '0x')),
  ]);
}

function digest(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
