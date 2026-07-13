/**
 * Fleet honesty on the activity sidebar: agent rows render the fleet
 * read-model's per-node headline (replaced in place — never a feed) and the
 * stall tell as a quiet-duration marker.
 */
import { describe, expect, test } from 'bun:test';
import { buildActivitySidebarLines } from '../../renderer/activity-sidebar.ts';
import type { Line } from '../../types/grid.ts';

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
});
