import { describe, it, expect, vi } from 'vitest';
import { locktekClient } from '../client.js';

/**
 * The example app calls `authClient.locktek.createWallet()`. These tests pin the shape
 * that makes that work — a flat `getActions` return merges onto the client root
 * instead, which typechecks against the base interface while breaking every call site.
 */
describe('locktekClient', () => {
  const plugin = locktekClient();

  it('namespaces its actions under `locktek`', () => {
    const actions = plugin.getActions(vi.fn() as never, null as never, null as never);

    expect(Object.keys(actions)).toEqual(['locktek']);
    expect(Object.keys(actions.locktek).sort()).toEqual([
      'createWallet',
      'exportWallet',
      'getBalance',
      'getWallets',
    ]);
  });

  it('declares a method for every path it calls', () => {
    expect(plugin.pathMethods).toEqual({
      '/locktek/wallets': 'GET',
      '/locktek/create-wallet': 'POST',
      '/locktek/balance': 'POST',
      '/locktek/export-wallet': 'POST',
    });
  });

  it('sends only the acknowledgement the caller supplied, never one of its own', async () => {
    const $fetch = vi.fn().mockResolvedValue({ data: null });
    const actions = plugin.getActions($fetch as never, null as never, null as never);

    await actions.locktek.exportWallet({
      walletId: 'wallet-1',
      acknowledgement: 'I understand this reveals my private key',
    });

    expect($fetch).toHaveBeenCalledWith(
      '/locktek/export-wallet',
      expect.objectContaining({
        method: 'POST',
        body: {
          walletId: 'wallet-1',
          acknowledgement: 'I understand this reveals my private key',
        },
      }),
    );
  });

  it('posts an empty body when createWallet is called with no arguments', async () => {
    const $fetch = vi.fn().mockResolvedValue({ data: null });
    const actions = plugin.getActions($fetch as never, null as never, null as never);

    await actions.locktek.createWallet();

    expect($fetch).toHaveBeenCalledWith(
      '/locktek/create-wallet',
      expect.objectContaining({ method: 'POST', body: {} }),
    );
  });

  it('forwards createWallet arguments as the request body', async () => {
    const $fetch = vi.fn().mockResolvedValue({ data: null });
    const actions = plugin.getActions($fetch as never, null as never, null as never);

    await actions.locktek.createWallet({ chain: 'base-sepolia', label: 'test' });

    expect($fetch).toHaveBeenCalledWith('/locktek/create-wallet', {
      method: 'POST',
      body: { chain: 'base-sepolia', label: 'test' },
    });
  });

  it('requests wallets with no body', async () => {
    const $fetch = vi.fn().mockResolvedValue({ data: null });
    const actions = plugin.getActions($fetch as never, null as never, null as never);

    await actions.locktek.getWallets();

    expect($fetch).toHaveBeenCalledWith('/locktek/wallets');
  });

  it('posts address and chain when checking a balance', async () => {
    const $fetch = vi.fn().mockResolvedValue({ data: null });
    const actions = plugin.getActions($fetch as never, null as never, null as never);

    await actions.locktek.getBalance({ address: '0xabc', chain: 'base-sepolia' });

    expect($fetch).toHaveBeenCalledWith('/locktek/balance', {
      method: 'POST',
      body: { address: '0xabc', chain: 'base-sepolia' },
    });
  });

  it('exposes the plugin id the server plugin registers under', () => {
    expect(plugin.id).toBe('locktek');
  });
});
