import { vi } from 'vitest';

/** Scripted responses for a fake TronWeb client. */
export interface MockTronScript {
  balance?: number | (() => Promise<number>);
  tokenBalance?: bigint | number | (() => Promise<bigint>);
  decimals?: number;
  chainParameters?: { key: string; value: number }[] | (() => Promise<unknown>);
  accountResources?: { EnergyLimit?: number; EnergyUsed?: number };
  constantContractEnergy?: number | (() => Promise<unknown>);
  buildResult?: unknown;
  broadcast?: Record<string, unknown> | (() => Promise<Record<string, unknown>>);
  transactionInfo?: unknown;
  /** Genesis block ID the endpoint reports. Defaults to a testnet-shaped ID. */
  genesisBlockId?: string;
}

/** Synthetic genesis IDs: only the last four bytes, which identify the network, matter. */
export const TESTNET_GENESIS_ID = `${'0'.repeat(56)}94a9059e`;
export const MAINNET_GENESIS_ID = `${'0'.repeat(56)}2b6653dc`;

async function resolveValue<T>(value: T | (() => Promise<T>) | undefined, fallback: T): Promise<T> {
  if (value === undefined) return fallback;
  return typeof value === 'function' ? (value as () => Promise<T>)() : value;
}

export interface MockTronHarness {
  /** Pass this as `clientFactory` when constructing a TronAdapter. */
  factory: (url: string) => Promise<never>;
  calls: {
    getBalance: ReturnType<typeof vi.fn>;
    sendTrx: ReturnType<typeof vi.fn>;
    triggerSmartContract: ReturnType<typeof vi.fn>;
    sendRawTransaction: ReturnType<typeof vi.fn>;
    getChainParameters: ReturnType<typeof vi.fn>;
    constructed: string[];
  };
  setScript(next: MockTronScript): void;
}

/**
 * A stand-in for TronWeb that never touches the network.
 *
 * Signing is stubbed rather than real — unlike the EVM mock — because TronWeb's
 * signer is not separable from its transport. Address encoding and amount conversion,
 * which is where the interesting bugs live, still run for real.
 */
export function createMockTronWeb(initial: MockTronScript = {}): MockTronHarness {
  let script = initial;

  const calls: MockTronHarness['calls'] = {
    getBalance: vi.fn(),
    sendTrx: vi.fn(),
    triggerSmartContract: vi.fn(),
    sendRawTransaction: vi.fn(),
    getChainParameters: vi.fn(),
    constructed: [],
  };

  const client = {
    setAddress: vi.fn(),
    trx: {
      async getBalance(address: string) {
        calls.getBalance(address);
        return resolveValue(script.balance, 1_000_000);
      },
      async getBlockByNumber(num: number) {
        return { blockID: num === 0 ? (script.genesisBlockId ?? TESTNET_GENESIS_ID) : undefined };
      },
      async getChainParameters() {
        calls.getChainParameters();
        return resolveValue(script.chainParameters, [
          { key: 'getEnergyFee', value: 500 },
          { key: 'getTransactionFee', value: 1200 },
        ]);
      },
      async getAccountResources() {
        return script.accountResources ?? { EnergyLimit: 0, EnergyUsed: 0 };
      },
      async sign(tx: unknown) {
        return { ...(tx as Record<string, unknown>), signature: ['deadbeef'] };
      },
      async sendRawTransaction(signed: unknown) {
        calls.sendRawTransaction(signed);
        return resolveValue(script.broadcast, { result: true, txid: 'a'.repeat(64) });
      },
      async signMessageV2() {
        return `0x${'11'.repeat(65)}`;
      },
      async getTransactionInfo() {
        return script.transactionInfo ?? {};
      },
      async getCurrentBlock() {
        return { blockID: 'b'.repeat(64) };
      },
    },
    transactionBuilder: {
      async sendTrx(to: string, amount: unknown, from: string) {
        calls.sendTrx({ to, amount, from });
        return script.buildResult ?? { txID: 'c'.repeat(64), raw_data: { to, amount, from } };
      },
      async triggerSmartContract(
        contract: string,
        selector: string,
        options: unknown,
        parameters: unknown,
        from: string,
      ) {
        calls.triggerSmartContract({ contract, selector, options, parameters, from });
        return {
          transaction: script.buildResult ?? {
            txID: 'd'.repeat(64),
            raw_data: { contract, parameters },
          },
        };
      },
      async triggerConstantContract() {
        const value = await resolveValue(script.constantContractEnergy, 14_500);
        return { energy_used: value };
      },
    },
    contract() {
      return {
        async at() {
          return {
            methods: {
              balanceOf: () => ({
                call: async () => resolveValue(script.tokenBalance, 5_000_000n),
              }),
              decimals: () => ({ call: async () => script.decimals ?? 6 }),
            },
          };
        },
      };
    },
  };

  return {
    factory: async (url: string) => {
      calls.constructed.push(url);
      return client as never;
    },
    calls,
    setScript(next: MockTronScript) {
      script = next;
    },
  };
}
