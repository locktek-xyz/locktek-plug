import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ok, fail } from './shared.js';
import type { ToolContext } from './shared.js';

export function registerHealthCheck(server: McpServer, { locktek }: ToolContext): void {
  server.registerTool(
    'health_check',
    {
      description:
        "Check whether each configured chain's RPC endpoints are reachable, with latency. " +
        'Use this to diagnose a failing tool call before assuming a wallet problem.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return ok({ chains: await locktek.healthCheck() });
      } catch (error: unknown) {
        return fail('Error running health check', error);
      }
    },
  );
}
