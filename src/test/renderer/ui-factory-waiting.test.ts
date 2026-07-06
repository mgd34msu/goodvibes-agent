/**
 * ui-factory-waiting.test.ts (W4-R4) — the honest waiting-state wording.
 *
 * createThinkingFragment now derives WHICH waiting state applies (renderer-local)
 * and defers the exact wording to the SDK presentation contract's
 * waitingPhrase(). This proves the state derivation + contract consumption:
 * approval / pre-first-token / stalled / thinking, plus the tool-active stall
 * suppression, plus that THINKING_PHRASES is the SDK's (no local re-mint).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { UIFactory } from '../../renderer/ui-factory.ts';
import { setActiveThemeMode } from '../../renderer/theme.ts';
import { THINKING_PHRASES } from '@pellux/goodvibes-sdk/platform/presentation';

afterEach(() => setActiveThemeMode('dark'));

/** Flatten a rendered fragment to its visible text. */
function text(lines: ReturnType<typeof UIFactory.createThinkingFragment>): string {
  return lines.map((l) => l.map((c) => c.char).join('')).join(' ');
}

const STALL = 3_000; // > THINKING_STALL_FREEZE_MS (2500)

describe('computeStallInfo', () => {
  test('undefined until a delta clock exists', () => {
    expect(UIFactory.computeStallInfo(undefined, undefined, undefined, 1000)).toBeUndefined();
  });
  test('reports elapsed silence from the last delta', () => {
    const info = UIFactory.computeStallInfo(1000, undefined, undefined, 4000);
    expect(info?.msSinceLastDelta).toBe(3000);
    expect(info?.reconnect).toBeUndefined();
  });
});

describe('computeRenderStallInfo suppresses stall while a tool is active', () => {
  test('tool active → no stall info (no false Stalled during tool exec)', () => {
    expect(UIFactory.computeRenderStallInfo({ toolActive: true, lastDeltaAtMs: 0, nowMs: STALL })).toBeUndefined();
  });
  test('no tool → stall info flows through', () => {
    const info = UIFactory.computeRenderStallInfo({ toolActive: false, lastDeltaAtMs: 0, nowMs: STALL });
    expect(info?.msSinceLastDelta).toBe(STALL);
  });
});

describe('createThinkingFragment honest waiting states', () => {
  const W = 60;

  test('approval pending → "Waiting for your approval" and suppresses tok/s', () => {
    const out = text(UIFactory.createThinkingFragment(W, '-', 0, 42 /* tokenSpeed */, undefined, undefined, undefined, undefined, true));
    expect(out).toContain('Waiting for your approval');
    expect(out).not.toContain('tok/s');
  });

  test('pre-first-token silence → "Waiting for model Ns..." not "Stalled"', () => {
    const stall = { msSinceLastDelta: STALL };
    // outputTokens = 0 → pre-first-token branch
    const out = text(UIFactory.createThinkingFragment(W, '-', 0, undefined, undefined, undefined, 0, stall));
    expect(out).toContain('Waiting for model 3s...');
    expect(out).not.toContain('Stalled');
  });

  test('post-stream silence (tokens already flowed) → "Stalled Ns..."', () => {
    const stall = { msSinceLastDelta: STALL };
    // outputTokens > 0 → stalled branch
    const out = text(UIFactory.createThinkingFragment(W, '-', 0, undefined, undefined, undefined, 5, stall));
    expect(out).toContain('Stalled 3s...');
  });

  test('reconnecting → "Reconnecting (attempt n/m)..."', () => {
    const stall = { msSinceLastDelta: STALL, reconnect: { attempt: 2, maxAttempts: 5 } };
    const out = text(UIFactory.createThinkingFragment(W, '-', 0, undefined, undefined, undefined, 5, stall));
    expect(out).toContain('Reconnecting (attempt 2/5)...');
  });

  test('no stall → a rotated THINKING_PHRASE from the SDK contract', () => {
    const out = text(UIFactory.createThinkingFragment(W, '-', 0));
    expect(out).toContain(THINKING_PHRASES[0]); // frame 0 → 'Thinking...'
  });
});
