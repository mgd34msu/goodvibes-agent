import { describe, expect, test } from 'bun:test';
import { AutomationControlPanel } from '../../panels/automation-control-panel.ts';
import type { Line } from '../../types/grid.ts';

function linesText(lines: Line[]): string {
  return lines
    .map((line) => line.map((cell) => cell.char ?? ' ').join('').trimEnd())
    .filter(Boolean)
    .join('\n');
}

describe('AutomationControlPanel', () => {
  test('renders unavailable state as a read-only operator view', () => {
    const panel = new AutomationControlPanel();
    const text = linesText(panel.render(120, 12));

    expect(text).toContain('Automation Control');
    expect(text).toContain('Connected-host automation state is unavailable');
    expect(text).toContain('This operator view is read-only');
    expect(text).toContain('/schedule list');
    expect(text).not.toContain('deferred');
  });
});
