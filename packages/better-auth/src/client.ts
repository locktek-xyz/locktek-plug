import type { BetterAuthClientPlugin } from 'better-auth';
import type {
  CreateWalletInput,
  GetBalanceInput,
  WalletResponse,
  BalanceResponse,
  WALLET_EXPORT_ACKNOWLEDGEMENT,
} from './types.js';

/**
 * Client plugin exposing the Locktek endpoints as `authClient.locktek.*`.
 *
 * Two details matter and are easy to get wrong:
 *
 * 1. `getActions` returns a namespaced object. Whatever it returns is merged onto the
 *    client root, so a flat return would put `createWallet` next to `signIn` and
 *    collide with any other plugin that has the same idea.
 * 2. The return type is inferred, not annotated. Annotating it
 *    `: BetterAuthClientPlugin` widens the actions to the base interface and erases
 *    every method — the client still works at runtime while failing to typecheck,
 *    which is the worst of both. `satisfies` keeps the literal type and still checks
 *    the shape.
 * 3. There is no `$InferServerPlugin`. The actions call `$fetch` with explicit types,
 *    so it adds nothing here, and with better-auth 1.6.33 the widened server plugin
 *    type it carried collapsed the whole client's inference (`signIn` and `signUp`
 *    disappeared from the type).
 */
export { WALLET_EXPORT_ACKNOWLEDGEMENT } from './types.js';

export const locktekClient = () =>
  ({
    id: 'locktek',
    getActions: ($fetch) => ({
      locktek: {
        createWallet: async (data?: CreateWalletInput) =>
          $fetch<{ wallet: WalletResponse; created: boolean }>('/locktek/create-wallet', {
            method: 'POST',
            body: data ?? {},
          }),
        getWallets: async () => $fetch<{ wallets: WalletResponse[] }>('/locktek/wallets'),
        getBalance: async (data: GetBalanceInput) =>
          $fetch<BalanceResponse>('/locktek/balance', { method: 'POST', body: data }),
        /**
         * Only available when the server enables `walletExport`. The acknowledgement is
         * the caller's to send — typically from the person ticking a box — so this
         * client never supplies it on their behalf.
         */
        exportWallet: async (data: {
          walletId: string;
          acknowledgement: typeof WALLET_EXPORT_ACKNOWLEDGEMENT;
        }) =>
          $fetch<{
            address: string;
            chain: string;
            privateKey?: string;
            mnemonic: string | null;
            warning: string;
          }>('/locktek/export-wallet', { method: 'POST', body: data }),
      },
    }),
    pathMethods: {
      '/locktek/wallets': 'GET',
      '/locktek/create-wallet': 'POST',
      '/locktek/balance': 'POST',
      '/locktek/export-wallet': 'POST',
    },
  }) satisfies BetterAuthClientPlugin;
