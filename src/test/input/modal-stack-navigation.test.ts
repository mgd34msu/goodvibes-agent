import { describe, expect, test } from 'bun:test';
import { handleLiveTailToken, handleProcessModalToken } from '../../input/handler-picker-routes.ts';
import type { ProcessEntry } from '../../renderer/process-modal.ts';

function key(logicalName: string) {
  return { type: 'key' as const, name: logicalName, logicalName, ctrl: false, shift: false, meta: false };
}

describe('modal stack navigation', () => {
  test('process modal preserves previous modal stack entry when opening agent detail', () => {
    const modalStack: string[] = ['process'];
    let selectedId: string | undefined;
    const selectedEntry: ProcessEntry = {
      id: 'agent-1',
      label: 'Agent 1',
      type: 'agent',
      status: 'running',
      elapsedMs: 1000,
    };
    const state = {
      processModal: {
        active: true,
        moveUp: () => {},
        moveDown: () => {},
        getSelected: () => selectedEntry,
        close: () => { state.processModal.active = false; },
        open: () => { state.processModal.active = true; },
        killSelected: () => false,
        refresh: () => {},
      },
      liveTailModal: {
        open: () => {},
      },
      agentDetailModal: {
        open: (id: string) => { selectedId = id; },
      },
      modalOpened: (name: string) => { modalStack.push(name); },
      requestRender: () => {},
      handleEscape: () => {},
    };

    const handled = handleProcessModalToken(state, key('enter'));

    expect(handled).toBe(true);
    expect(modalStack).toEqual(['process', 'agentDetail']);
    expect(state.processModal.active).toBe(false);
    expect(selectedId).toBe('agent-1');
  });

  test('live tail stop-and-return unwinds through escape only after a stopped exec', () => {
    let killCount = 0;
    let escapeCount = 0;
    const state = {
      liveTailModal: {
        active: true,
        scrollUp: () => {},
        scrollDown: () => {},
        killProcess: () => {
          killCount += 1;
          return true;
        },
        close: () => {},
      },
      processModal: {
        open: () => {},
      },
      requestRender: () => {},
      handleEscape: () => { escapeCount += 1; },
    };

    const handled = handleLiveTailToken(state, { type: 'text', value: 'k' });

    expect(handled).toBe(true);
    expect(killCount).toBe(1);
    expect(escapeCount).toBe(1);
  });

  test('live tail stop shortcut stays open when cancellation is blocked', () => {
    let escapeCount = 0;
    const state = {
      liveTailModal: {
        active: true,
        scrollUp: () => {},
        scrollDown: () => {},
        killProcess: () => false,
        close: () => {},
      },
      processModal: {
        open: () => {},
      },
      requestRender: () => {},
      handleEscape: () => { escapeCount += 1; },
    };

    const handled = handleLiveTailToken(state, { type: 'text', value: 'k' });

    expect(handled).toBe(true);
    expect(escapeCount).toBe(0);
  });
});
