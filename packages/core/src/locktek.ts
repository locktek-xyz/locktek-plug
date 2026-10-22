import type { Chain } from './types/chain.js';
import type { WalletData } from './types/wallet.js';
import type {
  TransactionParams,
  UnsignedTransaction,
  GasEstimate,
  SendOptions,
  TransactionReceipt,
  ConfirmationOptions,
} from './types/transaction.js';
import type { ChainAdapter } from './adapters/interface.js';
import type { IEncryptionProvider } from './encryption/interface.js';
import type { LocktekConfig } from './config/schema.js';
import { locktekConfigSchema } from './config/schema.js';
import { createAdapter } from './adapters/factory.js';
import { AesGcmEncryptionProvider } from './encryption/aes-gcm.js';
import { LocktekError, ErrorCode } from './types/common.js';
import { getNetworkConfig } from './config/networks.js';
import { isTestnet, isValidChain } from './config/chains.js';
import { PolicyEngine } from './policy/engine.js';
import type { PolicyAuditEntry, TransactionPolicy } from './policy/types.js';
import { safeLogger, type Logger } from './observability/logger.js';
import type { RpcPolicy } from './rpc/policy.js';
import { NonceManager } from './tx/nonce-manager.js';
import { InMemoryIdempotencyStore, type IdempotencyStore } from './tx/idempotency.js';

/** Options for initialising a {@link Locktek} instance. */
export interface LocktekOptions {
  readonly chains: string[];
  readonly defaultChain?: string;
  readonly encryptionKey?: string;
  readonly rpc?: Record<string, string>;
  /**
   * When true (the default), configuring a mainnet chain is refused. Set to false to
   * opt in to mainnet explicitly.
   */
  readonly testnet?: boolean;
  readonly encryptionProvider?: IEncryptionProvider;
  /** Spend caps and recipient rules enforced before any transaction is signed. */
  readonly policy?: TransactionPolicy;
  /** Timeout, retry, and endpoint-failover tuning for every network call. */
  readonly rpcPolicy?: Partial<RpcPolicy>;
  /** Structured logging sink. Nothing is emitted unless this is supplied. */
  readonly logger?: Logger;
  /** Store that makes `signAndSend` retries safe. Defaults to a process-local store. */
  readonly idempotencyStore?: IdempotencyStore;
}

/** Unified entry point for multi-chain wallet, transaction, and signing operations. */
export class Locktek {
  private readonly config: LocktekConfig;
  private readonly adapters = new Map<Chain, ChainAdapter>();
  private readonly encryptionProvider: IEncryptionProvider | undefined;
  private readonly policyEngine: PolicyEngine;
  private readonly logger: Logger | undefined;
  private readonly rpcPolicy: Partial<RpcPolicy> | undefined;
  private readonly nonceManager = new NonceManager();
  private readonly idempotencyStore: IdempotencyStore;

  constructor(options: LocktekOptions) {
    this.config = locktekConfigSchema.parse(options);
    this.logger = safeLogger(options.logger);
    this.rpcPolicy = options.rpcPolicy;
    this.idempotencyStore = options.idempotencyStore ?? new InMemoryIdempotencyStore();
    this.policyEngine = new PolicyEngine(options.policy ?? {}, this.logger);

    this.assertNetworkMode();

    if (options.encryptionProvider) {
      this.encryptionProvider = options.encryptionProvider;
    } else if (this.config.encryptionKey) {
      this.encryptionProvider = new AesGcmEncryptionProvider(this.config.encryptionKey);
    }

    this.logger?.info?.('locktek.initialised', {
      chains: this.config.chains,
      defaultChain: this.config.defaultChain,
      testnetOnly: this.config.testnet,
      policyEnforced: !this.policyEngine.isUnbounded,
    });

    if (this.policyEngine.isUnbounded) {
      this.logger?.warn?.('locktek.policy_unbounded', {
        message: 'No spend limits or recipient rules are configured. Fund movement is unbounded.',
      });
    }
  }

  /** The list of configured chains. */
  get chains(): readonly Chain[] {
    return this.config.chains as Chain[];
  }

  /** The default chain used when no chain argument is provided. */
  get defaultChain(): Chain {
    return this.config.defaultChain as Chain;
  }

  /** True when this instance refuses mainnet chains. */
  get isTestnetOnly(): boolean {
    return this.config.testnet;
  }

