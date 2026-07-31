import { TerminalBuffer } from './buffer.ts';
import { DiffEngine } from './diff.ts';
import { type Line, createEmptyCell, createEmptyLine, createStyledCell } from '@pellux/goodvibes-sdk/platform/types';
import { getDisplayWidth } from '../utils/terminal-width.ts';
import type { SearchManager } from '../input/search.ts';
import { allowTerminalWrite, probeTermCaps, type TermColorCaps } from '@pellux/goodvibes-terminal-shell';
import { activeTheme } from './theme.ts';

export interface SelectionInfo {
  isCellSelected: (col: number, absoluteRow: number) => boolean;
  scrollTop: number;
  lineCount: number;
}

export interface SearchInfo {
  manager: SearchManager;
  scrollTop: number;
  viewportStartY: number;
}

export interface SidebarCompositeData {
  /** Pre-rendered sidebar lines, one per viewport row. */
  lines: Line[];
}

export interface CompositeRequest {
  width: number;
  height: number;
  header: Line[];
  viewport: Line[];
  footer: Line[];
  forceFullRedraw?: boolean;
  selection?: SelectionInfo;
  search?: SearchInfo;
  sidebar?: SidebarCompositeData;
  sidebarWidth?: number; // width of the right sidebar area (0 = no sidebar)
}

/**
 * Compositor - Authoritative TUI layout engine with Selection Overlay.
 * Decoupled from global state — all needed data is passed as parameters.
 */
export class Compositor {
  /** Double-buffer reuse: back is written, front is the last-rendered reference. */
  private frontBuffer: TerminalBuffer | null = null;
  private backBuffer: TerminalBuffer | null = null;
  private readonly caps: TermColorCaps;
  private diffEngine: DiffEngine;

  constructor(private stdout: NodeJS.WriteStream) {
    // Probe terminal color capabilities once at construction time so the
    // DiffEngine downsamples every emitted SGR to the terminal's real level.
    // The hardcoded truecolor search-highlight hex below (and any future theme
    // colors) is therefore cap-gated — no raw #rrggbb leaks on a non-truecolor
    // terminal. (R4 later replaces the hardcoded hex with live activeTheme()
    // reads in its tone-read region; this R2 region owns only the caps wiring.)
    this.caps = probeTermCaps(stdout);
    this.diffEngine = new DiffEngine(this.caps);
  }

  /** Exposed for unit tests — returns the detected color capability. */
  public get termCapsForTest(): TermColorCaps {
    return this.caps;
  }

  /** Exposed for unit tests — returns the last composited buffer. */
  public get lastBufferForTest(): TerminalBuffer | null {
    return this.frontBuffer;
  }

  public resetDiff(): void {
    this.diffEngine.reset();
    this.frontBuffer = null;
    this.backBuffer = null;
  }

