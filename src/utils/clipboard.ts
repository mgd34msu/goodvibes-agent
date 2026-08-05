import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { allowTerminalWrite } from '@pellux/goodvibes-terminal-shell';

/**
 * copyToClipboard - Uses OSC 52 escape sequence to copy text to the terminal clipboard.
 * Terminal-specific: only works in terminals that support OSC 52.
 */
export function copyToClipboard(text: string) {
  if (!text) return;
  logger.info('Clipboard: Attempting to copy via OSC 52', { length: text.length });
  try {
    const base64 = Buffer.from(text).toString('base64');
    const sequence = `\x1b]52;c;${base64}\x07`;
    allowTerminalWrite(() => process.stdout.write(sequence));
    logger.info('Clipboard: OSC 52 sequence written');
  } catch (err: unknown) {
    logger.error('Clipboard: OSC 52 copy failed', { error: summarizeError(err) });
  }
}

export { pasteFromClipboard, pasteImageFromClipboard, MIN_IMAGE_BYTES } from '@pellux/goodvibes-sdk/platform/utils';

/**
 * missingClipboardReaderHint - Why the clipboard could not be read, in words a
 * person can act on, or undefined when the tooling to read it is present.
 *
 * The terminal cannot hand this program an image. Bracketed paste and OSC 52
 * carry text only, so a pasted image has to be read from the system clipboard
 * directly, and on Linux that needs a helper program. When it is absent, every
 * paste silently produced nothing — which is indistinguishable from a broken
 * key. Naming the package is the difference between a dead keystroke and a
 * one-line fix.
 *
 * The same detector now lives beside the clipboard readers in the SDK
 * (platform/utils/clipboard.ts) so the TUI and web UI get it too; this copy
 * collapses into a re-export when the agent's pinned SDK version catches up.
 */
export function missingClipboardReaderHint(
  env: { readonly platform?: string; readonly wayland?: boolean; readonly has?: (tool: string) => boolean } = {},
): string | undefined {
  const platform = env.platform ?? process.platform;
  if (platform !== 'linux') return undefined;
  const has = env.has ?? ((tool: string): boolean => {
    try {
      return Bun.which(tool) !== null;
    } catch {
      return false;
    }
  });
  if (has('wl-paste') || has('xclip')) return undefined;
  const wayland = env.wayland ?? Boolean(process.env['WAYLAND_DISPLAY']);
  const preferred = wayland
    ? 'wl-clipboard (this session is Wayland)'
    : 'xclip (this session is X11)';
  return (
    `No clipboard reader is installed, so images cannot be read from the clipboard. `
    + `Install ${preferred} — for example "sudo pacman -S wl-clipboard" on Arch or `
    + `"sudo apt install wl-clipboard" on Debian and Ubuntu. Use xclip instead if you run X11.`
  );
}
