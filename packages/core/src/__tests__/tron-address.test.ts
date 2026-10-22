import { describe, it, expect } from 'vitest';
import { TronAddress } from '../utils/tron-address.js';

describe('TronAddress', () => {
  describe('fromEvmAddress', () => {
    it('converts an EVM address to a T-prefix Tron address', () => {
      const evmAddress = '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C';
      const tronAddress = TronAddress.fromEvmAddress(evmAddress);
      expect(tronAddress).toMatch(/^T[A-Za-z0-9]{33}$/);
    });

    it('produces consistent results', () => {
      const evmAddress = '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C';
      const tron1 = TronAddress.fromEvmAddress(evmAddress);
      const tron2 = TronAddress.fromEvmAddress(evmAddress);
      expect(tron1).toBe(tron2);
    });
  });

  describe('isValid', () => {
    it('validates T-prefix addresses', () => {
      const evmAddress = '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C';
      const tronAddress = TronAddress.fromEvmAddress(evmAddress);
      expect(TronAddress.isValid(tronAddress)).toBe(true);
    });

    it('rejects addresses without T prefix', () => {
      expect(TronAddress.isValid('0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C')).toBe(false);
    });

    it('rejects wrong-length addresses', () => {
      expect(TronAddress.isValid('T1234')).toBe(false);
    });

    it('rejects corrupted addresses', () => {
      expect(TronAddress.isValid('T' + '1'.repeat(33))).toBe(false);
    });
  });

  describe('roundtrip', () => {
    it('converts EVM → Tron → EVM and back', () => {
      const evmAddress = '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C';
      const tronAddress = TronAddress.fromEvmAddress(evmAddress);
      const roundtripped = TronAddress.toEvmAddress(tronAddress);
      expect(roundtripped.toLowerCase()).toBe(evmAddress.toLowerCase());
    });
  });
});
