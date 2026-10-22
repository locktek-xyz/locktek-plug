import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Chain } from '@locktek/core';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any import that triggers the modules
// ---------------------------------------------------------------------------
const { MockLocktek, MockAPIError } = vi.hoisted(() => {
  class MockAPIError extends Error {
    status: string;
    body: { message?: string; code?: string } | undefined;

    constructor(status: string, body?: { message?: string; code?: string }) {
      super(body?.message ?? status);
      this.status = status;
      this.body = body;
    }
  }

  const MockLocktek = vi.fn().mockImplementation((opts: Record<string, unknown>) => ({
    chains: opts.chains ?? ['ethereum-sepolia'],
    defaultChain: opts.defaultChain ?? (opts.chains as string[])?.[0] ?? 'ethereum-sepolia',
    createWallet: vi.fn(),
    createAndEncryptWallet: vi.fn(),
    getBalance: vi.fn(),
    getBalanceFormatted: vi.fn(),
    recoverWallet: vi.fn(),
  }));

  return { MockLocktek, MockAPIError };
});

// Mock @locktek/core — keep ALL_CHAINS available for the chain validation logic
vi.mock('@locktek/core', async () => {
  const ALL_CHAINS: readonly Chain[] = [
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
    'tron',
    'tron-shasta',
  ];

  return {
    Locktek: MockLocktek,
    ALL_CHAINS,
  };
});

// Mock better-auth/api — createAuthEndpoint captures the handler so we can invoke it
vi.mock('better-auth/api', () => {
  const sessionMiddleware = { id: 'session' };
  return {
    sessionMiddleware,
    APIError: MockAPIError,
    createAuthEndpoint: (
      path: string,
      config: { method: string; body?: unknown; use?: unknown[]; metadata?: unknown },
      handler: unknown,
    ) => ({
      path,
      method: config.method,
      body: config.body,
      use: config.use,
      metadata: config.metadata,
      handler,
    }),
  };
});

import { locktekPlugin } from '../plugin.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EndpointDef {
  path: string;
  method: string;
  handler: (ctx: unknown) => Promise<unknown>;
}

/** Extract the captured handler functions from a plugin instance. */
function extractHandlers(opts?: Parameters<typeof locktekPlugin>[0]) {
  const plugin = locktekPlugin(opts);
  const endpoints = plugin.endpoints as unknown as Record<string, EndpointDef>;
  return {
    createWallet: endpoints.createWallet.handler,
    getWallets: endpoints.getWallets.handler,
    getBalance: endpoints.getBalance.handler,
  };
}

/** Build a minimal mock ctx for endpoints that require session + adapter. */
function buildCtx(overrides: {
  body?: Record<string, unknown>;
  userId?: string;
  adapter?: {
    create?: ReturnType<typeof vi.fn>;
    findMany?: ReturnType<typeof vi.fn>;
  };
}) {
  const userId = overrides.userId ?? 'user-1';
  const jsonFn = vi.fn((data: unknown) => data);

  return {
    body: overrides.body ?? {},
    context: {
      session: {
        user: { id: userId },
        session: { id: 'session-1' },
      },
      adapter: {
        create: overrides.adapter?.create ?? vi.fn(),
        findMany: overrides.adapter?.findMany ?? vi.fn(),
      },
    },
    json: jsonFn,
  };
}

