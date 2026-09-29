import { type Line } from '@pellux/goodvibes-sdk/platform/types';
import { fitDisplay, getDisplayWidth, truncateDisplay } from '../utils/terminal-width.ts';
import type { AutocompleteEngine } from '../input/autocomplete.ts';
import {
  createOverlayBorderLine,
  createOverlayBoxLayout,
  createOverlayContentLine,
  DEFAULT_OVERLAY_PALETTE,
  putOverlayText,
} from './overlay-box.ts';
import { activeTokens } from './theme.ts';
import { getOverlaySurfaceMetrics } from '@pellux/goodvibes-terminal-shell';

const AUTOCOMPLETE_TITLE = ' Commands';
const AUTOCOMPLETE_EMPTY_QUERY = '/';
const AUTOCOMPLETE_HINTS = '[Tab] Complete  [Up/Down] Navigate  [Enter] Execute  [Esc] Cancel';

interface CellStyle {
  fg: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
}

function putText(line: Line, startX: number, maxWidth: number, text: string, style: CellStyle): void {
  putOverlayText(line, startX, maxWidth, text, style);
}

function autocompleteQueryText(query: string): string {
  return query ? `/${query}` : AUTOCOMPLETE_EMPTY_QUERY;
}

function autocompleteScrollText(selected: string | number, total: string | number): string {
  return `${selected}/${total}`;
}

export function renderAutocompletePackageText(): string {
  return [
    AUTOCOMPLETE_TITLE.trim(),
    autocompleteQueryText('<query>'),
    autocompleteScrollText('<selected>', '<total>'),
    AUTOCOMPLETE_HINTS,
  ].join('\n');
}

/**
 * Render the slash command autocomplete dropdown as Line[] for overlay in the viewport.
 */
export function renderAutocompleteOverlay(
  autocomplete: AutocompleteEngine,
  width: number,
  viewportHeight = 24,
): Line[] {
  const state = autocomplete.getState();
  if (!state.active || state.results.length === 0) return [];

  const lines: Line[] = [];
  const metrics = getOverlaySurfaceMetrics(width, viewportHeight, {
    margin: 2,
    maxWidth: 88,
    chromeRows: 4,
    minContentRows: 6,
    maxContentRows: 10,
  });
  const layout = createOverlayBoxLayout(width, metrics.margin, metrics.boxWidth);

  lines.push(createOverlayBorderLine(width, layout, '┌', '─', '┐', DEFAULT_OVERLAY_PALETTE.borderFg));

  const titleLine = createOverlayContentLine(width, layout);
  const titleText = AUTOCOMPLETE_TITLE;
  const queryText = autocompleteQueryText(state.query);
  const queryWidth = Math.min(Math.floor(layout.innerWidth / 2), Math.max(8, layout.innerWidth - getDisplayWidth(titleText) - 2));
  const leftText = fitDisplay(titleText, Math.max(0, layout.innerWidth - queryWidth));
  const rightText = truncateDisplay(queryText, queryWidth);
  putText(titleLine, layout.margin + 2, layout.innerWidth - queryWidth, leftText, { fg: DEFAULT_OVERLAY_PALETTE.titleFg, bold: true });
  putText(
    titleLine,
    layout.margin + 2 + layout.innerWidth - queryWidth,
    queryWidth,
    fitDisplay(rightText, queryWidth),
    { fg: activeTokens().textMuted },
  );
  lines.push(titleLine);

  const results = state.results;
  const total = results.length;
  const maxVisible = metrics.contentRows;
  let startIdx = 0;
  if (total > maxVisible) {
    startIdx = Math.max(
      0,
      Math.min(
        state.selectedIndex - Math.floor(maxVisible / 2),
        total - maxVisible,
      ),
    );
  }
  const endIdx = Math.min(startIdx + maxVisible, total);

  const indicatorWidth = 2;
  const maxCommandWidth = Math.min(18, Math.max(10, Math.floor(layout.innerWidth * 0.28)));
  const gapWidth = 2;
  const descWidth = Math.max(0, layout.innerWidth - indicatorWidth - maxCommandWidth - gapWidth);

  for (let i = startIdx; i < endIdx; i++) {
    const { command } = results[i];
    const isSelected = i === state.selectedIndex;
    const line = createOverlayContentLine(width, layout, DEFAULT_OVERLAY_PALETTE.borderFg, isSelected ? DEFAULT_OVERLAY_PALETTE.selectedBg : '');
    const indicator = isSelected ? '▸ ' : '  ';
    const commandText = fitDisplay(
      truncateDisplay(`/${command.name}`, maxCommandWidth),
      maxCommandWidth,
    );
    const descriptionText = fitDisplay(
      truncateDisplay(command.description, descWidth),
      descWidth,
    );
    let x = layout.margin + 2;
    putText(line, x, indicatorWidth, indicator, {
      fg: isSelected ? DEFAULT_OVERLAY_PALETTE.titleFg : DEFAULT_OVERLAY_PALETTE.mutedFg,
      bg: isSelected ? DEFAULT_OVERLAY_PALETTE.selectedBg : '',
      bold: isSelected,
    });
    x += indicatorWidth;
    putText(line, x, maxCommandWidth, commandText, {
      fg: isSelected ? DEFAULT_OVERLAY_PALETTE.titleFg : DEFAULT_OVERLAY_PALETTE.bodyFg,
      bg: isSelected ? DEFAULT_OVERLAY_PALETTE.selectedBg : '',
      bold: isSelected,
    });
    x += maxCommandWidth;
    putText(line, x, gapWidth, '  ', {
      fg: DEFAULT_OVERLAY_PALETTE.bodyFg,
      bg: isSelected ? DEFAULT_OVERLAY_PALETTE.selectedBg : '',
    });
    x += gapWidth;
    putText(line, x, descWidth, descriptionText, {
      fg: isSelected ? DEFAULT_OVERLAY_PALETTE.bodyFg : DEFAULT_OVERLAY_PALETTE.mutedFg,
      bg: isSelected ? DEFAULT_OVERLAY_PALETTE.selectedBg : '',
      bold: false,
    });
    lines.push(line);
  }

  if (total > maxVisible) {
    const scrollLine = createOverlayContentLine(width, layout);
    const scrollText = autocompleteScrollText(state.selectedIndex + 1, total);
    putText(
      scrollLine,
      layout.margin + 2 + Math.max(0, layout.innerWidth - getDisplayWidth(scrollText)),
      getDisplayWidth(scrollText),
      scrollText,
      { fg: DEFAULT_OVERLAY_PALETTE.mutedFg },
    );
    lines.push(scrollLine);
  }

  const footerLine = createOverlayContentLine(width, layout);
  putText(
    footerLine,
    layout.margin + 2,
    layout.innerWidth,
    fitDisplay(truncateDisplay(AUTOCOMPLETE_HINTS, layout.innerWidth), layout.innerWidth),
    { fg: DEFAULT_OVERLAY_PALETTE.mutedFg },
  );
  lines.push(footerLine);

  lines.push(createOverlayBorderLine(width, layout, '└', '─', '┘', DEFAULT_OVERLAY_PALETTE.borderFg));
  return lines;
}
