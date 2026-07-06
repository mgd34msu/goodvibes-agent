// ---------------------------------------------------------------------------
// panel-paste-flood-guard.ts — ported from goodvibes-tui (commit 90eb3a26,
// DEBT-5 item 5).
//
// A terminal WITHOUT bracketed paste delivers a pasted block as a burst of
// discrete 1-char 'text' tokens (isPasteToken stays false for every one of
// them, since that flag only fires for a single token whose value.length > 1).
//
// AGENT ADAPTATION (this repo has no `src/panels/` — see the parity
// matrix's corresponding row): the TUI wires this guard inside handlePanelFocusToken,
// where it protects a focused PANEL from having each replayed character
// dispatched as a real hotkey (K arms kill, etc). This agent has no panel
// focus concept at all — every token that isn't consumed by a modal route or
// a global shortcut lands directly in the composer/command dispatch chain
// (handleIndicatorFocusToken -> handlePromptTextToken -> handleCommandModeToken
// -> handlePromptKeyToken, see handler-feed.ts). The matrix's own adaptation
// note ("the burst instead becomes command/keybinding dispatch — the guard
// wires above the composer/command dispatch") is implemented by gating that
// same chain in feedInputTokens: see handler-feed.ts's per-token loop, which
// calls trackPanelPasteFloodGuard for every non-paste 'text' token BEFORE
// those routes run, using a persistent PanelBurstGuardState carried on
// InputFeedContext (context.burstGuard — mirrors how pasteRegistry is
// threaded as a stable, never-reallocated field; see feed-context-factory.ts).
//
// This module's own logic is UI-framework-agnostic and is kept byte-identical
// to the TUI's (same constants, same sliding-window algorithm) — only its
// CALLERS differ between the two products.
//
// This is a RATE guard: more than PANEL_PASTE_FLOOD_THRESHOLD qualifying
// tokens within the trailing PANEL_PASTE_FLOOD_WINDOW_MS, evaluated with a
// real sliding window (old timestamps age out of `timestamps` every call). It
// is deliberately NOT a per-feed char-SUM burst heuristic: that shape summed
// one feed()'s character count with no timing signal at all, so two ordinary
// keystrokes landing in a single feed() (a real, common case) could be
// misread as a burst. This guard:
//   - is keyed on WALL-CLOCK TIMING, not a per-feed token count, so it
//     doesn't care how many tokens land in one feed() call, only how fast
//     they arrive relative to each other;
//   - is sticky once tripped (only a quiet gap — no qualifying token for a
//     full window — clears it) so it doesn't flap dispatch on/off as the
//     count oscillates near the threshold mid-flood.
//
// ~8 keys/120ms is far beyond sustained human typing (a fast typist peaks
// well under that inter-key rate over any real span) but is exactly the
// shape an unbracketed paste replay takes.
// ---------------------------------------------------------------------------

export const PANEL_PASTE_FLOOD_WINDOW_MS = 120;
export const PANEL_PASTE_FLOOD_THRESHOLD = 8;

/**
 * Guard state — a single persistent instance lives on the caller's
 * long-lived context (this agent's handler-feed.ts InputFeedContext, mirroring
 * how that object already owns `nextPasteId`/`mouseDownRow`/etc.) and is
 * MUTATED IN PLACE by trackPanelPasteFloodGuard below, never replaced — so
 * callers never need to thread a return value back into their own state.
 */
export interface PanelBurstGuardState {
  timestamps: readonly number[];
  suspended: boolean;
  hintShown: boolean;
}

export interface PanelBurstGuardResult {
  /** False while suspended — the caller must drop this token, not dispatch it. */
  readonly dispatch: boolean;
  /** True exactly once per burst: the call that just tripped suspension. */
  readonly showHintNow: boolean;
}

/** Advance `guard` (mutated in place) by one qualifying token at time `now` (ms). */
export function trackPanelPasteFloodGuard(guard: PanelBurstGuardState, now: number): PanelBurstGuardResult {
  const lastAt = guard.timestamps.length > 0 ? guard.timestamps[guard.timestamps.length - 1]! : -Infinity;
  const isQuietGap = now - lastAt > PANEL_PASTE_FLOOD_WINDOW_MS;
  if (isQuietGap && guard.suspended) {
    // A silence at least as long as the window means whatever burst was
    // happening has ended — un-suspend so a LATER burst gets its own fresh
    // count and its own one-shot hint.
    guard.suspended = false;
    guard.hintShown = false;
  }
  guard.timestamps = isQuietGap
    ? [now]
    : [...guard.timestamps.filter((t) => t > now - PANEL_PASTE_FLOOD_WINDOW_MS), now];
  if (guard.timestamps.length > PANEL_PASTE_FLOOD_THRESHOLD) {
    guard.suspended = true;
  }
  let showHintNow = false;
  if (guard.suspended && !guard.hintShown) {
    guard.hintShown = true;
    showHintNow = true;
  }
  return { dispatch: !guard.suspended, showHintNow };
}
