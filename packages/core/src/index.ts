// Types
export type {
  Chain,
  EvmChain,
  TronChain,
  ChainFamily,
  NetworkConfig,
  ChainConfig,
} from './types/index.js';

export type { WalletData, HDWalletData } from './types/index.js';

export type {
  TransactionParams,
  UnsignedTransaction,
  SignedTransaction,
  GasEstimate,
  SendOptions,
  TransactionReceipt,
  ConfirmationOptions,
} from './types/index.js';

export { ErrorCode, LocktekError } from './types/index.js';

// Config
export { locktekConfigSchema } from './config/index.js';
export type { LocktekConfig } from './config/index.js';

export {
  ALL_CHAINS,
  CHAIN_FAMILIES,
  CHAIN_CONFIGS,
  TESTNET_CHAINS,
  MAINNET_TO_TESTNET,
  TESTNET_TO_MAINNET,
  isValidChain,
  getChainFamily,
  isTestnet,
  getTestnetChain,
  getMainnetChain,
} from './config/index.js';

export { NETWORK_CONFIGS, getNetworkConfig, registerNetworkConfig } from './config/index.js';
export { getDefaultRpcUrl, getAllRpcUrls } from './config/index.js';

export {
  STABLECOIN_ADDRESSES,
  TOKEN_DECIMALS,
  getStablecoinAddress,
  formatTokenAmount,
  parseTokenAmount,
} from './config/index.js';
export type { StablecoinAsset } from './config/index.js';

// Encryption
export type { IEncryptionProvider } from './encryption/index.js';
export { AesGcmEncryptionProvider, secureEquals } from './encryption/index.js';
export type { AesGcmOptions, EncryptionKeyMaterial } from './encryption/index.js';

// Wallet
export { createHDWallet, createEVMWallet, createTronWallet } from './wallet/index.js';
export type { CreateHDWalletOptions } from './wallet/index.js';

export {
  BIP44CoinType,
  getDefaultDerivationPath,
  buildDerivationPath,
  getCoinType,
  parseDerivationPath,
  validateDerivationPath,
} from './wallet/index.js';
export type { DerivationOptions } from './wallet/index.js';

// Utils
export { validateEvmAddress, validateTronAddress, validateAddress } from './utils/index.js';
export { formatNativeAmount, parseNativeAmount } from './utils/index.js';
export { TronAddress } from './utils/index.js';

// Reliability
export {
  DEFAULT_RPC_POLICY,
  resolveRpcPolicy,
  classifyRpcError,
  isRetryableError,
  isInsufficientFunds,
  withTimeout,
  EndpointPool,
  redactUrl,
  scrubUrls,
  RpcExecutor,
} from './rpc/index.js';
export type { RpcPolicy, CallContext } from './rpc/index.js';

// Transaction safety
export { NonceManager, InMemoryIdempotencyStore } from './tx/index.js';
export type { IdempotencyStore, IdempotencyRecord } from './tx/index.js';

// Policy
export { PolicyEngine } from './policy/index.js';
export type {
  TransactionPolicy,
  PolicyCheckInput,
  PolicyDecision,
  PolicyAuditEntry,
} from './policy/index.js';

// Observability
export { safeLogger, redactFields } from './observability/index.js';
export type { Logger, LogFields } from './observability/index.js';

// Adapters
export type { ChainAdapter } from './adapters/index.js';
export { EvmAdapter, TronAdapter } from './adapters/index.js';
export type { EvmAdapterOptions, TronAdapterOptions } from './adapters/index.js';
export {
  createAdapter,
  registerChain,
  unregisterChain,
  isRegisteredChain,
} from './adapters/index.js';
export type { AdapterOptions, AdapterConstructor } from './adapters/index.js';

// Main class
export { Locktek, createLocktek } from './locktek.js';
export type { LocktekOptions } from './locktek.js';
