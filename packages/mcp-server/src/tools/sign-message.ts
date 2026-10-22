import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Chain } from '@locktek/core';
import { ok, fail, requireSigningKey } from './shared.js';
import type { ToolContext } from './shared.js';

export function registerSignMessage(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'sign_message',
    {
      description:
        "Sign a text message with the server's configured wallet (EIP-191 personal_sign on " +
        'EVM, signMessageV2 on Tron), returning the signature and signer address. It cannot ' +
        'broadcast a transaction, but a signature can still authorise things off-chain — ' +
        'logins, orders, or approvals on services that accept signed messages — so treat it ' +
        'as privileged. If the server requires confirmation, the person using this client ' +
        'is asked to approve the exact message. The signing key stays on the server.',
      inputSchema: {
        message: z.string().describe('The message to sign.'),
        chain: z.string().optional().describe('Target blockchain. Defaults to the default chain.'),
      },
      // Not destructive on-chain, but it is not read-only either: the output can
      // authorise actions elsewhere, so hosts should be able to gate it.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ message, chain }) => {
      try {
        const signingKey = requireSigningKey(context);
        const resolvedChain = (chain ?? context.locktek.defaultChain) as Chain;

        if (context.requireConfirmation) {
          const approval = await context.requestApproval(
            `Approve signing this message on ${resolvedChain}?\n\n${message}\n\n` +
              'A signature can authorise actions on services that accept signed messages. ' +
              'Approve only if you know why it is needed.',
          );
          if (!approval.approved) return ok({ refused: true, reason: approval.reason });
        }

        const result = await context.locktek.signMessage(message, signingKey, resolvedChain);
        return ok({ ...result, chain: resolvedChain });
      } catch (error: unknown) {
        return fail('Error signing message', error);
      }
    },
  );
}
