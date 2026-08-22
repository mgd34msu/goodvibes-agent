/**
 * When no clipboard reader is installed, the composer says so and names the
 * package, it does not report an empty clipboard.
 *
 * On Linux an image has to be read out of the system clipboard by a helper
 * program, because the terminal only ever hands this process text. With no
 * such program installed every Ctrl+V produced nothing at all, which is
 * indistinguishable from a broken key.
 */
import { describe, expect, test } from 'bun:test';
import { missingClipboardReaderHint } from '../../utils/clipboard.ts';

const noTools = () => false;
const allTools = () => true;

describe('missingClipboardReaderHint', () => {
  test('a Wayland session with nothing installed is told to install wl-clipboard', () => {
    const hint = missingClipboardReaderHint({ platform: 'linux', wayland: true, has: noTools });
    expect(hint).toBeDefined();
    expect(hint).toContain('wl-clipboard');
    expect(hint).toContain('Wayland');
    // The exact command, so nobody has to go looking for it.
    expect(hint).toContain('sudo pacman -S wl-clipboard');
  });

  test('an X11 session with nothing installed is pointed at xclip', () => {
    const hint = missingClipboardReaderHint({ platform: 'linux', wayland: false, has: noTools });
    expect(hint).toContain('xclip');
    expect(hint).toContain('X11');
  });

  test('wl-paste alone is enough: no complaint', () => {
    const hint = missingClipboardReaderHint({
      platform: 'linux', wayland: true, has: tool => tool === 'wl-paste',
    });
    expect(hint).toBeUndefined();
  });

  test('xclip alone is enough: no complaint', () => {
    const hint = missingClipboardReaderHint({
      platform: 'linux', wayland: false, has: tool => tool === 'xclip',
    });
    expect(hint).toBeUndefined();
  });

  test('macOS reads the clipboard without an extra package, so there is no hint', () => {
    expect(missingClipboardReaderHint({ platform: 'darwin', has: noTools })).toBeUndefined();
  });

  test('the hint never blames the clipboard for being empty', () => {
    const hint = missingClipboardReaderHint({ platform: 'linux', wayland: true, has: noTools }) ?? '';
    expect(hint.toLowerCase()).not.toContain('does not contain');
    expect(hint.toLowerCase()).not.toContain('empty');
  });

  test('this machine, as it actually is, reports whatever it truly has', () => {
    // Not asserting a value: asserting the real check runs and returns a shape.
    const hint = missingClipboardReaderHint();
    expect(hint === undefined || typeof hint === 'string').toBe(true);
    expect(missingClipboardReaderHint({ has: allTools })).toBeUndefined();
  });
});
