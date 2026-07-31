/**
 * renderSessionPickerModal — renders the /sessions picker modal as Line[]
 * using ModalFactory.
 *
 * Shows a list of saved sessions with:
 *   - name, timestamp (formatted), message count
 * Footer hints: [Enter] Load  [Esc] Close
 */

import type { Line } from '@pellux/goodvibes-sdk/platform/types';
import { ModalFactory } from './modal-factory.ts';
import type { SessionPickerModal } from '../input/session-picker-modal.ts';
import { renderSessionPickerStatePackageText } from '../input/session-picker-modal.ts';
import { formatTimestamp } from './modal-utils.ts';
import { fitDisplay } from '../utils/terminal-width.ts';
import { getOverlaySurfaceMetrics, getStableOverlayContentRows } from '@pellux/goodvibes-terminal-shell';

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function renderSessionPickerPackageText(): string {
  return [
    'Sessions',
    'No saved sessions.',
    'Open Agent Workspace -> Conversation -> Save current session.',
    'Name',
    'Saved',
    'Msgs',
    '[\u2191\u2193] Navigate',
    '[Enter] Load',
    'Delete: /session delete <id> --yes',
    '[Esc] Close',
    renderSessionPickerStatePackageText(),
  ].join('\n');
}

/**
 * Render the session picker modal as Line[] for overlay in the viewport.
 *
 * @param modal  SessionPickerModal state object.
 * @param width  Terminal width.
 */
export function renderSessionPickerModal(
  modal: SessionPickerModal,
  width: number,
  viewportHeight = 24,
): Line[] {
  const metrics = getOverlaySurfaceMetrics(width, viewportHeight, {
    chromeRows: 6,
    minContentRows: 5,
    maxContentRows: 9,
  });
  const boxMargin = metrics.margin;
  const boxW = metrics.boxWidth;
  const contentW = metrics.contentWidth;
  const visibleRows = metrics.contentRows;
  const targetContentRows = getStableOverlayContentRows(metrics.contentRows, 8);
  modal.setVisibleRows(visibleRows);

  const sections: import('./modal-factory.ts').ModalSection[] = [];

  if (modal.sessions.length === 0) {
    sections.push({
      type: 'text',
      content: 'No saved sessions.',
      style: { fg: '244', dim: true },
    });
    sections.push({
      type: 'text',
      content: 'Open Agent Workspace -> Conversation -> Save current session.',
      style: { fg: '240', dim: true },
    });
  } else {
    // Column widths: name(24) | timestamp(16) | messages(remaining)
    const nameW = 24;
    const tsW = 16;
    const msgW = Math.max(4, contentW - nameW - tsW - 4); // 4 = separators/spaces

    // Column header
    const nameHdr = fitDisplay('Name', nameW);
    const tsHdr   = fitDisplay('Saved', tsW);
    const msgHdr  = fitDisplay('Msgs', msgW);
    sections.push({
      type: 'text',
      content: `${nameHdr}  ${tsHdr}  ${msgHdr}`,
      style: { fg: '240', dim: true },
    });
    sections.push({ type: 'separator' });

    const visibleSessions = modal.sessions.slice(modal.scrollOffset, modal.scrollOffset + visibleRows);
    const listItems: import('./modal-factory.ts').ModalListItem[] = visibleSessions.map((sess, idx) => {
      const isSelected = modal.scrollOffset + idx === modal.selectedIndex;

      const nameStr = fitDisplay(sess.name, nameW);

      const tsStr = fitDisplay(formatTimestamp(sess.timestamp), tsW);
      const msgStr = fitDisplay(String(sess.messageCount), msgW);

      const label = `${nameStr}  ${tsStr}  ${msgStr}`;
      return { label, selected: isSelected };
    });

    sections.push({ type: 'list', items: listItems });
    if (modal.sessions.length > visibleRows) {
      sections.push({ type: 'separator' });
      sections.push({
        type: 'text',
        content: `[${modal.scrollOffset + 1}-${Math.min(modal.sessions.length, modal.scrollOffset + visibleRows)} of ${modal.sessions.length}]`,
        style: { fg: '244', dim: true },
      });
    }
  }

  // Status message if present
  if (modal.statusMessage) {
    sections.push({ type: 'separator' });
    sections.push({
      type: 'text',
      content: modal.statusMessage,
      style: { fg: modal.deleteConfirmationTarget ? '#f59e0b' : '#00ffcc' },
    });
  }

  return ModalFactory.createModal(
    {
      title: 'Sessions',
      width: boxW,
      margin: boxMargin,
      targetContentRows,
      sections,
      hints: ['[\u2191\u2193] Navigate', '[Enter] Load', 'Delete: /session delete <id> --yes', '[Esc] Close'],
    },
    width,
  );
}
