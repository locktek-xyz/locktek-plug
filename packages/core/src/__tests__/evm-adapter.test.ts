import { describe, it, expect, beforeEach, vi } from 'vitest';
import { keccak256, Transaction } from 'ethers';
import {
  createMockProvider,
  encodeUint,
  type MockProviderScript,
} from './helpers/mock-provider.js';
import { EvmAdapter } from '../adapters/evm.adapter.js';
import { ErrorCode } from '../types/common.js';
import { InMemoryIdempotencyStore } from '../tx/idempotency.js';
import { NonceManager } from '../tx/nonce-manager.js';
import type { TransactionParams, UnsignedTransaction } from '../types/transaction.js';

const SENDER = '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C';
const RECIPIENT = '0x0000000000000000000000000000000000000001';
const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

/** Fast policy so failure-path tests do not spend seconds in backoff. */
const FAST = { maxAttempts: 1, baseDelayMs: 1, timeoutMs: 200 };

let harness = createMockProvider();

/** Point a new adapter at the current fake provider. */
function adapterFor(
  chain: Parameters<typeof EvmAdapter>[0] extends never
    ? never
    : 'ethereum-sepolia' | 'bsc-testnet' | 'ethereum',
  extra: Record<string, unknown> = {},
): EvmAdapter {
  return new EvmAdapter(chain, { providerFactory: harness.factory, ...extra });
}

function script(next: MockProviderScript = {}) {
  harness = createMockProvider(next);
  return harness;
}

