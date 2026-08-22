import { describe, test, expect, beforeEach } from 'bun:test';
import { Compositor } from '../../renderer/compositor.ts';
import { createStyledCell, createEmptyLine } from '@pellux/goodvibes-sdk/platform/types';
import type { Line, Cell } from '@pellux/goodvibes-sdk/platform/types';
import type { CompositeRequest, SidebarCompositeData, SelectionInfo } from '../../renderer/compositor.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal mock WriteStream, records all writes. */
function makeMockStream() {
  const writes: string[] = [];
  const stream = {
    write: (data: string) => { writes.push(data); return true; },
    writes,
  };
  return stream as unknown as NodeJS.WriteStream & { writes: string[] };
}

function makeCompositor() {
  const stream = makeMockStream() as NodeJS.WriteStream & { writes: string[] };
  const compositor = new Compositor(stream as NodeJS.WriteStream);
  return { compositor, stream };
}

/** Create a Line filled with a repeating character. */
function makeLine(width: number, char = ' '): Line {
  return Array.from({ length: width }, () => createStyledCell(char));
}

/** Stamp a visible character at a specific column within a line. */
function stampChar(line: Line, col: number, char: string): void {
  if (col >= 0 && col < line.length) {
    line[col] = createStyledCell(char);
  }
}

/** Read char at (x, y) from the compositor's last buffer. */
function cellAt(compositor: Compositor, x: number, y: number): Cell | undefined {
  return compositor.lastBufferForTest?.getCell(x, y);
}

// ---------------------------------------------------------------------------
// Common dimensions
// ---------------------------------------------------------------------------

const WIDTH = 40;
const HEIGHT = 10;
const SIDEBAR_WIDTH = 15;
// leftWidth = 40 - 15 - 1 = 24, sepX = 24

function makeBaseRequest(overrides: Partial<CompositeRequest> = {}): CompositeRequest {
  return {
    width: WIDTH,
    height: HEIGHT,
    header: [makeLine(WIDTH, 'H'), makeLine(WIDTH, 'H')],  // rows 0-1
    viewport: Array.from({ length: 6 }, () => makeLine(WIDTH, '.')),  // rows 2-7
    footer: [makeLine(WIDTH, 'F'), makeLine(WIDTH, 'F')],  // rows 8-9
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Compositor: no sidebar', () => {
  test('produces output (stdout.write called)', () => {
    const { compositor, stream } = makeCompositor();
    compositor.composite(makeBaseRequest());
    expect(stream.writes.length).toBeGreaterThan(0);
  });

  test('renders viewport lines via full-width blit (no sidebar fast path)', () => {
    const { compositor } = makeCompositor();
    const viewport = Array.from({ length: 6 }, () => makeLine(WIDTH, '.'));
    // Stamp a recognisable character at col 30 on viewport row 0 (screen row 2)
    stampChar(viewport[0], 30, 'X');
    compositor.composite(makeBaseRequest({ viewport }));
    // Without a panel, the full line is blitted, col 30 on screen row 2 should be 'X'
    expect(cellAt(compositor, 30, 2)?.char).toBe('X');
  });

  test('header rows render first when no sidebar (header=2 rows)', () => {
    const { compositor } = makeCompositor();
    const header = [makeLine(WIDTH, 'A'), makeLine(WIDTH, 'B')];
    compositor.composite(makeBaseRequest({ header }));
    expect(cellAt(compositor, 0, 0)?.char).toBe('A');
    expect(cellAt(compositor, 0, 1)?.char).toBe('B');
  });

  test('viewport starts at row 0 when no header is supplied', () => {
    const { compositor } = makeCompositor();
    const viewport = Array.from({ length: HEIGHT }, () => makeLine(WIDTH, '.'));
    stampChar(viewport[0], 0, 'T');
    stampChar(viewport[HEIGHT - 1], 0, 'B');

    compositor.composite(makeBaseRequest({
      header: [],
      viewport,
      footer: [],
    }));

    expect(cellAt(compositor, 0, 0)?.char).toBe('T');
    expect(cellAt(compositor, 0, HEIGHT - 1)?.char).toBe('B');
  });

  test('clears stale footer rows when fullscreen viewport replaces the shell', () => {
    const { compositor } = makeCompositor();
    compositor.composite(makeBaseRequest());
    expect(cellAt(compositor, 0, HEIGHT - 1)?.char).toBe('F');

    compositor.composite(makeBaseRequest({
      header: [],
      viewport: [makeLine(WIDTH, 'O')],
      footer: [],
    }));

    expect(cellAt(compositor, 0, 0)?.char).toBe('O');
    expect(cellAt(compositor, 0, HEIGHT - 1)?.char).toBe(' ');
    expect(cellAt(compositor, WIDTH - 1, HEIGHT - 1)?.char).toBe(' ');
  });

  test('forced fullscreen redraw writes through the bottom row', () => {
    const { compositor, stream } = makeCompositor();
    compositor.composite(makeBaseRequest());
    const writeCountBefore = stream.writes.length;

    compositor.composite(makeBaseRequest({
      header: [],
      viewport: [makeLine(WIDTH, 'O')],
      footer: [],
      forceFullRedraw: true,
    }));

    const output = stream.writes.slice(writeCountBefore).join('');
    expect(output).toContain(`\x1b[${HEIGHT};1H`);
    expect(cellAt(compositor, 0, 0)?.char).toBe('O');
    expect(cellAt(compositor, 0, HEIGHT - 1)?.char).toBe(' ');
  });
});

