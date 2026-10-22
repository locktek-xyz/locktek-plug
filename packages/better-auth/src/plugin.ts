import type { BetterAuthPlugin } from 'better-auth';
import { Locktek } from '@locktek/core';
import type { Chain } from '@locktek/core';
import type { LocktekPluginOptions } from './types.js';
import { locktekWalletSchema } from './schema.js';
import {
  createWalletEndpoint,
  getWalletsEndpoint,
  getBalanceEndpoint,
  exportWalletEndpoint,
} from './endpoints/index.js';
import { provisionWallet, resolveAutoChains, type WalletAdapter } from './provisioning.js';

export function locktekPlugin(options?: LocktekPluginOptions): BetterAuthPlugin {
  const resolved = {
    chains: options?.chains ?? ['ethereum-sepolia'],
    defaultChain: options?.defaultChain,
    encryptionKey: options?.encryptionKey,
    rpc: options?.rpc,
    testnet: options?.testnet ?? true,
    policy: options?.policy,
  };

  const locktek = new Locktek(resolved);
  const hasEncryption = Boolean(resolved.encryptionKey);

  const autoChains = resolveAutoChains(options?.autoCreateWallet, locktek.defaultChain);
  const errorPolicy = options?.onWalletCreationError ?? 'fail';
  const walletExport = options?.walletExport;

  if (walletExport?.enabled && typeof walletExport.onExport !== 'function') {
    throw new Error(
      'locktekPlugin: walletExport.enabled requires walletExport.onExport, so that every ' +
        'export of a private key is recorded.',
    );
  }

  // Fail at startup rather than on every signup request.
  if (autoChains.length > 0 && !hasEncryption) {
    throw new Error(
      'locktekPlugin: autoCreateWallet requires encryptionKey. Without it a wallet cannot be ' +
        'stored securely, so every signup would fail at runtime instead of here.',
    );
  }

  const plugin: BetterAuthPlugin = {
    id: 'locktek',
    schema: locktekWalletSchema,
    endpoints: {
      createWallet: createWalletEndpoint(locktek, hasEncryption),
      getWallets: getWalletsEndpoint(),
      getBalance: getBalanceEndpoint(locktek),
      // Returning private keys over HTTP is opt-in, never a default.
      ...(walletExport?.enabled
        ? { exportWallet: exportWalletEndpoint(locktek, walletExport.onExport) }
        : {}),
    },
  };

  if (autoChains.length === 0) return plugin;

  return {
    ...plugin,
    /**
     * Register the signup hook.
     *
     * A plugin cannot declare `databaseHooks` directly; it contributes them through
     * `init`. better-auth runs these alongside the application's own hooks, so this
     * returns only the plugin's hook — calling the application's hooks from here would
     * run each of them twice.
     *
     * Provisioning here, rather than as a client call after signup, means a closed tab
     * cannot skip it. better-auth runs `create.after` once the user row is committed,
     * though, so with `'fail'` a provisioning error fails the signup request but the
     * user row remains: reconcile users without a wallet (e.g. call createWallet on
     * their next sign-in).
     */
    init: (ctx) => {
      return {
        options: {
          databaseHooks: {
            user: {
              create: {
                after: async (user, hookContext) => {
                  await provisionForUser(user.id, hookContext);
                },
              },
            },
          },
        },
      };

      async function provisionForUser(userId: string, hookContext: unknown): Promise<void> {
        const adapter =
          (hookContext as { context?: { adapter?: WalletAdapter } } | null)?.context?.adapter ??
          (ctx.adapter as unknown as WalletAdapter | undefined);

        if (!adapter) {
          if (errorPolicy === 'fail') {
            throw new Error(
              'locktekPlugin: no database adapter available during signup, so a wallet could ' +
                'not be provisioned.',
            );
          }
          return;
        }

        for (const chain of autoChains) {
          try {
            // Idempotent: a replayed hook returns the existing wallet rather than
            // provisioning a second one.
            await provisionWallet(locktek, adapter, userId, chain as Chain);
          } catch (error: unknown) {
            if (errorPolicy === 'fail') throw error;
            // 'continue' was chosen explicitly: signup proceeds without a wallet and
            // the application reconciles it later.
          }
        }
      }
    },
  };
}
