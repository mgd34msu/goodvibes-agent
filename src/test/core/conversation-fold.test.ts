// ---------------------------------------------------------------------------
// conversation-fold.test.ts
//
// A FOLDED block is ONE row. The owner rejected the previous shape four times:
// a collapsed tool result spent four to six rows saying "there is something
// here" — a ▄ top rule, a framed preview box, a ▀ bottom rule, a second copy of
// the count as `[▸ N hidden]`, and a blank separator between every pair, so a
// handful of folds filled the screen.
//
// These pin the fold's shape, the predicates that decide it, and the ONE case
// where a separator still belongs: after a tool run, before the prose that
// answers it.
// ---------------------------------------------------------------------------

import { describe, test, expect } from 'bun:test';
import { appendConversationMessages, type ConversationRenderContext } from '../../core/conversation-rendering.ts';
import {
  FOLDED_SHORT_CONTENT_CHARS,
  foldedToolResultContent,
  isToolResultFolded,
  trailingBlankAfter,
} from '../../core/conversation-fold.ts';
import { renderConversationFoldedRow } from '../../renderer/conversation-surface.ts';
// The canonical policy, imported DIRECTLY, so the parity block below compares
// this product's adapter against the shared source rather than against itself.
import {
  FOLDED_SHORT_CONTENT_CHARS as POLICY_SHORT_CONTENT_CHARS,
  FOLD_PREVIEW_MIN_COLS as POLICY_PREVIEW_MIN_COLS,
  foldPreviewText as policyFoldPreviewText,
  foldedToolResult as policyFoldedToolResult,
  trailingBlankAfterRow as policyTrailingBlankAfterRow,
} from '@pellux/goodvibes-terminal-shell';
import { buildRenderPlan } from '../../core/conversation-turn-structure.ts';
import { COMPACTION_HANDOFF_HEADER } from '@pellux/goodvibes-sdk/platform/core';
import type { Line } from '@pellux/goodvibes-sdk/platform/types';
import type { ConversationMessageSnapshot } from '../../core/conversation';

type Message = ConversationMessageSnapshot;
const WIDTH = 96;

function renderRows(
  messages: Message[],
  options: {
    readonly collapseState?: Map<string, boolean>;
    readonly config?: Record<string, unknown>;
  } = {},
): string[] {
  const lines: Line[] = [];
  const config = options.config;
  const context: ConversationRenderContext = {
    history: {
      addLine: (line) => { lines.push(line); },
      addLines: (added) => { for (const line of added) lines.push(line); },
      getLineCount: () => lines.length,
    },
    blockRegistry: [],
    collapseState: options.collapseState ?? new Map<string, boolean>(),
    errorLineRegistry: [],
    configManager: config ? ({ get: (key: string) => config[key] } as never) : null,
    splashOptions: {},
  };
  appendConversationMessages(context, messages, WIDTH, [], 0);
  return lines.map((line) => line.map((cell) => cell.char).join('').replace(/\s+$/, ''));
}

/** A long body — comfortably past the "show it whole" threshold. */
function longBody(): string {
  const padded: Record<string, string> = {};
  for (let i = 0; i < 30; i++) padded[`k${i}`] = `value-${i}`;
  const body = JSON.stringify(padded);
  expect(body.length).toBeGreaterThan(FOLDED_SHORT_CONTENT_CHARS);
  return body;
}

