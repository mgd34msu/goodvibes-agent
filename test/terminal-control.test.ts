import { describe, expect, test } from 'bun:test';
import {
  ALT_SCREEN_ENTER,
  ALT_SCREEN_EXIT,
  CURSOR_HIDE,
  CURSOR_SHOW,
  KEYBOARD_EXT_DISABLE,
  KEYBOARD_EXT_ENABLE,
  MOUSE_DISABLE,
  MOUSE_ENABLE,
  PASTE_DISABLE,
  PASTE_ENABLE,
  terminalEnterSequence,
  terminalExitSequence,
} from '../src/tui/terminal-control.ts';

describe('terminal control sequences', () => {
  test('setup enables the TUI terminal modes used by GoodVibes TUI', () => {
    const sequence = terminalEnterSequence();

    expect(sequence).toContain(ALT_SCREEN_ENTER);
    expect(sequence).toContain(CURSOR_HIDE);
    expect(sequence).toContain(MOUSE_ENABLE);
    expect(sequence).toContain(KEYBOARD_EXT_ENABLE);
    expect(sequence).toContain(PASTE_ENABLE);
  });

  test('cleanup restores paste, keyboard, mouse, cursor, and alt screen state', () => {
    const sequence = terminalExitSequence();

    expect(sequence).toContain(PASTE_DISABLE);
    expect(sequence).toContain(KEYBOARD_EXT_DISABLE);
    expect(sequence).toContain(MOUSE_DISABLE);
    expect(sequence).toContain(CURSOR_SHOW);
    expect(sequence).toContain(ALT_SCREEN_EXIT);
  });
});
