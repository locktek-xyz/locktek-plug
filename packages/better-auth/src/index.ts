export { locktekPlugin } from './plugin.js';

export { WALLET_EXPORT_ACKNOWLEDGEMENT } from './types.js';
export type {
  LocktekPluginOptions,
  WalletCreationErrorPolicy,
  WalletExportEvent,
  WalletExportOptions,
} from './types.js';
export type {
  LocktekWalletRecord,
  CreateWalletInput,
  GetBalanceInput,
  WalletResponse,
  BalanceResponse,
} from './types.js';
export type { LocktekWalletSchema } from './schema.js';
export { locktekWalletSchema, walletKeyFor } from './schema.js';
export { provisionWallet, resolveAutoChains, toResponse } from './provisioning.js';
export type { WalletAdapter, ProvisionResult } from './provisioning.js';