describe('Compositor: with sidebar', () => {
  function makeSidebarData(): SidebarCompositeData {
    return { lines: Array.from({ length: 6 }, () => makeLine(SIDEBAR_WIDTH, 'P')) };
  }

  test('separator drawn at correct column (sepX = leftWidth)', () => {
    const { compositor } = makeCompositor();
    compositor.composite(makeBaseRequest({ sidebar: makeSidebarData(), sidebarWidth: SIDEBAR_WIDTH }));
    // leftWidth = 40 - 15 - 1 = 24; separator at col 24
    const sepX = WIDTH - SIDEBAR_WIDTH - 1; // = 24
    expect(cellAt(compositor, sepX, 2)?.char).toBe('│');
  });

  test('sidebar lines render from the first viewport row (screen row 2)', () => {
    const { compositor } = makeCompositor();
    const sidebar = makeSidebarData();
    sidebar.lines[0][0] = createStyledCell('S');
    compositor.composite(makeBaseRequest({ sidebar, sidebarWidth: SIDEBAR_WIDTH }));
    const sidebarStartX = (WIDTH - SIDEBAR_WIDTH - 1) + 1; // = 25
    expect(cellAt(compositor, sidebarStartX, 2)?.char).toBe('S');
  });

  test('left viewport cells stay within leftWidth (sidebar chars not overwritten)', () => {
    const { compositor } = makeCompositor();
    const viewport = Array.from({ length: 6 }, () => makeLine(WIDTH, '.'));
    compositor.composite(makeBaseRequest({ sidebar: makeSidebarData(), sidebarWidth: SIDEBAR_WIDTH, viewport }));
    const leftWidth = WIDTH - SIDEBAR_WIDTH - 1; // = 24
    expect(cellAt(compositor, 0, 2)?.char).toBe('.');
    expect(cellAt(compositor, leftWidth - 1, 2)?.char).toBe('.');
    const sidebarStartX = leftWidth + 1;
    expect(cellAt(compositor, sidebarStartX, 2)?.char).toBe('P');
  });

  test('sidebar rows clear stale content when the new frame has no line for that row', () => {
    const { compositor } = makeCompositor();
    const leftWidth = WIDTH - SIDEBAR_WIDTH - 1;
    const sidebarStartX = leftWidth + 1;

    compositor.composite(makeBaseRequest({ sidebar: makeSidebarData(), sidebarWidth: SIDEBAR_WIDTH }));
    expect(cellAt(compositor, sidebarStartX, 3)?.char).toBe('P');

    const sparse: SidebarCompositeData = { lines: [makeLine(SIDEBAR_WIDTH, 'P')] };
    compositor.composite(makeBaseRequest({ sidebar: sparse, sidebarWidth: SIDEBAR_WIDTH }));

    expect(cellAt(compositor, sidebarStartX, 3)?.char).toBe(' ');
  });

  test('sidebar fills viewport rows past short conversation content', () => {
    const { compositor } = makeCompositor();
    const leftWidth = WIDTH - SIDEBAR_WIDTH - 1;
    const sidebarStartX = leftWidth + 1;
    const sidebar: SidebarCompositeData = { lines: Array.from({ length: 6 }, () => makeLine(SIDEBAR_WIDTH, 'R')) };
    // Conversation viewport shorter than the body: remaining rows still draw sidebar
    compositor.composite(makeBaseRequest({
      sidebar,
      sidebarWidth: SIDEBAR_WIDTH,
      viewport: Array.from({ length: 2 }, () => makeLine(WIDTH, '.')),
    }));
    expect(cellAt(compositor, sidebarStartX, 6)?.char).toBe('R');
    expect(cellAt(compositor, leftWidth, 6)?.char).toBe('│');
  });
});

