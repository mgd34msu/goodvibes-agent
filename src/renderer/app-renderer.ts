import type { AgentSessionState } from '../core/session.js';
import { wrapText } from '../utils/format.js';
import { ANSI } from './ansi.js';
import { fitLine, getTerminalSize } from './layout.js';

const DASHBOARD_HEADINGS = new Set(['Status', 'Work Plan', 'Approvals', 'Automation', 'Memory', 'Skills', 'Personas']);

export interface RenderState {
  readonly session: AgentSessionState;
  readonly input: string;
  readonly inputCursor?: number | undefined;
  readonly status: string;
  readonly daemonStatus: string;
  readonly dashboard: readonly string[];
  readonly busy: boolean;
}

export function renderApp(state: RenderState): string {
  const size = getTerminalSize();
  const width = Math.max(40, size.columns);
  const height = Math.max(12, size.rows);
  const header = `${ANSI.bold}GoodVibes Agent${ANSI.reset} ${ANSI.dim}${state.session.id}${ANSI.reset}`;
  const daemon = `${ANSI.dim}${state.daemonStatus}${ANSI.reset}`;
  const footer = `${state.busy ? `${ANSI.fg.yellow}working${ANSI.reset}` : `${ANSI.fg.green}ready${ANSI.reset}`}  ${state.status}`;
  const inputLines = renderInput(state.input, width, state.inputCursor);
  const bodyHeight = Math.max(1, height - 5 - inputLines.length);
  const bodyLines = renderBody(state, width, bodyHeight);
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

function renderBody(state: RenderState, width: number, height: number): string[] {
  if (width < 96) return renderNarrowBody(state, width, height);
  const dashboardWidth = Math.min(34, Math.max(28, Math.floor(width * 0.28)));
  const gap = '  ';
  const transcriptWidth = width - dashboardWidth - gap.length;
  const transcript = renderMessages(state.session, transcriptWidth).slice(-height);
  const dashboard = renderDashboard(state.dashboard, dashboardWidth).slice(0, height);
  while (transcript.length < height) transcript.unshift('');
  while (dashboard.length < height) dashboard.push('');
  return transcript.map((line, index) => (
    `${fitLine(line, transcriptWidth)}${gap}${fitLine(dashboard[index] ?? '', dashboardWidth)}`
  ));
}

function renderNarrowBody(state: RenderState, width: number, height: number): string[] {
  const dashboard = renderDashboard(compactDashboardLines(state.dashboard), width);
  const transcriptHeight = Math.max(1, height - dashboard.length - 1);
  const transcript = renderMessages(state.session, width).slice(-transcriptHeight);
  return [
    ...dashboard,
    '-'.repeat(width),
    ...transcript,
  ].slice(-height);
}

function compactDashboardLines(lines: readonly string[]): readonly string[] {
  const daemon = lineAfter(lines, 'Status');
  const chat = lines.find((line) => line.startsWith('Chat ')) ?? 'Chat new';
  const model = lines.find((line) => line.startsWith('Model ')) ?? 'Model daemon-default/daemon-default';
  const local = lines.find((line) => line.startsWith('Local ')) ?? 'Local 0 memory, 0 skills, 0 personas';
  const workPlan = lineAfter(lines, 'Work Plan');
  const approvals = lineAfter(lines, 'Approvals');
  return [
    'Status',
    daemon,
    `${chat} | ${model}`,
    local,
    `Work ${workPlan}`,
    `Approvals ${approvals}`,
  ];
}

function lineAfter(lines: readonly string[], heading: string): string {
  const index = lines.indexOf(heading);
  if (index < 0) return 'unknown';
  return lines.slice(index + 1).find((line) => line.trim()) ?? 'none';
}

function renderDashboard(lines: readonly string[], width: number): string[] {
  const output: string[] = [];
  for (const line of lines) {
    if (!line) {
      output.push('');
      continue;
    }
    const heading = DASHBOARD_HEADINGS.has(line);
    const prefix = heading ? `${ANSI.bold}${line}${ANSI.reset}` : `  ${line}`;
    for (const wrapped of wrapText(prefix, width)) output.push(wrapped);
  }
  return output;
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

export function renderInput(input: string, width: number, cursor = [...input].length): string[] {
  const lines: string[] = [];
  const parts = input.split('\n');
  let offset = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const prefix = index === 0 ? `${ANSI.fg.cyan}>${ANSI.reset} ` : `${ANSI.fg.gray}|${ANSI.reset} `;
    const part = parts[index] ?? '';
    const partLength = [...part].length;
    const cursorInLine = cursor >= offset && cursor <= offset + partLength ? cursor - offset : null;
    const wrapped = wrapInputLine(part, Math.max(8, width - 2), cursorInLine);
    for (let wrappedIndex = 0; wrappedIndex < wrapped.length; wrappedIndex += 1) {
      lines.push(`${wrappedIndex === 0 ? prefix : '  '}${wrapped[wrappedIndex]}`);
    }
    offset += partLength + 1;
  }
  return lines.slice(-5);
}

function wrapInputLine(line: string, width: number, cursor: number | null): readonly string[] {
  const chars = [...line];
  if (chars.length === 0) return [cursor === 0 ? cursorCell(' ') : ''];
  const output: string[] = [];
  const visibleCells = chars.length + (cursor === chars.length ? 1 : 0);
  const chunkCount = Math.max(1, Math.ceil(visibleCells / width));
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    const start = chunk * width;
    const end = Math.min(visibleCells, start + width);
    output.push(renderInputChunk(chars, start, end, cursor));
  }
  return output;
}

function renderInputChunk(chars: readonly string[], start: number, end: number, cursor: number | null): string {
  let output = '';
  for (let index = start; index < end; index += 1) {
    if (index >= chars.length) {
      output += cursor === index ? cursorCell(' ') : ' ';
      continue;
    }
    const char = chars[index] ?? '';
    output += cursor === index ? cursorCell(char) : char;
  }
  return output;
}

function cursorCell(value: string): string {
  return `${ANSI.inverse}${value || ' '}${ANSI.reset}`;
}
