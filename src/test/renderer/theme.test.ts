/**
 * theme.test.ts — the ported theme system.
 *
 * Covers:
 *   - resolveTheme() returns the correct transcript token set per mode
 *   - Dark values are byte-identical to the agent's prior static reads
 *   - Light values differ from dark (actually light-friendly)
 *   - resolveUiTones() is the SDK presentation contract: dark is byte-identical
 *     (same reference) to UI_TONES / resolveTones('dark'); light is type-complete
 *
 * The call-site hex-literal guards (markdown/tool-call/system-message/
 * process-indicator/conversation-rendering/compositor no longer carry the moved
 * hexes) live in theme-call-sites.test.ts, alongside those conversions.
 */

import { describe, test, expect } from 'bun:test';
import { resolveTheme, resolveUiTones, DARK_THEME, type ThemeTokens } from '../../renderer/theme.ts';
import { UI_TONES } from '../../renderer/ui-primitives.ts';
import { resolveTones } from '@pellux/goodvibes-sdk/platform/presentation';

// ---------------------------------------------------------------------------
// resolveTheme() — transcript tokens
// ---------------------------------------------------------------------------

describe('resolveTheme', () => {
  test('dark mode returns the DARK_THEME reference', () => {
    expect(resolveTheme('dark')).toBe(DARK_THEME);
  });

  test('light mode is a distinct object; heading1 differs', () => {
    const dark = resolveTheme('dark');
    const light = resolveTheme('light');
    expect(light).not.toBe(dark);
    expect(light.heading1).not.toBe(dark.heading1);
  });
});

describe('ThemeTokens completeness', () => {
  const TOKEN_KEYS: (keyof ThemeTokens)[] = [
    'heading1', 'heading2', 'heading3', 'inlineCodeFg', 'link',
    'searchMatchBg', 'searchMatchFg', 'searchCurrentBg', 'searchCurrentFg',
    'strikethrough', 'blockquote', 'assistantHeader', 'reasoningAccent',
    'toolAccent', 'collapsedBodyBg', 'checkboxChecked', 'errorBarBg',
    'modelNameDim', 'toolNameFg', 'diffAccent',
  ];
  for (const mode of ['dark', 'light'] as const) {
    for (const key of TOKEN_KEYS) {
      test(`mode=${mode} ${key} is a non-empty string`, () => {
        expect(typeof resolveTheme(mode)[key]).toBe('string');
        expect((resolveTheme(mode)[key] as string).length).toBeGreaterThan(0);
      });
    }
  }
});

describe('dark transcript token values (byte-identical to the prior static reads)', () => {
  const d = resolveTheme('dark');
  test('heading1 #00ffff', () => expect(d.heading1).toBe('#00ffff'));
  test('inlineCodeFg #ffcc00', () => expect(d.inlineCodeFg).toBe('#ffcc00'));
  test('link #00aaff', () => expect(d.link).toBe('#00aaff'));
  test('searchCurrentBg #ffff00', () => expect(d.searchCurrentBg).toBe('#ffff00'));
  test('searchMatchBg #806600', () => expect(d.searchMatchBg).toBe('#806600'));
  test('assistantHeader #22d3ee', () => expect(d.assistantHeader).toBe('#22d3ee'));
  test('reasoningAccent #a855f7', () => expect(d.reasoningAccent).toBe('#a855f7'));
  test('toolAccent #38bdf8', () => expect(d.toolAccent).toBe('#38bdf8'));
  test('checkboxChecked #22c55e', () => expect(d.checkboxChecked).toBe('#22c55e'));
  test('diffAccent #f59e0b', () => expect(d.diffAccent).toBe('#f59e0b'));
});

describe('light transcript token values differ from dark', () => {
  const dark = resolveTheme('dark');
  const light = resolveTheme('light');
  const lighterKeys: (keyof ThemeTokens)[] = [
    'heading1', 'heading2', 'inlineCodeFg', 'link', 'searchMatchBg',
    'searchCurrentBg', 'assistantHeader', 'reasoningAccent', 'toolAccent',
    'collapsedBodyBg', 'checkboxChecked', 'errorBarBg', 'modelNameDim',
    'toolNameFg', 'diffAccent',
  ];
  for (const key of lighterKeys) {
    test(`${key} differs between dark and light`, () => {
      expect(light[key]).not.toBe(dark[key]);
    });
  }
});

// ---------------------------------------------------------------------------
// resolveUiTones() — the SDK presentation contract (chrome tones)
// ---------------------------------------------------------------------------

function collectStringLeaves(value: unknown, p: string, out: Array<[string, unknown]>): void {
  if (typeof value === 'string') { out.push([p, value]); return; }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      collectStringLeaves(nested, p ? `${p}.${key}` : key, out);
    }
  }
}

describe('resolveUiTones (SDK presentation contract)', () => {
  test('dark is byte-identical to UI_TONES and to the SDK resolveTones(dark)', () => {
    expect(resolveUiTones('dark')).toBe(UI_TONES);
    expect(resolveUiTones('dark')).toBe(resolveTones('dark'));
  });

  test('dark roles carry the hoisted chrome/brand values', () => {
    const dark = resolveUiTones('dark');
    expect(dark.accent.brand).toBe('#00ffff');
    expect(dark.accent.gradientEnd).toBe('#d000ff');
    expect(dark.state.reasoning).toBe('#a855f7');
    expect(dark.border).toBe('#64748b');
    expect(dark.chrome.label).toBe('#94a3b8');
  });

  test('light is a distinct object and matches the SDK resolveTones(light)', () => {
    expect(resolveUiTones('light')).not.toBe(resolveUiTones('dark'));
    expect(resolveUiTones('light')).toBe(resolveTones('light'));
  });

  test('light chrome inverts toward dark-on-light legibility', () => {
    const light = resolveUiTones('light');
    expect(light.chrome.label).toBe('#64748b');
    expect(light.state.reasoning).not.toBe(resolveUiTones('dark').state.reasoning);
  });

  test('light is type-complete and shape-identical to dark', () => {
    const darkLeaves: Array<[string, unknown]> = [];
    const lightLeaves: Array<[string, unknown]> = [];
    collectStringLeaves(resolveUiTones('dark'), '', darkLeaves);
    collectStringLeaves(resolveUiTones('light'), '', lightLeaves);
    expect(lightLeaves.map(([p]) => p).sort()).toEqual(darkLeaves.map(([p]) => p).sort());
    for (const [, value] of lightLeaves) {
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });
});
