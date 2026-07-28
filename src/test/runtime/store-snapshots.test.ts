/**
 * Adoption contract proof for the daily store-snapshot scheduler, now consumed
 * from the SDK's public export (platform/state/store-snapshots — the former
 * agent-local fork-mirror and its local pruning engine existed only while the
 * class and RetentionPolicy/SnapshotPruner had no public export path). The
 * on-disk contract the agent composition relies on is unchanged:
 * `<db dir>/snapshots/<db file name>/<slug>.<reason>.snapshot`, one daily copy
 * per day on the scheduler's own (injectable) clock, sidecars included, bounded
 * retention.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StoreSnapshotScheduler, RetentionPolicy, SnapshotPruner } from '@pellux/goodvibes-sdk/platform/state/store-snapshots';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const roots: string[] = [];

function makeStoreDir(): string {
  const root = makeProjectTempDir('gv-agent-store-snapshots');
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * The scheduler's own `now` (injected below) drives WHEN a new daily copy is
 * due, but StoreSnapshotScheduler's default retention (defaultStoreSnapshotRetention())
 * builds a RetentionPolicy with no injected clock, so its age-based pruning
 * reads the REAL Date.now() — a real-clock dependency that made the
 * boundary-exact retention test below drift further wrong every day past
 * this file's 2026-07-13 fixture date. Build the SAME default retention
 * classes (14 daily / 512MB, 30 forensic / 1GB) with the SAME injected clock
 * so every test in this file is fully time-decoupled from the real wall clock.
 */
function makeScheduler(dbPath: string, now: () => number): StoreSnapshotScheduler {
  return new StoreSnapshotScheduler({
    stores: [{ name: 'test store', dbPath }],
    now,
    retention: new RetentionPolicy(
      {
        standard: { maxAgeMs: 14 * DAY_MS, maxCount: 14, maxSizeBytes: 512 * 1024 * 1024 },
        forensic: { maxAgeMs: 30 * DAY_MS, maxCount: 30, maxSizeBytes: 1024 * 1024 * 1024 },
      },
      now,
      new SnapshotPruner(),
    ),
    // Timers are never armed in these tests: tick() is driven directly.
    setTimer: () => setTimeout(() => {}, 0),
  });
}

function snapshotDir(dbPath: string): string {
  return join(join(dbPath, '..'), 'snapshots', 'store.sqlite');
}

describe('StoreSnapshotScheduler (SDK public export, agent adoption contract)', () => {
  test('first tick writes a daily snapshot with -wal sidecar in the shared layout', async () => {
    const root = makeStoreDir();
    const dbPath = join(root, 'store.sqlite');
    writeFileSync(dbPath, 'live-db-bytes');
    writeFileSync(`${dbPath}-wal`, 'wal-bytes');
    const scheduler = makeScheduler(dbPath, () => Date.parse('2026-07-13T08:00:00Z'));

    await scheduler.tick();

    const names = readdirSync(snapshotDir(dbPath));
    const snapshots = names.filter((name) => name.endsWith('.daily.snapshot'));
    expect(snapshots).toHaveLength(1);
    expect(names.some((name) => name.endsWith('.daily.snapshot-wal'))).toBe(true);
  });

  test('a second tick the same day writes nothing; a tick a day later writes the next daily copy', async () => {
    const root = makeStoreDir();
    const dbPath = join(root, 'store.sqlite');
    writeFileSync(dbPath, 'live-db-bytes');
    let at = Date.parse('2026-07-13T08:00:00Z');
    const scheduler = makeScheduler(dbPath, () => at);

    await scheduler.tick();
    at += 60 * 60 * 1000; // one hour later, same day
    await scheduler.tick();
    let snapshots = readdirSync(snapshotDir(dbPath)).filter((name) => name.endsWith('.daily.snapshot'));
    expect(snapshots).toHaveLength(1);

    at += DAY_MS; // a day past the first copy
    await scheduler.tick();
    snapshots = readdirSync(snapshotDir(dbPath)).filter((name) => name.endsWith('.daily.snapshot'));
    expect(snapshots).toHaveLength(2);
  });

  test('missing and empty store files produce no snapshot (nothing to protect, no noise)', async () => {
    const root = makeStoreDir();
    const dbPath = join(root, 'store.sqlite');
    const scheduler = makeScheduler(dbPath, () => Date.now());
    await scheduler.tick(); // missing file
    writeFileSync(dbPath, '');
    await scheduler.tick(); // empty file
    expect(readdirSync(root)).not.toContain('snapshots');
  });

  test('retention keeps at most 14 daily copies, newest kept, oldest deleted', async () => {
    const root = makeStoreDir();
    const dbPath = join(root, 'store.sqlite');
    writeFileSync(dbPath, 'live-db-bytes');
    const dir = snapshotDir(dbPath);
    mkdirSync(dir, { recursive: true });
    const base = Date.parse('2026-07-13T08:00:00Z');
    // 16 pre-existing daily copies, one per day, all inside the 14-day age
    // limit is impossible for the oldest two — seed them a day apart with the
    // newest one 'fresh' so the sweep itself writes nothing new.
    for (let i = 0; i < 16; i += 1) {
      const at = base - i * DAY_MS;
      const name = `${new Date(at).toISOString().replace(/[:.]/g, '-')}.daily.snapshot`;
      const path = join(dir, name);
      writeFileSync(path, `copy-${i}`);
      utimesSync(path, new Date(at), new Date(at));
    }
    const scheduler = makeScheduler(dbPath, () => base);

    await scheduler.tick();

    const kept = readdirSync(dir).filter((name) => name.endsWith('.daily.snapshot'));
    expect(kept.length).toBe(14);
    // The newest copy survives; the two oldest are gone.
    const newestName = `${new Date(base).toISOString().replace(/[:.]/g, '-')}.daily.snapshot`;
    expect(kept).toContain(newestName);
  });
});
