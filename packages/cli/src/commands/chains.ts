import type { Command } from 'commander';
import { ALL_CHAINS, CHAIN_FAMILIES, isTestnet } from '@locktek/core';
import type { Chain } from '@locktek/core';
import { table, json, isJsonMode } from '../utils/output.js';

export function registerChainsCommand(program: Command): void {
  program
    .command('chains')
    .description('List all chains the SDK supports')
    .action(() => {
      const rows = ALL_CHAINS.map((chain) => ({
        chain,
        family: CHAIN_FAMILIES[chain as Chain],
        testnet: isTestnet(chain as Chain) ? 'yes' : 'no',
      }));

      if (isJsonMode()) {
        json({
          ok: true,
          chains: rows.map((r) => ({
            name: r.chain,
            chainFamily: r.family,
            testnet: r.testnet === 'yes',
          })),
        });
        return;
      }

      table(
        [
          { header: 'Chain', key: 'chain' },
          { header: 'Family', key: 'family' },
          { header: 'Testnet', key: 'testnet' },
        ],
        rows,
      );
    });
}
