import { type Line } from '../types/grid.ts';
import { UIFactory } from './ui-factory.ts';
import { getDisplayWidth } from '../utils/terminal-width.ts';
import { GLYPHS } from './ui-primitives.ts';

/** Truncate a string to fit within maxWidth display columns. */
function truncateToWidth(text: string, maxWidth: number): string {
  let width = 0;
  let i = 0;
  for (const char of text) {
    const cw = getDisplayWidth(char);
    if (width + cw > maxWidth) break;
    width += cw;
    i += char.length;
  }
  return text.slice(0, i);
}

/**
 * Shows a one-line summary of the current operator turn below the input area.
 */
export function renderProcessIndicator(
  width: number,
  activeTurnCount: number,
  toolCount: number,
  focused: boolean = false,
  activeTurnProgress?: string,
): Line[] {
  const total = activeTurnCount + toolCount;
  const renderPlainStatus = (text: string, style: { fg: string; bold?: boolean; dim?: boolean }): Line[] => (
    [UIFactory.stringToLine(`   ${text}`, width, style)]
  );
  const renderFocusedStatus = (text: string): Line[] => {
    const bg = '#31506f';
    const fg = '#eefaff';
    const markerFg = '#7dd3fc';
    const line = UIFactory.stringToLine(' '.repeat(width), width, { fg: '238' });
    const prefix = `${GLYPHS.navigation.selected} `;
    const body = truncateToWidth(text, Math.max(0, width - 8));
    const highlighted = ` ${prefix}${body} `;
    const startX = 2;
    for (let i = 0; i < highlighted.length && startX + i < width - 2; i++) {
      const ch = highlighted[i]!;
      const isMarker = i < prefix.length + 1;
      const cell = line[startX + i];
      if (!cell) continue;
      cell.char = ch;
      cell.fg = isMarker ? markerFg : fg;
      cell.bg = bg;
      cell.bold = true;
      cell.dim = false;
    }
    return [line];
  };

  // --- Focused state: always render before idle/active branches ---
  if (focused) {
    const parts: string[] = [];
    if (activeTurnCount > 0) parts.push(`${activeTurnCount} operator turn${activeTurnCount !== 1 ? 's' : ''}`);
    if (toolCount > 0) parts.push(`${toolCount} tool${toolCount !== 1 ? 's' : ''} running`);
    const label = total === 0
      ? `No active operator turn  ${GLYPHS.status.pending}  back to input`
      : `${parts.join(` ${GLYPHS.navigation.pipeSeparator} `)}  ${GLYPHS.status.pending}  Enter to open  ${GLYPHS.status.pending}  back to input`;
    return renderFocusedStatus(label);
  }

  if (total === 0) {
    return renderPlainStatus('No active operator turn', { fg: '238', dim: true });
  }

  const parts: string[] = [];
  if (activeTurnCount > 0) {
    parts.push(`${activeTurnCount} operator turn${activeTurnCount !== 1 ? 's' : ''}`);
  }
  if (toolCount > 0) {
    parts.push(`${toolCount} tool${toolCount !== 1 ? 's' : ''} running`);
  }
  const PROGRESS_RESERVED_CHARS = 43;
  const progressMaxLen = Math.max(0, width - PROGRESS_RESERVED_CHARS);
  const progressSuffix = activeTurnProgress && progressMaxLen > 10
    ? ` | ${activeTurnProgress.length > progressMaxLen ? activeTurnProgress.slice(0, Math.max(0, progressMaxLen - 3)) + '...' : activeTurnProgress}`
    : '';
  const label = `${parts.join(` ${GLYPHS.navigation.pipeSeparator} `)}${progressSuffix}`;
  const hint = `  ${GLYPHS.status.pending}  Enter to view`;
  return renderPlainStatus(`${label}${hint}`, { fg: '#00ffff', bold: true });
}
