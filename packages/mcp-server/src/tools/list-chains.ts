import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ALL_CHAINS, CHAIN_FAMILIES, isTestnet } from '@locktek/core';
import type { Chain } from '@locktek/core';
import { ok } from './shared.js';
import type { ToolContext } from './shared.js';

export function registerListChains(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'list_chains',
    {
      description:
        'List the blockchain networks this server is configured to use, with their family ' +
        '(evm/tron) and testnet status. Also reports every chain the SDK supports.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const describe = (chain: Chain) => ({
        name: chain,
        chainFamily: CHAIN_FAMILIES[chain],
        testnet: isTestnet(chain),
      });

      const configured = context.locktek.chains.map(describe);

      return ok({
        configured,
        defaultChain: context.locktek.defaultChain,
        testnetOnly: context.locktek.isTestnetOnly,
        total: configured.length,
        supported: ALL_CHAINS.map(describe),
      });
    },
  );
}
