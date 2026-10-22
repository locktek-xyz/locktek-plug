/**
 * Sanitize error messages to prevent accidental leakage of private keys, RPC API keys,
 * or other sensitive data in MCP tool responses.
 */
import { scrubUrls } from '@locktek/core';

/** Matches 128-char hex strings (uncompressed public keys). Must be checked before 64-char. */
const HEX_128_RE = /\b(0x)?[0-9a-fA-F]{128}\b/g;

/** Matches 64-char hex strings (private keys). */
const HEX_64_RE = /\b(0x)?[0-9a-fA-F]{64}\b/g;

const REDACTED = '[REDACTED_KEY]';

/**
 * Replace any hex string that could be a private key (64 hex chars, optional 0x prefix)
 * or an uncompressed public key (128 hex chars) with `[REDACTED_KEY]`.
 *
 * Ethereum addresses (40 hex chars) are intentionally left intact since they are public.
 */
export function sanitizeErrorMessage(message: string): string {
  // Order matters: strip 128-char sequences first so they are not partially matched as 64-char.
  // URLs are reduced to scheme and host, since hosted RPC URLs embed their API key.
  return scrubUrls(message).replace(HEX_128_RE, REDACTED).replace(HEX_64_RE, REDACTED);
}
