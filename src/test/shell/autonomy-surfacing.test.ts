import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShellPathService } from '@/runtime/index.ts';
import { createAutonomySurfacing } from '../../shell/autonomy-surfacing.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempShellPaths() {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-autonomy-test-'));
  return createShellPathService({ workingDirectory: root, homeDirectory: root });
}

/**
 * Minimal stub for AutonomySurfacingOptions.
 */
function makeOptions(overrides: Partial<Parameters<typeof createAutonomySurfacing>[0]> = {}) {
  const feedPushes: Array<{ text: string; priority?: 'high' | 'low'; kind?: string }> = [];
  const highMessages: string[] = [];
  const shellPaths = tempShellPaths();
  return {
    options: {
      shellPaths,
      listAutomationJobs: () => [],
      listApprovals: () => [],
      getTasksSnapshot: () => [],
      router: {
        high: (msg: string) => { highMessages.push(msg); },
        getFeed: () => ({
          push: (text: string, priority?: 'high' | 'low', kind?: string) => {
            feedPushes.push({ text, priority, kind });
          },
        }),
      },
      render: () => {},
      ...overrides,
    } satisfies Parameters<typeof createAutonomySurfacing>[0],
    feedPushes,
    highMessages,
  };
}

// ---------------------------------------------------------------------------
// onAwayDigest wiring in announceAwayDigest
// ---------------------------------------------------------------------------

describe('announceAwayDigest — onAwayDigest wiring', () => {
  test('stub returning > 0 appends the skill-draft feed line', async () => {
    const { options, feedPushes } = makeOptions({
      onAwayDigest: () => 2,
    });
    const autonomy = createAutonomySurfacing(options);
    autonomy.announceAwayDigest();
    // announceAwayDigest is async (void + inner async IIFE) — wait one event-loop turn
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    autonomy.stop();

    const draftLine = feedPushes.find((p) => p.text.includes('drafted') && p.text.includes('skill'));
    expect(draftLine).toBeDefined();
    expect(draftLine?.text).toContain('2');
    expect(draftLine?.text).toContain('review them under Memory');
  });

  test('stub returning 1 uses singular "skill" (not "skills")', async () => {
    const { options, feedPushes } = makeOptions({
      onAwayDigest: () => 1,
    });
    const autonomy = createAutonomySurfacing(options);
    autonomy.announceAwayDigest();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    autonomy.stop();

    const draftLine = feedPushes.find((p) => p.text.includes('drafted'));
    expect(draftLine).toBeDefined();
    // Should say "1 skill" not "1 skills"
    expect(draftLine?.text).toMatch(/1 skill[^s]/u);
  });

  test('stub returning 0 appends no skill-draft feed line', async () => {
    const { options, feedPushes } = makeOptions({
      onAwayDigest: () => 0,
    });
    const autonomy = createAutonomySurfacing(options);
    autonomy.announceAwayDigest();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    autonomy.stop();

    const draftLine = feedPushes.find((p) => p.text.includes('drafted') && p.text.includes('skill'));
    expect(draftLine).toBeUndefined();
  });

  test('omitting onAwayDigest appends no skill-draft feed line', async () => {
    const { options, feedPushes } = makeOptions();
    // No onAwayDigest provided
    const autonomy = createAutonomySurfacing(options);
    autonomy.announceAwayDigest();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    autonomy.stop();

    const draftLine = feedPushes.find((p) => p.text.includes('drafted') && p.text.includes('skill'));
    expect(draftLine).toBeUndefined();
  });

  test('throwing onAwayDigest does not propagate error (silent catch)', async () => {
    const { options, feedPushes } = makeOptions({
      onAwayDigest: () => { throw new Error('proposer exploded'); },
    });
    const autonomy = createAutonomySurfacing(options);
    // Should not throw
    expect(() => autonomy.announceAwayDigest()).not.toThrow();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    autonomy.stop();

    const draftLine = feedPushes.find((p) => p.text.includes('drafted'));
    expect(draftLine).toBeUndefined();
  });
});
