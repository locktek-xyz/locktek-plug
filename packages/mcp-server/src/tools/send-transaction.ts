import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Chain } from '@locktek/core';
import { ok, fail, requireSigningKey } from './shared.js';
import type { ToolContext } from './shared.js';

interface TransferInput {
  readonly to: string;
  readonly amount: string;
  readonly chain?: string;
  readonly tokenAddress?: string;
  readonly idempotencyKey?: string;
  /** For a redeemed confirmation token: the sender the token was issued for. */
  readonly expectedFrom?: string;
}

/** Shared by send_transaction and confirm_transaction. */
export async function performTransfer(context: ToolContext, input: TransferInput) {
  const signingKey = requireSigningKey(context);
  const resolvedChain = (input.chain ?? context.locktek.defaultChain) as Chain;
  const sender = await context.locktek.importWallet(signingKey, resolvedChain);

  if (input.expectedFrom && input.expectedFrom.toLowerCase() !== sender.address.toLowerCase()) {
    return ok({
      refused: true,
      reason:
        `This confirmation was issued for ${input.expectedFrom}, but this server signs as ` +
        `${sender.address}. Nothing was signed.`,
    });
  }

  const params = {
    from: sender.address,
    to: input.to,
    amount: input.amount,
    tokenAddress: input.tokenAddress,
  };

  if (context.requireConfirmation) {
    // Simulate server-side so the person approves the resolved amount and fee, not
    // whatever the model chose to describe.
    const simulation = await context.locktek.simulateTransaction(params, resolvedChain);
    if (!simulation.allowed) {
      return ok({ refused: true, rule: simulation.rule, reason: simulation.reason });
    }

    const approval = await context.requestApproval(
      [
        'Approve this transfer?',
        '',
        `Send:   ${simulation.amount}${input.tokenAddress ? ` of token ${input.tokenAddress}` : ''}`,
        `        (${simulation.baseUnitAmount} base units)`,
        `From:   ${sender.address}`,
        `To:     ${input.to}`,
        `Chain:  ${resolvedChain}${context.locktek.isTestnetOnly ? ' (testnet)' : ''}`,
        `Fee:    about ${simulation.estimatedGas?.totalFeeInToken ?? 'unknown'}`,
        '',
        'Approve only if you asked for exactly this transfer.',
      ].join('\n'),
    );
    if (!approval.approved) return ok({ refused: true, reason: approval.reason });
  }

  // buildTransaction enforces the policy before anything is signed.
  const tx = await context.locktek.buildTransaction(params, resolvedChain);
  const result = await context.locktek.signAndSend(tx, signingKey, resolvedChain, {
    idempotencyKey: input.idempotencyKey,
  });

  return ok({
    hash: result.hash,
    from: sender.address,
    to: input.to,
    amount: input.amount,
    amountBaseUnits: tx.baseUnitAmount,
    chain: resolvedChain,
    tokenAddress: input.tokenAddress ?? null,
    note: 'Broadcast accepted. Use wait_for_confirmation to learn whether it succeeded on chain.',
  });
}

const IDEMPOTENCY_KEY_DESCRIPTION =
  'Caller-chosen key that makes a retry safe. Reusing it — even after a timeout — resends ' +
  'the same signed transaction or returns its hash; it never signs a second transfer. Keys ' +
  'last for the life of the server process.';

export function registerSendTransaction(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'send_transaction',
    {
      description:
        "Send a transfer from the server's configured wallet. The amount is in WHOLE units — " +
        '"1" means 1 ETH, not 1 wei. Spend limits and recipient rules configured on the ' +
        'server are enforced before signing, and if the server requires confirmation the ' +
        'person using this client is asked to approve it. The signing key stays on the ' +
        'server; it is never an input or an output of this tool.',
      inputSchema: {
        to: z.string().describe('Recipient address.'),
        amount: z
          .string()
          .describe('Amount in WHOLE units, e.g. "0.1" for 0.1 ETH or "25" for 25 USDC.'),
        chain: z.string().optional().describe('Target blockchain. Defaults to the default chain.'),
        tokenAddress: z
          .string()
          .optional()
          .describe('Token contract address for ERC-20/TRC-20 transfers. Omit for native.'),
        idempotencyKey: z.string().optional().describe(IDEMPOTENCY_KEY_DESCRIPTION),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      try {
        return await performTransfer(context, input);
      } catch (error: unknown) {
        return fail('Error sending transaction', error);
      }
    },
  );
}

export function registerConfirmTransaction(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'confirm_transaction',
    {
      description:
        'Send a transfer previously checked with simulate_transaction, using its ' +
        'confirmationToken. The token is single-use, expires, and carries the exact transfer ' +
        'that was simulated, so it cannot be redeemed for other parameters or another sender. ' +
        'A token is not a human approval: if the server requires confirmation, the person ' +
        'using this client is asked to approve the transfer here.',
      inputSchema: {
        confirmationToken: z.string().describe('Token returned by simulate_transaction.'),
        idempotencyKey: z.string().optional().describe(IDEMPOTENCY_KEY_DESCRIPTION),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ confirmationToken, idempotencyKey }) => {
      try {
        const redeemed = context.confirmations.redeem(confirmationToken);
        if (!redeemed.ok) {
          return ok({ refused: true, reason: redeemed.reason });
        }

        const { transfer } = redeemed;
        return await performTransfer(context, {
          to: transfer.to,
          amount: transfer.amount,
          chain: transfer.chain,
          tokenAddress: transfer.tokenAddress,
          idempotencyKey,
          expectedFrom: transfer.from,
        });
      } catch (error: unknown) {
        return fail('Error confirming transaction', error);
      }
    },
  );
}
