/**
 * Fork-mirror of the SDK's daily store-snapshot scheduler
 * (platform/state/store-snapshots.ts — the class has no public export path;
 * the RuntimeServices contract nevertheless requires a scheduler member).
 *
 * Same observable behavior as the SDK's StoreSnapshotScheduler:
 * - hourly wake, unref'd timers (the loop never keeps the process alive);
 * - one `daily`-reason snapshot per store per day, written as
 *   `<db dir>/snapshots/<db file name>/<iso-slug>.daily.snapshot` with any
 *   -wal/-shm sidecars — the exact layout the SDK's snapshot/restore
 *   functions and pre-migration snapshots use, so all writers of one store
 *   (daemon, TUI, this Agent) share one snapshot history and one daily copy;
 * - bounded retention with the SDK's default limits: daily copies keep at
 *   most 14 files / 14 days / 512 MiB; every other reason class (the
 *   pre-migration `forensic` copies the store classes write on schema bumps)
 *   keeps at most 30 files / 30 days / 1 GiB.
 *
 * DELIBERATE DIVERGENCE: pruning is applied directly per reason class
 * (age, count, cumulative size — newest kept) instead of through the SDK's
 * retention engine, because RetentionPolicy/SnapshotPruner are unexported.
 * The bounds and the on-disk layout are identical; only the engine is local.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { logger, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';

const STORE_SNAPSHOT_DIR = 'snapshots';
const SNAPSHOT_SUFFIX = '.snapshot';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AgentSnapshotStoreTarget {
  readonly name: string;
  readonly dbPath: string;
}

export interface AgentStoreSnapshotSchedulerOptions {
  readonly stores: readonly AgentSnapshotStoreTarget[];
  readonly now?: (() => number) | undefined;
  readonly setTimer?: ((fn: () => void, ms: number) => ReturnType<typeof setTimeout>) | undefined;
  readonly clearTimer?: ((timer: ReturnType<typeof setTimeout>) => void) | undefined;
  /** How often the scheduler wakes to check due-ness (hourly by default). */
  readonly checkIntervalMs?: number | undefined;
}

interface SnapshotEntry {
  readonly path: string;
  readonly createdAt: number;
  readonly sizeBytes: number;
  readonly reason: string;
}

interface ClassLimits {
  readonly maxAgeMs: number;
  readonly maxCount: number;
  readonly maxSizeBytes: number;
}

/** The SDK's default store-snapshot retention bounds, verbatim. */
const DAILY_LIMITS: ClassLimits = { maxAgeMs: 14 * DAY_MS, maxCount: 14, maxSizeBytes: 512 * 1024 * 1024 };
const FORENSIC_LIMITS: ClassLimits = { maxAgeMs: 30 * DAY_MS, maxCount: 30, maxSizeBytes: 1024 * 1024 * 1024 };

function isRealDbPath(dbPath: string): boolean {
  return dbPath.length > 0 && dbPath !== ':memory:';
}

/** Directory a store's snapshots live in: `<db dir>/snapshots/<db file name>/`. */
function storeSnapshotDir(dbPath: string): string {
  return join(dirname(dbPath), STORE_SNAPSHOT_DIR, basename(dbPath));
}

function timestampSlug(at: number): string {
  return new Date(at).toISOString().replace(/[:.]/g, '-');
}

