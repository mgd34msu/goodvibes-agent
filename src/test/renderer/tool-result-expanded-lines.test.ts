// ---------------------------------------------------------------------------
// tool-result-expanded-lines.test.ts — the expanded-render line count that
// both the per-result "N lines" badge and the folded-group header total are
// derived from.
//
// Two properties matter:
//   1. HONESTY — the count equals the number of lines expanding really
//      produces, including JSON that pretty-prints from one raw line to many.
//   2. COST — the count is memoised. This renderer rebuilds the whole
//      transcript on every streaming delta, so recomputing a full markdown
//      render per collapsed tool result per delta is a real performance
//      regression (measured 63x slower over 40 results x 60 rebuilds). The
//      collapsed path must never materialise the expanded lines.
// ---------------------------------------------------------------------------

import { describe, expect, test } from 'bun:test';
import {
  countExpandedToolResultLines,
  isDiffContent,
  renderExpandedToolResultLines,
} from '../../renderer/tool-result-expanded-lines.ts';

const WIDTH = 100;

describe('countExpandedToolResultLines', () => {
  test('agrees exactly with the expanded render it stands in for', () => {
    const samples = [
      'a single line',
      'line one\nline two\nline three',
      JSON.stringify({ results: [{ title: 'x', snippet: 'y' }], ok: true }),
      '```\ncode\nblock\n```',
      '',
    ];
    for (const content of samples) {
      expect(countExpandedToolResultLines(content, WIDTH))
        .toBe(renderExpandedToolResultLines(content, WIDTH).length);
    }
  });

  test('a one-raw-line JSON blob counts its pretty-printed line count, not 1', () => {
    const json = JSON.stringify({ a: 1, b: { c: 2, d: 3 }, e: [4, 5, 6] });
    expect(json.split('\n')).toHaveLength(1);
    expect(countExpandedToolResultLines(json, WIDTH)).toBeGreaterThan(5);
  });

  test('counts are memoised per width — a repeat call is cheap and identical', () => {
    const json = JSON.stringify({ results: Array.from({ length: 40 }, (_, i) => ({ i, text: 'x'.repeat(60) })) });

    const first = countExpandedToolResultLines(json, WIDTH);
    const t0 = Bun.nanoseconds();
    for (let i = 0; i < 200; i++) expect(countExpandedToolResultLines(json, WIDTH)).toBe(first);
    const cachedNs = Bun.nanoseconds() - t0;

    const t1 = Bun.nanoseconds();
    renderExpandedToolResultLines(json, WIDTH);
    const oneRenderNs = Bun.nanoseconds() - t1;

    // 200 memoised counts must cost less than a single full render. This is
    // the property that keeps streaming rebuilds affordable; a plain
    // "is it faster" check would pass even if the memo were removed.
    expect(cachedNs).toBeLessThan(oneRenderNs);
  });

  test('different widths are counted independently', () => {
    const content = 'a long sentence that will wrap differently at different render widths, repeatedly. '.repeat(4);
    const narrow = countExpandedToolResultLines(content, 40);
    const wide = countExpandedToolResultLines(content, 120);
    expect(narrow).toBe(renderExpandedToolResultLines(content, 40).length);
    expect(wide).toBe(renderExpandedToolResultLines(content, 120).length);
    expect(narrow).toBeGreaterThan(wide);
  });
});

describe('isDiffContent', () => {
  test('recognises a unified diff', () => {
    expect(isDiffContent('--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b')).toBe(true);
  });

  test('does not treat ordinary output as a diff', () => {
    expect(isDiffContent('just some tool output\nwith two lines')).toBe(false);
    // Header lines without a hunk are not a diff.
    expect(isDiffContent('--- a/x.ts\n+++ b/x.ts')).toBe(false);
  });
});
