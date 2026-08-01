// ---------------------------------------------------------------------------
// conversation-assistant-turn-rendering.test.ts — end-to-end transcript
// behaviour for merged assistant turns (see src/core/conversation-turn-structure.ts
// and renderConversationAssistantMessage / renderConversationToolCallNode /
// renderConversationToolMessage in src/core/conversation-rendering.ts).
//
// The defect this guards: an assistant turn with N tool calls used to render N
// independent "● assistant" headers and N "● tool result <name> · 1 line"
// header+preview blocks in a row, which drowned the conversation. A run now
// carries ONE "● assistant · N tools" header with its tool activity hanging
// beneath it as a box-drawing tree (turn -> call -> result).
//
// This file previously covered the retired 'tool_group' folding model. Every
// guarantee it made is re-asserted here against 'assistant_turn': one header
// per run, a shared tool label named once, honest expanded-render line counts,
// results reachable on expand, hidden rows anchoring navigation at their turn
// header, independent turns staying independent, and the header toggling the
// whole run. The two guarantees the new model ADDS — turns default to
// EXPANDED, and collapsing never hides prose — are covered here too.
// ---------------------------------------------------------------------------

import { describe, test, expect } from 'bun:test';
import { ConversationManager } from '../../core/conversation';
import { renderExpandedToolResultLines } from '../../renderer/tool-result-expanded-lines.ts';
import { treeBranchCol } from '@pellux/goodvibes-terminal-shell';

const WIDTH = 100;

function transcript(cm: ConversationManager): string {
  return cm.getDisplayBlocks()
    .map((line) => line.map((cell) => cell.char).join('').replace(/\s+$/, ''))
    .join('\n');
}

const RESULT_A = JSON.stringify({ results: [{ title: 'one', snippet: 'first result body' }] });
const RESULT_B = JSON.stringify({ results: [{ title: 'two', snippet: 'second result body' }] });

/** A conversation whose single assistant turn ran two web searches — the same
 *  shape as the reported per-result spam. */
function twoSearchTurn(): ConversationManager {
  const cm = new ConversationManager(() => WIDTH);
  cm.addUserMessage('compare two libraries');            // absolute index 0
  cm.addAssistantMessage('Searching for both.', {        // absolute index 1
    toolCalls: [
      { id: 'call-1', name: 'web_search', arguments: { query: 'library one' } },
      { id: 'call-2', name: 'web_search', arguments: { query: 'library two' } },
    ],
  });
  cm.addToolResults([                                     // absolute indexes 2, 3
    { callId: 'call-1', success: true, output: RESULT_A },
    { callId: 'call-2', success: true, output: RESULT_B },
  ]);
  return cm;
}

/** The same conversation with its turn explicitly collapsed. Turns default to
 *  EXPANDED, so every hidden-row assertion has to create that state itself. */
function collapsedTurn(): ConversationManager {
  const cm = twoSearchTurn();
  cm.getDisplayBlocks();
  cm.setCollapsed('turn_1', true);
  cm.getDisplayBlocks();
  return cm;
}

