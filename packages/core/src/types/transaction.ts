import type { Chain, ChainFamily } from './chain.js';

/**
 * Parameters for building a blockchain transaction.
 *
 * `amount` is expressed in **whole units** — "0.1" means 0.1 ETH, not 0.1 wei.
 * This is the same unit used by the CLI, the MCP tools, and every public surface;
 * adapters convert to base units internally.
 */
export interface TransactionParams {
  readonly from: string;
  readonly to: string;
  /** Amount in whole units (e.g. "0.1" for 0.1 ETH, "25" for 25 USDC). */
  readonly amount: string;
  readonly tokenAddress?: string;
  /**
   * Decimals of the token being transferred. Omit to read `decimals()` from the
   * contract, which is authoritative but costs one extra call.
   */
  readonly tokenDecimals?: number;
  readonly data?: string;
  readonly gasLimit?: string;
  readonly gasPrice?: string;
  readonly maxFeePerGas?: string;
  readonly maxPriorityFeePerGas?: string;
  readonly nonce?: number;
}

/** Chain-specific unsigned transaction ready to be signed and broadcast. */
export interface UnsignedTransaction {
  readonly chain: Chain;
  readonly chainFamily: ChainFamily;
  readonly chainId: number | string;
  readonly data: string;
  readonly params: TransactionParams;
  readonly estimatedGas?: GasEstimate;
  /** Base-unit value this transaction will actually move, for verification before signing. */
  readonly baseUnitAmount?: string;
}

export interface SignedTransaction {
  readonly hash: string;
  readonly rawTransaction: string;
  readonly chain: Chain;
  readonly chainId: number | string;
}

/** Estimated gas/fee breakdown for a transaction. */
export interface GasEstimate {
  readonly gasLimit?: string;
  readonly gasPrice?: string;
  readonly maxFeePerGas?: string;
  readonly maxPriorityFeePerGas?: string;
  /** Total fee in base units. */
  readonly totalFee: string;
  /** Total fee in whole units of the chain's native token. */
  readonly totalFeeInToken: string;
  /** True when the estimate comes from live chain data rather than fallback constants. */
  readonly fromNetwork?: boolean;
}

/** Options controlling how a transaction is broadcast. */
export interface SendOptions {
  /**
   * Caller-supplied key that makes a retry safe. Replaying the same key returns the
   * original result instead of broadcasting a second transaction.
   */
  readonly idempotencyKey?: string;
}

/** Outcome of a transaction once it has been mined. */
export interface TransactionReceipt {
  readonly hash: string;
  readonly status: 'success' | 'reverted';
  readonly blockNumber?: number;
  readonly confirmations: number;
  readonly gasUsed?: string;
}

/** Options for awaiting confirmation of a broadcast transaction. */
export interface ConfirmationOptions {
  readonly confirmations?: number;
  readonly timeoutMs?: number;
}
