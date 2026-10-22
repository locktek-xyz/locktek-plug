import type { Locktek } from '@locktek/core';
import { ErrorCode, LocktekError } from '@locktek/core';
import { sanitizeErrorMessage } from '../utils/sanitize.js';
import type { ConfirmationStore } from '../confirmation-store.js';
import type { ApprovalRequester } from '../approval.js';

/** Everything the tools need, passed once rather than threaded through each registrar. */
export interface ToolContext {
  readonly locktek: Locktek;
  readonly confirmations: ConfirmationStore;
  /** When true, every transfer and signature waits for a person's explicit approval. */
  readonly requireConfirmation: boolean;
  /** Asks the person using the MCP client, never the model. */
  readonly requestApproval: ApprovalRequester;
  /**
   * The key the server signs with. It is configured on the server and never accepted
   * from, or returned to, the model. Absent on a read-only server.
   */
  readonly signingKey?: string;
}

/** The server's signing key, or an error explaining that this server cannot sign. */
export function requireSigningKey(context: ToolContext): string {
  if (context.signingKey) return context.signingKey;
  throw new LocktekError(
    'This server has no signing key configured, so it cannot sign. Set LOCKTEK_PRIVATE_KEY ' +
      'in the server environment.',
    ErrorCode.INVALID_CONFIG,
  );
}

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

/** Success response: pretty JSON, so an agent can read values back reliably. */
export function ok(payload: unknown): ToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

/**
 * Error response.
 *
 * The message is sanitised on every path, because an upstream library can interpolate
 * key material into an exception, and the response goes straight into a model context.
 */
export function fail(prefix: string, error: unknown): ToolResult {
  const raw = error instanceof Error ? error.message : String(error);
  const code = error instanceof LocktekError ? ` [${error.code}]` : '';

  return {
    content: [{ type: 'text' as const, text: `${prefix}${code}: ${sanitizeErrorMessage(raw)}` }],
    isError: true,
  };
}
