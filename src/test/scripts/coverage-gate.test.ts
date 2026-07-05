// ---------------------------------------------------------------------------
// coverage-gate.test.ts
//
// Unit-tests the pure parsing/evaluation logic of scripts/coverage-gate.ts (the
// aggregate coverage ratchet). The slow whole-suite coverage spawn is not
// exercised here; this covers table parsing (including color-blind parsing),
// fail-count extraction, and the floor decision.
// ---------------------------------------------------------------------------

import { describe, expect, test } from 'bun:test';
import { FUNCS_FLOOR, LINES_FLOOR, evaluateGate, parseCoverageSummary, parseFailCount } from '../../../scripts/coverage-gate.ts';

const TABLE = [
  '-------------------|---------|---------|',
  'File               | % Funcs | % Lines |',
  '-------------------|---------|---------|',
  'All files          |   85.86 |   83.83 |',
  '-------------------|---------|---------|',
  '',
  ' 8054 pass',
  ' 0 fail',
].join('\n');

describe('coverage-gate parsing', () => {
  test('parses the All files summary row', () => {
    const s = parseCoverageSummary(TABLE);
    expect(s).not.toBeNull();
    expect(s?.funcsPct).toBeCloseTo(85.86, 2);
    expect(s?.linesPct).toBeCloseTo(83.83, 2);
  });

  test('parses color-blind (strips ANSI escapes)', () => {
    const colored = '\x1b[1m\x1b[31mAll files          \x1b[0m | \x1b[31m  85.86\x1b[0m | \x1b[31m  83.83\x1b[0m |';
    const s = parseCoverageSummary(colored);
    expect(s?.funcsPct).toBeCloseTo(85.86, 2);
  });

  test('returns null when there is no coverage table', () => {
    expect(parseCoverageSummary('no table here\n 8054 pass\n')).toBeNull();
  });

  test('extracts the fail count', () => {
    expect(parseFailCount(' 0 fail')).toBe(0);
    expect(parseFailCount(' 3 fail')).toBe(3);
    expect(parseFailCount('no summary')).toBeNull();
  });
});

describe('coverage-gate floors', () => {
  test('floors sit just below the measured baseline (85.86 funcs / 83.83 lines)', () => {
    expect(FUNCS_FLOOR).toBeLessThan(85.86);
    expect(LINES_FLOOR).toBeLessThan(83.83);
    // Ratchet, not a token floor.
    expect(FUNCS_FLOOR).toBeGreaterThanOrEqual(80);
    expect(LINES_FLOOR).toBeGreaterThanOrEqual(80);
  });

  test('passes at the baseline', () => {
    expect(evaluateGate(TABLE).pass).toBe(true);
  });

  test('fails when coverage drops below the floor', () => {
    const low = TABLE.replace('85.86 |   83.83', '50.00 |   50.00');
    const result = evaluateGate(low);
    expect(result.pass).toBe(false);
    expect(result.lines.some((l) => l.includes('BELOW FLOOR'))).toBe(true);
  });

  test('fails loudly when the coverage table is missing', () => {
    const result = evaluateGate('the run crashed before reporting');
    expect(result.pass).toBe(false);
    expect(result.lines[0]).toContain('no coverage table');
  });
});
