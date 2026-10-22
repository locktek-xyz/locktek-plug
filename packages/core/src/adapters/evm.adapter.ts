import type { Wallet } from 'ethers';
import type { ChainAdapter } from './interface.js';
import type { Chain } from '../types/chain.js';
import type { WalletData } from '../types/wallet.js';
import type {
  TransactionParams,
  UnsignedTransaction,
  GasEstimate,
  SendOptions,
  TransactionReceipt,
  ConfirmationOptions,
} from '../types/transaction.js';
import { LocktekError, ErrorCode } from '../types/common.js';
import { getNetworkConfig } from '../config/networks.js';
import { getAllRpcUrls } from '../config/rpc-defaults.js';
import { validateEvmAddress } from '../utils/validation.js';
import { parseNativeAmount, formatNativeAmount } from '../utils/format.js';
import { createEVMWallet } from '../wallet/hd-wallet.js';
import { RpcExecutor } from '../rpc/executor.js';
import { classifyRpcError, errorText, isRetryableError } from '../rpc/classify.js';
import { redactUrl, scrubUrls } from '../rpc/endpoint-pool.js';
import type { RpcPolicy } from '../rpc/policy.js';
import { NonceManager } from '../tx/nonce-manager.js';
import type { IdempotencyStore } from '../tx/idempotency.js';
import { sendOnce } from '../tx/send-once.js';
import type { Logger } from '../observability/logger.js';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address, uint256)',
] as const;

const GAS_LIMIT_BUFFER_PERCENT = 120n;
const DEFAULT_CONFIRMATIONS = 1;
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 120_000;

/** Builds the JSON-RPC client for a given endpoint. Overridable so tests can supply a fake. */
export type EvmProviderFactory = (url: string) => Promise<EvmProviderLike>;

/** The subset of `ethers.JsonRpcProvider` this adapter actually uses. */
export interface EvmProviderLike {
  getBalance(address: string): Promise<bigint>;
  estimateGas(tx: unknown): Promise<bigint>;
  getFeeData(): Promise<Record<string, bigint | null>>;
  getTransactionCount(address: string, blockTag?: string): Promise<number>;
  getBlockNumber(): Promise<number>;
  broadcastTransaction(signedTransaction: string): Promise<unknown>;
  waitForTransaction(hash: string, confirmations?: number, timeout?: number): Promise<unknown>;
  [key: string]: unknown;
}

export interface EvmAdapterOptions {
  readonly rpcUrl?: string;
  /** Replace the RPC client. Used by tests to run the adapter with no network. */
  readonly providerFactory?: EvmProviderFactory;
  readonly rpcPolicy?: Partial<RpcPolicy>;
  readonly logger?: Logger;
  readonly nonceManager?: NonceManager;
  readonly idempotencyStore?: IdempotencyStore;
}

export class EvmAdapter implements ChainAdapter {
  readonly chain: Chain;
  readonly chainFamily = 'evm' as const;

  private readonly rpc: RpcExecutor;
  private readonly nonces: NonceManager;
  private readonly idempotency: IdempotencyStore | undefined;
  private readonly logger: Logger | undefined;
  private readonly decimalsCache = new Map<string, number>();
  private readonly createProvider: EvmProviderFactory;
  private readonly providers = new Map<string, Promise<EvmProviderLike>>();

  constructor(chain: Chain, options: EvmAdapterOptions | string = {}) {
    const opts: EvmAdapterOptions = typeof options === 'string' ? { rpcUrl: options } : options;
    const endpoints = opts.rpcUrl ? [opts.rpcUrl] : getAllRpcUrls(chain);

    this.chain = chain;
    this.rpc = new RpcExecutor(chain, endpoints, opts.rpcPolicy, opts.logger);
    this.nonces = opts.nonceManager ?? new NonceManager();
    this.idempotency = opts.idempotencyStore;
    this.logger = opts.logger;
    const chainId = getNetworkConfig(chain).chainId;
    this.createProvider =
      opts.providerFactory ?? ((url: string) => defaultEvmProviderFactory(url, chainId));
  }

  /** One client per endpoint for the adapter's lifetime, rather than one per call. */
  private providerFor(url: string): Promise<EvmProviderLike> {
    let provider = this.providers.get(url);
    if (!provider) {
      provider = this.createProvider(url);
      // A failed construction must not be cached, or the endpoint stays broken forever.
      provider.catch(() => this.providers.delete(url));
      this.providers.set(url, provider);
    }
    return provider;
  }

