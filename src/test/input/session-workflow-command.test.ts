import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { SessionManager } from '@pellux/goodvibes-sdk/platform/sessions';
import type { CommandContext } from '../../input/command-registry.ts';
import { handleSessionWorkflowCommand } from '../../input/commands/session-workflow.ts';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

/** Reads a saved session's meta line straight off disk (no in-memory cache) — the raw-disk proof that saveSource was actually persisted. */
function readMetaRaw(filePath: string): Record<string, unknown> {
  const raw = readFileSync(filePath, 'utf-8');
  const firstLine = raw.split('\n')[0]!;
  return JSON.parse(firstLine) as Record<string, unknown>;
}

function makeRealSessionManagerContext(overrides: {
  sessionId?: string;
  title?: string;
  writeLastSessionPointerCalls?: string[];
} = {}): { ctx: CommandContext; tmpDir: string; sm: SessionManager } {
  const tmpDir = makeProjectTempDir('gv-session-workflow-saveSource');
  const sm = new SessionManager(tmpDir, { surfaceRoot: 'agent' });
  const writeLastSessionPointerCalls = overrides.writeLastSessionPointerCalls ?? [];
  const ctx = {
    session: {
      runtime: {
        sessionId: overrides.sessionId ?? 'active-session',
        model: 'gpt-5.4',
        provider: 'openai',
      },
      conversationManager: {
        getMessageCount: () => 1,
        title: overrides.title ?? 'My Session',
        getMessageSnapshot: () => [{ role: 'user', content: 'hello' }],
        getTitleSource: () => 'user',
        resetAll: () => {},
        fromJSON: () => {},
        rebuildHistory: () => {},
      },
      sessionManager: sm,
      writeLastSessionPointer: (sessionId: string) => { writeLastSessionPointerCalls.push(sessionId); },
    },
    provider: {},
    workspace: {},
    platform: {
      configManager: { get: () => 'off' },
    },
    ops: {},
    extensions: {},
    clients: {
      providerApi: {
        selectModel: async () => { throw new Error('no model configured in test'); },
      },
    },
    renderRequest: () => {},
    print: () => {},
    exit: () => {},
  } as unknown as CommandContext;
  return { ctx, tmpDir, sm };
}

function makeSessionInfoContext(out: string[]): CommandContext {
  return {
    session: {
      runtime: {
        sessionId: 'active-session',
        model: 'gpt-5.4',
        provider: 'openai',
      },
      conversationManager: {
        getMessageCount: () => 0,
        title: '',
      },
      sessionManager: {
        list: () => [{
          name: 'saved-review',
          title: 'Saved Review',
          titleSource: 'system',
          model: 'gpt-5.4',
          provider: 'openai',
          timestamp: Date.parse('2026-06-02T12:00:00Z'),
          messageCount: 4,
          filePath: '/tmp/saved-review.jsonl',
          returnContext: {
            activityLabel: 'assistant replied',
            statusLabel: 'ready for next turn',
            pendingApprovals: 1,
            toolCallCount: 0,
            toolResultCount: 0,
            assistantTurnCount: 1,
            userTurnCount: 1,
            activeTasks: 0,
            blockedTasks: 0,
            openPanels: ['approval', 'tasks'],
            lines: [
              'Activity: assistant replied',
              'Status: ready for next turn',
              'Open panels: approval, tasks',
            ],
          },
        }],
      },
    },
    provider: {},
    workspace: {},
    platform: {},
    ops: {},
    extensions: {},
    renderRequest: () => {},
    print: (text: string) => { out.push(text); },
    exit: () => {},
  } as unknown as CommandContext;
}

