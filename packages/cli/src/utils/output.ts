const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
} as const;

/**
 * When JSON mode is on, stdout carries exactly one JSON document and nothing else.
 * Human-readable progress is suppressed or diverted to stderr so the output stays
 * pipeable into `jq`.
 */
let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

/** Emit the single JSON document for this command. */
export function json(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function success(message: string): void {
  if (jsonMode) return;
  process.stdout.write(`${COLORS.green}✓${COLORS.reset} ${message}\n`);
}

export function error(message: string): void {
  process.stderr.write(`${COLORS.red}✗${COLORS.reset} ${message}\n`);
}

export function info(message: string): void {
  // Progress messages go to stderr in JSON mode so stdout stays parseable.
  if (jsonMode) return;
  process.stdout.write(`${COLORS.blue}ℹ${COLORS.reset} ${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${COLORS.yellow}⚠${COLORS.reset} ${message}\n`);
}

export function label(key: string, value: string): void {
  if (jsonMode) return;
  process.stdout.write(`  ${COLORS.dim}${key}:${COLORS.reset} ${value}\n`);
}

export function heading(text: string): void {
  if (jsonMode) return;
  process.stdout.write(`\n${COLORS.bold}${text}${COLORS.reset}\n`);
}

interface TableColumn {
  readonly header: string;
  readonly key: string;
  readonly align?: 'left' | 'right';
}

export function table(
  columns: readonly TableColumn[],
  rows: readonly Record<string, string>[],
): void {
  if (jsonMode) return;

  const widths = columns.map((col) => {
    const maxDataWidth = rows.reduce((max, row) => Math.max(max, (row[col.key] ?? '').length), 0);
    return Math.max(col.header.length, maxDataWidth);
  });

  const headerLine = columns.map((col, i) => col.header.padEnd(widths[i])).join('  ');
  process.stdout.write(`\n  ${COLORS.bold}${headerLine}${COLORS.reset}\n`);

  const separator = widths.map((w) => '─'.repeat(w)).join('──');
  process.stdout.write(`  ${COLORS.dim}${separator}${COLORS.reset}\n`);

  for (const row of rows) {
    const line = columns
      .map((col, i) => {
        const value = row[col.key] ?? '';
        return col.align === 'right' ? value.padStart(widths[i]) : value.padEnd(widths[i]);
      })
      .join('  ');
    process.stdout.write(`  ${line}\n`);
  }

  process.stdout.write('\n');
}

/** Report a failure in whichever format the caller asked for, and set the exit code. */
export function fail(message: string, details?: Record<string, unknown>): void {
  if (jsonMode) {
    json({ ok: false, error: message, ...details });
  } else {
    error(message);
  }
  process.exitCode = 1;
}
