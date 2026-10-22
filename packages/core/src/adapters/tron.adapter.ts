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
import { TronAddress } from '../utils/tron-address.js';
import { parseNativeAmount, formatNativeAmount } from '../utils/format.js';
import { createTronWallet } from '../wallet/hd-wallet.js';
import { RpcExecutor } from '../rpc/executor.js';
import { classifyRpcError, isRetryableError } from '../rpc/classify.js';
import { redactUrl, scrubUrls } from '../rpc/endpoint-pool.js';
import type { RpcPolicy } from '../rpc/policy.js';
import type { IdempotencyStore } from '../tx/idempotency.js';
import { sendOnce } from '../tx/send-once.js';
import type { Logger } from '../observability/logger.js';
import type { TronWeb } from 'tronweb';

/** The TronWeb client instance type, aliased so it is not re-derived at each use. */
type TronClient = InstanceType<typeof TronWeb>;

const TRC20_TRANSFER_SELECTOR = 'transfer(address,uint256)';
const DEFAULT_FEE_LIMIT_SUN = 100_000_000;

/**
 * Fallback fee constants, used only when the network's chain parameters cannot be
 * read. These change by Tron governance vote, so an estimate derived from them is
 * reported with `fromNetwork: false`.
 */
const FALLBACK_ENERGY_PRICE_SUN = 420;
const FALLBACK_BANDWIDTH_PRICE_SUN = 1000;
const FALLBACK_TRANSFER_ENERGY = 30_000;
const NATIVE_TRANSFER_BANDWIDTH_BYTES = 268;

/**
 * Last four bytes of the Tron mainnet genesis block ID. Tron derives its chain ID from
 * them (0x2b6653dc = 728126428), so they identify the network an endpoint serves.
 */
const TRON_MAINNET_GENESIS_SUFFIX = '2b6653dc';

const CONFIRMATION_POLL_INTERVAL_MS = 3_000;
const DEFAULT_CONFIRMATION_TIMEOUT_MS = 120_000;

/** Builds the TronWeb client for a given endpoint. Overridable so tests can supply a fake. */
export type TronClientFactory = (url: string) => Promise<TronClient>;

export interface TronAdapterOptions {
  readonly rpcUrl?: string;
  /** Replace the TronWeb client. Used by tests to run the adapter with no network. */
  readonly clientFactory?: TronClientFactory;
  readonly rpcPolicy?: Partial<RpcPolicy>;
  readonly logger?: Logger;
  readonly idempotencyStore?: IdempotencyStore;
}

export class TronAdapter implements ChainAdapter {
  readonly chain: Chain;
  readonly chainFamily = 'tron' as const;

  private readonly rpc: RpcExecutor;
  private readonly idempotency: IdempotencyStore | undefined;
  private readonly logger: Logger | undefined;
  private readonly decimalsCache = new Map<string, number>();
  private readonly createClient: TronClientFactory;
  private readonly verifiedEndpoints = new Set<string>();

  constructor(chain: Chain, options: TronAdapterOptions | string = {}) {
    const opts: TronAdapterOptions = typeof options === 'string' ? { rpcUrl: options } : options;
    const endpoints = opts.rpcUrl ? [opts.rpcUrl] : getAllRpcUrls(chain);

    this.chain = chain;
    this.rpc = new RpcExecutor(chain, endpoints, opts.rpcPolicy, opts.logger);
    this.idempotency = opts.idempotencyStore;
    this.logger = opts.logger;
    this.createClient = opts.clientFactory ?? defaultTronClientFactory;
  }

  private async tronWebFor(url: string): Promise<TronClient> {
    return this.createClient(url);
  }

  async createWallet(): Promise<WalletData> {
    return createTronWallet({ chain: this.chain });
  }

