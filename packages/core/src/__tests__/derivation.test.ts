import { describe, it, expect } from 'vitest';
import {
  getDefaultDerivationPath,
  buildDerivationPath,
  getCoinType,
  parseDerivationPath,
  validateDerivationPath,
  BIP44CoinType,
} from '../wallet/derivation.js';
import type { Chain } from '../types/chain.js';

describe('derivation', () => {
  describe('getDefaultDerivationPath', () => {
    it('returns correct EVM path for ethereum', () => {
      expect(getDefaultDerivationPath('ethereum')).toBe("m/44'/60'/0'/0/0");
    });

    it('returns correct EVM path for all EVM chains', () => {
      const evmChains: Chain[] = [
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
      ];
      for (const chain of evmChains) {
        expect(getDefaultDerivationPath(chain)).toBe("m/44'/60'/0'/0/0");
      }
    });

    it('returns correct Tron path with coin type 195', () => {
      expect(getDefaultDerivationPath('tron')).toBe("m/44'/195'/0'/0/0");
      expect(getDefaultDerivationPath('tron-shasta')).toBe("m/44'/195'/0'/0/0");
    });

    it('throws for unknown chain', () => {
      expect(() => getDefaultDerivationPath('solana' as Chain)).toThrow();
    });
  });

  describe('buildDerivationPath', () => {
    it('builds default EVM path', () => {
      expect(buildDerivationPath('ethereum')).toBe("m/44'/60'/0'/0/0");
    });

    it('builds path with custom account', () => {
      expect(buildDerivationPath('ethereum', { account: 2 })).toBe("m/44'/60'/2'/0/0");
    });

    it('builds path with custom address index', () => {
      expect(buildDerivationPath('polygon', { addressIndex: 5 })).toBe("m/44'/60'/0'/0/5");
    });

    it('builds Tron path with coin type 195', () => {
      expect(buildDerivationPath('tron')).toBe("m/44'/195'/0'/0/0");
    });

    it('builds Tron path with custom index', () => {
      expect(buildDerivationPath('tron-shasta', { addressIndex: 3 })).toBe("m/44'/195'/0'/0/3");
    });
  });

  describe('getCoinType', () => {
    it('returns 60 for EVM chains', () => {
      expect(getCoinType('ethereum')).toBe(BIP44CoinType.ETHEREUM);
      expect(getCoinType('base')).toBe(60);
    });

    it('returns 195 for Tron chains', () => {
      expect(getCoinType('tron')).toBe(BIP44CoinType.TRON);
      expect(getCoinType('tron-shasta')).toBe(195);
    });
  });

  describe('parseDerivationPath', () => {
    it('parses standard BIP44 path', () => {
      const parsed = parseDerivationPath("m/44'/60'/0'/0/0");
      expect(parsed).toEqual({
        purpose: 44,
        coinType: 60,
        account: 0,
        change: 0,
        addressIndex: 0,
      });
    });

    it('parses Tron path', () => {
      const parsed = parseDerivationPath("m/44'/195'/1'/0/3");
      expect(parsed.coinType).toBe(195);
      expect(parsed.account).toBe(1);
      expect(parsed.addressIndex).toBe(3);
    });

    it('rejects invalid path', () => {
      expect(() => parseDerivationPath('invalid')).toThrow();
    });
  });

  describe('validateDerivationPath', () => {
    it('accepts valid paths', () => {
      expect(validateDerivationPath("m/44'/60'/0'/0/0")).toBe(true);
      expect(validateDerivationPath("m/44'/195'/0'/0/0")).toBe(true);
    });

    it('rejects invalid paths', () => {
      expect(validateDerivationPath('invalid')).toBe(false);
      expect(validateDerivationPath("m/44'/60'")).toBe(false);
    });
  });
});
