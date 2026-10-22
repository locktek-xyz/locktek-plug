import type { Command } from 'commander';
import { createLocktek, isValidChain } from '@locktek/core';
import type { Chain } from '@locktek/core';
import { loadConfig } from '../utils/config-loader.js';
import { success, fail, info, label, heading, json, isJsonMode, warn } from '../utils/output.js';

export function registerWalletCommand(program: Command): void {
  const wallet = program.command('wallet').description('Wallet operations');

  wallet
    .command('create')
    .description('Create a new HD wallet')
    .option('-c, --chain <chain>', 'Chain to create the wallet on')
    .option(
      '--show-private-key',
      'Print the raw private key to stdout. Off by default so keys do not land in logs or scrollback.',
      false,
    )
    .action(async (options: { chain?: string; showPrivateKey?: boolean }) => {
      try {
        const config = await loadConfig();
        const chain = options.chain ?? config.defaultChain ?? config.chains[0];

        if (!isValidChain(chain)) {
          fail(`Unknown chain: "${chain}". Run 'locktek chains' to see supported chains.`);
          return;
        }

        const locktek = createLocktek(withChain(config, chain));
        const created = await locktek.createWallet(chain as Chain);

        const payload: Record<string, unknown> = {
          address: created.address,
          publicKey: created.publicKey,
          chain: created.chain,
          chainFamily: created.chainFamily,
          derivationPath: created.derivationPath,
        };

        if (options.showPrivateKey) {
          payload.privateKey = created.privateKey;
          payload.mnemonic = (created as { mnemonic?: string }).mnemonic;
        }

        if (isJsonMode()) {
          // The human path prints a warning that a wallet with no key is unusable.
          // A scripted caller needs the same fact, and stdout must stay a single JSON
          // document — so it travels in the payload rather than on stderr.
          json({
            ok: true,
            ...payload,
            privateKeyIncluded: Boolean(options.showPrivateKey),
            ...(options.showPrivateKey
              ? {
                  warning:
                    'This response contains the private key and mnemonic. Anything that ' +
                    'logs or stores it holds your funds.',
                }
              : {
                  warning:
                    'No key material was returned, so this wallet cannot be used. Re-run ' +
                    'with --show-private-key and record the key and mnemonic before ' +
                    'sending funds to this address.',
                }),
          });
          return;
        }

        heading('Wallet created');
        label('Address', created.address);
        label('Chain', created.chain);
        label('Family', created.chainFamily);
        if (created.derivationPath) label('Derivation Path', created.derivationPath);

        if (options.showPrivateKey) {
          label('Private Key', created.privateKey ?? '(none)');
          const mnemonic = (created as { mnemonic?: string }).mnemonic;
          if (mnemonic) label('Mnemonic', mnemonic);
          warn(
            'Private key printed to stdout. Anything capturing this terminal now holds your funds.',
          );
        } else {
          info('Re-run with --show-private-key to reveal the private key and mnemonic.');
          warn(
            'Without the private key or mnemonic this wallet cannot be used. ' +
              'Record them somewhere safe before sending funds to this address.',
          );
        }

        success('Done.');
      } catch (err: unknown) {
        fail(err instanceof Error ? err.message : 'Failed to create wallet.');
      }
    });

  wallet
    .command('balance <address>')
    .description('Check the native balance of an address')
    .option('-c, --chain <chain>', 'Chain to query')
    .action(async (address: string, options: { chain?: string }) => {
      try {
        const config = await loadConfig();
        const chain = options.chain ?? config.defaultChain ?? config.chains[0];

        if (!isValidChain(chain)) {
          fail(`Unknown chain: "${chain}". Run 'locktek chains' to see supported chains.`);
          return;
        }

        const locktek = createLocktek(withChain(config, chain));
        const result = await locktek.getBalanceFormatted(address, chain as Chain);

        if (isJsonMode()) {
          json({ ok: true, address, chain, ...result });
          return;
        }

        heading('Balance');
        label('Address', address);
        label('Chain', chain);
        label('Balance', `${result.balanceFormatted} ${result.symbol}`);
        label('Base units', result.balance);
      } catch (err: unknown) {
        fail(err instanceof Error ? err.message : 'Failed to fetch balance.');
      }
    });
}

/** Ensure the requested chain is present in the configured set. */
function withChain(
  config: Awaited<ReturnType<typeof loadConfig>>,
  chain: string,
): Parameters<typeof createLocktek>[0] {
  return {
    ...config,
    chains: config.chains.includes(chain) ? config.chains : [...config.chains, chain],
    defaultChain: chain,
  };
}
