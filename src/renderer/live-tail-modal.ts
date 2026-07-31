import { type Line } from '@pellux/goodvibes-sdk/platform/types';
import { ModalFactory } from './modal-factory.ts';
import type { ProcessManager } from '@pellux/goodvibes-sdk/platform/tools';
import type { ProcessEntry } from './process-modal.ts';
import { getOverlaySurfaceMetrics, getStableOverlayContentRows } from './overlay-viewport.ts';

const LIVE_TAIL_PROCESS_TAG = '[exec]';
const LIVE_TAIL_EMPTY_OUTPUT = '(no output yet)';
const LIVE_TAIL_SCROLL_HINT = '[Up/Down] Scroll';
const LIVE_TAIL_HINTS = [LIVE_TAIL_SCROLL_HINT, '[k] Stop process', '[Esc] Back'];

function liveTailTitle(label: string): string {
  return `${LIVE_TAIL_PROCESS_TAG} ${label}`;
}

function liveTailScrollInfo(start: string | number, end: string | number, total: string | number): string {
  return `  Lines ${start}-${end} of ${total}  ${LIVE_TAIL_SCROLL_HINT}`;
}

export function renderLiveTailModalPackageText(): string {
  return [
    liveTailTitle('<process>'),
    LIVE_TAIL_EMPTY_OUTPUT,
    liveTailScrollInfo('<start>', '<end>', '<total>'),
    ...LIVE_TAIL_HINTS,
  ].join('\n');
}

export interface LiveTailModalDeps {
  readonly processManager: Pick<ProcessManager, 'stop' | 'getOutput'>;
}

export class LiveTailModal {
  public active = false;
  public entry: ProcessEntry | null = null;
  public scrollOffset = 0;

  constructor(private readonly deps: LiveTailModalDeps) {}

  open(entry: ProcessEntry): void {
    this.entry = entry;
    this.scrollOffset = 0;
    this.active = true;
  }

  close(): void {
    this.active = false;
    this.entry = null;
    this.scrollOffset = 0;
  }

  scrollUp(): void {
    this.scrollOffset += 1;
  }

  scrollDown(): void {
    this.scrollOffset = Math.max(0, this.scrollOffset - 1);
  }

  stopProcess(): boolean {
    if (!this.entry) return false;
    return this.deps.processManager.stop(this.entry.id);
  }

  getOutput(): string {
    if (!this.entry) return '';
    const output = this.deps.processManager.getOutput(this.entry.id);
    if (!output) return '';
    const combined = [output.stdout, output.stderr].filter(Boolean).join('\n').trim();
    return combined || LIVE_TAIL_EMPTY_OUTPUT;
  }
}

export function renderLiveTailModal(
  modal: LiveTailModal,
  width: number,
  viewportHeight = 24,
): Line[] {
  const entry = modal.entry;
  if (!entry) return [];
  const metrics = getOverlaySurfaceMetrics(width, viewportHeight, {
    chromeRows: 4,
    minContentRows: 6,
    maxContentRows: 10,
  });
  const maxOutputLines = metrics.contentRows;
  const targetContentRows = getStableOverlayContentRows(metrics.contentRows, 8);

  const output = modal.getOutput();
  const allLines = output.split('\n');
  const totalLines = allLines.length;
  const maxScroll = Math.max(0, totalLines - maxOutputLines);
  const clampedOffset = Math.min(modal.scrollOffset, maxScroll);
  const endIdx = Math.max(maxOutputLines, totalLines - clampedOffset);
  const startIdx = Math.max(0, endIdx - maxOutputLines);
  const visibleLines = allLines.slice(startIdx, endIdx);

  const maxLabelW = Math.max(20, width - 30);
  const title = liveTailTitle(entry.label.slice(0, maxLabelW));
  const scrollInfo = totalLines > maxOutputLines
    ? liveTailScrollInfo(startIdx + 1, Math.min(endIdx, totalLines), totalLines)
    : '';

  const sections: import('./modal-factory.ts').ModalSection[] = [];
  if (scrollInfo) {
    sections.push({ type: 'text', content: scrollInfo });
    sections.push({ type: 'separator' });
  }
  sections.push({ type: 'text', content: visibleLines.join('\n') || LIVE_TAIL_EMPTY_OUTPUT });

  return ModalFactory.createModal({
    title,
    width: metrics.boxWidth,
    margin: 2,
    targetContentRows,
    sections,
    hints: LIVE_TAIL_HINTS,
  }, width);
}
