import { vi } from 'vitest';

/**
 * Scripted responses for a fake JSON-RPC provider.
 *
 * Every field is optional so a test states only what it cares about. Pass a function
 * to make a call throw, hang, or vary between attempts.
 */
export interface MockProviderScript {
  getBalance?: bigint | (() => Promise<bigint>);
  estimateGas?: bigint | (() => Promise<bigint>);
  getTransactionCount?: number | (() => Promise<number>);
  getBlockNumber?: number | (() => Promise<number>);
  call?: string | ((tx: { to?: string; data?: string }) => Promise<string>);
  broadcast?: { hash: string } | (() => Promise<{ hash: string }>);
  receipt?: unknown;
  chainId?: bigint;
  feeData?: Record<string, bigint | null>;
}

async function resolveValue<T>(value: T | (() => Promise<T>) | undefined, fallback: T): Promise<T> {
  if (value === undefined) return fallback;
  return typeof value === 'function' ? (value as () => Promise<T>)() : value;
}

/** ABI-encode a uint256 return value, for stubbing `balanceOf` and `decimals`. */
export function encodeUint(value: bigint | number): string {
  return `0x${BigInt(value).toString(16).padStart(64, '0')}`;
}

export interface MockProviderHarness {
  /** Pass this as `providerFactory` when constructing an adapter. */
  factory: (url: string) => Promise<Record<string, unknown>>;
  calls: {
    getBalance: ReturnType<typeof vi.fn>;
    estimateGas: ReturnType<typeof vi.fn>;
    getTransactionCount: ReturnType<typeof vi.fn>;
    broadcastTransaction: ReturnType<typeof vi.fn>;
    call: ReturnType<typeof vi.fn>;
    constructed: string[];
  };
  /** Replace the scripted responses mid-test, e.g. to make a retry succeed. */
  setScript(next: MockProviderScript): void;
}

/**
 * A stand-in for `ethers.JsonRpcProvider` that never touches the network.
 *
 * Only the transport is faked. Real `ethers.Wallet` signing, real ABI encoding, and
 * real address checksums still run against it, so the tests exercise the adapter's
 * actual behaviour rather than a reimplementation of it.
 */
export function createMockProvider(initial: MockProviderScript = {}): MockProviderHarness {
  let script = initial;

  const calls: MockProviderHarness['calls'] = {
    getBalance: vi.fn(),
    estimateGas: vi.fn(),
    getTransactionCount: vi.fn(),
    broadcastTransaction: vi.fn(),
    call: vi.fn(),
    constructed: [],
  };

  const provider: Record<string, unknown> = {
    async getNetwork() {
      return { chainId: script.chainId ?? 11155111n, name: 'mock' };
    },
    async getBalance(address: string) {
      calls.getBalance(address);
      return resolveValue(script.getBalance, 1_000_000_000_000_000_000n);
    },
    async estimateGas(tx: unknown) {
      calls.estimateGas(tx);
      return resolveValue(script.estimateGas, 21_000n);
    },
    async getFeeData() {
      return {
        maxFeePerGas: 30_000_000_000n,
        maxPriorityFeePerGas: 1_500_000_000n,
        gasPrice: 25_000_000_000n,
        ...script.feeData,
      };
    },
    async getTransactionCount(address: string) {
      calls.getTransactionCount(address);
      return resolveValue(script.getTransactionCount, 5);
    },
    async getBlockNumber() {
      return resolveValue(script.getBlockNumber, 1_000_000);
    },
    async call(tx: { to?: string; data?: string }) {
      calls.call(tx);
      if (typeof script.call === 'function') return script.call(tx);
      return script.call ?? encodeUint(0);
    },
    async broadcastTransaction(signed: string) {
      calls.broadcastTransaction(signed);
      const result = await resolveValue(script.broadcast, { hash: `0x${'ab'.repeat(32)}` });
      return { ...result, wait: async () => script.receipt ?? null };
    },
    async waitForTransaction() {
      return script.receipt ?? null;
    },
    async resolveName(name: string) {
      return name;
    },
    destroy() {
      /* no-op */
    },
  };

  return {
    factory: async (url: string) => {
      calls.constructed.push(url);
      return provider;
    },
    calls,
    setScript(next: MockProviderScript) {
      script = next;
    },
  };
}
