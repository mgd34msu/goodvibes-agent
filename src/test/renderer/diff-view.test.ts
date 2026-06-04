import { describe, test, expect } from 'bun:test';
import { renderDiffView } from '../../renderer/diff-view.ts';
import { lineToString } from '../setup.ts';

const WIDTH = 80;

const lineText = lineToString;

const SAMPLE_DIFF = [
  '--- old.ts (original)',
  '+++ old.ts (updated)',
  '@@ -1,4 +1,4 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 42;',
  ' const c = 3;',
].join('\n');

describe('renderDiffView', () => {
  test('returns Line array', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH);
    expect(result).toEqual(expect.any(Array));
    expect(result.length).toBeGreaterThan(0);
  });

  test('each line has correct width', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH);
    for (const line of result) {
      expect(line.length).toBe(WIDTH);
    }
  });

  test('shows filename header when provided', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH, 'old.ts');
    const firstLine = lineText(result[0]);
    expect(firstLine).toContain('old.ts');
  });

  test('does not show header when filename omitted', () => {
    const withHeader = renderDiffView(SAMPLE_DIFF, WIDTH, 'file.ts');
    const withoutHeader = renderDiffView(SAMPLE_DIFF, WIDTH);
    expect(withoutHeader.length).toBeLessThan(withHeader.length);
  });

  test('added lines contain + gutter character', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH);
    const addedLines = result.filter((line) => line[0]?.char === '+');
    expect(addedLines.length).toBeGreaterThan(0);
  });

  test('removed lines contain - gutter character', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH);
    const removedLines = result.filter((line) => line[0]?.char === '-');
    expect(removedLines.length).toBeGreaterThan(0);
  });

  test('context lines contain space gutter character', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH);
    // Context lines have space in gutter (first cell)
    const contextLines = result.filter((line) => {
      const firstChar = line[0]?.char;
      return firstChar === ' ' && lineText(line).trim().length > 0;
    });
    expect(contextLines.length).toBeGreaterThan(0);
  });

  test('hunk header line contains @@ marker text', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH);
    expect(result.map(lineText).filter((text) => text.startsWith('@@'))).toEqual([
      expect.stringContaining('@@ -1,4 +1,4 @@'),
    ]);
  });

  test('added lines have green foreground color', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH);
    // Actual added code lines have gutter '+' AND green background '#0a1a0a'
    // (file headers with +++ have bg '#0a0a0a' and fg '244')
    const addedLines = result.filter((line) =>
      line[0]?.char === '+' && line[0]?.bg === '#0a1a0a'
    );
    expect(addedLines.map(lineText)).toEqual([
      expect.stringContaining('const b = 42;'),
    ]);
    // Green: #22c55e
    expect(addedLines[0]?.[0].fg).toContain('22c55e');
  });

  test('removed lines have red foreground color', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH);
    // Actual removed code lines have gutter '-' AND red background '#1a0a0a'
    // (file headers with --- have bg '#0a0a0a' and fg '244')
    const removedLines = result.filter((line) =>
      line[0]?.char === '-' && line[0]?.bg === '#1a0a0a'
    );
    expect(removedLines.map(lineText)).toEqual([
      expect.stringContaining('const b = 2;'),
    ]);
    // Red: #ef4444
    expect(removedLines[0]?.[0].fg).toContain('ef4444');
  });

  test('handles empty diff string', () => {
    const result = renderDiffView('', WIDTH);
    expect(result).toEqual(expect.any(Array));
    expect(result.map(lineText)).toEqual(['']);
  });

  test('renders content from added lines', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH);
    // Actual added code lines have green bg '#0a1a0a' (not the +++ header with bg '#0a0a0a')
    const addedLines = result.filter((line) =>
      line[0]?.char === '+' && line[0]?.bg === '#0a1a0a'
    );
    expect(addedLines.map(lineText)).toEqual([
      expect.stringContaining('const b = 42;'),
    ]);
  });

  test('renders content from removed lines', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH);
    // Actual removed code lines have red bg '#1a0a0a' (not the --- header with bg '#0a0a0a')
    const removedLines = result.filter((line) =>
      line[0]?.char === '-' && line[0]?.bg === '#1a0a0a'
    );
    // The removed line contains 'const b = 2;'
    expect(removedLines.map(lineText)).toEqual([
      expect.stringContaining('const b = 2;'),
    ]);
  });
});
