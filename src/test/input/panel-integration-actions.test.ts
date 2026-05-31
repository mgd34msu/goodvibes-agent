import { afterEach, describe, expect, mock, test } from 'bun:test';
import { handlePanelIntegrationAction } from '../../input/handler.ts';
import { ApprovalPanel } from '../../panels/approval-panel.ts';
import { PolicyRuntimeState } from '@/runtime/index.ts';
import { createTestManagers } from '../helpers/test-managers.ts';

let panelManager = createTestManagers().panelManager;

describe('panel integration actions', () => {
  afterEach(() => {
    panelManager.destroyAll();
    mock.restore();
  });

  test('approval enter executes the selected review command', async () => {
    const executeCommand = mock(async () => true);
    const panel = new ApprovalPanel(new PolicyRuntimeState());
    panel.handleInput('down');

    expect(handlePanelIntegrationAction(panelManager, panel, 'enter', { executeCommand } as never)).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith('approval', ['review', 'file']);
  });
});
