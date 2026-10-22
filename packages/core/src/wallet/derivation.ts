import type { Chain } from '../types/chain.js';
import { LocktekError, ErrorCode } from '../types/common.js';

export enum BIP44CoinType {
  ETHEREUM = 60,
  TRON = 195,
}

const CHAIN_COIN_TYPES: Readonly<Record<string, BIP44CoinType>> = {
  ethereum: BIP44CoinType.ETHEREUM,
  'ethereum-sepolia': BIP44CoinType.ETHEREUM,
  base: BIP44CoinType.ETHEREUM,
  'base-sepolia': BIP44CoinType.ETHEREUM,
  polygon: BIP44CoinType.ETHEREUM,
  'polygon-amoy': BIP44CoinType.ETHEREUM,
  arbitrum: BIP44CoinType.ETHEREUM,
  'arbitrum-sepolia': BIP44CoinType.ETHEREUM,
  bsc: BIP44CoinType.ETHEREUM,
  'bsc-testnet': BIP44CoinType.ETHEREUM,
  tron: BIP44CoinType.TRON,
  'tron-shasta': BIP44CoinType.TRON,
};

const DEFAULT_DERIVATION_PATHS: Readonly<Record<string, string>> = {
  ethereum: "m/44'/60'/0'/0/0",
  'ethereum-sepolia': "m/44'/60'/0'/0/0",
  base: "m/44'/60'/0'/0/0",
  'base-sepolia': "m/44'/60'/0'/0/0",
  polygon: "m/44'/60'/0'/0/0",
  'polygon-amoy': "m/44'/60'/0'/0/0",
  arbitrum: "m/44'/60'/0'/0/0",
  'arbitrum-sepolia': "m/44'/60'/0'/0/0",
  bsc: "m/44'/60'/0'/0/0",
  'bsc-testnet': "m/44'/60'/0'/0/0",
  tron: "m/44'/195'/0'/0/0",
  'tron-shasta': "m/44'/195'/0'/0/0",
};

export interface DerivationOptions {
  readonly account?: number;
  readonly change?: number;
  readonly addressIndex?: number;
}

export function getDefaultDerivationPath(chain: Chain): string {
  const path = DEFAULT_DERIVATION_PATHS[chain];
  if (!path) {
    throw new LocktekError(
      `No derivation path for chain: "${chain}". Supported chains: ${Object.keys(DEFAULT_DERIVATION_PATHS).join(', ')}`,
      ErrorCode.INVALID_CHAIN,
    );
  }
  return path;
}

export function buildDerivationPath(chain: Chain, options: DerivationOptions = {}): string {
  const { account = 0, change = 0, addressIndex = 0 } = options;

  const coinType = CHAIN_COIN_TYPES[chain];
  if (coinType === undefined) {
    throw new LocktekError(
      `Unsupported chain for derivation: "${chain}". Supported chains: ${Object.keys(CHAIN_COIN_TYPES).join(', ')}`,
      ErrorCode.INVALID_CHAIN,
    );
  }

  return `m/44'/${coinType}'/${account}'/${change}/${addressIndex}`;
}

export function getCoinType(chain: Chain): BIP44CoinType {
  const coinType = CHAIN_COIN_TYPES[chain];
  if (coinType === undefined) {
    throw new LocktekError(
      `Unsupported chain: "${chain}". Supported chains: ${Object.keys(CHAIN_COIN_TYPES).join(', ')}`,
      ErrorCode.INVALID_CHAIN,
    );
  }
  return coinType;
}

export function parseDerivationPath(path: string): {
  purpose: number;
  coinType: number;
  account: number;
  change: number;
  addressIndex: number;
} {
  const parts = path.split('/');
  if (parts[0] !== 'm' || parts.length !== 6) {
    throw new LocktekError(
      `Invalid derivation path: "${path}". Expected BIP-44 format: m/purpose'/coinType'/account'/change/addressIndex (e.g. m/44'/60'/0'/0/0).`,
      ErrorCode.INVALID_CONFIG,
    );
  }

  return {
    purpose: parseInt(parts[1].replace("'", '')),
    coinType: parseInt(parts[2].replace("'", '')),
    account: parseInt(parts[3].replace("'", '')),
    change: parseInt(parts[4]),
    addressIndex: parseInt(parts[5]),
  };
}

export function validateDerivationPath(path: string): boolean {
  try {
    parseDerivationPath(path);
    return true;
  } catch {
    return false;
  }
}
