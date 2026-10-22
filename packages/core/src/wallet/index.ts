export { createHDWallet, createEVMWallet, createTronWallet } from './hd-wallet.js';
export type { CreateHDWalletOptions } from './hd-wallet.js';

export {
  BIP44CoinType,
  getDefaultDerivationPath,
  buildDerivationPath,
  getCoinType,
  parseDerivationPath,
  validateDerivationPath,
} from './derivation.js';
export type { DerivationOptions } from './derivation.js';
