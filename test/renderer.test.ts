import { describe, expect, test } from 'bun:test';
import { ANSI, stripAnsi } from '../src/renderer/ansi.js';
import { renderApp, renderInput } from '../src/renderer/app-renderer.js';
import { createAgentSession } from '../src/core/session.js';

describe('renderer input cursor', () => {
  test('renders a visible cursor without changing input text', () => {
    const output = renderInput('hello', 40, 2).join('\n');

    expect(output).toContain(`${ANSI.inverse}l${ANSI.reset}`);
    expect(stripAnsi(output)).toContain('> hello');
  });

  test('renders cursor at multiline end', () => {
    const output = renderInput('one\ntwo', 40, 7).join('\n');

    expect(output).toContain(`${ANSI.inverse} ${ANSI.reset}`);
    expect(stripAnsi(output)).toContain('| two ');
  });

  test('only known dashboard section labels render as headings', () => {
    const output = renderApp({
      session: createAgentSession(),
      input: '',
      inputCursor: 0,
      status: 'Ready',
      daemonStatus: 'Daemon ok',
      dashboard: ['Memory', 'No local memory'],
      busy: false,
    });

    expect(output).toContain(`${ANSI.bold}Memory${ANSI.reset}`);
    expect(output).not.toContain(`${ANSI.bold}No local memory${ANSI.reset}`);
  });
});
