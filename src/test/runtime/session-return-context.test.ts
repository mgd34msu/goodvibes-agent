import { describe, expect, test } from 'bun:test';
import { buildLocalReturnContextSummary, formatReturnContextForDisplay } from '@/runtime/index.ts';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionManager } from '@pellux/goodvibes-sdk/platform/sessions';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

describe('runtime/session-return-context', () => {
  test('builds deterministic summary from message flow', () => {
    const summary = buildLocalReturnContextSummary([
      { role: 'user', content: 'Please inspect the failing build.' },
      { role: 'assistant', content: 'I am checking the repo.', toolCalls: [{ id: 'call-1', name: 'read_file', arguments: {} }] },
      { role: 'tool', callId: 'call-1', content: 'tsc failed in src/main.ts' },
      { role: 'assistant', content: 'The error is in src/main.ts.' },
    ], {
      pendingApprovals: 2,
      activeTasks: 3,
      blockedTasks: 1,
      remoteContracts: 2,
      remoteRunners: ['runner-a', 'runner-b'],
      worktreeCount: 1,
      worktreePaths: ['/tmp/wt-a'],
    });

    expect(summary.activityLabel).toBe('assistant replied');
    expect(summary.statusLabel).toBe('ready for next turn');
    expect(summary.userTurnCount).toBe(1);
    expect(summary.assistantTurnCount).toBe(2);
    expect(summary.toolCallCount).toBe(1);
    expect(summary.toolResultCount).toBe(1);
    expect(summary.pendingApprovals).toBe(2);
    expect(summary.activeTasks).toBe(3);
    expect(summary.remoteRunners).toEqual(['runner-a', 'runner-b']);
    expect(summary.worktreePaths).toEqual(['/tmp/wt-a']);
    expect(summary.lines.join('\n')).toContain('Tasks: active 3, blocked 1');
    expect(summary.lines.join('\n')).toContain('Remote runners: runner-a, runner-b');
    expect(summary.lines.join('\n')).toContain('Worktree paths: /tmp/wt-a');
    expect(summary).not.toHaveProperty('openPanels');
    expect(summary.lines.join('\n')).not.toContain('Open panels');
    expect(summary.lines[0]).toContain('Activity');
  });

  test('display formatting prepends assisted narrative when present', () => {
    const lines = formatReturnContextForDisplay({
      activityLabel: 'assistant replied',
      statusLabel: 'ready for next turn',
      pendingApprovals: 0,
      toolCallCount: 0,
      toolResultCount: 0,
      assistantTurnCount: 1,
      userTurnCount: 1,
      lines: ['Activity: assistant replied', 'Status: ready for next turn'],
      assistedNarrative: 'Look at the most recent assistant reply first.',
    });

    expect(lines[0]).toContain('Assist:');
    expect(lines[1]).toContain('Activity:');
  });

  test('a saved return context with a legacy open-panels list loads without it', () => {
    const dir = makeProjectTempDir('gv-return-context-legacy');
    try {
      const sessionsDir = join(dir, '.goodvibes', 'agent', 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, 'legacy.jsonl'), JSON.stringify({
        type: 'meta',
        schemaVersion: 1,
        timestamp: 1_700_000_000_000,
        title: 'Legacy',
        model: '',
        provider: '',
        titleSource: 'user',
        returnContext: {
          activityLabel: 'assistant replied',
          statusLabel: 'ready for next turn',
          pendingApprovals: 1,
          toolCallCount: 0,
          toolResultCount: 0,
          assistantTurnCount: 1,
          userTurnCount: 1,
          openPanels: ['remote', 'approval'],
          lines: ['Activity: assistant replied', 'Open panels: remote, approval', 'Status: ready for next turn'],
        },
      }) + '\n');

      const loaded = new SessionManager(dir, { surfaceRoot: 'agent' }).getMeta('legacy')?.returnContext;

      expect(loaded).toBeDefined();
      expect(loaded).not.toHaveProperty('openPanels');
      expect(loaded?.lines).toEqual(['Activity: assistant replied', 'Status: ready for next turn']);
      expect(formatReturnContextForDisplay(loaded!).join('\n')).not.toMatch(/panel/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
