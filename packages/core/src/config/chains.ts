import type { Chain, ChainFamily, ChainConfig } from '../types/chain.js';

export const CHAIN_FAMILIES: Record<Chain, ChainFamily> = {
  ethereum: 'evm',
  'ethereum-sepolia': 'evm',
  base: 'evm',
  'base-sepolia': 'evm',
  polygon: 'evm',
  'polygon-amoy': 'evm',
  arbitrum: 'evm',
  'arbitrum-sepolia': 'evm',
  bsc: 'evm',
  'bsc-testnet': 'evm',
  tron: 'tron',
  'tron-shasta': 'tron',
};

export const TESTNET_CHAINS: ReadonlySet<Chain> = new Set([
  'ethereum-sepolia',
  'base-sepolia',
  'polygon-amoy',
  'arbitrum-sepolia',
  'bsc-testnet',
  'tron-shasta',
]);

export const MAINNET_TO_TESTNET: Readonly<Record<string, Chain>> = {
  ethereum: 'ethereum-sepolia',
  base: 'base-sepolia',
  polygon: 'polygon-amoy',
  arbitrum: 'arbitrum-sepolia',
  bsc: 'bsc-testnet',
  tron: 'tron-shasta',
};

export const TESTNET_TO_MAINNET: Readonly<Record<string, Chain>> = {
  'ethereum-sepolia': 'ethereum',
  'base-sepolia': 'base',
  'polygon-amoy': 'polygon',
  'arbitrum-sepolia': 'arbitrum',
  'bsc-testnet': 'bsc',
  'tron-shasta': 'tron',
};

export const CHAIN_CONFIGS: readonly ChainConfig[] = [
  { chain: 'ethereum', mainnet: 'ethereum', testnet: 'ethereum-sepolia', family: 'evm' },
  { chain: 'base', mainnet: 'base', testnet: 'base-sepolia', family: 'evm' },
  { chain: 'polygon', mainnet: 'polygon', testnet: 'polygon-amoy', family: 'evm' },
  { chain: 'arbitrum', mainnet: 'arbitrum', testnet: 'arbitrum-sepolia', family: 'evm' },
  { chain: 'bsc', mainnet: 'bsc', testnet: 'bsc-testnet', family: 'evm' },
  { chain: 'tron', mainnet: 'tron', testnet: 'tron-shasta', family: 'tron' },
];

export const ALL_CHAINS: readonly Chain[] = Object.keys(CHAIN_FAMILIES) as Chain[];

export function isValidChain(value: string): value is Chain {
  return value in CHAIN_FAMILIES;
}

export function getChainFamily(chain: Chain): ChainFamily {
  return CHAIN_FAMILIES[chain] ?? customChainFamilies.get(chain);
}

export function isTestnet(chain: Chain): boolean {
  return TESTNET_CHAINS.has(chain);
}

export function getTestnetChain(mainnetChain: Chain): Chain | undefined {
  return MAINNET_TO_TESTNET[mainnetChain] as Chain | undefined;
}

export function getMainnetChain(testnetChain: Chain): Chain | undefined {
  return TESTNET_TO_MAINNET[testnetChain] as Chain | undefined;
}

/**
 * Chains added at runtime via `registerChain`.
 *
 * Kept here rather than in the adapter factory so config validation can accept a
 * custom chain without importing the factory, which would form a cycle.
 */
const customChainFamilies = new Map<string, ChainFamily>();

export function registerCustomChain(chain: string, family: ChainFamily): void {
  customChainFamilies.set(chain, family);
}

export function unregisterCustomChain(chain: string): void {
  customChainFamilies.delete(chain);
}

/** True for a built-in chain or one added via `registerChain`. */
export function isRegisteredChain(value: string): boolean {
  return isValidChain(value) || customChainFamilies.has(value);
}

/** Every chain identifier currently usable, built-in and custom. */
export function listRegisteredChains(): readonly string[] {
  return [...ALL_CHAINS, ...customChainFamilies.keys()];
}
