/** Machine-readable error codes for all Locktek operations. */
export enum ErrorCode {
  INVALID_CONFIG = 'INVALID_CONFIG',
  INVALID_CHAIN = 'INVALID_CHAIN',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  INVALID_PRIVATE_KEY = 'INVALID_PRIVATE_KEY',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  TRANSACTION_REVERTED = 'TRANSACTION_REVERTED',
  TRANSACTION_DROPPED = 'TRANSACTION_DROPPED',
  ENCRYPTION_ERROR = 'ENCRYPTION_ERROR',
  ENCRYPTION_KEY_REQUIRED = 'ENCRYPTION_KEY_REQUIRED',
  RPC_ERROR = 'RPC_ERROR',
  TIMEOUT = 'TIMEOUT',
  POLICY_VIOLATION = 'POLICY_VIOLATION',
  MAINNET_BLOCKED = 'MAINNET_BLOCKED',
  UNSUPPORTED_OPERATION = 'UNSUPPORTED_OPERATION',
}

/** Structured error with a machine-readable {@link ErrorCode} and optional details. */
export class LocktekError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(message: string, code: ErrorCode, details?: unknown) {
    super(message);
    this.name = 'LocktekError';
    this.code = code;
    this.details = details;

    if (details instanceof Error) {
      this.cause = details;
    }
  }

  toJSON(): { name: string; code: ErrorCode; message: string } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
    };
  }
}
