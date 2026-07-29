/**
 * Tests for the payments.*Cents major/minor unit conversion helpers.
 */
import { describe, test, expect } from 'bun:test';
import {
  formatMinorUnitsForEdit,
  formatMoneyForDisplay,
  isMoneyMinorUnitsConfigKey,
  parseMajorUnitsToMinorUnits,
} from '../../config/payments-money-format.ts';

describe('isMoneyMinorUnitsConfigKey', () => {
  test('matches every payments.*Cents key and nothing else', () => {
    expect(isMoneyMinorUnitsConfigKey('payments.budget.dailyItemCents')).toBe(true);
    expect(isMoneyMinorUnitsConfigKey('payments.budget.perPurchaseCeilingCents')).toBe(true);
    expect(isMoneyMinorUnitsConfigKey('payments.currency')).toBe(false);
    expect(isMoneyMinorUnitsConfigKey('payments.cvvHandling')).toBe(false);
    expect(isMoneyMinorUnitsConfigKey('payments.windows.vetoMinutes')).toBe(false);
  });
});

describe('parseMajorUnitsToMinorUnits (USD, exponent 2)', () => {
  // The exact values a naive `Number(x) * 100` gets wrong.
  test.each([
    ['0.1', 10],
    ['0.29', 29],
    ['19.99', 1999],
    ['1234.56', 123456],
  ])('%s -> %d cents exactly', (input, expected) => {
    expect(parseMajorUnitsToMinorUnits(input as string, 'USD')).toBe(expected as number);
  });

  test('whole dollars with no fraction', () => {
    expect(parseMajorUnitsToMinorUnits('5', 'USD')).toBe(500);
    expect(parseMajorUnitsToMinorUnits('0', 'USD')).toBe(0);
  });

  test('rounds half-up when more fractional digits are typed than the currency has', () => {
    expect(parseMajorUnitsToMinorUnits('19.995', 'USD')).toBe(2000);
    expect(parseMajorUnitsToMinorUnits('19.994', 'USD')).toBe(1999);
  });

  test('rejects anything that is not a non-negative decimal number', () => {
    expect(parseMajorUnitsToMinorUnits('', 'USD')).toBeNull();
    expect(parseMajorUnitsToMinorUnits('abc', 'USD')).toBeNull();
    expect(parseMajorUnitsToMinorUnits('-5', 'USD')).toBeNull();
    expect(parseMajorUnitsToMinorUnits('5.', 'USD')).toBeNull();
    expect(parseMajorUnitsToMinorUnits('5.5.5', 'USD')).toBeNull();
  });
});

describe('parseMajorUnitsToMinorUnits (zero-decimal currency)', () => {
  test('JPY has no minor unit: whole input maps 1:1', () => {
    expect(parseMajorUnitsToMinorUnits('500', 'JPY')).toBe(500);
  });

  test('a fractional JPY amount rounds half-up to the nearest whole unit', () => {
    expect(parseMajorUnitsToMinorUnits('5.7', 'JPY')).toBe(6);
    expect(parseMajorUnitsToMinorUnits('5.4', 'JPY')).toBe(5);
  });
});

describe('formatMinorUnitsForEdit', () => {
  test('renders a bare major-units string with no currency prefix', () => {
    expect(formatMinorUnitsForEdit(1999, 'USD')).toBe('19.99');
    expect(formatMinorUnitsForEdit(10, 'USD')).toBe('0.10');
    expect(formatMinorUnitsForEdit(0, 'USD')).toBe('0.00');
  });

  test('zero-decimal currency renders the integer with no decimal point', () => {
    expect(formatMinorUnitsForEdit(500, 'JPY')).toBe('500');
  });
});

describe('round trip through the edit buffer', () => {
  test.each(['0.1', '0.29', '19.99', '1234.56'])('%s survives parse -> format -> parse exactly', (input) => {
    const minorUnits = parseMajorUnitsToMinorUnits(input, 'USD');
    expect(minorUnits).not.toBeNull();
    const editBuffer = formatMinorUnitsForEdit(minorUnits!, 'USD');
    expect(parseMajorUnitsToMinorUnits(editBuffer, 'USD')).toBe(minorUnits);
  });
});

describe('formatMoneyForDisplay', () => {
  test('renders the SDK currency-prefixed form', () => {
    expect(formatMoneyForDisplay(1999, 'USD')).toBe('USD 19.99');
  });

  test('falls back to the raw number rather than throwing on a bad value', () => {
    expect(formatMoneyForDisplay(-5, 'USD')).toBe('-5');
    expect(formatMoneyForDisplay(1.5, 'USD')).toBe('1.5');
  });

  test('an invalid currency code falls back to USD instead of crashing', () => {
    expect(formatMoneyForDisplay(1999, 'not-a-code')).toBe('USD 19.99');
  });
});