describe('merged assistant turns', () => {
  test('two calls from one turn share ONE assistant header instead of one header each', () => {
    const text = transcript(twoSearchTurn());

    expect(text.split('\n').filter((l) => l.includes('assistant')).length).toBe(1);
    expect(text).toContain('2 tools');
    // The per-result "tool result" headers are gone — each result hangs under
    // its own call row, which already names the call.
    expect(text).not.toContain('tool result');
  });

  test('a label every call shares is hoisted to the header exactly once', () => {
    const text = transcript(twoSearchTurn());
    // Both calls are web_search, so the friendly label rides on the header and
    // appears once — not repeated on both branch rows.
    expect(text.split('\n').filter((l) => l.includes('Searching the web')).length).toBe(1);
    // With the label hoisted, each branch leads with what distinguishes it.
    expect(text).toContain('library one');
    expect(text).toContain('library two');
  });

  test('differing tool labels are left on the rows, not hoisted', () => {
    const cm = new ConversationManager(() => WIDTH);
    cm.addUserMessage('read then run');
    cm.addAssistantMessage('working', {
      toolCalls: [
        { id: 'r1', name: 'read', arguments: { path: 'foo.ts' } },
        { id: 'x1', name: 'exec', arguments: { cmd: 'ls -la' } },
      ],
    });
    cm.addToolResults([
      { callId: 'r1', success: true, output: 'contents' },
      { callId: 'x1', success: true, output: 'listing' },
    ]);
    const cmText = transcript(cm);
    const turn = cm.getBlockRegistry().find((b) => b.type === 'assistant_turn')!;
    expect(turn.toolName).toBeUndefined();
    // Each row still names its own tool.
    expect(cmText).toContain('foo.ts');
    expect(cmText).toContain('ls -la');
  });

  test("each result's line badge is the EXPANDED render count, not the raw content line count", () => {
    const cm = twoSearchTurn();
    const text = transcript(cm);
    // Both results are single-line JSON blobs; expanded they pretty-print to
    // many more lines. A raw count would say 1.
    const expectedA = renderExpandedToolResultLines(RESULT_A, WIDTH).length;
    const expectedB = renderExpandedToolResultLines(RESULT_B, WIDTH).length;
    expect(expectedA).toBeGreaterThan(1);
    expect(text).toContain(`${expectedA} lines`);
    expect(text).toContain(`${expectedB} lines`);
  });

  test('a single tool call still hangs under its turn header and carries its own badge', () => {
    const cm = new ConversationManager(() => WIDTH);
    cm.addUserMessage('search once');
    cm.addAssistantMessage('Searching.', {
      toolCalls: [{ id: 'call-1', name: 'web_search', arguments: { query: 'one' } }],
    });
    cm.addToolResults([{ callId: 'call-1', success: true, output: 'a short result' }]);

    const text = transcript(cm);
    expect(text).toContain('1 tool');
    expect(text).not.toContain('2 tools');
    // The call row names the query; the result hangs beneath it with a badge.
    expect(text).toContain('one');
    expect(text).toMatch(/\d+ line/);
    // The opaque call id never stands in for a real name on a tree row.
    expect(text).not.toContain('call-1');
  });

  test('a turn defaults to EXPANDED — its tool activity is visible with no interaction', () => {
    const cm = twoSearchTurn();
    const text = transcript(cm);
    const turn = cm.getBlockRegistry().find((b) => b.type === 'assistant_turn')!;
    expect(cm.isCollapsed(turn.blockIndex)).toBe(false);
    expect(text).toContain('first result body');
    expect(text).toContain('second result body');
  });

  test('collapsing a turn hides its tool machinery but NEVER its prose', () => {
    const text = transcript(collapsedTurn());
    expect(text).toContain('Searching for both.');   // the answer survives
    expect(text).toContain('hidden');                 // and says it is folded
    expect(text).not.toContain('first result body');
    expect(text).not.toContain('library one');
  });

  test('the turn block carries every result index so one expand pass can open them all', () => {
    const cm = twoSearchTurn();
    cm.getDisplayBlocks();
    const turn = cm.getBlockRegistry().find((b) => b.type === 'assistant_turn')!;
    // user=0, assistant=1, tool results=2,3
    expect(turn.groupMemberIndexes).toEqual([2, 3]);
    expect(turn.collapseKey).toBe('turn_1');
  });

  test('a hidden result registers no block of its own, and its message line anchors at the turn header', () => {
    const cm = collapsedTurn();
    const turn = cm.getBlockRegistry().find((b) => b.type === 'assistant_turn')!;

    // Neither result has a msg_<idx> block while the turn is collapsed.
    expect(cm.getBlockRegistry().find((b) => b.collapseKey === 'msg_2')).toBeUndefined();
    expect(cm.getBlockRegistry().find((b) => b.collapseKey === 'msg_3')).toBeUndefined();

    // Both resolve to the turn header line rather than to whatever renders
    // after them, so transcript navigation lands on the turn.
    expect(cm.getMessageLine(2)).toBe(turn.startLine);
    expect(cm.getMessageLine(3)).toBe(turn.startLine);
  });

  test('a hidden result contributes no blank separator line', () => {
    const cm = collapsedTurn();
    const lines = transcript(cm).split('\n');
    const turn = cm.getBlockRegistry().find((b) => b.type === 'assistant_turn')!;
    // The header occupies exactly one line; the rows it hides add nothing.
    expect(turn.lineCount).toBe(1);
    expect(lines[turn.startLine]).toContain('assistant');
    // Only the prose follows it — no stray blanks from the hidden rows.
    expect(lines[turn.startLine + 1]).toContain('Searching for both.');
  });

  test('a result arriving for a call the turn never issued does not join the run', () => {
    const cm = twoSearchTurn();
    const headerOf = (c: ConversationManager) =>
      transcript(c).split('\n').find((l) => l.includes('assistant'))!;
    expect(/(\d+) tools/.exec(headerOf(cm))![1]).toBe('2');

    // call-3 is not in the assistant's toolCalls, so the count must not move.
    cm.addToolResults([{ callId: 'call-3', success: true, output: 'third' }]);
    expect(/(\d+) tools/.exec(headerOf(cm))![1]).toBe('2');
  });

  test('two assistant turns separated by prose stay two independent turn blocks', () => {
    const cm = new ConversationManager(() => WIDTH);
    cm.addUserMessage('do it twice');
    cm.addAssistantMessage('first pass', {
      toolCalls: [{ id: 'a1', name: 'read', arguments: {} }, { id: 'a2', name: 'read', arguments: {} }],
    });
    cm.addToolResults([
      { callId: 'a1', success: true, output: 'alpha' },
      { callId: 'a2', success: true, output: 'beta' },
    ]);
    cm.addAssistantMessage('second pass', {
      toolCalls: [{ id: 'b1', name: 'exec', arguments: {} }, { id: 'b2', name: 'exec', arguments: {} }],
    });
    cm.addToolResults([
      { callId: 'b1', success: true, output: 'gamma' },
      { callId: 'b2', success: true, output: 'delta' },
    ]);

    cm.getDisplayBlocks();
    const turns = cm.getBlockRegistry().filter((b) => b.type === 'assistant_turn');
    expect(turns.length).toBe(2);
    expect(new Set(turns.map((t) => t.collapseKey)).size).toBe(2);
  });

  test('consecutive tool-only assistant messages merge into ONE header', () => {
    const cm = new ConversationManager(() => WIDTH);
    cm.addUserMessage('chain three calls');
    cm.addAssistantMessage('', { toolCalls: [{ id: 'c1', name: 'read', arguments: {} }] });
    cm.addToolResults([{ callId: 'c1', success: true, output: 'one' }]);
    cm.addAssistantMessage('', { toolCalls: [{ id: 'c2', name: 'read', arguments: {} }] });
    cm.addToolResults([{ callId: 'c2', success: true, output: 'two' }]);
    cm.addAssistantMessage('', { toolCalls: [{ id: 'c3', name: 'read', arguments: {} }] });
    cm.addToolResults([{ callId: 'c3', success: true, output: 'three' }]);

    const text = transcript(cm);
    // Three tool-only messages, one header, one aggregate count.
    expect(text.split('\n').filter((l) => l.includes('assistant')).length).toBe(1);
    expect(text).toContain('3 tools');
    expect(cm.getBlockRegistry().filter((b) => b.type === 'assistant_turn').length).toBe(1);

    // The merged run's calls are SIBLINGS of each other, so their connectors
    // read ├ ├ └. They attach to the run's head node rather than to their own
    // (headerless) assistant message — attaching each to its own message would
    // make every one of them an only child and render three └ in a row.
    const callConnectors = text.split('\n')
      .filter((l) => /[├└]/.test(l) && !l.includes('line'))
      .map((l) => (l.includes('├') ? '├' : '└'));
    expect(callConnectors).toEqual(['├', '├', '└']);
  });

  test('toggling the turn header at its line collapses and re-expands the whole run', () => {
    const cm = twoSearchTurn();
    cm.getDisplayBlocks();
    const turn = cm.getBlockRegistry().find((b) => b.type === 'assistant_turn')!;

    cm.toggleCollapseAtLine(turn.startLine); // expanded -> collapsed
    const collapsed = transcript(cm);
    expect(collapsed).not.toContain('first result body');
    expect(collapsed).toContain('2 tools');
    expect(collapsed).toContain('Searching for both.'); // prose is never hidden

    const turnAfter = cm.getBlockRegistry().find((b) => b.type === 'assistant_turn')!;
    cm.toggleCollapseAtLine(turnAfter.startLine); // collapsed -> expanded again
    const reExpanded = transcript(cm);
    expect(reExpanded).toContain('first result body');
    expect(reExpanded).toContain('second result body');
  });

  test('each tool call renders as its own branch row with a proper connector', () => {
    const lines = transcript(twoSearchTurn()).split('\n');
    const callRows = lines.filter((l) => /[├└]/.test(l) && (l.includes('library one') || l.includes('library two')));
    expect(callRows.length).toBe(2);
    // First of two siblings continues the subtree; the last one closes it.
    expect(callRows[0]).toContain('├');
    expect(callRows[1]).toContain('└');
    // Each settled call carries its status glyph in the BULLET column — the
    // same column the `● assistant` header above it draws its bullet in, not a
    // separate gutter off to the left of the transcript.
    const bulletCol = treeBranchCol(0);
    const headerRow = lines.find((l) => l.includes('assistant'))!;
    expect(headerRow[bulletCol]).toBe('●');
    for (const row of callRows) expect(row[bulletCol]).toBe('✓');
  });
});
