export interface InputBufferState {
  readonly text: string;
  readonly cursor: number;
}

export function createInputBuffer(text = ''): InputBufferState {
  return { text, cursor: textLength(text) };
}

export function insertText(state: InputBufferState, value: string): InputBufferState {
  if (!value) return normalizeState(state);
  const chars = [...state.text];
  const cursor = clampCursor(state.cursor, chars.length);
  const next = [
    ...chars.slice(0, cursor),
    ...value,
    ...chars.slice(cursor),
  ];
  return { text: next.join(''), cursor: cursor + textLength(value) };
}

export function backspace(state: InputBufferState): InputBufferState {
  const chars = [...state.text];
  const cursor = clampCursor(state.cursor, chars.length);
  if (cursor === 0) return { text: state.text, cursor };
  return {
    text: [...chars.slice(0, cursor - 1), ...chars.slice(cursor)].join(''),
    cursor: cursor - 1,
  };
}

export function deleteForward(state: InputBufferState): InputBufferState {
  const chars = [...state.text];
  const cursor = clampCursor(state.cursor, chars.length);
  if (cursor >= chars.length) return { text: state.text, cursor };
  return {
    text: [...chars.slice(0, cursor), ...chars.slice(cursor + 1)].join(''),
    cursor,
  };
}

export function moveCursor(state: InputBufferState, offset: number): InputBufferState {
  const length = textLength(state.text);
  return { text: state.text, cursor: clampCursor(state.cursor + offset, length) };
}

export function moveCursorHome(state: InputBufferState): InputBufferState {
  const chars = [...state.text];
  const cursor = clampCursor(state.cursor, chars.length);
  for (let index = cursor - 1; index >= 0; index -= 1) {
    if (chars[index] === '\n') return { text: state.text, cursor: index + 1 };
  }
  return { text: state.text, cursor: 0 };
}

export function moveCursorEnd(state: InputBufferState): InputBufferState {
  const chars = [...state.text];
  const cursor = clampCursor(state.cursor, chars.length);
  for (let index = cursor; index < chars.length; index += 1) {
    if (chars[index] === '\n') return { text: state.text, cursor: index };
  }
  return { text: state.text, cursor: chars.length };
}

export function setCursorEnd(text: string): InputBufferState {
  return { text, cursor: textLength(text) };
}

export function textLength(value: string): number {
  return [...value].length;
}

function normalizeState(state: InputBufferState): InputBufferState {
  return { text: state.text, cursor: clampCursor(state.cursor, textLength(state.text)) };
}

function clampCursor(cursor: number, length: number): number {
  if (!Number.isFinite(cursor)) return length;
  return Math.min(Math.max(0, Math.trunc(cursor)), length);
}
