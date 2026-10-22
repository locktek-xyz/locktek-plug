import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Chain } from '@locktek/core';
import { ok, fail } from './shared.js';
import type { ToolContext } from './shared.js';

export function registerWaitForConfirmation(server: McpServer, { locktek }: ToolContext): void {
  server.registerTool(
    'wait_for_confirmation',
    {
      description:
        'Wait for a broadcast transaction to be mined and report whether it succeeded or ' +
        'reverted. A transaction hash alone only proves the broadcast was accepted, not that ' +
        'the transfer went through.',
      inputSchema: {
        hash: z.string().describe('Transaction hash returned by send_transaction.'),
        chain: z.string().optional().describe('Target blockchain. Defaults to the default chain.'),
        confirmations: z.number().optional().describe('Confirmations to wait for. Defaults to 1.'),
        timeoutMs: z.number().optional().describe('How long to wait before giving up.'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ hash, chain, confirmations, timeoutMs }) => {
      try {
        const resolvedChain = (chain ?? locktek.defaultChain) as Chain;
        const receipt = await locktek.waitForConfirmation(hash, resolvedChain, {
          confirmations,
          timeoutMs,
        });

        return ok({ ...receipt, chain: resolvedChain });
      } catch (error: unknown) {
        return fail('Error waiting for confirmation', error);
      }
    },
  );
}
