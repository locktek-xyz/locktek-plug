import { z } from 'zod';
import { createAuthEndpoint, freshSessionMiddleware, APIError } from 'better-auth/api';
import type { Chain, Locktek } from '@locktek/core';
import { WALLET_EXPORT_ACKNOWLEDGEMENT, type WalletExportEvent } from '../types.js';

const exportWalletBodySchema = z.object({
  walletId: z.string(),
  /** Must be sent verbatim, so an export cannot happen by accident or by injection. */
  acknowledgement: z.literal(WALLET_EXPORT_ACKNOWLEDGEMENT),
});

/**
 * Return decrypted key material for a wallet the caller owns.
 *
 * This is the recovery path. Without it, an encrypted private key in a database is a
 * value nothing can ever spend — and a user who deletes their account, or an operator
 * who migrates off Locktek, loses the funds entirely.
 *
 * It is off unless the application enables it, and deliberately awkward to call: a
 * fresh session, an explicit acknowledgement string, an ownership check, and an audit
 * hook that must succeed before any key material leaves the server.
 */
export function exportWalletEndpoint(
  locktek: Locktek,
  onExport: (event: WalletExportEvent) => void | Promise<void>,
) {
  return createAuthEndpoint(
    '/locktek/export-wallet',
    {
      method: 'POST',
      body: exportWalletBodySchema,
      // A stolen or long-lived session must not be enough to take the keys.
      use: [freshSessionMiddleware],
      metadata: {
        openapi: {
          operationId: 'locktekExportWallet',
          summary: 'Export the private key and mnemonic for a wallet you own',
          description:
            'Returns decrypted key material. Requires a fresh session and an explicit ' +
            'acknowledgement, and is recorded through the audit hook before anything is ' +
            'returned. Never log or cache this response.',
        },
      },
    },
    async (ctx) => {
      const userId = ctx.context.session.user.id;

      const row = (await ctx.context.adapter.findOne({
        model: 'locktekWallet',
        where: [{ field: 'id', value: ctx.body.walletId }],
      })) as Record<string, unknown> | null;

      // The same message for "missing" and "not yours", so this cannot be used to
      // probe which wallet ids exist.
      if (!row || row.userId !== userId) {
        throw new APIError('NOT_FOUND', {
          message: 'Wallet not found.',
        });
      }

      try {
        const recovered = await locktek.recoverWallet({
          encryptedPrivateKey: row.encryptedPrivateKey as string | undefined,
          encryptedMnemonic: (row.encryptedMnemonic as string | null) ?? undefined,
          chain: row.chain as Chain,
        });

        // Decrypting successfully only proves the ciphertext matches the encryption
        // key — a ciphertext saved against the wrong row decrypts just as cleanly.
        // Comparing the derived address to the stored one is the only check that
        // catches it, and handing back the wrong private key is worse than failing.
        if (recovered.address && recovered.address !== row.address) {
          throw new APIError('INTERNAL_SERVER_ERROR', {
            message:
              'Recovered key does not match the address on record for this wallet. ' +
              'The stored key material is inconsistent — no key was returned.',
          });
        }

        // Audit first, and fail closed: an export that could not be recorded does not happen.
        try {
          await onExport({
            userId,
            walletId: ctx.body.walletId,
            address: String(row.address),
            chain: String(row.chain),
          });
        } catch {
          throw new APIError('INTERNAL_SERVER_ERROR', {
            message: 'The export could not be recorded, so no key was returned.',
          });
        }

        return ctx.json({
          address: row.address,
          chain: row.chain,
          privateKey: recovered.privateKey,
          mnemonic: recovered.mnemonic ?? null,
          warning:
            'Anyone with these values controls this wallet. Store them offline and never ' +
            'send them anywhere.',
        });
      } catch (error: unknown) {
        if (error instanceof APIError) throw error;
        throw new APIError('INTERNAL_SERVER_ERROR', {
          message:
            error instanceof Error
              ? error.message
              : 'Could not decrypt this wallet. Check the encryption key configuration.',
        });
      }
    },
  );
}
