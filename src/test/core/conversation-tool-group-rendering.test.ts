// ---------------------------------------------------------------------------
// conversation-tool-group-rendering.test.ts — end-to-end transcript behaviour
// for folded tool-result groups (see src/core/conversation-tool-groups.ts and
// renderToolGroupHeader / renderConversationToolMessage in
// src/core/conversation-rendering.ts).
//
// The defect this guards: an assistant turn with N tool calls used to render N
// independent "● tool result <name> · 1 line" header+preview blocks in a row,
// which drowned the conversation. A run of >=2 results now folds under one
// "▌ tool results · N tools · M lines" header, collapsed by default, and
// expands back to the individual results on demand.
// ---------------------------------------------------------------------------

import { describe, test, expect } from 'bun:test';
import { ConversationManager } from '../../core/conversation';

const WIDTH = 100;

function transcript(cm: ConversationManager): string {
  return cm.getDisplayBlocks()
    .map((line) => line.map((cell) => cell.char).join('').replace(/\s+$/, ''))
    .join('\n');
}

/** A conversation whose single assistant turn ran two web searches — the same
 *  shape as the reported per-result spam. */
function twoSearchTurn(): ConversationManager {
  const cm = new ConversationManager(() => WIDTH);
  cm.addUserMessage('compare two libraries');
  cm.addAssistantMessage('Searching for both.', {
    toolCalls: [
      { id: 'call-1', name: 'web_search', arguments: { query: 'library one' } },
      { id: 'call-2', name: 'web_search', arguments: { query: 'library two' } },
    ],
  });
  cm.addToolResults([
    { callId: 'call-1', success: true, output: JSON.stringify({ results: [{ title: 'one', snippet: 'first result body' }] }) },
    { callId: 'call-2', success: true, output: JSON.stringify({ results: [{ title: 'two', snippet: 'second result body' }] }) },
  ]);
  return cm;
}

describe('folded tool-result groups', () => {
  test('two results from one turn collapse to a single group header instead of two tool-result blocks', () => {
    const text = transcript(twoSearchTurn());

    expect(text).toContain('tool results');
    expect(text).toContain('2 tools');
    // The per-result headers are gone while folded — that is the whole point.
    expect(text).not.toContain('tool result ');
    expect(text.split('\n').filter((l) => l.includes('tool results')).length).toBe(1);
  });

  test('the group header names the tools it folded, deduplicated with a count', () => {
    const text = transcript(twoSearchTurn());
    // Both calls are web_search, so the header says the friendly label once
    // with a ×2 count rather than repeating it.
    expect(text).toContain('Searching the web×2');
  });

  test('the header line count is the EXPANDED render total, not the raw content line count', () => {
    const cm = twoSearchTurn();
    // Both results are single-line JSON blobs; expanded they pretty-print to
    // many more lines. A raw count would say 2.
    const headerLine = transcript(cm).split('\n').find((l) => l.includes('tool results'))!;
    expect(cm.getBlockRegistry().find((b) => b.type === 'tool_group')).toBeDefined();
    const match = /(\d+) lines/.exec(headerLine);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(2);
  });

  test('a single tool result is left exactly as it was — no group header', () => {
    const cm = new ConversationManager(() => WIDTH);
    cm.addUserMessage('search once');
    cm.addAssistantMessage('Searching.', {
      toolCalls: [{ id: 'call-1', name: 'web_search', arguments: { query: 'one' } }],
    });
    cm.addToolResults([{ callId: 'call-1', success: true, output: 'a short result' }]);

    const text = transcript(cm);
    expect(text).not.toContain('tool results');
    expect(text).toContain('tool result');
  });

  test('expanding the group reveals every member as its own tool-result block', () => {
    const cm = twoSearchTurn();
    cm.getDisplayBlocks();
    const group = cm.getBlockRegistry().find((b) => b.type === 'tool_group')!;

    cm.setCollapsed(group.collapseKey, false);
    for (const memberIdx of group.groupMemberIndexes ?? []) {
      cm.setCollapsed(`msg_${memberIdx}`, false);
    }

    const text = transcript(cm);
    expect(text).toContain('tool results'); // header stays, now marked expanded
    expect(text).toContain('first result body');
    expect(text).toContain('second result body');
  });

  test('the group block carries every member index so one expand pass can open them all', () => {
    const cm = twoSearchTurn();
    cm.getDisplayBlocks();
    const group = cm.getBlockRegistry().find((b) => b.type === 'tool_group')!;
    // user=0, assistant=1, tool results=2,3
    expect(group.groupMemberIndexes).toEqual([2, 3]);
    expect(group.collapseKey).toBe('group_1');
  });

  test('a folded member registers no block of its own, and its message line anchors at the group header', () => {
    const cm = twoSearchTurn();
    cm.getDisplayBlocks();
    const group = cm.getBlockRegistry().find((b) => b.type === 'tool_group')!;

    // Neither member has a msg_<idx> block while the group is folded.
    expect(cm.getBlockRegistry().find((b) => b.collapseKey === 'msg_2')).toBeUndefined();
    expect(cm.getBlockRegistry().find((b) => b.collapseKey === 'msg_3')).toBeUndefined();

    // Both members resolve to the group header line rather than to whatever
    // renders after them, so transcript navigation lands on the group.
    expect(cm.getMessageLine(2)).toBe(group.startLine);
    expect(cm.getMessageLine(3)).toBe(group.startLine);
  });

  test('a folded member contributes no blank separator line', () => {
    const folded = transcript(twoSearchTurn()).split('\n');
    const cm = twoSearchTurn();
    cm.getDisplayBlocks();
    const group = cm.getBlockRegistry().find((b) => b.type === 'tool_group')!;
    // The header occupies exactly one line, followed by its single separator —
    // the second (folded) member adds nothing at all.
    expect(group.lineCount).toBe(1);
    expect(folded[group.startLine]).toContain('tool results');
    expect(folded[group.startLine + 1]?.trim()).toBe('');
  });

  test('a growing run re-renders the header with the updated counts', () => {
    const cm = twoSearchTurn();
    const before = /(\d+) tools/.exec(transcript(cm).split('\n').find((l) => l.includes('tool results'))!)![1];
    expect(before).toBe('2');

    // A third result for the same assistant turn joins the same group.
    cm.addToolResults([{ callId: 'call-3', success: true, output: 'third' }]);
    // call-3 is not in the assistant's toolCalls, so it must NOT join.
    expect(/(\d+) tools/.exec(transcript(cm).split('\n').find((l) => l.includes('tool results'))!)![1]).toBe('2');
  });

  test('two separate assistant turns fold into two independent groups', () => {
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
    const groups = cm.getBlockRegistry().filter((b) => b.type === 'tool_group');
    expect(groups.length).toBe(2);
    expect(new Set(groups.map((g) => g.collapseKey)).size).toBe(2);
  });

  test('toggling the group header at its line collapses and re-expands the whole run', () => {
    const cm = twoSearchTurn();
    cm.getDisplayBlocks();
    const group = cm.getBlockRegistry().find((b) => b.type === 'tool_group')!;

    cm.toggleCollapseAtLine(group.startLine); // -> expanded
    const expanded = transcript(cm);
    expect(expanded).toContain('tool result');

    const groupAfter = cm.getBlockRegistry().find((b) => b.type === 'tool_group')!;
    cm.toggleCollapseAtLine(groupAfter.startLine); // -> collapsed again
    const recollapsed = transcript(cm);
    expect(recollapsed).not.toContain('first result body');
    expect(recollapsed).toContain('2 tools');
  });
});
