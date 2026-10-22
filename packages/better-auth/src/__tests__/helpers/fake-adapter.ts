import { vi } from 'vitest';
import type { WalletAdapter } from '../../provisioning.js';

/**
 * An in-memory stand-in for BetterAuth's database adapter that enforces the same
 * unique constraint the real schema declares on `walletKey`.
 *
 * Enforcing it here matters: without it a test would "prove" an idempotency the
 * database would not actually provide.
 */
export function createFakeAdapter() {
  const rows: Record<string, unknown>[] = [];
  let nextId = 1;

  return {
    rows,
    create: vi.fn(async ({ data }: { model: string; data: Record<string, unknown> }) => {
      if (rows.some((r) => r.walletKey === data.walletKey)) {
        throw new Error('UNIQUE constraint failed: locktekWallet.walletKey');
      }
      const row = { id: `wallet-${nextId++}`, ...data };
      rows.push(row);
      return row;
    }),
    findOne: vi.fn(
      async ({ where }: { model: string; where: { field: string; value: unknown }[] }) =>
        rows.find((r) => where.every((w) => r[w.field] === w.value)) ?? null,
    ),
    findMany: vi.fn(
      async ({ where }: { model: string; where: { field: string; value: unknown }[] }) =>
        rows.filter((r) => where.every((w) => r[w.field] === w.value)),
    ),
  } satisfies WalletAdapter & Record<string, unknown>;
}
