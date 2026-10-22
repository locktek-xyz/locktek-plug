import type { LocktekOptions, TransactionPolicy } from '@locktek/core';
import { ALL_CHAINS, isValidChain } from '@locktek/core';

export interface McpServerConfig {
  readonly locktekOptions: LocktekOptions;
  /**
   * When true, every transfer and signature needs a person's approval, requested
   * through the MCP client (elicitation). Clients that cannot ask are refused.
   */
  readonly requireConfirmation: boolean;
  /** How long a confirmation token stays valid. */
  readonly confirmationTtlMs: number;
  /**
   * The key the server signs with, from LOCKTEK_PRIVATE_KEY. It never crosses the MCP
   * transport. Without it the server is read-only: the signing tools are not offered.
   */
  readonly signingKey?: string;
}

const MIN_ENCRYPTION_KEY_LENGTH = 16;
const DEFAULT_CONFIRMATION_TTL_MS = 120_000;

function readList(name: string): string[] | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;

  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  return values.length > 0 ? values : undefined;
}

const TRUE_VALUES = ['1', 'true', 'yes', 'on'];
const FALSE_VALUES = ['0', 'false', 'no', 'off'];

/**
 * Parse a boolean flag strictly. An unrecognised value is a startup error rather than
 * `false`: these flags are safety switches, and `LOCKTEK_TESTNET=fasle` or
 * `LOCKTEK_READ_ONLY=required` silently meaning "off" would fail open.
 */
function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = raw.trim().toLowerCase();
  if (TRUE_VALUES.includes(value)) return true;
  if (FALSE_VALUES.includes(value)) return false;

  throw new Error(
    `${name} must be one of ${[...TRUE_VALUES, ...FALSE_VALUES].join(', ')}. Received: "${raw}".`,
  );
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number. Received: "${raw}".`);
  }
  return value;
}

/**
 * Build server configuration from the environment.
 *
 * Everything is validated here, at startup, rather than on the first tool call — a
 * stdio MCP server that fails later is invisible inside the host application.
 */
export function loadConfigFromEnv(): McpServerConfig {
  const chains = readList('LOCKTEK_CHAINS') ?? ['ethereum-sepolia'];

  const invalidChains = chains.filter((c) => !isValidChain(c));
  if (invalidChains.length > 0) {
    throw new Error(
      `Invalid chain(s) in LOCKTEK_CHAINS: ${invalidChains.join(', ')}. Valid chains: ${ALL_CHAINS.join(', ')}`,
    );
  }

  const defaultChain = process.env['LOCKTEK_DEFAULT_CHAIN'] ?? chains[0];
  if (!isValidChain(defaultChain)) {
    throw new Error(
      `Invalid LOCKTEK_DEFAULT_CHAIN: "${defaultChain}". Valid chains: ${ALL_CHAINS.join(', ')}`,
    );
  }
  if (!chains.includes(defaultChain)) {
    throw new Error(
      `LOCKTEK_DEFAULT_CHAIN "${defaultChain}" is not in LOCKTEK_CHAINS (${chains.join(', ')}).`,
    );
  }

  const encryptionKey = process.env['LOCKTEK_ENCRYPTION_KEY'];
  if (encryptionKey !== undefined && encryptionKey.length < MIN_ENCRYPTION_KEY_LENGTH) {
    throw new Error(
      `LOCKTEK_ENCRYPTION_KEY must be at least ${MIN_ENCRYPTION_KEY_LENGTH} characters.`,
    );
  }

  const rpc: Record<string, string> = {};
  for (const chain of chains) {
    const envKey = `LOCKTEK_RPC_${chain.toUpperCase().replace(/-/g, '_')}`;
    const rpcUrl = process.env[envKey];
    if (rpcUrl) rpc[chain] = rpcUrl;
  }

  const policy: TransactionPolicy = {
    maxAmountPerTransaction: process.env['LOCKTEK_MAX_AMOUNT_PER_TX'],
    maxAmountPerSession: process.env['LOCKTEK_MAX_AMOUNT_PER_SESSION'],
    allowedRecipients: readList('LOCKTEK_ALLOWED_RECIPIENTS'),
    deniedRecipients: readList('LOCKTEK_DENIED_RECIPIENTS'),
    readOnly: readBoolean('LOCKTEK_READ_ONLY', false),
  };

  const locktekOptions: LocktekOptions = {
    chains,
    defaultChain,
    encryptionKey,
    rpc: Object.keys(rpc).length > 0 ? rpc : undefined,
    testnet: readBoolean('LOCKTEK_TESTNET', true),
    policy,
    rpcPolicy: {
      timeoutMs: readPositiveInt('LOCKTEK_RPC_TIMEOUT_MS', 15_000),
      maxAttempts: readPositiveInt('LOCKTEK_RPC_MAX_ATTEMPTS', 3),
    },
  };

  const signingKey = process.env['LOCKTEK_PRIVATE_KEY']?.trim() || undefined;

  return {
    locktekOptions,
    requireConfirmation: readBoolean('LOCKTEK_REQUIRE_CONFIRMATION', false),
    confirmationTtlMs: readPositiveInt('LOCKTEK_CONFIRMATION_TTL_MS', DEFAULT_CONFIRMATION_TTL_MS),
    signingKey,
  };
}

/** True when no spend limit or recipient rule constrains the signer. */
export function isPolicyUnbounded(policy: TransactionPolicy | undefined): boolean {
  if (!policy) return true;
  return (
    !policy.readOnly &&
    !policy.maxAmountPerTransaction &&
    !policy.maxAmountPerSession &&
    !(policy.allowedRecipients && policy.allowedRecipients.length > 0)
  );
}
