import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLocktek } from '@locktek/core';
import type { Chain } from '@locktek/core';
import { isPolicyUnbounded, loadConfigFromEnv } from './config.js';
import type { McpServerConfig } from './config.js';
import { createLocktekMcpServer } from './server.js';
import { sanitizeErrorMessage } from './utils/sanitize.js';

// stdout carries the MCP protocol, so every diagnostic goes to stderr.
const note = (message: string): void => {
  process.stderr.write(`locktek-mcp: ${message}\n`);
};

/** Say plainly, at startup, what this server can do with real money. */
async function announce(config: McpServerConfig): Promise<void> {
  const { locktekOptions: options } = config;

  if (!config.signingKey) {
    note('read-only: LOCKTEK_PRIVATE_KEY is not set, so no signing tools are offered.');
    return;
  }

  // Derives the address and validates the key before the first tool call needs it.
  const chain = (options.defaultChain ?? options.chains[0]) as Chain;
  const signer = await createLocktek(options).importWallet(config.signingKey, chain);
  note(`signing as ${signer.address} on ${chain}.`);

  if (options.testnet === false) {
    note(
      'WARNING: mainnet is enabled. This project is experimental; do not use it with real funds.',
    );
  }
  if (isPolicyUnbounded(options.policy)) {
    note(
      'WARNING: no spend limit or recipient allowlist is configured. The agent can move this ' +
        "wallet's entire balance. Set LOCKTEK_MAX_AMOUNT_PER_TX and LOCKTEK_ALLOWED_RECIPIENTS.",
    );
  }
  if (!config.requireConfirmation) {
    note('transfers are not approved by a person. Set LOCKTEK_REQUIRE_CONFIRMATION=true to ask.');
  }
}

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  await announce(config);

  const server = createLocktekMcpServer(config.locktekOptions, {
    requireConfirmation: config.requireConfirmation,
    confirmationTtlMs: config.confirmationTtlMs,
    signingKey: config.signingKey,
  });

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // A startup failure is otherwise invisible inside the host application.
  note(`failed to start: ${sanitizeErrorMessage(message)}`);
  process.exit(1);
});
