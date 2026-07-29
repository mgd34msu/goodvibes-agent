import { describe, it, expect, afterEach } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryUsageStatsStore } from '@pellux/goodvibes-sdk/platform/state';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

const roots: string[] = [];
afterEach(() => { while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true }); });

function tempPath(): string {
  const root = makeProjectTempDir('goodvibes-agent-usage');
  roots.push(root);
  return join(root, 'memory-usage.json');
}

describe('MemoryUsageStatsStore', () => {
  it('counts injections and references per memory id', () => {
    const path = tempPath();
    const store = new MemoryUsageStatsStore(path);
    store.recordInjected(['a', 'b']);
    store.recordInjected(['a']);
    store.recordReferenced(['a']);
    expect(store.get('a')).toMatchObject({ injectedCount: 2, referencedCount: 1 });
    expect(store.get('b')).toMatchObject({ injectedCount: 1, referencedCount: 0 });
    expect(store.get('missing')).toBeNull();
  });

  it('lookup returns a consolidation signal, undefined when never tracked', () => {
    const path = tempPath();
    const store = new MemoryUsageStatsStore(path);
    store.recordInjected(['x']);
    expect(store.lookup('x')).toMatchObject({ injectedCount: 1, referencedCount: 0, lastReferencedAt: null });
    expect(store.lookup('never')).toBeUndefined();
  });

  it('persists across store instances', () => {
    const path = tempPath();
    const first = new MemoryUsageStatsStore(path);
    first.recordInjected(['k']);
    first.recordReferenced(['k']);
    const second = new MemoryUsageStatsStore(path);
    expect(second.get('k')).toMatchObject({ injectedCount: 1, referencedCount: 1 });
  });

  it('summarizes never-referenced vs referenced honestly', () => {
    const path = tempPath();
    const store = new MemoryUsageStatsStore(path);
    store.recordInjected(['a', 'b', 'c']);
    store.recordReferenced(['a']);
    const summary = store.summary();
    expect(summary.everInjected).toBe(3);
    expect(summary.everReferenced).toBe(1);
    expect(summary.neverReferenced).toBe(2);
    expect(summary.mostReferenced[0]?.id).toBe('a');
    expect(summary.signalNote.toLowerCase()).toContain('heuristic');
  });
});
