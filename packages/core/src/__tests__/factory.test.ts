import { describe, it, expect } from 'vitest';
import { createAdapter } from '../adapters/factory.js';
import { EvmAdapter } from '../adapters/evm.adapter.js';
import { TronAdapter } from '../adapters/tron.adapter.js';

describe('createAdapter', () => {
  it('creates EvmAdapter for EVM chains', () => {
    const adapter = createAdapter('ethereum-sepolia');
    expect(adapter).toBeInstanceOf(EvmAdapter);
    expect(adapter.chain).toBe('ethereum-sepolia');
    expect(adapter.chainFamily).toBe('evm');
  });

  it('creates EvmAdapter for all EVM chains', () => {
    const evmChains = [
      'ethereum',
      'ethereum-sepolia',
      'base',
      'base-sepolia',
      'polygon',
      'polygon-amoy',
      'arbitrum',
      'arbitrum-sepolia',
      'bsc',
      'bsc-testnet',
    ] as const;

    for (const chain of evmChains) {
      const adapter = createAdapter(chain);
      expect(adapter).toBeInstanceOf(EvmAdapter);
      expect(adapter.chainFamily).toBe('evm');
    }
  });

  it('creates TronAdapter for Tron chains', () => {
    const adapter = createAdapter('tron-shasta');
    expect(adapter).toBeInstanceOf(TronAdapter);
    expect(adapter.chain).toBe('tron-shasta');
    expect(adapter.chainFamily).toBe('tron');
  });

  it('creates TronAdapter for mainnet Tron', () => {
    const adapter = createAdapter('tron');
    expect(adapter).toBeInstanceOf(TronAdapter);
  });

  it('passes custom RPC URL through', () => {
    const adapter = createAdapter('ethereum', 'https://custom.example.com');
    expect(adapter).toBeInstanceOf(EvmAdapter);
    expect(adapter.chain).toBe('ethereum');
  });
});