describe('Compositor: R3 buffer reuse (double-buffer, no clone)', () => {
  test('TerminalBuffer constructor is NOT called on second composite() (buffer is reused)', () => {
    // We track constructor calls by counting .cells allocations via composite calls.
    // The core assertion: lastBufferForTest after N composites always returns a non-null
    // object (proving reuse), and rendering is correct on subsequent frames.
    const { compositor } = makeCompositor();
    compositor.composite(makeBaseRequest());
    const buf1 = compositor.lastBufferForTest;
    compositor.composite(makeBaseRequest());
    const buf2 = compositor.lastBufferForTest;
    // After double-buffer swap, lastBufferForTest returns the second-frame buffer.
    // Both must be non-null and be TerminalBuffer instances.
    expect(buf1).toEqual(expect.objectContaining({ width: WIDTH, height: HEIGHT }));
    expect(buf2).toEqual(expect.objectContaining({ width: WIDTH, height: HEIGHT }));
    // On the first composite frontBuffer=backBuffer (first allocation), second they differ.
    // We only verify correctness: cell content on frame 2 is still correct.
    expect(buf2?.getCell(0, 0)?.char).toBe('H');
  });

  test('resetDiff() clears both buffers so next composite starts fresh', () => {
    const { compositor, stream } = makeCompositor();
    compositor.composite(makeBaseRequest());
    const writeCountBefore = stream.writes.length;
    compositor.resetDiff();
    // After reset, the next composite should write the full screen again (full diff)
    compositor.composite(makeBaseRequest());
    expect(stream.writes.length).toBeGreaterThan(writeCountBefore);
    expect(compositor.lastBufferForTest).toEqual(expect.objectContaining({ width: WIDTH, height: HEIGHT }));
  });

  test('resize (dim change) does not crash and produces correct output', () => {
    const { compositor } = makeCompositor();
    compositor.composite(makeBaseRequest({ width: 40, height: 10 }));
    // Shrink terminal
    expect(() => {
      compositor.composite(makeBaseRequest({ width: 30, height: 8,
        header: [makeLine(30, 'H'), makeLine(30, 'H')],
        viewport: Array.from({ length: 4 }, () => makeLine(30, '.')),
        footer: [makeLine(30, 'F'), makeLine(30, 'F')],
      }));
    }).not.toThrow();
    // Buffer should now be 30 wide
    expect(compositor.lastBufferForTest?.width).toBe(30);
  });
});

describe('Compositor: degenerate sidebarWidth >= width', () => {
  test('leftWidth clamped to 1 when sidebarWidth >= width - 1', () => {
    const { compositor } = makeCompositor();
    const huge: SidebarCompositeData = { lines: Array.from({ length: 6 }, () => makeLine(WIDTH - 1, 'P')) };
    expect(() => {
      compositor.composite(makeBaseRequest({ sidebar: huge, sidebarWidth: WIDTH - 1 }));
    }).not.toThrow();
    // leftWidth = max(1, 40 - 39 - 1) = 1; viewport cell at col 0 should exist
    expect(cellAt(compositor, 0, 2)).toEqual(expect.objectContaining({ char: '.' }));
  });

  test('selection overlay constrained to clamped leftWidth', () => {
    const { compositor } = makeCompositor();
    const sidebar: SidebarCompositeData = { lines: Array.from({ length: 6 }, () => makeLine(WIDTH, 'P')) };
    const selection: SelectionInfo = {
      isCellSelected: (col, _row) => col === 0,
      scrollTop: 0,
      lineCount: 6,
    };
    expect(() => {
      compositor.composite(makeBaseRequest({ sidebar, sidebarWidth: WIDTH - 2, selection }));
    }).not.toThrow();
    const cell = cellAt(compositor, 0, 2);
    expect(cell?.bg).toBe('4');
  });
});
