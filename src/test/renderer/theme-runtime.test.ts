/**
 * theme-runtime.test.ts, the active-mode runtime.
 *
 * Covers the active-mode accessors, the flip + reversibility of the live token
 * layers, and the display.themeMode config coercion.
 *
 * The opaque-surface chrome palettes (modal DEFAULT_STYLE, overlay
 * DEFAULT_OVERLAY_PALETTE, FULLSCREEN_PALETTE) register an in-place rebuild via
 * registerThemeRefresh, so setActiveThemeMode rebuilds them without replacing
 * the object reference (read by reference across many call sites). These paint
 * OPAQUE dark surfaces, so in the SDK light tones only state.* roles flip
 * (fg/bg stay dark), dark is byte-identical and reversible.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  activeTheme,
  activeUiTones,
  getActiveThemeMode,
  resolveTheme,
  resolveUiTones,
  setActiveThemeMode,
} from '../../renderer/theme.ts';
import {
  coerceThemeModeSetting,
  resolveConfiguredThemeMode,
} from '../../renderer/theme-mode-config.ts';
import { installBackgroundThemeProbe } from '../../renderer/terminal-bg-probe.ts';
import { DEFAULT_OVERLAY_PALETTE } from '../../renderer/overlay-box.ts';
import { FULLSCREEN_PALETTE } from '../../renderer/fullscreen-primitives.ts';
import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';

/** Minimal ConfigManager-shaped stub whose get() returns a fixed value. */
function fakeConfig(value: unknown): Pick<ConfigManager, 'get'> {
  return { get: (() => value) } as unknown as Pick<ConfigManager, 'get'>;
}
function throwingConfig(): Pick<ConfigManager, 'get'> {
  return { get: (() => { throw new Error('no section'); }) } as unknown as Pick<ConfigManager, 'get'>;
}

// Always restore the shared default so sibling golden suites see dark.
afterEach(() => setActiveThemeMode('dark'));

describe('active mode accessors', () => {
  test('default is dark', () => {
    expect(getActiveThemeMode()).toBe('dark');
    expect(activeTheme()).toBe(resolveTheme('dark'));
    expect(activeUiTones()).toBe(resolveUiTones('dark'));
  });

  test('setActiveThemeMode(light) flips both live token layers', () => {
    setActiveThemeMode('light');
    expect(getActiveThemeMode()).toBe('light');
    expect(activeTheme()).toBe(resolveTheme('light'));
    expect(activeUiTones()).toBe(resolveUiTones('light'));
  });

  test('setActiveThemeMode(dark) flips back byte-identically', () => {
    setActiveThemeMode('light');
    setActiveThemeMode('dark');
    expect(activeTheme()).toBe(resolveTheme('dark'));
    expect(activeUiTones()).toBe(resolveUiTones('dark'));
  });
});

describe('opaque-surface chrome palettes rebuild in place (the trio port)', () => {
  test('overlay palette identity is stable across flips and restores byte-identically', () => {
    const ref = DEFAULT_OVERLAY_PALETTE;
    const darkSnapshot = { ...DEFAULT_OVERLAY_PALETTE };
    setActiveThemeMode('light');
    setActiveThemeMode('dark');
    expect(DEFAULT_OVERLAY_PALETTE).toBe(ref);              // never replaced, only rebuilt
    expect({ ...DEFAULT_OVERLAY_PALETTE }).toEqual(darkSnapshot);
  });

  test('fullscreen palette flips its info role in light and restores in dark', () => {
    const darkInfo = FULLSCREEN_PALETTE.info;
    expect(darkInfo).toBe(resolveUiTones('dark').state.info);
    setActiveThemeMode('light');
    expect(FULLSCREEN_PALETTE.info).toBe(resolveUiTones('light').state.info);
    expect(FULLSCREEN_PALETTE.info).not.toBe(darkInfo);
    setActiveThemeMode('dark');
    expect(FULLSCREEN_PALETTE.info).toBe(darkInfo);
  });

  test('fullscreen agent-local opaque bg forks stay dark in both modes', () => {
    const darkCategoryBg = FULLSCREEN_PALETTE.categoryBg;
    setActiveThemeMode('light');
    expect(FULLSCREEN_PALETTE.categoryBg).toBe(darkCategoryBg); // opaque panel bg never flips
    expect(FULLSCREEN_PALETTE.title).toBe('#67e8f9');
  });
});

describe('theme-mode config', () => {
  test('coerceThemeModeSetting narrows valid values, else default', () => {
    expect(coerceThemeModeSetting('auto')).toBe('auto');
    expect(coerceThemeModeSetting('dark')).toBe('dark');
    expect(coerceThemeModeSetting('light')).toBe('light');
    expect(coerceThemeModeSetting(undefined)).toBe('auto');
    expect(coerceThemeModeSetting('nonsense')).toBe('auto');
    expect(coerceThemeModeSetting(42)).toBe('auto');
  });

  test('resolveConfiguredThemeMode reads the key and defaults to auto', () => {
    expect(resolveConfiguredThemeMode(fakeConfig('light'))).toBe('light');
    expect(resolveConfiguredThemeMode(fakeConfig(undefined))).toBe('auto');
    expect(resolveConfiguredThemeMode(throwingConfig())).toBe('auto');
  });
});

describe('installBackgroundThemeProbe wired to setActiveThemeMode (R4 startup path)', () => {
  const noop = () => {};

  test('forced light applies the mode before first paint (no probe)', () => {
    installBackgroundThemeProbe({
      configManager: fakeConfig('light'),
      applyThemeMode: setActiveThemeMode,
      isTTY: false,
      env: {},
      writeQuery: noop,
      requestRepaint: noop,
    });
    expect(getActiveThemeMode()).toBe('light');
  });

  test('auto + non-TTY stays dark (headless/piped — probe cannot run)', () => {
    setActiveThemeMode('light'); // prove it actively resolves to dark, not just leftover
    installBackgroundThemeProbe({
      configManager: fakeConfig('auto'),
      applyThemeMode: setActiveThemeMode,
      isTTY: false,
      env: {},
      writeQuery: noop,
      requestRepaint: noop,
    });
    expect(getActiveThemeMode()).toBe('dark');
  });
});
