import { logger, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import {
  resolveMemoryConsolidationConfig,
  runMemoryConsolidation,
  type MemoryConsolidationConfigSource,
  type MemoryConsolidationRegistry,
  type MemoryConsolidationRunReceipt,
  type MemoryConsolidationUsageLookup,
} from '@pellux/goodvibes-sdk/platform/state';

/**
 * Local port of the SDK's daemon-side memory-consolidation scheduler
 * (packages/sdk/src/platform/state/memory-consolidation-scheduler.ts).
 *
 * SDK round note (see the SDK's own commit "memory: consolidation actually
 * runs — daemon-driven idle + slow schedule"): idle-time consolidation is now
 * meant to be driven by a single `MemoryConsolidationScheduler` class the SDK
 * ships in packages/sdk/src/platform/state/memory-consolidation-scheduler.ts
 * (built into dist/platform/state/memory-consolidation-scheduler.js) — but as
 * of SDK commit a5c63e3b that class is NOT re-exported from the public
 * `platform/state` barrel (packages/sdk/src/platform/state/index.ts only
 * re-exports resolveMemoryConsolidationConfig and runMemoryConsolidation, the
 * two primitives), so no external consumer can import the class itself. This
 * is a verified SDK packaging gap, not a design choice on this side.
 *
 * This file is a faithful, deliberately narrow port of that class built ONLY
 * from the two primitives the barrel does export — same dual trigger (idle at
 * intervalMs cadence once minIdleMs of continuous idleness has accrued, and a
 * `schedule` fallback once per SCHEDULE_FACTOR x intervalMs so a never-idle
 * host still consolidates), same bounded receipt ring, same tick() shape (so
 * the sleep-edge wake catch-up in runtime/services.ts can drive it exactly
 * like the SDK composition root drives its own instance). Delete this file
 * and import the real class the moment the SDK re-exports it — see
 * memory-consolidation-scheduler.test.ts for the behavior this pins.
 */

const SCHEDULE_FACTOR = 4;
const RECEIPT_RING_SIZE = 20;

export interface MemoryConsolidationSchedulerOptions {
  readonly memoryRegistry: MemoryConsolidationRegistry;
  /** Live config source (ConfigManager.getRaw shape); re-read every tick. */
  readonly configSource: MemoryConsolidationConfigSource;
  /** True when the runtime is idle right now (e.g. no busy broker sessions). */
  readonly isIdle: () => boolean;
  readonly usageLookup?: MemoryConsolidationUsageLookup | undefined;
  readonly now?: (() => number) | undefined;
  readonly setTimer?: ((fn: () => void, ms: number) => ReturnType<typeof setTimeout>) | undefined;
  readonly clearTimer?: ((timer: ReturnType<typeof setTimeout>) => void) | undefined;
  /** Wake cadence for the due-ness check (5 minutes by default). */
  readonly checkIntervalMs?: number | undefined;
  /** Optional receipt sink invoked after every run (in addition to the ring). */
  readonly onReceipt?: ((receipt: MemoryConsolidationRunReceipt) => void) | undefined;
}

export class MemoryConsolidationScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private lastRunAt = 0;
  private startedAt: number | null = null;
  private idleSince: number | null = null;
  private readonly receipts: MemoryConsolidationRunReceipt[] = [];

  public constructor(private readonly options: MemoryConsolidationSchedulerOptions) {}

  private get checkIntervalMs(): number {
    return this.options.checkIntervalMs ?? 5 * 60 * 1000;
  }

  public start(): void {
    this.stopped = false;
    this.scheduleNext();
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer) {
      (this.options.clearTimer ?? clearTimeout)(this.timer);
      this.timer = null;
    }
  }

  /** The retained receipts, newest last (bounded ring). */
  public listReceipts(): readonly MemoryConsolidationRunReceipt[] {
    return this.receipts;
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    const setTimer = this.options.setTimer ?? setTimeout;
    this.timer = setTimer(() => {
      this.tick();
    }, this.checkIntervalMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /**
   * One wake: track continuous idleness, then run when due — the idle
   * trigger at intervalMs cadence, or the slow schedule fallback when the
   * runtime has not offered an idle window for SCHEDULE_FACTOR x intervalMs.
   * Also the sleep-edge wake catch-up hook's entry point.
   */
  public tick(): void {
    if (this.stopped) return;
    try {
      const now = (this.options.now ?? Date.now)();
      if (this.startedAt === null) this.startedAt = now;
      const config = resolveMemoryConsolidationConfig(this.options.configSource);
      if (!config.enabled) return;

      const idleNow = this.options.isIdle();
      if (idleNow && this.idleSince === null) this.idleSince = now;
      if (!idleNow) this.idleSince = null;
      const idleLongEnough = idleNow && this.idleSince !== null && now - this.idleSince >= config.minIdleMs;

      const dueForIdleRun = idleLongEnough && now - this.lastRunAt >= config.intervalMs;
      const dueForScheduleRun = now - Math.max(this.lastRunAt, this.startedAt) >= config.intervalMs * SCHEDULE_FACTOR;
      if (!dueForIdleRun && !dueForScheduleRun) return;

      const receipt = runMemoryConsolidation({
        memoryRegistry: this.options.memoryRegistry,
        config,
        now,
        trigger: dueForIdleRun ? 'idle' : 'schedule',
        idle: idleNow,
        ...(this.options.usageLookup ? { usageLookup: this.options.usageLookup } : {}),
      });
      this.lastRunAt = now;
      this.receipts.push(receipt);
      if (this.receipts.length > RECEIPT_RING_SIZE) this.receipts.splice(0, this.receipts.length - RECEIPT_RING_SIZE);
      logger.info('[memory] consolidation ran', {
        runId: receipt.runId,
        trigger: receipt.trigger,
        scanned: receipt.scanned,
        merged: receipt.merged.length,
        decayed: receipt.decayed.length,
        archived: receipt.archived.length,
        proposed: receipt.proposed.length,
      });
      try {
        this.options.onReceipt?.(receipt);
      } catch (error) {
        logger.warn('[memory] consolidation receipt sink failed', { error: summarizeError(error) });
      }
    } catch (error) {
      logger.warn('[memory] consolidation run failed', { error: summarizeError(error) });
    } finally {
      this.scheduleNext();
    }
  }
}
