export type KeyEvent =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'enter' }
  | { readonly type: 'backspace' }
  | { readonly type: 'ctrl-c' }
  | { readonly type: 'escape' };

export function decodeKey(buffer: Buffer): KeyEvent | null {
  const value = buffer.toString('utf-8');
  if (value === '\u0003') return { type: 'ctrl-c' };
  if (value === '\r' || value === '\n') return { type: 'enter' };
  if (value === '\u007f' || value === '\b') return { type: 'backspace' };
  if (value === '\u001b') return { type: 'escape' };
  if (/^[\x20-\x7e]+$/.test(value)) return { type: 'text', value };
  return null;
}
