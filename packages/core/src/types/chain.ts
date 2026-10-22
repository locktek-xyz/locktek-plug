/** Supported blockchain network identifier. */
export type Chain =
  | 'ethereum'
  | 'ethereum-sepolia'
  | 'base'
  | 'base-sepolia'
  | 'polygon'
  | 'polygon-amoy'
  | 'arbitrum'
  | 'arbitrum-sepolia'
  | 'bsc'
  | 'bsc-testnet'
  | 'tron'
  | 'tron-shasta';

export type EvmChain = Exclude<Chain, 'tron' | 'tron-shasta'>;
export type TronChain = Extract<Chain, 'tron' | 'tron-shasta'>;
/** High-level chain family grouping: EVM-compatible or Tron. */
export type ChainFamily = 'evm' | 'tron';

export interface NetworkConfig {
  readonly chainId: number | string;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly chainFamily: ChainFamily;
  readonly rpcUrls: readonly string[];
  readonly explorerUrl: string;
  readonly isTestnet: boolean;
  readonly features?: {
    readonly eip1559?: boolean;
    readonly tokenStandards?: readonly string[];
  };
}

export interface ChainConfig {
  readonly chain: Chain;
  readonly mainnet: Chain;
  readonly testnet: Chain;
  readonly family: ChainFamily;
}
