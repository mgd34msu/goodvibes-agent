import { describe, expect, test } from 'bun:test';
import type { CommandContext } from '../../input/command-registry.ts';
import { handleSessionWorkflowCommand } from '../../input/commands/session-workflow.ts';

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
});
