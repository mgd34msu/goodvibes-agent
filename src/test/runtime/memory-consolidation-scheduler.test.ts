import { describe, it, expect } from 'bun:test';
import { MemoryConsolidationScheduler } from '../../runtime/memory-consolidation-scheduler.ts';
import type { MemoryConsolidationRunReceipt } from '../../agent/memory-consolidation.ts';

function fakeReceipt(): MemoryConsolidationRunReceipt {
  return {
    runId: 'test', ranAt: new Date(0).toISOString(), trigger: 'idle', idle: true, scanned: 0,
    merged: [], archived: [], decayed: [], proposed: [], usageSignalAvailable: false, note: '',
  };
}

interface Harness {
  enabled: boolean;
  idle: boolean;
  clock: number;
  interval: number;
  runs: number;
  scheduler: MemoryConsolidationScheduler;
}

function makeHarness(overrides: Partial<Pick<Harness, 'enabled' | 'idle' | 'interval'>> = {}): Harness {
  const h: Harness = {
    enabled: overrides.enabled ?? true,
    idle: overrides.idle ?? true,
    clock: 1_000_000,
    interval: overrides.interval ?? 1000,
    runs: 0,
    scheduler: undefined as unknown as MemoryConsolidationScheduler,
  };
  h.scheduler = new MemoryConsolidationScheduler({
    isEnabled: () => h.enabled,
    isIdle: () => h.idle,
    minIntervalMs: () => h.interval,
    now: () => h.clock,
    run: () => { h.runs += 1; return fakeReceipt(); },
  });
  return h;
}

describe('MemoryConsolidationScheduler', () => {
  it('skips when disabled', () => {
    const h = makeHarness({ enabled: false });
    expect(h.scheduler.onTurnSettled()).toEqual({ ran: false, skipped: 'disabled' });
    expect(h.runs).toBe(0);
  });

  it('skips when a turn is still active (not idle)', () => {
    const h = makeHarness({ idle: false });
    expect(h.scheduler.onTurnSettled().skipped).toBe('not-idle');
    expect(h.runs).toBe(0);
  });

  it('runs when enabled and idle', () => {
    const h = makeHarness();
    const outcome = h.scheduler.onTurnSettled();
    expect(outcome.ran).toBe(true);
    expect(outcome.receipt?.runId).toBe('test');
    expect(h.runs).toBe(1);
  });

  it('does not run again before the interval elapses, then runs after it', () => {
    const h = makeHarness({ interval: 1000 });
    h.scheduler.onTurnSettled();
    expect(h.runs).toBe(1);
    h.clock += 500;
    expect(h.scheduler.onTurnSettled().skipped).toBe('interval-not-elapsed');
    expect(h.runs).toBe(1);
    h.clock += 600; // total 1100 >= interval
    expect(h.scheduler.onTurnSettled().ran).toBe(true);
    expect(h.runs).toBe(2);
  });
});
