import { describe, it, expect } from 'vitest';
import { Locktek, createLocktek } from '../locktek.js';
import { ErrorCode } from '../types/common.js';

describe('Locktek', () => {
  describe('constructor', () => {
    it('creates with minimal config', () => {
      const lt = new Locktek({ chains: ['ethereum-sepolia'] });
      expect(lt.chains).toEqual(['ethereum-sepolia']);
      expect(lt.defaultChain).toBe('ethereum-sepolia');
    });

    it('accepts multiple chains', () => {
      const lt = new Locktek({
        chains: ['ethereum-sepolia', 'base-sepolia', 'tron-shasta'],
      });
      expect(lt.chains).toHaveLength(3);
    });

    it('uses custom default chain', () => {
      const lt = new Locktek({
        chains: ['base-sepolia', 'ethereum-sepolia'],
        defaultChain: 'base-sepolia',
      });
      expect(lt.defaultChain).toBe('base-sepolia');
    });

    it('rejects empty chains array', () => {
      expect(() => new Locktek({ chains: [] })).toThrow();
    });

    it('rejects invalid chain names', () => {
      expect(() => new Locktek({ chains: ['solana'] })).toThrow('Invalid chain');
    });

    it('accepts encryption key', () => {
      const lt = new Locktek({
        chains: ['ethereum-sepolia'],
        encryptionKey: 'my-secret-key-that-is-long-enough',
      });
      expect(lt.chains).toEqual(['ethereum-sepolia']);
      expect(lt.defaultChain).toBe('ethereum-sepolia');
    });

    it('accepts custom RPC URLs', () => {
      const lt = new Locktek({
        chains: ['ethereum-sepolia'],
        rpc: { 'ethereum-sepolia': 'https://custom-rpc.example.com' },
      });
      expect(lt.chains).toEqual(['ethereum-sepolia']);
      expect(lt.defaultChain).toBe('ethereum-sepolia');
    });
  });

  describe('createLocktek factory', () => {
    it('returns a Locktek instance', () => {
      const lt = createLocktek({ chains: ['ethereum-sepolia'] });
      expect(lt).toBeInstanceOf(Locktek);
    });
  });

  describe('createWallet', () => {
    it('creates an EVM wallet using default chain', async () => {
      const lt = new Locktek({ chains: ['ethereum-sepolia'] });
      const wallet = await lt.createWallet();
      expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(wallet.chain).toBe('ethereum-sepolia');
      expect(wallet.chainFamily).toBe('evm');
      expect(wallet.publicKey).toMatch(/^0x(02|03)[0-9a-fA-F]{64}$/);
    });

    it('creates a wallet on a specific chain', async () => {
      const lt = new Locktek({
        chains: ['ethereum-sepolia', 'base-sepolia'],
      });
      const wallet = await lt.createWallet('base-sepolia');
      expect(wallet.chain).toBe('base-sepolia');
    });

    it('creates a Tron wallet', async () => {
      const lt = new Locktek({ chains: ['tron-shasta'], defaultChain: 'tron-shasta' });
      const wallet = await lt.createWallet('tron-shasta');
      expect(wallet.address).toMatch(/^T[A-Za-z0-9]{33}$/);
      expect(wallet.chainFamily).toBe('tron');
    });

    it('throws for unconfigured chain', async () => {
      const lt = new Locktek({ chains: ['ethereum-sepolia'] });
      await expect(lt.createWallet('base-sepolia')).rejects.toMatchObject({
        code: ErrorCode.INVALID_CHAIN,
      });
    });

    it('generates different wallets each call', async () => {
      const lt = new Locktek({ chains: ['ethereum-sepolia'] });
      const w1 = await lt.createWallet();
      const w2 = await lt.createWallet();
      expect(w1.address).not.toBe(w2.address);
    });

    it('handles 10 concurrent createWallet calls', async () => {
      const lt = new Locktek({ chains: ['ethereum-sepolia'] });
      const results = await Promise.all(Array.from({ length: 10 }, () => lt.createWallet()));
      const addresses = results.map((w) => w.address);
      // All unique
      expect(new Set(addresses).size).toBe(10);
      // All valid format
      for (const addr of addresses) {
        expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
      }
    });
  });

  describe('importWallet', () => {
    it('imports from private key on default chain', async () => {
      const lt = new Locktek({ chains: ['ethereum-sepolia'] });
      const created = await lt.createWallet();
      const imported = await lt.importWallet(created.privateKey!);
      expect(imported.address).toBe(created.address);
    });

    it('imports on a specific chain', async () => {
      const lt = new Locktek({
        chains: ['ethereum-sepolia', 'polygon-amoy'],
      });
      const created = await lt.createWallet('polygon-amoy');
      const imported = await lt.importWallet(created.privateKey!, 'polygon-amoy');
      expect(imported.address).toBe(created.address);
      expect(imported.chain).toBe('polygon-amoy');
    });
  });

  describe('validateAddress', () => {
    it('validates EVM addresses on default chain', () => {
      const lt = new Locktek({ chains: ['ethereum-sepolia'] });
      expect(lt.validateAddress('0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C')).toBe(true);
      expect(lt.validateAddress('not-valid')).toBe(false);
    });

    it('validates Tron addresses on Tron chain', () => {
      const lt = new Locktek({ chains: ['tron-shasta'], defaultChain: 'tron-shasta' });
      expect(lt.validateAddress('0xabc', 'tron-shasta')).toBe(false);
    });
  });

  describe('encryption', () => {
    it('encrypts and decrypts a string', async () => {
      const lt = new Locktek({
        chains: ['ethereum-sepolia'],
        encryptionKey: 'test-encryption-key-32chars!!',
      });
      const plaintext = 'my-secret-private-key';
      const encrypted = await lt.encrypt(plaintext);
      expect(encrypted).not.toBe(plaintext);
      const decrypted = await lt.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('throws when encryption key not configured', async () => {
      const lt = new Locktek({ chains: ['ethereum-sepolia'] });
      await expect(lt.encrypt('test')).rejects.toMatchObject({
        code: ErrorCode.ENCRYPTION_KEY_REQUIRED,
      });
    });

    it('throws when decryption key not configured', async () => {
      const lt = new Locktek({ chains: ['ethereum-sepolia'] });
      await expect(lt.decrypt('dGVzdA==')).rejects.toMatchObject({
        code: ErrorCode.ENCRYPTION_KEY_REQUIRED,
      });
    });

    it('accepts custom encryption provider', async () => {
      let encryptCalled = false;
      let decryptCalled = false;

      const customProvider = {
        async encrypt(plaintext: string) {
          encryptCalled = true;
          return Buffer.from(plaintext).toString('base64');
        },
        async decrypt(ciphertext: string) {
          decryptCalled = true;
          return Buffer.from(ciphertext, 'base64').toString('utf8');
        },
      };

      const lt = new Locktek({
        chains: ['ethereum-sepolia'],
        encryptionProvider: customProvider,
      });

      const encrypted = await lt.encrypt('hello');
      expect(encryptCalled).toBe(true);
      const decrypted = await lt.decrypt(encrypted);
      expect(decryptCalled).toBe(true);
      expect(decrypted).toBe('hello');
    });
  });

  describe('createAndEncryptWallet', () => {
    it('creates a wallet with encrypted private key', async () => {
      const lt = new Locktek({
        chains: ['ethereum-sepolia'],
        encryptionKey: 'test-encryption-key-32chars!!',
      });

      const wallet = await lt.createAndEncryptWallet();
      expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(wallet.privateKey).toBeUndefined();
      expect(typeof wallet.encryptedPrivateKey).toBe('string');
      expect(wallet.encryptedPrivateKey!.length).toBeGreaterThan(0);
      expect(wallet.encryptedPrivateKey).not.toMatch(/^0x/);
    });

    it('encrypted private key can be decrypted back', async () => {
      const lt = new Locktek({
        chains: ['ethereum-sepolia'],
        encryptionKey: 'test-encryption-key-32chars!!',
      });

      await lt.createWallet();
      const encWallet = await lt.createAndEncryptWallet();

      expect(typeof encWallet.encryptedPrivateKey).toBe('string');
      expect(encWallet.encryptedPrivateKey!.length).toBeGreaterThan(0);
      const decryptedKey = await lt.decrypt(encWallet.encryptedPrivateKey!);
      expect(decryptedKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    });

    it('throws without encryption key', async () => {
      const lt = new Locktek({ chains: ['ethereum-sepolia'] });
      await expect(lt.createAndEncryptWallet()).rejects.toMatchObject({
        code: ErrorCode.ENCRYPTION_KEY_REQUIRED,
      });
    });

    it('works for Tron wallets', async () => {
      const lt = new Locktek({
        chains: ['tron-shasta'],
        defaultChain: 'tron-shasta',
        encryptionKey: 'test-encryption-key-32chars!!',
      });

      const wallet = await lt.createAndEncryptWallet('tron-shasta');
      expect(wallet.address).toMatch(/^T[A-Za-z0-9]{33}$/);
      expect(wallet.privateKey).toBeUndefined();
      expect(typeof wallet.encryptedPrivateKey).toBe('string');
      expect(wallet.encryptedPrivateKey!.length).toBeGreaterThan(0);
    });
  });

  describe('adapter caching', () => {
    it('reuses adapters for the same chain', async () => {
      const lt = new Locktek({ chains: ['ethereum-sepolia'] });
      const w1 = await lt.createWallet();
      const w2 = await lt.createWallet();
      expect(w1.chain).toBe('ethereum-sepolia');
      expect(w2.chain).toBe('ethereum-sepolia');
    });
  });

  describe('multi-chain dispatch', () => {
    it('dispatches to correct adapter per chain', async () => {
      const lt = new Locktek({
        chains: ['ethereum-sepolia', 'tron-shasta', 'base-sepolia'],
      });

      const ethWallet = await lt.createWallet('ethereum-sepolia');
      const tronWallet = await lt.createWallet('tron-shasta');
      const baseWallet = await lt.createWallet('base-sepolia');

      expect(ethWallet.address).toMatch(/^0x/);
      expect(ethWallet.chainFamily).toBe('evm');

      expect(tronWallet.address).toMatch(/^T/);
      expect(tronWallet.chainFamily).toBe('tron');

      expect(baseWallet.address).toMatch(/^0x/);
      expect(baseWallet.chain).toBe('base-sepolia');
    });
  });

  describe('getBalance', () => {
    it('throws INVALID_ADDRESS for bad address', async () => {
      const lt = new Locktek({ chains: ['ethereum-sepolia'] });
      await expect(lt.getBalance('not-an-address')).rejects.toMatchObject({
        code: ErrorCode.INVALID_ADDRESS,
      });
    });
  });

  describe('cross-adapter consistency', () => {
    it('public key format is consistent across chain families', async () => {
      const lt = new Locktek({
        chains: ['ethereum-sepolia', 'tron-shasta'],
      });

      // Create a wallet on EVM to get a secp256k1 private key
      const evmWallet = await lt.createWallet('ethereum-sepolia');

      // Import the same private key on both chain families
      const evmImported = await lt.importWallet(evmWallet.privateKey!, 'ethereum-sepolia');
      const tronImported = await lt.importWallet(evmWallet.privateKey!, 'tron-shasta');

      // Both should return compressed public key: 0x prefix + 02/03 + 64 hex chars = 66 hex chars
      const compressedKeyPattern = /^0x0[23][0-9a-fA-F]{64}$/;
      expect(evmImported.publicKey).toMatch(compressedKeyPattern);
      expect(tronImported.publicKey).toMatch(compressedKeyPattern);

      // The public keys should be identical since they derive from the same private key
      expect(tronImported.publicKey).toBe(evmImported.publicKey);
    });
  });
});
