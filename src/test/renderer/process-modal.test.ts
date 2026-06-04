import { describe, test, expect, beforeEach } from 'bun:test';
import type { BackgroundProcess } from '@pellux/goodvibes-sdk/platform/tools';
import { ProcessModal, renderProcessModal } from '../../renderer/process-modal.ts';
import { UI_TONES } from '../../renderer/ui-primitives.ts';
import { linesToText } from '../setup.ts';

const W = 100;

type TestProcessRecord = BackgroundProcess & {
  status: string;
};

const processes = new Map<string, TestProcessRecord>();

beforeEach(() => {
  processes.clear();
});

function seedProcess(cmd: string, status = 'running'): string {
  const id = `process-${processes.size + 1}`;
  processes.set(id, {
    id,
    cmd,
    status,
    startTime: Date.now() - 1200,
  } as TestProcessRecord);
  return id;
}

function createProcessModal(): ProcessModal {
  return new ProcessModal({
    processManager: {
      list: () => Array.from(processes.values()),
      getStatus: (id: string) => processes.get(id),
      stop: (id: string) => {
        const record = processes.get(id);
        if (!record) return false;
        record.status = 'done';
        return true;
      },
    },
  });
}

describe('ProcessModal state', () => {
  test('initially inactive with no entries', () => {
    const modal = createProcessModal();
    expect(modal.active).toBe(false);
    expect(modal.entries).toEqual([]);
  });

  test('open() sets active=true and selectedIndex=0', () => {
    const modal = createProcessModal();
    modal.open();
    expect(modal.active).toBe(true);
    expect(modal.selectedIndex).toBe(0);
  });

  test('close() sets active=false', () => {
    const modal = createProcessModal();
    modal.open();
    modal.close();
    expect(modal.active).toBe(false);
  });

  test('refresh() populates entries from running shell processes only', () => {
    seedProcess('bun run build');
    seedProcess('bun test', 'done');
    const modal = createProcessModal();
    modal.refresh();
    expect(modal.entries).toHaveLength(1);
    expect(modal.entries[0]?.type).toBe('exec');
    expect(modal.entries[0]?.label).toContain('bun run build');
  });

  test('moveDown() wraps around to first entry', () => {
    seedProcess('Task A');
    seedProcess('Task B');
    const modal = createProcessModal();
    modal.open();
    expect(modal.selectedIndex).toBe(0);
    modal.moveDown();
    expect(modal.selectedIndex).toBe(1);
    modal.moveDown();
    expect(modal.selectedIndex).toBe(0);
  });

  test('moveUp() wraps around to last entry', () => {
    seedProcess('Task A');
    seedProcess('Task B');
    const modal = createProcessModal();
    modal.open();
    modal.moveUp();
    expect(modal.selectedIndex).toBe(1);
  });

  test('stopSelected() delegates only to ProcessManager', () => {
    const id = seedProcess('sleep 100');
    const modal = createProcessModal();
    modal.open();
    expect(modal.stopSelected()).toBe(true);
    expect(processes.get(id)?.status).toBe('done');
  });
});

describe('renderProcessModal', () => {
  test('renders empty state when no processes are running', () => {
    const modal = createProcessModal();
    const lines = renderProcessModal(modal, W);
    const text = linesToText(lines).join('\n');
    expect(text).toContain('No running shell processes');
  });

  test('all lines have correct terminal width', () => {
    const modal = createProcessModal();
    const lines = renderProcessModal(modal, W);
    for (const line of lines) expect(line.length).toBe(W);
  });

  test('renders exec entries as list items', () => {
    seedProcess('bun run build');
    const modal = createProcessModal();
    modal.open();
    const lines = renderProcessModal(modal, W);
    const text = linesToText(lines).join('\n');
    expect(text).toContain('[exec]');
    expect(text).toContain('bun run build');
  });

  test('selected entry shows selection indicator', () => {
    seedProcess('Task A');
    seedProcess('Task B');
    const modal = createProcessModal();
    modal.open();
    modal.moveDown();
    const lines = renderProcessModal(modal, W);
    const text = linesToText(lines).join('\n');
    expect(text).toContain('Task B');
    const selectedCell = lines.flat().find((cell) => cell.bg === UI_TONES.bg.selected);
    expect(selectedCell).toEqual(expect.objectContaining({ bg: UI_TONES.bg.selected }));
  });

  test('footer contains process-specific hint text', () => {
    const modal = createProcessModal();
    const lines = renderProcessModal(modal, W);
    const text = linesToText(lines).join('\n');
    expect(text).toContain('Esc');
    expect(text).not.toContain('[agent]');
  });
});
