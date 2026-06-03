import { describe, expect, mock, test } from 'bun:test';
import { createResumeSessionHandler } from '../../runtime/bootstrap-hook-bridge.ts';
import { buildLocalReturnContextSummary } from '@/runtime/index.ts';

describe('bootstrap hook bridge session resume', () => {
  test('ignores saved panel state instead of reopening copied panels in Agent', async () => {
    const logs: string[] = [];
    const panelOpen = mock(() => {});
    const panelShow = mock(() => {});
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
      onSessionIdChanged: mock(() => {}),
      sharedSessionBroker: {
        reopenSession: mock(async () => {}),
      },
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
      panelManager: {
        open: panelOpen,
        show: panelShow,
      } as never,
      configManager: {
        get: (key: string) => key === 'behavior.returnContextMode' ? 'summary' : undefined,
        getCategory: () => ({}),
      } as never,
      providerRegistry: {} as never,
    });

    resume('saved-session');
    await Promise.resolve();

    expect(panelOpen).not.toHaveBeenCalled();
    expect(panelShow).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes('Resume: Open panels:'))).toBe(false);
    expect(logs).toContain('Resume: Saved panel state ignored: approval, tasks. Open the Agent workspace for current operator controls.');
  });
});
