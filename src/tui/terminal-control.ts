export const ALT_SCREEN_ENTER = '\x1b[?1049h';
export const ALT_SCREEN_EXIT = '\x1b[?1049l';
export const MOUSE_ENABLE = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
export const MOUSE_DISABLE = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';
export const CURSOR_HIDE = '\x1b[?25l';
export const CURSOR_SHOW = '\x1b[?25h';
export const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H';
export const KEYBOARD_EXT_ENABLE = '\x1b[>4;2m\x1b[?1u';
export const KEYBOARD_EXT_DISABLE = '\x1b[>4;0m\x1b[?1l';
export const PASTE_ENABLE = '\x1b[?2004h';
export const PASTE_DISABLE = '\x1b[?2004l';

export function terminalEnterSequence(): string {
  return ALT_SCREEN_ENTER + CLEAR_SCREEN + CURSOR_HIDE + MOUSE_ENABLE + KEYBOARD_EXT_ENABLE + PASTE_ENABLE;
}

export function terminalExitSequence(): string {
  return PASTE_DISABLE + KEYBOARD_EXT_DISABLE + MOUSE_DISABLE + CURSOR_SHOW + CLEAR_SCREEN + ALT_SCREEN_EXIT;
}
