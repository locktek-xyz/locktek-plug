import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { ALL_CHAINS } from '@locktek/core';
import { success, error, info, warn } from '../utils/output.js';

const ALREADY_EXISTS = (file: string): string =>
  `${file} already exists. Use --force to overwrite.`;

function buildConfigContent(chains: readonly string[]): string {
  const chainList = chains.map((c) => `    '${c}',`).join('\n');
  // LocktekOptions rather than LocktekConfig: it includes `policy`, so adding spend
  // limits to the generated file typechecks instead of steering people away from them.
  return `import type { LocktekOptions } from '@locktek/core';

export default {
  chains: [
${chainList}
  ],
  defaultChain: '${chains[0]}',
  testnet: true,
  // Spend limits, checked before every send. Whole units, with no asset attached.
  // policy: { maxAmountPerTransaction: '0.1', allowedRecipients: ['0x...'] },
} satisfies LocktekOptions;
`;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Generate a locktek.config.ts file in the current directory')
    .option('--chains <chains>', 'Comma-separated list of chains to enable', 'ethereum-sepolia')
    .option('--force', 'Overwrite existing config file', false)
    .action((options: { chains: string; force: boolean }) => {
      const configPath = resolve(process.cwd(), 'locktek.config.ts');

      // The loader reads a .ts config before a .js one, so writing one would silently
      // replace the settings in an existing locktek.config.js.
      if (!options.force && existsSync(resolve(process.cwd(), 'locktek.config.js'))) {
        warn(ALREADY_EXISTS('locktek.config.js'));
        return;
      }

      const requestedChains = options.chains.split(',').map((c) => c.trim());

      const validChains = requestedChains.filter((c) =>
        (ALL_CHAINS as readonly string[]).includes(c),
      );

      const invalidChains = requestedChains.filter(
        (c) => !(ALL_CHAINS as readonly string[]).includes(c),
      );

      if (invalidChains.length > 0) {
        error(`Unknown chains: ${invalidChains.join(', ')}`);
        info(`Available chains: ${ALL_CHAINS.join(', ')}`);
        process.exitCode = 1;
        return;
      }

      if (validChains.length === 0) {
        error(`No valid chains specified. Available chains: ${ALL_CHAINS.join(', ')}`);
        process.exitCode = 1;
        return;
      }

      const content = buildConfigContent(validChains);
      // 'wx' makes the existence check and the write one step: it fails if anything,
      // including a dangling symlink, already has the name. Checking first and then
      // writing would follow a symlink created in between.
      try {
        writeFileSync(configPath, content, { encoding: 'utf-8', flag: options.force ? 'w' : 'wx' });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        warn(ALREADY_EXISTS('locktek.config.ts'));
        return;
      }
      success(`Created ${configPath}`);
      info(`Chains enabled: ${validChains.join(', ')}`);
    });
}
