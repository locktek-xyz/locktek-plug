/** Structured fields attached to a log event. Never contains key material. */
export type LogFields = Record<string, unknown>;

/**
 * Minimal logging seam. Every method is optional so a plain `console`-shaped object,
 * a pino instance, or a partial stub all satisfy it.
 *
 * The SDK emits nothing unless a logger is supplied — silence stays the default.
 */
export interface Logger {
  debug?(message: string, fields?: LogFields): void;
  info?(message: string, fields?: LogFields): void;
  warn?(message: string, fields?: LogFields): void;
  error?(message: string, fields?: LogFields): void;
}

/**
 * Wrap a logger so a throwing or misbehaving implementation can never break a
 * transaction, and so no field can leak key material.
 */
export function safeLogger(logger: Logger | undefined): Logger | undefined {
  if (!logger) return undefined;

  const guard =
    (level: keyof Logger) =>
    (message: string, fields?: LogFields): void => {
      try {
        logger[level]?.(message, fields ? redactFields(fields) : undefined);
      } catch {
        // A broken logger must never break the operation it is observing.
      }
    };

  return {
    debug: guard('debug'),
    info: guard('info'),
    warn: guard('warn'),
    error: guard('error'),
  };
}

const KEY_LIKE_FIELD = /private|secret|mnemonic|seed|passphrase|encryptionkey/i;
const HEX_64_OR_128 = /\b(0x)?[0-9a-fA-F]{64}(?:[0-9a-fA-F]{64})?\b/g;

/** Strip anything that looks like key material from a log payload. */
export function redactFields(fields: LogFields): LogFields {
  const output: LogFields = {};

  for (const [key, value] of Object.entries(fields)) {
    if (KEY_LIKE_FIELD.test(key)) {
      output[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      output[key] = value.replace(HEX_64_OR_128, '[REDACTED_KEY]');
    } else {
      output[key] = value;
    }
  }

  return output;
}
