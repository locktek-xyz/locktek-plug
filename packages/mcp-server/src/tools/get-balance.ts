import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Chain } from '@locktek/core';
import { ok, fail } from './shared.js';
import type { ToolContext } from './shared.js';

export function registerGetBalance(server: McpServer, { locktek }: ToolContext): void {
  server.registerTool(
    'get_balance',
    {
      description:
        'Get the native token balance of an address. Returns the balance in whole units ' +
        '(e.g. "1.5" ETH) alongside the raw base-unit value.',
      inputSchema: {
        address: z.string().describe('The wallet address to check the balance for.'),
        chain: z
          .string()
          .optional()
          .describe('Target blockchain. Defaults to the configured default chain.'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, chain }) => {
      try {
        const resolvedChain = (chain ?? locktek.defaultChain) as Chain;
        const result = await locktek.getBalanceFormatted(address, resolvedChain);

        return ok({
          address,
          chain: resolvedChain,
          balance: result.balanceFormatted,
          balanceBaseUnits: result.balance,
          decimals: result.decimals,
          symbol: result.symbol,
        });
      } catch (error: unknown) {
        return fail('Error getting balance', error);
      }
    },
  );
}
