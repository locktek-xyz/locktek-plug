import { describe, it, expect, vi } from 'vitest';
import { Locktek, createLocktek } from '../locktek.js';
import { ErrorCode } from '../types/common.js';

const ENCRYPTION_KEY = 'a-sufficiently-long-key';

describe('testnet guard', () => {
  it('refuses a mainnet chain while testnet mode is on', () => {
    expect(() => new Locktek({ chains: ['ethereum'], defaultChain: 'ethereum' })).toThrow(
      expect.objectContaining({ code: ErrorCode.MAINNET_BLOCKED }),
    );
  });

  it('names the offending chains and how to opt in', () => {
    try {
      new Locktek({ chains: ['ethereum', 'base'], defaultChain: 'ethereum' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('ethereum, base');
      expect((error as Error).message).toContain('testnet: false');
    }
  });

  it('allows mainnet once it is opted into explicitly', () => {
    const locktek = new Locktek({
      chains: ['ethereum'],
      defaultChain: 'ethereum',
      testnet: false,
    });

    expect(locktek.isTestnetOnly).toBe(false);
  });

  it('allows testnet chains by default', () => {
    const locktek = createLocktek({ chains: ['ethereum-sepolia'] });
    expect(locktek.isTestnetOnly).toBe(true);
  });
});

describe('policy wiring', () => {
  it('reports an unbounded configuration and warns about it', () => {
    const warn = vi.fn();
    createLocktek({ chains: ['ethereum-sepolia'], logger: { warn } });

    expect(warn).toHaveBeenCalledWith('locktek.policy_unbounded', expect.any(Object));
  });

  it('does not warn when limits are configured', () => {
    const warn = vi.fn();
    createLocktek({
      chains: ['ethereum-sepolia'],
      logger: { warn },
      policy: { maxAmountPerTransaction: '1' },
    });

    expect(warn).not.toHaveBeenCalledWith('locktek.policy_unbounded', expect.anything());
  });

  it('records policy decisions on the instance audit trail', async () => {
    const locktek = createLocktek({
      chains: ['ethereum-sepolia'],
      policy: { maxAmountPerTransaction: '0.5' },
    });

    await expect(
      locktek.buildTransaction({
        from: '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C',
        to: '0x0000000000000000000000000000000000000001',
        amount: '5',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.POLICY_VIOLATION });

    expect(locktek.policyAudit).toHaveLength(1);
    expect(locktek.policyAudit[0]).toMatchObject({
      decision: 'refused',
      rule: 'maxAmountPerTransaction',
    });
  });

  it('refuses before any network call is attempted', async () => {
    const locktek = createLocktek({
      chains: ['ethereum-sepolia'],
      policy: { readOnly: true },
      rpcPolicy: { maxAttempts: 1, timeoutMs: 50 },
    });

    // If the policy did not short-circuit, this would attempt a real RPC call and
    // fail with a network error instead.
    await expect(
      locktek.buildTransaction({
        from: '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C',
        to: '0x0000000000000000000000000000000000000001',
        amount: '0.001',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.POLICY_VIOLATION });
  });
});

describe('wallet recovery', () => {
  it('round-trips an encrypted wallet back to usable key material', async () => {
    const locktek = createLocktek({
      chains: ['ethereum-sepolia'],
      encryptionKey: ENCRYPTION_KEY,
    });

    const wallet = await locktek.createAndEncryptWallet();

    expect(wallet.privateKey).toBeUndefined();
    expect(wallet.encryptedPrivateKey).toBeDefined();

    const recovered = await locktek.recoverWallet({
      encryptedPrivateKey: wallet.encryptedPrivateKey,
      encryptedMnemonic: (wallet as { encryptedMnemonic?: string }).encryptedMnemonic,
    });

    const reimported = await locktek.importWallet(recovered.privateKey!);
    expect(reimported.address).toBe(wallet.address);
  });

  it('returns a mnemonic that restores the same address in a standard wallet', async () => {
    const locktek = createLocktek({
      chains: ['ethereum-sepolia'],
      encryptionKey: ENCRYPTION_KEY,
    });

    const wallet = await locktek.createAndEncryptWallet();
    const { mnemonic } = await locktek.recoverWallet({
      encryptedMnemonic: (wallet as { encryptedMnemonic?: string }).encryptedMnemonic,
    });

    const { createHDWallet } = await import('../wallet/hd-wallet.js');
    const restored = await createHDWallet({ chain: 'ethereum-sepolia', mnemonic });

    expect(restored.address).toBe(wallet.address);
  });

  it('rejects a recovery request with nothing to recover', async () => {
    const locktek = createLocktek({
      chains: ['ethereum-sepolia'],
      encryptionKey: ENCRYPTION_KEY,
    });

    await expect(locktek.recoverWallet({})).rejects.toMatchObject({
      code: ErrorCode.INVALID_CONFIG,
    });
  });

  it('requires an encryption key to be configured', async () => {
    const locktek = createLocktek({ chains: ['ethereum-sepolia'] });

    await expect(locktek.recoverWallet({ encryptedPrivateKey: 'x' })).rejects.toMatchObject({
      code: ErrorCode.ENCRYPTION_KEY_REQUIRED,
    });
  });
});

describe('mainnet guard surfaces its own error', () => {
  // The testnet guard used to be unreachable for a mainnet-only config: the schema
  // rejected it first with a defaultChain error, so the safety message a user needed
  // to see was never the one they got.
  it('throws MAINNET_BLOCKED — not a schema error — when defaultChain is omitted', () => {
    expect(() => new Locktek({ chains: ['ethereum'] })).toThrow(/testnet mode is enabled/i);
  });

  it('constructs a mainnet client when testnet is explicitly disabled', () => {
    const lt = new Locktek({ chains: ['ethereum'], testnet: false });

    expect(lt.defaultChain).toBe('ethereum');
    expect(lt.isTestnetOnly).toBe(false);
  });

  it('constructs a testnet client on a chain other than ethereum-sepolia', () => {
    const lt = new Locktek({ chains: ['base-sepolia'] });

    expect(lt.defaultChain).toBe('base-sepolia');
  });
});

describe('recoverWallet returns a verifiable identity', () => {
  const locktek = new Locktek({
    chains: ['ethereum-sepolia'],
    encryptionKey: 'a'.repeat(64),
  });

  it('derives the address from the recovered private key', async () => {
    const wallet = await locktek.createAndEncryptWallet();

    const recovered = await locktek.recoverWallet({
      encryptedPrivateKey: wallet.encryptedPrivateKey,
    });

    // Without this, a caller cannot tell a correctly recovered wallet from one
    // whose ciphertext was stored against the wrong row — both decrypt cleanly.
    expect(recovered.address).toBe(wallet.address);
  });

  it('omits the address when only a mnemonic was recovered', async () => {
    const wallet = await locktek.createAndEncryptWallet();

    const recovered = await locktek.recoverWallet({
      encryptedMnemonic: wallet.encryptedMnemonic,
    });

    expect(recovered.mnemonic).toBeTypeOf('string');
    expect(recovered.address).toBeUndefined();
  });

  it('derives the address on a non-EVM chain', async () => {
    const tron = new Locktek({ chains: ['tron-shasta'], encryptionKey: 'a'.repeat(64) });
    const wallet = await tron.createAndEncryptWallet();

    const recovered = await tron.recoverWallet({
      encryptedPrivateKey: wallet.encryptedPrivateKey,
    });

    expect(recovered.address).toBe(wallet.address);
  });
});
