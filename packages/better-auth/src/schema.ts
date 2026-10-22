import type { BetterAuthPluginDBSchema } from 'better-auth/db';

export const locktekWalletSchema = {
  locktekWallet: {
    fields: {
      userId: {
        type: 'string',
        required: true,
        references: {
          model: 'user',
          field: 'id',
          // Cascade keeps the table consistent when a user is removed. Anything
          // holding value should be exported first — see `exportWallet`.
          onDelete: 'cascade',
        },
        index: true,
      },
      /**
       * `${userId}:${chain}` with a unique constraint.
       *
       * This is what actually prevents duplicate wallets. An application-level
       * "does one exist?" check loses the race between two concurrent requests;
       * a unique index does not.
       */
      walletKey: {
        type: 'string',
        required: true,
        unique: true,
      },
      address: {
        type: 'string',
        required: true,
        index: true,
      },
      chain: {
        type: 'string',
        required: true,
      },
      chainFamily: {
        type: 'string',
        required: true,
      },
      publicKey: {
        type: 'string',
        required: true,
      },
      encryptedPrivateKey: {
        type: 'string',
        required: true,
        returned: false,
      },
      /**
       * The encrypted BIP-39 mnemonic.
       *
       * Persisted because it is the only thing that makes a wallet recoverable in a
       * standard wallet application. Without it, losing the private-key ciphertext
       * makes any funds at this address permanently unreachable.
       */
      encryptedMnemonic: {
        type: 'string',
        required: false,
        returned: false,
      },
      label: {
        type: 'string',
        required: false,
      },
      createdAt: {
        type: 'date',
        required: true,
      },
    },
  },
} as const satisfies BetterAuthPluginDBSchema;

export type LocktekWalletSchema = typeof locktekWalletSchema;

/** Composite identity for a user's wallet on one chain. */
export function walletKeyFor(userId: string, chain: string): string {
  return `${userId}:${chain}`;
}
