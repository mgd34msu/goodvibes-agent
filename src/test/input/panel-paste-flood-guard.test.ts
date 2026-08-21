/**
 * panel-paste-flood-guard.ts unit tests, ported from goodvibes-tui (commit
 * 90eb3a26). The module itself is UI-framework-agnostic (a pure
 * sliding-window rate guard); these tests exercise trackPanelPasteFloodGuard
 * directly, independent of either product's dispatch wiring (the TUI wires it
 * through handlePanelFocusToken; this agent wires it through feedInputTokens
 *, see handler-feed-paste-flood.test.ts for that integration-level coverage).
 */
import { describe, expect, test } from 'bun:test';
import {
  PANEL_PASTE_FLOOD_THRESHOLD,
  PANEL_PASTE_FLOOD_WINDOW_MS,
  trackPanelPasteFloodGuard,
  type PanelBurstGuardState,
} from '../../input/panel-paste-flood-guard.ts';

function freshGuard(): PanelBurstGuardState {
  return { timestamps: [], suspended: false, hintShown: false };
}

describe('trackPanelPasteFloodGuard', () => {
  test('constants match the TUI reference (product parity)', () => {
    expect(PANEL_PASTE_FLOOD_THRESHOLD).toBe(8);
    expect(PANEL_PASTE_FLOOD_WINDOW_MS).toBe(120);
  });

  test('a burst of more than 8 qualifying tokens inside the window trips suspension exactly once', () => {
    const guard = freshGuard();
    const t0 = 1_000_000;
    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push(trackPanelPasteFloodGuard(guard, t0 + i));
    }
    const dispatchedCount = results.filter((r) => r.dispatch).length;
    const hintCount = results.filter((r) => r.showHintNow).length;
    expect(dispatchedCount).toBe(PANEL_PASTE_FLOOD_THRESHOLD);
    expect(hintCount).toBe(1); // one-shot hint, not re-shown for the remaining suppressed tokens
    expect(guard.suspended).toBe(true);
  });

  test('6 rapid tokens under the threshold all dispatch — human typing is unaffected', () => {
    const guard = freshGuard();
    const t0 = 2_000_000;
    for (let i = 0; i < 6; i++) {
      const result = trackPanelPasteFloodGuard(guard, t0 + i);
      expect(result.dispatch).toBe(true);
      expect(result.showHintNow).toBe(false);
    }
    expect(guard.suspended).toBe(false);
  });

  test('suspension is sticky (does not flap) but lifts after a genuine quiet gap, re-arming the one-shot hint for a later burst', () => {
    const guard = freshGuard();
    const t0 = 3_000_000;
    // Trip the guard: 12 calls 1ms apart (trips at the 9th). Last timestamp lands at t0+11.
    for (let i = 0; i < 12; i++) trackPanelPasteFloodGuard(guard, t0 + i);
    expect(guard.suspended).toBe(true);

    // Still within the window (5ms after the last token), stays suspended, no new hint.
    const lastBurstAt = t0 + 11;
    const stillFlooding = trackPanelPasteFloodGuard(guard, lastBurstAt + 5);
    expect(stillFlooding.dispatch).toBe(false);
    expect(stillFlooding.showHintNow).toBe(false);

    // A silence strictly greater than PANEL_PASTE_FLOOD_WINDOW_MS since THIS call
    // (lastBurstAt + 5) clears suspension.
    const quietGapStart = lastBurstAt + 5;
    const afterQuietGap = trackPanelPasteFloodGuard(guard, quietGapStart + PANEL_PASTE_FLOOD_WINDOW_MS + 1);
    expect(afterQuietGap.dispatch).toBe(true);
    expect(guard.suspended).toBe(false);

    // A later burst re-trips and shows its own one-shot hint again.
    const laterBurstStart = quietGapStart + PANEL_PASTE_FLOOD_WINDOW_MS + 1;
    let laterHintCount = 0;
    for (let i = 1; i <= 12; i++) {
      const r = trackPanelPasteFloodGuard(guard, laterBurstStart + i);
      if (r.showHintNow) laterHintCount++;
    }
    expect(laterHintCount).toBe(1);
  });
});
