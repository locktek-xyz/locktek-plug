import { describe, it, expect, vi } from 'vitest';

const { MockAPIError } = vi.hoisted(() => {
  class MockAPIError extends Error {
    status: string;
    body: { message?: string } | undefined;

    constructor(status: string, body?: { message?: string }) {
      super(body?.message ?? status);
      this.status = status;
      this.body = body;
    }
  }
  return { MockAPIError };
});

vi.mock('better-auth/api', () => ({
  sessionMiddleware: { id: 'session' },
  freshSessionMiddleware: { id: 'fresh-session' },
  APIError: MockAPIError,
  createAuthEndpoint: (path: string, config: Record<string, unknown>, handler: unknown) => ({
    path,
    config,
    handler,
  }),
}));

const { exportWalletEndpoint } = await import('../endpoints/export-wallet.js');

const ACK = 'I understand this reveals my private key';

interface StoredRow {
  id: string;
  userId: string;
  address: string;
  chain: string;
  encryptedPrivateKey?: string;
  encryptedMnemonic?: string | null;
}

function buildCtx(row: StoredRow | null, userId = 'user-1') {
  return {
    body: { walletId: 'wallet-1', acknowledgement: ACK },
    context: {
      session: { user: { id: userId } },
      adapter: { findOne: vi.fn().mockResolvedValue(row) },
    },
    json: vi.fn((data: unknown) => data),
  };
}

const ROW: StoredRow = {
  id: 'wallet-1',
  userId: 'user-1',
  address: '0xAAAA000000000000000000000000000000000001',
  chain: 'ethereum-sepolia',
  encryptedPrivateKey: 'ciphertext-pk',
  encryptedMnemonic: 'ciphertext-mnemonic',
};

function getHandler(
  recoverWallet: ReturnType<typeof vi.fn>,
  onExport: ReturnType<typeof vi.fn> = vi.fn(),
) {
  const locktek = { recoverWallet } as never;
  return (
    exportWalletEndpoint(locktek, onExport) as unknown as {
      handler: (ctx: unknown) => Promise<unknown>;
    }
  ).handler;
}

describe('exportWallet handler', () => {
  it('returns key material when the recovered address matches the record', async () => {
    const recoverWallet = vi.fn().mockResolvedValue({
      privateKey: '0xdeadbeef',
      mnemonic: 'test test test',
      address: ROW.address,
    });

    const result = (await getHandler(recoverWallet)(buildCtx(ROW))) as Record<string, unknown>;

    expect(result.privateKey).toBe('0xdeadbeef');
    expect(result.mnemonic).toBe('test test test');
  });

  it('requires a fresh session, not just any session', () => {
    const endpoint = exportWalletEndpoint({} as never, vi.fn()) as unknown as {
      config: { use: { id: string }[] };
    };
    expect(endpoint.config.use).toEqual([{ id: 'fresh-session' }]);
  });

  it('records the export before returning any key material', async () => {
    const order: string[] = [];
    const onExport = vi.fn(async () => {
      order.push('audit');
    });
    const recoverWallet = vi.fn().mockResolvedValue({ privateKey: '0xk', address: ROW.address });
    const ctx = buildCtx(ROW);
    ctx.json.mockImplementation((data: unknown) => {
      order.push('respond');
      return data;
    });

    await getHandler(recoverWallet, onExport)(ctx);

    expect(onExport).toHaveBeenCalledWith({
      userId: 'user-1',
      walletId: 'wallet-1',
      address: ROW.address,
      chain: ROW.chain,
    });
    expect(order).toEqual(['audit', 'respond']);
  });

  it('returns no key when the export cannot be recorded', async () => {
    const onExport = vi.fn(async () => {
      throw new Error('audit sink down');
    });
    const recoverWallet = vi.fn().mockResolvedValue({ privateKey: '0xk', address: ROW.address });
    const ctx = buildCtx(ROW);

    await expect(getHandler(recoverWallet, onExport)(ctx)).rejects.toThrow(/no key was returned/);
    expect(ctx.json).not.toHaveBeenCalled();
  });

  it('passes the stored chain so the address is derived on the right curve', async () => {
    const recoverWallet = vi.fn().mockResolvedValue({ privateKey: '0xk', address: ROW.address });

    await getHandler(recoverWallet)(buildCtx({ ...ROW, chain: 'tron-shasta' }));

    expect(recoverWallet).toHaveBeenCalledWith(expect.objectContaining({ chain: 'tron-shasta' }));
  });

  // The failure this guards: a ciphertext stored against the wrong row decrypts
  // cleanly, so without an address check the endpoint hands the caller someone
  // else's private key and calls it a successful export.
  it('refuses to return a key whose address does not match the record', async () => {
    const recoverWallet = vi.fn().mockResolvedValue({
      privateKey: '0xsomeone-elses-key',
      address: '0xBBBB000000000000000000000000000000000002',
    });

    await expect(getHandler(recoverWallet)(buildCtx(ROW))).rejects.toThrow(/does not match/i);
  });

  it('does not fire the audit hook when the address check fails', async () => {
    const onExport = vi.fn();
    const recoverWallet = vi.fn().mockResolvedValue({
      privateKey: '0xsomeone-elses-key',
      address: '0xBBBB000000000000000000000000000000000002',
    });

    await expect(getHandler(recoverWallet, onExport)(buildCtx(ROW))).rejects.toThrow();
    expect(onExport).not.toHaveBeenCalled();
  });

  it('rejects a wallet owned by a different user with the same message as a missing one', async () => {
    const recoverWallet = vi.fn();

    await expect(
      getHandler(recoverWallet)(buildCtx({ ...ROW, userId: 'someone-else' })),
    ).rejects.toThrow(/not found/i);
    await expect(getHandler(recoverWallet)(buildCtx(null))).rejects.toThrow(/not found/i);
    expect(recoverWallet).not.toHaveBeenCalled();
  });
});
