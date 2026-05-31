import { describe, expect, mock, test } from 'bun:test';
import { handleDiffApply } from '../../input/handler-content-actions.ts';
import type { CommandContext } from '../../input/command-registry.ts';
import type { ConversationManager } from '../../core/conversation.ts';

describe('diff apply Agent policy', () => {
  test('blocks inline file edits and does not request permission', () => {
    const logged: string[] = [];
    const conversationManager = {
      getDiffAtLine: () => ({
        filePath: 'src/app.ts',
        original: 'old',
        updated: 'new',
      }),
      log: (message: string) => {
        logged.push(message);
      },
    } as unknown as ConversationManager;
    const requestPermission = mock(async () => ({ approved: true }));
    const requestRender = mock(() => {});
    const handled = handleDiffApply(
      conversationManager,
      () => 0,
      { requestPermission } as unknown as CommandContext,
      requestRender,
      () => 'diff-apply-test',
      'write',
    );

    expect(handled).toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(0);
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(logged.join('\n')).toContain('Diff apply blocked in GoodVibes Agent');
    expect(logged.join('\n')).toContain('/delegate <task>');
  });
});
