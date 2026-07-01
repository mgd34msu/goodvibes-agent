/**
 * Tests for SessionLineageTracker (from @pellux/goodvibes-sdk/platform/core).
 *
 * SDK 0.35.0 contract: the tracker is a pure, append-only data holder.
 * Section formatting moved out to buildSessionLineage in compaction-sections,
 * so the tracker no longer exposes format(). These tests exercise the tracker's
 * public contract (setters + getters + reset) that this app consumes.
 *
 * Run with: bun test src/test/core/session-lineage.test.ts
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { SessionLineageTracker } from '@pellux/goodvibes-sdk/platform/core';

describe('SessionLineageTracker', () => {
  let tracker: SessionLineageTracker;

  beforeEach(() => {
    tracker = new SessionLineageTracker();
  });

  // ---------------------------------------------------------------------------
  // setOriginalTask
  // ---------------------------------------------------------------------------

  describe('setOriginalTask', () => {
    it('sets the task', () => {
      tracker.setOriginalTask('build the thing');
      expect(tracker.getOriginalTask()).toBe('build the thing');
    });

    it('silently ignores second call (overwrite guard)', () => {
      tracker.setOriginalTask('first task');
      tracker.setOriginalTask('second task');
      expect(tracker.getOriginalTask()).toBe('first task');
    });
  });

  // ---------------------------------------------------------------------------
  // addCompactionEntry
  // ---------------------------------------------------------------------------

  describe('addCompactionEntry', () => {
    it('appends entries with incrementing numbers', () => {
      tracker.setOriginalTask('some task');
      tracker.addCompactionEntry('first compaction');
      tracker.addCompactionEntry('second compaction');
      expect(tracker.getEntries()).toEqual([
        '- #1: first compaction',
        '- #2: second compaction',
      ]);
      expect(tracker.getCompactionCount()).toBe(2);
    });

    it('rejects empty summary', () => {
      tracker.addCompactionEntry('');
      expect(tracker.getCompactionCount()).toBe(0);
      expect(tracker.getEntries()).toEqual([]);
    });

    it('rejects whitespace-only summary', () => {
      tracker.addCompactionEntry('   ');
      expect(tracker.getCompactionCount()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getCompactionCount
  // ---------------------------------------------------------------------------

  describe('getCompactionCount', () => {
    it('returns 0 when no entries added', () => {
      expect(tracker.getCompactionCount()).toBe(0);
    });

    it('returns correct count after adding entries', () => {
      tracker.addCompactionEntry('one');
      tracker.addCompactionEntry('two');
      tracker.addCompactionEntry('three');
      expect(tracker.getCompactionCount()).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // getOriginalTask
  // ---------------------------------------------------------------------------

  describe('getOriginalTask', () => {
    it('returns null when no task set', () => {
      expect(tracker.getOriginalTask()).toBeNull();
    });

    it('returns the task once set', () => {
      tracker.setOriginalTask('implement the feature');
      expect(tracker.getOriginalTask()).toBe('implement the feature');
    });
  });

  // ---------------------------------------------------------------------------
  // getEntries
  // ---------------------------------------------------------------------------

  describe('getEntries', () => {
    it('returns an empty array when no entries added', () => {
      expect(tracker.getEntries()).toEqual([]);
    });

    it('reflects each accepted entry in order', () => {
      tracker.addCompactionEntry('alpha');
      tracker.addCompactionEntry('beta');
      expect(tracker.getEntries()).toEqual(['- #1: alpha', '- #2: beta']);
    });
  });

  // ---------------------------------------------------------------------------
  // reset
  // ---------------------------------------------------------------------------

  describe('reset', () => {
    it('clears task and entries', () => {
      tracker.setOriginalTask('some task');
      tracker.addCompactionEntry('entry one');
      tracker.reset();
      expect(tracker.getOriginalTask()).toBeNull();
      expect(tracker.getEntries()).toEqual([]);
      expect(tracker.getCompactionCount()).toBe(0);
    });

    it('allows setOriginalTask to be called again after reset', () => {
      tracker.setOriginalTask('first task');
      tracker.reset();
      tracker.setOriginalTask('new task after reset');
      expect(tracker.getOriginalTask()).toBe('new task after reset');
    });
  });
});
