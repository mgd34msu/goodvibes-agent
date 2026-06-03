import { describe, expect, test } from 'bun:test';
import { ApprovalPanel } from '../../panels/approval-panel.ts';
import { PolicyRuntimeState } from '@/runtime/index.ts';

describe('ApprovalPanel', () => {
  test('renders action-specific approval workspace guidance', () => {
    const panel = new ApprovalPanel(new PolicyRuntimeState());
    const text = panel.render(100, 24).flat().map((cell) => cell.char).join('');
    expect(text).toContain('Approval Control Room');
    expect(text).toContain('Approval posture');
    expect(text).toContain('shell');
    expect(text).toContain('mcp');
    expect(text).toContain('what-if');
    expect(text).toContain('/approval review shell');
    expect(text).toContain('/security review');
    expect(text).not.toContain('/policy');
    expect(text).not.toContain('/cockpit');
    expect(text).not.toContain('/hooks');
    expect(text).not.toContain('/marketplace');
  });

  test('supports selecting an approval lane', () => {
    const panel = new ApprovalPanel(new PolicyRuntimeState());
    expect(panel.handleInput('down')).toBe(true);
    const text = panel.render(100, 18).flat().map((cell) => cell.char).join('');
    expect(text).toContain('Selected Lane');
    expect(text).toContain('file');
    expect(text).toContain('/approval review file');
  });

  test('dispatches every approval lane through a visible Agent review command', () => {
    const panel = new ApprovalPanel(new PolicyRuntimeState());
    const commands: string[] = [];
    commands.push(panel.getSelectedCommand() ?? '');
    for (let index = 1; index < 8; index++) {
      expect(panel.handleInput('down')).toBe(true);
      commands.push(panel.getSelectedCommand() ?? '');
    }

    expect(commands).toEqual([
      '/approval review shell',
      '/approval review file',
      '/approval review network',
      '/approval review delegate',
      '/approval review mcp',
      '/approval review remote',
      '/approval review hook',
      '/approval review plugin',
    ]);
  });
});
