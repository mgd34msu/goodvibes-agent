import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SpillBackend } from '@pellux/goodvibes-sdk/platform/tools';
import { OverflowHandler } from '@pellux/goodvibes-sdk/platform/tools';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'overflow-test-'));
}

function makeString(length: number): string {
  return 'x'.repeat(length);
}

function withHandler(run: (ctx: { tmpDir: string; handler: OverflowHandler }) => void): void {
  const tmpDir = makeTmpDir();
  const handler = new OverflowHandler({ baseDir: tmpDir });
  run({ tmpDir, handler });
}

describe('OverflowHandler', () => {
  test('returns content unchanged when it does not overflow', () => withHandler(({ handler, tmpDir }) => {
    const content = makeString(50_000);
    const result = handler.handle(content);

    expect(result.content).toBe(content);
    expect(result.overflowRef).toBeUndefined();
    expect(existsSync(join(tmpDir, '.goodvibes', '.overflow'))).toBe(false);
  }));

  test('truncates over-limit content and returns a typed file ref when the backend provides one', () => withHandler(({ handler, tmpDir }) => {
    const content = makeString(60_000);
    const result = handler.handle(content, { label: 'my stdout' });

    // SDK 0.38.0 truncates as a head+tail preview (leading slice + trailing
    // slice with a middle "[... N chars omitted ...]" marker), not head-only,
    // so the reader keeps both the start and the end/error of long output.
    expect(result.content.startsWith('x')).toBe(true);
    expect(result.content).toMatch(/\[\.\.\. \d+ chars omitted \.\.\.\]/);
    expect(result.content.length).toBeLessThan(content.length);
    expect(result.content).toContain('[... truncated');

    if (result.overflowRef !== undefined) {
      expect(result.spillBackend).toBe('file');
      expect(result.overflowRef).toMatch(/^file:\.goodvibes\/\.overflow\/\d+-my-stdout\.txt$/);
      expect(result.content).toContain('.goodvibes/.overflow/');
    }
    expect(existsSync(join(tmpDir, '.goodvibes', '.overflow'))).toBe(true);
  }));

  test('supports custom maxChars and sanitized fallback labels', () => withHandler(({ handler }) => {
    const content = makeString(500);
    const custom = handler.handle(content, { maxChars: 100, label: 'My Tool OUTPUT!' });
    const fallback = handler.handle(makeString(60_000), { label: '' });

    expect(custom.content.length).toBeLessThan(content.length);
    // Head+tail preview (see above): starts with a head slice of the content
    // and carries the middle "omitted" marker rather than the full first 100.
    expect(custom.content.startsWith('x')).toBe(true);
    expect(custom.content).toMatch(/\[\.\.\. \d+ chars omitted \.\.\.\]/);
    if (custom.overflowRef !== undefined) {
      expect(custom.overflowRef).toMatch(/^file:\.goodvibes\/\.overflow\/\d+-my-tool-output\.txt$/);
    }
    if (fallback.overflowRef !== undefined) {
      expect(fallback.overflowRef).toMatch(/^file:\.goodvibes\/\.overflow\/\d+-.*\.txt$/);
    }
  }));

  test('creates distinct overflow refs across multiple calls when refs are available', () => withHandler(({ handler }) => {
    const content = makeString(60_000);
    const alpha = handler.handle(content, { label: 'alpha' });
    const beta = handler.handle(content, { label: 'beta' });

    expect(alpha.content).toContain('[... truncated');
    expect(beta.content).toContain('[... truncated');
    if (alpha.overflowRef !== undefined && beta.overflowRef !== undefined) {
      expect(alpha.overflowRef).not.toBe(beta.overflowRef);
      expect(alpha.overflowRef).toMatch(/alpha\.txt$/);
      expect(beta.overflowRef).toMatch(/beta\.txt$/);
    }
  }));

  test('never throws when file backend creation fails', () => {
    const failingBackend: SpillBackend = {
      type: 'file',
      write() { return null; },
      read() { return null; },
      cleanup() {},
      list() { return []; },
    };
    const handler = new OverflowHandler({ backend: failingBackend });

    let result: ReturnType<OverflowHandler['handle']> | undefined;
    expect(() => {
      result = handler.handle(makeString(60_000));
    }).not.toThrow();

    expect(result?.content).toContain('[... truncated');
    expect(result?.overflowRef).toBeUndefined();
  });

  test('requires an explicit baseDir for the file backend', () => {
    expect(() => new OverflowHandler()).toThrow('OverflowHandler requires an explicit baseDir when using the file spill backend');
  });
});
