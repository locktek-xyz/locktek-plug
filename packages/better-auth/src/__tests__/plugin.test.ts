import { describe, it, expect, vi } from 'vitest';

const { MockLocktek } = vi.hoisted(() => {
  const MockLocktek = vi.fn().mockImplementation((opts: Record<string, unknown>) => ({
    chains: opts.chains ?? ['ethereum-sepolia'],
    defaultChain: opts.defaultChain ?? (opts.chains as string[])?.[0] ?? 'ethereum-sepolia',
    createWallet: vi.fn(),
    createAndEncryptWallet: vi.fn(),
    getBalance: vi.fn(),
  }));
  return { MockLocktek };
});

// Mock @locktek/core so the Locktek constructor does not attempt real chain setup
vi.mock('@locktek/core', () => ({
  Locktek: MockLocktek,
}));

// Mock better-auth/api so endpoint factory functions return inspectable objects
vi.mock('better-auth/api', () => {
  const sessionMiddleware = { id: 'session' };
  return {
    sessionMiddleware,
    freshSessionMiddleware: { id: 'fresh-session' },
    APIError: class APIError extends Error {
      constructor(
        public code: string,
        public details: { message: string },
      ) {
        super(details.message);
      }
    },
    createAuthEndpoint: (
      path: string,
      config: { method: string; body?: unknown; use?: unknown[]; metadata?: unknown },
      _handler: unknown,
    ) => ({
      path,
      method: config.method,
      body: config.body,
      use: config.use,
      metadata: config.metadata,
      handler: _handler,
    }),
  };
});

import { locktekPlugin } from '../plugin.js';
import { locktekWalletSchema } from '../schema.js';
import type { LocktekPluginOptions } from '../types.js';

// ---------------------------------------------------------------------------
// Plugin Construction Tests
// ---------------------------------------------------------------------------
describe('locktekPlugin', () => {
  it('returns a valid plugin with id "locktek", schema, and its endpoints', () => {
    const plugin = locktekPlugin();

    expect(plugin.id).toBe('locktek');
    expect(plugin.schema).toBeDefined();
    expect(Object.keys(plugin.endpoints!).sort()).toEqual([
      'createWallet',
      'getBalance',
      'getWallets',
    ]);
  });

  it('does not expose private-key export unless the application enables it', () => {
    expect(Object.keys(locktekPlugin().endpoints!)).not.toContain('exportWallet');
    expect(
      Object.keys(
        locktekPlugin({ walletExport: { enabled: false, onExport: vi.fn() } }).endpoints!,
      ),
    ).not.toContain('exportWallet');
  });

  it('exposes export behind a fresh session when enabled with an audit hook', () => {
    const plugin = locktekPlugin({ walletExport: { enabled: true, onExport: vi.fn() } });
    const endpoint = plugin.endpoints!.exportWallet as unknown as { use: { id: string }[] };

    expect(endpoint.use).toEqual([{ id: 'fresh-session' }]);
  });

  it('refuses to enable export without an audit hook', () => {
    expect(() =>
      locktekPlugin({
        walletExport: { enabled: true } as unknown as LocktekPluginOptions['walletExport'],
      }),
    ).toThrow(/onExport/);
  });

  it('has endpoint keys: createWallet, getWallets, getBalance', () => {
    const plugin = locktekPlugin();
    const endpointKeys = Object.keys(plugin.endpoints!);

    expect(endpointKeys).toContain('createWallet');
    expect(endpointKeys).toContain('getWallets');
    expect(endpointKeys).toContain('getBalance');
  });

  it('defaults chains to ["ethereum-sepolia"] and testnet to true', () => {
    MockLocktek.mockClear();
    locktekPlugin();

    expect(MockLocktek).toHaveBeenCalledWith(
      expect.objectContaining({
        chains: ['ethereum-sepolia'],
        testnet: true,
      }),
    );
  });

  it('accepts custom options and forwards them to Locktek', () => {
    MockLocktek.mockClear();
    const opts: LocktekPluginOptions = {
      chains: ['base-sepolia'],
      encryptionKey: 'test-key-minimum-length-32chars!',
      testnet: false,
    };
    locktekPlugin(opts);

    expect(MockLocktek).toHaveBeenCalledWith(
      expect.objectContaining({
        chains: ['base-sepolia'],
        encryptionKey: 'test-key-minimum-length-32chars!',
        testnet: false,
      }),
    );
  });

  it('attaches the locktekWalletSchema to the plugin schema', () => {
    const plugin = locktekPlugin();
    expect(plugin.schema).toEqual(locktekWalletSchema);
  });
});

// ---------------------------------------------------------------------------
// Schema Tests
// ---------------------------------------------------------------------------
describe('locktekWalletSchema', () => {
  const schema = locktekWalletSchema;
  const table = schema.locktekWallet;

  it('defines a "locktekWallet" table', () => {
    expect(table).toBeDefined();
    expect(table.fields).toBeDefined();
  });

  it('contains all required fields', () => {
    const fieldNames = Object.keys(table.fields);

    expect(fieldNames).toContain('userId');
    expect(fieldNames).toContain('address');
    expect(fieldNames).toContain('chain');
    expect(fieldNames).toContain('chainFamily');
    expect(fieldNames).toContain('publicKey');
    expect(fieldNames).toContain('encryptedPrivateKey');
    expect(fieldNames).toContain('label');
    expect(fieldNames).toContain('createdAt');
  });

  it('userId references the user model with cascade delete and is indexed', () => {
    const userId = table.fields.userId;

    expect(userId.type).toBe('string');
    expect(userId.required).toBe(true);
    expect(userId.references).toEqual({
      model: 'user',
      field: 'id',
      onDelete: 'cascade',
    });
    expect('index' in userId && userId.index).toBe(true);
  });

  it('address field is indexed', () => {
    const address = table.fields.address;

    expect(address.type).toBe('string');
    expect(address.required).toBe(true);
    expect('index' in address && address.index).toBe(true);
  });

  it('encryptedPrivateKey has returned: false so it is never exposed in queries', () => {
    const epk = table.fields.encryptedPrivateKey;

    expect(epk.type).toBe('string');
    expect(epk.required).toBe(true);
    expect('returned' in epk && epk.returned).toBe(false);
  });

  it('marks only label and encryptedMnemonic optional', () => {
    const { label, encryptedMnemonic, ...requiredFields } = table.fields;

    expect(label.required).toBe(false);
    // Optional so a wallet imported from a raw private key, which has no mnemonic,
    // can still be stored.
    expect(encryptedMnemonic.required).toBe(false);

    for (const [, field] of Object.entries(requiredFields)) {
      expect(field.required).toBe(true);
    }
  });

  it('enforces one wallet per user and chain at the database level', () => {
    expect(table.fields.walletKey.unique).toBe(true);
  });

  it('never returns key material by default', () => {
    expect(table.fields.encryptedPrivateKey.returned).toBe(false);
    expect(table.fields.encryptedMnemonic.returned).toBe(false);
  });

  it('createdAt field is of type "date"', () => {
    expect(table.fields.createdAt.type).toBe('date');
  });
});
