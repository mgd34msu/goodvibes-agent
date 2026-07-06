/**
 * theme-mode-config — the appearance/theme-mode preference surface (W4-R4).
 *
 * The preference lives at the config key `display.themeMode` (auto | dark |
 * light, default auto). It is stored under the existing SDK `display` section
 * (which exists in DEFAULT_CONFIG) as a TUI-local synthetic setting — no SDK
 * schema change — the same pattern the config already uses for other
 * display.* toggles.
 *
 * DIVERGENCE FROM THE W4 BRIEF (recorded): the brief listed theme-mode-config.ts
 * as the NEW home for the config-read helpers, but W4-R2 landed FIRST and
 * inlined resolveConfiguredThemeMode / coerceThemeModeSetting /
 * THEME_MODE_CONFIG_KEY / ThemeModeSetting into terminal-bg-probe.ts (so R2
 * could ship the probe before this file existed). Rather than duplicate those
 * (which would let the two copies drift — the exact failure S1 exists to
 * prevent), this module RE-EXPORTS them from terminal-bg-probe as the single
 * source, and adds only the settings-modal-facing metadata (the value list,
 * default, and human description) that R2 did not need.
 *
 * Deliberately free of terminal/probe state so the settings-modal data layer
 * can import it without pulling in the stateful probe class.
 */

import type { ThemeModeSetting } from './theme.ts';

export {
  THEME_MODE_CONFIG_KEY,
  THEME_MODE_DEFAULT,
  coerceThemeModeSetting,
  resolveConfiguredThemeMode,
} from './terminal-bg-probe.ts';

/** The three valid preference values, in settings-cycle order. */
export const THEME_MODE_VALUES: readonly ThemeModeSetting[] = ['auto', 'dark', 'light'];

/**
 * Human-facing description for the settings-modal entry. States the honest
 * timing contract: forced modes apply on the next full paint immediately;
 * `auto` only re-probes at startup, so switching TO auto takes effect next
 * launch.
 */
export const THEME_MODE_DESCRIPTION =
  'Terminal background theme. auto probes the terminal background colour once at '
  + 'startup (OSC 11) and picks light or dark; dark/light force a fixed theme. '
  + 'Forced modes take effect immediately; auto is only evaluated at startup, so '
  + 'selecting auto takes effect on the next launch. Unreadable/unsupported '
  + 'terminals fall back to dark. Scope (honest): transcript markdown, tool-call '
  + 'and system-message accents, and the header/footer/thinking chrome all flip '
  + 'with this setting; only the background colour itself follows your terminal.';
