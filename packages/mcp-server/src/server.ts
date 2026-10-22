import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLocktek } from '@locktek/core';
import type { LocktekOptions } from '@locktek/core';
import { ConfirmationStore } from './confirmation-store.js';
import { createApprovalRequester } from './approval.js';
import type { ToolContext } from './tools/shared.js';
import {
  registerCreateWallet,
  registerGetBalance,
  registerGetTokenBalance,
  registerSimulateTransaction,
  registerSendTransaction,
  registerConfirmTransaction,
  registerWaitForConfirmation,
  registerEstimateGas,
  registerValidateAddress,
  registerListChains,
  registerSignMessage,
  registerHealthCheck,
} from './tools/index.js';

export interface McpServerOptions {
  /** Ask the person using the MCP client to approve every transfer and signature. */
  readonly requireConfirmation?: boolean;
  readonly confirmationTtlMs?: number;
  /**
   * Key the server signs with. Without it the server is read-only and the signing
   * tools (send_transaction, confirm_transaction, sign_message) are not offered.
   */
  readonly signingKey?: string;
}

const DEFAULT_CONFIRMATION_TTL_MS = 120_000;

export function createLocktekMcpServer(
  options: LocktekOptions,
  serverOptions: McpServerOptions = {},
): McpServer {
  const locktek = createLocktek(options);

  const server = new McpServer({
    name: 'locktek',
    version: '0.1.0',
    title: 'Locktek Wallet Server',
    description:
      'Experimental, testnet-only MCP server for wallet creation, balance queries, and ' +
      'policy-constrained blockchain transactions',
  });

  const context: ToolContext = {
    locktek,
    confirmations: new ConfirmationStore(
      serverOptions.confirmationTtlMs ?? DEFAULT_CONFIRMATION_TTL_MS,
    ),
    requireConfirmation: serverOptions.requireConfirmation ?? false,
    requestApproval: createApprovalRequester(server),
    signingKey: serverOptions.signingKey,
  };

  registerCreateWallet(server, context);
  registerGetBalance(server, context);
  registerGetTokenBalance(server, context);
  registerSimulateTransaction(server, context);
  registerWaitForConfirmation(server, context);
  registerEstimateGas(server, context);
  registerValidateAddress(server, context);
  registerListChains(server, context);
  registerHealthCheck(server, context);

  // Offer signing only when the server holds a key: a tool that can only fail is noise
  // to an agent, and its absence makes a read-only deployment visible.
  if (context.signingKey) {
    registerSendTransaction(server, context);
    registerConfirmTransaction(server, context);
    registerSignMessage(server, context);
  }

  return server;
}
