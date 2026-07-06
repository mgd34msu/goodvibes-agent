/**
 * theme-runtime.test.ts (W4-R4) — the active-mode runtime.
 *
 * Covers the active-mode accessors, the flip + reversibility of the live token
 * layers, and the display.themeMode config coercion.
 *
 * NOTE: the agent DEFERS the opaque-surface chrome-palette rebuild (polish
 * DEFAULT_PANEL_PALETTE / modal / overlay / fullscreen paint OPAQUE dark boxes
 * whose fg/state tokens stay dark in both modes — see the trio deferral). So
 * registerThemeRefresh has no registrations this wave; the flip is proven
 * through the LIVE read accessors (activeTheme/activeUiTones), which is what the
 * agent's transcript + chrome call sites actually use.
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
  THEME_MODE_DEFAULT,
  THEME_MODE_VALUES,
} from '../../renderer/theme-mode-config.ts';
import { installBackgroundThemeProbe } from '../../renderer/terminal-bg-probe.ts';
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

describe('theme-mode config', () => {
  test('THEME_MODE_VALUES is the auto/dark/light cycle', () => {
    expect(THEME_MODE_VALUES).toEqual(['auto', 'dark', 'light']);
  });

  test('coerceThemeModeSetting narrows valid values, else default', () => {
    expect(coerceThemeModeSetting('auto')).toBe('auto');
    expect(coerceThemeModeSetting('dark')).toBe('dark');
    expect(coerceThemeModeSetting('light')).toBe('light');
    expect(coerceThemeModeSetting(undefined)).toBe(THEME_MODE_DEFAULT);
    expect(coerceThemeModeSetting('nonsense')).toBe(THEME_MODE_DEFAULT);
    expect(coerceThemeModeSetting(42)).toBe(THEME_MODE_DEFAULT);
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
