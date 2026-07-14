import { describe, it, expect } from 'bun:test';
import { MemoryConsolidationScheduler } from '../../runtime/memory-consolidation-scheduler.ts';
import type { MemoryConsolidationRunReceipt } from '@pellux/goodvibes-sdk/platform/state';

/**
 * Behavior parity pin for the local port of the SDK's daemon-side
 * MemoryConsolidationScheduler (see runtime/memory-consolidation-scheduler.ts
 * for why this repo ports it instead of importing the class directly). These
 * tests exercise the SAME dual trigger (idle at intervalMs cadence once
 * minIdleMs of continuous idleness has accrued, and the schedule fallback at
 * SCHEDULE_FACTOR x intervalMs) the SDK's own test suite pins for the class
 * this ports, via the injectable clock/timer/idle seams — no real timers.
 * The scheduler calls the real runMemoryConsolidation engine on every tick
 * (not a stub), against an empty registry so every run is a real, harmless
 * no-op scan.
 */

const emptyRegistry = { getAll: () => [], review: () => null, update: () => null };

interface Harness {
  enabled: boolean;
  idle: boolean;
  clock: number;
  intervalMs: number;
  minIdleMs: number;
  runs: Array<'idle' | 'schedule'>;
  receipts: MemoryConsolidationRunReceipt[];
  scheduler: MemoryConsolidationScheduler;
}

function makeHarness(overrides: Partial<Pick<Harness, 'enabled' | 'idle' | 'intervalMs' | 'minIdleMs'>> = {}): Harness {
  const h: Harness = {
    enabled: overrides.enabled ?? true,
    idle: overrides.idle ?? true,
    clock: 1_000_000,
    intervalMs: overrides.intervalMs ?? 1000,
    minIdleMs: overrides.minIdleMs ?? 0,
    runs: [],
    receipts: [],
    scheduler: undefined as unknown as MemoryConsolidationScheduler,
  };
  h.scheduler = new MemoryConsolidationScheduler({
    memoryRegistry: emptyRegistry,
    configSource: {
      getRaw: () => ({
        learning: {
          consolidation: {
            enabled: h.enabled,
            intervalMs: h.intervalMs,
            minIdleMs: h.minIdleMs,
          },
        },
      }),
    },
    isIdle: () => h.idle,
    now: () => h.clock,
    // No real timers: scheduleNext() is invoked but its setTimeout callback
    // is never fired by these tests; tick() is called directly instead.
    setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {},
    onReceipt: (receipt) => { h.receipts.push(receipt); h.runs.push(receipt.trigger as 'idle' | 'schedule'); },
  });
  return h;
}

describe('MemoryConsolidationScheduler (local port)', () => {
  it('does nothing when disabled', () => {
    const h = makeHarness({ enabled: false });
    h.scheduler.tick();
    expect(h.runs).toEqual([]);
    expect(h.scheduler.listReceipts()).toEqual([]);
  });

  it('runs the idle trigger once continuously idle for minIdleMs and intervalMs has elapsed', () => {
    const h = makeHarness({ intervalMs: 1000, minIdleMs: 500 });
    h.scheduler.start();
    h.scheduler.tick(); // idleSince = clock; not idle-long-enough yet
    expect(h.runs).toEqual([]);
    h.clock += 500; // idle for exactly minIdleMs
    h.scheduler.tick();
    expect(h.runs).toEqual(['idle']);
    h.scheduler.stop();
  });

  it('does not double-run before the interval elapses again', () => {
    const h = makeHarness({ intervalMs: 1000, minIdleMs: 0 });
    h.scheduler.tick();
    expect(h.runs).toEqual(['idle']);
    h.clock += 100;
    h.scheduler.tick();
    expect(h.runs).toEqual(['idle']); // still just one run
  });

  it('resets the idle-since clock when work resumes, delaying the next idle run', () => {
    const h = makeHarness({ intervalMs: 1000, minIdleMs: 500 });
    h.idle = true;
    h.scheduler.tick(); // idleSince set
    h.clock += 300;
    h.idle = false; // work resumes before minIdleMs accrues
    h.scheduler.tick(); // idleSince cleared
    h.idle = true;
    h.clock += 400; // this tick is where idleSince is (re)set to the current clock
    h.scheduler.tick();
    expect(h.runs).toEqual([]);
    h.clock += 500; // exactly minIdleMs since idleSince was (re)set above
    h.scheduler.tick();
    expect(h.runs).toEqual(['idle']);
  });

  it('falls back to the schedule trigger when the runtime is never idle long enough', () => {
    const h = makeHarness({ intervalMs: 1000, minIdleMs: 10_000, idle: false });
    h.scheduler.tick(); // startedAt = clock
    h.clock += 3999; // just under SCHEDULE_FACTOR(4) x intervalMs
    h.scheduler.tick();
    expect(h.runs).toEqual([]);
    h.clock += 1; // exactly 4000ms since start
    h.scheduler.tick();
    expect(h.runs).toEqual(['schedule']);
  });

  it('retains receipts on a bounded ring', () => {
    const h = makeHarness({ intervalMs: 100, minIdleMs: 0 });
    for (let i = 0; i < 25; i += 1) {
      h.clock += 100;
      h.scheduler.tick();
    }
    expect(h.scheduler.listReceipts().length).toBeLessThanOrEqual(20);
  });
});