// ---------------------------------------------------------------------------
// Parity: this product holds NO copy of the fold rules. Everything below is
// checked against @pellux/goodvibes-terminal-shell's policy directly, so a
// change there that this adapter fails to follow fails here rather than
// silently letting the two renderers drift apart again.
// ---------------------------------------------------------------------------
describe('the local adapter agrees with the canonical fold policy', () => {
  test('the short-content threshold is the policy constant, not a local copy', () => {
    expect(FOLDED_SHORT_CONTENT_CHARS).toBe(POLICY_SHORT_CONTENT_CHARS);
  });

  test('foldedToolResultContent matches the policy across the fixture matrix', () => {
    const lengths = [0, 1, 199, POLICY_SHORT_CONTENT_CHARS, POLICY_SHORT_CONTENT_CHARS + 1, 5000];
    const storedStates: readonly (boolean | undefined)[] = [undefined, true, false];
    for (const length of lengths) {
      for (const storedCollapsed of storedStates) {
        const content = 'x'.repeat(length);
        expect(
          foldedToolResultContent(content, storedCollapsed),
          `length=${length} stored=${String(storedCollapsed)}`,
        ).toBe(policyFoldedToolResult({
          contentLength: length,
          // Tool results in this product carry no summary field.
          hasSummary: false,
          storedCollapsed,
        }));
      }
    }
  });

  test('trailingBlankAfter matches the policy across the fixture matrix', () => {
    const messages: Message[] = [
      { role: 'assistant', content: 'looking' } as Message,
      { role: 'tool', callId: 'c1', toolName: 'a', content: longBody() },
      { role: 'tool', callId: 'c2', toolName: 'b', content: longBody() },
      { role: 'assistant', content: 'the answer' } as Message,
    ];
    const plan = buildRenderPlan(messages, 0, {});
    const state = { collapseState: new Map<string, boolean>(), assistantTurns: undefined };

    for (let i = 0; i < plan.length; i++) {
      const node = plan[i]!;
      const next = plan[i + 1];
      const expected = policyTrailingBlankAfterRow({
        nextIsBranchRow: Boolean(next && next.depth > 0),
        nextIsToolMachinery: Boolean(next && (next.kind === 'toolcall' || next.message.role === 'tool')),
        rowRendersFolded: isToolResultFolded(state, node),
      });
      expect(trailingBlankAfter(state, node, next), `plan index ${i}`).toBe(expected);
    }
  });

  test('the rendered preview is the policy text, truncated — never re-flattened locally', () => {
    const tone = { marker: '●', markerFg: '244', label: 'tool result', labelFg: '244' };
    const badge = { text: ' ▸ 44 lines ', fg: '244', dim: true };
    const raw = 'alpha\n\tbeta   gamma\ndelta';
    const row = renderConversationFoldedRow(WIDTH, tone, [badge], raw)
      .map((cell) => cell.char).join('').replace(/\s+$/, '');
    const policyText = policyFoldPreviewText(raw, 40)!;
    expect(policyText).toBe('alpha beta gamma delta');
    expect(row).toContain(policyText);
  });

  test('the policy declining a preview is what makes the row fall back', () => {
    const tone = { marker: '●', markerFg: '244', label: 'tool result', labelFg: '244' };
    const badge = { text: ' ▸ 44 lines ', fg: '244', dim: true };
    const asText = (preview: string | null) => renderConversationFoldedRow(WIDTH, tone, [badge], preview)
      .map((cell) => cell.char).join('').replace(/\s+$/, '');
    // Whitespace-only: the policy returns null, so the row is the plain one.
    expect(policyFoldPreviewText('   \n\t ', 40)).toBeNull();
    expect(asText('   \n\t ')).toBe(asText(null));
    // Under the minimum column budget the policy returns null too.
    expect(policyFoldPreviewText('content', POLICY_PREVIEW_MIN_COLS - 1)).toBeNull();
  });
});

describe('renderConversationFoldedRow owns the fold geometry', () => {
  const tone = { marker: '●', markerFg: '244', label: 'tool result', labelFg: '244' };
  const badge = { text: ' ▸ 44 lines ', fg: '244', dim: true };

  /** The row as a plain string, trailing blanks trimmed. */
  function rowText(preview: string | null, width = WIDTH, indentCols = 0): string {
    return renderConversationFoldedRow(width, tone, [badge], preview, indentCols)
      .map((cell) => cell.char).join('').replace(/\s+$/, '');
  }

  test('the fold is ONE row — always exactly one line', () => {
    const line = renderConversationFoldedRow(WIDTH, tone, [badge], 'some content');
    expect(Array.isArray(line)).toBe(true);
    expect(line.length).toBe(WIDTH);
    expect(rowText('some content')).not.toContain('\n');
  });

  test('a multi-line body flattens into ONE visual run, still one row', () => {
    // The policy flattens newlines to single spaces rather than stopping at the
    // first line, so a short first line does not waste the row's remaining
    // columns. It is still exactly one row — truncated, never wrapped.
    const text = rowText('first line\nsecond line\nthird');
    expect(text).toContain('first line second line third');
    expect(text).not.toContain('\n');
  });

  test('tabs and space runs collapse so the tail is worth its columns', () => {
    expect(rowText('a\t\t  b   c')).toContain('a b c');
  });

  test('an over-long line is truncated with an ellipsis, never wrapped', () => {
    const text = rowText('x'.repeat(400));
    expect(text.endsWith('…')).toBe(true);
    // The row still fits its width — truncation, not overflow.
    expect(text.length).toBeLessThanOrEqual(WIDTH);
  });

  test('with no preview the row is the plain event line', () => {
    const withNothing = rowText(null);
    expect(withNothing).toContain('tool result');
    expect(withNothing).toContain('▸ 44 lines');
    expect(withNothing.trimEnd().endsWith('lines')).toBe(true);
  });

  test('whitespace-only content falls back to the plain row', () => {
    expect(rowText('   \n  ')).toBe(rowText(null));
    expect(rowText('')).toBe(rowText(null));
  });

  test('under the minimum column budget the row stops at its badges', () => {
    // A width where the label and badge leave fewer than the minimum columns.
    const narrow = 34;
    const beforeBudget = rowText(null, narrow);
    expect(rowText('some content that cannot fit', narrow)).toBe(beforeBudget);
    expect(POLICY_PREVIEW_MIN_COLS).toBe(6);
  });
});

