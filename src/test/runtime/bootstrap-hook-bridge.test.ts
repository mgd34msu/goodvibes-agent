import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createResumeSessionHandler } from '../../runtime/bootstrap-hook-bridge.ts';
import { buildLocalReturnContextSummary } from '@/runtime/index.ts';
import type { SharedSessionRecord } from '@pellux/goodvibes-sdk/platform/control-plane';

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
});
