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
 * 2. The plugin is typed by {@link LocktekClientPlugin}, not by inference and not by
 *    the bare `BetterAuthClientPlugin`. The bare interface widens the actions and
 *    erases every method. Inference names better-auth's internal `$fetch` type, which
 *    lives in `@better-fetch/fetch`, so the emitted declaration broke (TS2742) whenever
 *    better-auth moved to a different better-fetch. The explicit interface takes its
 *    parameters from better-auth's own exported type and spells out every result.
 * 3. There is no `$InferServerPlugin`. The actions call `$fetch` with explicit types,
 *    so it adds nothing here, and with better-auth 1.6.33 the widened server plugin
 *    type it carried collapsed the whole client's inference (`signIn` and `signUp`
 *    disappeared from the type).
 */
export { WALLET_EXPORT_ACKNOWLEDGEMENT } from './types.js';

/** What every action resolves to: better-auth's fetch result, stated without importing better-fetch. */
export type LocktekActionResult<T> = Promise<
  | { data: T; error: null }
  | { data: null; error: { message?: string; status: number; statusText: string } }
>;

export interface ExportWalletResponse {
  address: string;
  chain: string;
  privateKey?: string;
  mnemonic: string | null;
  warning: string;
}

/** Methods available as `authClient.locktek.*`. */
export interface LocktekClientActions {
  createWallet(
    data?: CreateWalletInput,
  ): LocktekActionResult<{ wallet: WalletResponse; created: boolean }>;
  getWallets(): LocktekActionResult<{ wallets: WalletResponse[] }>;
  getBalance(data: GetBalanceInput): LocktekActionResult<BalanceResponse>;
  /**
   * Only available when the server enables `walletExport`. The acknowledgement is the
   * caller's to send — typically from the person ticking a box — so this client never
   * supplies it on their behalf.
   */
  exportWallet(data: {
    walletId: string;
    acknowledgement: typeof WALLET_EXPORT_ACKNOWLEDGEMENT;
  }): LocktekActionResult<ExportWalletResponse>;
}

type GetActions = NonNullable<BetterAuthClientPlugin['getActions']>;

/**
 * Declares only what this plugin provides. Extending `BetterAuthClientPlugin` would
 * inherit its optional, widened `$InferServerPlugin`, which collapses the whole
 * client's inference — `signIn` and `signUp` vanish from the type. The literal below
 * is still checked against `BetterAuthClientPlugin` with `satisfies`.
 */
export interface LocktekClientPlugin {
  id: 'locktek';
  getActions: (...args: Parameters<GetActions>) => { locktek: LocktekClientActions };
  pathMethods: Record<string, 'GET' | 'POST'>;
}

export const locktekClient = (): LocktekClientPlugin =>
  ({
    id: 'locktek',
    getActions: ($fetch) => ({
      locktek: {
        createWallet: (data) =>
          $fetch('/locktek/create-wallet', { method: 'POST', body: data ?? {} }) as never,
        getWallets: () => $fetch('/locktek/wallets') as never,
        getBalance: (data) => $fetch('/locktek/balance', { method: 'POST', body: data }) as never,
        exportWallet: (data) =>
          $fetch('/locktek/export-wallet', { method: 'POST', body: data }) as never,
      },
    }),
    pathMethods: {
      '/locktek/wallets': 'GET',
      '/locktek/create-wallet': 'POST',
      '/locktek/balance': 'POST',
      '/locktek/export-wallet': 'POST',
    },
  }) satisfies BetterAuthClientPlugin & LocktekClientPlugin;
