import { describe, it, expect } from 'vitest';
import { locktekConfigSchema } from '../config/schema.js';
import {
  ALL_CHAINS,
  CHAIN_FAMILIES,
  isValidChain,
  getChainFamily,
  isTestnet,
  getTestnetChain,
  getMainnetChain,
} from '../config/chains.js';
import { getNetworkConfig } from '../config/networks.js';
import { getDefaultRpcUrl, getAllRpcUrls } from '../config/rpc-defaults.js';
import { getStablecoinAddress } from '../config/tokens.js';

describe('config schema', () => {
  it('parses minimal config', () => {
    const result = locktekConfigSchema.parse({
      chains: ['ethereum-sepolia'],
    });
    expect(result.chains).toEqual(['ethereum-sepolia']);
    expect(result.defaultChain).toBe('ethereum-sepolia');
    expect(result.testnet).toBe(true);
  });

  it('parses full config', () => {
    const result = locktekConfigSchema.parse({
      chains: ['ethereum-sepolia', 'base-sepolia'],
      defaultChain: 'base-sepolia',
      encryptionKey: 'my-long-secret-key-here',
      rpc: { 'ethereum-sepolia': 'https://custom.example.com' },
      testnet: false,
    });
    expect(result.defaultChain).toBe('base-sepolia');
    expect(result.testnet).toBe(false);
  });

  it('rejects empty chains', () => {
    expect(() => locktekConfigSchema.parse({ chains: [] })).toThrow();
  });

  it('rejects invalid chain names', () => {
    expect(() => locktekConfigSchema.parse({ chains: ['solana'] })).toThrow('Invalid chain');
  });

  it('rejects short encryption key', () => {
    expect(() =>
      locktekConfigSchema.parse({
        chains: ['ethereum-sepolia'],
        encryptionKey: 'short',
      }),
    ).toThrow();
  });

  it('rejects invalid RPC URL', () => {
    expect(() =>
      locktekConfigSchema.parse({
        chains: ['ethereum-sepolia'],
        rpc: { 'ethereum-sepolia': 'not-a-url' },
      }),
    ).toThrow();
  });

  it('rejects defaultChain not in chains array', () => {
    expect(() =>
      locktekConfigSchema.parse({
        chains: ['ethereum-sepolia'],
        defaultChain: 'base-sepolia',
      }),
    ).toThrow("defaultChain 'base-sepolia' must be one of the configured chains: ethereum-sepolia");
  });

  it('accepts defaultChain that IS in chains array', () => {
    const result = locktekConfigSchema.parse({
      chains: ['ethereum-sepolia', 'base-sepolia'],
      defaultChain: 'base-sepolia',
    });
    expect(result.defaultChain).toBe('base-sepolia');
  });

  it('accepts config without defaultChain (falls back to the only chain)', () => {
    const result = locktekConfigSchema.parse({
      chains: ['ethereum-sepolia'],
    });
    expect(result.defaultChain).toBe('ethereum-sepolia');
  });
});

describe('chain helpers', () => {
  it('ALL_CHAINS has 12 entries', () => {
    expect(ALL_CHAINS).toHaveLength(12);
  });

  it('isValidChain accepts all known chains', () => {
    for (const chain of ALL_CHAINS) {
      expect(isValidChain(chain)).toBe(true);
    }
  });

  it('isValidChain rejects unknown chains', () => {
    expect(isValidChain('solana')).toBe(false);
    expect(isValidChain('')).toBe(false);
  });

  it('getChainFamily returns evm for EVM chains', () => {
    expect(getChainFamily('ethereum')).toBe('evm');
    expect(getChainFamily('base-sepolia')).toBe('evm');
  });

  it('getChainFamily returns tron for Tron chains', () => {
    expect(getChainFamily('tron')).toBe('tron');
    expect(getChainFamily('tron-shasta')).toBe('tron');
  });

  it('isTestnet identifies testnets', () => {
    expect(isTestnet('ethereum-sepolia')).toBe(true);
    expect(isTestnet('ethereum')).toBe(false);
    expect(isTestnet('tron-shasta')).toBe(true);
    expect(isTestnet('tron')).toBe(false);
  });

  it('mainnet ↔ testnet mapping', () => {
    expect(getTestnetChain('ethereum')).toBe('ethereum-sepolia');
    expect(getMainnetChain('ethereum-sepolia')).toBe('ethereum');
    expect(getTestnetChain('tron')).toBe('tron-shasta');
    expect(getMainnetChain('tron-shasta')).toBe('tron');
  });

  it('returns undefined for invalid mapping', () => {
    expect(getTestnetChain('ethereum-sepolia')).toBeUndefined();
    expect(getMainnetChain('ethereum')).toBeUndefined();
  });
});

