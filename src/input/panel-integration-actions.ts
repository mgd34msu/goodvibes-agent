import type { CommandContext } from './command-registry.ts';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import type { Panel } from '../panels/types.ts';
import type { PanelManager } from '../panels/panel-manager.ts';
import { ApprovalPanel } from '../panels/approval-panel.ts';

export function handlePanelIntegrationAction(
  panelManager: PanelManager,
  activePanel: Panel | null,
  key: string,
  commandContext?: CommandContext,
): boolean {
  if (!activePanel) return false;

  if ((key === 'enter' || key === 'return') && activePanel instanceof ApprovalPanel) {
    const command = activePanel.getSelectedCommand();
    if (!command || !commandContext?.executeCommand) return false;
    const parts = command.replace(/^\//, '').split(/\s+/).filter(Boolean);
    const [name, ...args] = parts;
    if (!name) return false;
    void commandContext.executeCommand(name, args).catch((err) => { logger.debug('approval panel command dispatch failed', { err }); });
    return true;
  }

  return false;
}
