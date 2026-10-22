import type { Chain, ChainFamily } from '../types/chain.js';
import type { WalletData } from '../types/wallet.js';
import type {
  TransactionParams,
  UnsignedTransaction,
  GasEstimate,
  SendOptions,
  TransactionReceipt,
  ConfirmationOptions,
} from '../types/transaction.js';

/** Chain-specific adapter that implements wallet, transaction, and signing operations. */
export interface ChainAdapter {
  readonly chain: Chain;
  readonly chainFamily: ChainFamily;

  /** Generate a new random wallet on this chain. */
  createWallet(): Promise<WalletData>;
  /** Reconstruct a wallet from an existing private key. */
  importWallet(privateKey: string): Promise<WalletData>;
  /** Return the native token balance for the given address (in base units). */
  getBalance(address: string): Promise<string>;
  /** Return the token balance for a specific contract/token address (in base units). */
  getTokenBalance(address: string, tokenAddress: string): Promise<string>;
  /** Decimals declared by a token contract. */
  getTokenDecimals(tokenAddress: string): Promise<number>;
  /** Build an unsigned transaction. `params.amount` is in whole units. */
  buildTransaction(params: TransactionParams): Promise<UnsignedTransaction>;
  /** Sign and broadcast a transaction, returning the transaction hash. */
  signAndSend(
    tx: UnsignedTransaction,
    privateKey: string,
    options?: SendOptions,
  ): Promise<{ hash: string }>;
  /** Wait for a broadcast transaction to be mined and report whether it succeeded. */
  waitForConfirmation(hash: string, options?: ConfirmationOptions): Promise<TransactionReceipt>;
  /** Sign an arbitrary message and return the signature with the signer address. */
  signMessage(message: string, privateKey: string): Promise<{ signature: string; address: string }>;
  /** Estimate gas/fees for a transaction without broadcasting. */
  estimateGas(params: TransactionParams): Promise<GasEstimate>;
  /** Check whether an address string is valid for this chain. */
  validateAddress(address: string): boolean;
  /** Cheap reachability probe for this chain's RPC endpoints. */
  healthCheck(): Promise<{ healthy: boolean; endpoint: string; latencyMs: number; error?: string }>;
}
