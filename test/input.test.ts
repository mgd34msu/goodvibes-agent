import { describe, expect, test } from 'bun:test';
import { decodeKeys } from '../src/input/key-reader.js';

describe('terminal key decoding', () => {
  test('keeps the first printable input event', () => {
    expect(decodeKeys(Buffer.from('h'))).toEqual([{ type: 'text', value: 'h' }]);
  });

  test('keeps printable Unicode input', () => {
    expect(decodeKeys(Buffer.from('é'))).toEqual([{ type: 'text', value: 'é' }]);
    expect(decodeKeys(Buffer.from('こんにちは'))).toEqual([{ type: 'text', value: 'こんにちは' }]);
    expect(decodeKeys(Buffer.from('🙂'))).toEqual([{ type: 'text', value: '🙂' }]);
  });

  test('keeps mixed ASCII and Unicode input', () => {
    expect(decodeKeys(Buffer.from('hello é こんにちは'))).toEqual([
      { type: 'text', value: 'hello é こんにちは' },
    ]);
  });

  test('decodes history navigation', () => {
    expect(decodeKeys(Buffer.from('\u001b[A'))).toEqual([{ type: 'history-prev' }]);
    expect(decodeKeys(Buffer.from('\u001b[B'))).toEqual([{ type: 'history-next' }]);
  });

  test('filters unsupported escape sequences instead of leaking control bytes', () => {
    expect(decodeKeys(Buffer.from('\u001b[C'))).toEqual([]);
  });

  test('keeps bracketed paste as one text event', () => {
    expect(decodeKeys(Buffer.from('\u001b[200~hello\nworld\u001b[201~'))).toEqual([
      { type: 'text', value: 'hello\nworld' },
    ]);
  });

  test('distinguishes submit from multiline input', () => {
    expect(decodeKeys(Buffer.from('\r'))).toEqual([{ type: 'enter' }]);
    expect(decodeKeys(Buffer.from('\n'))).toEqual([{ type: 'newline' }]);
  });
});
