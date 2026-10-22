import { describe, it, expect, vi } from 'vitest';
import { ConfirmationStore } from '../confirmation-store.js';
import {
  registerCreateWallet,
  registerGetBalance,
  registerGetTokenBalance,
  registerSimulateTransaction,
  registerSendTransaction,
  registerConfirmTransaction,
  registerWaitForConfirmation,
  registerEstimateGas,
  registerValidateAddress,
  registerListChains,
  registerSignMessage,
  registerHealthCheck,
} from '../tools/index.js';
import type { ToolContext } from '../tools/shared.js';
import { createLocktekMcpServer } from '../server.js';
import { createApprovalRequester } from '../approval.js';

type Handler = (input: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

/** Captures the handlers the tools register, so each can be invoked directly. */
function createHarness() {
  const handlers = new Map<string, Handler>();
  const annotations = new Map<string, Record<string, unknown>>();

  const server = {
    registerTool(name: string, definition: Record<string, unknown>, handler: Handler) {
      handlers.set(name, handler);
      annotations.set(name, (definition.annotations ?? {}) as Record<string, unknown>);
    },
  };

  return { server, handlers, annotations };
}

const WALLET = {
  address: '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C',
  publicKey: '0x02abc',
  chain: 'ethereum-sepolia',
  chainFamily: 'evm',
  derivationPath: "m/44'/60'/0'/0/0",
  encryptedPrivateKey: 'enc-key',
  encryptedMnemonic: 'enc-mnemonic',
};

function createLocktekStub(overrides: Record<string, unknown> = {}) {
  return {
    chains: ['ethereum-sepolia', 'base-sepolia'],
    defaultChain: 'ethereum-sepolia',
    isTestnetOnly: true,
    createAndEncryptWallet: vi.fn(async () => WALLET),
    importWallet: vi.fn(async () => ({ address: WALLET.address })),
    buildTransaction: vi.fn(async () => ({ baseUnitAmount: '1000000000000000000' })),
    signAndSend: vi.fn(async () => ({ hash: '0xhash' })),
    waitForConfirmation: vi.fn(async () => ({
      hash: '0xhash',
      status: 'success',
      confirmations: 1,
    })),
    getBalanceFormatted: vi.fn(async () => ({
      balance: '1500000000000000000',
      balanceFormatted: '1.500000000000000000',
      decimals: 18,
      symbol: 'ETH',
    })),
    getTokenBalanceFormatted: vi.fn(async () => ({
      balance: '25000000',
      balanceFormatted: '25.000000',
      decimals: 6,
    })),
    estimateGas: vi.fn(async () => ({
      totalFee: '21000',
      totalFeeInToken: '0.000021',
      gasLimit: '21000',
      fromNetwork: true,
    })),
    simulateTransaction: vi.fn(async () => ({
      allowed: true,
      chain: 'ethereum-sepolia',
      from: WALLET.address,
      to: '0x0000000000000000000000000000000000000001',
      amount: '1',
      baseUnitAmount: '1000000000000000000',
      decimals: 18,
      estimatedGas: { totalFeeInToken: '0.000021', totalFee: '21000', fromNetwork: true },
    })),
    signMessage: vi.fn(async () => ({ signature: '0xsig', address: WALLET.address })),
    validateAddress: vi.fn(() => true),
    healthCheck: vi.fn(async () => ({
      'ethereum-sepolia': { healthy: true, endpoint: 'x', latencyMs: 3 },
    })),
    ...overrides,
  };
}

const SIGNING_KEY = `0x${'5'.repeat(64)}`;

function build(
  overrides: Record<string, unknown> = {},
  requireConfirmation = false,
  approval: { approved: true } | { approved: false; reason: string } = { approved: true },
) {
  const harness = createHarness();
  const locktek = createLocktekStub(overrides);
  const requestApproval = vi.fn(async (_message: string) => approval);
  const context = {
    locktek,
    confirmations: new ConfirmationStore(60_000),
    requireConfirmation,
    requestApproval,
    signingKey: SIGNING_KEY,
  } as unknown as ToolContext;

  for (const register of [
    registerCreateWallet,
    registerGetBalance,
    registerGetTokenBalance,
    registerSimulateTransaction,
    registerSendTransaction,
    registerConfirmTransaction,
    registerWaitForConfirmation,
    registerEstimateGas,
    registerValidateAddress,
    registerListChains,
    registerSignMessage,
    registerHealthCheck,
  ]) {
    register(harness.server as never, context);
  }

  return { ...harness, locktek, context, requestApproval };
}

const parse = (result: { content: { text: string }[] }) => JSON.parse(result.content[0].text);

describe('MCP tool surface', () => {
  it('registers every documented tool', () => {
    const { handlers } = build();

    expect([...handlers.keys()].sort()).toEqual([
      'confirm_transaction',
      'create_wallet',
      'estimate_gas',
      'get_balance',
      'get_token_balance',
      'health_check',
      'list_chains',
      'send_transaction',
      'sign_message',
      'simulate_transaction',
      'validate_address',
      'wait_for_confirmation',
    ]);
  });

  it('marks fund-moving tools destructive and read tools read-only', () => {
    const { annotations } = build();

    expect(annotations.get('send_transaction')).toMatchObject({ destructiveHint: true });
    expect(annotations.get('confirm_transaction')).toMatchObject({ destructiveHint: true });
    expect(annotations.get('get_balance')).toMatchObject({ readOnlyHint: true });
    expect(annotations.get('simulate_transaction')).toMatchObject({ readOnlyHint: true });
    // sign_message can authorise off-chain actions, so it must not claim to be read-only.
    expect(annotations.get('sign_message')).toMatchObject({ readOnlyHint: false });
  });
});

describe('list_chains', () => {
  it('reports the configured chains, not every supported chain', async () => {
    const { handlers } = build();
    const result = parse(await handlers.get('list_chains')!({}));

    expect(result.configured.map((c: { name: string }) => c.name)).toEqual([
      'ethereum-sepolia',
      'base-sepolia',
    ]);
    expect(result.total).toBe(2);
    expect(result.defaultChain).toBe('ethereum-sepolia');
    // The full catalogue is still available, clearly separated.
    expect(result.supported.length).toBe(12);
  });
});

describe('balances', () => {
  it('returns whole units alongside base units', async () => {
    const { handlers } = build();
    const result = parse(await handlers.get('get_balance')!({ address: WALLET.address }));

    expect(result).toMatchObject({
      balance: '1.500000000000000000',
      balanceBaseUnits: '1500000000000000000',
      symbol: 'ETH',
      decimals: 18,
    });
  });

  it('scales a token balance by the contract decimals', async () => {
    const { handlers } = build();
    const result = parse(
      await handlers.get('get_token_balance')!({
        address: WALLET.address,
        tokenAddress: '0xtoken',
      }),
    );

    expect(result).toMatchObject({ balance: '25.000000', decimals: 6 });
  });
});

describe('create_wallet', () => {
  it('returns both ciphertexts and warns that they are the only copy', async () => {
    const { handlers } = build();
    const result = parse(await handlers.get('create_wallet')!({}));

    expect(result.encryptedPrivateKey).toBe('enc-key');
    expect(result.encryptedMnemonic).toBe('enc-mnemonic');
    expect(result.warning).toMatch(/unrecoverable/);
  });

  it('never returns plaintext key material', async () => {
    const { handlers } = build();
    const payload = parse(await handlers.get('create_wallet')!({}));

    // Only the encrypted forms may appear; the plaintext fields must be absent.
    expect(Object.keys(payload)).not.toContain('privateKey');
    expect(Object.keys(payload)).not.toContain('mnemonic');
    expect(payload.encryptedPrivateKey).toBeDefined();
  });

  it('fails loudly when no encryption key is configured, instead of silently downgrading', async () => {
    const { handlers } = build({
      createAndEncryptWallet: vi.fn(async () => {
        throw new Error('Encryption key not configured');
      }),
    });

    const result = await handlers.get('create_wallet')!({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Encryption key not configured');
  });

  it('passes the requested chain through', async () => {
    const { handlers, locktek } = build();
    await handlers.get('create_wallet')!({ chain: 'base-sepolia' });

    expect(locktek.createAndEncryptWallet).toHaveBeenCalledWith('base-sepolia');
  });
});

describe('send_transaction', () => {
  it('reports the base-unit amount actually sent', async () => {
    const { handlers } = build();
    const result = parse(
      await handlers.get('send_transaction')!({
        to: '0x0000000000000000000000000000000000000001',
        amount: '1',
      }),
    );

    expect(result).toMatchObject({
      hash: '0xhash',
      amount: '1',
      amountBaseUnits: '1000000000000000000',
    });
  });

  it('passes an idempotency key through to the core', async () => {
    const { handlers, locktek } = build();
    await handlers.get('send_transaction')!({
      to: '0x1',
      amount: '1',
      idempotencyKey: 'payout-9',
    });

    expect(locktek.signAndSend).toHaveBeenCalledWith(
      expect.anything(),
      SIGNING_KEY,
      'ethereum-sepolia',
      {
        idempotencyKey: 'payout-9',
      },
    );
  });

  it('surfaces a policy refusal from the core with its error code', async () => {
    const { handlers } = build({
      buildTransaction: vi.fn(async () => {
        const { LocktekError, ErrorCode } = await import('@locktek/core');
        throw new LocktekError('over the limit', ErrorCode.POLICY_VIOLATION);
      }),
    });

    const result = await handlers.get('send_transaction')!({
      to: '0x1',
      amount: '1000',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('POLICY_VIOLATION');
  });

  it('redacts key material from an upstream error message', async () => {
    const leaked = `0x${'a'.repeat(64)}`;
    const { handlers } = build({
      importWallet: vi.fn(async () => {
        throw new Error(`bad key ${leaked}`);
      }),
    });

    const result = await handlers.get('send_transaction')!({ to: '0x1', amount: '1' });

    expect(result.content[0].text).not.toContain('a'.repeat(64));
    expect(result.content[0].text).toContain('[REDACTED_KEY]');
  });

  it('never takes a private key as input', () => {
    const schemas = new Map<string, Record<string, unknown>>();
    const capture = {
      registerTool(name: string, definition: { inputSchema?: Record<string, unknown> }) {
        schemas.set(name, definition.inputSchema ?? {});
      },
    };
    const { context } = build();
    registerSendTransaction(capture as never, context);
    registerConfirmTransaction(capture as never, context);
    registerSignMessage(capture as never, context);

    for (const [name, schema] of schemas) {
      expect(Object.keys(schema), name).not.toContain('privateKey');
    }
  });

  it('asks the person to approve the resolved amount before sending', async () => {
    const { handlers, locktek, requestApproval } = build({}, true);
    const result = parse(
      await handlers.get('send_transaction')!({
        to: '0x0000000000000000000000000000000000000001',
        amount: '1',
      }),
    );

    expect(result.hash).toBe('0xhash');
    expect(requestApproval).toHaveBeenCalledTimes(1);
    const prompt = requestApproval.mock.calls[0]![0];
    expect(prompt).toContain('1000000000000000000 base units');
    expect(prompt).toContain('0x0000000000000000000000000000000000000001');
    expect(locktek.signAndSend).toHaveBeenCalledTimes(1);
  });

  it('signs nothing when the person declines', async () => {
    const { handlers, locktek } = build({}, true, { approved: false, reason: 'declined' });
    const result = parse(await handlers.get('send_transaction')!({ to: '0x1', amount: '1' }));

    expect(result).toMatchObject({ refused: true, reason: 'declined' });
    expect(locktek.buildTransaction).not.toHaveBeenCalled();
    expect(locktek.signAndSend).not.toHaveBeenCalled();
  });

  it('does not ask for approval when the policy already refuses the transfer', async () => {
    const { handlers, locktek, requestApproval } = build(
      {
        simulateTransaction: vi.fn(async () => ({
          allowed: false,
          rule: 'maxAmountPerTransaction',
          reason: 'too big',
        })),
      },
      true,
    );
    const result = parse(await handlers.get('send_transaction')!({ to: '0x1', amount: '9' }));

    expect(result).toMatchObject({ refused: true, rule: 'maxAmountPerTransaction' });
    expect(requestApproval).not.toHaveBeenCalled();
    expect(locktek.signAndSend).not.toHaveBeenCalled();
  });
});

describe('simulate then confirm', () => {
  it('simulates without broadcasting and returns a token', async () => {
    const { handlers, locktek } = build({}, true);
    const result = parse(
      await handlers.get('simulate_transaction')!({
        from: WALLET.address,
        to: '0x0000000000000000000000000000000000000001',
        amount: '1',
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.amountBaseUnits).toBe('1000000000000000000');
    expect(result.confirmationToken).toBeDefined();
    expect(locktek.signAndSend).not.toHaveBeenCalled();
  });

  it('broadcasts exactly the simulated transfer when the token is redeemed', async () => {
    const { handlers, locktek } = build({}, true);
    const simulated = parse(
      await handlers.get('simulate_transaction')!({
        from: WALLET.address,
        to: '0x0000000000000000000000000000000000000001',
        amount: '1',
      }),
    );

    const confirmed = parse(
      await handlers.get('confirm_transaction')!({
        confirmationToken: simulated.confirmationToken,
      }),
    );

    expect(confirmed.hash).toBe('0xhash');
    expect(locktek.buildTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ to: '0x0000000000000000000000000000000000000001', amount: '1' }),
      'ethereum-sepolia',
    );
  });

  it('refuses a token that has already been used', async () => {
    const { handlers } = build({}, true);
    const simulated = parse(
      await handlers.get('simulate_transaction')!({
        from: WALLET.address,
        to: '0x1',
        amount: '1',
      }),
    );

    await handlers.get('confirm_transaction')!({
      confirmationToken: simulated.confirmationToken,
    });

    const second = parse(
      await handlers.get('confirm_transaction')!({
        confirmationToken: simulated.confirmationToken,
      }),
    );

    expect(second.refused).toBe(true);
  });

  it('refuses a token issued for a different sender than the server signs as', async () => {
    const { handlers, locktek } = build();
    const simulated = parse(
      await handlers.get('simulate_transaction')!({
        from: '0x0000000000000000000000000000000000000bad',
        to: '0x1',
        amount: '1',
      }),
    );

    const result = parse(
      await handlers.get('confirm_transaction')!({
        confirmationToken: simulated.confirmationToken,
      }),
    );

    expect(result.refused).toBe(true);
    expect(locktek.signAndSend).not.toHaveBeenCalled();
  });

  it('still asks the person when a token is redeemed under required confirmation', async () => {
    const { handlers, locktek, requestApproval } = build({}, true, {
      approved: false,
      reason: 'no elicitation support',
    });
    const simulated = parse(
      await handlers.get('simulate_transaction')!({ to: '0x1', amount: '1' }),
    );

    const result = parse(
      await handlers.get('confirm_transaction')!({
        confirmationToken: simulated.confirmationToken,
      }),
    );

    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(result.refused).toBe(true);
    expect(locktek.signAndSend).not.toHaveBeenCalled();
  });

  it('refuses an unknown token', async () => {
    const { handlers } = build({}, true);
    const result = parse(
      await handlers.get('confirm_transaction')!({
        confirmationToken: 'made-up',
      }),
    );

    expect(result.refused).toBe(true);
  });

  it('reports a refusal instead of issuing a token when policy blocks the transfer', async () => {
    const { handlers } = build({
      simulateTransaction: vi.fn(async () => ({
        allowed: false,
        rule: 'maxAmountPerTransaction',
        reason: 'too big',
        chain: 'ethereum-sepolia',
        from: WALLET.address,
        to: '0x1',
        amount: '1000',
        baseUnitAmount: '0',
        decimals: 18,
      })),
    });

    const result = parse(
      await handlers.get('simulate_transaction')!({
        from: WALLET.address,
        to: '0x1',
        amount: '1000',
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.rule).toBe('maxAmountPerTransaction');
    expect(result.confirmationToken).toBeUndefined();
  });
});

describe('supporting tools', () => {
  it('reports whether a fee estimate came from the network', async () => {
    const { handlers } = build();
    const result = parse(
      await handlers.get('estimate_gas')!({ from: WALLET.address, to: '0x1', amount: '1' }),
    );

    expect(result).toMatchObject({ totalFee: '0.000021', feeIsFromNetwork: true });
  });

  it('hints at a checksum typo when an address is invalid', async () => {
    const { handlers } = build({ validateAddress: vi.fn(() => false) });
    const result = parse(await handlers.get('validate_address')!({ address: '0xbad' }));

    expect(result.valid).toBe(false);
    expect(result.hint).toMatch(/checksum/);
  });

  it('reports transaction confirmation status', async () => {
    const { handlers } = build();
    const result = parse(await handlers.get('wait_for_confirmation')!({ hash: '0xhash' }));

    expect(result).toMatchObject({ status: 'success', confirmations: 1 });
  });

  it('reports per-chain RPC health', async () => {
    const { handlers } = build();
    const result = parse(await handlers.get('health_check')!({}));

    expect(result.chains['ethereum-sepolia'].healthy).toBe(true);
  });

  it('redacts key material from sign_message errors', async () => {
    const leaked = `0x${'b'.repeat(64)}`;
    const { handlers } = build({
      signMessage: vi.fn(async () => {
        throw new Error(`signing failed for ${leaked}`);
      }),
    });

    const result = await handlers.get('sign_message')!({ message: 'hi' });
    expect(result.content[0].text).not.toContain('b'.repeat(64));
  });

  it('shows the person the exact message before signing it', async () => {
    const { handlers, locktek, requestApproval } = build({}, true, {
      approved: false,
      reason: 'declined',
    });

    const result = parse(await handlers.get('sign_message')!({ message: 'login nonce 42' }));

    expect(requestApproval.mock.calls[0]![0]).toContain('login nonce 42');
    expect(result.refused).toBe(true);
    expect(locktek.signMessage).not.toHaveBeenCalled();
  });

  it('redacts an RPC API key from an error message', async () => {
    const { handlers } = build({
      getBalanceFormatted: vi.fn(async () => {
        throw new Error('request to https://rpc.example/v2/SECRET-API-KEY failed');
      }),
    });

    const result = await handlers.get('get_balance')!({
      address: '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C',
    });

    expect(result.content[0].text).not.toContain('SECRET-API-KEY');
  });
});

describe('createLocktekMcpServer', () => {
  const toolsOf = (server: unknown): string[] =>
    Object.keys((server as { _registeredTools: Record<string, unknown> })._registeredTools).sort();

  it('builds a server for a valid testnet configuration', () => {
    const server = createLocktekMcpServer({ chains: ['ethereum-sepolia'] });
    expect(server).toBeDefined();
  });

  it('offers no signing tools when it holds no key', () => {
    const tools = toolsOf(createLocktekMcpServer({ chains: ['ethereum-sepolia'] }));

    expect(tools).toHaveLength(9);
    expect(tools).not.toContain('send_transaction');
    expect(tools).not.toContain('confirm_transaction');
    expect(tools).not.toContain('sign_message');
  });

  it('offers all twelve tools when it holds a key', () => {
    const tools = toolsOf(
      createLocktekMcpServer({ chains: ['ethereum-sepolia'] }, { signingKey: SIGNING_KEY }),
    );

    expect(tools).toHaveLength(12);
    expect(tools).toContain('send_transaction');
  });

  it('refuses a mainnet chain unless testnet mode is turned off', () => {
    expect(() =>
      createLocktekMcpServer({ chains: ['ethereum'], defaultChain: 'ethereum' }),
    ).toThrow(/testnet/);
  });
});

describe('createApprovalRequester', () => {
  function fakeServer(capabilities: Record<string, unknown> | undefined, answer?: unknown) {
    const elicitInput = vi.fn(async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    });
    return {
      server: { server: { getClientCapabilities: () => capabilities, elicitInput } },
      elicitInput,
    };
  }

  it('approves only on an explicit yes from the person', async () => {
    const { server } = fakeServer(
      { elicitation: {} },
      { action: 'accept', content: { approve: true } },
    );
    await expect(createApprovalRequester(server as never)('ok?')).resolves.toEqual({
      approved: true,
    });
  });

  it('refuses when the person accepts the form without ticking approve', async () => {
    const { server } = fakeServer(
      { elicitation: {} },
      { action: 'accept', content: { approve: false } },
    );
    await expect(createApprovalRequester(server as never)('ok?')).resolves.toMatchObject({
      approved: false,
    });
  });

  it('refuses when the person declines or dismisses the prompt', async () => {
    for (const action of ['decline', 'cancel']) {
      const { server } = fakeServer({ elicitation: {} }, { action });
      await expect(createApprovalRequester(server as never)('ok?')).resolves.toMatchObject({
        approved: false,
      });
    }
  });

  it('fails closed when the client cannot show a prompt', async () => {
    const { server, elicitInput } = fakeServer({});
    await expect(createApprovalRequester(server as never)('ok?')).resolves.toMatchObject({
      approved: false,
      reason: expect.stringContaining('elicitation'),
    });
    expect(elicitInput).not.toHaveBeenCalled();
  });

  it('fails closed when the prompt itself errors', async () => {
    const { server } = fakeServer({ elicitation: {} }, new Error('transport closed'));
    await expect(createApprovalRequester(server as never)('ok?')).resolves.toMatchObject({
      approved: false,
    });
  });
});
