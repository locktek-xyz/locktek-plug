import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as LocktekCore from '@locktek/core';

const state = vi.hoisted(() => ({
  locktek: null as Record<string, ReturnType<typeof vi.fn>> | null,
  confirmAnswer: true,
  resolvedKey: `0x${'a'.repeat(64)}`,
  resolveKeyError: null as Error | null,
}));

vi.mock('@locktek/core', async (importOriginal) => {
  const actual = await importOriginal<typeof LocktekCore>();
  return {
    ...actual,
    createLocktek: vi.fn(() => state.locktek),
  };
});

vi.mock('../utils/secret-input.js', () => ({
  resolvePrivateKey: vi.fn(async () => {
    if (state.resolveKeyError) throw state.resolveKeyError;
    return state.resolvedKey;
  }),
  confirm: vi.fn(async () => state.confirmAnswer),
  promptHidden: vi.fn(async () => state.resolvedKey),
}));

const { createProgram } = await import('../cli.js');

const SENDER = '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C';
const RECIPIENT = '0x0000000000000000000000000000000000000001';

function stubLocktek(overrides: Record<string, unknown> = {}) {
  state.locktek = {
    defaultChain: 'ethereum-sepolia',
    chains: ['ethereum-sepolia'],
    importWallet: vi.fn(async () => ({ address: SENDER })),
    simulateTransaction: vi.fn(async () => ({
      allowed: true,
      amount: '0.5',
      baseUnitAmount: '500000000000000000',
      decimals: 18,
      estimatedGas: { totalFeeInToken: '0.000021' },
    })),
    buildTransaction: vi.fn(async () => ({ baseUnitAmount: '500000000000000000' })),
    signAndSend: vi.fn(async () => ({ hash: '0xhash' })),
    waitForConfirmation: vi.fn(async () => ({ status: 'success' })),
    ...overrides,
  } as never;
  return state.locktek!;
}

let stdout = '';
let stderr = '';
let writeOut: ReturnType<typeof vi.spyOn>;
let writeErr: ReturnType<typeof vi.spyOn>;

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

async function run(args: string[]) {
  const program = createProgram();
  program.exitOverride();
  await program.parseAsync(['node', 'locktek', ...args]);
}