describe('isToolResultFolded reproduces the renderer decision', () => {
  function planFor(messages: Message[]) {
    return buildRenderPlan(messages, 0, {});
  }
  const state = { collapseState: new Map<string, boolean>(), assistantTurns: undefined };

  test('a long result defaults to folded before anything has rendered', () => {
    const plan = planFor([
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'find', arguments: {} }] } as Message,
      { role: 'tool', callId: 'c1', toolName: 'find', content: longBody() },
    ]);
    const resultNode = plan.find((node) => node.kind !== 'toolcall' && node.message.role === 'tool');
    expect(isToolResultFolded(state, resultNode)).toBe(true);
  });

  test('a short result is shown whole, never folded', () => {
    const plan = planFor([
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'find', arguments: {} }] } as Message,
      { role: 'tool', callId: 'c1', toolName: 'find', content: 'ok' },
    ]);
    const resultNode = plan.find((node) => node.kind !== 'toolcall' && node.message.role === 'tool');
    expect(isToolResultFolded(state, resultNode)).toBe(false);
  });

  test('a call row and prose are not folded results', () => {
    const plan = planFor([
      { role: 'assistant', content: 'prose', toolCalls: [{ id: 'c1', name: 'find', arguments: {} }] } as Message,
      { role: 'tool', callId: 'c1', toolName: 'find', content: longBody() },
    ]);
    expect(isToolResultFolded(state, plan.find((node) => node.kind === 'toolcall'))).toBe(false);
    expect(isToolResultFolded(state, undefined)).toBe(false);
  });
});

describe('the blank separator is scoped, not blanket', () => {
  function flatPlan() {
    return buildRenderPlan([
      { role: 'assistant', content: 'looking' } as Message,
      { role: 'tool', callId: 'c1', toolName: 'a', content: longBody() },
      { role: 'tool', callId: 'c2', toolName: 'b', content: longBody() },
      { role: 'assistant', content: 'the answer' } as Message,
    ], 0, {});
  }
  const state = { collapseState: new Map<string, boolean>(), assistantTurns: undefined };

  test('a fold followed by more tool machinery gets NO separator', () => {
    const plan = flatPlan();
    const firstResult = plan.findIndex((node) => node.kind !== 'toolcall' && node.message.role === 'tool');
    expect(trailingBlankAfter(state, plan[firstResult]!, plan[firstResult + 1])).toBe(false);
  });

  test('a fold followed by PROSE keeps its separator', () => {
    const plan = flatPlan();
    const lastResult = plan.map((node, i) => ({ node, i }))
      .filter((entry) => entry.node.kind !== 'toolcall' && entry.node.message.role === 'tool')
      .at(-1)!;
    expect(trailingBlankAfter(state, lastResult.node, plan[lastResult.i + 1])).toBe(true);
  });

  test('a fold at the very end still closes with its separator', () => {
    const plan = flatPlan();
    const lastResult = plan.map((node, i) => ({ node, i }))
      .filter((entry) => entry.node.kind !== 'toolcall' && entry.node.message.role === 'tool')
      .at(-1)!;
    expect(trailingBlankAfter(state, lastResult.node, undefined)).toBe(true);
  });

  test('prose is always followed by its separator', () => {
    const plan = flatPlan();
    expect(trailingBlankAfter(state, plan[0]!, plan[1])).toBe(true);
  });
});

