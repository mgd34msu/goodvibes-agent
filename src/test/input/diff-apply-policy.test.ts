import { describe, expect, mock, test } from 'bun:test';
import { handleBlockSave, handleDiffApply } from '../../input/handler-content-actions.ts';
import type { CommandContext } from '../../input/command-registry.ts';
import type { ConversationManager } from '../../core/conversation.ts';
import type { BookmarkManager } from '@pellux/goodvibes-sdk/platform/bookmarks';

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

describe('block save Agent policy', () => {
  test('blocks implicit Ctrl-S file writes and does not call saveToFile', () => {
    const logged: string[] = [];
    const conversationManager = {
      getBlockContentAtLine: () => 'assistant block content',
      log: (message: string) => {
        logged.push(message);
      },
    } as unknown as ConversationManager;
    const saveToFile = mock(() => '/tmp/should-not-exist.md');
    const bookmarkManager = {
      toggle: () => true,
      isBookmarked: () => false,
      list: () => [],
      clear: () => {},
      saveToFile,
      listSavedFiles: () => [],
      loadSavedFile: () => null,
    } as unknown as BookmarkManager;
    const requestRender = mock(() => {});

    handleBlockSave(conversationManager, () => 0, requestRender, bookmarkManager);

    expect(saveToFile).toHaveBeenCalledTimes(0);
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(logged.join('\n')).toContain('Block save blocked in GoodVibes Agent');
    expect(logged.join('\n')).toContain('/share <html|json|md> <path> --yes');
  });
});
