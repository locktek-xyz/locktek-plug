import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLocktek } from '../locktek.js';
import { registerChain, unregisterChain } from '../adapters/factory.js';
import { ErrorCode } from '../types/common.js';
import type { ChainAdapter } from '../adapters/interface.js';
import type { NetworkConfig } from '../types/chain.js';

const FAKE_CHAIN = 'unit-test-chain';

const FAKE_NETWORK: NetworkConfig = {
  chainId: 999_999,
  name: 'Unit Test Chain',
  symbol: 'UTC',
  decimals: 18,
  chainFamily: 'evm',
  rpcUrls: ['https://unit-test.invalid'],
  explorerUrl: 'https://explorer.invalid',
  isTestnet: true,
};

/** A fully in-memory adapter, so the facade can be exercised with no network at all. */
function createFakeAdapter(overrides: Partial<ChainAdapter> = {}): ChainAdapter {
  const base: ChainAdapter = {
    chain: FAKE_CHAIN as never,
    chainFamily: 'evm',
    createWallet: async () => ({
      address: '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C',
      publicKey: '0x02',
      privateKey: `0x${'1'.repeat(64)}`,
      chain: FAKE_CHAIN as never,
      chainFamily: 'evm',
    }),
    importWallet: async (privateKey) => ({
      address: '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C',
      publicKey: '0x02',
      privateKey,
      chain: FAKE_CHAIN as never,
      chainFamily: 'evm',
    }),
    getBalance: async () => '2500000000000000000',
    getTokenBalance: async () => '7500000',
    getTokenDecimals: async () => 6,
    buildTransaction: async (params) => ({
      chain: FAKE_CHAIN as never,
      chainFamily: 'evm',
      chainId: FAKE_NETWORK.chainId,
      data: '{}',
      params,
      baseUnitAmount: '1',
    }),
    signAndSend: async () => ({ hash: '0xdeadbeef' }),
    waitForConfirmation: async (hash) => ({ hash, status: 'success', confirmations: 1 }),
    signMessage: async () => ({ signature: '0xsig', address: '0xaddr' }),
    estimateGas: async () => ({ totalFee: '21000', totalFeeInToken: '0.000021' }),
    validateAddress: (address) => address.startsWith('0x'),
    healthCheck: async () => ({ healthy: true, endpoint: 'fake', latencyMs: 1 }),
  };

  return { ...base, ...overrides };
}

let adapterOverrides: Partial<ChainAdapter> = {};

function locktek(extra: Record<string, unknown> = {}) {
  return createLocktek({ chains: [FAKE_CHAIN], defaultChain: FAKE_CHAIN, ...extra });
}

