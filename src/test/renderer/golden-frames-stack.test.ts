// ---------------------------------------------------------------------------
// golden-frames-stack.test.ts, the bottom of the main screen, whole: output
// text, the throbber, the input area and the status line, with the gaps
// between them, at rest, while main thinks, while it runs a tool, and with
// the keyboard in the work tree (tree mode, Alt+Up), at 80, 120 and 160
// columns.
//
// The transcript ends with a table row, the case where the last row of output
// used to sit directly on the input area. Each frame asserts the exact stack
// from the bottom up; the layout audit (helpers/frame-audit.ts, GAP) runs on
// every frame here and again in golden-frames-audit.test.ts.
//
// Update path:
//   GOODVIBES_UPDATE_GOLDENS=1 bun test src/test/renderer/golden-frames-stack.test.ts
//
// The agent's twin of goodvibes-tui's golden-frames-stack.test.ts, over the
// agent's base-screen transcript (it ends on a table).
// ---------------------------------------------------------------------------

import { describe, expect, test } from 'bun:test';
import { createEmptyLine, type Line } from '@pellux/goodvibes-sdk/platform/types';
import { UIFactory } from '../../renderer/ui-factory.ts';
import { appendConversationMessages, type ConversationRenderContext } from '../../core/conversation-rendering.ts';
import { fixtureFooter, fixtureTranscript, FIXTURE_VERSION } from '../helpers/agent-frame-fixtures.ts';
import { activeTokens, setActiveThemeMode, setActiveThemeName } from '../../renderer/theme.ts';
import type { ThrobberState } from '../../renderer/throbber.ts';
import { auditFrame } from '../helpers/frame-audit.ts';
import { assertGoldenIn, encodeGolden } from '../helpers/golden-snapshot.ts';
import { singleLaneScene } from '../helpers/work-tree-scenes.ts';

setActiveThemeName('goodvibes');
setActiveThemeMode('dark');
const DIR = new URL('./golden-frames/', import.meta.url).pathname;
const HEIGHT = 30;

type Mode = 'rest' | 'thinking' | 'tool' | 'tree';

const THINKING: ThrobberState = { spinner: '⠋', frame: 0, activity: { kind: 'model', phrase: 'Thinking...', elapsedMs: 12_000 } };
const TOOL: ThrobberState = { spinner: '⠙', frame: 0, activity: { kind: 'tool', tool: 'Running a command', argument: 'bun test src/net/retry.test.ts', elapsedMs: 3_000 } };

function blank(width: number): Line {
  const line = createEmptyLine(width);
  for (const cell of line) cell.bg = '';
  return line;
}


/** The work tree with the keyboard on its first bead. */
function treeTranscript(width: number): Line[] {
  const scene = singleLaneScene();
  const lines: Line[] = [];
  const context: ConversationRenderContext = {
    history: { addLine: (l) => { lines.push(l); }, addLines: (ls) => { lines.push(...ls); }, getLineCount: () => lines.length },
    blockRegistry: [],
    collapseState: new Map(scene.collapse),
    errorLineRegistry: [],
    configManager: null,
    splashOptions: {},
    workTreeSources: scene.sources,
    treeGlyphSet: 'rounded',
    focusId: 'c:1:0',
    frame: 0,
  };
  appendConversationMessages(context, scene.messages, width, []);
  return lines;
}

function screen(width: number, mode: Mode): Line[] {
  const header = UIFactory.createHeader(width, 'claude-opus-4', 'Lisbon trip', FIXTURE_VERSION);
  const working = mode !== 'rest';
  const footer = fixtureFooter(width, {
    promptFocused: mode !== 'tree',
    workTreeFocused: mode === 'tree',
    throbber: mode === 'thinking' ? THINKING : mode === 'tool' || mode === 'tree' ? TOOL : null,
    turnRunning: working,
  });
  // The base screen's transcript ends on a table row.
  const body = mode === 'tree' ? treeTranscript(width) : fixtureTranscript(width);
  const room = HEIGHT - header.length - footer.length;
  const visible = body.slice(Math.max(0, body.length - room));
  while (visible.length < room) visible.unshift(blank(width));
  return [...header, ...visible, ...footer];
}

const text = (line: Line | undefined): string => (line ?? []).map((c) => c.char || ' ').join('');
const isBlank = (line: Line | undefined): boolean => (line ?? []).every((c) => (c.char === ' ' || c.char === '') && c.bg === '');

describe('golden-frames : the stack under the transcript', () => {
  for (const width of [80, 120, 160]) {
    for (const mode of ['rest', 'thinking', 'tool', 'tree'] as const) {
      const name = `stack-${mode}-${width}`;
      test(name, () => {
        const lines = screen(width, mode);
        expect(lines).toHaveLength(HEIGHT);
        expect(lines.every((l) => l.length === width)).toBe(true);
        const H = HEIGHT;
        // From the bottom: the status line, the ▀ cap, padding, text, padding, the ▄ cap.
        expect(text(lines[H - 1])).toContain('ctrl+p');
        expect(text(lines[H - 2]).slice(2, 4)).toBe('╹▀');
        expect(text(lines[H - 3])[2]).toBe('┃');
        expect(text(lines[H - 4])).toContain(mode === 'tree' ? 'Esc returns to the composer' : 'Ask anything');
        expect(text(lines[H - 5])[2]).toBe('┃');
        expect(text(lines[H - 6]).slice(2, 4)).toBe('╻▄');
        if (mode === 'rest') {
          // Output text sits half a row over the input area (the ▄ cap's empty top half).
          expect(text(lines[H - 7])).toContain('└');
          expect(text(lines[H - 1])).not.toContain('interrupt');
        } else {
          // The throbber, then one full empty row, then the output text.
          expect(text(lines[H - 7]).slice(3, 5)).toMatch(/^[⠋⠙] $/);
          expect(text(lines[H - 7])).toContain(mode === 'thinking' ? 'Thinking... · 12s' : 'Running a command · bun test src/net/retry.test.ts · 3s');
          expect(isBlank(lines[H - 8])).toBe(true);
          if (mode !== 'tree') expect(text(lines[H - 9])).toContain('└');
          expect(text(lines[H - 1])).toContain(mode === 'tree' ? 'move between beads' : 'interrupt');
        }
        if (mode === 'tree') expect(lines.some((l) => l[0]?.char === '┃')).toBe(true); // the focused row
        assertGoldenIn(DIR, name, lines);
        expect(encodeGolden(name, screen(width, mode))).toBe(encodeGolden(name, lines));
        expect(auditFrame(lines, width, activeTokens()).map((i) => `${i.kind} row ${i.row}: ${i.detail}`)).toEqual([]);
      });
    }
  }
});
