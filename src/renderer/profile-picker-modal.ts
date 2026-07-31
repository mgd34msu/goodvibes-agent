/**
 * renderProfilePickerModal — renders the Agent profile picker modal as Line[]
 * using ModalFactory.
 *
 * Shows a list of saved profiles with:
 *   - name, timestamp (formatted), settings preview
 * Footer hints: [Up/Down] Navigate  [Enter] Load  [Esc] Close
 */

import type { Line } from '@pellux/goodvibes-sdk/platform/types';
import { ModalFactory } from './modal-factory.ts';
import type { ProfilePickerModal } from '../input/profile-picker-modal.ts';
import { renderProfilePickerStatePackageText } from '../input/profile-picker-modal.ts';
import { formatTimestamp } from './modal-utils.ts';
import { fitDisplay } from '../utils/terminal-width.ts';
import { getOverlaySurfaceMetrics, getStableOverlayContentRows } from '@pellux/goodvibes-terminal-shell';

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function renderProfilePickerPackageText(): string {
  return [
    'Profiles',
    'No saved profiles.',
    'Open Agent Workspace -> Profiles to create and manage isolated Agent profile homes.',
    'Name',
    'Saved',
    'Settings',
    '(display/provider/behavior)',
    '[Up/Down] Navigate',
    '[Enter] Load',
    'Agent profiles: /agent profiles',
    '[Esc] Close',
    renderProfilePickerStatePackageText(),
  ].join('\n');
}

/**
 * Render the profile picker modal as Line[] for overlay in the viewport.
 *
 * @param modal  ProfilePickerModal state object.
 * @param width  Terminal width.
 */
export function renderProfilePickerModal(
  modal: ProfilePickerModal,
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

  if (modal.profiles.length === 0) {
    sections.push({
      type: 'text',
      content: 'No saved profiles.',
      style: { fg: '244', dim: true },
    });
    sections.push({
      type: 'text',
      content: 'Open Agent Workspace -> Profiles to create and manage isolated Agent profile homes.',
      style: { fg: '240', dim: true },
    });
  } else {
    // Column widths: name(24) | timestamp(16) | preview(remaining)
    const nameW = 24;
    const tsW = 16;
    const previewW = Math.max(4, contentW - nameW - tsW - 4);

    // Column header
    const nameHdr    = fitDisplay('Name', nameW);
    const tsHdr      = fitDisplay('Saved', tsW);
    const previewHdr = fitDisplay('Settings', previewW);
    sections.push({
      type: 'text',
      content: `${nameHdr}  ${tsHdr}  ${previewHdr}`,
      style: { fg: '240', dim: true },
    });
    sections.push({ type: 'separator' });

    const visibleProfiles = modal.profiles.slice(modal.scrollOffset, modal.scrollOffset + visibleRows);
    const listItems: import('./modal-factory.ts').ModalListItem[] = visibleProfiles.map((prof, idx) => {
      const isSelected = modal.scrollOffset + idx === modal.selectedIndex;

      const nameStr = fitDisplay(prof.name, nameW);

      const tsStr = fitDisplay(formatTimestamp(prof.timestamp), tsW);

      const preview = fitDisplay('(display/provider/behavior)', previewW);

      const label = `${nameStr}  ${tsStr}  ${preview}`;
      return { label, selected: isSelected };
    });

    sections.push({ type: 'list', items: listItems });
    if (modal.profiles.length > visibleRows) {
      sections.push({ type: 'separator' });
      sections.push({
        type: 'text',
        content: `[${modal.scrollOffset + 1}-${Math.min(modal.profiles.length, modal.scrollOffset + visibleRows)} of ${modal.profiles.length}]`,
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
      style: { fg: '#00ffcc' },
    });
  }
  return ModalFactory.createModal(
    {
      title: 'Profiles',
      width: boxW,
      margin: boxMargin,
      targetContentRows,
      sections,
      hints: ['[Up/Down] Navigate', '[Enter] Load', 'Agent profiles: /agent profiles', '[Esc] Close'],
    },
    width,
  );
}
