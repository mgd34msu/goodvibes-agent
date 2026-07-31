import { type Line } from '@pellux/goodvibes-sdk/platform/types';
import { ModalFactory } from './modal-factory.ts';
import { formatDuration } from './modal-utils.ts';
import type { ProcessManager } from '@pellux/goodvibes-sdk/platform/tools';
import { getOverlaySurfaceMetrics, getStableOverlayContentRows, getVisibleWindow } from '@pellux/goodvibes-terminal-shell';

export interface ProcessEntry {
  readonly id: string;
  readonly label: string;
  readonly type: 'exec';
  readonly status: string;
  readonly elapsedMs: number;
}

const MAX_LABEL_LENGTH = 80;
const MODAL_BORDER_WIDTH = 8;
const PROCESS_MODAL_TITLE = 'Runtime Activity';
const PROCESS_MODAL_EMPTY_MESSAGE = 'No running shell processes.';
const PROCESS_MODAL_EMPTY_HINTS = ['[Esc] Close'];
const PROCESS_MODAL_ACTIVE_HINTS = ['[Up/Down] Navigate', '[Enter] Output', '[k] Stop process', '[Esc] Close'];
const PROCESS_MODAL_TYPE_TAG = '[exec]';

export interface ProcessModalDeps {
  readonly processManager: Pick<ProcessManager, 'list' | 'getStatus' | 'stop'>;
}

function truncateCmd(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  if (firstLine.length > MAX_LABEL_LENGTH) return `${firstLine.slice(0, MAX_LABEL_LENGTH - 3)}...`;
  return firstLine;
}

export class ProcessModal {
  public active = false;
  public selectedIndex = 0;
  public entries: ProcessEntry[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private onRefresh: (() => void) | null = null;

  constructor(private readonly deps: ProcessModalDeps) {}

  setOnRefresh(fn: () => void): void {
    this.onRefresh = fn;
  }

  open(): void {
    this.refresh();
    this.active = true;
    this.selectedIndex = 0;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      this.refresh();
      this.onRefresh?.();
    }, 1000);
  }

  close(): void {
    this.active = false;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  refresh(): void {
    const now = Date.now();
    const result: ProcessEntry[] = [];

    for (const process of this.deps.processManager.list()) {
      if (process.status.startsWith('done')) continue;
      const startTime = this.deps.processManager.getStatus(process.id)?.startTime ?? now;
      result.push({
        id: process.id,
        label: truncateCmd(process.cmd),
        type: 'exec',
        status: process.status,
        elapsedMs: now - startTime,
      });
    }

    this.entries = result;
    if (this.selectedIndex >= this.entries.length) {
      this.selectedIndex = Math.max(0, this.entries.length - 1);
    }
  }

  moveUp(): void {
    if (this.entries.length === 0) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.entries.length) % this.entries.length;
  }

  moveDown(): void {
    if (this.entries.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.entries.length;
  }

  getSelected(): ProcessEntry | undefined {
    return this.entries[this.selectedIndex];
  }

  stopSelected(): boolean {
    const entry = this.getSelected();
    if (!entry) return false;
    return this.deps.processManager.stop(entry.id);
  }
}

export function renderProcessModalPackageText(): string {
  return [
    PROCESS_MODAL_TITLE,
    PROCESS_MODAL_EMPTY_MESSAGE,
    PROCESS_MODAL_TYPE_TAG,
    '*',
    '!',
    '-',
    'running',
    'failed',
    '<duration>',
    ...PROCESS_MODAL_EMPTY_HINTS,
    ...PROCESS_MODAL_ACTIVE_HINTS,
  ].join('\n');
}

export function renderProcessModal(modal: ProcessModal, width: number, viewportHeight = 24): Line[] {
  modal.refresh();

  const metrics = getOverlaySurfaceMetrics(width, viewportHeight, {
    margin: 2,
    maxWidth: Math.max(24, width - 4),
    chromeRows: 4,
    minContentRows: 5,
    maxContentRows: 9,
  });
  const boxMargin = metrics.margin;
  const boxW = metrics.boxWidth;
  const maxVisibleRows = metrics.contentRows;
  const targetContentRows = getStableOverlayContentRows(metrics.contentRows, 7);

  if (modal.entries.length === 0) {
    return ModalFactory.createModal({
      title: PROCESS_MODAL_TITLE,
      width: boxW,
      margin: boxMargin,
      targetContentRows,
      sections: [
        { type: 'text', content: PROCESS_MODAL_EMPTY_MESSAGE },
      ],
      hints: PROCESS_MODAL_EMPTY_HINTS,
    }, width);
  }

  const maxLabelW = Math.max(10, boxW - MODAL_BORDER_WIDTH);
  const window = getVisibleWindow(modal.entries.length, modal.selectedIndex, maxVisibleRows);
  const visibleEntries = modal.entries.slice(window.start, window.end);

  const items = visibleEntries.map((entry, index) => {
    const absoluteIndex = window.start + index;
    const statusIcon = entry.status === 'running' ? '*' : entry.status === 'failed' ? '!' : '-';
    const dur = formatDuration(entry.elapsedMs);
    const suffix = `  ${entry.status}  ${dur}`;
    const typeTag = PROCESS_MODAL_TYPE_TAG;
    const maxDescW = Math.max(0, maxLabelW - typeTag.length - suffix.length - 4);
    const desc = entry.label.length > maxDescW ? `${entry.label.slice(0, Math.max(0, maxDescW - 3))}...` : entry.label;
    return {
      label: `${statusIcon} ${typeTag} ${desc}${suffix}`,
      selected: absoluteIndex === modal.selectedIndex,
    };
  });
  const sections: import('./modal-factory.ts').ModalSection[] = [{ type: 'list', items }];
  if (modal.entries.length > maxVisibleRows) sections.push({ type: 'separator' });

  return ModalFactory.createModal({
    title: PROCESS_MODAL_TITLE,
    width: boxW,
    margin: boxMargin,
    targetContentRows,
    sections,
    helpers: modal.entries.length > maxVisibleRows
      ? [{ content: `[${window.start + 1}-${window.end} of ${modal.entries.length}]` }]
      : undefined,
    hints: PROCESS_MODAL_ACTIVE_HINTS,
  }, width);
}
