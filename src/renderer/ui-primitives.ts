// ---------------------------------------------------------------------------
// ui-primitives.ts, glyph registry + tone-token table.
//
// These four tables (GLYPHS, UI_TONES, DIFF_TONES, SPINNER_FRAMES) are
// no longer minted locally. They are the SDK presentation contract
// (@pellux/goodvibes-sdk/platform/presentation), consumed here
// so the agent and the TUI share ONE source (Mike's move-to-SDK ruling,
// machinery needed by 2+ surfaces => SDK). See
// docs/decisions/2026-07-05-presentation-contract-sdk-extraction.md in the SDK.
//
// Re-exported under the historical names (GLYPHS, UI_TONES) so every existing
// importer keeps working with no call-site churn. UI_TONES is the dark-mode
// tone table (== resolveTones('dark')); light is resolved via theme.ts's
// activeUiTones() / resolveUiTones(), which composes the mode dimension over
// the SDK's resolveTones().
//
// Visible glyph convergence (deliberate, per S1's divergence ruling): the
// agent's status glyphs adopt the TUI reference, idle ○ (U+25CB) -> ◌ (U+25CC),
// info • (U+2022) -> ○ (U+25CB), and a new warn ⚠ key. Called out here so the
// render-time change is not mistaken for a regression.
// ---------------------------------------------------------------------------

import {
  GLYPHS,
  TONE_TOKENS,
  DIFF_TONES,
  SPINNER_FRAMES,
} from '@pellux/goodvibes-sdk/platform/presentation';

export { GLYPHS, DIFF_TONES, SPINNER_FRAMES };

/** The dark-mode tone-token table (== resolveTones('dark')). */
export const UI_TONES = TONE_TOKENS;

/** The glyph registry shape, preserved for existing type references. */
export type UiGlyphRegistry = typeof GLYPHS;
