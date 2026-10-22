import { describe, it, expect } from 'vitest';
import { formatNativeAmount, parseNativeAmount } from '../utils/format.js';
import { formatTokenAmount, parseTokenAmount } from '../config/tokens.js';

describe('format utilities', () => {
  describe('formatNativeAmount', () => {
    it('formats wei to ETH', () => {
      expect(formatNativeAmount('1000000000000000000', 18)).toBe('1.000000000000000000');
    });

    it('formats small amounts', () => {
      expect(formatNativeAmount('1', 18)).toBe('0.000000000000000001');
    });

    it('formats TRX (6 decimals)', () => {
      expect(formatNativeAmount('1000000', 6)).toBe('1.000000');
    });

    it('formats zero balance (most common case for new wallets)', () => {
      expect(formatNativeAmount('0', 18)).toBe('0.000000000000000000');
    });

    it('formats very large amounts without precision loss', () => {
      const result = formatNativeAmount('999999999999999999999999999', 18);
      expect(result).toBe('999999999.999999999999999999');
    });
  });

  describe('parseNativeAmount', () => {
    it('parses ETH to wei', () => {
      expect(parseNativeAmount('1.0', 18)).toBe(1000000000000000000n);
    });

    it('parses fractional amounts', () => {
      expect(parseNativeAmount('0.5', 18)).toBe(500000000000000000n);
    });

    it('rejects invalid formats', () => {
      expect(() => parseNativeAmount('abc', 18)).toThrow();
    });

    it('rejects too many decimals', () => {
      expect(() => parseNativeAmount('1.' + '0'.repeat(19), 18)).toThrow();
    });

    it('parses zero amount', () => {
      expect(parseNativeAmount('0', 18)).toBe(0n);
    });

    it('parses zero with decimal', () => {
      expect(parseNativeAmount('0.0', 18)).toBe(0n);
    });

    it('handles leading zeros in whole part', () => {
      // '01.5' matches the regex /^\d+(\.\d+)?$/ so it should parse
      expect(parseNativeAmount('01.5', 18)).toBe(1500000000000000000n);
    });

    it('rejects negative numbers', () => {
      expect(() => parseNativeAmount('-1.5', 18)).toThrow('Invalid amount');
    });
  });

  describe('formatTokenAmount', () => {
    it('formats USDC amounts (6 decimals)', () => {
      expect(formatTokenAmount('1000000', 'USDC')).toBe('1.000000');
      expect(formatTokenAmount('1500000', 'USDT')).toBe('1.500000');
    });

    it('handles bigint input', () => {
      expect(formatTokenAmount(1234567n, 'USDC')).toBe('1.234567');
    });
  });

  describe('parseTokenAmount', () => {
    it('parses USDC amounts', () => {
      expect(parseTokenAmount('1.0', 'USDC')).toBe(1000000n);
      expect(parseTokenAmount('10.25', 'USDC')).toBe(10250000n);
    });

    it('rejects too many decimals', () => {
      expect(() => parseTokenAmount('1.1234567', 'USDC')).toThrow();
    });

    it('rejects invalid format', () => {
      expect(() => parseTokenAmount('abc', 'USDC')).toThrow();
    });
  });
});

describe('base-unit suggestion is copy-pasteable', () => {
  it('suggests "1", not "1.000000000000000000"', () => {
    expect(() => parseNativeAmount('1000000000000000000', 18)).toThrow(/pass "1" instead/);
  });

  it('keeps significant decimals in the suggestion', () => {
    expect(() => parseNativeAmount('1500000000000000000', 18)).toThrow(/pass "1.5" instead/);
  });

  // The trim relies on formatNativeAmount always emitting a decimal point. If that
  // ever changes, "100" would be mangled into "1" and the error would hand the caller
  // a suggestion 100x too small — so pin it here rather than trust the invariant.
  it('does not eat trailing zeros of the integer part', () => {
    expect(() => parseNativeAmount('100000000000000000000', 18)).toThrow(/pass "100" instead/);
    expect(() => parseNativeAmount('1000000000000000000000', 18)).toThrow(/pass "1000" instead/);
  });

  it('formatNativeAmount always emits a decimal point', () => {
    expect(formatNativeAmount(100n * 10n ** 18n, 18)).toContain('.');
  });
});
