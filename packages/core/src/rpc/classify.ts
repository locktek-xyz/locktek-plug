import { ErrorCode, LocktekError } from '../types/common.js';

/** Substrings that identify a transient transport or rate-limit failure. */
const RETRYABLE_PATTERNS: readonly RegExp[] = [
  /timeout|timed out/i,
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|ENETUNREACH|EHOSTUNREACH/,
  /socket hang up|network error|failed to fetch|fetch failed/i,
  /rate.?limit|too many requests|429/i,
  /50[0234]\b|bad gateway|service unavailable|gateway timeout/i,
  /SERVER_ERROR|NETWORK_ERROR|TIMEOUT/,
];

/** ethers v6 error codes that are permanent — retrying cannot change the outcome. */
const PERMANENT_ETHERS_CODES: ReadonlySet<string> = new Set([
  'INSUFFICIENT_FUNDS',
  'NONCE_EXPIRED',
  'REPLACEMENT_UNDERPRICED',
  'TRANSACTION_REPLACED',
  'CALL_EXCEPTION',
  'INVALID_ARGUMENT',
  'MISSING_ARGUMENT',
  'UNEXPECTED_ARGUMENT',
  'VALUE_MISMATCH',
  'ACTION_REJECTED',
]);

/** Message text of an error and its immediate cause, for pattern matching. */
export function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return `${error.message} ${cause instanceof Error ? cause.message : ''}`;
  }
  return String(error);
}

function ethersCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' ? code : undefined;
}

/** True when the same call, repeated, could plausibly succeed. */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof LocktekError) {
    return error.code === ErrorCode.TIMEOUT || error.code === ErrorCode.RPC_ERROR;
  }

  const code = ethersCode(error);
  if (code && PERMANENT_ETHERS_CODES.has(code)) return false;

  const text = errorText(error);
  return RETRYABLE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Map an upstream error onto a Locktek {@link ErrorCode}.
 *
 * Insufficient funds is detected by ethers' structured `code` first and only falls
 * back to message matching, so the classification survives a reworded upstream error.
 */
export function classifyRpcError(error: unknown): ErrorCode {
  if (error instanceof LocktekError) return error.code;

  const code = ethersCode(error);
  if (code === 'INSUFFICIENT_FUNDS') return ErrorCode.INSUFFICIENT_FUNDS;
  if (code === 'CALL_EXCEPTION') return ErrorCode.TRANSACTION_FAILED;

  const text = errorText(error);
  if (/insufficient funds|insufficient balance/i.test(text)) return ErrorCode.INSUFFICIENT_FUNDS;
  if (/timeout|timed out|ETIMEDOUT/i.test(text)) return ErrorCode.TIMEOUT;
  if (isRetryableError(error)) return ErrorCode.RPC_ERROR;

  return ErrorCode.NETWORK_ERROR;
}

/** True when the error indicates the sender could not cover value plus fees. */
export function isInsufficientFunds(error: unknown): boolean {
  return classifyRpcError(error) === ErrorCode.INSUFFICIENT_FUNDS;
}
