import { LocktekError, ErrorCode } from '../types/common.js';

/**
 * Amounts above 10^decimals whole units are almost certainly base units passed by
 * mistake (e.g. "1000000000000000000" meaning 1 ETH). Only applied to high-decimal
 * assets, where such a value exceeds any real supply — a 1,000,000 USDC transfer
 * (6 decimals) must never trip this.
 */
const BASE_UNIT_SUSPICION_MIN_DECIMALS = 18;

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Convert a base-unit amount (wei, sun, token base units) to a human-readable
 * decimal string, preserving full precision.
 */
export function formatNativeAmount(weiAmount: string | bigint, decimals: number): string {
  const value = typeof weiAmount === 'bigint' ? weiAmount : BigInt(weiAmount);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fractional = (value < 0n ? -value : value) % divisor;
  const fractionalStr = fractional.toString().padStart(decimals, '0');
  return `${whole}.${fractionalStr}`;
}

/**
 * Convert a human-readable decimal amount ("0.1", "25") into base units.
 *
 * This is the single conversion point for every public Locktek surface — the MCP
 * tools, the CLI, and {@link TransactionParams.amount} all express amounts in
 * human-readable units, and adapters call this before touching a chain.
 *
 * @throws {LocktekError} with {@link ErrorCode.INVALID_AMOUNT} for anything that is
 * not a positive decimal, has more precision than the asset supports, or looks like
 * base units passed by mistake.
 */
export function parseNativeAmount(amount: string, decimals: number): bigint {
  const clean = amount.trim();

  if (!DECIMAL_PATTERN.test(clean)) {
    throw new LocktekError(
      `Invalid amount: "${amount}". Expected a positive decimal number in whole units (e.g. "1.5" or "100").`,
      ErrorCode.INVALID_AMOUNT,
    );
  }

  const [whole, fractional = ''] = clean.split('.');

  if (fractional.length > decimals) {
    throw new LocktekError(
      `Too many decimal places in "${amount}". Maximum allowed for this asset: ${decimals}.`,
      ErrorCode.INVALID_AMOUNT,
    );
  }

  assertNotBaseUnits(clean, whole, fractional, decimals);

  return BigInt(whole + fractional.padEnd(decimals, '0'));
}

function assertNotBaseUnits(
  clean: string,
  whole: string,
  fractional: string,
  decimals: number,
): void {
  if (decimals < BASE_UNIT_SUSPICION_MIN_DECIMALS) return;
  if (fractional.length > 0) return;

  const digits = whole.replace(/^0+(?=\d)/, '').length;
  if (digits <= decimals) return;

  // Trailing zeros make the suggestion unusable as a copy-paste fix: the point of
  // this error is to hand the caller the exact string they should have passed.
  const asWholeUnits = formatNativeAmount(BigInt(clean), decimals).replace(/\.?0+$/, '');
  throw new LocktekError(
    `Ambiguous amount "${clean}": amounts are expressed in whole units, not base units. ` +
      `As whole units this is ${clean} — larger than any real supply. ` +
      `If you meant ${asWholeUnits}, pass "${asWholeUnits}" instead.`,
    ErrorCode.INVALID_AMOUNT,
  );
}
