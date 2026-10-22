import type { Command } from 'commander';
import { createLocktek } from '@locktek/core';
import { loadConfig } from '../utils/config-loader.js';
import { fail, heading, json, isJsonMode, table } from '../utils/output.js';

export function registerHealthCommand(program: Command): void {
  program
    .command('health')
    .description("Check whether each configured chain's RPC endpoints are reachable")
    .action(async () => {
      try {
        const config = await loadConfig();
        const results = await createLocktek(config).healthCheck();

        if (isJsonMode()) {
          json({ ok: Object.values(results).every((r) => r.healthy), chains: results });
          return;
        }

        heading('RPC health');
        table(
          [
            { header: 'CHAIN', key: 'chain' },
            { header: 'HEALTHY', key: 'healthy' },
            { header: 'LATENCY', key: 'latency', align: 'right' },
            { header: 'ENDPOINT', key: 'endpoint' },
          ],
          Object.entries(results).map(([chain, r]) => ({
            chain,
            healthy: r.healthy ? 'yes' : 'no',
            latency: `${r.latencyMs}ms`,
            endpoint: r.endpoint,
          })),
        );

        if (!Object.values(results).every((r) => r.healthy)) process.exitCode = 1;
      } catch (err: unknown) {
        fail(err instanceof Error ? err.message : 'Health check failed.');
      }
    });
}
