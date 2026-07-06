/**
 * theme-call-sites.test.ts — the transcript/chrome call sites read the
 * theme instead of hardcoded hex.
 *
 *  (1) A lint-style guard: the moved hex literals no longer appear in the
 *      converted files (they'd re-introduce a frozen-dark colour). This is the
 *      grep-gate the R4 brief calls for.
 *  (2) An end-to-end flip proof: renderMarkdown swaps its heading/inline-code/
 *      link colours from dark to the reviewed light tokens when the active mode
 *      flips — dark stays byte-identical to today.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderMarkdown } from '../../renderer/markdown.ts';
import { resolveTheme, setActiveThemeMode } from '../../renderer/theme.ts';
import type { Line } from '../../types/grid.ts';

afterEach(() => setActiveThemeMode('dark'));

// ---------------------------------------------------------------------------
// (1) Hex-literal guards — moved colours must be gone from the call sites.
// ---------------------------------------------------------------------------

const root = path.resolve(import.meta.dir, '../..');

const GUARDS: Array<{ file: string; blockedHex: string[] }> = [
  {
    // markdown headings/inline-code/link/checkbox → transcript tokens; the
    // inline-code dark background box is dropped entirely.
    file: path.join(root, 'renderer/markdown.ts'),
    blockedHex: ['#00ffff', '#ffcc00', '#1a1a1a', '#00aaff', '#22c55e', "'111'"],
  },
  {
    // compositor search-highlight → activeTheme() search tokens.
    file: path.join(root, 'renderer/compositor.ts'),
    blockedHex: ['#ffff00', '#806600', '#ffffff', '#000000'],
  },
  {
    // conversation-rendering assistant/tool/error accents → transcript tokens.
    // NOTE: '#00ffff' is intentionally NOT blocked — the splash gradient keeps it.
    file: path.join(root, 'core/conversation-rendering.ts'),
    blockedHex: ['#22d3ee', '#a855f7', '#38bdf8', '#3a1a1a', '#94a3b8', '#e2e8f0', '#f59e0b'],
  },
  {
    // process-indicator active-status label → live brand accent.
    file: path.join(root, 'renderer/process-indicator.ts'),
    blockedHex: ['#00ffff', '#7dd3fc'],
  },
];

describe('no hardcoded hex literals at converted call sites', () => {
  for (const { file, blockedHex } of GUARDS) {
    const shortName = path.relative(root, file);
    const content = readFileSync(file, 'utf-8');
    for (const hex of blockedHex) {
      test(`${shortName} does not contain ${hex}`, () => {
        expect(content).not.toContain(hex);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// (2) End-to-end transcript flip.
// ---------------------------------------------------------------------------

function fgSet(lines: Line[]): Set<string> {
  const out = new Set<string>();
  for (const line of lines) for (const cell of line) if (cell.fg) out.add(cell.fg);
  return out;
}

describe('markdown transcript renders in the active mode', () => {
  const MD = '# Heading One\n\nA `code` span and a [link](https://example.com).';

  test('dark uses the historical heading cyan (#00ffff) — byte-identical', () => {
    const fgs = fgSet(renderMarkdown(MD, 80));
    expect(fgs.has('#00ffff')).toBe(true);   // DARK.heading1
    expect(fgs.has('#0077aa')).toBe(false);  // no light heading leaks
  });

  test('light swaps heading/inline-code/link to the reviewed light tokens', () => {
    setActiveThemeMode('light');
    const light = resolveTheme('light');
    const fgs = fgSet(renderMarkdown(MD, 80));
    expect(fgs.has(light.heading1)).toBe(true);      // #0077aa
    expect(fgs.has('#00ffff')).toBe(false);          // dark heading gone
    expect(fgs.has(light.inlineCodeFg)).toBe(true);  // #b45309
    expect(fgs.has(light.link)).toBe(true);          // #0055cc
  });
});
