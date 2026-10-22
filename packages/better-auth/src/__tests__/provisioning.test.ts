import { describe, it, expect, vi } from 'vitest';
import { provisionWallet, resolveAutoChains, toResponse } from '../provisioning.js';
import { walletKeyFor } from '../schema.js';
import { createFakeAdapter } from './helpers/fake-adapter.js';

const USER = 'user-1';
const CHAIN = 'ethereum-sepolia';

function createLocktekStub(overrides: Record<string, unknown> = {}) {
  let counter = 0;
  return {
    defaultChain: CHAIN,
    createAndEncryptWallet: vi.fn(async (chain: string) => {
      counter += 1;
      return {
        address: `0xaddress${counter}`,
        publicKey: `0xpub${counter}`,
        chain,
        chainFamily: 'evm',
        encryptedPrivateKey: `enc-key-${counter}`,
        encryptedMnemonic: `enc-mnemonic-${counter}`,
      };
    }),
    ...overrides,
  } as never;
}

describe('provisionWallet', () => {
  it('creates a wallet and persists both ciphertexts', async () => {
    const adapter = createFakeAdapter();
    const result = await provisionWallet(createLocktekStub(), adapter, USER, CHAIN as never);

    expect(result.created).toBe(true);
    expect(adapter.rows).toHaveLength(1);
    expect(adapter.rows[0]).toMatchObject({
      userId: USER,
      walletKey: walletKeyFor(USER, CHAIN),
      encryptedPrivateKey: 'enc-key-1',
      // Without the mnemonic, losing the key ciphertext makes the wallet unrecoverable.
      encryptedMnemonic: 'enc-mnemonic-1',
    });
  });

  it('is idempotent: a second call returns the existing wallet', async () => {
    const adapter = createFakeAdapter();
    const locktek = createLocktekStub();

    const first = await provisionWallet(locktek, adapter, USER, CHAIN as never);
    const second = await provisionWallet(locktek, adapter, USER, CHAIN as never);

    expect(second.created).toBe(false);
    expect(second.wallet.address).toBe(first.wallet.address);
    expect(adapter.rows).toHaveLength(1);
    expect(locktek.createAndEncryptWallet).toHaveBeenCalledTimes(1);
  });

  it('survives a lost race, returning the wallet the winner created', async () => {
    const adapter = createFakeAdapter();
    const locktek = createLocktekStub();

    // Both callers pass the existence check before either inserts, which is exactly
    // the window an application-level check cannot close.
    const [a, b] = await Promise.all([
      provisionWallet(locktek, adapter, USER, CHAIN as never),
      provisionWallet(locktek, adapter, USER, CHAIN as never),
    ]);

    expect(adapter.rows).toHaveLength(1);
    expect(a.wallet.address).toBe(b.wallet.address);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
  });

  it('keeps wallets on different chains separate', async () => {
    const adapter = createFakeAdapter();
    const locktek = createLocktekStub();

    await provisionWallet(locktek, adapter, USER, 'ethereum-sepolia' as never);
    await provisionWallet(locktek, adapter, USER, 'base-sepolia' as never);

    expect(adapter.rows).toHaveLength(2);
  });

  it('keeps wallets for different users separate', async () => {
    const adapter = createFakeAdapter();
    const locktek = createLocktekStub();

    await provisionWallet(locktek, adapter, 'user-a', CHAIN as never);
    await provisionWallet(locktek, adapter, 'user-b', CHAIN as never);

    expect(adapter.rows).toHaveLength(2);
  });

  it('refuses to store a wallet that was not encrypted', async () => {
    const adapter = createFakeAdapter();
    const locktek = createLocktekStub({
      createAndEncryptWallet: vi.fn(async () => ({
        address: '0x1',
        publicKey: '0x2',
        chain: CHAIN,
        chainFamily: 'evm',
      })),
    });

    await expect(provisionWallet(locktek, adapter, USER, CHAIN as never)).rejects.toThrow(
      /not encrypted/,
    );
    expect(adapter.rows).toHaveLength(0);
  });

  it('propagates a genuine database failure rather than masking it', async () => {
    const adapter = createFakeAdapter();
    adapter.create.mockRejectedValueOnce(new Error('disk on fire'));

    await expect(
      provisionWallet(createLocktekStub(), adapter, USER, CHAIN as never),
    ).rejects.toThrow('disk on fire');
  });

  it('falls back to findMany when the adapter has no findOne', async () => {
    const adapter = createFakeAdapter();
    const withoutFindOne = { ...adapter, findOne: undefined } as never;
    const locktek = createLocktekStub();

    await provisionWallet(locktek, withoutFindOne, USER, CHAIN as never);
    const again = await provisionWallet(locktek, withoutFindOne, USER, CHAIN as never);

    expect(again.created).toBe(false);
  });
});

describe('toResponse', () => {
  it('strips every secret field', () => {
    const response = toResponse({
      id: 'w1',
      userId: USER,
      address: '0xabc',
      chain: CHAIN,
      chainFamily: 'evm',
      publicKey: '0xpub',
      encryptedPrivateKey: 'SECRET',
      encryptedMnemonic: 'ALSO SECRET',
      label: null,
      createdAt: new Date(0),
    });

    expect(Object.keys(response)).not.toContain('encryptedPrivateKey');
    expect(Object.keys(response)).not.toContain('encryptedMnemonic');
    expect(JSON.stringify(response)).not.toContain('SECRET');
  });
});

describe('resolveAutoChains', () => {
  it('provisions nothing when the option is absent or false', () => {
    expect(resolveAutoChains(undefined, CHAIN)).toEqual([]);
    expect(resolveAutoChains(false, CHAIN)).toEqual([]);
  });

  it('provisions the default chain for true', () => {
    expect(resolveAutoChains(true, CHAIN)).toEqual([CHAIN]);
  });

  it('provisions exactly the listed chains', () => {
    expect(resolveAutoChains(['base-sepolia', 'tron-shasta'], CHAIN)).toEqual([
      'base-sepolia',
      'tron-shasta',
    ]);
  });
});
