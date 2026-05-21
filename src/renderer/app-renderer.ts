import type { AgentSessionState, AgentMessageRole } from '../core/session.js';
import type { Line } from '../types/grid.ts';
import type { CompositeRequest, Compositor } from './compositor.ts';
import { buildConversationViewport } from './conversation-layout.ts';
import { renderConversationFragment, renderConversationStatusLine, type ConversationStatusSegment } from './conversation-surface.ts';
import { createShellLayout } from './layout-engine.ts';
import { buildShellFooter, estimateShellFooterHeight } from './shell-surface.ts';
import { UIFactory } from './ui-factory.ts';

export interface RenderState {
  readonly session: AgentSessionState;
  readonly input: string;
  readonly inputCursor?: number | undefined;
  readonly status: string;
  readonly daemonStatus: string;
  readonly dashboard: readonly string[];
  readonly busy: boolean;
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
}

export interface RenderFrameOptions {
  readonly width: number;
  readonly height: number;
}

export interface AppFrame {
  readonly composite: CompositeRequest;
  readonly promptLineCount: number;
}

export interface AppCompositor {
  composite(params: CompositeRequest): void;
}

export function renderAppFrame(
  compositor: Pick<Compositor, 'composite'> | AppCompositor,
  state: RenderState,
  options: RenderFrameOptions,
): AppFrame {
  const frame = buildAppFrame(state, options);
  compositor.composite(frame.composite);
  return frame;
}

export function buildAppFrame(state: RenderState, options: RenderFrameOptions): AppFrame {
  const width = Math.max(40, options.width);
  const height = Math.max(12, options.height);
  const model = state.model ?? 'daemon-default';
  const provider = state.provider ?? 'daemon';
  const promptLines = state.input.split('\n');
  const promptLineCount = Math.max(1, promptLines.length);
  const footerEstimate = estimateShellFooterHeight(promptLineCount);
  const header = UIFactory.createHeader(width, model, provider, state.session.title);
  const shellLayout = createShellLayout({
    width,
    height,
    headerHeight: header.length,
    footerHeight: Math.min(footerEstimate, Math.max(4, height - header.length - 4)),
    panelWidth: 0,
  });
  const footerOptions = {
    width,
    promptText: promptLines.join('\n'),
    promptLineCount,
    promptFocused: true,
    usage: { up: 0, down: 0 },
    showExitNotice: false,
    lastCopyTime: 0,
    model,
    provider,
    toolCount: 0,
    workingDir: process.cwd(),
    activeTurnCount: state.busy ? 1 : 0,
    runningProcessCount: 0,
    indicatorFocused: false,
    composerMode: 'operator',
    composerStatus: state.busy ? 'working' : 'ready',
    composerFlags: [state.daemonStatus],
    composerPendingRisk: 'none',
    ...(state.inputCursor !== undefined ? { promptCursorPos: state.inputCursor } : {}),
    ...(state.busy ? { activeTurnProgress: state.status } : {}),
  } satisfies Parameters<typeof buildShellFooter>[0];
  const footer = buildShellFooter(footerOptions).lines;
  const bodyHeight = Math.max(0, height - header.length - footer.length);
  const conversationWidth = shellLayout.conversation.width;
  const dashboard = renderDashboardOverlay(
    conversationWidth,
    state.dashboard,
    Math.min(12, Math.max(0, bodyHeight - 3)),
  );
  const conversation = {
    history: createSessionHistory(state.session, conversationWidth),
  };
  const conversationViewport = buildConversationViewport({
    conversation,
    width: conversationWidth,
    viewportHeight: bodyHeight,
    scrollTop: 0,
    scrollLocked: true,
    overlayRows: dashboard.length + (state.busy ? 3 : 1),
  });
  const viewport = [...conversationViewport.viewport];
  viewport.push(...dashboard);
  if (state.busy) {
    viewport.push(...UIFactory.createThinkingFragment(conversationWidth, '◐'));
  }
  viewport.push(renderStatusLine(conversationWidth, state));
  return {
    composite: {
      width,
      height,
      header,
      viewport,
      footer,
    },
    promptLineCount,
  };
}