  async importWallet(privateKey: string): Promise<WalletData> {
    try {
      const { TronWeb } = await import('tronweb');
      const { ethers } = await import('ethers');

      const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
      const address = TronWeb.address.fromPrivateKey(cleanKey);

      if (!address) throw new Error('Failed to derive address');

      const wallet = new ethers.Wallet(privateKey);

      return {
        address: address as string,
        publicKey: wallet.signingKey.compressedPublicKey,
        privateKey: cleanKey,
        chain: this.chain,
        chainFamily: 'tron',
      };
    } catch (error: unknown) {
      if (error instanceof LocktekError) throw error;
      throw new LocktekError(
        `Invalid private key for ${this.chain}. Expected a 64-character hex string (with optional 0x prefix).`,
        ErrorCode.INVALID_PRIVATE_KEY,
      );
    }
  }

  async getBalance(address: string): Promise<string> {
    this.assertAddress(address, 'wallet address');

    return this.rpc.read('getBalance', async (url) => {
      const tronWeb = await this.tronWebFor(url);
      const balance = await tronWeb.trx.getBalance(address);
      return balance.toString();
    });
  }

  async getTokenBalance(address: string, tokenAddress: string): Promise<string> {
    this.assertAddress(address, 'wallet address');
    this.assertAddress(tokenAddress, 'token contract address');

    return this.rpc.read('getTokenBalance', async (url) => {
      const tronWeb = await this.tronWebFor(url);
      tronWeb.setAddress(tokenAddress);
      const contract = await tronWeb.contract().at(tokenAddress);
      const balance = await contract.methods.balanceOf(address).call();
      return balance.toString();
    });
  }

  async getTokenDecimals(tokenAddress: string): Promise<number> {
    this.assertAddress(tokenAddress, 'token contract address');

    const cached = this.decimalsCache.get(tokenAddress);
    if (cached !== undefined) return cached;

    const decimals = await this.rpc.read('getTokenDecimals', async (url) => {
      const tronWeb = await this.tronWebFor(url);
      tronWeb.setAddress(tokenAddress);
      const contract = await tronWeb.contract().at(tokenAddress);
      const value = await contract.methods.decimals().call();
      return Number(value);
    });

    this.decimalsCache.set(tokenAddress, decimals);
    return decimals;
  }

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
    const gasEstimate = await this.estimateGas(params);

    const txData = await this.rpc.read('buildTransaction', async (url) => {
      const tronWeb = await this.tronWebFor(url);
      await this.assertServesExpectedNetwork(url, tronWeb);

      if (params.tokenAddress) {
        const parameter = [
          { type: 'address', value: params.to },
          { type: 'uint256', value: baseUnitAmount.toString() },
        ];
        const { transaction } = await tronWeb.transactionBuilder.triggerSmartContract(
          params.tokenAddress,
          TRC20_TRANSFER_SELECTOR,
          { feeLimit: DEFAULT_FEE_LIMIT_SUN },
          parameter,
          params.from,
        );
        return transaction;
      }

      // TronWeb accepts a string amount at runtime; the cast avoids Number()
      // truncation for values above Number.MAX_SAFE_INTEGER.
      return tronWeb.transactionBuilder.sendTrx(
        params.to,
        baseUnitAmount.toString() as unknown as number,
        params.from,
      );
    });

