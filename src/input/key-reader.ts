export type KeyEvent =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'enter' }
  | { readonly type: 'newline' }
  | { readonly type: 'backspace' }
  | { readonly type: 'delete' }
  | { readonly type: 'cursor-left' }
  | { readonly type: 'cursor-right' }
  | { readonly type: 'home' }
  | { readonly type: 'end' }
  | { readonly type: 'history-prev' }
  | { readonly type: 'history-next' }
  | { readonly type: 'clear-screen' }
  | { readonly type: 'clear-input' }
  | { readonly type: 'refresh-status' }
  | { readonly type: 'eof' }
  | { readonly type: 'ctrl-c' }
  | { readonly type: 'escape' };

export function decodeKey(buffer: Buffer): KeyEvent | null {
  return decodeKeys(buffer)[0] ?? null;
}

export function decodeKeys(buffer: Buffer): readonly KeyEvent[] {
  const value = buffer.toString('utf-8');
  if (value === '\u0003') return [{ type: 'ctrl-c' }];
  if (value === '\u0004') return [{ type: 'eof' }];
  if (value === '\u000a') return [{ type: 'newline' }];
  if (value === '\u000c') return [{ type: 'clear-screen' }];
  if (value === '\u0012') return [{ type: 'refresh-status' }];
  if (value === '\u0015') return [{ type: 'clear-input' }];
  if (value === '\r' || value === '\n') return [{ type: 'enter' }];
  if (value === '\u007f' || value === '\b') return [{ type: 'backspace' }];
  if (value === '\u001b[A') return [{ type: 'history-prev' }];
  if (value === '\u001b[B') return [{ type: 'history-next' }];
  if (value === '\u001b[D') return [{ type: 'cursor-left' }];
  if (value === '\u001b[C') return [{ type: 'cursor-right' }];
  if (value === '\u001b[H' || value === '\u001bOH' || value === '\u001b[1~' || value === '\u001b[7~') return [{ type: 'home' }];
  if (value === '\u001b[F' || value === '\u001bOF' || value === '\u001b[4~' || value === '\u001b[8~') return [{ type: 'end' }];
  if (value === '\u001b[3~') return [{ type: 'delete' }];
  if (value === '\u001b') return [{ type: 'escape' }];

  const paste = parseBracketedPaste(value);
  if (paste !== null) return [{ type: 'text', value: paste }];

  const events: KeyEvent[] = [];
  let text = '';
  const flushText = () => {
    if (text) {
      events.push({ type: 'text', value: text });
      text = '';
    }
  };

  const chars = [...value];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]!;
    if (char === '\u0003') {
      flushText();
      events.push({ type: 'ctrl-c' });
    } else if (char === '\u0004') {
      flushText();
      events.push({ type: 'eof' });
    } else if (char === '\u000a') {
      flushText();
      events.push({ type: 'newline' });
    } else if (char === '\r') {
      flushText();
      events.push({ type: 'enter' });
    } else if (char === '\u0012') {
      flushText();
      events.push({ type: 'refresh-status' });
    } else if (char === '\u007f' || char === '\b') {
      flushText();
      events.push({ type: 'backspace' });
    } else if (char === '\u001b') {
      flushText();
      const next = chars[index + 1];
      const final = chars[index + 2];
      if (next === '[' && final === 'A') {
        events.push({ type: 'history-prev' });
        index += 2;
      } else if (next === '[' && final === 'B') {
        events.push({ type: 'history-next' });
        index += 2;
      } else if (next === '[' && final === 'D') {
        events.push({ type: 'cursor-left' });
        index += 2;
      } else if (next === '[' && final === 'C') {
        events.push({ type: 'cursor-right' });
        index += 2;
      } else if (next === '[' && final === 'H') {
        events.push({ type: 'home' });
        index += 2;
      } else if (next === '[' && final === 'F') {
        events.push({ type: 'end' });
        index += 2;
      } else if (next === 'O' && final === 'H') {
        events.push({ type: 'home' });
        index += 2;
      } else if (next === 'O' && final === 'F') {
        events.push({ type: 'end' });
        index += 2;
      } else if (next === '[' && chars[index + 3] === '~') {
        const event = tildeEscapeEvent(final);
        if (event) events.push(event);
        index += 3;
      } else {
        index += consumeEscapeSequence(chars.slice(index));
      }
    } else if (isPrintableCharacter(char)) {
      text += char;
    }
  }
  flushText();
  return events;
}

function tildeEscapeEvent(value: string | undefined): KeyEvent | null {
  switch (value) {
    case '1':
    case '7':
      return { type: 'home' };
    case '4':
    case '8':
      return { type: 'end' };
    case '3':
      return { type: 'delete' };
    default:
      return null;
  }
}

function parseBracketedPaste(value: string): string | null {
  const prefix = '\u001b[200~';
  const suffix = '\u001b[201~';
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return null;
  return value.slice(prefix.length, -suffix.length).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function isPrintableCharacter(char: string): boolean {
  const code = char.codePointAt(0);
  if (code === undefined) return false;
  if (code < 0x20 || code === 0x7f) return false;
  if (code >= 0x80 && code <= 0x9f) return false;
  return true;
}

function consumeEscapeSequence(chars: readonly string[]): number {
  if (chars.length <= 1) return 0;
  if (chars[1] === '[') {
    for (let index = 2; index < chars.length; index += 1) {
      const code = chars[index]?.codePointAt(0) ?? 0;
      if (code >= 0x40 && code <= 0x7e) return index;
    }
    return chars.length - 1;
  }
  if (chars[1] === ']') {
    for (let index = 2; index < chars.length; index += 1) {
      if (chars[index] === '\u0007') return index;
      if (chars[index] === '\u001b' && chars[index + 1] === '\\') return index + 1;
    }
    return chars.length - 1;
  }
  return 0;
}
