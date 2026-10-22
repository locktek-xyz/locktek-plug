import { createAuthEndpoint, sessionMiddleware } from 'better-auth/api';
import { toResponse } from '../provisioning.js';

export function getWalletsEndpoint() {
  return createAuthEndpoint(
    '/locktek/wallets',
    {
      method: 'GET',
      use: [sessionMiddleware],
      metadata: {
        openapi: {
          operationId: 'locktekGetWallets',
          summary: 'List all wallets for the authenticated user',
          description:
            'Returns all wallets belonging to the current user. Private keys are never included.',
          responses: {
            200: {
              description: 'List of wallets',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      wallets: {
                        type: 'array',
                        items: {
                          $ref: '#/components/schemas/LocktekWallet',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (ctx) => {
      const userId = ctx.context.session.user.id;

      const wallets = await ctx.context.adapter.findMany({
        model: 'locktekWallet',
        where: [{ field: 'userId', value: userId }],
        sortBy: { field: 'createdAt', direction: 'desc' },
      });

      // Whitelist explicitly rather than trusting `returned: false`, so a new secret
      // column can never leak into a client payload by default.
      const sanitized = (wallets as Record<string, unknown>[]).map(toResponse);

      return ctx.json({ wallets: sanitized });
    },
  );
}