describe('the rendered transcript matches those rules', () => {
  const run: Message[] = [
    { role: 'assistant', content: 'Running three lookups.' } as Message,
    { role: 'tool', callId: 'c1', toolName: 'a', content: longBody() },
    { role: 'tool', callId: 'c2', toolName: 'b', content: longBody() },
    { role: 'tool', callId: 'c3', toolName: 'c', content: longBody() },
    { role: 'assistant', content: 'Here is the answer.' } as Message,
  ];

  test('three folds are three adjacent rows, then ONE blank before the prose', () => {
    const rows = renderRows(run);
    const badgeIndexes = rows
      .map((row, index) => ({ row, index }))
      .filter((entry) => /▸ \d+ lines/.test(entry.row))
      .map((entry) => entry.index);
    expect(badgeIndexes.length).toBe(3);
    expect(badgeIndexes[1]! - badgeIndexes[0]!).toBe(1);
    expect(badgeIndexes[2]! - badgeIndexes[1]!).toBe(1);

    // Exactly one blank row separates the last fold from the answer.
    const answerIndex = rows.findIndex((row) => row.includes('Here is the answer.'));
    expect(answerIndex - badgeIndexes[2]!).toBe(2);
    expect(rows[badgeIndexes[2]! + 1]!.trim()).toBe('');
  });

  test('no frame rules and no second hidden-count anywhere in the transcript', () => {
    for (const row of renderRows(run)) {
      expect(row.includes('▄')).toBe(false);
      expect(row.includes('▀')).toBe(false);
      expect(row.includes('hidden')).toBe(false);
    }
  });
});

describe('thinking and compaction folds get the same one row', () => {
  const reasoning = Array.from({ length: 40 }, (_, i) => `reasoning step number ${i}`).join('\n');

  test('an expanded thinking block still renders in full', () => {
    const rows = renderRows(
      [{ role: 'assistant', content: 'answer', reasoningContent: reasoning } as Message],
      { config: { 'display.showThinking': true } },
    );
    expect(rows.filter((row) => row.includes('reasoning step number')).length).toBeGreaterThan(10);
  });

  test('a COLLAPSED thinking block is one row and leaks NO reasoning text', () => {
    const collapseState = new Map<string, boolean>([['msg_0_thinking', true]]);
    const rows = renderRows(
      [{ role: 'assistant', content: 'answer', reasoningContent: reasoning } as Message],
      { config: { 'display.showThinking': true }, collapseState },
    );
    const badgeRows = rows.filter((row) => /▸ \d+ lines/.test(row));
    expect(badgeRows.length).toBe(1);
    expect(badgeRows[0]!).toContain('thinking');
    // Deliberate: thinking is the ONE fold class that carries no preview.
    // Folding reasoning away and then printing its first line anyway would
    // show reasoning to someone who just asked not to see it.
    expect(badgeRows[0]!).not.toContain('reasoning step number');
    expect(rows.some((row) => row.includes('reasoning step number'))).toBe(false);
  });

  test('the folded thinking row uses the thinking border glyph, not the bullet', () => {
    const collapseState = new Map<string, boolean>([['msg_0_thinking', true]]);
    const rows = renderRows(
      [{ role: 'assistant', content: 'answer', reasoningContent: reasoning } as Message],
      { config: { 'display.showThinking': true }, collapseState },
    );
    const foldRow = rows.find((row) => /▸ \d+ lines/.test(row))!;
    expect(foldRow).toContain('▌');
    expect(foldRow).not.toContain('●');
  });

  test('a folded thinking block keeps ONE blank separating it from the prose', () => {
    const collapseState = new Map<string, boolean>([['msg_0_thinking', true]]);
    const rows = renderRows(
      [{ role: 'assistant', content: 'answer', reasoningContent: reasoning } as Message],
      { config: { 'display.showThinking': true }, collapseState },
    );
    const foldIndex = rows.findIndex((row) => /▸ \d+ lines/.test(row));
    const answerIndex = rows.findIndex((row) => row.includes('answer'));
    // A unit separator, not padding: the fold and the answer are different things.
    expect(answerIndex - foldIndex).toBe(2);
    expect(rows[foldIndex + 1]!.trim()).toBe('');
  });

  test('a compaction handoff folds to one row, with no framed box below it', () => {
    const rows = renderRows([
      { role: 'user', content: `${COMPACTION_HANDOFF_HEADER}\nline two\nline three\nline four` } as Message,
    ]);
    const badgeRows = rows.filter((row) => /▸ \d+ lines/.test(row));
    expect(badgeRows.length).toBe(1);
    expect(badgeRows[0]!).toContain('compaction handoff');
    expect(badgeRows[0]!).toContain('compacted-context handoff');
    for (const row of rows) {
      expect(row.includes('▄')).toBe(false);
      expect(row.includes('▀')).toBe(false);
    }
  });
});
