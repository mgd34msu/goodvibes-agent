import { describe, expect, test } from 'bun:test';
import { fitDisplay, getDisplayWidth, padDisplayEnd, truncateDisplay, wrapText } from '../../utils/terminal-width.ts';

describe('terminal width helpers', () => {
  test('truncateDisplay respects wide characters', () => {
    const text = 'abc界🙂xyz';
    const truncated = truncateDisplay(text, 6);
    expect(getDisplayWidth(truncated)).toBeLessThanOrEqual(6);
  });

  test('padDisplayEnd pads to display width, not string length', () => {
    const text = '界🙂';
    const padded = padDisplayEnd(text, 6);
    expect(getDisplayWidth(padded)).toBe(6);
  });

  test('fitDisplay truncates and pads to exact display width', () => {
    const text = 'very-wide🙂value';
    const fitted = fitDisplay(text, 8);
    expect(getDisplayWidth(fitted)).toBe(8);
  });
});

describe('wrapText', () => {
  test('CJK character at width 1 terminates without hanging', () => {
    // Pre-fix this would infinite-loop; verify it returns in finite time.
    const result = wrapText('漢', 1);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  test('emoji at width 1 terminates without hanging', () => {
    const result = wrapText('\u{1F600}', 1);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  test('CJK word wider than width is split across lines', () => {
    const result = wrapText('漢字', 2);
    // Each CJK char is display-width 2; at width 2 each gets its own line.
    expect(result.length).toBeGreaterThan(0);
    for (const line of result) {
      expect(getDisplayWidth(line)).toBeLessThanOrEqual(2);
    }
  });

  test('normal ASCII wrapping still works', () => {
    const result = wrapText('hello world', 5);
    expect(result).toEqual(['hello', 'world']);
  });
});
