import { describe, it, expect } from 'vitest';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

describe('sanitizeErrorMessage', () => {
  const fakePrivateKey = 'a'.repeat(64);
  const fakePrivateKeyWithPrefix = '0x' + 'b'.repeat(64);

  it('redacts a 64-char hex string (private key)', () => {
    const msg = `invalid private key: ${fakePrivateKey}`;
    expect(sanitizeErrorMessage(msg)).toBe('invalid private key: [REDACTED_KEY]');
  });

  it('redacts a 64-char hex string with 0x prefix', () => {
    const msg = `invalid private key: ${fakePrivateKeyWithPrefix}`;
    expect(sanitizeErrorMessage(msg)).toBe('invalid private key: [REDACTED_KEY]');
  });

  it('leaves normal error messages unchanged', () => {
    const msg = 'insufficient funds for gas';
    expect(sanitizeErrorMessage(msg)).toBe(msg);
  });

  it('does NOT redact Ethereum addresses (40 hex chars)', () => {
    const addr = '0x' + 'a'.repeat(40);
    const msg = `balance check failed for ${addr}`;
    expect(sanitizeErrorMessage(msg)).toBe(msg);
  });

  it('preserves surrounding text when redacting a key', () => {
    const msg = `wallet construction failed with key ${fakePrivateKey} on chain ethereum`;
    expect(sanitizeErrorMessage(msg)).toBe(
      'wallet construction failed with key [REDACTED_KEY] on chain ethereum',
    );
  });

  it('redacts multiple keys in one message', () => {
    const key1 = 'c'.repeat(64);
    const key2 = '0x' + 'd'.repeat(64);
    const msg = `keys: ${key1} and ${key2}`;
    expect(sanitizeErrorMessage(msg)).toBe('keys: [REDACTED_KEY] and [REDACTED_KEY]');
  });

  it('redacts 128-char hex strings (uncompressed public keys)', () => {
    const uncompressedPubKey = 'e'.repeat(128);
    const msg = `unexpected key data: ${uncompressedPubKey}`;
    expect(sanitizeErrorMessage(msg)).toBe('unexpected key data: [REDACTED_KEY]');
  });

  it('redacts 128-char hex string with 0x prefix', () => {
    const uncompressedPubKey = '0x' + 'f'.repeat(128);
    const msg = `key: ${uncompressedPubKey}`;
    expect(sanitizeErrorMessage(msg)).toBe('key: [REDACTED_KEY]');
  });

  it('handles empty string', () => {
    expect(sanitizeErrorMessage('')).toBe('');
  });

  it('handles message with mixed hex lengths', () => {
    const addr = '0x' + 'a'.repeat(40);
    const pk = '0x' + 'b'.repeat(64);
    const msg = `addr ${addr} pk ${pk}`;
    // Address (40 hex) is preserved, private key (64 hex) is redacted
    expect(sanitizeErrorMessage(msg)).toBe(`addr ${addr} pk [REDACTED_KEY]`);
  });
});