    return {
      chain: this.chain,
      chainFamily: 'tron',
      chainId: config.chainId,
      data: JSON.stringify(txData),
      params,
      estimatedGas: gasEstimate,
      baseUnitAmount: baseUnitAmount.toString(),
    };
  }

  /**
   * Sign once, then broadcast the signed transaction.
   *
   * With `options.idempotencyKey`, a retry resends the same signed transaction (Tron
   * rejects a duplicate txID) instead of building a new one. See {@link sendOnce}.
   */
  async signAndSend(
    tx: UnsignedTransaction,
    privateKey: string,
    options: SendOptions = {},
  ): Promise<{ hash: string }> {
    return sendOnce(
      {
        chain: this.chain,
        logger: this.logger,
        sign: () => this.sign(tx, privateKey),
        broadcast: async (raw) => {
          await this.rpc.write('signAndSend', async (url) => {
            const tronWeb = await this.tronWebFor(url);
            const result = (await tronWeb.trx.sendRawTransaction(
              JSON.parse(raw),
            )) as unknown as TronBroadcast;
            this.assertAccepted(result);
          });
        },
        isAlreadyKnown: (error) =>
          error instanceof LocktekError && error.message.includes('DUP_TRANSACTION_ERROR'),
        isDefinitiveRejection: (error) => !isRetryableError(error),
        wrapError: (error) => this.wrapSendError(error),
      },
      this.idempotency,
      options.idempotencyKey,
    );
  }

  private async sign(
    tx: UnsignedTransaction,
    privateKey: string,
  ): Promise<{ hash: string; raw: string }> {
    const tronWeb = await this.tronWebFor(this.rpc.writeEndpoint);
    const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;

    let signed: { txID?: string };
    try {
      signed = (await tronWeb.trx.sign(JSON.parse(tx.data), cleanKey)) as { txID?: string };
    } catch (error: unknown) {
      // Keep TronWeb's reason (e.g. key does not match the sender) unless it echoes the key.
      const reason =
        error instanceof Error && cleanKey.length > 0 && !error.message.includes(cleanKey)
          ? ` ${error.message}`
          : '';
      throw new LocktekError(
        `Failed to sign the transaction on ${this.chain}.${reason} Verify the private key is ` +
          'valid and belongs to the sender.',
        ErrorCode.INVALID_PRIVATE_KEY,
      );
    }

    if (!signed.txID) {
      throw new LocktekError(
        `Signing on ${this.chain} produced a transaction with no txID.`,
        ErrorCode.TRANSACTION_FAILED,
      );
    }
    return { hash: signed.txID, raw: JSON.stringify(signed) };
  }

  /**
   * Fail closed: only an explicit `result: true` is an accepted broadcast. TronWeb
   * includes a `txid` even when the node rejects the transaction, so its presence
   * proves nothing.
   */
  private assertAccepted(result: TronBroadcast): void {
    if (result?.result === true) return;

    throw new LocktekError(
      `Tron rejected the broadcast on ${this.chain}` +
        `${result?.code ? ` (code ${result.code})` : ''}: ${decodeTronMessage(result?.message)}.`,
      ErrorCode.TRANSACTION_FAILED,
      result,
    );
  }

  /**
   * Tron transactions carry no chain ID: the reference block they are built against
   * decides which network accepts them. So the endpoint that builds a transaction is
   * checked against the configured network; otherwise a mainnet URL configured under
   * a testnet chain name would yield real-value transactions while the testnet guard,
   * which checks chain names, still passes.
   */
  private async assertServesExpectedNetwork(url: string, tronWeb: TronClient): Promise<void> {
    if (this.verifiedEndpoints.has(url)) return;

    const genesis = (await tronWeb.trx.getBlockByNumber(0)) as { blockID?: unknown } | undefined;
    const blockId = typeof genesis?.blockID === 'string' ? genesis.blockID.toLowerCase() : '';
    if (!blockId) {
      throw new LocktekError(
        `Could not read the genesis block from ${redactUrl(url)} to confirm which Tron ` +
          'network it serves.',
        ErrorCode.RPC_ERROR,
      );
    }

    const servesMainnet = blockId.endsWith(TRON_MAINNET_GENESIS_SUFFIX);
    const expectsMainnet = !getNetworkConfig(this.chain).isTestnet;
    if (servesMainnet !== expectsMainnet) {
      throw new LocktekError(
        `${redactUrl(url)} serves Tron ${servesMainnet ? 'mainnet' : 'a testnet'}, but ` +
          `${this.chain} is ${expectsMainnet ? 'mainnet' : 'a testnet'}. Refusing to build a ` +
          `transaction against it. Check the RPC URL configured for ${this.chain}.`,
        ErrorCode.INVALID_CONFIG,
      );
    }

    this.verifiedEndpoints.add(url);
  }

  private wrapSendError(error: unknown): LocktekError {
    if (error instanceof LocktekError) return error;

    return new LocktekError(
      `Transaction failed on ${this.chain}. ${
        error instanceof Error ? scrubUrls(error.message) : 'Unknown error'
      }`,
      classifyRpcError(error),
      error,
    );
  }

  async waitForConfirmation(
    hash: string,
    options: ConfirmationOptions = {},
  ): Promise<TransactionReceipt> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const info = await this.rpc.read('getTransactionInfo', async (url) => {
        const tronWeb = await this.tronWebFor(url);
        return tronWeb.trx.getTransactionInfo(hash);
      });

      if (info && typeof info === 'object' && 'receipt' in info && info.receipt) {
        const result = (info.receipt as { result?: string }).result;
        return {
          hash,
          status: result === 'SUCCESS' || result === undefined ? 'success' : 'reverted',
          blockNumber: (info as { blockNumber?: number }).blockNumber,
          confirmations: 1,
          gasUsed: (
            info as { receipt?: { energy_usage_total?: number } }
          ).receipt?.energy_usage_total?.toString(),
        };
      }

      await new Promise((resolve) => setTimeout(resolve, CONFIRMATION_POLL_INTERVAL_MS));
    }

    throw new LocktekError(
      `Transaction ${hash} was not confirmed within ${timeoutMs}ms on ${this.chain}. ` +
        'It may have been dropped, or it may still confirm later.',
      ErrorCode.TRANSACTION_DROPPED,
    );
  }

  async signMessage(
    message: string,
    privateKey: string,
  ): Promise<{ signature: string; address: string }> {
    try {
      const { TronWeb } = await import('tronweb');
      const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
      const tronWeb = await this.tronWebFor(this.rpc.writeEndpoint);

      const signature = await tronWeb.trx.signMessageV2(message, cleanKey);
      const address = TronWeb.address.fromPrivateKey(cleanKey);

      if (!address) throw new Error('Failed to derive address from private key');

      return { signature, address: address as string };
    } catch (error: unknown) {
      if (error instanceof LocktekError) throw error;
      throw new LocktekError(
        `Failed to sign message on ${this.chain}. Verify the private key is valid.`,
        ErrorCode.INVALID_PRIVATE_KEY,
      );
    }
  }

  /**
   * Estimate the fee in SUN.
   *
   * Energy and bandwidth prices are read from the network's chain parameters, which
   * change by governance vote. If they cannot be read the fallback constants are
   * used and `fromNetwork` is false, so a caller can tell a real estimate from a guess.
   */
  async estimateGas(params: TransactionParams): Promise<GasEstimate> {
    this.assertAddress(params.from, 'sender address');
    this.assertAddress(params.to, 'recipient address');

    const config = getNetworkConfig(this.chain);
    const decimals = await this.decimalsFor(params);
    const baseUnitAmount = parseNativeAmount(params.amount, decimals);

    return this.rpc.read('estimateGas', async (url) => {
      const tronWeb = await this.tronWebFor(url);
      const prices = await this.readChainPrices(tronWeb);

      if (!params.tokenAddress) {
        const totalFee = NATIVE_TRANSFER_BANDWIDTH_BYTES * prices.bandwidthPrice;
        return {
          gasLimit: NATIVE_TRANSFER_BANDWIDTH_BYTES.toString(),
          totalFee: totalFee.toString(),
          totalFeeInToken: formatNativeAmount(BigInt(totalFee), config.decimals),
          fromNetwork: prices.fromNetwork,
        };
      }

      const energy = await this.estimateTransferEnergy(
        tronWeb,
        params.from,
        params.to,
        params.tokenAddress,
        baseUnitAmount,
      );

      const resources = await tronWeb.trx.getAccountResources(params.from);
      const availableEnergy = (resources.EnergyLimit ?? 0) - (resources.EnergyUsed ?? 0);
      const billableEnergy = Math.max(0, energy.value - availableEnergy);
      const totalFee = billableEnergy * prices.energyPrice;

      return {
        gasLimit: energy.value.toString(),
        totalFee: totalFee.toString(),
        totalFeeInToken: formatNativeAmount(BigInt(totalFee), config.decimals),
        fromNetwork: prices.fromNetwork && energy.fromNetwork,
      };
    });
  }

  /** Read live energy and bandwidth prices from Tron's chain parameters. */
  private async readChainPrices(
    tronWeb: TronClient,
  ): Promise<{ energyPrice: number; bandwidthPrice: number; fromNetwork: boolean }> {
    try {
      const params = (await tronWeb.trx.getChainParameters()) as {
        key: string;
        value: number;
      }[];
      const lookup = (key: string): number | undefined => params.find((p) => p.key === key)?.value;

      const energyPrice = lookup('getEnergyFee');
      const bandwidthPrice = lookup('getTransactionFee');

      if (energyPrice !== undefined && bandwidthPrice !== undefined) {
        return { energyPrice, bandwidthPrice, fromNetwork: true };
      }
    } catch (error: unknown) {
      this.logger?.warn?.('tron.chain_parameters_unavailable', {
        chain: this.chain,
        error: error instanceof Error ? scrubUrls(error.message) : 'unknown',
      });
    }

    return {
      energyPrice: FALLBACK_ENERGY_PRICE_SUN,
      bandwidthPrice: FALLBACK_BANDWIDTH_PRICE_SUN,
      fromNetwork: false,
    };
  }

  /** Ask the node how much energy this exact transfer would consume. */
  private async estimateTransferEnergy(
    tronWeb: TronClient,
    from: string,
    to: string,
    tokenAddress: string,
    amount: bigint,
  ): Promise<{ value: number; fromNetwork: boolean }> {
    try {
      const result = (await tronWeb.transactionBuilder.triggerConstantContract(
        tokenAddress,
        TRC20_TRANSFER_SELECTOR,
        {},
        [
          { type: 'address', value: to },
          { type: 'uint256', value: amount.toString() },
        ],
        from,
      )) as { energy_used?: number };

      if (typeof result.energy_used === 'number' && result.energy_used > 0) {
        return { value: result.energy_used, fromNetwork: true };
      }
    } catch (error: unknown) {
      this.logger?.warn?.('tron.energy_estimate_unavailable', {
        chain: this.chain,
        error: error instanceof Error ? scrubUrls(error.message) : 'unknown',
      });
    }

    return { value: FALLBACK_TRANSFER_ENERGY, fromNetwork: false };
  }

  validateAddress(address: string): boolean {
    return TronAddress.isValid(address);
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
        const tronWeb = await this.tronWebFor(url);
        return tronWeb.trx.getCurrentBlock();
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
      `Invalid ${label}: "${address}". Expected a base58check Tron address starting with 'T' (34 characters).`,
      ErrorCode.INVALID_ADDRESS,
    );
  }
}

/** What `trx.sendRawTransaction` returns. Only `result: true` means accepted. */
interface TronBroadcast {
  readonly result?: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly txid?: string;
}

/** Tron returns rejection reasons hex-encoded; decode them so they are readable. */
function decodeTronMessage(message: string | undefined): string {
  if (!message) return 'no reason given';
  if (/^(?:[0-9a-f]{2})+$/i.test(message)) {
    return Buffer.from(message, 'hex').toString('utf8');
  }
  return message;
}

/** Default factory: a real TronWeb client pointed at the given full-node host. */
export const defaultTronClientFactory: TronClientFactory = async (url) => {
  const { TronWeb } = await import('tronweb');
  return new TronWeb({ fullHost: url });
};
