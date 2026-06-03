import { describe, expect, test } from 'bun:test';
import { SessionBrowserPanel } from '../../panels/session-browser-panel.ts';
import type { SessionBrowserQuery } from '../../runtime/ui-service-queries.ts';
import type { Line } from '../../types/grid.ts';

function linesText(lines: Line[]): string {
  return lines
    .map((line) => line.map((cell) => cell.char ?? ' ').join('').trimEnd())
    .filter(Boolean)
    .join('\n');
}

describe('SessionBrowserPanel', () => {
  test('labels return-context remote entries as runners', () => {
    const session = {
      name: 'session-a',
      title: 'Recover deployment review',
      titleSource: 'user',
      model: 'provider:model',
      timestamp: Date.parse('2026-06-02T10:00:00Z'),
      messageCount: 12,
      returnContext: {
        activityLabel: 'delegated review',
        statusLabel: 'awaiting recovery',
        activeTasks: 1,
        blockedTasks: 0,
        pendingApprovals: 0,
        remoteRunners: ['runner-a', 'runner-b'],
        openPanels: ['approval'],
      },
    };
    const query = {
      list: () => [session],
      search: () => [{ session }],
      delete: () => true,
    } as unknown as SessionBrowserQuery;
    const panel = new SessionBrowserPanel(query);

    panel.onActivate();
    const text = linesText(panel.render(140, 24));
    panel.onDestroy();

    expect(text).toContain('remote runners: runner-a, runner-b');
    expect(text).not.toContain('remote workers');
  });
});