export function renderInput(input: string, width: number, cursor = [...input].length): readonly Line[] {
  return buildShellFooter({
    width,
    promptText: input,
    promptLineCount: Math.max(1, input.split('\n').length),
    promptCursorPos: cursor,
    usage: { up: 0, down: 0 },
    showExitNotice: false,
    lastCopyTime: 0,
    activeTurnCount: 0,
    runningProcessCount: 0,
    indicatorFocused: false,
    composerMode: 'operator',
    composerStatus: 'ready',
  }).lines;
}

function createSessionHistory(session: AgentSessionState, width: number): {
  getLineCount(): number;
  getSnapshot(scrollTop: number, height: number, targetWidth: number): Line[];
} {
  const lines = renderSessionMessages(session, width);
  return {
    getLineCount: () => lines.length,
    getSnapshot: (scrollTop, height) => lines.slice(scrollTop, scrollTop + height),
  };
}

function renderSessionMessages(session: AgentSessionState, width: number): Line[] {
  if (session.messages.length === 0) {
    return renderConversationFragment('GoodVibes Agent is ready.', width, {
      prefix: ' ● ',
      prefixFg: '#38bdf8',
      text: '252',
      bodyBg: '#1a1a1a',
    });
  }
  const lines: Line[] = [];
  for (const message of session.messages) {
    lines.push(...renderMessage(message.role, message.body, width));
  }
  return lines;
}

function renderMessage(role: AgentMessageRole, body: string, width: number): Line[] {
  switch (role) {
    case 'user':
      return UIFactory.createMessageBar(width, body, '#2a2a2a', '252', ' › ');
    case 'assistant':
      return renderConversationFragment(body, width, {
        prefix: ' ● ',
        prefixFg: '#22c55e',
        text: '#e2e8f0',
        bodyBg: '#111827',
      });
    case 'system':
      return renderConversationFragment(body, width, {
        prefix: ' • ',
        prefixFg: '#38bdf8',
        text: '244',
        bodyBg: '#11131a',
        dim: true,
      });
  }
}

function renderStatusLine(width: number, state: RenderState): Line {
  const segments: ConversationStatusSegment[] = [
    {
      text: state.busy ? ' working ' : ' ready ',
      fg: state.busy ? '#f59e0b' : '#22c55e',
      bold: true,
    },
    { text: state.status, fg: '244', dim: true },
  ];
  return renderConversationStatusLine(width, segments, {
    marker: '▌',
    markerFg: state.busy ? '#f59e0b' : '#22c55e',
  });
}

function renderDashboardOverlay(width: number, dashboard: readonly string[], maxRows: number): Line[] {
  if (dashboard.length === 0 || maxRows <= 0) return [];
  const rows = compactDashboardRows(dashboard).slice(0, maxRows);
  return rows.map((row) => {
    if (DASHBOARD_HEADINGS.has(row)) {
      return UIFactory.stringToLine(`  ${row}`, width, { fg: '#38bdf8', bold: true });
    }
    const isWarning = row.startsWith('warn ');
    return UIFactory.stringToLine(`    ${row}`, width, {
      fg: isWarning ? '#f59e0b' : '244',
      dim: !isWarning,
    });
  });
}

const DASHBOARD_HEADINGS = new Set(['Status', 'Work Plan', 'Approvals', 'Automation']);

function compactDashboardRows(dashboard: readonly string[]): string[] {
  const rows: string[] = [];
  const statusRows = dashboard.slice(0, 6).filter((row) => row.trim());
  rows.push(...statusRows);
  for (const heading of ['Work Plan', 'Approvals', 'Automation']) {
    const headingIndex = dashboard.indexOf(heading);
    if (headingIndex < 0) continue;
    const firstDetail = firstDashboardDetail(dashboard, headingIndex + 1);
    rows.push(heading);
    if (firstDetail) rows.push(firstDetail);
  }
  return rows;
}

function firstDashboardDetail(dashboard: readonly string[], start: number): string | null {
  for (let index = start; index < dashboard.length; index += 1) {
    const row = dashboard[index];
    if (row === undefined) return null;
    if (!row.trim()) continue;
    if (DASHBOARD_HEADINGS.has(row) || row === 'Memory' || row === 'Skills' || row === 'Personas') return null;
    return row;
  }
  return null;
}
