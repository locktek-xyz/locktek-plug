import { describe, it, expect, afterEach } from 'vitest';
import { createLocktek } from '../locktek.js';
import { registerChain, unregisterChain } from '../adapters/factory.js';
import { EvmAdapter } from '../adapters/evm.adapter.js';
import { parseNativeAmount } from '../utils/format.js';

/**
 * The snippets in the root README, executed.
 *
 * Documentation that does not compile is worse than no documentation: it costs a new
 * user their first thirty minutes and their trust. These tests fail when the README
 * drifts from the API.
 */
describe('README examples', () => {
  afterEach(() => {
    unregisterChain('my-l2');
  });

  it('"The bug this library exists to prevent" — unit conversion', () => {
    expect(parseNativeAmount('1', 18)).toBe(1000000000000000000n);
    expect(parseNativeAmount('0.1', 18)).toBe(100000000000000000n);
    expect(() => parseNativeAmount('1000000000000000000', 18)).toThrow(
      /amounts are expressed in whole units, not base units/,
    );
  });

  it('"Quickstart" — create, encrypt, and verifiably recover a wallet', async () => {
    const locktek = createLocktek({
      chains: ['ethereum-sepolia'],
      encryptionKey: 'a'.repeat(64),
    });

    const wallet = await locktek.createAndEncryptWallet();
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet.encryptedPrivateKey).toBeTypeOf('string');
    expect(wallet.encryptedMnemonic).toBeTypeOf('string');

    const recovered = await locktek.recoverWallet({
      encryptedPrivateKey: wallet.encryptedPrivateKey,
      chain: wallet.chain,
    });
    expect(recovered.address).toBe(wallet.address);
  });

  it('"Supported chains" — registerChain adds a chain without a fork', async () => {
    registerChain({
      chain: 'my-l2',
      network: {
        chainId: 12345,
        name: 'My L2',
        symbol: 'ETH',
        decimals: 18,
        chainFamily: 'evm',
        rpcUrls: ['https://rpc.my-l2.example', 'https://rpc2.my-l2.example'],
        explorerUrl: 'https://explorer.my-l2.example',
        isTestnet: false,
      },
      createAdapter: (chain, options) => new EvmAdapter(chain, options),
    });

    const locktek = createLocktek({ chains: ['my-l2'], testnet: false });

    expect(locktek.defaultChain).toBe('my-l2');
    expect(locktek.validateAddress('0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C')).toBe(true);
  });

  it('"Testnet by default" — a mainnet chain is refused unless testnet is disabled', () => {
    expect(() => createLocktek({ chains: ['ethereum'] })).toThrow(/testnet mode is enabled/i);
    expect(createLocktek({ chains: ['ethereum'], testnet: false }).defaultChain).toBe('ethereum');
  });
});
