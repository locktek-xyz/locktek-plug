import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Chain } from '@locktek/core';
import { ok, fail } from './shared.js';
import type { ToolContext } from './shared.js';

export function registerCreateWallet(server: McpServer, { locktek }: ToolContext): void {
  server.registerTool(
    'create_wallet',
    {
      description:
        'Create a new HD wallet. Returns the address, public key, and — when an encryption ' +
        'key is configured — the encrypted private key and mnemonic. Store BOTH ciphertexts: ' +
        'without them the wallet cannot be recovered and any funds sent to it are unreachable.',
      inputSchema: {
        chain: z
          .string()
          .optional()
          .describe('Target blockchain (e.g. "ethereum-sepolia"). Defaults to the default chain.'),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ chain }) => {
      try {
        const wallet = await locktek.createAndEncryptWallet(chain as Chain | undefined);

        return ok({
          address: wallet.address,
          publicKey: wallet.publicKey,
          chain: wallet.chain,
          chainFamily: wallet.chainFamily,
          derivationPath: wallet.derivationPath,
          encrypted: true,
          encryptedPrivateKey: wallet.encryptedPrivateKey,
          encryptedMnemonic: (wallet as { encryptedMnemonic?: string }).encryptedMnemonic,
          warning:
            'Persist encryptedPrivateKey AND encryptedMnemonic together with your encryption key. ' +
            'Losing any of them makes this wallet permanently unrecoverable.',
        });
      } catch (error: unknown) {
        return fail('Error creating wallet', error);
      }
    },
  );
}
