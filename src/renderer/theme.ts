/**
 * theme.ts — Semantic colour token layer (port of the TUI theme system).
 *
 * Two token layers, resolved per background mode:
 *
 *   - ThemeTokens (transcript): every colour decision in the markdown /
 *     conversation-rendering / tool-call / system-message pipeline. Agent-local
 *     (the SDK presentation contract hoisted only the CHROME tone table, not
 *     these transcript-semantic tokens). Read live per render via activeTheme()
 *     so a dark→light repaint re-resolves with no module reload.
 *
 *   - UiToneTokens (chrome): the panel/modal/overlay/header/footer/thinking tone
 *     table. This IS the SDK presentation contract — resolveUiTones() / and
 *     activeUiTones() compose the ThemeMode dimension over the SDK's
 *     resolveTones(), so the agent never mints its own light chrome variant.
 *
 * Dark mode values are the historically used colours. Light mode values exist
 * for correctness parity and are consumed once the terminal-bg-probe
 * (terminal-escapes / OSC 11) resolves the mode and setActiveThemeMode
 * is called. Callers that do not yet have mode detection get 'dark' — the safe
 * default (activeMode starts dark).
 *
 * IMPORTANT: inline code has NO background token. The bg:#1a1a1a hardcode that
 * previously existed caused a near-black box on light terminals. Differentiate
 * inline code via inlineCodeFg + bold only; bg inherits the terminal.
 */

import { UI_TONES } from './ui-primitives.ts';
import { resolveTones, type ThemeMode, type ToneTokens } from '@pellux/goodvibes-sdk/platform/presentation';

/** Background mode — dark is the safe default until the bg-probe resolves. */
export type { ThemeMode };

/** Resolved semantic colour tokens (concrete hex strings or ANSI-256 indices). */
export interface ThemeTokens {
  /** H1 heading foreground + table header accent */
  heading1: string;
  /** H2 heading foreground */
  heading2: string;
  /** H3 heading foreground (ANSI-256 — falls back to nearest on ansi256 terminals) */
  heading3: string;
  /** Inline code foreground (bold is applied separately by caller) */
  inlineCodeFg: string;
  /** Hyperlink and bare-URL foreground */
  link: string;
  /** Non-current search match background */
  searchMatchBg: string;
  /** Non-current search match foreground */
  searchMatchFg: string;
  /** Current (focused) search match background */
  searchCurrentBg: string;
  /** Current (focused) search match foreground */
  searchCurrentFg: string;
  /** Strikethrough / muted text foreground */
  strikethrough: string;
  /** Blockquote / dim text foreground */
  blockquote: string;
  /** Assistant event-line marker + label accent */
  assistantHeader: string;
  /** Reasoning / thinking block accent */
  reasoningAccent: string;
  /** Tool call / active status accent (also diff/tool result label) */
  toolAccent: string;
  /** Collapsed-fragment body background (tool result preview bg) */
  collapsedBodyBg: string;
  /** Checked task-list checkbox foreground (✓ in green) */
  checkboxChecked: string;
  /** Error / cancelled message bar background */
  errorBarBg: string;
  /** Model name / provider dim label foreground */
  modelNameDim: string;
  /** Tool name foreground in tool-result event line */
  toolNameFg: string;
  /** Diff block accent — marker, label, and collapsed-prefix foreground */
  diffAccent: string;
}

// ---------------------------------------------------------------------------
// Dark palette (byte-identical to the agent's prior static reads).
// ---------------------------------------------------------------------------
const DARK: ThemeTokens = {
  heading1:        '#00ffff',
  heading2:        '#00ffff',
  heading3:        '111',
  inlineCodeFg:    '#ffcc00',
  link:            '#00aaff',
  searchMatchBg:   '#806600',
  searchMatchFg:   '#ffffff',
  searchCurrentBg: '#ffff00',
  searchCurrentFg: '#000000',
  strikethrough:   '244',
  blockquote:      '244',
  assistantHeader: UI_TONES.accent.control,
  reasoningAccent: UI_TONES.state.reasoning,
  toolAccent:      UI_TONES.state.info,
  collapsedBodyBg: '#1a1a1a',
  checkboxChecked: '#22c55e',
  errorBarBg:      '#3a1a1a',
  modelNameDim:    '#94a3b8',
  toolNameFg:      '#e2e8f0',
  diffAccent:      '#f59e0b',
};

