import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Chain } from '@locktek/core';
import { ok, fail, requireSigningKey } from './shared.js';
import type { ToolContext } from './shared.js';

export function registerSimulateTransaction(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'simulate_transaction',
    {
      description:
        'Show exactly what a transfer would do — resolved amount in both whole and base ' +
        'units, estimated fee, and whether policy allows it — without signing or broadcasting ' +
        'anything. Returns a confirmationToken that confirm_transaction can redeem once ' +
        'for exactly this transfer.',
      inputSchema: {
        from: z
          .string()
          .optional()
          .describe("Sender address. Defaults to the server's signing wallet."),
        to: z.string().describe('Recipient address.'),
        amount: z
          .string()
          .describe('Amount in WHOLE units, e.g. "0.1" for 0.1 ETH or "25" for 25 USDC.'),
        chain: z.string().optional().describe('Target blockchain. Defaults to the default chain.'),
        tokenAddress: z
          .string()
          .optional()
          .describe('Token contract address for ERC-20/TRC-20 transfers. Omit for native.'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ from: requestedFrom, to, amount, chain, tokenAddress }) => {
      try {
        const resolvedChain = (chain ?? context.locktek.defaultChain) as Chain;
        const from =
          requestedFrom ??
          (await context.locktek.importWallet(requireSigningKey(context), resolvedChain)).address;
        const result = await context.locktek.simulateTransaction(
          { from, to, amount, tokenAddress },
          resolvedChain,
        );

        if (!result.allowed) {
          return ok({
            allowed: false,
            rule: result.rule,
            reason: result.reason,
            chain: resolvedChain,
            from,
            to,
            amount,
          });
        }

        const confirmationToken = context.confirmations.issue({
          chain: resolvedChain,
          from,
          to,
          amount,
          tokenAddress,
        });

        return ok({
          allowed: true,
          chain: resolvedChain,
          from,
          to,
          amount: result.amount,
          amountBaseUnits: result.baseUnitAmount,
          decimals: result.decimals,
          tokenAddress: tokenAddress ?? null,
          estimatedFee: result.estimatedGas?.totalFeeInToken,
          feeIsFromNetwork: result.estimatedGas?.fromNetwork ?? false,
          confirmationToken,
          nextStep:
            'Show these values to the person, then call confirm_transaction with this token. ' +
            'The token is not an approval by itself.',
        });
      } catch (error: unknown) {
        return fail('Error simulating transaction', error);
      }
    },
  );
}
