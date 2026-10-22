import { describe, it, expect, vi } from 'vitest';
import { locktekPlugin } from '../plugin.js';
import { createFakeAdapter } from './helpers/fake-adapter.js';

const ENCRYPTION_KEY = 'a-sufficiently-long-key';

/** Extract the signup hook a plugin contributes through `init`. */
function signupHookOf(
  plugin: ReturnType<typeof locktekPlugin>,
  adapter: unknown,
  existing?: unknown,
) {
  const init = plugin.init as (ctx: unknown) => { options?: { databaseHooks?: unknown } };
  const result = init({ adapter, options: { databaseHooks: existing } });

  return (
    result.options?.databaseHooks as {
      user?: { create?: { after?: (user: unknown, ctx: unknown) => Promise<void> } };
    }
  )?.user?.create?.after;
}

describe('automatic wallet provisioning on signup', () => {
  it('registers no signup hook when autoCreateWallet is off', () => {
    const plugin = locktekPlugin({ chains: ['ethereum-sepolia'], encryptionKey: ENCRYPTION_KEY });
    expect(plugin.init).toBeUndefined();
  });

  it('provisions a wallet on the default chain when enabled', async () => {
    const adapter = createFakeAdapter();
    const plugin = locktekPlugin({
      chains: ['ethereum-sepolia'],
      encryptionKey: ENCRYPTION_KEY,
      autoCreateWallet: true,
    });

    await signupHookOf(plugin, adapter)!({ id: 'user-1' }, null);

    expect(adapter.rows).toHaveLength(1);
    expect(adapter.rows[0]).toMatchObject({ userId: 'user-1', chain: 'ethereum-sepolia' });
  });

  it('provisions one wallet per requested chain', async () => {
    const adapter = createFakeAdapter();
    const plugin = locktekPlugin({
      chains: ['ethereum-sepolia', 'base-sepolia'],
      encryptionKey: ENCRYPTION_KEY,
      autoCreateWallet: ['ethereum-sepolia', 'base-sepolia'],
    });

    await signupHookOf(plugin, adapter)!({ id: 'user-1' }, null);

    expect(adapter.rows.map((r) => r.chain).sort()).toEqual(['base-sepolia', 'ethereum-sepolia']);
  });

  it('creates exactly one wallet when the hook runs twice', async () => {
    const adapter = createFakeAdapter();
    const plugin = locktekPlugin({
      chains: ['ethereum-sepolia'],
      encryptionKey: ENCRYPTION_KEY,
      autoCreateWallet: true,
    });

    const hook = signupHookOf(plugin, adapter)!;
    await hook({ id: 'user-1' }, null);
    await hook({ id: 'user-1' }, null);

    expect(adapter.rows).toHaveLength(1);
  });

  it('persists the encrypted mnemonic, so the wallet stays recoverable', async () => {
    const adapter = createFakeAdapter();
    const plugin = locktekPlugin({
      chains: ['ethereum-sepolia'],
      encryptionKey: ENCRYPTION_KEY,
      autoCreateWallet: true,
    });

    await signupHookOf(plugin, adapter)!({ id: 'user-1' }, null);

    expect(adapter.rows[0].encryptedMnemonic).toEqual(expect.any(String));
    expect(adapter.rows[0].encryptedPrivateKey).toEqual(expect.any(String));
  });

  describe('failure policy', () => {
    it('fails the signup by default, so no user is silently left without a wallet', async () => {
      const adapter = createFakeAdapter();
      adapter.create.mockRejectedValueOnce(new Error('database unavailable'));

      const plugin = locktekPlugin({
        chains: ['ethereum-sepolia'],
        encryptionKey: ENCRYPTION_KEY,
        autoCreateWallet: true,
      });

      await expect(signupHookOf(plugin, adapter)!({ id: 'user-1' }, null)).rejects.toThrow(
        'database unavailable',
      );
    });

    it('lets signup proceed when continue is chosen explicitly', async () => {
      const adapter = createFakeAdapter();
      adapter.create.mockRejectedValueOnce(new Error('database unavailable'));

      const plugin = locktekPlugin({
        chains: ['ethereum-sepolia'],
        encryptionKey: ENCRYPTION_KEY,
        autoCreateWallet: true,
        onWalletCreationError: 'continue',
      });

      await expect(signupHookOf(plugin, adapter)!({ id: 'user-1' }, null)).resolves.toBeUndefined();
      expect(adapter.rows).toHaveLength(0);
    });

    it('fails when no adapter is available at all', async () => {
      const plugin = locktekPlugin({
        chains: ['ethereum-sepolia'],
        encryptionKey: ENCRYPTION_KEY,
        autoCreateWallet: true,
      });

      await expect(signupHookOf(plugin, undefined)!({ id: 'user-1' }, null)).rejects.toThrow(
        /no database adapter/,
      );
    });
  });

  it('refuses to start without an encryption key, rather than failing on every signup', () => {
    expect(() => locktekPlugin({ chains: ['ethereum-sepolia'], autoCreateWallet: true })).toThrow(
      /autoCreateWallet requires encryptionKey/,
    );
  });

  // better-auth runs the application's own databaseHooks itself, alongside each
  // plugin's. Calling them from the plugin's hook as well ran every one of them twice.
  it("leaves the application's own signup hook to better-auth instead of calling it again", async () => {
    const adapter = createFakeAdapter();
    const existingHook = vi.fn(async () => undefined);

    const plugin = locktekPlugin({
      chains: ['ethereum-sepolia'],
      encryptionKey: ENCRYPTION_KEY,
      autoCreateWallet: true,
    });

    const hook = signupHookOf(plugin, adapter, { user: { create: { after: existingHook } } })!;
    await hook({ id: 'user-1' }, null);

    expect(existingHook).not.toHaveBeenCalled();
    expect(adapter.rows).toHaveLength(1);
  });

  it('prefers the adapter from the request context when one is supplied', async () => {
    const initAdapter = createFakeAdapter();
    const requestAdapter = createFakeAdapter();

    const plugin = locktekPlugin({
      chains: ['ethereum-sepolia'],
      encryptionKey: ENCRYPTION_KEY,
      autoCreateWallet: true,
    });

    await signupHookOf(plugin, initAdapter)!(
      { id: 'user-1' },
      {
        context: { adapter: requestAdapter },
      },
    );

    expect(requestAdapter.rows).toHaveLength(1);
    expect(initAdapter.rows).toHaveLength(0);
  });
});