// ---------------------------------------------------------------------------
// Light palette — dark-on-light legibility (contrast ratios against #ffffff):
//   heading1/2:      Deep teal (#0077aa) — readable on white/cream terminals
//   heading3:        ANSI-256 24 (dark cyan) — the light equivalent of 111
//   inlineCodeFg:    Dark orange (#b45309) — distinguishable without a box bg
//   link:            Standard blue (#0055cc) — browser-link convention
//   searchMatchBg:   Muted yellow (#ffe066) on black fg — visible on light bg
//   searchCurrentBg: Strong amber (#f59e0b) — current match is more vivid
//   blockquote:      Dim blue-gray (ANSI-256 67)
//   assistantHeader: Dark cyan (#0e7490)
//   reasoningAccent: Dark purple (#7c3aed)
//   toolAccent:      Dark sky (#0369a1)
//   collapsedBodyBg: Very light gray (#f3f4f6)
//   checkboxChecked: Forest green (#15803d) — ~5.2:1 on #fff
//   errorBarBg:      Soft rose (#fee2e2) — legible text on top
//   modelNameDim:    Slate-500 (#64748b) — ~4.6:1 on #fff
//   toolNameFg:      Slate-800 (#334155) — strong enough for tool names
//   diffAccent:      Amber-700 (#b45309) — ~4.7:1 on #fff
// ---------------------------------------------------------------------------
const LIGHT: ThemeTokens = {
  heading1:        '#0077aa',
  heading2:        '#0077aa',
  heading3:        '24',
  inlineCodeFg:    '#b45309',
  link:            '#0055cc',
  searchMatchBg:   '#ffe066',
  searchMatchFg:   '#000000',
  searchCurrentBg: '#f59e0b',
  searchCurrentFg: '#000000',
  strikethrough:   '244',
  blockquote:      '67',
  assistantHeader: '#0e7490',
  reasoningAccent: '#7c3aed',
  toolAccent:      '#0369a1',
  collapsedBodyBg: '#f3f4f6',
  checkboxChecked: '#15803d',
  errorBarBg:      '#fee2e2',
  modelNameDim:    '#64748b',
  toolNameFg:      '#334155',
  diffAccent:      '#b45309',
};

Object.freeze(DARK);
Object.freeze(LIGHT);

/**
 * resolveTheme — Return the transcript token set for the given background mode.
 * The returned object is frozen; callers should not mutate it.
 */
export function resolveTheme(mode: ThemeMode): Readonly<ThemeTokens> {
  return mode === 'light' ? LIGHT : DARK;
}

/** Default dark-mode token set, exported for convenience. Frozen. */
export const DARK_THEME: Readonly<ThemeTokens> = DARK;

// ---------------------------------------------------------------------------
// Chrome tokens (UiToneTokens) — the SDK presentation contract, mode-resolved.
//
// The dark table is the SDK's TONE_TOKENS (re-exported here as UI_TONES); the
// light variant is the SDK's resolveTones('light'). The agent does NOT mint its
// own light chrome variant — that duplication is exactly what the SDK extraction ended.
// ---------------------------------------------------------------------------

/** The chrome tone-token shape (the SDK ToneTokens contract). */
export type UiToneTokens = ToneTokens;

/**
 * resolveUiTones — chrome token set for the given mode. Single read path;
 * 'dark' is byte-identical to the UI_TONES constant (same SDK object).
 * Prefer activeUiTones() at call sites.
 */
export function resolveUiTones(mode: ThemeMode): Readonly<UiToneTokens> {
  return resolveTones(mode);
}

// ===========================================================================
// Active-mode runtime.
//
// The mode is decided ONCE at startup — from appearance config
// (display.themeMode forced dark/light) or the terminal-background probe
// (auto) — and is then stable for the session. Transcript tokens (activeTheme)
// and chrome tokens (activeUiTones) are both read live per render, so a
// dark→light repaint (auto mode, light wins within the probe window)
// re-resolves without any module reload.
//
// registerThemeRefresh exists for owners that BAKE tone values into
// module-level constants (which cannot be re-resolved per call). Nothing
// registers currently — the agent's opaque panel palettes (polish.ts
// DEFAULT_PANEL_PALETTE and the modal/overlay/fullscreen surfaces built from
// it) paint OPAQUE dark boxes whose fg/state tokens stay dark in both modes, so
// they need no rebuild for dark parity (the opaque-surface trio deferral). The
// hook is kept at parity with the TUI so those surfaces can register when full
// light-chrome coherence lands.
// ===========================================================================

/** User-facing appearance preference: auto probes the terminal; dark/light force. */
export type ThemeModeSetting = 'auto' | ThemeMode;

/** The resolved mode in effect for the current session. Dark is the safe default. */
let activeMode: ThemeMode = 'dark';

/** In-place palette rebuilders, run (in registration order) on every mode flip. */
const themeRefreshers: Array<() => void> = [];

/** The active mode, for diagnostics / tests. */
export function getActiveThemeMode(): ThemeMode {
  return activeMode;
}

/**
 * Register an in-place palette rebuild to run whenever the active mode changes.
 * Base-palette owners register at their own module-eval time (before any
 * derived palette), so refreshers run base-first.
 */
export function registerThemeRefresh(rebuild: () => void): void {
  themeRefreshers.push(rebuild);
}

/**
 * Set the active background mode and rebuild every registered chrome palette in
 * place. Idempotent and reversible. Callers: startup (forced mode or probe
 * result, wired via installBackgroundThemeProbe's applyThemeMode injection).
 */
export function setActiveThemeMode(mode: ThemeMode): void {
  activeMode = mode;
  for (const rebuild of themeRefreshers) rebuild();
}

/** Transcript tokens for the active mode — read live, per render. */
export function activeTheme(): Readonly<ThemeTokens> {
  return resolveTheme(activeMode);
}

/** Chrome tokens for the active mode — read live, per render. */
export function activeUiTones(): Readonly<UiToneTokens> {
  return resolveUiTones(activeMode);
}
