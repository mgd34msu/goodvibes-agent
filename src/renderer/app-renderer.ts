import type { AgentSessionState } from '../core/session.js';
import { wrapText } from '../utils/format.js';
import { ANSI } from './ansi.js';
import { fitLine, getTerminalSize } from './layout.js';

export interface RenderState {
  readonly session: AgentSessionState;
  readonly input: string;
  readonly status: string;
  readonly daemonStatus: string;
  readonly busy: boolean;
}

export function renderApp(state: RenderState): string {
  const size = getTerminalSize();
  const width = Math.max(40, size.columns);
  const height = Math.max(12, size.rows);
  const header = `${ANSI.bold}GoodVibes Agent${ANSI.reset} ${ANSI.dim}${state.session.id}${ANSI.reset}`;
  const daemon = `${ANSI.dim}${state.daemonStatus}${ANSI.reset}`;
  const footer = `${state.busy ? `${ANSI.fg.yellow}working${ANSI.reset}` : `${ANSI.fg.green}ready${ANSI.reset}`}  ${state.status}`;
  const inputLines = renderInput(state.input, width);
  const bodyHeight = Math.max(1, height - 5 - inputLines.length);
  const bodyLines = renderMessages(state.session, width).slice(-bodyHeight);
  while (bodyLines.length < bodyHeight) bodyLines.unshift('');
  return [
    ANSI.hideCursor,
    ANSI.clear,
    ANSI.home,
    fitLine(header, width),
    fitLine(daemon, width),
    fitLine('-'.repeat(width), width),
    ...bodyLines.map((line) => fitLine(line, width)),
    fitLine('-'.repeat(width), width),
    fitLine(footer, width),
    ...inputLines.map((line) => fitLine(line, width)),
    ANSI.showCursor,
  ].join('\n');
}

function renderMessages(session: AgentSessionState, width: number): string[] {
  const lines: string[] = [];
  for (const message of session.messages) {
    const label = message.role === 'user'
      ? `${ANSI.fg.cyan}you${ANSI.reset}`
      : message.role === 'assistant'
        ? `${ANSI.fg.green}agent${ANSI.reset}`
        : `${ANSI.fg.gray}system${ANSI.reset}`;
    lines.push(`${label}:`);
    for (const line of wrapText(message.body, width - 4)) {
      lines.push(`  ${line}`);
    }
    lines.push('');
  }
  return lines;
}

function renderInput(input: string, width: number): string[] {
  const lines: string[] = [];
  const parts = input.split('\n');
  for (let index = 0; index < parts.length; index += 1) {
    const prefix = index === 0 ? `${ANSI.fg.cyan}>${ANSI.reset} ` : `${ANSI.fg.gray}|${ANSI.reset} `;
    const available = Math.max(8, width - 2);
    const wrapped = wrapText(parts[index] ?? '', available);
    if (wrapped.length === 0) {
      lines.push(prefix);
      continue;
    }
    for (let wrappedIndex = 0; wrappedIndex < wrapped.length; wrappedIndex += 1) {
      lines.push(`${wrappedIndex === 0 ? prefix : '  '}${wrapped[wrappedIndex]}`);
    }
  }
  return lines.slice(-5);
}
