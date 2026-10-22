import { describe, it, expect, vi } from 'vitest';
import { safeLogger, redactFields } from '../observability/logger.js';

const PRIVATE_KEY = `0x${'a'.repeat(64)}`;

describe('redactFields', () => {
  it('redacts fields whose name suggests key material', () => {
    const output = redactFields({ privateKey: 'x', mnemonic: 'y', encryptionKey: 'z' });
    expect(Object.values(output)).toEqual(['[REDACTED]', '[REDACTED]', '[REDACTED]']);
  });

  it('redacts key-shaped hex anywhere in a string value', () => {
    const output = redactFields({ message: `failed with ${PRIVATE_KEY} attached` });
    expect(output.message).not.toContain('a'.repeat(64));
    expect(output.message).toContain('[REDACTED_KEY]');
  });

  it('leaves ordinary values and public addresses alone', () => {
    const output = redactFields({
      chain: 'ethereum',
      attempt: 3,
      address: '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C',
    });

    expect(output).toEqual({
      chain: 'ethereum',
      attempt: 3,
      address: '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C',
    });
  });
});

describe('safeLogger', () => {
  it('returns undefined when no logger is supplied, so the SDK stays silent', () => {
    expect(safeLogger(undefined)).toBeUndefined();
  });

  it('redacts fields before they reach the sink', () => {
    const info = vi.fn();
    safeLogger({ info })?.info?.('tx', { privateKey: 'secret' });

    expect(info).toHaveBeenCalledWith('tx', { privateKey: '[REDACTED]' });
  });

  it('swallows a throwing logger — a broken sink must not break a transaction', () => {
    const logger = safeLogger({
      info() {
        throw new Error('sink exploded');
      },
    });

    expect(() => logger?.info?.('tx')).not.toThrow();
  });

  it('tolerates a logger that implements only some levels', () => {
    const warn = vi.fn();
    const logger = safeLogger({ warn });

    expect(() => logger?.debug?.('nothing listens to this')).not.toThrow();
    logger?.warn?.('heard');
    expect(warn).toHaveBeenCalled();
  });
});
