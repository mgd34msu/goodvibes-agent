import { describe, expect, test } from 'bun:test';
import {
  backspace,
  createInputBuffer,
  deleteForward,
  insertText,
  moveCursor,
  moveCursorEnd,
  moveCursorHome,
  setCursorEnd,
} from '../src/input/edit-buffer.js';

describe('input edit buffer', () => {
  test('inserts and deletes at the cursor', () => {
    let state = createInputBuffer('helo');
    state = moveCursor(state, -1);
    state = insertText(state, 'l');
    expect(state).toEqual({ text: 'hello', cursor: 4 });
    state = backspace(state);
    expect(state).toEqual({ text: 'helo', cursor: 3 });
    state = deleteForward(state);
    expect(state).toEqual({ text: 'hel', cursor: 3 });
  });

  test('does not split printable Unicode while editing', () => {
    let state = createInputBuffer('a🙂c');
    state = moveCursor(state, -1);
    state = insertText(state, 'é');
    expect(state).toEqual({ text: 'a🙂éc', cursor: 3 });
    state = backspace(state);
    expect(state).toEqual({ text: 'a🙂c', cursor: 2 });
    state = deleteForward(state);
    expect(state).toEqual({ text: 'a🙂', cursor: 2 });
  });

  test('moves Home and End within the current line', () => {
    let state = setCursorEnd('one\ntwo\nthree');
    state = moveCursor(state, -2);
    expect(moveCursorHome(state).cursor).toBe(8);
    expect(moveCursorEnd(state).cursor).toBe(13);
  });
});