describe('Locktek facade', () => {
  beforeEach(() => {
    adapterOverrides = {};
    registerChain({
      chain: FAKE_CHAIN,
      network: FAKE_NETWORK,
      createAdapter: () => createFakeAdapter(adapterOverrides),
    });
  });

  afterEach(() => {
    unregisterChain(FAKE_CHAIN);
  });

  describe('custom chain registration', () => {
    it('accepts a registered custom chain in config validation', () => {
      expect(locktek().chains).toEqual([FAKE_CHAIN]);
    });

    it('routes calls to the registered adapter', async () => {
      await expect(locktek().getBalance('0xabc')).resolves.toBe('2500000000000000000');
    });

    it('refuses to shadow a built-in chain', () => {
      expect(() =>
        registerChain({
          chain: 'ethereum',
          network: FAKE_NETWORK,
          createAdapter: () => createFakeAdapter(),
        }),
      ).toThrow(/built in/);
    });

    it('refuses a duplicate registration', () => {
      expect(() =>
        registerChain({
          chain: FAKE_CHAIN,
          network: FAKE_NETWORK,
          createAdapter: () => createFakeAdapter(),
        }),
      ).toThrow(/already registered/);
    });

    it('refuses a network config with no RPC URLs', () => {
      expect(() =>
        registerChain({
          chain: 'another-test-chain',
          network: { ...FAKE_NETWORK, rpcUrls: [] },
          createAdapter: () => createFakeAdapter(),
        }),
      ).toThrow(/at least one RPC URL/);
    });
  });

  describe('formatted balances', () => {
    it('returns whole units alongside base units', async () => {
      await expect(locktek().getBalanceFormatted('0xabc')).resolves.toEqual({
        balance: '2500000000000000000',
        balanceFormatted: '2.500000000000000000',
        decimals: 18,
        symbol: 'UTC',
      });
    });

    it('formats a token balance using the contract decimals, not the chain decimals', async () => {
      await expect(locktek().getTokenBalanceFormatted('0xabc', '0xtoken')).resolves.toEqual({
        balance: '7500000',
        balanceFormatted: '7.500000',
        decimals: 6,
      });
    });
  });

  describe('simulateTransaction', () => {
    const params = { from: '0xfrom', to: '0xto', amount: '1.5' };

    it('reports the exact base-unit amount without broadcasting', async () => {
      const result = await locktek().simulateTransaction(params);

      expect(result).toMatchObject({
        allowed: true,
        baseUnitAmount: '1500000000000000000',
        decimals: 18,
      });
      expect(result.estimatedGas).toBeDefined();
    });

    it('reports a refusal with the rule that caused it', async () => {
      const result = await locktek({
        policy: { maxAmountPerTransaction: '1' },
      }).simulateTransaction(params);

      expect(result).toMatchObject({ allowed: false, rule: 'maxAmountPerTransaction' });
    });

    it('does not consume session budget, so simulating is free', async () => {
      const instance = locktek({ policy: { maxAmountPerSession: '2' } });

      await instance.simulateTransaction(params);
      await instance.simulateTransaction(params);

      await expect(instance.buildTransaction(params)).resolves.toBeDefined();
    });
  });

  describe('delegation', () => {
    it('passes send options through to the adapter', async () => {
      const signAndSend = vi.fn(async () => ({ hash: '0xfeed' }));
      adapterOverrides = { signAndSend };

      const instance = locktek();
      const tx = await instance.buildTransaction({ from: '0xf', to: '0xt', amount: '1' });
      await instance.signAndSend(tx, '0xkey', { idempotencyKey: 'abc' });

      expect(signAndSend).toHaveBeenCalledWith(tx, '0xkey', { idempotencyKey: 'abc' });
    });

    it('still accepts the legacy (tx, key, chain) argument order', async () => {
      const signAndSend = vi.fn(async () => ({ hash: '0xfeed' }));
      adapterOverrides = { signAndSend };

      const instance = locktek();
      const tx = await instance.buildTransaction({ from: '0xf', to: '0xt', amount: '1' });
      await instance.signAndSend(tx, '0xkey', FAKE_CHAIN as never);

      expect(signAndSend).toHaveBeenCalledWith(tx, '0xkey', {});
    });

    it('reports a reverted transaction as reverted', async () => {
      adapterOverrides = {
        waitForConfirmation: async (hash) => ({ hash, status: 'reverted', confirmations: 1 }),
      };

      await expect(locktek().waitForConfirmation('0xhash')).resolves.toMatchObject({
        status: 'reverted',
      });
    });

    it('delegates signMessage, estimateGas, and validateAddress', async () => {
      const instance = locktek();

      await expect(instance.signMessage('hi', '0xkey')).resolves.toMatchObject({
        signature: '0xsig',
      });
      await expect(
        instance.estimateGas({ from: '0xf', to: '0xt', amount: '1' }),
      ).resolves.toMatchObject({ totalFee: '21000' });
      expect(instance.validateAddress('0xabc')).toBe(true);
      await expect(instance.getTokenDecimals('0xtoken')).resolves.toBe(6);
    });

    it('rejects a chain that is not configured', async () => {
      await expect(locktek().getBalance('0xabc', 'ethereum-sepolia')).rejects.toMatchObject({
        code: ErrorCode.INVALID_CHAIN,
      });
    });
  });

  describe('healthCheck', () => {
    it('reports per-chain results', async () => {
      await expect(locktek().healthCheck()).resolves.toEqual({
        [FAKE_CHAIN]: { healthy: true, endpoint: 'fake', latencyMs: 1 },
      });
    });

    it('never throws, even when an adapter cannot be built', async () => {
      adapterOverrides = {
        healthCheck: async () => {
          throw new Error('boom');
        },
      };

      const result = await locktek().healthCheck();
      expect(result[FAKE_CHAIN].healthy).toBe(false);
    });
  });

  describe('policy release', () => {
    it('gives session budget back when the build fails', async () => {
      adapterOverrides = {
        buildTransaction: async () => {
          throw new Error('rpc down');
        },
      };

      const instance = locktek({ policy: { maxAmountPerSession: '1' } });
      const params = { from: '0xf', to: '0xt', amount: '1' };

      await expect(instance.buildTransaction(params)).rejects.toThrow('rpc down');

      // The failed attempt must not have consumed the session cap.
      adapterOverrides = {};
      const fresh = instance.policyAudit.length;
      expect(fresh).toBeGreaterThan(0);
      await expect(instance.simulateTransaction(params)).resolves.toMatchObject({ allowed: true });
    });
  });
});

describe('signAndSend argument resolution', () => {
  const TX = {
    chain: FAKE_CHAIN as never,
    chainFamily: 'evm' as const,
    chainId: FAKE_NETWORK.chainId,
    data: '{}',
    params: { from: '0xa', to: '0xb', amount: '1' },
    baseUnitAmount: '1000000000000000000',
  };
  const KEY = `0x${'1'.repeat(64)}`;

  let sent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sent = vi.fn().mockResolvedValue({ hash: '0xhash' });
    adapterOverrides = { signAndSend: sent as never };
    registerChain({
      chain: FAKE_CHAIN,
      network: FAKE_NETWORK,
      createAdapter: () => createFakeAdapter(adapterOverrides),
    });
  });

  afterEach(() => {
    unregisterChain(FAKE_CHAIN);
  });

  // Regression: passing `undefined` for the optional chain — the natural way to reach
  // the options argument — dropped the options entirely, silently discarding the
  // idempotency key that is the only thing preventing a double broadcast.
  it('honours options when chain is explicitly undefined', async () => {
    await locktek().signAndSend(TX, KEY, undefined, { idempotencyKey: 'payout-1' });

    expect(sent).toHaveBeenCalledWith(
      TX,
      KEY,
      expect.objectContaining({ idempotencyKey: 'payout-1' }),
    );
  });

  it('honours options passed in the third position', async () => {
    await locktek().signAndSend(TX, KEY, { idempotencyKey: 'payout-2' });

    expect(sent).toHaveBeenCalledWith(
      TX,
      KEY,
      expect.objectContaining({ idempotencyKey: 'payout-2' }),
    );
  });

  it('honours options when a chain is also given', async () => {
    await locktek().signAndSend(TX, KEY, FAKE_CHAIN as never, { idempotencyKey: 'payout-3' });

    expect(sent).toHaveBeenCalledWith(
      TX,
      KEY,
      expect.objectContaining({ idempotencyKey: 'payout-3' }),
    );
  });
});