describe('locktek send', () => {
  beforeEach(() => {
    stdout = '';
    stderr = '';
    state.confirmAnswer = true;
    state.resolveKeyError = null;
    process.exitCode = undefined;
    stubLocktek();
    writeOut = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((c: string | Uint8Array) => ((stdout += String(c)), true));
    writeErr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((c: string | Uint8Array) => ((stderr += String(c)), true));
  });

  afterEach(() => {
    writeOut.mockRestore();
    writeErr.mockRestore();
    process.exitCode = undefined;
  });

  it('shows the resolved amount in both units before signing', async () => {
    await run(['send', '--to', RECIPIENT, '--amount', '0.5', '-y']);

    const out = stripAnsi(stdout);
    // Showing base units is what catches a unit mistake while it is still reversible.
    expect(out).toContain('0.5 (500000000000000000 base units)');
    expect(out).toContain('0xhash');
  });

  it('asks for confirmation and aborts without signing when declined', async () => {
    state.confirmAnswer = false;
    const locktek = stubLocktek();

    await run(['send', '--to', RECIPIENT, '--amount', '0.5']);

    expect(locktek.signAndSend).not.toHaveBeenCalled();
    expect(stripAnsi(stderr)).toContain('Aborted');
    expect(process.exitCode).toBe(1);
  });

  it('skips the prompt with -y', async () => {
    state.confirmAnswer = false;
    const locktek = stubLocktek();

    await run(['send', '--to', RECIPIENT, '--amount', '0.5', '-y']);

    expect(locktek.signAndSend).toHaveBeenCalled();
  });

  it('refuses a transfer the policy blocks, before signing', async () => {
    const locktek = stubLocktek({
      simulateTransaction: vi.fn(async () => ({
        allowed: false,
        rule: 'maxAmountPerTransaction',
        reason: 'over the limit',
      })),
    });

    await run(['send', '--to', RECIPIENT, '--amount', '500', '-y']);

    expect(locktek.signAndSend).not.toHaveBeenCalled();
    expect(stripAnsi(stderr)).toContain('maxAmountPerTransaction');
    expect(process.exitCode).toBe(1);
  });

  it('passes the idempotency key through', async () => {
    const locktek = stubLocktek();

    await run([
      'send',
      '--to',
      RECIPIENT,
      '--amount',
      '0.5',
      '-y',
      '--idempotency-key',
      'payout-7',
    ]);

    expect(locktek.signAndSend).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      'ethereum-sepolia',
      {
        idempotencyKey: 'payout-7',
      },
    );
  });

  it('records idempotency keys on disk so they hold across runs', async () => {
    const { createLocktek } = await import('@locktek/core');
    const { FileIdempotencyStore } = await import('../utils/idempotency-store.js');

    await run(['send', '--to', RECIPIENT, '--amount', '0.5', '-y']);

    expect(createLocktek).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyStore: expect.any(FileIdempotencyStore) }),
    );
  });

  it('reports the mined status with --wait', async () => {
    await run(['send', '--to', RECIPIENT, '--amount', '0.5', '-y', '--wait']);
    expect(stripAnsi(stdout)).toContain('success');
  });

  it('says the broadcast is unconfirmed without --wait', async () => {
    await run(['send', '--to', RECIPIENT, '--amount', '0.5', '-y']);
    expect(stripAnsi(stdout)).toContain('--wait');
  });

  it('emits a single JSON document in --json mode', async () => {
    await run(['--json', 'send', '--to', RECIPIENT, '--amount', '0.5', '-y']);

    const parsed = JSON.parse(stdout);
    expect(parsed).toMatchObject({
      ok: true,
      hash: '0xhash',
      amountBaseUnits: '500000000000000000',
    });
  });

  it('rejects an unknown chain before doing any work', async () => {
    const locktek = stubLocktek();
    await run(['send', '--to', RECIPIENT, '--amount', '0.5', '-c', 'not-a-chain', '-y']);

    expect(locktek.signAndSend).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('surfaces a missing private key as a clear error', async () => {
    state.resolveKeyError = new Error('No private key available.');

    await run(['send', '--to', RECIPIENT, '--amount', '0.5', '-y']);

    expect(stripAnsi(stderr)).toContain('No private key available');
    expect(process.exitCode).toBe(1);
  });

  it('derives the sender when --from is omitted', async () => {
    const locktek = stubLocktek();
    await run(['send', '--to', RECIPIENT, '--amount', '0.5', '-y']);

    expect(locktek.importWallet).toHaveBeenCalled();
  });

  it('skips derivation when --from is supplied', async () => {
    const locktek = stubLocktek();
    await run(['send', '--to', RECIPIENT, '--amount', '0.5', '--from', SENDER, '-y']);

    expect(locktek.importWallet).not.toHaveBeenCalled();
  });
});

describe('locktek health', () => {
  beforeEach(() => {
    stdout = '';
    stderr = '';
    process.exitCode = undefined;
    writeOut = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((c: string | Uint8Array) => ((stdout += String(c)), true));
    writeErr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((c: string | Uint8Array) => ((stderr += String(c)), true));
  });

  afterEach(() => {
    writeOut.mockRestore();
    writeErr.mockRestore();
    process.exitCode = undefined;
  });

  it('reports healthy endpoints', async () => {
    stubLocktek({
      healthCheck: vi.fn(async () => ({
        'ethereum-sepolia': { healthy: true, endpoint: 'https://rpc', latencyMs: 12 },
      })),
    });

    await run(['health']);

    const out = stripAnsi(stdout);
    expect(out).toContain('ethereum-sepolia');
    expect(out).toContain('yes');
    expect(process.exitCode).toBeUndefined();
  });

  it('exits non-zero when an endpoint is unreachable', async () => {
    stubLocktek({
      healthCheck: vi.fn(async () => ({
        'ethereum-sepolia': { healthy: false, endpoint: 'https://rpc', latencyMs: 5000 },
      })),
    });

    await run(['health']);
    expect(process.exitCode).toBe(1);
  });

  it('reports health as JSON', async () => {
    stubLocktek({
      healthCheck: vi.fn(async () => ({
        'ethereum-sepolia': { healthy: true, endpoint: 'https://rpc', latencyMs: 12 },
      })),
    });

    await run(['--json', 'health']);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true });
  });
});
