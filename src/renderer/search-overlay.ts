import type { Line } from '@pellux/goodvibes-sdk/platform/types';
import { fitDisplay, getDisplayWidth, truncateDisplay } from '../utils/terminal-width.ts';
import type { SearchManager } from '../input/search.ts';
import { createBottomBarLine, writeBottomBarText } from '@pellux/goodvibes-terminal-shell';
import { activeTokens } from './theme.ts';

const SEARCH_OVERLAY_LABEL = ' Find: ';
const SEARCH_OVERLAY_NO_MATCHES = 'No matches';
const SEARCH_OVERLAY_COUNT_SUFFIX = 'up/down';
const SEARCH_OVERLAY_LOCKED_HINTS = '  [Up/Down] or [jk] navigate  [Bksp] edit  [Esc] close';
const SEARCH_OVERLAY_UNLOCKED_HINTS = '  [Enter/Tab] lock  [Esc] close';

function searchOverlayMatchCount(current: string | number, total: string | number): string {
  return `${current}/${total} ${SEARCH_OVERLAY_COUNT_SUFFIX}`;
}

export function renderSearchOverlayPackageText(): string {
  return [
    SEARCH_OVERLAY_LABEL.trim(),
    searchOverlayMatchCount('<current>', '<total>'),
    SEARCH_OVERLAY_NO_MATCHES,
    SEARCH_OVERLAY_LOCKED_HINTS.trim(),
    SEARCH_OVERLAY_UNLOCKED_HINTS.trim(),
  ].join('\n');
}

/**
 * Render the search bar as a single Line[] overlay at the bottom of the viewport.
 * Format: [ Find: <query>   3/17 up/down  [n] next [N] prev [Esc] close ]
 * The match count is dim grey; the rest of the bar is teal.
 */
export function renderSearchOverlay(
  manager: SearchManager,
  width: number
): Line[] {
  // Match count text, displayed in dim grey, right of query, left of hints
  const matchCount = manager.matches?.length > 0
    ? searchOverlayMatchCount(manager.currentMatch + 1, manager.matches.length)
    : manager.query.length > 0
      ? SEARCH_OVERLAY_NO_MATCHES
      : '';

  const locked = manager.locked;
  const cursor = locked ? '' : '█';
  const queryDisplay = manager.query + cursor;
  const hints = locked
    ? SEARCH_OVERLAY_LOCKED_HINTS
    : SEARCH_OVERLAY_UNLOCKED_HINTS;
  const label = SEARCH_OVERLAY_LABEL;
  const matchStr = matchCount ? ` ${matchCount}` : '';

  // Build left portion: label + query (no match count, that gets separate styling)
  const leftPart = label + queryDisplay;
  const hintsW = getDisplayWidth(hints);
  const matchStrW = getDisplayWidth(matchStr);
  // Available width for left content (query area)
  const leftWidth = width - hintsW - matchStrW - 2;
  const truncatedLeft = fitDisplay(
    getDisplayWidth(leftPart) > leftWidth ? truncateDisplay(leftPart, leftWidth) : leftPart,
    leftWidth,
  );

  // Build the full line text (match count embedded for positional tracking)
  const fullLine = truncatedLeft + matchStr + hints + ' ';
  const p = activeTokens();
  const line = createBottomBarLine(width, { fg: p.selectedListItemText, bg: p.accent });
  writeBottomBarText(line, 0, width, fitDisplay(truncateDisplay(fullLine, width), width), { fg: p.selectedListItemText, bg: p.accent });

  // Overwrite match count segment with dim grey styling
  if (matchStr.length > 0) {
    const matchStart = getDisplayWidth(truncatedLeft);
    // dim kept: de-emphasis on the accent bar, where a faint grey would not read.
    writeBottomBarText(line, matchStart, matchStrW, matchStr, { fg: p.selectedListItemText, bg: p.accent, dim: true });
  }

  return [line];
}
