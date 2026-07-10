import type { MemoryConsolidationRunReceipt, MemoryConsolidationTrigger } from '../agent/memory-consolidation.ts';

/**
 * Decides WHEN idle-time consolidation runs, keeping the real-state idleness
 * check and the schedule cadence out of bootstrap wiring.
 *
 * Idleness is defined from real runtime state: `isIdle()` returns true only when
 * there is no active turn in flight (bootstrap wires it to
 * `activePromptTurnId === null`). The scheduler is poked on every turn-settled
 * event; a run fires only when the job is enabled, the agent is idle, no run is
 * already in flight, and at least `minIntervalMs` has elapsed since the last run.
 * The same `maybeRun` path also serves an explicit trigger.
 */
export interface MemoryConsolidationSchedulerDeps {
  /** Master switch — reads the resolved config's `enabled` (default false). */
  readonly isEnabled: () => boolean;
  /** Real-state idleness: true only when no turn is in flight. */
  readonly isIdle: () => boolean;
  /** Minimum ms between runs (the schedule cadence). */
  readonly minIntervalMs: () => number;
  /** Monotonic-enough clock, injected for tests. */
  readonly now: () => number;
  /** Performs the work + persists the receipt; returns it, or null when it did nothing. */
  readonly run: (trigger: MemoryConsolidationTrigger) => MemoryConsolidationRunReceipt | null;
}

export type MemoryConsolidationSkipReason =
  | 'disabled'
  | 'busy'
  | 'not-idle'
  | 'interval-not-elapsed';

export interface MemoryConsolidationSchedulerOutcome {
  readonly ran: boolean;
  readonly skipped?: MemoryConsolidationSkipReason;
  readonly receipt?: MemoryConsolidationRunReceipt;
}

export class MemoryConsolidationScheduler {
  private lastRunAt = 0;
  private running = false;

  public constructor(private readonly deps: MemoryConsolidationSchedulerDeps) {}

  /** Poke from a turn-settled event — the natural moment the agent becomes idle. */
  public onTurnSettled(): MemoryConsolidationSchedulerOutcome {
    return this.maybeRun('idle');
  }

  public maybeRun(trigger: MemoryConsolidationTrigger): MemoryConsolidationSchedulerOutcome {
    if (!this.deps.isEnabled()) return { ran: false, skipped: 'disabled' };
    if (this.running) return { ran: false, skipped: 'busy' };
    if (!this.deps.isIdle()) return { ran: false, skipped: 'not-idle' };
    const now = this.deps.now();
    if (this.lastRunAt !== 0 && now - this.lastRunAt < this.deps.minIntervalMs()) {
      return { ran: false, skipped: 'interval-not-elapsed' };
    }
    this.running = true;
    try {
      const receipt = this.deps.run(trigger);
      this.lastRunAt = now;
      return receipt ? { ran: true, receipt } : { ran: true };
    } finally {
      this.running = false;
    }
  }
}