  /** Every policy decision this instance has made, oldest first. */
  get policyAudit(): readonly PolicyAuditEntry[] {
    return this.policyEngine.audit;
  }

  /**
   * Enforce the `testnet` flag at construction.
   *
   * The flag defaults to true and reads as a safety guarantee, so it has to be one.
   * Failing here — rather than on the first transfer — means a misconfigured chain
   * cannot move real funds during development.
   */
  private assertNetworkMode(): void {
    if (!this.config.testnet) return;

    const mainnetChains = (this.config.chains as Chain[]).filter((c) => !this.isTestnetChain(c));
    if (mainnetChains.length === 0) return;

    throw new LocktekError(
      `testnet mode is enabled but mainnet chain(s) are configured: ${mainnetChains.join(', ')}. ` +
        'Pass testnet: false to opt in to mainnet explicitly, or use the testnet equivalents.',
      ErrorCode.MAINNET_BLOCKED,
    );
  }

  /** Built-in chains use the static table; a custom chain declares it in its NetworkConfig. */
  private isTestnetChain(chain: Chain): boolean {
    return isValidChain(chain) ? isTestnet(chain) : getNetworkConfig(chain).isTestnet;
  }

  private getAdapter(chain?: Chain): ChainAdapter {
    const resolvedChain = chain ?? this.defaultChain;

    if (!this.config.chains.includes(resolvedChain)) {
      throw new LocktekError(
        `Chain "${resolvedChain}" is not configured. Configured chains: ${this.config.chains.join(', ')}`,
        ErrorCode.INVALID_CHAIN,
      );
    }

    if (this.config.testnet && !this.isTestnetChain(resolvedChain)) {
      throw new LocktekError(
        `Chain "${resolvedChain}" is a mainnet chain and testnet mode is enabled. ` +
          'Pass testnet: false to opt in to mainnet explicitly.',
        ErrorCode.MAINNET_BLOCKED,
      );
    }

    const existing = this.adapters.get(resolvedChain);
    if (existing) return existing;

    const adapter = createAdapter(resolvedChain, {
      rpcUrl: this.config.rpc?.[resolvedChain],
      rpcPolicy: this.rpcPolicy,
      logger: this.logger,
      nonceManager: this.nonceManager,
      idempotencyStore: this.idempotencyStore,
    });

    this.adapters.set(resolvedChain, adapter);
    return adapter;
  }

  private getEncryption(): IEncryptionProvider {
    if (!this.encryptionProvider) {
      throw new LocktekError(
        'Encryption key not configured. Pass encryptionKey in options or set LOCKTEK_ENCRYPTION_KEY.',
        ErrorCode.ENCRYPTION_KEY_REQUIRED,
      );
    }
    return this.encryptionProvider;
  }

  /** Generate a new random wallet on the specified (or default) chain. */
  async createWallet(chain?: Chain): Promise<WalletData> {
    return this.getAdapter(chain).createWallet();
  }

  /** Import an existing wallet from a private key. */
  async importWallet(privateKey: string, chain?: Chain): Promise<WalletData> {
    return this.getAdapter(chain).importWallet(privateKey);
  }

  /** Native token balance for an address, in base units. */
  async getBalance(address: string, chain?: Chain): Promise<string> {
    return this.getAdapter(chain).getBalance(address);
  }

  /** Native token balance for an address, in whole units with its symbol. */
  async getBalanceFormatted(
    address: string,
    chain?: Chain,
  ): Promise<{ balance: string; balanceFormatted: string; decimals: number; symbol: string }> {
    const resolved = chain ?? this.defaultChain;
    const config = getNetworkConfig(resolved);
    const balance = await this.getBalance(address, chain);
    const { formatNativeAmount } = await import('./utils/format.js');

    return {
      balance,
      balanceFormatted: formatNativeAmount(balance, config.decimals),
      decimals: config.decimals,
      symbol: config.symbol,
    };
  }

  /** Token balance for an address, in base units. */
  async getTokenBalance(address: string, tokenAddress: string, chain?: Chain): Promise<string> {
    return this.getAdapter(chain).getTokenBalance(address, tokenAddress);
  }