/** All snapshots for a store, newest first (same layout the SDK reads). */
function listStoreSnapshots(dbPath: string): SnapshotEntry[] {
  if (!isRealDbPath(dbPath)) return [];
  const dir = storeSnapshotDir(dbPath);
  if (!existsSync(dir)) return [];
  const entries: SnapshotEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(SNAPSHOT_SUFFIX)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    const reasonMatch = name.match(/\.([^.]+)\.snapshot$/);
    entries.push({
      path,
      createdAt: stat.mtimeMs,
      sizeBytes: stat.size,
      reason: reasonMatch?.[1] ?? 'unknown',
    });
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Copy the store file (and any -wal/-shm sidecars) into the snapshot dir.
 * Returns the snapshot path, or null when there is nothing to snapshot
 * (in-memory store, missing file, or empty file).
 */
function snapshotStoreFile(dbPath: string, reason: string, now: () => number): string | null {
  if (!isRealDbPath(dbPath) || !existsSync(dbPath)) return null;
  if (statSync(dbPath).size === 0) return null;
  const at = now();
  const dir = storeSnapshotDir(dbPath);
  mkdirSync(dir, { recursive: true });
  // Millisecond-granular slugs: uniquify instead of clobbering when two
  // snapshots land in the same millisecond.
  let snapshotPath = join(dir, `${timestampSlug(at)}.${reason}${SNAPSHOT_SUFFIX}`);
  for (let counter = 1; existsSync(snapshotPath); counter += 1) {
    snapshotPath = join(dir, `${timestampSlug(at)}-${counter}.${reason}${SNAPSHOT_SUFFIX}`);
  }
  copyFileSync(dbPath, snapshotPath);
  for (const sidecar of ['-wal', '-shm']) {
    if (existsSync(`${dbPath}${sidecar}`)) {
      copyFileSync(`${dbPath}${sidecar}`, `${snapshotPath}${sidecar}`);
    }
  }
  // Stamp the snapshot's mtime with the LOGICAL creation time (`at`), not the
  // real wall-clock mtime copyFileSync leaves. The "one daily copy per day"
  // decision below reads this mtime back as the snapshot's createdAt, so it must
  // reflect the scheduler's injected clock — otherwise a real-vs-injected clock
  // skew (e.g. an injected time on the same real calendar day) makes the day
  // boundary compare against the filesystem's wall clock instead of the
  // scheduler's, which is both wrong in principle and time-of-day-flaky in tests.
  // In production `at` is real `now`, so this is a no-op there.
  const stampSeconds = at / 1000;
  utimesSync(snapshotPath, stampSeconds, stampSeconds);
  logger.info('store snapshot written', { store: basename(dbPath), reason, snapshotPath });
  return snapshotPath;
}

function deleteSnapshot(entry: SnapshotEntry): void {
  rmSync(entry.path, { force: true });
  for (const sidecar of ['-wal', '-shm']) {
    rmSync(`${entry.path}${sidecar}`, { force: true });
  }
}

/**
 * Daily snapshots of every registered store, with bounded retention applied
 * after every sweep. Time and timers are injectable; the loop never keeps
 * the process alive.
 */
export class AgentStoreSnapshotScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly options: AgentStoreSnapshotSchedulerOptions) {}

  private get checkIntervalMs(): number {
    return this.options.checkIntervalMs ?? 60 * 60 * 1000;
  }

  start(): void {
    this.stopped = false;
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      (this.options.clearTimer ?? clearTimeout)(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    const setTimer = this.options.setTimer ?? setTimeout;
    this.timer = setTimer(() => {
      void this.tick();
    }, this.checkIntervalMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** One sweep: snapshot stores whose newest daily copy is a day old, then prune. */
  async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      const now = (this.options.now ?? Date.now)();
      for (const store of this.options.stores) {
        try {
          const newestDaily = listStoreSnapshots(store.dbPath).find((snapshot) => snapshot.reason === 'daily');
          if (!newestDaily || now - newestDaily.createdAt >= DAY_MS) {
            snapshotStoreFile(store.dbPath, 'daily', () => now);
          }
        } catch (error) {
          logger.warn('daily store snapshot failed', { store: store.name, error: summarizeError(error) });
        }
      }
      await this.pruneRegisteredSnapshots();
    } finally {
      this.scheduleNext();
    }
  }

  /** Apply the bounded retention limits per reason class, newest kept. */
  async pruneRegisteredSnapshots(): Promise<void> {
    const now = (this.options.now ?? Date.now)();
    for (const store of this.options.stores) {
      try {
        const all = listStoreSnapshots(store.dbPath);
        const byClass: Record<'daily' | 'forensic', SnapshotEntry[]> = { daily: [], forensic: [] };
        for (const entry of all) byClass[entry.reason === 'daily' ? 'daily' : 'forensic'].push(entry);
        let deleted = 0;
        let reclaimedBytes = 0;
        for (const [entries, limits] of [[byClass.daily, DAILY_LIMITS], [byClass.forensic, FORENSIC_LIMITS]] as const) {
          let keptCount = 0;
          let keptBytes = 0;
          for (const entry of entries) { // newest first
            const tooOld = now - entry.createdAt > limits.maxAgeMs;
            const overCount = keptCount + 1 > limits.maxCount;
            const overSize = keptBytes + entry.sizeBytes > limits.maxSizeBytes;
            if (tooOld || overCount || overSize) {
              deleteSnapshot(entry);
              deleted += 1;
              reclaimedBytes += entry.sizeBytes;
              continue;
            }
            keptCount += 1;
            keptBytes += entry.sizeBytes;
          }
        }
        if (deleted > 0) {
          logger.info('store snapshot retention pruned', { deleted, reclaimedBytes });
        }
      } catch (error) {
        logger.warn('store snapshot retention prune failed', { error: summarizeError(error) });
      }
    }
  }
}
