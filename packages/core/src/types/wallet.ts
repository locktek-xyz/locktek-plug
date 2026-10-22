import type { Chain, ChainFamily } from './chain.js';

/** Core wallet data returned by wallet creation and import operations. */
export interface WalletData {
  readonly address: string;
  readonly publicKey: string;
  readonly encryptedPrivateKey?: string;
  readonly privateKey?: string;
  readonly chain: Chain;
  readonly chainFamily: ChainFamily;
  readonly derivationPath?: string;
}

export interface HDWalletData extends WalletData {
  readonly mnemonic?: string;
  readonly encryptedMnemonic?: string;
  readonly derivationPath: string;
}