describe('session workflow command', () => {
  test('info reports saved panel state as ignored instead of open panels', async () => {
    const out: string[] = [];

    const handled = await handleSessionWorkflowCommand(['info', 'saved-review'], makeSessionInfoContext(out));
    const text = out.join('\n');

    expect(handled).toBe(true);
    expect(text).toContain('Saved panel state ignored: approval, tasks');
    expect(text).not.toContain('Open panels: approval, tasks');
  });

  // ── saveSource: 'user' on every user-directed save path (raw-disk proof) ──
  describe('saveSource stamping — user-directed saves are never left "auto"', () => {
    test('/session save stamps saveSource: "user" on the file it writes', async () => {
      const { ctx, tmpDir, sm } = makeRealSessionManagerContext();
      try {
        const handled = await handleSessionWorkflowCommand(['save', 'my-saved-session'], ctx);
        expect(handled).toBe(true);

        const meta = sm.getMeta('my-saved-session');
        expect(meta?.saveSource).toBe('user');

        // Raw-disk proof: read the file directly, not through the manager.
        const filePath = `${tmpDir}/.goodvibes/agent/sessions/my-saved-session.jsonl`;
        expect(existsSync(filePath)).toBe(true);
        expect(readMetaRaw(filePath).saveSource).toBe('user');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('/session fork stamps saveSource: "user" on the forked file and re-homes the pointer', async () => {
      const writeLastSessionPointerCalls: string[] = [];
      const { ctx, tmpDir, sm } = makeRealSessionManagerContext({ sessionId: 'source-session', writeLastSessionPointerCalls });
      try {
        const handled = await handleSessionWorkflowCommand(['fork', 'my-fork'], ctx);
        expect(handled).toBe(true);

        const newId = ctx.session.runtime.sessionId;
        expect(newId).not.toBe('source-session');
        expect(newId.startsWith('user-')).toBe(true);

        const meta = sm.getMeta(newId);
        expect(meta?.saveSource).toBe('user');

        // Raw-disk proof.
        const filePath = `${tmpDir}/.goodvibes/agent/sessions/${newId}.jsonl`;
        expect(existsSync(filePath)).toBe(true);
        expect(readMetaRaw(filePath).saveSource).toBe('user');

        // Fork re-homes the live session — the pointer must follow it.
        expect(writeLastSessionPointerCalls).toEqual([newId]);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('/session rename backfills a save stamped saveSource: "user"', async () => {
      const { ctx, tmpDir, sm } = makeRealSessionManagerContext({ sessionId: 'unsaved-active-session' });
      try {
        expect(sm.getMeta('unsaved-active-session')).toBeNull();

        const handled = await handleSessionWorkflowCommand(['rename', 'Renamed Title'], ctx);
        expect(handled).toBe(true);

        const meta = sm.getMeta('unsaved-active-session');
        expect(meta?.saveSource).toBe('user');
        expect(meta?.title).toBe('Renamed Title');

        // Raw-disk proof.
        const filePath = `${tmpDir}/.goodvibes/agent/sessions/unsaved-active-session.jsonl`;
        expect(existsSync(filePath)).toBe(true);
        expect(readMetaRaw(filePath).saveSource).toBe('user');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // ── /session resume writes the last-session pointer (finding 2) ──────────
  describe('resume writes the last-session pointer through the surface-bound closure', () => {
    test('/session resume calls writeLastSessionPointer with the resumed session id', async () => {
      const writeLastSessionPointerCalls: string[] = [];
      const { ctx, tmpDir, sm } = makeRealSessionManagerContext({ sessionId: 'active-session', writeLastSessionPointerCalls });
      try {
        // Pre-save a session the user will resume into.
        sm.save('saved-target', [{ role: 'user', content: 'hi' }], {
          title: 'Saved Target',
          model: '',
          provider: '',
          timestamp: Date.now(),
          saveSource: 'user',
        });

        const handled = await handleSessionWorkflowCommand(['resume', 'saved-target'], ctx);
        expect(handled).toBe(true);
        expect(ctx.session.runtime.sessionId).toBe('saved-target');
        expect(writeLastSessionPointerCalls).toEqual(['saved-target']);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