// ---------------------------------------------------------------------------
// create-wallet handler tests
// ---------------------------------------------------------------------------
describe('createWallet handler', () => {
  const ENCRYPTION_KEY = 'test-key-minimum-length-32chars!';
  const MOCK_WALLET_DATA = {
    address: '0xabc123',
    chain: 'ethereum-sepolia' as Chain,
    chainFamily: 'evm' as const,
    publicKey: '0xpub456',
    encryptedPrivateKey: 'enc:secret-key',
    privateKey: undefined,
  };

  beforeEach(() => {
    MockLocktek.mockClear();
  });

  it('happy path: creates wallet with encryption, stores in DB, omits encryptedPrivateKey from response', async () => {
    const adapterCreate = vi.fn().mockResolvedValue({ id: 'wallet-1' });
    const handlers = extractHandlers({ encryptionKey: ENCRYPTION_KEY });

    // Get the mock locktek instance (created during plugin construction)
    const locktekInstance = MockLocktek.mock.results[0].value;
    locktekInstance.createAndEncryptWallet.mockResolvedValue(MOCK_WALLET_DATA);

    const ctx = buildCtx({
      body: { chain: 'ethereum-sepolia' },
      userId: 'user-42',
      adapter: {
        create: adapterCreate,
        findOne: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
    });

    const result = await handlers.createWallet(ctx);

    // Verify Locktek.createAndEncryptWallet was called with the right chain
    expect(locktekInstance.createAndEncryptWallet).toHaveBeenCalledWith('ethereum-sepolia');

    // Verify adapter.create was called with correct data INCLUDING encryptedPrivateKey
    expect(adapterCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'locktekWallet',
        data: expect.objectContaining({
          userId: 'user-42',
          address: '0xabc123',
          chain: 'ethereum-sepolia',
          chainFamily: 'evm',
          publicKey: '0xpub456',
          encryptedPrivateKey: 'enc:secret-key',
        }),
      }),
    );

    // Verify response does NOT include encryptedPrivateKey (security-critical)
    expect(ctx.json).toHaveBeenCalledTimes(1);
    const responseArg = ctx.json.mock.calls[0][0] as { wallet: Record<string, unknown> };
    expect(responseArg.wallet).not.toHaveProperty('encryptedPrivateKey');
    expect(responseArg.wallet).not.toHaveProperty('privateKey');
    expect(responseArg.wallet.address).toBe('0xabc123');
    expect(responseArg.wallet.userId).toBe('user-42');
    expect(result).toEqual(responseArg);
  });

  it('custom chain and label are passed through correctly', async () => {
    const adapterCreate = vi.fn().mockResolvedValue({ id: 'wallet-2' });
    const handlers = extractHandlers({ encryptionKey: ENCRYPTION_KEY });
    const locktekInstance = MockLocktek.mock.results[0].value;
    locktekInstance.createAndEncryptWallet.mockResolvedValue({
      ...MOCK_WALLET_DATA,
      chain: 'base-sepolia',
    });

    const ctx = buildCtx({
      body: { chain: 'base-sepolia', label: 'Treasury' },
      adapter: {
        create: adapterCreate,
        findOne: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
    });

    await handlers.createWallet(ctx);

    expect(locktekInstance.createAndEncryptWallet).toHaveBeenCalledWith('base-sepolia');
    expect(adapterCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          label: 'Treasury',
        }),
      }),
    );

    const responseArg = ctx.json.mock.calls[0][0] as { wallet: Record<string, unknown> };
    expect(responseArg.wallet.label).toBe('Treasury');
  });

  it('throws BAD_REQUEST when encryption is not configured', async () => {
    const handlers = extractHandlers(); // no encryptionKey
    const ctx = buildCtx({ body: { chain: 'ethereum-sepolia' } });

    await expect(handlers.createWallet(ctx)).rejects.toThrow(MockAPIError);
    await expect(handlers.createWallet(ctx)).rejects.toThrow(/[Ee]ncryption key required/);
  });

  it('throws BAD_REQUEST when no chain is specified and no defaultChain', async () => {
    const handlers = extractHandlers({ encryptionKey: ENCRYPTION_KEY });
    const locktekInstance = MockLocktek.mock.results[0].value;
    // Override defaultChain to be falsy
    locktekInstance.defaultChain = undefined;

    const ctx = buildCtx({ body: {} });

    await expect(handlers.createWallet(ctx)).rejects.toThrow(MockAPIError);
    await expect(handlers.createWallet(ctx)).rejects.toThrow(/[Nn]o chain specified/);
  });

  it('throws BAD_REQUEST for an invalid chain name (H-6 validation)', async () => {
    const handlers = extractHandlers({ encryptionKey: ENCRYPTION_KEY });

    const ctx = buildCtx({ body: { chain: 'solana' } });

    await expect(handlers.createWallet(ctx)).rejects.toThrow(MockAPIError);

    try {
      await handlers.createWallet(ctx);
    } catch (err) {
      const apiErr = err as InstanceType<typeof MockAPIError>;
      expect(apiErr.status).toBe('BAD_REQUEST');
      expect(apiErr.body?.message).toContain('Invalid chain');
      expect(apiErr.body?.message).toContain('solana');
      expect(apiErr.body?.message).toContain('ethereum');
    }
  });

  it('throws INTERNAL_SERVER_ERROR when encryptedPrivateKey is missing from wallet data', async () => {
    const handlers = extractHandlers({ encryptionKey: ENCRYPTION_KEY });
    const locktekInstance = MockLocktek.mock.results[0].value;
    locktekInstance.createAndEncryptWallet.mockResolvedValue({
      ...MOCK_WALLET_DATA,
      encryptedPrivateKey: undefined,
    });

    const ctx = buildCtx({ body: { chain: 'ethereum-sepolia' } });

    await expect(handlers.createWallet(ctx)).rejects.toThrow(MockAPIError);

    try {
      await handlers.createWallet(ctx);
    } catch (err) {
      const apiErr = err as InstanceType<typeof MockAPIError>;
      expect(apiErr.status).toBe('INTERNAL_SERVER_ERROR');
    }
  });

  it('propagates adapter.create errors', async () => {
    const adapterCreate = vi.fn().mockRejectedValue(new Error('DB write failed'));
    const handlers = extractHandlers({ encryptionKey: ENCRYPTION_KEY });
    const locktekInstance = MockLocktek.mock.results[0].value;
    locktekInstance.createAndEncryptWallet.mockResolvedValue(MOCK_WALLET_DATA);

    const ctx = buildCtx({
      body: { chain: 'ethereum-sepolia' },
      adapter: {
        create: adapterCreate,
        findOne: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
    });

    await expect(handlers.createWallet(ctx)).rejects.toThrow('DB write failed');
  });

  it('encryptedPrivateKey is stored in DB but never in the response', async () => {
    const adapterCreate = vi.fn().mockResolvedValue({ id: 'wallet-secure' });
    const handlers = extractHandlers({ encryptionKey: ENCRYPTION_KEY });
    const locktekInstance = MockLocktek.mock.results[0].value;
    locktekInstance.createAndEncryptWallet.mockResolvedValue(MOCK_WALLET_DATA);

    const ctx = buildCtx({
      body: { chain: 'ethereum-sepolia' },
      adapter: {
        create: adapterCreate,
        findOne: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
    });

    await handlers.createWallet(ctx);

    // DB record MUST contain encryptedPrivateKey
    const dbData = adapterCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(dbData.encryptedPrivateKey).toBe('enc:secret-key');

    // Response MUST NOT contain encryptedPrivateKey or privateKey
    const response = ctx.json.mock.calls[0][0] as { wallet: Record<string, unknown> };
    expect(response.wallet).not.toHaveProperty('encryptedPrivateKey');
    expect(response.wallet).not.toHaveProperty('privateKey');
  });
});