  /** Nonces are per chain: the same address has an independent sequence on each network. */
  private nonceScope(address: string): string {
    return `${this.chain}:${address}`;
  }

  /**
   * Construct a signer without letting the key reach an error message. ethers echoes
   * the offending value when a key is not valid hex, and errors travel to logs, CLI
   * output, and AI agents.
   */
  private async signerFor(privateKey: string): Promise<Wallet> {
    const { ethers } = await import('ethers');
    try {
      return new ethers.Wallet(privateKey);
    } catch {
      throw new LocktekError(
        `Invalid private key for ${this.chain}. Expected a 64-character hex string (with optional 0x prefix).`,
        ErrorCode.INVALID_PRIVATE_KEY,
      );
    }
  }

  async createWallet(): Promise<WalletData> {
    return createEVMWallet({ chain: this.chain });
  }

  async importWallet(privateKey: string): Promise<WalletData> {
    const wallet = await this.signerFor(privateKey);
    return {
      address: wallet.address,
      publicKey: wallet.signingKey.compressedPublicKey,
      privateKey,
      chain: this.chain,
      chainFamily: 'evm',
    };
  }

  async getBalance(address: string): Promise<string> {
    this.assertAddress(address, 'wallet address');

    return this.rpc.read('getBalance', async (url) => {
      const provider = await this.providerFor(url);
      const balance = await provider.getBalance(address);
      return balance.toString();
    });
  }

