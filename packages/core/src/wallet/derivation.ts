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

// BIP-32 indices are 31 bits; the top bit is what marks an index as hardened.
const MAX_INDEX = 0x7fffffff;
const HARDENED_SEGMENT = /^(\d+)'$/;
const NORMAL_SEGMENT = /^(\d+)$/;

function invalidPath(path: string): LocktekError {
  return new LocktekError(
    `Invalid derivation path: "${path}". Expected BIP-44 format: m/purpose'/coinType'/account'/change/addressIndex, with whole-number indices below 2^31 (e.g. m/44'/60'/0'/0/0).`,
    ErrorCode.INVALID_CONFIG,
  );
}

// The whole segment must match: parseInt would read "0x10" as 0 and "4'4" as 4, so a
// path the signer rejects, or derives differently, would pass as valid.
function parseIndex(segment: string, hardened: boolean, path: string): number {
  const match = (hardened ? HARDENED_SEGMENT : NORMAL_SEGMENT).exec(segment);
  const index = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(index) || index > MAX_INDEX) throw invalidPath(path);
  return index;
}

export function parseDerivationPath(path: string): {
  purpose: number;
  coinType: number;
  account: number;
  change: number;
  addressIndex: number;
} {
  const parts = path.split('/');
  if (parts[0] !== 'm' || parts.length !== 6) throw invalidPath(path);
  const [, purpose, coinType, account, change, addressIndex] = parts;

  return {
    purpose: parseIndex(purpose, true, path),
    coinType: parseIndex(coinType, true, path),
    account: parseIndex(account, true, path),
    change: parseIndex(change, false, path),
    addressIndex: parseIndex(addressIndex, false, path),
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
