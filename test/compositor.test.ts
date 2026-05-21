import { describe, expect, test } from 'bun:test';
import { Compositor } from '../src/renderer/compositor.ts';
import { UIFactory } from '../src/renderer/ui-factory.ts';

describe('compositor', () => {
  test('diff-renders only changed frames through the terminal buffer path', () => {
    const out = new FakeWriteStream();
    const compositor = new Compositor(out.asWriteStream());
    const frame = {
      width: 20,
      height: 6,
      header: [UIFactory.stringToLine('header', 20)],
      viewport: [UIFactory.stringToLine('body', 20)],
      footer: [UIFactory.stringToLine('footer', 20)],
    };

    compositor.composite(frame);
    const firstWrite = out.output;
    compositor.composite(frame);
    const secondWrite = out.output.slice(firstWrite.length);
    compositor.composite({
      ...frame,
      viewport: [UIFactory.stringToLine('changed', 20)],
    });
    const thirdWrite = out.output.slice(firstWrite.length + secondWrite.length);

    expect(firstWrite.length).toBeGreaterThan(0);
    expect(secondWrite).toBe('');
    expect(thirdWrite).toContain('c');
    expect(thirdWrite).toContain('h');
    expect(thirdWrite).toContain('g');
  });
});

class FakeWriteStream {
  output = '';

  asWriteStream(): NodeJS.WriteStream {
    return {
      write: (chunk: string | Uint8Array): boolean => {
        this.output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
        return true;
      },
    } as NodeJS.WriteStream;
  }
}