  async getTokenBalance(address: string, tokenAddress: string): Promise<string> {
    this.assertAddress(address, 'wallet address');
    this.assertAddress(tokenAddress, 'token contract address');

    return this.rpc.read('getTokenBalance', async (url) => {
      const { ethers } = await import('ethers');
      const provider = await this.providerFor(url);
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider as never);
      const balance: bigint = await contract.balanceOf(address);
      return balance.toString();
    });
  }

  /** Read `decimals()` from the token contract, cached per adapter instance. */
  async getTokenDecimals(tokenAddress: string): Promise<number> {
    this.assertAddress(tokenAddress, 'token contract address');

    const cacheKey = tokenAddress.toLowerCase();
    const cached = this.decimalsCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const decimals = await this.rpc.read('getTokenDecimals', async (url) => {
      const { ethers } = await import('ethers');
      const provider = await this.providerFor(url);
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider as never);
      const value: bigint = await contract.decimals();
      return Number(value);
    });

    this.decimalsCache.set(cacheKey, decimals);
    return decimals;
  }

  /** Resolve the decimals that apply to this transfer's amount. */
  private async decimalsFor(params: TransactionParams): Promise<number> {
    if (!params.tokenAddress) return getNetworkConfig(this.chain).decimals;
    return params.tokenDecimals ?? this.getTokenDecimals(params.tokenAddress);
  }

  async buildTransaction(params: TransactionParams): Promise<UnsignedTransaction> {
    this.assertAddress(params.from, 'sender address');
    this.assertAddress(params.to, 'recipient address');

    const config = getNetworkConfig(this.chain);
    const decimals = await this.decimalsFor(params);
    const baseUnitAmount = parseNativeAmount(params.amount, decimals);

    const { ethers } = await import('ethers');

    let data = params.data ?? '0x';
    let to = params.to;
    let value = baseUnitAmount;

    if (params.tokenAddress) {
      this.assertAddress(params.tokenAddress, 'token contract address');
      const iface = new ethers.Interface([...ERC20_ABI]);
      data = iface.encodeFunctionData('transfer', [params.to, baseUnitAmount]);
      to = params.tokenAddress;
      value = 0n;
    }

    const gasEstimate = await this.estimateGas(params);

    const nonce =
      params.nonce ??
      (await this.nonces.allocate(this.nonceScope(params.from), () =>
        this.rpc.read('getTransactionCount', async (url) => {
          const provider = await this.providerFor(url);
          return provider.getTransactionCount(params.from, 'pending');
        }),
      ));

    const txData: Record<string, unknown> = {
      to,
      from: params.from,
      value,
      data,
      nonce,
      chainId: config.chainId,
      gasLimit: params.gasLimit ?? gasEstimate.gasLimit,
    };

    if (config.features?.eip1559) {
      txData.maxFeePerGas = params.maxFeePerGas ?? gasEstimate.maxFeePerGas;
      txData.maxPriorityFeePerGas = params.maxPriorityFeePerGas ?? gasEstimate.maxPriorityFeePerGas;
      txData.type = 2;
    } else {
      txData.gasPrice = params.gasPrice ?? gasEstimate.gasPrice;
      txData.type = 0;
    }

    return {
      chain: this.chain,
      chainFamily: 'evm',
      chainId: config.chainId,
      data: JSON.stringify(txData, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)),
      params,
      estimatedGas: gasEstimate,
      baseUnitAmount: baseUnitAmount.toString(),
    };
  }

  /**
   * Sign once, then broadcast the signed bytes.
   *
   * With `options.idempotencyKey`, a retry — including one after a timeout — resends
   * the same signed transaction instead of building a new one, so at most one transfer
   * can land. See {@link sendOnce}.
   */
  async signAndSend(
    tx: UnsignedTransaction,
    privateKey: string,
    options: SendOptions = {},
  ): Promise<{ hash: string }> {
    const nonce = this.nonceOf(tx);
    const sender = tx.params.from;

    return sendOnce(
      {
        chain: this.chain,
        logger: this.logger,
        sign: async () => {
          const { ethers } = await import('ethers');
          const wallet = await this.signerFor(privateKey);
          const raw = await wallet.signTransaction(this.hydrate(tx.data));
          return { raw, hash: ethers.keccak256(raw) };
        },
        broadcast: async (raw) => {
          await this.rpc.write('signAndSend', async (url) => {
            const provider = await this.providerFor(url);
            await provider.broadcastTransaction(raw);
          });
        },
        isAlreadyKnown: (error) =>
          /already known|known transaction|already imported/i.test(errorText(error)),
        isDefinitiveRejection: (error) => !isRetryableError(error),
        wrapError: (error) => this.wrapSendError(error),
        onNotBroadcast: () => {
          if (nonce !== undefined) this.nonces.release(this.nonceScope(sender), nonce);
        },
      },
      this.idempotency,
      options.idempotencyKey,
    );
  }

  async waitForConfirmation(
    hash: string,
    options: ConfirmationOptions = {},
  ): Promise<TransactionReceipt> {
    const confirmations = options.confirmations ?? DEFAULT_CONFIRMATIONS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;

    return this.rpc.read('waitForConfirmation', async (url) => {
      const provider = await this.providerFor(url);
      const receipt = (await provider.waitForTransaction(hash, confirmations, timeoutMs)) as {
        hash: string;
        status: number | null;
        blockNumber: number;
        gasUsed: bigint;
      } | null;

      if (!receipt) {
        throw new LocktekError(
          `Transaction ${hash} was not mined within ${timeoutMs}ms on ${this.chain}. ` +
            'It may have been dropped from the mempool, or it may still confirm later.',
          ErrorCode.TRANSACTION_DROPPED,
        );
      }

      return {
        hash: receipt.hash,
        status: receipt.status === 1 ? ('success' as const) : ('reverted' as const),
        blockNumber: receipt.blockNumber,
        confirmations,
        gasUsed: receipt.gasUsed.toString(),
      };
    });
  }

  async signMessage(
    message: string,
    privateKey: string,
  ): Promise<{ signature: string; address: string }> {
    const wallet = await this.signerFor(privateKey);
    const signature = await wallet.signMessage(message);
    return { signature, address: wallet.address };
  }

  async estimateGas(params: TransactionParams): Promise<GasEstimate> {
    this.assertAddress(params.from, 'sender address');
    this.assertAddress(params.to, 'recipient address');

    const config = getNetworkConfig(this.chain);
    const decimals = await this.decimalsFor(params);
    const baseUnitAmount = parseNativeAmount(params.amount, decimals);

    return this.rpc.read('estimateGas', async (url) => {
      const { ethers } = await import('ethers');
      const provider = await this.providerFor(url);

      let to = params.to;
      let data = params.data ?? '0x';
      let value = baseUnitAmount;

      if (params.tokenAddress) {
        const iface = new ethers.Interface([...ERC20_ABI]);
        data = iface.encodeFunctionData('transfer', [params.to, baseUnitAmount]);
        to = params.tokenAddress;
        value = 0n;
      }

      const gasLimit = await provider.estimateGas({ from: params.from, to, value, data });
      const gasLimitWithBuffer = (gasLimit * GAS_LIMIT_BUFFER_PERCENT) / 100n;
      const feeData = await provider.getFeeData();

      if (config.features?.eip1559) {
        const maxFeePerGas = feeData.maxFeePerGas ?? 0n;
        const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;
        const totalFee = gasLimitWithBuffer * maxFeePerGas;

        return {
          gasLimit: gasLimitWithBuffer.toString(),
          maxFeePerGas: maxFeePerGas.toString(),
          maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
          totalFee: totalFee.toString(),
          totalFeeInToken: formatNativeAmount(totalFee, config.decimals),
          fromNetwork: true,
        };
      }

      const gasPrice = feeData.gasPrice ?? 0n;
      const totalFee = gasLimitWithBuffer * gasPrice;

      return {
        gasLimit: gasLimitWithBuffer.toString(),
        gasPrice: gasPrice.toString(),
        totalFee: totalFee.toString(),
        totalFeeInToken: formatNativeAmount(totalFee, config.decimals),
        fromNetwork: true,
      };
    });
  }

  validateAddress(address: string): boolean {
    return validateEvmAddress(address);
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    endpoint: string;
    latencyMs: number;
    error?: string;
  }> {
    const endpoint = redactUrl(this.rpc.writeEndpoint);
    const startedAt = Date.now();

    try {
      await this.rpc.read('healthCheck', async (url) => {
        const provider = await this.providerFor(url);
        return provider.getBlockNumber();
      });
      return { healthy: true, endpoint, latencyMs: Date.now() - startedAt };
    } catch (error: unknown) {
      return {
        healthy: false,
        endpoint,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? scrubUrls(error.message) : 'Unknown error',
      };
    }
  }

  private assertAddress(address: string, label: string): void {
    if (this.validateAddress(address)) return;

    throw new LocktekError(
      `Invalid ${label}: "${address}". Expected a 0x-prefixed, 40-character hex string ` +
        'with a valid EIP-55 checksum (or all lower/upper case).',
      ErrorCode.INVALID_ADDRESS,
    );
  }

  private hydrate(serialised: string): Record<string, unknown> {
    const txData = JSON.parse(serialised) as Record<string, unknown>;
    const bigintFields = ['value', 'gasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas', 'gasPrice'];

    for (const field of bigintFields) {
      if (typeof txData[field] === 'string') {
        txData[field] = BigInt(txData[field] as string);
      }
    }

    return txData;
  }

  private nonceOf(tx: UnsignedTransaction): number | undefined {
    try {
      const nonce = (JSON.parse(tx.data) as { nonce?: unknown }).nonce;
      return typeof nonce === 'number' ? nonce : undefined;
    } catch {
      return undefined;
    }
  }

  private wrapSendError(error: unknown): LocktekError {
    if (error instanceof LocktekError) return error;

    const classified = classifyRpcError(error);

    if (classified === ErrorCode.INSUFFICIENT_FUNDS) {
      return new LocktekError(
        `Insufficient funds to send this transaction on ${this.chain}. ` +
          'The sender must cover the transfer amount plus gas fees.',
        ErrorCode.INSUFFICIENT_FUNDS,
        error,
      );
    }

    // A broadcast that failed for an unclassified reason is a failed transaction, not
    // a network fault — NETWORK_ERROR would send callers looking at the wrong thing.
    const code = classified === ErrorCode.NETWORK_ERROR ? ErrorCode.TRANSACTION_FAILED : classified;

    return new LocktekError(
      `Transaction failed on ${this.chain}. ${
        error instanceof Error ? scrubUrls(error.message) : 'Unknown error'
      }`,
      code,
      error,
    );
  }
}

/**
 * Default factory: a real `ethers.JsonRpcProvider` pinned to the expected network.
 *
 * Pinning matters beyond saving a round trip. Without a known network, ethers probes
 * the endpoint and, when the probe fails, retries forever while printing to stdout —
 * which corrupts the JSON-RPC stream of a stdio MCP server.
 */
export async function defaultEvmProviderFactory(
  url: string,
  chainId?: number | string,
): Promise<EvmProviderLike> {
  const { ethers } = await import('ethers');
  const network = chainId === undefined ? undefined : ethers.Network.from(BigInt(chainId));
  return new ethers.JsonRpcProvider(url, network, {
    staticNetwork: network ?? true,
  }) as unknown as EvmProviderLike;
}
