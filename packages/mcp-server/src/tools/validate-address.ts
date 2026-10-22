import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Chain } from '@locktek/core';
import { ok, fail } from './shared.js';
import type { ToolContext } from './shared.js';

export function registerValidateAddress(server: McpServer, { locktek }: ToolContext): void {
  server.registerTool(
    'validate_address',
    {
      description:
        'Check whether an address is valid for a chain. For EVM chains this verifies the ' +
        'EIP-55 checksum, so a mistyped mixed-case address is rejected rather than accepted.',
      inputSchema: {
        address: z.string().describe('The address to validate.'),
        chain: z.string().optional().describe('Target blockchain. Defaults to the default chain.'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ address, chain }) => {
      try {
        const resolvedChain = (chain ?? locktek.defaultChain) as Chain;
        const valid = locktek.validateAddress(address, resolvedChain);

        return ok({
          address,
          chain: resolvedChain,
          valid,
          ...(valid
            ? {}
            : {
                hint: 'A mixed-case EVM address with a bad EIP-55 checksum usually means a typo. Re-check the address before sending funds.',
              }),
        });
      } catch (error: unknown) {
        return fail('Error validating address', error);
      }
    },
  );
}
