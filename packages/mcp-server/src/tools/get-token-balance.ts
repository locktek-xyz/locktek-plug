import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Chain } from '@locktek/core';
import { ok, fail } from './shared.js';
import type { ToolContext } from './shared.js';

export function registerGetTokenBalance(server: McpServer, { locktek }: ToolContext): void {
  server.registerTool(
    'get_token_balance',
    {
      description:
        'Get the ERC-20/TRC-20 token balance of an address. The balance is scaled using the ' +
        "token contract's own decimals, and returned in whole units alongside base units.",
      inputSchema: {
        address: z.string().describe('The wallet address to check.'),
        tokenAddress: z.string().describe('The token contract address.'),
        chain: z
          .string()
          .optional()
          .describe('Target blockchain. Defaults to the configured default chain.'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, tokenAddress, chain }) => {
      try {
        const resolvedChain = (chain ?? locktek.defaultChain) as Chain;
        const result = await locktek.getTokenBalanceFormatted(address, tokenAddress, resolvedChain);

        return ok({
          address,
          tokenAddress,
          chain: resolvedChain,
          balance: result.balanceFormatted,
          balanceBaseUnits: result.balance,
          decimals: result.decimals,
        });
      } catch (error: unknown) {
        return fail('Error getting token balance', error);
      }
    },
  );
}