describe('EvmAdapter', () => {
  beforeEach(() => {
    script();
  });

  describe('constructor', () => {
    it('sets chain and chainFamily', () => {
      const adapter = adapterFor('ethereum-sepolia');
      expect(adapter.chain).toBe('ethereum-sepolia');
      expect(adapter.chainFamily).toBe('evm');
    });

    it('accepts a custom RPC URL', () => {
      const custom = new EvmAdapter('ethereum', {
        rpcUrl: 'https://custom-rpc.example.com',
        providerFactory: harness.factory,
      });
      expect(custom.chain).toBe('ethereum');
    });
  });

  describe('createWallet', () => {
    it('returns a wallet with a valid EVM address', async () => {
      const wallet = await adapterFor('ethereum-sepolia').createWallet();
      expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(wallet.publicKey).toMatch(/^0x(02|03)[0-9a-fA-F]{64}$/);
      expect(wallet.chainFamily).toBe('evm');
    });

    it('generates a different wallet each time', async () => {
      const adapter = adapterFor('ethereum-sepolia');
      const [w1, w2] = await Promise.all([adapter.createWallet(), adapter.createWallet()]);
      expect(w1.address).not.toBe(w2.address);
    });
  });

  describe('importWallet', () => {
    it('round-trips a created wallet', async () => {
      const adapter = adapterFor('ethereum-sepolia');
      const created = await adapter.createWallet();
      const imported = await adapter.importWallet(created.privateKey!);
      expect(imported.address).toBe(created.address);
    });

    it('throws INVALID_PRIVATE_KEY for bad input', async () => {
      await expect(adapterFor('ethereum-sepolia').importWallet('not-a-key')).rejects.toMatchObject({
        code: ErrorCode.INVALID_PRIVATE_KEY,
      });
    });
  });

  describe('validateAddress', () => {
    const adapter = adapterFor('ethereum-sepolia');

    it('accepts a correctly checksummed address', () => {
      expect(adapter.validateAddress(SENDER)).toBe(true);
    });

    it('accepts all-lowercase addresses, which carry no checksum', () => {
      expect(adapter.validateAddress(SENDER.toLowerCase())).toBe(true);
    });

    it('rejects a mixed-case address whose EIP-55 checksum is wrong', () => {
      // A single character case-flipped from the valid address above.
      const typo = '0xA614f803B6FD780986A42c78Ec9c7f77e6DeD13C';
      expect(adapter.validateAddress(typo)).toBe(false);
    });

    it('rejects malformed input', () => {
      expect(adapter.validateAddress('not-an-address')).toBe(false);
      expect(adapter.validateAddress('T1234')).toBe(false);
    });
  });

  describe('getBalance', () => {
    it('returns the balance in base units', async () => {
      script({ getBalance: 123_456n });
      await expect(adapterFor('ethereum-sepolia').getBalance(SENDER)).resolves.toBe('123456');
    });

    it('rejects a bad address before any network call', async () => {
      const s = script();
      await expect(adapterFor('ethereum-sepolia').getBalance('bad-addr')).rejects.toMatchObject({
        code: ErrorCode.INVALID_ADDRESS,
      });
      expect(s.calls.getBalance).not.toHaveBeenCalled();
    });
  });

  describe('amount units', () => {
    it('treats amount as whole units, so "1" sends 10^18 wei — not 1 wei', async () => {
      const adapter = adapterFor('ethereum-sepolia');
      const tx = await adapter.buildTransaction({ from: SENDER, to: RECIPIENT, amount: '1' });

      expect(tx.baseUnitAmount).toBe('1000000000000000000');
      expect(JSON.parse(tx.data).value).toBe('1000000000000000000');
    });

    it('accepts fractional amounts', async () => {
      const adapter = adapterFor('ethereum-sepolia');
      const tx = await adapter.buildTransaction({ from: SENDER, to: RECIPIENT, amount: '0.1' });
      expect(tx.baseUnitAmount).toBe('100000000000000000');
    });

    it('rejects a non-numeric amount before touching the network', async () => {
      const s = script();
      await expect(
        adapterFor('ethereum-sepolia').buildTransaction({
          from: SENDER,
          to: RECIPIENT,
          amount: 'abc',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_AMOUNT });
      expect(s.calls.estimateGas).not.toHaveBeenCalled();
    });

    it('rejects an amount that looks like base units passed by mistake', async () => {
      await expect(
        adapterFor('ethereum-sepolia').buildTransaction({
          from: SENDER,
          to: RECIPIENT,
          amount: '1000000000000000000',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_AMOUNT });
    });

    it('scales a token amount by the token decimals, not the chain decimals', async () => {
      // decimals() returns 6, so "25" USDC must encode as 25000000.
      script({ call: async () => encodeUint(6) });

      const adapter = adapterFor('ethereum-sepolia');
      const tx = await adapter.buildTransaction({
        from: SENDER,
        to: RECIPIENT,
        amount: '25',
        tokenAddress: TOKEN,
      });

      expect(tx.baseUnitAmount).toBe('25000000');
      const txData = JSON.parse(tx.data);
      expect(txData.data).toMatch(/^0xa9059cbb/);
      expect(txData.data.endsWith((25_000_000).toString(16).padStart(64, '0'))).toBe(true);
    });

    it('uses a caller-supplied tokenDecimals without an extra contract read', async () => {
      const s = script();
      const adapter = adapterFor('ethereum-sepolia');
      const tx = await adapter.buildTransaction({
        from: SENDER,
        to: RECIPIENT,
        amount: '25',
        tokenAddress: TOKEN,
        tokenDecimals: 6,
      });

      expect(tx.baseUnitAmount).toBe('25000000');
      expect(s.calls.call).not.toHaveBeenCalled();
    });
  });

  describe('buildTransaction', () => {
    it('builds an EIP-1559 (type 2) transaction on a chain that supports it', async () => {
      const tx = await adapterFor('ethereum-sepolia').buildTransaction({
        from: SENDER,
        to: RECIPIENT,
        amount: '0.001',
      });

      const txData = JSON.parse(tx.data);
      expect(tx.chainId).toBe(11155111);
      expect(txData.type).toBe(2);
      expect(txData.maxFeePerGas).toBeDefined();
      // Assigned when signing, so an unsent build never holds a nonce.
      expect(txData.nonce).toBeUndefined();
    });

    it('builds a legacy (type 0) transaction on BSC, which has no EIP-1559', async () => {
      const tx = await adapterFor('bsc-testnet').buildTransaction({
        from: SENDER,
        to: RECIPIENT,
        amount: '0.001',
      });

      const txData = JSON.parse(tx.data);
      expect(txData.type).toBe(0);
      expect(txData.gasPrice).toBeDefined();
      expect(txData.maxFeePerGas).toBeUndefined();
    });

    it('points a token transfer at the contract and zeroes the native value', async () => {
      const tx = await adapterFor('ethereum-sepolia').buildTransaction({
        from: SENDER,
        to: RECIPIENT,
        amount: '1',
        tokenAddress: TOKEN,
        tokenDecimals: 6,
      });

      const txData = JSON.parse(tx.data);
      expect(txData.to).toBe(TOKEN);
      expect(txData.value).toBe('0');
    });

    it('serialises BigInt fields as strings', async () => {
      const tx = await adapterFor('ethereum-sepolia').buildTransaction({
        from: SENDER,
        to: RECIPIENT,
        amount: '1.5',
      });

      expect(() => JSON.parse(tx.data)).not.toThrow();
      expect(typeof JSON.parse(tx.data).value).toBe('string');
    });

    it('rejects an invalid recipient before estimating gas', async () => {
      const s = script();
      await expect(
        adapterFor('ethereum-sepolia').buildTransaction({
          from: SENDER,
          to: 'not-an-address',
          amount: '1',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_ADDRESS });
      expect(s.calls.estimateGas).not.toHaveBeenCalled();
    });
  });

  describe('nonce allocation', () => {
    /** Nonce of the n-th signed transaction handed to the provider. */
    function broadcastNonce(s: ReturnType<typeof script>, n = 0): number {
      return Transaction.from(s.calls.broadcastTransaction.mock.calls[n][0] as string).nonce;
    }

    async function funded(adapter: EvmAdapter) {
      const wallet = await adapter.createWallet();
      const params: TransactionParams = { from: wallet.address, to: RECIPIENT, amount: '0.001' };
      return { params, key: wallet.privateKey! };
    }

    it('gives concurrent sends from one sender distinct sequential nonces', async () => {
      const s = script({ getTransactionCount: 7 });
      const adapter = adapterFor('ethereum-sepolia');
      const { params, key } = await funded(adapter);

      const txs = await Promise.all(
        Array.from({ length: 5 }, () => adapter.buildTransaction(params)),
      );
      await Promise.all(txs.map((tx) => adapter.signAndSend(tx, key)));

      const nonces = [0, 1, 2, 3, 4].map((n) => broadcastNonce(s, n)).sort((a, b) => a - b);
      expect(nonces).toEqual([7, 8, 9, 10, 11]);
    });

    // Regression: the nonce used to be reserved at build time. A transaction that was
    // built and then not sent — a preview the user cancelled — held its nonce for the
    // life of the process, and every later transfer was accepted by the node but
    // queued behind the gap forever, never mining.
    it('does not consume a nonce for a transaction that is built but never sent', async () => {
      const s = script({ getTransactionCount: 0 });
      const adapter = adapterFor('ethereum-sepolia');
      const { params, key } = await funded(adapter);

      await adapter.buildTransaction(params); // previewed, then abandoned
      const sent = await adapter.buildTransaction(params);
      await adapter.signAndSend(sent, key);

      expect(broadcastNonce(s)).toBe(0);
    });

    it('reuses a nonce whose broadcast the node definitively refused', async () => {
      const s = script({ getTransactionCount: 0 });
      const adapter = adapterFor('ethereum-sepolia', { rpcPolicy: FAST });
      const { params, key } = await funded(adapter);
      s.setScript({
        getTransactionCount: 0,
        broadcast: async () => {
          throw Object.assign(new Error('insufficient funds for gas * price + value'), {
            code: 'INSUFFICIENT_FUNDS',
          });
        },
      });

      await expect(
        adapter.signAndSend(await adapter.buildTransaction(params), key),
      ).rejects.toThrow();
      s.setScript({ getTransactionCount: 0 });
      await adapter.signAndSend(await adapter.buildTransaction(params), key);

      expect(broadcastNonce(s, 1)).toBe(0);
    });

    it('keeps an independent nonce sequence per chain for the same sender', async () => {
      const nonceManager = new NonceManager();
      const s = script({ getTransactionCount: 0 });
      const sepolia = adapterFor('ethereum-sepolia', { nonceManager });
      const bsc = adapterFor('bsc-testnet', { nonceManager });
      const { params, key } = await funded(sepolia);

      await sepolia.signAndSend(await sepolia.buildTransaction(params), key);
      await sepolia.signAndSend(await sepolia.buildTransaction(params), key);
      await bsc.signAndSend(await bsc.buildTransaction(params), key);

      expect(broadcastNonce(s, 2)).toBe(0);
    });

    it('honours a caller-supplied nonce without querying the chain', async () => {
      const s = script();
      const tx = await adapterFor('ethereum-sepolia').buildTransaction({
        from: SENDER,
        to: RECIPIENT,
        amount: '0.001',
        nonce: 42,
      });

      expect(JSON.parse(tx.data).nonce).toBe(42);
      expect(s.calls.getTransactionCount).not.toHaveBeenCalled();
    });
  });

  describe('send safety (review findings)', () => {
    const HANG = () => new Promise<{ hash: string }>(() => undefined);

    // Review H2: before nonces moved to signing time, resending the same built
    // transaction re-signed the same bytes at the same nonce, so at most one could land.
    // Allocating afresh on every call would sign a second, different transfer.
    it('resends the same signed bytes when one built transaction is sent twice without a key', async () => {
      const s = script({ getTransactionCount: 0, broadcast: HANG });
      const adapter = adapterFor('ethereum-sepolia', { rpcPolicy: FAST });
      const wallet = await adapter.createWallet();
      const tx = await adapter.buildTransaction({
        from: wallet.address,
        to: RECIPIENT,
        amount: '0.1',
      });

      await expect(adapter.signAndSend(tx, wallet.privateKey!)).rejects.toThrow(
        /may still confirm/,
      );
      s.setScript({ getTransactionCount: 0 });
      await adapter.signAndSend(tx, wallet.privateKey!);

      const raws = s.calls.broadcastTransaction.mock.calls.map((c) => c[0] as string);
      expect(raws).toHaveLength(2);
      expect(raws[1]).toBe(raws[0]);
    });

    // Review H3: the CLI's file store reclaims a reservation after 60 s on the basis that
    // signing is local work. Reading the nonce inside the reservation broke that.
    it('reads the nonce before reserving the idempotency key', async () => {
      const order: string[] = [];
      const inner = new InMemoryIdempotencyStore();
      const store = {
        get: (k: string) => inner.get(k),
        reserve: async (k: string) => {
          order.push('reserve');
          return inner.reserve(k);
        },
        set: (k: string, v: Parameters<typeof inner.set>[1]) => inner.set(k, v),
        release: (k: string) => inner.release(k),
      };
      script({
        getTransactionCount: async () => {
          order.push('nonce');
          return 0;
        },
      });
      const adapter = adapterFor('ethereum-sepolia', { idempotencyStore: store });
      const wallet = await adapter.createWallet();
      const tx = await adapter.buildTransaction({
        from: wallet.address,
        to: RECIPIENT,
        amount: '0.1',
      });

      await adapter.signAndSend(tx, wallet.privateKey!, { idempotencyKey: 'k' });

      expect(order).toEqual(['nonce', 'reserve']);
    });

    // Review M1: a keyed retry after a timeout resends the recorded bytes, but never told
    // the nonce manager the nonce was spent.
    it('commits the nonce when a keyed retry rebroadcasts the recorded transaction', async () => {
      const nonceManager = new NonceManager();
      const commit = vi.spyOn(nonceManager, 'commit');
      const s = script({ getTransactionCount: 3, broadcast: HANG });
      const adapter = adapterFor('ethereum-sepolia', {
        rpcPolicy: FAST,
        nonceManager,
        idempotencyStore: new InMemoryIdempotencyStore(),
      });
      const wallet = await adapter.createWallet();
      const params = { from: wallet.address, to: RECIPIENT, amount: '0.1' };

      await expect(
        adapter.signAndSend(await adapter.buildTransaction(params), wallet.privateKey!, {
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow();
      s.setScript({ getTransactionCount: 3 });
      await adapter.signAndSend(await adapter.buildTransaction(params), wallet.privateKey!, {
        idempotencyKey: 'k',
      });

      expect(commit).toHaveBeenCalledWith(expect.any(String), 3);
    });

    // Review M3: the fingerprint must describe what is signed, not the advisory params.
    it('refuses a key reused with transaction data edited to a different recipient', async () => {
      script({ getTransactionCount: 0 });
      const adapter = adapterFor('ethereum-sepolia', {
        idempotencyStore: new InMemoryIdempotencyStore(),
      });
      const wallet = await adapter.createWallet();
      const tx = await adapter.buildTransaction({
        from: wallet.address,
        to: RECIPIENT,
        amount: '0.1',
      });
      await adapter.signAndSend(tx, wallet.privateKey!, { idempotencyKey: 'k' });

      const edited = { ...tx, data: tx.data.replace(RECIPIENT, SENDER) };

      await expect(
        adapter.signAndSend(edited, wallet.privateKey!, { idempotencyKey: 'k' }),
      ).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_REUSED });
    });

    it('treats a token transfer as the same request whether or not params.data was passed', async () => {
      const s = script({ getTransactionCount: 0 });
      const adapter = adapterFor('ethereum-sepolia', {
        idempotencyStore: new InMemoryIdempotencyStore(),
      });
      const wallet = await adapter.createWallet();
      const token = {
        from: wallet.address,
        to: RECIPIENT,
        amount: '5',
        tokenAddress: TOKEN,
        tokenDecimals: 6,
      };

      const first = await adapter.signAndSend(
        await adapter.buildTransaction(token),
        wallet.privateKey!,
        {
          idempotencyKey: 'k',
        },
      );
      const again = await adapter.signAndSend(
        await adapter.buildTransaction({ ...token, data: '0xdeadbeef' }),
        wallet.privateKey!,
        { idempotencyKey: 'k' },
      );

      expect(again.hash).toBe(first.hash);
      expect(s.calls.broadcastTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('idempotency key reuse', () => {
    it('refuses a key reused for a different transfer instead of returning the first hash', async () => {
      const s = script({ getTransactionCount: 0 });
      const adapter = adapterFor('ethereum-sepolia', {
        idempotencyStore: new InMemoryIdempotencyStore(),
      });
      const wallet = await adapter.createWallet();
      const base = { from: wallet.address, to: RECIPIENT };

      await adapter.signAndSend(
        await adapter.buildTransaction({ ...base, amount: '0.3' }),
        wallet.privateKey!,
        { idempotencyKey: 'payout-1' },
      );
      const different = await adapter.buildTransaction({ ...base, amount: '0.7' });

      await expect(
        adapter.signAndSend(different, wallet.privateKey!, { idempotencyKey: 'payout-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_REUSED });
      expect(s.calls.broadcastTransaction).toHaveBeenCalledTimes(1);
    });

    it('treats the same transfer rebuilt with a fresh fee estimate as the same request', async () => {
      const s = script({ getTransactionCount: 0 });
      const adapter = adapterFor('ethereum-sepolia', {
        idempotencyStore: new InMemoryIdempotencyStore(),
      });
      const wallet = await adapter.createWallet();
      const params = { from: wallet.address, to: RECIPIENT, amount: '0.3' };

      const first = await adapter.signAndSend(
        await adapter.buildTransaction(params),
        wallet.privateKey!,
        {
          idempotencyKey: 'payout-2',
        },
      );
      s.setScript({
        getTransactionCount: 1,
        feeData: { maxFeePerGas: 99n, maxPriorityFeePerGas: 9n, gasPrice: 99n },
      });
      const again = await adapter.signAndSend(
        await adapter.buildTransaction(params),
        wallet.privateKey!,
        {
          idempotencyKey: 'payout-2',
        },
      );

      expect(again.hash).toBe(first.hash);
      expect(s.calls.broadcastTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('signAndSend', () => {
    async function buildTx(adapter: InstanceType<typeof EvmAdapter>): Promise<{
      tx: UnsignedTransaction;
      privateKey: string;
    }> {
      const wallet = await adapter.createWallet();
      const params: TransactionParams = { from: wallet.address, to: RECIPIENT, amount: '0.001' };
      return { tx: await adapter.buildTransaction(params), privateKey: wallet.privateKey! };
    }

    /** Hash of the n-th signed transaction handed to the provider. */
    function broadcastHash(s: ReturnType<typeof script>, n = 0): string {
      return keccak256(s.calls.broadcastTransaction.mock.calls[n][0] as string);
    }

    it('broadcasts and returns the hash of the transaction it signed', async () => {
      const s = script();
      const adapter = adapterFor('ethereum-sepolia');
      const { tx, privateKey } = await buildTx(adapter);

      const result = await adapter.signAndSend(tx, privateKey);

      expect(s.calls.broadcastTransaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ hash: broadcastHash(s) });
    });

    it('refuses to sign with a key that does not belong to the sender', async () => {
      const s = script();
      const adapter = adapterFor('ethereum-sepolia');
      const { tx } = await buildTx(adapter);
      const stranger = await adapter.createWallet();

      await expect(adapter.signAndSend(tx, stranger.privateKey!)).rejects.toThrow(/mismatch/i);
      expect(s.calls.broadcastTransaction).not.toHaveBeenCalled();
    });

    it('never puts a malformed private key into the error or its cause', async () => {
      const adapter = adapterFor('ethereum-sepolia');
      const { tx } = await buildTx(adapter);
      const secret = 'zz-NOT-HEX-SECRET-VALUE-zz';

      const error = await adapter.signAndSend(tx, secret).catch((e: unknown) => e as Error);

      expect(error).toMatchObject({ code: ErrorCode.INVALID_PRIVATE_KEY });
      expect(JSON.stringify(error)).not.toContain('SECRET');
      expect(String(error.message)).not.toContain('SECRET');
      expect(String((error.cause as Error | undefined)?.message ?? '')).not.toContain('SECRET');
    });

    it('maps an insufficient-funds failure to INSUFFICIENT_FUNDS', async () => {
      const adapter = adapterFor('ethereum-sepolia', { rpcPolicy: FAST });
      const { tx, privateKey } = await buildTx(adapter);

      harness.setScript({
        broadcast: async () => {
          const error = new Error('insufficient funds for gas * price + value');
          (error as { code?: string }).code = 'INSUFFICIENT_FUNDS';
          throw error;
        },
      });

      await expect(adapter.signAndSend(tx, privateKey)).rejects.toMatchObject({
        code: ErrorCode.INSUFFICIENT_FUNDS,
      });
    });

    it('maps an unrecognised failure to TRANSACTION_FAILED', async () => {
      const adapter = adapterFor('ethereum-sepolia', { rpcPolicy: FAST });
      const { tx, privateKey } = await buildTx(adapter);

      harness.setScript({
        broadcast: async () => {
          throw new Error('some node-specific rejection');
        },
      });

      await expect(adapter.signAndSend(tx, privateKey)).rejects.toMatchObject({
        code: ErrorCode.TRANSACTION_FAILED,
      });
    });

    describe('idempotency', () => {
      it('broadcasts once when the same key is replayed', async () => {
        const store = new InMemoryIdempotencyStore();
        const s = script({ broadcast: { hash: `0x${'ef'.repeat(32)}` } });

        const adapter = adapterFor('ethereum-sepolia', { idempotencyStore: store });
        const { tx, privateKey } = await buildTx(adapter);

        const first = await adapter.signAndSend(tx, privateKey, { idempotencyKey: 'payout-1' });
        const second = await adapter.signAndSend(tx, privateKey, { idempotencyKey: 'payout-1' });

        expect(second).toEqual(first);
        expect(s.calls.broadcastTransaction).toHaveBeenCalledTimes(1);
      });

      it('releases the key when the node definitively rejects the broadcast', async () => {
        const store = new InMemoryIdempotencyStore();
        const s = script();

        const adapter = adapterFor('ethereum-sepolia', {
          idempotencyStore: store,
          rpcPolicy: FAST,
        });
        const { tx, privateKey } = await buildTx(adapter);

        s.setScript({
          broadcast: async () => {
            throw new Error('node rejected');
          },
        });
        await expect(
          adapter.signAndSend(tx, privateKey, { idempotencyKey: 'payout-2' }),
        ).rejects.toThrow();

        s.setScript({});
        const retried = await adapter.signAndSend(tx, privateKey, { idempotencyKey: 'payout-2' });
        expect(retried).toEqual({ hash: broadcastHash(s, 1) });
      });

      it('resends the identical signed transaction when a retry follows a timeout', async () => {
        const store = new InMemoryIdempotencyStore();
        const s = script();
        const adapter = adapterFor('ethereum-sepolia', {
          idempotencyStore: store,
          rpcPolicy: { ...FAST, timeoutMs: 20 },
        });
        const { tx, privateKey } = await buildTx(adapter);

        s.setScript({ broadcast: () => new Promise(() => undefined) });
        await expect(
          adapter.signAndSend(tx, privateKey, { idempotencyKey: 'payout-3' }),
        ).rejects.toMatchObject({
          code: ErrorCode.TIMEOUT,
          message: expect.stringContaining('resends exactly this transaction'),
        });

        s.setScript({});
        const retried = await adapter.signAndSend(tx, privateKey, { idempotencyKey: 'payout-3' });

        const [first, second] = s.calls.broadcastTransaction.mock.calls;
        expect(second[0]).toBe(first[0]);
        expect(retried).toEqual({ hash: broadcastHash(s) });
      });

      it('keeps the key bound after a transport failure, so no second transfer is signed', async () => {
        const store = new InMemoryIdempotencyStore();
        const s = script();
        const adapter = adapterFor('ethereum-sepolia', {
          idempotencyStore: store,
          rpcPolicy: FAST,
        });
        const { tx, privateKey } = await buildTx(adapter);

        s.setScript({
          broadcast: async () => {
            throw new Error('socket hang up');
          },
        });
        await expect(
          adapter.signAndSend(tx, privateKey, { idempotencyKey: 'payout-4' }),
        ).rejects.toThrow(/may still confirm/);

        await expect(
          adapter.signAndSend(tx, privateKey, { idempotencyKey: 'payout-4' }),
        ).rejects.toThrow(/may still confirm/);

        const sent = s.calls.broadcastTransaction.mock.calls.map((c) => c[0]);
        expect(new Set(sent).size).toBe(1);
      });

      it('treats "already known" as accepted', async () => {
        const store = new InMemoryIdempotencyStore();
        const s = script({
          broadcast: async () => {
            throw new Error('already known');
          },
        });
        const adapter = adapterFor('ethereum-sepolia', {
          idempotencyStore: store,
          rpcPolicy: FAST,
        });
        const { tx, privateKey } = await buildTx(adapter);

        const result = await adapter.signAndSend(tx, privateKey, { idempotencyKey: 'payout-5' });
        expect(result).toEqual({ hash: broadcastHash(s) });
      });

      it("scopes keys per chain, so one key cannot return another chain's hash", async () => {
        const store = new InMemoryIdempotencyStore();
        const s = script();
        const sepolia = adapterFor('ethereum-sepolia', { idempotencyStore: store });
        const bsc = adapterFor('bsc-testnet', { idempotencyStore: store });

        const a = await buildTx(sepolia);
        const b = await buildTx(bsc);
        const first = await sepolia.signAndSend(a.tx, a.privateKey, { idempotencyKey: 'same' });
        const second = await bsc.signAndSend(b.tx, b.privateKey, { idempotencyKey: 'same' });

        expect(second.hash).not.toBe(first.hash);
        expect(s.calls.broadcastTransaction).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('reliability', () => {
    it('fails over to a second endpoint when the first is unreachable', async () => {
      let attempt = 0;
      script({
        getBalance: async () => {
          attempt += 1;
          if (attempt === 1) throw new Error('ECONNREFUSED');
          return 42n;
        },
      });

      const adapter = adapterFor('ethereum-sepolia', { rpcPolicy: FAST });
      await expect(adapter.getBalance(SENDER)).resolves.toBe('42');
      expect(attempt).toBeGreaterThan(1);
    });

    it('retries a transient read failure and then succeeds', async () => {
      let attempt = 0;
      script({
        getBalance: async () => {
          attempt += 1;
          if (attempt < 3) throw new Error('429 too many requests');
          return 7n;
        },
      });

      const adapter = adapterFor('ethereum-sepolia', {
        rpcPolicy: { maxAttempts: 3, baseDelayMs: 1, timeoutMs: 500 },
      });
      await expect(adapter.getBalance(SENDER)).resolves.toBe('7');
      expect(attempt).toBe(3);
    });

    it('does not retry a permanent failure', async () => {
      let attempt = 0;
      script({
        getBalance: async () => {
          attempt += 1;
          const error = new Error('execution reverted');
          (error as { code?: string }).code = 'CALL_EXCEPTION';
          throw error;
        },
      });

      const adapter = adapterFor('ethereum-sepolia', {
        rpcPolicy: { maxAttempts: 3, baseDelayMs: 1, timeoutMs: 500 },
      });
      await expect(adapter.getBalance(SENDER)).rejects.toThrow();
      expect(attempt).toBe(1);
    });

    it('times out a hanging call instead of waiting forever', async () => {
      script({
        getBalance: () => new Promise<bigint>(() => undefined),
      });

      const adapter = adapterFor('ethereum-sepolia', {
        rpcPolicy: { maxAttempts: 1, baseDelayMs: 1, timeoutMs: 50 },
      });

      await expect(adapter.getBalance(SENDER)).rejects.toMatchObject({
        code: ErrorCode.TIMEOUT,
      });
    });

    it('reports every endpoint it tried when they all fail', async () => {
      script({
        getBalance: async () => {
          throw new Error('ETIMEDOUT');
        },
      });

      const adapter = adapterFor('ethereum-sepolia', { rpcPolicy: FAST });
      await expect(adapter.getBalance(SENDER)).rejects.toMatchObject({
        code: ErrorCode.RPC_ERROR,
      });
    });
  });

  describe('healthCheck', () => {
    it('reports healthy when the endpoint responds', async () => {
      script({ getBlockNumber: 123 });
      const result = await adapterFor('ethereum-sepolia').healthCheck();
      expect(result.healthy).toBe(true);
    });

    it('reports the endpoint without the API key embedded in its URL', async () => {
      const adapter = new EvmAdapter('ethereum-sepolia', {
        rpcUrl: 'https://eth-sepolia.example/v2/API-KEY-123',
        providerFactory: harness.factory,
      });

      const result = await adapter.healthCheck();

      expect(result.endpoint).toBe('https://eth-sepolia.example/…');
    });

    it('reports unhealthy without throwing', async () => {
      script({
        getBlockNumber: async () => {
          throw new Error('ECONNREFUSED');
        },
      });

      const adapter = adapterFor('ethereum-sepolia', { rpcPolicy: FAST });
      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('signMessage', () => {
    it('signs a message and returns the signer address', async () => {
      const adapter = adapterFor('ethereum-sepolia');
      const wallet = await adapter.createWallet();
      const result = await adapter.signMessage('test message', wallet.privateKey!);

      expect(result.signature).toMatch(/^0x[0-9a-fA-F]+$/);
      expect(result.address).toBe(wallet.address);
    });

    it('throws INVALID_PRIVATE_KEY for a malformed key', async () => {
      await expect(
        adapterFor('ethereum-sepolia').signMessage('hello', 'bad-key'),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_PRIVATE_KEY });
    });
  });
});
