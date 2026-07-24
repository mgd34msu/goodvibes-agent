import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createResumeSessionHandler } from '../../runtime/bootstrap-hook-bridge.ts';
import { buildLocalReturnContextSummary, createSessionSurface, readLastSessionPointer, writeLastSessionPointer } from '@/runtime/index.ts';
import type { SharedSessionRecord } from '@pellux/goodvibes-sdk/platform/control-plane';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

describe('bootstrap hook bridge session resume', () => {
  test('stays independent from panel manager restore paths', () => {
    const source = readFileSync(join(import.meta.dir, '../../runtime/bootstrap-hook-bridge.ts'), 'utf-8');

    expect(source).not.toContain('PanelManager');
    expect(source).not.toContain('panelManager');
  });

  test('session resume command names saved panel state as ignored, not reopened', () => {
    const source = readFileSync(join(import.meta.dir, '../../input/commands/session-workflow.ts'), 'utf-8');

    expect(source).toContain('printIgnoredPanelsFromReturnContext');
    expect(source).toContain('Saved panel state ignored');
    expect(source).not.toContain('reopenPanelsFromReturnContext');
    expect(source).not.toContain('Reopened panels');
  });

  test('ignores saved panel state instead of reopening copied panels in Agent', async () => {
    const logs: string[] = [];
    const returnContext = buildLocalReturnContextSummary([
      { role: 'user', content: 'Review my pending work.' },
      { role: 'assistant', content: 'You have approvals waiting.' },
    ], {
      openPanels: ['approval', 'tasks'],
      pendingApprovals: 1,
    });
    const resume = createResumeSessionHandler({
      runtimeBus: { emit: () => {} } as never,
      runtime: {
        sessionId: 'current-session',
        model: 'gpt-5.4',
        provider: 'openai',
      } as never,
      conversation: {
        fromJSON: mock(() => {}),
        log: mock((message: string) => { logs.push(message); }),
      } as never,
      requestRender: mock(() => {}),
      onSessionIdChanged: mock((_sessionId: string) => null as SharedSessionRecord | null) as never,
      sharedSessionBroker: {
        reopenSession: mock(async () => null as SharedSessionRecord | null),
      },
      sessionSpineClient: {
        reopen: mock(() => {}),
      },
      projectRoot: '/project',
      writeLastSessionPointer: mock(() => {}),
      hookDispatcher: {
        fire: mock(async () => {}),
      } as never,
      sessionManager: {
        load: mock(() => ({
          messages: [
            { role: 'user', content: 'Review my pending work.' },
            { role: 'assistant', content: 'You have approvals waiting.' },
          ],
          meta: {
            title: 'Pending work',
            titleSource: 'manual',
            model: 'gpt-5.4',
            provider: 'openai',
            returnContext,
          },
        })),
      } as never,
      configManager: {
        get: (key: string) => key === 'behavior.returnContextMode' ? 'summary' : undefined,
        getCategory: () => ({}),
      } as never,
      providerRegistry: {} as never,
    });

    resume('saved-session');
    await Promise.resolve();

    expect(logs.filter((line) => line.includes('Resume: Open panels:'))).toEqual([]);
    expect(logs).toContain('Resume: Saved panel state ignored: approval, tasks. Open the Agent workspace for current operator controls.');
  });

  // Regression test for the arity-bug class: bootstrap.ts used to hand
  // createResumeSessionHandler the raw, two-argument SDK `writeLastSessionPointer`
  // reference directly. That reference is structurally assignable to the
  // `(sessionId: string) => void` slot this handler declares (a function with
  // an extra optional parameter satisfies a caller expecting fewer), so it
  // compiled fine — but `resume()` below calls `options.writeLastSessionPointer(sessionId)`
  // with exactly one argument, so `options` came through `undefined` on every
  // resume. writeLastSessionPointer's own try/catch swallows the resulting
  // "requires an explicit workingDirectory" failure into a logged warning, so
  // the pointer file was silently never written after a resume — the same bug
  // class that broke the TUI's resume journey. The fix is a surface-bound
  // closure (bootstrap.ts's `writeLastSessionPointerForSurface`); this test
  // exercises that exact shape end to end and proves the pointer lands on disk.
  test('a surface-bound writeLastSessionPointer closure actually persists the pointer file after resume', async () => {
    const workingDirectory = makeProjectTempDir('gv-resume-pointer-work');
    const homeDirectory = makeProjectTempDir('gv-resume-pointer-home');
    const surface = createSessionSurface({ surfaceRoot: 'agent', workingDirectory, homeDirectory });

    // Mirrors bootstrap.ts's writeLastSessionPointerForSurface exactly: bound
    // to the surface, invoked here with the SAME one-argument call the real
    // resumeSession handler makes.
    const writeLastSessionPointerForSurface = (sessionId: string): void =>
      writeLastSessionPointer(sessionId, { surface });

    const resume = createResumeSessionHandler({
      runtimeBus: { emit: () => {} } as never,
      runtime: {
        sessionId: 'current-session',
        model: 'gpt-5.4',
        provider: 'openai',
      } as never,
      conversation: {
        fromJSON: mock(() => {}),
        log: mock(() => {}),
      } as never,
      requestRender: mock(() => {}),
      onSessionIdChanged: mock((_sessionId: string) => null as SharedSessionRecord | null) as never,
      sharedSessionBroker: {
        reopenSession: mock(async () => null as SharedSessionRecord | null),
      },
      sessionSpineClient: {
        reopen: mock(() => {}),
      },
      projectRoot: workingDirectory,
      writeLastSessionPointer: writeLastSessionPointerForSurface,
      hookDispatcher: {
        fire: mock(async () => {}),
      } as never,
      sessionManager: {
        load: mock(() => ({
          messages: [{ role: 'user', content: 'hello' }],
          meta: { title: 'Resumed', model: 'gpt-5.4', provider: 'openai' },
        })),
      } as never,
      configManager: {
        get: () => undefined,
        getCategory: () => ({}),
      } as never,
      providerRegistry: {} as never,
    });

    // Before resume: no pointer on disk yet.
    expect(readLastSessionPointer({ surface })).toBeNull();

    resume('resumed-session-id');
    await Promise.resolve();

    // After resume: the pointer file genuinely exists on disk and names the
    // resumed session — not just an in-memory claim.
    expect(readLastSessionPointer({ surface })).toBe('resumed-session-id');
    const raw = JSON.parse(readFileSync(surface.lastSessionPointer, 'utf-8')) as { sessionId: string };
    expect(raw.sessionId).toBe('resumed-session-id');
  });
});
