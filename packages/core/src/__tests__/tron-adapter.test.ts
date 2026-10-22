import { describe, it, expect, beforeEach } from 'vitest';
import { TronAdapter } from '../adapters/tron.adapter.js';
import { ErrorCode } from '../types/common.js';
import {
  createMockTronWeb,
  MAINNET_GENESIS_ID,
  type MockTronScript,
} from './helpers/mock-tronweb.js';

const SENDER = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const RECIPIENT = 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs';
const TOKEN = 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8';

const FAST = { maxAttempts: 1, baseDelayMs: 1, timeoutMs: 200 };

let harness = createMockTronWeb();

function script(next: MockTronScript = {}) {
  harness = createMockTronWeb(next);
  return harness;
}

function adapterFor(extra: Record<string, unknown> = {}): TronAdapter {
  return new TronAdapter('tron-shasta', { clientFactory: harness.factory, ...extra });
}

describe('TronAdapter', () => {
  beforeEach(() => {
    script();
  });

  describe('constructor', () => {
    it('sets chain and chainFamily', () => {
      const adapter = adapterFor();
      expect(adapter.chain).toBe('tron-shasta');
      expect(adapter.chainFamily).toBe('tron');
    });
  });

  describe('createWallet', () => {
    it('returns a base58check address starting with T', async () => {
      const wallet = await adapterFor().createWallet();
      expect(wallet.address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
      expect(wallet.chainFamily).toBe('tron');
    });
  });

  describe('importWallet', () => {
    it('round-trips a created wallet', async () => {
      const adapter = adapterFor();
      const created = await adapter.createWallet();
      const imported = await adapter.importWallet(created.privateKey!);
      expect(imported.address).toBe(created.address);
    });

    it('throws INVALID_PRIVATE_KEY for bad input', async () => {
      await expect(adapterFor().importWallet('nope')).rejects.toMatchObject({
        code: ErrorCode.INVALID_PRIVATE_KEY,
      });
    });
  });

  describe('validateAddress', () => {
    it('accepts a valid Tron address', () => {
      expect(adapterFor().validateAddress(SENDER)).toBe(true);
    });

    it('rejects a corrupted checksum', () => {
      expect(adapterFor().validateAddress(`${SENDER.slice(0, -1)}X`)).toBe(false);
    });

    it('rejects an EVM address', () => {
      expect(adapterFor().validateAddress('0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C')).toBe(
        false,
      );
    });
  });

  describe('getBalance', () => {
    it('returns the balance in SUN', async () => {
      script({ balance: 42_000_000 });
      await expect(adapterFor().getBalance(SENDER)).resolves.toBe('42000000');
    });

    it('rejects a bad address before any network call', async () => {
      const s = script();
      await expect(adapterFor().getBalance('not-tron')).rejects.toMatchObject({
        code: ErrorCode.INVALID_ADDRESS,
      });
      expect(s.calls.getBalance).not.toHaveBeenCalled();
    });
  });

  describe('amount units', () => {
    it('treats amount as whole TRX, so "1" is 1_000_000 SUN', async () => {
      const s = script();
      const tx = await adapterFor().buildTransaction({
        from: SENDER,
        to: RECIPIENT,
        amount: '1',
      });

      expect(tx.baseUnitAmount).toBe('1000000');
      expect(s.calls.sendTrx).toHaveBeenCalledWith(expect.objectContaining({ amount: '1000000' }));
    });

    it('rejects a malformed amount before touching the network', async () => {
      const s = script();
      await expect(
        adapterFor().buildTransaction({ from: SENDER, to: RECIPIENT, amount: '1.2.3' }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_AMOUNT });
      expect(s.calls.sendTrx).not.toHaveBeenCalled();
    });

    it('scales a token amount by the token decimals', async () => {
      const s = script({ decimals: 6 });
      const tx = await adapterFor().buildTransaction({
        from: SENDER,
        to: RECIPIENT,
        amount: '25',
        tokenAddress: TOKEN,
      });

      expect(tx.baseUnitAmount).toBe('25000000');
      expect(s.calls.triggerSmartContract).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: [
            { type: 'address', value: RECIPIENT },
            { type: 'uint256', value: '25000000' },
          ],
        }),
      );
    });

    it('keeps precision for amounts beyond Number.MAX_SAFE_INTEGER', async () => {
      const s = script();
      // 10^13 TRX is 10^19 SUN, well past the 2^53 safe-integer boundary.
      const tx = await adapterFor().buildTransaction({
        from: SENDER,
        to: RECIPIENT,
        amount: '10000000000000',
      });

      expect(tx.baseUnitAmount).toBe('10000000000000000000');
      expect(s.calls.sendTrx).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '10000000000000000000' }),
      );
    });
  });

  describe('estimateGas', () => {
    it('uses live chain parameters when they are available', async () => {
      script({
        chainParameters: [
          { key: 'getTransactionFee', value: 1200 },
          { key: 'getEnergyFee', value: 500 },
        ],
      });

      const estimate = await adapterFor().estimateGas({
        from: SENDER,
        to: RECIPIENT,
        amount: '1',
      });

      expect(estimate.fromNetwork).toBe(true);
      expect(estimate.totalFee).toBe(String(268 * 1200));
    });

    it('falls back to constants and says so when chain parameters cannot be read', async () => {
      script({
        chainParameters: async () => {
          throw new Error('unavailable');
        },
      });

      const estimate = await adapterFor().estimateGas({
        from: SENDER,
        to: RECIPIENT,
        amount: '1',
      });

      expect(estimate.fromNetwork).toBe(false);
      expect(estimate.totalFee).toBe(String(268 * 1000));
    });

    it('asks the node how much energy a token transfer needs', async () => {
      script({ decimals: 6, constantContractEnergy: 14_500 });

      const estimate = await adapterFor().estimateGas({
        from: SENDER,
        to: RECIPIENT,
        amount: '25',
        tokenAddress: TOKEN,
        tokenDecimals: 6,
      });

      expect(estimate.gasLimit).toBe('14500');
      expect(estimate.fromNetwork).toBe(true);
    });

    it('deducts energy the account already has', async () => {
      script({
        decimals: 6,
        constantContractEnergy: 10_000,
        accountResources: { EnergyLimit: 4_000, EnergyUsed: 0 },
        chainParameters: [
          { key: 'getEnergyFee', value: 500 },
          { key: 'getTransactionFee', value: 1000 },
        ],
      });

      const estimate = await adapterFor().estimateGas({
        from: SENDER,
        to: RECIPIENT,
        amount: '25',
        tokenAddress: TOKEN,
        tokenDecimals: 6,
      });

      expect(estimate.totalFee).toBe(String((10_000 - 4_000) * 500));
    });
  });

  describe('signAndSend', () => {
    async function build(adapter: TronAdapter) {
      const wallet = await adapter.createWallet();
      const tx = await adapter.buildTransaction({
        from: wallet.address,
        to: RECIPIENT,
        amount: '1',
      });
      return { tx, privateKey: wallet.privateKey! };
    }

    it('returns the txID of the transaction it signed', async () => {
      script({ broadcast: { result: true, txid: 'c'.repeat(64) } });
      const adapter = adapterFor();
      const { tx, privateKey } = await build(adapter);

      await expect(adapter.signAndSend(tx, privateKey)).resolves.toEqual({
        hash: 'c'.repeat(64),
      });
    });

    it('treats a rejected broadcast as a failure even when TronWeb includes a txid', async () => {
      const adapter = adapterFor({ rpcPolicy: FAST });
      const { tx, privateKey } = await build(adapter);

      harness.setScript({
        broadcast: { result: false, code: 'BANDWITH_ERROR', txid: 'c'.repeat(64) },
      });

      await expect(adapter.signAndSend(tx, privateKey)).rejects.toMatchObject({
        code: ErrorCode.TRANSACTION_FAILED,
        message: expect.stringContaining('BANDWITH_ERROR'),
      });
    });

    it('decodes the hex-encoded reason Tron gives for a rejection', async () => {
      const adapter = adapterFor({ rpcPolicy: FAST });
      const { tx, privateKey } = await build(adapter);

      harness.setScript({
        broadcast: {
          result: false,
          code: 'CONTRACT_VALIDATE_ERROR',
          message: Buffer.from('balance is not sufficient').toString('hex'),
        },
      });

      await expect(adapter.signAndSend(tx, privateKey)).rejects.toMatchObject({
        message: expect.stringContaining('balance is not sufficient'),
      });
    });

    it('resends the same signed transaction when a keyed retry follows a timeout', async () => {
      const { InMemoryIdempotencyStore } = await import('../tx/idempotency.js');
      const adapter = adapterFor({
        idempotencyStore: new InMemoryIdempotencyStore(),
        rpcPolicy: { ...FAST, timeoutMs: 20 },
      });
      const { tx, privateKey } = await build(adapter);

      harness.setScript({ broadcast: () => new Promise(() => undefined) });
      await expect(
        adapter.signAndSend(tx, privateKey, { idempotencyKey: 'trx-timeout' }),
      ).rejects.toMatchObject({ code: ErrorCode.TIMEOUT });

      harness.setScript({ broadcast: { result: false, code: 'DUP_TRANSACTION_ERROR' } });
      await expect(
        adapter.signAndSend(tx, privateKey, { idempotencyKey: 'trx-timeout' }),
      ).resolves.toEqual({ hash: 'c'.repeat(64) });

      const [first, second] = harness.calls.sendRawTransaction.mock.calls;
      expect(second[0]).toEqual(first[0]);
    });

    it('surfaces the structured code when Tron rejects the broadcast', async () => {
      const adapter = adapterFor({ rpcPolicy: FAST });
      const { tx, privateKey } = await build(adapter);

      harness.setScript({
        broadcast: { result: false, code: 'SIGERROR', message: 'signature validation failed' },
      });

      await expect(adapter.signAndSend(tx, privateKey)).rejects.toMatchObject({
        code: ErrorCode.TRANSACTION_FAILED,
        message: expect.stringContaining('SIGERROR'),
      });
    });

    it('broadcasts once when an idempotency key is replayed', async () => {
      const { InMemoryIdempotencyStore } = await import('../tx/idempotency.js');
      const store = new InMemoryIdempotencyStore();
      const s = script({ broadcast: { result: true, txid: 'e'.repeat(64) } });

      const adapter = adapterFor({ idempotencyStore: store });
      const { tx, privateKey } = await build(adapter);

      const first = await adapter.signAndSend(tx, privateKey, { idempotencyKey: 'trx-1' });
      const second = await adapter.signAndSend(tx, privateKey, { idempotencyKey: 'trx-1' });

      expect(second).toEqual(first);
      expect(s.calls.sendRawTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('reliability', () => {
    it('times out a hanging call', async () => {
      script({ balance: () => new Promise<number>(() => undefined) });

      const adapter = adapterFor({
        rpcPolicy: { maxAttempts: 1, baseDelayMs: 1, timeoutMs: 50 },
      });

      await expect(adapter.getBalance(SENDER)).rejects.toMatchObject({
        code: ErrorCode.TIMEOUT,
      });
    });

    it('retries a transient failure then succeeds', async () => {
      let attempt = 0;
      script({
        balance: async () => {
          attempt += 1;
          if (attempt < 2) throw new Error('ECONNRESET');
          return 99;
        },
      });

      const adapter = adapterFor({
        rpcPolicy: { maxAttempts: 3, baseDelayMs: 1, timeoutMs: 500 },
      });

      await expect(adapter.getBalance(SENDER)).resolves.toBe('99');
    });
  });

  describe('healthCheck', () => {
    it('reports healthy without throwing', async () => {
      await expect(adapterFor().healthCheck()).resolves.toMatchObject({ healthy: true });
    });
  });

  describe('signMessage', () => {
    it('throws INVALID_PRIVATE_KEY for a malformed key', async () => {
      await expect(adapterFor().signMessage('hello', 'bad-key')).rejects.toMatchObject({
        code: ErrorCode.INVALID_PRIVATE_KEY,
      });
    });
  });

  describe('network check', () => {
    it('refuses to build a testnet transaction against an endpoint serving mainnet', async () => {
      script({ genesisBlockId: MAINNET_GENESIS_ID });
      const adapter = adapterFor({ rpcPolicy: FAST });

      await expect(
        adapter.buildTransaction({ from: SENDER, to: RECIPIENT, amount: '1' }),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_CONFIG,
        message: expect.stringContaining('serves Tron mainnet'),
      });
      expect(harness.calls.sendTrx).not.toHaveBeenCalled();
    });

    it('builds a mainnet transaction against an endpoint that serves mainnet', async () => {
      script({ genesisBlockId: MAINNET_GENESIS_ID });
      const adapter = new TronAdapter('tron', { clientFactory: harness.factory, rpcPolicy: FAST });

      await expect(
        adapter.buildTransaction({ from: SENDER, to: RECIPIENT, amount: '1' }),
      ).resolves.toMatchObject({ chain: 'tron' });
    });

    it('refuses a mainnet chain whose endpoint serves a testnet', async () => {
      script();
      const adapter = new TronAdapter('tron', { clientFactory: harness.factory, rpcPolicy: FAST });

      await expect(
        adapter.buildTransaction({ from: SENDER, to: RECIPIENT, amount: '1' }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CONFIG });
    });
  });
});
