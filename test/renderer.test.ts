import { describe, expect, test } from 'bun:test';
import { createAgentSession } from '../src/core/session.js';
import type { CompositeRequest } from '../src/renderer/compositor.ts';
import { buildAppFrame, renderAppFrame, renderInput } from '../src/renderer/app-renderer.js';
import type { Line } from '../src/types/grid.ts';

describe('renderer input cursor', () => {
  test('renders a visible cursor through the shell footer', () => {
    const lines = renderInput('hello', 40, 2);
    const cursor = lines.flat().find((cell) => cell.bg === '#ffffff');

    expect(lineText(lines)).toContain('› hello');
    expect(cursor?.char).toBe('l');
  });

  test('renders cursor at multiline end', () => {
    const lines = renderInput('one\ntwo', 40, 7);

    expect(lineText(lines)).toContain('› one');
    expect(lineText(lines)).toContain('two█');
  });
});

describe('app compositor frame', () => {
  test('builds a TUI shell frame with header, viewport, and footer', () => {
    const frame = buildAppFrame({
      session: createAgentSession(),
      input: 'hello',
      inputCursor: 5,
      status: 'Ready',
      daemonStatus: 'Daemon ok',
      dashboard: [],
      busy: false,
      model: 'gpt-5.5',
      provider: 'openai-subscriber',
    }, { width: 100, height: 32 });

    expect(frame.composite.header.length).toBeGreaterThan(0);
    expect(frame.composite.viewport.length).toBeGreaterThan(0);
    expect(frame.composite.footer.length).toBeGreaterThan(0);
    expect(lineText(frame.composite.header)).toContain('GoodVibes Agent');
    expect(lineText(frame.composite.footer)).toContain('/help for commands');
  });

  test('renders compact operator dashboard lines in the compositor viewport', () => {
    const frame = buildAppFrame({
      session: createAgentSession(),
      input: '',
      inputCursor: 0,
      status: 'Ready',
      daemonStatus: 'Daemon ok',
      dashboard: [
        'Status',
        'Daemon ok 0.33.34',
        'Chat new',
        'Model daemon-default',
        'Local 1 memory, 2 skills, 1 personas',
        'Active default; skills none',
        '',
        'Work Plan',
        'warn work plan route failed',
        '',
        'Approvals',
        '2 pending, mode guarded',
        '',
        'Automation',
        'warn automation route failed',
      ],
      busy: false,
    }, { width: 110, height: 34 });
    const viewport = lineText(frame.composite.viewport);

    expect(viewport).toContain('Daemon ok 0.33.34');
    expect(viewport).toContain('Local 1 memory');
    expect(viewport).toContain('warn work plan route failed');
    expect(viewport).toContain('2 pending');
    expect(viewport).toContain('warn automation route failed');
  });

  test('busy turns render as the active operator turn', () => {
    const frame = buildAppFrame({
      session: createAgentSession(),
      input: '',
      inputCursor: 0,
      status: 'Working in main conversation',
      daemonStatus: 'Daemon ok',
      dashboard: [],
      busy: true,
    }, { width: 100, height: 32 });
    const footer = lineText(frame.composite.footer);

    expect(footer).toContain('operator turn');
    expect(footer).not.toContain(`back${'ground'}`);
    expect(footer).not.toContain(`a${'gent running'}`);
    expect(footer).not.toContain(`a${'gents running'}`);
  });

  test('renders every app frame through a compositor object', () => {
    const compositor = new RecordingCompositor();
    const frame = renderAppFrame(compositor, {
      session: createAgentSession(),
      input: '',
      inputCursor: 0,
      status: 'Ready',
      daemonStatus: 'Daemon ok',
      dashboard: [],
      busy: false,
    }, { width: 90, height: 28 });

    expect(compositor.calls).toBe(1);
    expect(compositor.last).toBe(frame.composite);
  });
});

class RecordingCompositor {
  calls = 0;
  last: CompositeRequest | null = null;

  composite(params: CompositeRequest): void {
    this.calls += 1;
    this.last = params;
  }
}

function lineText(lines: readonly Line[]): string {
  return lines.map((line) => line.map((cell) => cell.char).join('')).join('\n');
}