  /** Token balance for an address, in whole units using the contract's own decimals. */
  async getTokenBalanceFormatted(
    address: string,
    tokenAddress: string,
    chain?: Chain,
  ): Promise<{ balance: string; balanceFormatted: string; decimals: number }> {
    const adapter = this.getAdapter(chain);
    const [balance, decimals] = await Promise.all([
      adapter.getTokenBalance(address, tokenAddress),
      adapter.getTokenDecimals(tokenAddress),
    ]);
    const { formatNativeAmount } = await import('./utils/format.js');

    return { balance, balanceFormatted: formatNativeAmount(balance, decimals), decimals };
  }

  /** Decimals declared by a token contract. */
  async getTokenDecimals(tokenAddress: string, chain?: Chain): Promise<number> {
    return this.getAdapter(chain).getTokenDecimals(tokenAddress);
  }

  /**
   * Build an unsigned transaction. `params.amount` is in whole units.
   *
   * The configured policy is evaluated here, before anything is signed, so a refused
   * transfer never produces a signable artefact.
   */
  async buildTransaction(params: TransactionParams, chain?: Chain): Promise<UnsignedTransaction> {
    const adapter = this.getAdapter(chain);
    const decimals = await this.resolveDecimals(adapter, params, chain);

    this.policyEngine.assert({
      chain: chain ?? this.defaultChain,
      to: params.to,
      amount: params.amount,
      decimals,
      tokenAddress: params.tokenAddress,
    });

    try {
      return await adapter.buildTransaction(params);
    } catch (error: unknown) {
      this.policyEngine.release({
        chain: chain ?? this.defaultChain,
        to: params.to,
        amount: params.amount,
        decimals,
        tokenAddress: params.tokenAddress,
      });
      throw error;
    }
  }

  /**
   * Evaluate a transfer against the policy without building or signing anything.
   * Use this to show a caller what would happen before committing.
   */
  async simulateTransaction(
    params: TransactionParams,
    chain?: Chain,
  ): Promise<{
    allowed: boolean;
    reason?: string;
    rule?: string;
    chain: Chain;
    from: string;
    to: string;
    amount: string;
    baseUnitAmount: string;
    decimals: number;
    estimatedGas?: GasEstimate;
  }> {
    const resolved = chain ?? this.defaultChain;
    const adapter = this.getAdapter(chain);
    const decimals = await this.resolveDecimals(adapter, params, chain);
    const { parseNativeAmount } = await import('./utils/format.js');

    const decision = this.policyEngine.check({
      chain: resolved,
      to: params.to,
      amount: params.amount,
      decimals,
      tokenAddress: params.tokenAddress,
    });

    const base = {
      chain: resolved,
      from: params.from,
      to: params.to,
      amount: params.amount,
      baseUnitAmount: parseNativeAmount(params.amount, decimals).toString(),
      decimals,
    };

    if (!decision.allowed) {
      return { allowed: false, reason: decision.reason, rule: decision.rule, ...base };
    }

    return { allowed: true, ...base, estimatedGas: await adapter.estimateGas(params) };
  }

  /**
   * Sign an unsigned transaction and broadcast it.
   *
   * Pass `options.idempotencyKey` to make a retry safe: replaying the same key
   * returns the original hash rather than broadcasting a second transaction.
   */
  async signAndSend(
    tx: UnsignedTransaction,
    privateKey: string,
    chainOrOptions?: Chain | SendOptions,
    maybeOptions?: SendOptions,
  ): Promise<{ hash: string }> {
    // `signAndSend(tx, key, undefined, options)` must behave the same as
    // `signAndSend(tx, key, options)`. Treating an explicit `undefined` chain as
    // "no options were passed" silently discarded the idempotency key, which is the
    // one argument whose absence causes a double broadcast.
    const chainGiven = typeof chainOrOptions === 'string';
    const chain = chainGiven ? chainOrOptions : undefined;
    const options = (chainGiven ? maybeOptions : (chainOrOptions ?? maybeOptions)) ?? {};

    return this.getAdapter(chain).signAndSend(tx, privateKey, options);
  }

  /** Wait for a broadcast transaction to be mined and report whether it succeeded. */
  async waitForConfirmation(
    hash: string,
    chain?: Chain,
    options?: ConfirmationOptions,
  ): Promise<TransactionReceipt> {
    return this.getAdapter(chain).waitForConfirmation(hash, options);
  }

  /** Sign an arbitrary message, returning the signature and signer address. */
  async signMessage(
    message: string,
    privateKey: string,
    chain?: Chain,
  ): Promise<{ signature: string; address: string }> {
    return this.getAdapter(chain).signMessage(message, privateKey);
  }

