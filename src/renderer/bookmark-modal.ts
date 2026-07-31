/**
 * renderBookmarkModal — renders the /bookmarks modal as Line[] using ModalFactory.
 *
 * Shows a list of bookmarked blocks with:
 *   - label (block type + excerpt)
 *   - timestamp (human-readable time)
 * Footer hints: [Up/Down] Navigate  [Enter] Jump  [o] Open File  [d] Remove  [Esc] Close
 */

import { type Line } from '@pellux/goodvibes-sdk/platform/types';
import { ModalFactory } from './modal-factory.ts';
import { BookmarkModal } from '../input/bookmark-modal.ts';
import type { BookmarkEntry } from '@pellux/goodvibes-sdk/platform/bookmarks';
import { getOverlayContentBudget, getStableOverlayContentRows } from './overlay-viewport.ts';

const BOOKMARK_MODAL_TITLE = 'Bookmarks';
const BOOKMARK_MODAL_EMPTY_MESSAGE = 'No bookmarks - use Ctrl+B to bookmark a block';
const BOOKMARK_MODAL_COLUMNS = '  Key                            Label                           Time';
const BOOKMARK_MODAL_HINTS = ['Up/Down Navigate', 'Enter Jump', 'o Open file', 'd Remove', 'Esc Close'];

export function renderBookmarkModalPackageText(): string {
  return [
    BOOKMARK_MODAL_TITLE,
    BOOKMARK_MODAL_EMPTY_MESSAGE,
    BOOKMARK_MODAL_COLUMNS.trim(),
    '[<start>-<end> of <count>]',
    ...BOOKMARK_MODAL_HINTS,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function entryLabel(entry: BookmarkEntry): string {
  const time = formatTime(entry.timestamp);
  // Pad the key to a consistent width (truncated to 28 chars)
  const keyPart = entry.key.length > 28
    ? entry.key.slice(0, 25) + '...'
    : entry.key.padEnd(28);
  const labelPart = entry.label.length > 30
    ? entry.label.slice(0, 27) + '...'
    : entry.label;
  return `${keyPart}  ${labelPart}  ${time}`;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Render the bookmark modal as Line[] for overlay in the viewport.
 *
 * @param modal  BookmarkModal state object.
 * @param width  Terminal width.
 */
export function renderBookmarkModal(
  modal: BookmarkModal,
  width: number,
  viewportHeight = 24,
): Line[] {
  const visRows = getOverlayContentBudget(viewportHeight, {
    chromeRows: 5,
    minContentRows: 5,
    maxContentRows: 9,
  });
  const targetContentRows = getStableOverlayContentRows(visRows, 8);
  modal.setVisibleRows(visRows);
  const visible = modal.entries.slice(modal.scrollOffset, modal.scrollOffset + visRows);
  const relSelected = Math.max(0, modal.selectedIndex - modal.scrollOffset);

  const items = visible.length === 0
    ? [{ label: BOOKMARK_MODAL_EMPTY_MESSAGE, selected: false }]
    : visible.map((entry, i) => ({
        label: entryLabel(entry),
        selected: i === relSelected,
      }));
  const sections: import('./modal-factory.ts').ModalSection[] = [
    {
      type: 'text',
      content: BOOKMARK_MODAL_COLUMNS,
      style: { dim: true },
    },
    { type: 'separator' },
    { type: 'list', items },
  ];
  if (modal.entries.length > visRows) {
    sections.push({ type: 'separator' });
    sections.push({
      type: 'text',
      content: `[${modal.scrollOffset + 1}-${Math.min(modal.entries.length, modal.scrollOffset + visRows)} of ${modal.entries.length}]`,
      style: { fg: '244', dim: true },
    });
  }

  // Scroll indicator in title
  const totalStr = modal.entries.length > 0
    ? `${modal.selectedIndex + 1}/${modal.entries.length}`
    : '0';

  return ModalFactory.createModal(
    {
      title: `${BOOKMARK_MODAL_TITLE}  ${totalStr}`,
      width: 80,
      targetContentRows,
      sections,
      hints: BOOKMARK_MODAL_HINTS,
    },
    width,
  );
}
