import type { Command } from 'commander';
import { createLocktek, isValidChain } from '@locktek/core';
import type { Chain } from '@locktek/core';
import { loadConfig } from '../utils/config-loader.js';
import { FileIdempotencyStore } from '../utils/idempotency-store.js';
import { resolvePrivateKey, confirm } from '../utils/secret-input.js';
import { success, fail, info, label, heading, json, isJsonMode } from '../utils/output.js';

interface SendOptions {
  to: string;
  amount: string;
  key?: string;
  chain?: string;
  from?: string;
  token?: string;
  yes?: boolean;
  idempotencyKey?: string;
  wait?: boolean;
}

export function registerSendCommand(program: Command): void {
  program
    .command('send')
    .description('Build, sign, and send a transaction')
    .requiredOption('--to <address>', 'Recipient address')
    .requiredOption('--amount <amount>', 'Amount in WHOLE units — "0.5" means 0.5 ETH, not 0.5 wei')
    .option(
      '--key <privateKey>',
      'Sender private key. Prefer LOCKTEK_PRIVATE_KEY or the interactive prompt: ' +
        'a key passed here lands in your shell history.',
    )
    .option('-c, --chain <chain>', 'Chain to send on')
    .option('--from <address>', 'Sender address (derived from the key if omitted)')
    .option('--token <address>', 'Token contract address, for ERC-20/TRC-20 transfers')
    .option(
      '--idempotency-key <key>',
      'Makes a retry safe across runs: reusing the key resends the same signed transaction ' +
        'and never signs a second one (recorded under ~/.locktek, or LOCKTEK_STATE_DIR)',
    )
    .option('--wait', 'Wait for the transaction to be mined and report whether it succeeded', false)
    .option('-y, --yes', 'Skip the confirmation prompt', false)
    .action(async (options: SendOptions) => {
      try {
        const config = await loadConfig();
        const chain = options.chain ?? config.defaultChain ?? config.chains[0];

        if (!isValidChain(chain)) {
          fail(`Unknown chain: "${chain}". Run 'locktek chains' to see supported chains.`);
          return;
        }

        const privateKey = await resolvePrivateKey(options.key);

        const locktek = createLocktek({
          ...config,
          chains: config.chains.includes(chain) ? config.chains : [...config.chains, chain],
          defaultChain: chain,
          // On disk, so a retry in a later run (after a timeout or a crash) is still safe.
          idempotencyStore: new FileIdempotencyStore(),
        });

        const typedChain = chain as Chain;

        let from = options.from;
        if (!from) {
          info('Deriving sender address from private key...');
          from = (await locktek.importWallet(privateKey, typedChain)).address;
        }

        const params = {
          from,
          to: options.to,
          amount: options.amount,
          tokenAddress: options.token,
        };

        // Show the resolved amount before signing: this is the step that catches a
        // unit mistake while it is still reversible.
        const simulation = await locktek.simulateTransaction(params, typedChain);

        if (!simulation.allowed) {
          fail(`Refused by policy (${simulation.rule}): ${simulation.reason}`);
          return;
        }

        if (!isJsonMode()) {
          heading('Review transaction');
          label('From', from);
          label('To', options.to);
          label('Amount', `${simulation.amount} (${simulation.baseUnitAmount} base units)`);
          label('Chain', chain);
          if (options.token) label('Token', options.token);
          if (simulation.estimatedGas) {
            label('Estimated fee', simulation.estimatedGas.totalFeeInToken);
          }
        }

        if (!options.yes) {
          const proceed = await confirm('Send this transaction?');
          if (!proceed) {
            fail('Aborted. Nothing was signed or broadcast.');
            return;
          }
        }

        info('Signing and sending...');
        const tx = await locktek.buildTransaction(params, typedChain);
        const result = await locktek.signAndSend(tx, privateKey, typedChain, {
          idempotencyKey: options.idempotencyKey,
        });

        const receipt = options.wait
          ? await locktek.waitForConfirmation(result.hash, typedChain)
          : undefined;

        if (isJsonMode()) {
          json({
            ok: true,
            hash: result.hash,
            from,
            to: options.to,
            amount: simulation.amount,
            amountBaseUnits: simulation.baseUnitAmount,
            chain,
            status: receipt?.status,
          });
          return;
        }

        heading('Transaction sent');
        label('Hash', result.hash);
        label('Chain', chain);
        if (receipt) label('Status', receipt.status);
        else info('Broadcast accepted. Re-run with --wait to confirm it was mined.');
        success('Done.');
      } catch (err: unknown) {
        fail(
          err instanceof Error
            ? err.message
            : 'Transaction failed. Verify the recipient address, amount, chain, and private key.',
        );
      }
    });
}
