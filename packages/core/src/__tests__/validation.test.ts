import { describe, it, expect } from 'vitest';
import { validateEvmAddress, validateTronAddress, validateAddress } from '../utils/validation.js';
import { TronAddress } from '../utils/tron-address.js';

describe('validation', () => {
  describe('validateEvmAddress', () => {
    it('accepts valid EVM addresses', () => {
      expect(validateEvmAddress('0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C')).toBe(true);
      expect(validateEvmAddress('0x0000000000000000000000000000000000000000')).toBe(true);
    });

    it('rejects addresses without 0x prefix', () => {
      expect(validateEvmAddress('a614f803B6FD780986A42c78Ec9c7f77e6DeD13C')).toBe(false);
    });

    it('rejects short addresses', () => {
      expect(validateEvmAddress('0x1234')).toBe(false);
    });

    it('rejects non-hex characters', () => {
      expect(validateEvmAddress('0xZZZZf803B6FD780986A42c78Ec9c7f77e6DeD13C')).toBe(false);
    });
  });

  describe('validateTronAddress', () => {
    it('accepts valid Tron addresses', () => {
      const evmAddr = '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C';
      const tronAddr = TronAddress.fromEvmAddress(evmAddr);
      expect(validateTronAddress(tronAddr)).toBe(true);
    });

    it('rejects EVM addresses', () => {
      expect(validateTronAddress('0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C')).toBe(false);
    });
  });

  describe('validateAddress', () => {
    it('dispatches to EVM validation for EVM chains', () => {
      expect(validateAddress('0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C', 'ethereum')).toBe(true);
      expect(validateAddress('invalid', 'ethereum')).toBe(false);
    });

    it('dispatches to Tron validation for Tron chains', () => {
      const evmAddr = '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C';
      const tronAddr = TronAddress.fromEvmAddress(evmAddr);
      expect(validateAddress(tronAddr, 'tron')).toBe(true);
      expect(validateAddress('0xabc', 'tron')).toBe(false);
    });
  });
});
