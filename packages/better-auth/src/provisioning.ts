import type { Locktek, Chain } from '@locktek/core';
import { walletKeyFor } from './schema.js';
import type { WalletResponse } from './types.js';

/** The subset of BetterAuth's adapter this module needs. */
export interface WalletAdapter {
  create(input: { model: string; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  findMany(input: {
    model: string;
    where: { field: string; value: unknown }[];
    sortBy?: { field: string; direction: 'asc' | 'desc' };
  }): Promise<unknown[]>;
  findOne?(input: {
    model: string;
    where: { field: string; value: unknown }[];
  }): Promise<Record<string, unknown> | null>;
}

export interface ProvisionResult {
  readonly wallet: WalletResponse;
  /** False when an existing wallet was returned instead of a new one being created. */
  readonly created: boolean;
}

/**
 * Create a wallet for a user on one chain, at most once.
 *
 * Idempotency is enforced twice on purpose: a lookup first, so the common case is
 * cheap and returns the existing wallet, and the unique constraint on `walletKey` as
 * the real guarantee, because two concurrent requests both pass the lookup.
 */
export async function provisionWallet(
  locktek: Locktek,
  adapter: WalletAdapter,
  userId: string,
  chain: Chain,
  label: string | null = null,
): Promise<ProvisionResult> {
  const walletKey = walletKeyFor(userId, chain);

  const existing = await findByWalletKey(adapter, walletKey);
  if (existing) return { wallet: toResponse(existing), created: false };

  const walletData = await locktek.createAndEncryptWallet(chain);

  if (!walletData.encryptedPrivateKey) {
    throw new Error(
      'Wallet was created but not encrypted. Configure encryptionKey in the plugin options.',
    );
  }

  const record = {
    userId,
    walletKey,
    address: walletData.address,
    chain: walletData.chain,
    chainFamily: walletData.chainFamily,
    publicKey: walletData.publicKey,
    encryptedPrivateKey: walletData.encryptedPrivateKey,
    encryptedMnemonic: (walletData as { encryptedMnemonic?: string }).encryptedMnemonic ?? null,
    label,
    createdAt: new Date(),
  };

  try {
    const created = await adapter.create({ model: 'locktekWallet', data: record });
    return { wallet: toResponse({ ...record, id: created.id }), created: true };
  } catch (error: unknown) {
    // Lost the race against a concurrent request: the wallet it created is the
    // canonical one, so return that rather than surfacing a constraint violation.
    if (isUniqueConstraintViolation(error)) {
      const winner = await findByWalletKey(adapter, walletKey);
      if (winner) return { wallet: toResponse(winner), created: false };
    }
    throw error;
  }
}

async function findByWalletKey(
  adapter: WalletAdapter,
  walletKey: string,
): Promise<Record<string, unknown> | null> {
  if (adapter.findOne) {
    return adapter.findOne({
      model: 'locktekWallet',
      where: [{ field: 'walletKey', value: walletKey }],
    });
  }

  const rows = (await adapter.findMany({
    model: 'locktekWallet',
    where: [{ field: 'walletKey', value: walletKey }],
  })) as Record<string, unknown>[];

  return rows[0] ?? null;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique|duplicate|constraint|UNIQUE/i.test(message);
}

/** Strip every secret field, whitelisting rather than blacklisting. */
export function toResponse(row: Record<string, unknown>): WalletResponse {
  return {
    id: String(row.id ?? ''),
    userId: String(row.userId ?? ''),
    address: String(row.address ?? ''),
    chain: String(row.chain ?? ''),
    chainFamily: String(row.chainFamily ?? ''),
    publicKey: String(row.publicKey ?? ''),
    label: (row.label as string | null) ?? null,
    createdAt: row.createdAt as Date,
  };
}

/** Which chains a signup should provision, given the plugin option. */
export function resolveAutoChains(
  option: boolean | string[] | undefined,
  defaultChain: string,
): string[] {
  if (option === undefined || option === false) return [];
  if (option === true) return [defaultChain];
  return option;
}
