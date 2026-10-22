import { describe, it, expect } from 'vitest';
import { createHDWallet, createEVMWallet, createTronWallet } from '../wallet/hd-wallet.js';
import { LocktekError, ErrorCode } from '../types/common.js';

describe('HD Wallet', () => {
  describe('createEVMWallet', () => {
    it('generates a valid Ethereum wallet', async () => {
      const wallet = await createEVMWallet({ chain: 'ethereum-sepolia' });
      expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(wallet.publicKey).toMatch(/^0x(02|03)[0-9a-fA-F]{64}$/);
      expect(wallet.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(wallet.mnemonic).toMatch(/^(\w+ ){11}\w+$/);
      expect(wallet.mnemonic!.split(' ')).toHaveLength(12);
      expect(wallet.chain).toBe('ethereum-sepolia');
      expect(wallet.chainFamily).toBe('evm');
      expect(wallet.derivationPath).toBe("m/44'/60'/0'/0/0");
    });

    it('generates different addresses each time', async () => {
      const wallet1 = await createEVMWallet({ chain: 'ethereum' });
      const wallet2 = await createEVMWallet({ chain: 'ethereum' });
      expect(wallet1.address).not.toBe(wallet2.address);
    });

    it('restores wallet from mnemonic', async () => {
      const wallet1 = await createEVMWallet({ chain: 'base-sepolia' });
      const wallet2 = await createEVMWallet({
        chain: 'base-sepolia',
        mnemonic: wallet1.mnemonic!,
      });
      expect(wallet2.address).toBe(wallet1.address);
      expect(wallet2.publicKey).toBe(wallet1.publicKey);
      expect(wallet2.privateKey).toBe(wallet1.privateKey);
    });

    it('uses custom derivation path', async () => {
      const wallet1 = await createEVMWallet({ chain: 'polygon-amoy' });
      const wallet2 = await createEVMWallet({
        chain: 'polygon-amoy',
        mnemonic: wallet1.mnemonic!,
        derivationPath: "m/44'/60'/0'/0/1",
      });
      expect(wallet2.address).not.toBe(wallet1.address);
      expect(wallet2.derivationPath).toBe("m/44'/60'/0'/0/1");
    });

    it('works for all EVM chains', async () => {
      const chains = [
        'ethereum-sepolia',
        'base-sepolia',
        'polygon-amoy',
        'arbitrum-sepolia',
        'bsc-testnet',
      ] as const;
      for (const chain of chains) {
        const wallet = await createEVMWallet({ chain });
        expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(wallet.chainFamily).toBe('evm');
      }
    });
  });

  describe('createTronWallet', () => {
    it('generates a valid Tron wallet with T-prefix address', async () => {
      const wallet = await createTronWallet({ chain: 'tron-shasta' });
      expect(wallet.address).toMatch(/^T[A-Za-z0-9]{33}$/);
      expect(wallet.publicKey).toMatch(/^0x(02|03)[0-9a-fA-F]{64}$/);
      expect(wallet.privateKey).toMatch(/^(0x)?[0-9a-fA-F]{64}$/);
      expect(wallet.mnemonic).toMatch(/^(\w+ ){11}\w+$/);
      expect(wallet.chain).toBe('tron-shasta');
      expect(wallet.chainFamily).toBe('tron');
      expect(wallet.derivationPath).toBe("m/44'/195'/0'/0/0");
    });

    it('restores Tron wallet from mnemonic', async () => {
      const wallet1 = await createTronWallet({ chain: 'tron' });
      const wallet2 = await createTronWallet({
        chain: 'tron',
        mnemonic: wallet1.mnemonic!,
      });
      expect(wallet2.address).toBe(wallet1.address);
    });
  });

  describe('createHDWallet', () => {
    it('dispatches to EVM for EVM chains', async () => {
      const wallet = await createHDWallet({ chain: 'ethereum-sepolia' });
      expect(wallet.address).toMatch(/^0x/);
      expect(wallet.chainFamily).toBe('evm');
    });

    it('dispatches to Tron for Tron chains', async () => {
      const wallet = await createHDWallet({ chain: 'tron-shasta' });
      expect(wallet.address).toMatch(/^T/);
      expect(wallet.chainFamily).toBe('tron');
    });
  });

  describe('invalid mnemonic handling — createEVMWallet', () => {
    it('throws LocktekError for a single invalid word', async () => {
      await expect(
        createEVMWallet({ chain: 'ethereum-sepolia', mnemonic: 'notaword' }),
      ).rejects.toThrow(LocktekError);
    });

    it('throws LocktekError for 11 words (wrong count)', async () => {
      const elevenWords =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
      await expect(
        createEVMWallet({ chain: 'ethereum-sepolia', mnemonic: elevenWords }),
      ).rejects.toThrow(LocktekError);
    });

    it('throws LocktekError for empty string', async () => {
      await expect(createEVMWallet({ chain: 'ethereum-sepolia', mnemonic: '' })).rejects.toThrow(
        LocktekError,
      );
    });

    it('throws LocktekError for gibberish string', async () => {
      await expect(
        createEVMWallet({ chain: 'ethereum-sepolia', mnemonic: 'xyz123 !@# $%^' }),
      ).rejects.toThrow(LocktekError);
    });

    it('error message includes "BIP-39" hint', async () => {
      await expect(
        createEVMWallet({ chain: 'ethereum-sepolia', mnemonic: 'bad mnemonic' }),
      ).rejects.toThrow(/BIP-39/);
    });

    it('error code is INVALID_PRIVATE_KEY', async () => {
      try {
        await createEVMWallet({ chain: 'ethereum-sepolia', mnemonic: 'bad mnemonic' });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LocktekError);
        expect((error as LocktekError).code).toBe(ErrorCode.INVALID_PRIVATE_KEY);
      }
    });

    it('valid 12-word mnemonic still works (regression)', async () => {
      const wallet1 = await createEVMWallet({ chain: 'ethereum-sepolia' });
      const wallet2 = await createEVMWallet({
        chain: 'ethereum-sepolia',
        mnemonic: wallet1.mnemonic!,
      });
      expect(wallet2.address).toBe(wallet1.address);
    });
  });

  describe('invalid mnemonic handling — createTronWallet', () => {
    it('throws LocktekError for a single invalid word', async () => {
      await expect(
        createTronWallet({ chain: 'tron-shasta', mnemonic: 'notaword' }),
      ).rejects.toThrow(LocktekError);
    });

    it('throws LocktekError for 11 words (wrong count)', async () => {
      const elevenWords =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
      await expect(
        createTronWallet({ chain: 'tron-shasta', mnemonic: elevenWords }),
      ).rejects.toThrow(LocktekError);
    });

    it('throws LocktekError for empty string', async () => {
      await expect(createTronWallet({ chain: 'tron-shasta', mnemonic: '' })).rejects.toThrow(
        LocktekError,
      );
    });

    it('throws LocktekError for gibberish string', async () => {
      await expect(
        createTronWallet({ chain: 'tron-shasta', mnemonic: 'xyz123 !@# $%^' }),
      ).rejects.toThrow(LocktekError);
    });

    it('error message includes "BIP-39" hint', async () => {
      await expect(
        createTronWallet({ chain: 'tron-shasta', mnemonic: 'bad mnemonic' }),
      ).rejects.toThrow(/BIP-39/);
    });

    it('error code is INVALID_PRIVATE_KEY', async () => {
      try {
        await createTronWallet({ chain: 'tron-shasta', mnemonic: 'bad mnemonic' });
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LocktekError);
        expect((error as LocktekError).code).toBe(ErrorCode.INVALID_PRIVATE_KEY);
      }
    });

    it('valid 12-word mnemonic still works (regression)', async () => {
      const wallet1 = await createTronWallet({ chain: 'tron-shasta' });
      const wallet2 = await createTronWallet({
        chain: 'tron-shasta',
        mnemonic: wallet1.mnemonic!,
      });
      expect(wallet2.address).toBe(wallet1.address);
    });
  });
});
