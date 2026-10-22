import type { Chain } from '../types/chain.js';
import { LocktekError, ErrorCode } from '../types/common.js';
import { formatNativeAmount, parseNativeAmount } from '../utils/format.js';

export type StablecoinAsset = 'USDC' | 'USDT';

/**
 * Well-known stablecoin contract addresses.
 *
 * Testnets are included deliberately: the SDK defaults to testnet, so omitting them
 * would mean the default configuration could not exercise a token transfer at all.
 */
export const STABLECOIN_ADDRESSES: Readonly<
  Partial<Record<Chain, Readonly<Partial<Record<StablecoinAsset, string>>>>>
> = {
  ethereum: {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  'ethereum-sepolia': {
    USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  },
  polygon: {
    USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
  'polygon-amoy': {
    USDC: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
  },
  arbitrum: {
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  'arbitrum-sepolia': {
    USDC: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  },
  base: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  'base-sepolia': {
    USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },
  bsc: {
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
  },
  'bsc-testnet': {
    USDT: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
  },
  tron: {
    USDC: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8',
    USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  },
  'tron-shasta': {
    USDT: 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
  },
};

/**
 * Conventional decimals for these assets.
 *
 * This is a convenience for offline formatting only. Anything that moves value reads
 * `decimals()` from the contract instead, via `Locktek.getTokenDecimals`, because a
 * hardcoded value that disagrees with the chain mis-scales a transfer silently.
 */
export const TOKEN_DECIMALS: Readonly<Record<StablecoinAsset, number>> = {
  USDC: 6,
  USDT: 6,
};

export function getStablecoinAddress(chain: Chain, asset: StablecoinAsset): string | undefined {
  return STABLECOIN_ADDRESSES[chain]?.[asset];
}

export function formatTokenAmount(amount: string | bigint, asset: StablecoinAsset): string {
  return formatNativeAmount(amount, TOKEN_DECIMALS[asset]);
}

export function parseTokenAmount(amount: string, asset: StablecoinAsset): bigint {
  try {
    return parseNativeAmount(amount, TOKEN_DECIMALS[asset]);
  } catch (error: unknown) {
    if (error instanceof LocktekError) throw error;
    throw new LocktekError(
      `Invalid ${asset} amount: "${amount}".`,
      ErrorCode.INVALID_AMOUNT,
      error,
    );
  }
}
