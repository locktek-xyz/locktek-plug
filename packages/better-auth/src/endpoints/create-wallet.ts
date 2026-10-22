import { z } from 'zod';
import { createAuthEndpoint, sessionMiddleware, APIError } from 'better-auth/api';
import type { Locktek, Chain } from '@locktek/core';
import { ALL_CHAINS } from '@locktek/core';
import { provisionWallet, type WalletAdapter } from '../provisioning.js';

const createWalletBodySchema = z.object({
  chain: z.string().optional(),
  label: z.string().optional(),
});

export function createWalletEndpoint(locktek: Locktek, hasEncryption: boolean) {
  return createAuthEndpoint(
    '/locktek/create-wallet',
    {
      method: 'POST',
      body: createWalletBodySchema,
      use: [sessionMiddleware],
      metadata: {
        openapi: {
          operationId: 'locktekCreateWallet',
          summary: 'Create a wallet for the authenticated user',
          description:
            'Creates an HD wallet on the specified chain and stores the encrypted private key ' +
            'and mnemonic. Idempotent per user and chain: calling it twice returns the ' +
            'existing wallet with created=false rather than provisioning a second one.',
        },
      },
    },
    async (ctx) => {
      if (!hasEncryption) {
        throw new APIError('BAD_REQUEST', {
          message:
            'Encryption key required. Configure encryptionKey in plugin options to create wallets.',
        });
      }

      const userId = ctx.context.session.user.id;
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

      try {
        const result = await provisionWallet(
          locktek,
          ctx.context.adapter as unknown as WalletAdapter,
          userId,
          resolvedChain as Chain,
          ctx.body.label ?? null,
        );

        return ctx.json({ wallet: result.wallet, created: result.created });
      } catch (error: unknown) {
        if (error instanceof APIError) throw error;
        throw new APIError('INTERNAL_SERVER_ERROR', {
          message: error instanceof Error ? error.message : 'Failed to create wallet.',
        });
      }
    },
  );
}
