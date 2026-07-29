/**
 * payments-money-format.ts — major/minor unit conversion for `payments.*Cents`
 * settings keys, so the settings UI can accept "19.99" and store 1999 exactly.
 *
 * Reuses the SDK's own `formatMinorUnits` to derive each currency's decimal
 * exponent (0 for JPY-shaped currencies, 3 for BHD-shaped ones, 2 otherwise)
 * rather than keeping a second copy of that table: `formatMinorUnits(1, code)`
 * renders "JPY 1" (no dot) or "BHD 0.001" (three digits), and the digit count
 * after the dot IS the exponent. If the SDK's table ever changes, this follows
 * it automatically instead of drifting.
 *
 * All conversion is integer/BigInt arithmetic so 0.1 + float rounding never
 * turns into 9 or 11 cents.
 */
import { formatMinorUnits, parseCurrencyCode } from '@pellux/goodvibes-sdk/platform/payments';
import type { CurrencyCode } from '@pellux/goodvibes-sdk/platform/payments';

/** Every `payments.*Cents` key stores minor units; nothing else does. */
export function isMoneyMinorUnitsConfigKey(key: string): boolean {
  return key.endsWith('Cents');
}

// CurrencyCode is a branded string the SDK only hands out through
// parseCurrencyCode; payments.currency is stored as a plain string, so every
// call site here re-validates it rather than casting. A value that somehow
// fails the three-letter ISO-4217 shape falls back to USD instead of crashing
// a render or refusing an edit over a config-store data problem.
const FALLBACK_CURRENCY = parseCurrencyCode('USD')!;

function resolveCurrencyCode(currency: string): CurrencyCode {
  return parseCurrencyCode(currency) ?? FALLBACK_CURRENCY;
}

const exponentCache = new Map<string, number>();

function minorUnitsExponentForCurrency(currency: string): number {
  const cached = exponentCache.get(currency);
  if (cached !== undefined) return cached;
  const sample = formatMinorUnits(1, resolveCurrencyCode(currency));
  const dotIndex = sample.indexOf('.');
  const exponent = dotIndex === -1 ? 0 : sample.length - dotIndex - 1;
  exponentCache.set(currency, exponent);
  return exponent;
}

/** formatMinorUnits throws on a non-integer/negative amount; render/edit call sites never crash on a mid-edit or corrupted value. */
export function formatMoneyForDisplay(minorUnits: number, currency: string): string {
  try {
    return formatMinorUnits(minorUnits, resolveCurrencyCode(currency));
  } catch {
    return String(minorUnits);
  }
}

/**
 * Minor units rendered as a plain editable major-units string, e.g.
 * 1999 -> "19.99". No currency prefix: the edit buffer must stay a bare
 * number a person can type back over.
 */
export function formatMinorUnitsForEdit(minorUnits: number, currency: string): string {
  const exponent = minorUnitsExponentForCurrency(currency);
  if (exponent === 0) return String(minorUnits);
  const divisor = 10 ** exponent;
  const whole = Math.floor(minorUnits / divisor);
  const frac = String(minorUnits % divisor).padStart(exponent, '0');
  return `${whole}.${frac}`;
}

/**
 * Parse a user-typed major-units string ("19.99") into integer minor units
 * (1999). Extra fractional digits beyond the currency's exponent round
 * half-up rather than truncating silently. Returns null for anything that is
 * not a non-negative decimal number — a purchase budget is never negative.
 */
export function parseMajorUnitsToMinorUnits(input: string, currency: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const exponent = minorUnitsExponentForCurrency(currency);
  const [wholeRaw, fracRaw = ''] = trimmed.split('.');
  const whole = BigInt(wholeRaw || '0');
  const scale = 10n ** BigInt(exponent);

  if (fracRaw.length <= exponent) {
    const fracPadded = fracRaw.padEnd(exponent, '0');
    const minor = whole * scale + (fracPadded.length > 0 ? BigInt(fracPadded) : 0n);
    return Number(minor);
  }

  const keep = fracRaw.slice(0, exponent);
  const roundDigit = fracRaw.charAt(exponent);
  let minor = whole * scale + (keep.length > 0 ? BigInt(keep) : 0n);
  if (roundDigit !== '' && Number(roundDigit) >= 5) minor += 1n;
  return Number(minor);
}