  public composite(params: CompositeRequest): void {
    const { width, height, header, viewport, footer, forceFullRedraw, selection, search, sidebar, sidebarWidth } = params;
    const previousFrontBuffer = forceFullRedraw ? null : this.frontBuffer;
    if (forceFullRedraw) this.diffEngine.reset();

    // R3: Reuse back-buffer instead of allocating each frame
    if (!this.backBuffer) {
      this.backBuffer = new TerminalBuffer(width, height);
    } else {
      this.backBuffer.reset(width, height, previousFrontBuffer);
    }
    const newBuffer = this.backBuffer;

    const hasSidebar = sidebar !== undefined && sidebarWidth !== undefined && sidebarWidth > 0;
    const leftWidth = hasSidebar ? Math.max(1, width - sidebarWidth - 1) : width;
    const sepX = hasSidebar ? leftWidth : -1;

    // 1. Draw Header — always full width
    header.forEach((line, i) => newBuffer.blitLine(i, line));

    // 2. Draw Viewport directly after the supplied header.
    const viewportStartY = header.length;
    const vHeight = Math.max(0, height - header.length - footer.length);

    // Calculate the offset for bottom-anchored short history
    const lineCount = selection?.lineCount ?? 0;
    const offset = Math.max(0, vHeight - lineCount);

    // R4 tone-read region (the compositor is the pre-ruled R2→R4 shared file;
    // R2 owns the DiffEngine caps wiring above, R4 owns these live theme reads).
    // Read the search-highlight tones live per frame so they flip in light mode;
    // dark is byte-identical (the searchCurrent/searchMatch tones resolve to the
    // prior hardcoded yellow/gold pair). The separator stays a neutral dim grey.
    const T = activeTheme();
    const sepFg = '238';

    viewport.forEach((line, i) => {
      const screenY = viewportStartY + i;
      if (screenY >= height) return;

      if (!hasSidebar) {
        // No sidebar: existing fast path
        newBuffer.blitLine(screenY, line);
      } else {
        // Sidebar active: left side gets viewport cells 0..leftWidth-1
        for (let x = 0; x < leftWidth; x++) {
          const cell = line[x];
          if (cell !== undefined) {
            // If this is a wide char (2-cell) at the last left-side column,
            // it would bleed into the separator column visually.
            // Replace with a space to keep the separator aligned.
            if (x === leftWidth - 1 && cell.char && cell.char.length > 0 && getDisplayWidth(cell.char) > 1) {
              newBuffer.setCell(x, screenY, { ...cell, char: ' ' });
              continue;
            }
            newBuffer.setCell(x, screenY, cell);
          }
        }

        // Separator column (vertical bar between conversation and sidebar)
        newBuffer.setCell(sepX, screenY, createStyledCell('│', { fg: sepFg }));

        const sidebarStartX = sepX + 1;
        const sidebarLine = sidebar!.lines[i];
        const limit = sidebarLine === undefined ? 0 : Math.min(sidebarLine.length, sidebarWidth);
        for (let x = 0; x < limit; x++) {
          const cell = sidebarLine![x];
          if (cell !== undefined) {
            newBuffer.setCell(sidebarStartX + x, screenY, cell);
          }
        }
        for (let x = limit; x < sidebarWidth; x++) {
          newBuffer.setCell(sidebarStartX + x, screenY, createEmptyCell());
        }
      }

      // Apply Selection Highlighting Overlay (left side only)
      // Only highlight rows that actually contain history (past the bottom-anchor offset)
      if (selection && i >= offset) {
        const absoluteRow = selection.scrollTop + (i - offset);
        for (let x = 0; x < leftWidth; x++) {
          if (selection.isCellSelected(x, absoluteRow)) {
            newBuffer.setCell(x, screenY, { bg: '4', fg: '0', bold: false, dim: false });
          }
        }
      }

      // Apply Search Match Highlighting Overlay (left side only)
      if (search && search.manager.active && search.manager.query.length > 0 && i >= offset) {
        const absoluteRow = search.scrollTop + (i - offset);
        const lineMatches = search.manager.getMatchesOnLine(absoluteRow);
        for (const match of lineMatches) {
          const isCurrent = search.manager.isCurrentMatch(absoluteRow, match.col);
          for (let x = match.col; x < match.col + match.length && x < leftWidth; x++) {
            if (isCurrent) {
              newBuffer.setCell(x, screenY, { bg: T.searchCurrentBg, fg: T.searchCurrentFg, bold: true, dim: false });
            } else {
              newBuffer.setCell(x, screenY, { bg: T.searchMatchBg, fg: T.searchMatchFg, bold: false, dim: false });
            }
          }
        }
      }
    });

    for (let i = viewport.length; i < vHeight; i += 1) {
      const screenY = viewportStartY + i;
      if (screenY >= height) break;
      newBuffer.blitLine(screenY, createEmptyLine(width));
    }

    // Draw the separator and sidebar on viewport rows past the conversation content
    if (hasSidebar) {
      for (let i = viewport.length; i < vHeight; i++) {
        const screenY = viewportStartY + i;
        if (screenY >= height) break;
        newBuffer.setCell(sepX, screenY, createStyledCell('│', { fg: sepFg }));
        const sidebarStartX = sepX + 1;
        const sidebarLine = sidebar!.lines[i];
        const limit = sidebarLine === undefined ? 0 : Math.min(sidebarLine.length, sidebarWidth!);
        for (let x = 0; x < limit; x++) {
          const cell = sidebarLine![x];
          if (cell !== undefined) newBuffer.setCell(sidebarStartX + x, screenY, cell);
        }
        for (let x = limit; x < sidebarWidth!; x++) {
          newBuffer.setCell(sidebarStartX + x, screenY, createEmptyCell());
        }
      }
    }

    // 3. Draw Footer (Pinned to Bottom) — always full width
    const footerStart = height - footer.length;
    footer.forEach((line, i) => {
      const screenY = footerStart + i;
      if (screenY >= height) return;
      newBuffer.blitLine(screenY, line);
    });

    // 4. Diff and Render
    // R3: Diff against front-buffer (last-rendered), then swap front/back — no clone() needed
    const diff = this.diffEngine.diff(previousFrontBuffer, newBuffer);
    if (diff) {
      allowTerminalWrite(() => this.stdout.write(diff));
    }

    // Swap: back (just written) becomes the new front reference; old front becomes the next back
    const swap = this.frontBuffer;
    this.frontBuffer = this.backBuffer;
    this.frontBuffer.clearDirty();
    this.backBuffer = swap;
  }
}