describe('network configs', () => {
  it('has config for every chain', () => {
    for (const chain of ALL_CHAINS) {
      const config = getNetworkConfig(chain);
      expect(config).toBeDefined();
      expect(config.name).toBeTruthy();
      expect(config.symbol).toBeTruthy();
      expect(config.rpcUrls.length).toBeGreaterThan(0);
    }
  });

  it('EVM chains have numeric chainId', () => {
    const evmChains = ALL_CHAINS.filter((c) => CHAIN_FAMILIES[c] === 'evm');
    for (const chain of evmChains) {
      expect(typeof getNetworkConfig(chain).chainId).toBe('number');
    }
  });

  it('Tron chains have string chainId', () => {
    expect(getNetworkConfig('tron').chainId).toBe('mainnet');
    expect(getNetworkConfig('tron-shasta').chainId).toBe('shasta');
  });
});

describe('RPC defaults', () => {
  it('returns a URL for every chain', () => {
    for (const chain of ALL_CHAINS) {
      const url = getDefaultRpcUrl(chain);
      expect(url).toMatch(/^https?:\/\//);
    }
  });

  it('getAllRpcUrls returns at least one URL per chain', () => {
    for (const chain of ALL_CHAINS) {
      const urls = getAllRpcUrls(chain);
      expect(urls.length).toBeGreaterThan(0);
    }
  });
});

describe('stablecoin addresses', () => {
  it('has USDC on major chains', () => {
    expect(getStablecoinAddress('ethereum', 'USDC')).toBeTruthy();
    expect(getStablecoinAddress('polygon', 'USDC')).toBeTruthy();
    expect(getStablecoinAddress('base', 'USDC')).toBeTruthy();
    expect(getStablecoinAddress('tron', 'USDC')).toBeTruthy();
  });

  it('returns undefined for combos with no deployed contract', () => {
    // Sepolia has a canonical USDC but no canonical USDT deployment.
    expect(getStablecoinAddress('ethereum-sepolia', 'USDT')).toBeUndefined();
  });

  it('provides stablecoin addresses on testnets, since testnet is the default mode', () => {
    expect(getStablecoinAddress('ethereum-sepolia', 'USDC')).toBeTruthy();
    expect(getStablecoinAddress('base-sepolia', 'USDC')).toBeTruthy();
    expect(getStablecoinAddress('polygon-amoy', 'USDC')).toBeTruthy();
    expect(getStablecoinAddress('arbitrum-sepolia', 'USDC')).toBeTruthy();
    expect(getStablecoinAddress('bsc-testnet', 'USDT')).toBeTruthy();
    expect(getStablecoinAddress('tron-shasta', 'USDT')).toBeTruthy();
  });

  it('Tron stablecoin addresses start with T', () => {
    const tronUsdc = getStablecoinAddress('tron', 'USDC');
    const tronUsdt = getStablecoinAddress('tron', 'USDT');
    expect(tronUsdc).toMatch(/^T/);
    expect(tronUsdt).toMatch(/^T/);
  });
});

describe('defaultChain inference', () => {
  // Regression: defaultChain used to default to a hardcoded 'ethereum-sepolia',
  // so ANY chain set that did not happen to include it failed at construction
  // with a confusing error about a defaultChain the caller never set.
  it('defaults to the first configured chain, not a hardcoded one', () => {
    const result = locktekConfigSchema.parse({ chains: ['base-sepolia'] });

    expect(result.defaultChain).toBe('base-sepolia');
  });

  it('accepts a single non-EVM chain with no defaultChain', () => {
    const result = locktekConfigSchema.parse({ chains: ['tron-shasta'] });

    expect(result.defaultChain).toBe('tron-shasta');
  });

  it('accepts a mainnet-only config when testnet is disabled', () => {
    const result = locktekConfigSchema.parse({ chains: ['ethereum'], testnet: false });

    expect(result.defaultChain).toBe('ethereum');
  });

  it('keeps an explicit defaultChain over the first chain', () => {
    const result = locktekConfigSchema.parse({
      chains: ['ethereum-sepolia', 'base-sepolia'],
      defaultChain: 'base-sepolia',
    });

    expect(result.defaultChain).toBe('base-sepolia');
  });
});
