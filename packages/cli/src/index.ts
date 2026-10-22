import { createProgram } from './cli.js';
import { isJsonMode, json } from './utils/output.js';

const program = createProgram();

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);

  if (isJsonMode()) {
    // stdout still carries exactly one JSON document, even on failure.
    json({ ok: false, error: message });
  } else {
    process.stderr.write(`\x1b[31m✗\x1b[0m ${message}\n`);
  }

  process.exit(1);
});
