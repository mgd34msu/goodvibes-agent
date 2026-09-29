import { describe, test, expect } from 'bun:test';
import { activeDiffTones, activeTokens } from '../../renderer/theme.ts';
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
    // Actual added code lines have gutter '+' AND the diffAddedBg fill
    // (file headers with +++ have the context fill and muted fg)
    const addedLines = result.filter((line) =>
      line[0]?.char === '+' && line[0]?.bg === activeTokens().diffAddedBg
    );
    expect(addedLines.map(lineText)).toEqual([
      expect.stringContaining('const b = 42;'),
    ]);
    expect(addedLines[0]?.[0].fg).toContain(activeDiffTones().add.slice(1));
  });

  test('removed lines have red foreground color', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH);
    // Actual removed code lines have gutter '-' AND the diffRemovedBg fill
    // (file headers with --- have the context fill and muted fg)
    const removedLines = result.filter((line) =>
      line[0]?.char === '-' && line[0]?.bg === activeTokens().diffRemovedBg
    );
    expect(removedLines.map(lineText)).toEqual([
      expect.stringContaining('const b = 2;'),
    ]);
    expect(removedLines[0]?.[0].fg).toContain(activeDiffTones().del.slice(1));
  });

  test('handles empty diff string', () => {
    const result = renderDiffView('', WIDTH);
    expect(result).toEqual(expect.any(Array));
    expect(result.map(lineText)).toEqual(['']);
  });

  test('renders content from added lines', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH);
    // Actual added code lines have the diffAddedBg fill (not the +++ header with the context fill)
    const addedLines = result.filter((line) =>
      line[0]?.char === '+' && line[0]?.bg === activeTokens().diffAddedBg
    );
    expect(addedLines.map(lineText)).toEqual([
      expect.stringContaining('const b = 42;'),
    ]);
  });

  test('renders content from removed lines', () => {
    const result = renderDiffView(SAMPLE_DIFF, WIDTH);
    // Actual removed code lines have the diffRemovedBg fill (not the --- header with the context fill)
    const removedLines = result.filter((line) =>
      line[0]?.char === '-' && line[0]?.bg === activeTokens().diffRemovedBg
    );
    // The removed line contains 'const b = 2;'
    expect(removedLines.map(lineText)).toEqual([
      expect.stringContaining('const b = 2;'),
    ]);
  });
});
