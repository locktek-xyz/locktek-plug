import type { TransactionPolicy } from '@locktek/core';

/** What to do when automatic wallet provisioning fails during signup. */
export type WalletCreationErrorPolicy = 'fail' | 'continue';

/** The text a caller must send, verbatim, to export a wallet's key material. */
export const WALLET_EXPORT_ACKNOWLEDGEMENT = 'I understand this reveals my private key';

/** Recorded for every wallet export, before any key material is returned. */
export interface WalletExportEvent {
  readonly userId: string;
  readonly walletId: string;
  readonly address: string;
  readonly chain: string;
}

export interface WalletExportOptions {
  /** Expose `POST /locktek/export-wallet`. Off unless this is `true`. */
  readonly enabled: boolean;
  /**
   * Record the export somewhere you can review (audit log, alerting). Required when
   * enabled. It is awaited before the key is returned: if it throws, nothing is returned.
   */
  readonly onExport: (event: WalletExportEvent) => void | Promise<void>;
}

export interface LocktekPluginOptions {
  readonly chains?: string[];
  readonly defaultChain?: string;
  readonly encryptionKey?: string;
  readonly rpc?: Record<string, string>;
  readonly testnet?: boolean;
  /**
   * Provision a wallet automatically when a user signs up.
   *
   * Pass `true` for the default chain, or a list of chains for one wallet each.
   * Provisioning is idempotent, so a retried or duplicated signup hook cannot create
   * a second wallet for the same user and chain.
   */
  readonly autoCreateWallet?: boolean | string[];
  /**
   * What happens when provisioning fails during signup.
   *
   * `'fail'` (the default) surfaces the error, so a user is never left in a state the
   * application cannot detect. `'continue'` lets signup succeed without a wallet —
   * choose it only if your application reconciles missing wallets later.
   */
  readonly onWalletCreationError?: WalletCreationErrorPolicy;
  /** Spend caps and recipient rules applied to any transfer made through this plugin. */
  readonly policy?: TransactionPolicy;
  /**
   * Let users export their wallet's decrypted private key and mnemonic. Disabled by
   * default. When enabled, the endpoint requires a fresh session (better-auth
   * `session.freshAge`), the acknowledgement text, wallet ownership, and a successful
   * `onExport` audit call.
   */
  readonly walletExport?: WalletExportOptions;
}

export interface LocktekWalletRecord {
  readonly id: string;
  readonly userId: string;
  readonly walletKey: string;
  readonly address: string;
  readonly chain: string;
  readonly chainFamily: string;
  readonly publicKey: string;
  readonly encryptedPrivateKey: string;
  readonly encryptedMnemonic: string | null;
  readonly label: string | null;
  readonly createdAt: Date;
}

export interface CreateWalletInput {
  readonly chain?: string;
  readonly label?: string;
}

export interface GetBalanceInput {
  readonly address: string;
  readonly chain?: string;
}

export interface WalletResponse {
  readonly id: string;
  readonly userId: string;
  readonly address: string;
  readonly chain: string;
  readonly chainFamily: string;
  readonly publicKey: string;
  readonly label: string | null;
  readonly createdAt: Date;
}

export interface BalanceResponse {
  readonly address: string;
  readonly chain: string;
  readonly balance: string;
  readonly balanceFormatted: string;
  readonly decimals: number;
  readonly symbol: string;
}
