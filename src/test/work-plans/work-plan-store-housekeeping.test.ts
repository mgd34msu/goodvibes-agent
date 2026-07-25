import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WorkPlanStore, type WorkPlanItemStatus } from '../../work-plans/work-plan-store.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

interface StoredItem {
  readonly id: string;
  readonly title: string;
  readonly status: WorkPlanItemStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number;
}

function withStore<T>(fn: (make: () => WorkPlanStore) => T): T {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'gv-work-plan-housekeeping-'));
  try {
    return fn(() => new WorkPlanStore({
      homeDirectory,
      projectId: 'project:housekeeping',
      projectRoot: '/tmp/housekeeping',
    }));
  } finally {
    rmSync(homeDirectory, { recursive: true, force: true });
  }
}

function writePlanFile(filePath: string, body: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, body, 'utf8');
}

function storedItem(id: string, status: WorkPlanItemStatus, ageMs: number): StoredItem {
  const time = Date.now() - ageMs;
  return {
    id,
    title: `Item ${id}`,
    status,
    createdAt: time,
    updatedAt: time,
    ...(status === 'done' || status === 'cancelled' ? { completedAt: time } : {}),
  };
}

function writePlanWithItems(filePath: string, items: readonly StoredItem[]): void {
  const time = Date.now();
  writePlanFile(filePath, `${JSON.stringify({
    id: 'wp-housekeeping',
    projectId: 'project:housekeeping',
    projectRoot: '/tmp/housekeeping',
    title: 'Work Plan',
    items,
    createdAt: time,
    updatedAt: time,
  }, null, 2)}\n`);
}

describe('WorkPlanStore housekeeping', () => {
  test('degrades a zero-byte plan file to an empty plan instead of throwing', () => {
    withStore((make) => {
      const seed = make();
      writePlanFile(seed.filePath, '');

      const store = make();
      expect(() => store.getActivePlan()).not.toThrow();
      expect(store.listItems()).toHaveLength(0);
      expect(store.lastMaintenance()?.recovered).toBe('empty-file');
      // Every public method stays usable rather than throwing out of readPlan.
      expect(store.clearCompleted()).toBe(0);
      expect(store.toMarkdown()).toContain('No work plan items recorded.');
    });
  });

  test('degrades a crash-truncated plan file to an empty plan, preserving the bad file aside', () => {
    withStore((make) => {
      const seed = make();
      writePlanFile(seed.filePath, '{"id":"wp-housekeeping","items":[{"id":"wpi-1","title":"Half w');

      const store = make();
      expect(store.listItems()).toHaveLength(0);
      expect(store.lastMaintenance()?.recovered).toBe('quarantined');
      expect(store.lastMaintenance()?.quarantinedBytes).toBeGreaterThan(0);
      expect(existsSync(`${store.filePath}.corrupt`)).toBe(true);
      expect(existsSync(store.filePath)).toBe(false);

      // Still writable afterwards.
      const item = store.addItem('Recovered work');
      expect(make().listItems().map((entry) => entry.id)).toEqual([item.id]);
    });
  });

  test('degrades a plan file that is valid JSON but not an object', () => {
    withStore((make) => {
      const seed = make();
      writePlanFile(seed.filePath, '[1,2,3]\n');

      const store = make();
      expect(store.listItems()).toHaveLength(0);
      expect(store.lastMaintenance()?.recovered).toBe('quarantined');
    });
  });

  test('ages out terminal items while open work of the same age survives', () => {
    withStore((make) => {
      const seed = make();
      writePlanWithItems(seed.filePath, [
        storedItem('wpi-old-done', 'done', 60 * DAY_MS),
        storedItem('wpi-old-cancelled', 'cancelled', 60 * DAY_MS),
        storedItem('wpi-old-pending', 'pending', 60 * DAY_MS),
        storedItem('wpi-old-in-progress', 'in_progress', 200 * DAY_MS),
        storedItem('wpi-old-blocked', 'blocked', 200 * DAY_MS),
        storedItem('wpi-old-failed', 'failed', 200 * DAY_MS),
        storedItem('wpi-recent-done', 'done', 2 * DAY_MS),
      ]);

      const store = make();
      const items = store.listItems().map((item) => item.id);

      expect(items).toEqual([
        'wpi-old-pending',
        'wpi-old-in-progress',
        'wpi-old-blocked',
        'wpi-old-failed',
        'wpi-recent-done',
      ]);
      expect(store.lastMaintenance()?.expiredItems).toBe(2);
      expect(store.lastMaintenance()?.keptItems).toBe(5);

      const persisted = JSON.parse(readFileSync(store.filePath, 'utf8')) as { readonly items: readonly { readonly id: string }[] };
      expect(persisted.items.map((item) => item.id)).toEqual(items);
    });
  });

  test('caps the number of terminal items kept, newest first, and leaves open items uncapped', () => {
    withStore((make) => {
      const seed = make();
      const done = Array.from({ length: 130 }, (_, index) => storedItem(`wpi-done-${index}`, 'done', (130 - index) * 60_000));
      const open = Array.from({ length: 5 }, (_, index) => storedItem(`wpi-open-${index}`, 'pending', 5 * DAY_MS));
      writePlanWithItems(seed.filePath, [...done, ...open]);

      const store = make();
      const items = store.listItems();
      const keptDone = items.filter((item) => item.status === 'done');

      expect(keptDone).toHaveLength(100);
      expect(items.filter((item) => item.status === 'pending')).toHaveLength(5);
      expect(store.lastMaintenance()?.overflowItems).toBe(30);
      // The oldest 30 finished items are the ones dropped.
      expect(keptDone.some((item) => item.id === 'wpi-done-0')).toBe(false);
      expect(keptDone.some((item) => item.id === 'wpi-done-129')).toBe(true);
    });
  });

  test('sweeping a second time reclaims nothing and rewrites nothing', () => {
    withStore((make) => {
      const seed = make();
      writePlanWithItems(seed.filePath, [
        storedItem('wpi-old-done', 'done', 60 * DAY_MS),
        storedItem('wpi-open', 'pending', 60 * DAY_MS),
      ]);

      const first = make();
      expect(first.listItems().map((item) => item.id)).toEqual(['wpi-open']);
      expect(first.lastMaintenance()?.expiredItems).toBe(1);
      const afterFirst = readFileSync(first.filePath, 'utf8');

      const second = make();
      expect(second.listItems().map((item) => item.id)).toEqual(['wpi-open']);
      expect(second.lastMaintenance()?.expiredItems).toBe(0);
      expect(second.lastMaintenance()?.overflowItems).toBe(0);
      expect(readFileSync(second.filePath, 'utf8')).toBe(afterFirst);
    });
  });

  test('clears an active item pointer that pointed at a reaped item', () => {
    withStore((make) => {
      const seed = make();
      const time = Date.now();
      writePlanFile(seed.filePath, `${JSON.stringify({
        id: 'wp-housekeeping',
        projectId: 'project:housekeeping',
        projectRoot: '/tmp/housekeeping',
        title: 'Work Plan',
        items: [storedItem('wpi-old-done', 'done', 60 * DAY_MS), storedItem('wpi-open', 'pending', DAY_MS)],
        activeItemId: 'wpi-old-done',
        createdAt: time,
        updatedAt: time,
      }, null, 2)}\n`);

      const store = make();
      expect(store.getActivePlan().activeItemId).toBe('wpi-open');
    });
  });
});
