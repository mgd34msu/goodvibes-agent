/**
 * header-line.ts, the one-row header.
 *
 *   col 1   GoodVibes Agent, bold, in the theme's brand -> brandEnd gradient
 *           (the theme's gradient, never the protected splash constant)
 *   then    the version (faint) and the session title (muted)
 *   right   the serving model, ending at width-2
 *
 * No rule row under it. The header is the one place for session identity:
 * title and model (the composer holds only input). The Agent shell never
 * surfaces git or worktree posture here (see scripts/check-architecture.ts):
 * build work belongs to delegated GoodVibes TUI sessions.
 */

import { type Line, createEmptyLine } from '@pellux/goodvibes-sdk/platform/types';
import { VERSION } from '../version.ts';
import { getDisplayWidth, interpolateColor, truncateDisplay } from '../utils/terminal-width.ts';
import { activeTokens } from './theme.ts';

const BRAND = 'GoodVibes Agent';
const BRAND_X = 1;
const GAP = 3;

interface Seg { readonly text: string; readonly fg: string; readonly bold?: boolean }

function put(line: Line, x: number, endX: number, seg: Seg): number {
  let cx = x;
  for (const ch of seg.text) {
    const w = getDisplayWidth(ch);
    if (w <= 0) continue;
    if (cx + w > endX) break;
    line[cx] = { char: ch, fg: seg.fg, bg: '', bold: seg.bold ?? false, dim: false, underline: false, italic: false, strikethrough: false };
    if (w === 2 && cx + 1 < line.length) line[cx + 1] = { ...line[cx]!, char: '' };
    cx += w;
  }
  return cx;
}

/**
 * Render the header row.
 *
 * @param width   - Terminal columns.
 * @param model   - Serving model id.
 * @param title   - Optional session title, truncated to fit.
 * @param version - Defaults to the live build VERSION; tests pin a fixture.
 */
export function renderHeaderLine(width: number, model: string, title?: string, version: string = VERSION): Line[] {
  const t = activeTokens();
  const line = createEmptyLine(width);
  for (const cell of line) cell.bg = '';
  const end = width - 1; // exclusive: the model ends at width-2
  const versionText = `v${version}`;

  // Right side first, so the title knows how much room it has.
  const leftMin = BRAND_X + getDisplayWidth(BRAND) + 1 + getDisplayWidth(versionText);
  const modelText = leftMin + GAP + getDisplayWidth(model) <= end ? model : truncateDisplay(model, Math.max(0, end - leftMin - GAP));
  const rightX = Math.max(leftMin + GAP, end - getDisplayWidth(modelText));

  // Wordmark, version, title.
  let x = BRAND_X;
  const letters = [...BRAND];
  letters.forEach((ch, i) => {
    x = put(line, x, end, { text: ch, fg: interpolateColor(t.brand, t.brandEnd, i / (letters.length - 1)), bold: true });
  });
  x = put(line, x + 1, end, { text: versionText, fg: t.textFaint });
  if (title) {
    const room = rightX - GAP - (x + 2);
    if (room >= 4) put(line, x + 2, rightX - GAP, { text: truncateDisplay(title, room), fg: t.textMuted });
  }
  put(line, rightX, end, { text: modelText, fg: t.text });
  return [line];
}
