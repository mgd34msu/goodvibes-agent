/**
 * thinking-overlay.test.ts, the extracted stall clock + overlay builder.
 */

import { describe, expect, test } from 'bun:test';
import { ThinkingStallClock, buildThinkingOverlay, type ThinkingOverlayDeps } from '../../core/thinking-overlay.ts';

const STALL = 3_000; // > THINKING_STALL_FREEZE_MS (2500)

function fakeOrchestrator(over: Partial<ThinkingOverlayDeps['orchestrator']> = {}): ThinkingOverlayDeps['orchestrator'] {
  return {
    isThinking: true,
    getSpinner: () => '-',
    thinkingFrame: 0,
    streamingInputTokens: 0,
    streamingOutputTokens: 0,
    ...over,
  };
}
const cfg = { get: () => false } as ThinkingOverlayDeps['configManager'];

describe('ThinkingStallClock', () => {
  test('seeds at turn start (no stall on the first tick)', () => {
    const clock = new ThinkingStallClock();
    const info = clock.tick(0, false, 1000);
    expect(info?.msSinceLastDelta).toBe(0);
  });

  test('reports growing silence when output does not advance', () => {
    const clock = new ThinkingStallClock();
    clock.tick(0, false, 1000);        // seed
    const info = clock.tick(0, false, 1000 + STALL);
    expect(info?.msSinceLastDelta).toBe(STALL);
  });

  test('an output-token advance resets the silence', () => {
    const clock = new ThinkingStallClock();
    clock.tick(0, false, 1000);
    clock.tick(5, false, 1000 + STALL); // tokens advanced → clock moves forward
    const info = clock.tick(5, false, 1000 + STALL + 10);
    expect(info?.msSinceLastDelta).toBe(10);
  });

  test('tool active suppresses stall detection', () => {
    const clock = new ThinkingStallClock();
    clock.tick(0, false, 1000);
    expect(clock.tick(0, true, 1000 + STALL)).toBeUndefined();
  });

  test('reset re-seeds the next turn', () => {
    const clock = new ThinkingStallClock();
    clock.tick(0, false, 1000);
    clock.reset();
    expect(clock.tick(0, false, 5000)?.msSinceLastDelta).toBe(0); // seeded fresh at 5000
  });
});

describe('buildThinkingOverlay', () => {
  const base = (over: Partial<ThinkingOverlayDeps> = {}): ThinkingOverlayDeps => ({
    orchestrator: fakeOrchestrator(),
    configManager: cfg,
    streamToolPreview: undefined,
    streamTokenSpeed: 0,
    approvalPending: false,
    width: 60,
    clock: new ThinkingStallClock(),
    ...over,
  });

  test('returns [] and resets the clock when not thinking', () => {
    const clock = new ThinkingStallClock();
    clock.tick(0, false, 1000); // seed it
    const lines = buildThinkingOverlay(base({ orchestrator: fakeOrchestrator({ isThinking: false }), clock }));
    expect(lines).toEqual([]);
    // clock was reset → next tick re-seeds (no stall)
    expect(clock.tick(0, false, 99_999)?.msSinceLastDelta).toBe(0);
  });

  test('thinking → renders overlay lines', () => {
    const lines = buildThinkingOverlay(base());
    expect(lines.length).toBeGreaterThan(0);
  });

  test('approval pending surfaces the honest approval wording', () => {
    const lines = buildThinkingOverlay(base({ approvalPending: true }));
    const text = lines.map((l) => l.map((c) => c.char).join('')).join(' ');
    expect(text).toContain('Waiting for your approval');
  });
});
