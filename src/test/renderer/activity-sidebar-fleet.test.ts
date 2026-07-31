/**
 * Fleet honesty on the activity sidebar: agent rows render the fleet
 * read-model's per-node headline (replaced in place — never a feed) and the
 * stall tell as a quiet-duration marker.
 */
import { describe, expect, test } from 'bun:test';
import { buildActivitySidebarLines, buildSidebarAgentRows } from '../../renderer/activity-sidebar.ts';
import type { Line } from '@pellux/goodvibes-sdk/platform/types';

function textOf(line: Line): string {
  return line.map((cell) => cell.char).join('');
}

function render(agents: Parameters<typeof buildActivitySidebarLines>[0]['now']['agents']): string[] {
  const lines = buildActivitySidebarLines({
    now: { busy: false, agents, processes: 0 },
    needsYou: [],
    comingUp: [],
    recent: [],
  }, 44, 16);
  return lines.map(textOf);
}

describe('activity sidebar fleet rows', () => {
  test('renders the fleet headline for an agent row when present', () => {
    const rows = render([{ label: 'researcher', progress: 'Turn 12 · Bash', headline: 'Summarize the audit' }]);
    const agentRow = rows.find((line) => line.includes('researcher'));
    expect(agentRow).toBeDefined();
    expect(agentRow).toContain('Summarize the audit');
    // The headline WINS over the per-turn progress churn (a feed, not a transition).
    expect(agentRow).not.toContain('Turn 12');
  });

  test('falls back to the progress line when no headline exists', () => {
    const rows = render([{ label: 'researcher', progress: 'gathering sources' }]);
    const agentRow = rows.find((line) => line.includes('researcher'));
    expect(agentRow).toContain('gathering sources');
  });

  test('renders the stall tell as a quiet-duration marker', () => {
    const rows = render([{ label: 'builder', headline: 'Compile the release', quietForMs: 6 * 60_000 }]);
    const agentRow = rows.find((line) => line.includes('builder'));
    expect(agentRow).toContain('quiet 6m');
  });

  test('no quiet marker renders for an active row', () => {
    const rows = render([{ label: 'builder', headline: 'Compile the release' }]);
    const agentRow = rows.find((line) => line.includes('builder'));
    expect(agentRow).not.toContain('quiet');
  });

  test('hour-scale stalls render compactly', () => {
    const rows = render([{ label: 'builder', quietForMs: 90 * 60_000 }]);
    const agentRow = rows.find((line) => line.includes('builder'));
    expect(agentRow).toContain('quiet 1h 30m');
  });

  test('buildSidebarAgentRows joins agents to fleet nodes by id', () => {
    const rows = buildSidebarAgentRows(
      [
        { id: 'a-1', label: 'researcher', latestProgress: ' Turn 3 · Read ' },
        { id: 'a-2', label: 'builder' },
      ],
      [
        { id: 'a-1', headline: { text: 'Map the audit scope' }, stall: { quietForMs: 120_000 } },
        { id: 'unrelated-node' },
      ],
    );
    expect(rows).toEqual([
      { label: 'researcher', progress: 'Turn 3 · Read', headline: 'Map the audit scope', quietForMs: 120_000 },
      { label: 'builder', progress: undefined, headline: undefined, quietForMs: undefined },
    ]);
  });

  test('a live agent node no local agent carries is shown as running elsewhere', () => {
    const rows = buildSidebarAgentRows(
      [{ id: 'a-1', label: 'researcher' }],
      [
        { id: 'a-1', kind: 'agent', state: 'running' },
        { id: 'd-9', kind: 'agent', state: 'running', label: 'nightly digest', headline: { text: 'Summarizing inbox' } },
      ],
    );
    expect(rows).toEqual([
      { label: 'researcher', progress: undefined, headline: undefined, quietForMs: undefined },
      { label: 'nightly digest (elsewhere)', headline: 'Summarizing inbox', quietForMs: undefined },
    ]);
  });

  test('rows this process runs keep the room: three local agents leave none for elsewhere', () => {
    const rows = buildSidebarAgentRows(
      [
        { id: 'a-1', label: 'one' },
        { id: 'a-2', label: 'two' },
        { id: 'a-3', label: 'three' },
        { id: 'a-4', label: 'four' },
      ],
      [{ id: 'd-9', kind: 'agent', state: 'running', label: 'nightly digest' }],
    );
    expect(rows.map((row) => row.label)).toEqual(['one', 'two', 'three']);
  });

  test('finished work and non-agent nodes from elsewhere are not rows', () => {
    const rows = buildSidebarAgentRows(
      [],
      [
        { id: 'd-1', kind: 'agent', state: 'completed', label: 'finished digest' },
        { id: 'd-2', kind: 'process', state: 'running', label: 'a background command' },
        { id: 'd-3', kind: 'agent', state: 'blocked', label: 'waiting on approval' },
      ],
    );
    expect(rows.map((row) => row.label)).toEqual(['waiting on approval (elsewhere)']);
  });
});