// ---------------------------------------------------------------------------
// get-wallets handler tests
// ---------------------------------------------------------------------------
describe('getWallets handler', () => {
  beforeEach(() => {
    MockLocktek.mockClear();
  });

  it('returns wallets for the authenticated user', async () => {
    const mockWallets = [
      {
        id: 'w1',
        userId: 'user-1',
        address: '0xaaa',
        chain: 'ethereum-sepolia',
        chainFamily: 'evm',
        publicKey: '0xpub1',
        encryptedPrivateKey: 'enc:secret1',
        label: 'Main',
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 'w2',
        userId: 'user-1',
        address: '0xbbb',
        chain: 'base-sepolia',
        chainFamily: 'evm',
        publicKey: '0xpub2',
        encryptedPrivateKey: 'enc:secret2',
        label: null,
        createdAt: new Date('2026-01-02'),
      },
    ];

    const adapterFindMany = vi.fn().mockResolvedValue(mockWallets);
    const handlers = extractHandlers();
    const ctx = buildCtx({
      userId: 'user-1',
      adapter: { findMany: adapterFindMany, findOne: vi.fn(async () => null) },
    });

    const result = await handlers.getWallets(ctx);

    // Verify adapter.findMany was called with correct filter
    expect(adapterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'locktekWallet',
        where: [{ field: 'userId', value: 'user-1' }],
      }),
    );

    // Verify response sanitization — no encryptedPrivateKey
    const responseArg = ctx.json.mock.calls[0][0] as { wallets: Record<string, unknown>[] };
    expect(responseArg.wallets).toHaveLength(2);

    for (const wallet of responseArg.wallets) {
      expect(wallet).not.toHaveProperty('encryptedPrivateKey');
      expect(wallet).toHaveProperty('address');
      expect(wallet).toHaveProperty('chain');
      expect(wallet).toHaveProperty('publicKey');
    }

    expect(responseArg.wallets[0].label).toBe('Main');
    expect(responseArg.wallets[1].label).toBeNull();
    expect(result).toEqual(responseArg);
  });

  it('returns empty array when user has no wallets', async () => {
    const adapterFindMany = vi.fn().mockResolvedValue([]);
    const handlers = extractHandlers();
    const ctx = buildCtx({
      userId: 'user-empty',
      adapter: { findMany: adapterFindMany, findOne: vi.fn(async () => null) },
    });

    await handlers.getWallets(ctx);

    const responseArg = ctx.json.mock.calls[0][0] as { wallets: unknown[] };
    expect(responseArg.wallets).toEqual([]);
  });

  it('sanitized wallets exclude encryptedPrivateKey even if present in DB records', async () => {
    const mockWallets = [
      {
        id: 'w1',
        userId: 'user-1',
        address: '0xaaa',
        chain: 'ethereum-sepolia',
        chainFamily: 'evm',
        publicKey: '0xpub1',
        encryptedPrivateKey: 'enc:should-never-appear',
        privateKey: 'raw-should-never-appear',
        extraField: 'should-also-be-stripped',
        label: null,
        createdAt: new Date('2026-01-01'),
      },
    ];

    const adapterFindMany = vi.fn().mockResolvedValue(mockWallets);
    const handlers = extractHandlers();
    const ctx = buildCtx({
      adapter: { findMany: adapterFindMany, findOne: vi.fn(async () => null) },
    });

    await handlers.getWallets(ctx);

    const responseArg = ctx.json.mock.calls[0][0] as { wallets: Record<string, unknown>[] };
    const wallet = responseArg.wallets[0];
    expect(wallet).not.toHaveProperty('encryptedPrivateKey');
    expect(wallet).not.toHaveProperty('privateKey');
    expect(wallet).not.toHaveProperty('extraField');

    // Only expected keys are present
    const keys = Object.keys(wallet);
    expect(keys.sort()).toEqual(
      ['id', 'userId', 'address', 'chain', 'chainFamily', 'publicKey', 'label', 'createdAt'].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// get-balance handler tests
// ---------------------------------------------------------------------------
describe('getBalance handler', () => {
  beforeEach(() => {
    MockLocktek.mockClear();
  });

  it('happy path: returns balance for address on specified chain', async () => {
    const handlers = extractHandlers({ chains: ['ethereum-sepolia'] });
    const locktekInstance = MockLocktek.mock.results[0].value;
    locktekInstance.getBalanceFormatted.mockResolvedValue({
      balance: '1000000000000000000',
      balanceFormatted: '1.000000000000000000',
      decimals: 18,
      symbol: 'ETH',
    });

    const ctx = buildCtx({
      body: { address: '0xabc', chain: 'ethereum-sepolia' },
    });

    const result = await handlers.getBalance(ctx);

    expect(locktekInstance.getBalanceFormatted).toHaveBeenCalledWith('0xabc', 'ethereum-sepolia');
    // The response now carries whole units alongside base units, so a consumer never
    // has to divide by 10^18 itself.
    const expected = {
      address: '0xabc',
      chain: 'ethereum-sepolia',
      balance: '1000000000000000000',
      balanceFormatted: '1.000000000000000000',
      decimals: 18,
      symbol: 'ETH',
    };
    expect(ctx.json).toHaveBeenCalledWith(expected);
    expect(result).toEqual(expected);
  });

  it('uses defaultChain when no chain is provided in body', async () => {
    const handlers = extractHandlers({ chains: ['base-sepolia'], defaultChain: 'base-sepolia' });
    const locktekInstance = MockLocktek.mock.results[0].value;
    locktekInstance.getBalanceFormatted.mockResolvedValue({
      balance: '500',
      balanceFormatted: '0.000000000000000500',
      decimals: 18,
      symbol: 'ETH',
    });

    const ctx = buildCtx({
      body: { address: '0xdef' },
    });

    await handlers.getBalance(ctx);

    // The handler resolves chain from locktek.defaultChain
    expect(locktekInstance.getBalanceFormatted).toHaveBeenCalledWith('0xdef', expect.any(String));
    expect(ctx.json).toHaveBeenCalledTimes(1);
  });

  it('throws BAD_REQUEST when no chain specified and no defaultChain', async () => {
    const handlers = extractHandlers();
    const locktekInstance = MockLocktek.mock.results[0].value;
    locktekInstance.defaultChain = undefined;

    const ctx = buildCtx({
      body: { address: '0xabc' },
    });

    await expect(handlers.getBalance(ctx)).rejects.toThrow(MockAPIError);
    await expect(handlers.getBalance(ctx)).rejects.toThrow(/[Nn]o chain specified/);
  });

  it('throws BAD_REQUEST for invalid chain name (H-6 validation)', async () => {
    const handlers = extractHandlers();

    const ctx = buildCtx({
      body: { address: '0xabc', chain: 'solana' },
    });

    await expect(handlers.getBalance(ctx)).rejects.toThrow(MockAPIError);

    try {
      await handlers.getBalance(ctx);
    } catch (err) {
      const apiErr = err as InstanceType<typeof MockAPIError>;
      expect(apiErr.status).toBe('BAD_REQUEST');
      expect(apiErr.body?.message).toContain('Invalid chain');
      expect(apiErr.body?.message).toContain('solana');
    }
  });

  it('throws BAD_REQUEST for another invalid chain name "avalanche"', async () => {
    const handlers = extractHandlers();

    const ctx = buildCtx({
      body: { address: '0xabc', chain: 'avalanche' },
    });

    try {
      await handlers.getBalance(ctx);
      expect.fail('Should have thrown');
    } catch (err) {
      const apiErr = err as InstanceType<typeof MockAPIError>;
      expect(apiErr.status).toBe('BAD_REQUEST');
      expect(apiErr.body?.message).toContain('Invalid chain');
      expect(apiErr.body?.message).toContain('avalanche');
    }
  });

  it('wraps network errors in INTERNAL_SERVER_ERROR', async () => {
    const handlers = extractHandlers();
    const locktekInstance = MockLocktek.mock.results[0].value;
    locktekInstance.getBalanceFormatted.mockRejectedValue(new Error('RPC timeout'));

    const ctx = buildCtx({
      body: { address: '0xabc', chain: 'ethereum-sepolia' },
    });

    try {
      await handlers.getBalance(ctx);
      expect.fail('Should have thrown');
    } catch (err) {
      const apiErr = err as InstanceType<typeof MockAPIError>;
      expect(apiErr.status).toBe('INTERNAL_SERVER_ERROR');
      expect(apiErr.body?.message).toContain('RPC timeout');
    }
  });

  it('re-throws APIError instances from Locktek without wrapping', async () => {
    const handlers = extractHandlers();
    const locktekInstance = MockLocktek.mock.results[0].value;
    const originalError = new MockAPIError('NOT_FOUND', { message: 'Address not found' });
    locktekInstance.getBalanceFormatted.mockRejectedValue(originalError);

    const ctx = buildCtx({
      body: { address: '0xabc', chain: 'ethereum-sepolia' },
    });

    try {
      await handlers.getBalance(ctx);
      expect.fail('Should have thrown');
    } catch (err) {
      // The error should be the same instance, not wrapped
      expect(err).toBe(originalError);
    }
  });

  it('provides a fallback error message for non-Error thrown values', async () => {
    const handlers = extractHandlers();
    const locktekInstance = MockLocktek.mock.results[0].value;
    locktekInstance.getBalanceFormatted.mockRejectedValue('string error');

    const ctx = buildCtx({
      body: { address: '0xabc', chain: 'ethereum-sepolia' },
    });

    try {
      await handlers.getBalance(ctx);
      expect.fail('Should have thrown');
    } catch (err) {
      const apiErr = err as InstanceType<typeof MockAPIError>;
      expect(apiErr.status).toBe('INTERNAL_SERVER_ERROR');
      expect(apiErr.body?.message).toContain('Failed to retrieve balance');
    }
  });

  it('accepts all valid chain names without throwing', async () => {
    const validChains: Chain[] = [
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
      'tron',
      'tron-shasta',
    ];

    for (const chain of validChains) {
      MockLocktek.mockClear();
      const handlers = extractHandlers();
      const locktekInstance = MockLocktek.mock.results[0].value;
      locktekInstance.getBalanceFormatted.mockResolvedValue({
        balance: '0',
        balanceFormatted: '0.000000000000000000',
        decimals: 18,
        symbol: 'ETH',
      });

      const ctx = buildCtx({
        body: { address: '0xabc', chain },
      });

      // Should NOT throw
      await handlers.getBalance(ctx);
      expect(ctx.json).toHaveBeenCalledTimes(1);
    }
  });
});

// ---------------------------------------------------------------------------
// H-6 chain validation — cross-endpoint coverage
// ---------------------------------------------------------------------------
describe('H-6: chain validation across endpoints', () => {
  beforeEach(() => {
    MockLocktek.mockClear();
  });

  it('createWallet rejects invalid chain names', async () => {
    const handlers = extractHandlers({ encryptionKey: 'test-key-minimum-length-32chars!' });

    for (const invalidChain of ['solana', 'bitcoin', 'dogecoin', 'ETHEREUM']) {
      const ctx = buildCtx({ body: { chain: invalidChain } });

      try {
        await handlers.createWallet(ctx);
        expect.fail(`Should have thrown for chain: "${invalidChain}"`);
      } catch (err) {
        const apiErr = err as InstanceType<typeof MockAPIError>;
        expect(apiErr.status).toBe('BAD_REQUEST');
        expect(apiErr.body?.message).toContain('Invalid chain');
      }
    }
  });

  it('createWallet treats empty-string chain as missing (caught by no-chain check)', async () => {
    const handlers = extractHandlers({ encryptionKey: 'test-key-minimum-length-32chars!' });
    const locktekInstance = MockLocktek.mock.results[0].value;
    locktekInstance.defaultChain = undefined;

    const ctx = buildCtx({ body: { chain: '' } });

    await expect(handlers.createWallet(ctx)).rejects.toThrow(/[Nn]o chain specified/);
  });

  it('getBalance rejects invalid chain names', async () => {
    const handlers = extractHandlers();

    for (const invalidChain of ['solana', 'bitcoin', 'dogecoin', 'ETHEREUM']) {
      const ctx = buildCtx({ body: { address: '0xabc', chain: invalidChain } });

      try {
        await handlers.getBalance(ctx);
        expect.fail(`Should have thrown for chain: "${invalidChain}"`);
      } catch (err) {
        const apiErr = err as InstanceType<typeof MockAPIError>;
        expect(apiErr.status).toBe('BAD_REQUEST');
        expect(apiErr.body?.message).toContain('Invalid chain');
      }
    }
  });

  it('getBalance treats empty-string chain as missing (caught by no-chain check)', async () => {
    const handlers = extractHandlers();
    const locktekInstance = MockLocktek.mock.results[0].value;
    locktekInstance.defaultChain = undefined;

    const ctx = buildCtx({ body: { address: '0xabc', chain: '' } });

    await expect(handlers.getBalance(ctx)).rejects.toThrow(/[Nn]o chain specified/);
  });

  it('error message lists all supported chains', async () => {
    const handlers = extractHandlers({ encryptionKey: 'test-key-minimum-length-32chars!' });
    const ctx = buildCtx({ body: { chain: 'invalid' } });

    try {
      await handlers.createWallet(ctx);
    } catch (err) {
      const apiErr = err as InstanceType<typeof MockAPIError>;
      const message = apiErr.body?.message ?? '';
      // Verify the error message includes the supported chains
      expect(message).toContain('ethereum');
      expect(message).toContain('base-sepolia');
      expect(message).toContain('tron');
    }
  });
});
