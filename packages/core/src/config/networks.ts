import type { Chain, NetworkConfig } from '../types/chain.js';
import { LocktekError, ErrorCode } from '../types/common.js';

export const NETWORK_CONFIGS: Readonly<Record<Chain, NetworkConfig>> = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
    chainFamily: 'evm',
    rpcUrls: [
      'https://ethereum.publicnode.com',
      'https://rpc.ankr.com/eth',
      'https://cloudflare-eth.com',
    ],
    explorerUrl: 'https://etherscan.io',
    isTestnet: false,
    features: { eip1559: true, tokenStandards: ['ERC20', 'ERC721', 'ERC1155'] },
  },
  'ethereum-sepolia': {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    symbol: 'ETH',
    decimals: 18,
    chainFamily: 'evm',
    rpcUrls: [
      'https://ethereum-sepolia.publicnode.com',
      'https://rpc.sepolia.org',
      'https://rpc.ankr.com/eth_sepolia',
    ],
    explorerUrl: 'https://sepolia.etherscan.io',
    isTestnet: true,
    features: { eip1559: true, tokenStandards: ['ERC20', 'ERC721', 'ERC1155'] },
  },

  base: {
    chainId: 8453,
    name: 'Base',
    symbol: 'ETH',
    decimals: 18,
    chainFamily: 'evm',
    rpcUrls: [
      'https://mainnet.base.org',
      'https://base.publicnode.com',
      'https://rpc.ankr.com/base',
    ],
    explorerUrl: 'https://basescan.org',
    isTestnet: false,
    features: { eip1559: true, tokenStandards: ['ERC20', 'ERC721', 'ERC1155'] },
  },
  'base-sepolia': {
    chainId: 84532,
    name: 'Base Sepolia',
    symbol: 'ETH',
    decimals: 18,
    chainFamily: 'evm',
    rpcUrls: ['https://sepolia.base.org', 'https://base-sepolia.publicnode.com'],
    explorerUrl: 'https://sepolia.basescan.org',
    isTestnet: true,
    features: { eip1559: true, tokenStandards: ['ERC20', 'ERC721', 'ERC1155'] },
  },

  polygon: {
    chainId: 137,
    name: 'Polygon',
    symbol: 'MATIC',
    decimals: 18,
    chainFamily: 'evm',
    rpcUrls: [
      'https://polygon-bor.publicnode.com',
      'https://polygon-rpc.com',
      'https://rpc.ankr.com/polygon',
    ],
    explorerUrl: 'https://polygonscan.com',
    isTestnet: false,
    features: { eip1559: true, tokenStandards: ['ERC20', 'ERC721', 'ERC1155'] },
  },
  'polygon-amoy': {
    chainId: 80002,
    name: 'Polygon Amoy',
    symbol: 'MATIC',
    decimals: 18,
    chainFamily: 'evm',
    rpcUrls: ['https://rpc-amoy.polygon.technology', 'https://polygon-amoy.drpc.org'],
    explorerUrl: 'https://amoy.polygonscan.com',
    isTestnet: true,
    features: { eip1559: true, tokenStandards: ['ERC20', 'ERC721', 'ERC1155'] },
  },

  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum One',
    symbol: 'ETH',
    decimals: 18,
    chainFamily: 'evm',
    rpcUrls: [
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum-one.publicnode.com',
      'https://rpc.ankr.com/arbitrum',
    ],
    explorerUrl: 'https://arbiscan.io',
    isTestnet: false,
    features: { eip1559: true, tokenStandards: ['ERC20', 'ERC721', 'ERC1155'] },
  },
  'arbitrum-sepolia': {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    symbol: 'ETH',
    decimals: 18,
    chainFamily: 'evm',
    rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc', 'https://arbitrum-sepolia.publicnode.com'],
    explorerUrl: 'https://sepolia.arbiscan.io',
    isTestnet: true,
    features: { eip1559: true, tokenStandards: ['ERC20', 'ERC721', 'ERC1155'] },
  },

  bsc: {
    chainId: 56,
    name: 'BNB Smart Chain',
    symbol: 'BNB',
    decimals: 18,
    chainFamily: 'evm',
    rpcUrls: [
      'https://bsc-dataseed1.binance.org',
      'https://bsc-dataseed2.binance.org',
      'https://rpc.ankr.com/bsc',
    ],
    explorerUrl: 'https://bscscan.com',
    isTestnet: false,
    features: { eip1559: false, tokenStandards: ['BEP20', 'ERC721', 'ERC1155'] },
  },
  'bsc-testnet': {
    chainId: 97,
    name: 'BSC Testnet',
    symbol: 'BNB',
    decimals: 18,
    chainFamily: 'evm',
    rpcUrls: [
      'https://data-seed-prebsc-1-s1.binance.org:8545',
      'https://data-seed-prebsc-2-s1.binance.org:8545',
    ],
    explorerUrl: 'https://testnet.bscscan.com',
    isTestnet: true,
    features: { eip1559: false, tokenStandards: ['BEP20', 'ERC721', 'ERC1155'] },
  },

  tron: {
    chainId: 'mainnet',
    name: 'Tron',
    symbol: 'TRX',
    decimals: 6,
    chainFamily: 'tron',
    rpcUrls: [
      'https://api.trongrid.io',
      'https://api.tronstack.io',
      'https://rpc.ankr.com/tron_jsonrpc',
    ],
    explorerUrl: 'https://tronscan.org',
    isTestnet: false,
    features: { tokenStandards: ['TRC20', 'TRC721'] },
  },
  'tron-shasta': {
    chainId: 'shasta',
    name: 'Tron Shasta',
    symbol: 'TRX',
    decimals: 6,
    chainFamily: 'tron',
    rpcUrls: ['https://api.shasta.trongrid.io', 'https://api.shasta.tronstack.io'],
    explorerUrl: 'https://shasta.tronscan.org',
    isTestnet: true,
    features: { tokenStandards: ['TRC20', 'TRC721'] },
  },
};

/** Networks added at runtime via `registerChain`. */
const customNetworks = new Map<string, NetworkConfig>();

/** Register a network for a chain the SDK does not ship. Used by `registerChain`. */
export function registerNetworkConfig(chain: string, config: NetworkConfig): void {
  if (!config.rpcUrls?.length) {
    throw new LocktekError(
      `Network config for "${chain}" must list at least one RPC URL.`,
      ErrorCode.INVALID_CONFIG,
    );
  }
  customNetworks.set(chain, config);
}

export function getNetworkConfig(chain: Chain): NetworkConfig {
  const config = NETWORK_CONFIGS[chain] ?? customNetworks.get(chain);

  if (!config) {
    throw new LocktekError(
      `No network configuration for chain "${chain}". Register it with registerChain() first.`,
      ErrorCode.INVALID_CHAIN,
    );
  }

  return config;
}