  /** Estimate gas/fees for a transaction without broadcasting it. */
  async estimateGas(params: TransactionParams, chain?: Chain): Promise<GasEstimate> {
    return this.getAdapter(chain).estimateGas(params);
  }

  /** Check whether an address is valid for the specified (or default) chain. */
  validateAddress(address: string, chain?: Chain): boolean {
    return this.getAdapter(chain).validateAddress(address);
  }

  /** Probe every configured chain's RPC endpoints. Never throws. */
  async healthCheck(): Promise<
    Record<string, { healthy: boolean; endpoint: string; latencyMs: number; error?: string }>
  > {
    const entries = await Promise.all(
      (this.config.chains as Chain[]).map(async (chain) => {
        try {
          return [chain, await this.getAdapter(chain).healthCheck()] as const;
        } catch (error: unknown) {
          return [
            chain,
            {
              healthy: false,
              endpoint: 'unknown',
              latencyMs: 0,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          ] as const;
        }
      }),
    );

    return Object.fromEntries(entries);
  }

  /** Encrypt a string using the configured encryption provider. */
  async encrypt(plaintext: string): Promise<string> {
    return this.getEncryption().encrypt(plaintext);
  }

  /** Decrypt a string previously encrypted with {@link encrypt}. */
  async decrypt(ciphertext: string): Promise<string> {
    return this.getEncryption().decrypt(ciphertext);
  }

  /**
   * Create a new wallet and encrypt its private key and mnemonic.
   *
   * Both ciphertexts are returned. Persist `encryptedMnemonic` alongside
   * `encryptedPrivateKey` — it is the only thing that makes the wallet recoverable
   * in a standard wallet if the key ciphertext is ever lost.
   */
  async createAndEncryptWallet(chain?: Chain): Promise<WalletData> {
    const wallet = await this.createWallet(chain);
    const encryption = this.getEncryption();

    const encryptedPrivateKey = wallet.privateKey
      ? await encryption.encrypt(wallet.privateKey)
      : undefined;

    const encryptedMnemonic =
      'mnemonic' in wallet && wallet.mnemonic
        ? await encryption.encrypt(wallet.mnemonic as string)
        : undefined;

    return {
      ...wallet,
      privateKey: undefined,
      encryptedPrivateKey,
      ...('mnemonic' in wallet ? { mnemonic: undefined, encryptedMnemonic } : {}),
    };
  }

  /**
   * Decrypt a stored wallet back into usable key material.
   *
   * This is the recovery path: without it, an encrypted private key in a database is
   * a value nothing can ever spend.
   */
  async recoverWallet(stored: {
    encryptedPrivateKey?: string;
    encryptedMnemonic?: string;
    chain?: Chain;
  }): Promise<{ privateKey?: string; mnemonic?: string; address?: string }> {
    const encryption = this.getEncryption();

    if (!stored.encryptedPrivateKey && !stored.encryptedMnemonic) {
      throw new LocktekError(
        'Nothing to recover: provide encryptedPrivateKey, encryptedMnemonic, or both.',
        ErrorCode.INVALID_CONFIG,
      );
    }

    const privateKey = stored.encryptedPrivateKey
      ? await encryption.decrypt(stored.encryptedPrivateKey)
      : undefined;

    const mnemonic = stored.encryptedMnemonic
      ? await encryption.decrypt(stored.encryptedMnemonic)
      : undefined;

    // Returning the address is what makes recovery *verifiable*. Decryption
    // succeeding only proves the ciphertext matches the key; a ciphertext stored
    // against the wrong record decrypts just as cleanly. Comparing this address to
    // the one on record is the only check that catches it.
    const address = privateKey
      ? (await this.importWallet(privateKey, stored.chain)).address
      : undefined;

    return { privateKey, mnemonic, address };
  }

  private async resolveDecimals(
    adapter: ChainAdapter,
    params: TransactionParams,
    chain?: Chain,
  ): Promise<number> {
    if (!params.tokenAddress) return getNetworkConfig(chain ?? this.defaultChain).decimals;
    return params.tokenDecimals ?? adapter.getTokenDecimals(params.tokenAddress);
  }
}

/** Convenience factory that creates and returns a new {@link Locktek} instance. */
export function createLocktek(options: LocktekOptions): Locktek {
  return new Locktek(options);
}
