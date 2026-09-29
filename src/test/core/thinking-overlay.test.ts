/**
 * thinking-overlay.test.ts, the extracted stall clock + overlay builder.
 */

import { describe, expect, test } from 'bun:test';
import { ThinkingStallClock, buildBusyState, buildThinkingOverlay, type ThinkingOverlayDeps } from '../../core/thinking-overlay.ts';

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

describe('buildBusyState and buildThinkingOverlay', () => {
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

  test('the busy state is null and the clock resets when not thinking', () => {
    const clock = new ThinkingStallClock();
    clock.tick(0, false, 1000); // seed it
    expect(buildBusyState(base({ orchestrator: fakeOrchestrator({ isThinking: false }), clock }))).toBeNull();
    // clock was reset → next tick re-seeds (no stall)
    expect(clock.tick(0, false, 99_999)?.msSinceLastDelta).toBe(0);
  });

  test('thinking → a busy state for the status line (spinner, phrase, elapsed)', () => {
    const busy = buildBusyState(base());
    expect(busy).not.toBeNull();
    expect(busy!.phrase.length).toBeGreaterThan(0);
    expect(busy!.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test('approval pending surfaces the honest approval wording', () => {
    const busy = buildBusyState(base({ approvalPending: true }));
    expect(busy!.phrase).toContain('Waiting for your approval');
    expect(busy!.approvalPending).toBe(true);
  });

  test('the transcript gets no rows of its own unless the tool preview is on', () => {
    expect(buildThinkingOverlay(base({ orchestrator: fakeOrchestrator({ isThinking: false }) }))).toEqual([]);
    expect(buildThinkingOverlay(base({ streamToolPreview: 'web_search {"q": "fares"}' })).length).toBeLessThanOrEqual(1);
  });
});
