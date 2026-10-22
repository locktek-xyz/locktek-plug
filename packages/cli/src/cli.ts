import { createRequire } from 'node:module';
import { Command } from 'commander';
import {
  registerInitCommand,
  registerChainsCommand,
  registerWalletCommand,
  registerSendCommand,
  registerHealthCommand,
} from './commands/index.js';
import { setJsonMode } from './utils/output.js';

interface PackageJson {
  readonly version: string;
}

function readVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json') as PackageJson;
  return pkg.version;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('locktek')
    .description(
      'Locktek CLI — create wallets, check balances, and send transactions from the terminal',
    )
    .version(readVersion(), '-v, --version')
    .option('--json', 'Emit a single JSON document on stdout, for scripting', false)
    .hook('preAction', (thisCommand) => {
      setJsonMode(Boolean(thisCommand.opts().json));
    });

  registerInitCommand(program);
  registerChainsCommand(program);
  registerWalletCommand(program);
  registerSendCommand(program);
  registerHealthCommand(program);

  return program;
}
