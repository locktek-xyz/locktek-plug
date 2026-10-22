import { z } from 'zod';
import { createAuthEndpoint, sessionMiddleware, APIError } from 'better-auth/api';
import type { Locktek, Chain } from '@locktek/core';
import { ALL_CHAINS } from '@locktek/core';

const getBalanceBodySchema = z.object({
  address: z.string(),
  chain: z.string().optional(),
});

export function getBalanceEndpoint(locktek: Locktek) {
  return createAuthEndpoint(
    '/locktek/balance',
    {
      method: 'POST',
      body: getBalanceBodySchema,
      use: [sessionMiddleware],
      metadata: {
        openapi: {
          operationId: 'locktekGetBalance',
          summary: 'Get the native token balance for an address',
          description:
            'Returns the balance in whole units alongside base units. Any address may be ' +
            'queried — on-chain balances are public — so this is a convenience proxy, not an ' +
            'ownership assertion.',
        },
      },
    },
    async (ctx) => {
      const resolvedChain = ctx.body.chain ?? locktek.defaultChain;

      if (!resolvedChain) {
        throw new APIError('BAD_REQUEST', {
          message:
            'No chain specified and no defaultChain configured. Provide a chain in the request body or set defaultChain in plugin options.',
        });
      }

      if (!ALL_CHAINS.includes(resolvedChain as Chain)) {
        throw new APIError('BAD_REQUEST', {
          message: `Invalid chain "${resolvedChain}". Supported chains: ${ALL_CHAINS.join(', ')}`,
        });
      }

      const chain = resolvedChain as Chain;
      const { address } = ctx.body;

      try {
        const result = await locktek.getBalanceFormatted(address, chain);

        return ctx.json({
          address,
          chain,
          balance: result.balance,
          balanceFormatted: result.balanceFormatted,
          decimals: result.decimals,
          symbol: result.symbol,
        });
      } catch (error) {
        if (error instanceof APIError) throw error;
        throw new APIError('INTERNAL_SERVER_ERROR', {
          message:
            error instanceof Error
              ? error.message
              : `Failed to retrieve balance for address "${address}" on ${chain}.`,
        });
      }
    },
  );
}
