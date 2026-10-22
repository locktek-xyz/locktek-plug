import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Chain } from '@locktek/core';
import { ok, fail } from './shared.js';
import type { ToolContext } from './shared.js';

export function registerEstimateGas(server: McpServer, { locktek }: ToolContext): void {
  server.registerTool(
    'estimate_gas',
    {
      description:
        'Estimate the fee for a transaction before sending it. The amount is in WHOLE units. ' +
        'feeIsFromNetwork reports whether the estimate came from live chain data or fallback constants.',
      inputSchema: {
        from: z.string().describe('Sender address.'),
        to: z.string().describe('Recipient address.'),
        amount: z.string().describe('Amount in WHOLE units, e.g. "0.1" for 0.1 ETH.'),
        chain: z.string().optional().describe('Target blockchain. Defaults to the default chain.'),
        tokenAddress: z
          .string()
          .optional()
          .describe('Token contract address, for token transfers.'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ from, to, amount, chain, tokenAddress }) => {
      try {
        const resolvedChain = (chain ?? locktek.defaultChain) as Chain;
        const estimate = await locktek.estimateGas(
          { from, to, amount, tokenAddress },
          resolvedChain,
        );

        return ok({
          chain: resolvedChain,
          totalFee: estimate.totalFeeInToken,
          totalFeeBaseUnits: estimate.totalFee,
          gasLimit: estimate.gasLimit,
          maxFeePerGas: estimate.maxFeePerGas,
          gasPrice: estimate.gasPrice,
          feeIsFromNetwork: estimate.fromNetwork ?? false,
        });
      } catch (error: unknown) {
        return fail('Error estimating gas', error);
      }
    },
  );
}
