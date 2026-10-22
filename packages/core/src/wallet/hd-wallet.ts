import type { Chain } from '../types/chain.js';
import type { HDWalletData } from '../types/wallet.js';
import { getChainFamily } from '../config/chains.js';
import { getDefaultDerivationPath } from './derivation.js';
import { LocktekError, ErrorCode } from '../types/common.js';

export interface CreateHDWalletOptions {
  readonly chain: Chain;
  readonly mnemonic?: string;
  readonly derivationPath?: string;
}

export async function createEVMWallet(options: CreateHDWalletOptions): Promise<HDWalletData> {
  const { ethers } = await import('ethers');

  const path = options.derivationPath ?? getDefaultDerivationPath(options.chain);

  let hdNode: ReturnType<typeof ethers.HDNodeWallet.fromMnemonic>;
  let mnemonic: string;

  if (options.mnemonic !== undefined) {
    try {
      const mnemonicObj = ethers.Mnemonic.fromPhrase(options.mnemonic);
      hdNode = ethers.HDNodeWallet.fromMnemonic(mnemonicObj, path);
      mnemonic = options.mnemonic;
    } catch (error) {
      if (error instanceof LocktekError) throw error;
      throw new LocktekError(
        'Invalid mnemonic phrase. Expected 12 or 24 BIP-39 English words separated by spaces',
        ErrorCode.INVALID_PRIVATE_KEY,
        error,
      );
    }
  } else {
    const wallet = ethers.Wallet.createRandom();
    if (!wallet.mnemonic) {
      throw new Error(
        'Failed to generate mnemonic for EVM wallet. This is an unexpected internal error — please report it.',
      );
    }
    mnemonic = wallet.mnemonic.phrase;
    hdNode = ethers.HDNodeWallet.fromMnemonic(wallet.mnemonic, path);
  }

  return {
    address: hdNode.address,
    publicKey: hdNode.publicKey,
    privateKey: hdNode.privateKey,
    mnemonic,
    chain: options.chain,
    chainFamily: 'evm',
    derivationPath: path,
  };
}

export async function createTronWallet(options: CreateHDWalletOptions): Promise<HDWalletData> {
  const { ethers } = await import('ethers');

  const evmPath = getDefaultDerivationPath(options.chain);
  const path = options.derivationPath ?? evmPath;

  let hdNode: ReturnType<typeof ethers.HDNodeWallet.fromMnemonic>;
  let mnemonic: string;

  if (options.mnemonic !== undefined) {
    try {
      const mnemonicObj = ethers.Mnemonic.fromPhrase(options.mnemonic);
      hdNode = ethers.HDNodeWallet.fromMnemonic(mnemonicObj, path);
      mnemonic = options.mnemonic;
    } catch (error) {
      if (error instanceof LocktekError) throw error;
      throw new LocktekError(
        'Invalid mnemonic phrase. Expected 12 or 24 BIP-39 English words separated by spaces',
        ErrorCode.INVALID_PRIVATE_KEY,
        error,
      );
    }
  } else {
    const wallet = ethers.Wallet.createRandom();
    if (!wallet.mnemonic) {
      throw new Error(
        'Failed to generate mnemonic for Tron wallet. This is an unexpected internal error — please report it.',
      );
    }
    mnemonic = wallet.mnemonic.phrase;
    hdNode = ethers.HDNodeWallet.fromMnemonic(wallet.mnemonic, path);
  }

  // Tron address: take the EVM address, strip 0x, prepend 41, base58check encode
  const { TronAddress } = await import('../utils/tron-address.js');
  const tronAddress = TronAddress.fromEvmAddress(hdNode.address);

  return {
    address: tronAddress,
    publicKey: hdNode.publicKey,
    privateKey: hdNode.privateKey,
    mnemonic,
    chain: options.chain,
    chainFamily: 'tron',
    derivationPath: path,
  };
}

export async function createHDWallet(options: CreateHDWalletOptions): Promise<HDWalletData> {
  const family = getChainFamily(options.chain);
  if (family === 'tron') {
    return createTronWallet(options);
  }
  return createEVMWallet(options);
}
