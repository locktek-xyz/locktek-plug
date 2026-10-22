import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { warn } from './output.js';

/**
 * Resolve a private key without putting it in the shell history.
 *
 * Order of preference: an explicit `--key` flag (warned about), the
 * `LOCKTEK_PRIVATE_KEY` environment variable, then an interactive prompt with echo
 * disabled. A key passed on the command line is readable in `ps` output and is
 * written verbatim into the user's shell history file, which is why it is last resort
 * rather than the only option.
 */
export async function resolvePrivateKey(flagValue?: string): Promise<string> {
  if (flagValue) {
    warn(
      'Passing --key puts your private key in shell history and `ps` output. ' +
        'Prefer the LOCKTEK_PRIVATE_KEY environment variable or the interactive prompt.',
    );
    return flagValue;
  }

  const fromEnv = process.env['LOCKTEK_PRIVATE_KEY'];
  if (fromEnv) return fromEnv;

  if (!process.stdin.isTTY) {
    throw new Error(
      'No private key available. Set LOCKTEK_PRIVATE_KEY, or pass --key, ' +
        'or run this command in an interactive terminal to be prompted.',
    );
  }

  return promptHidden('Private key: ');
}

/**
 * Read a line from a TTY without echoing it.
 *
 * readline echoes through its output stream, so the output is muted once the prompt
 * has been written. Redrawing the line after each keystroke is not enough: a pasted
 * key arrives as one chunk and stays on screen.
 */
export function promptHidden(
  prompt: string,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stderr,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let muted = false;
    const mutable = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        if (!muted) output.write(chunk);
        callback();
      },
    });

    const rl = createInterface({ input, output: mutable, terminal: true });

    rl.question(prompt, (answer) => {
      rl.close();
      output.write('\n');
      resolve(answer.trim());
    });
    // question() writes the prompt synchronously; everything after it is the secret.
    muted = true;

    rl.on('error', (err) => {
      rl.close();
      reject(err);
    });
  });
}

/** Ask for an explicit yes before an irreversible action. */
export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;

  const rl = createInterface({ input: process.stdin, output: process.stderr });

  return new Promise((resolve) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}
