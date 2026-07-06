import { type Line, createStyledCell, createEmptyLine } from '../types/grid.ts';
import { LAYOUT, TOOL_STATUS } from './layout.ts';
import { getDisplayWidth, truncateDisplay } from '../utils/terminal-width.ts';
import type { ToolCall } from '@pellux/goodvibes-sdk/platform/types';
import { stripDangerousAnsi } from './ansi-sanitize.ts';
import { friendlyToolLabel } from './tool-labels.ts';
import { activeUiTones } from './theme.ts';

const TOOL_NAME_MIN_WIDTH = 8;
const TOOL_NAME_MAX_WIDTH = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readStringField(value: unknown, field: string): string | null {
  if (!isRecord(value)) return null;
  const fieldValue = value[field];
  return typeof fieldValue === 'string' ? fieldValue : null;
}

function writeStyledText(
  line: Line,
  startCol: number,
  endColExclusive: number,
  text: string,
  style: { readonly fg: string; readonly bold?: boolean; readonly dim?: boolean },
): number {
  let col = startCol;
  for (const ch of text) {
    const width = getDisplayWidth(ch);
    if (width <= 0) continue;
    if (col + width > endColExclusive) break;
    line[col] = createStyledCell(ch, {
      fg: style.fg,
      bold: style.bold ?? false,
      dim: style.dim ?? false,
    });
    if (width > 1 && col + 1 < endColExclusive) {
      line[col + 1] = createStyledCell('', {
        fg: style.fg,
        bold: style.bold ?? false,
        dim: style.dim ?? false,
      });
    }
    col += width;
  }
  return col;
}

function buildLeftSegments(
  toolName: string,
  keyArg: string,
  suffixText: string,
  leftBudget: number,
): Array<{ text: string; fg: string; bold?: boolean; dim?: boolean }> {
  if (leftBudget <= 0) return [];

  // Read live tones so the tool-call row is legible in light mode. Dark values
  // are byte-identical (t.fg.primary == #e2e8f0, t.chrome.bad == #ef4444).
  const t = activeUiTones();
  const segments: Array<{ text: string; fg: string; bold?: boolean; dim?: boolean }> = [];
  const suffixBudget = suffixText ? Math.min(Math.max(12, Math.floor(leftBudget * 0.3)), 20) : 0;
  const suffixDisplay = suffixBudget > 0 ? truncateDisplay(suffixText, suffixBudget) : '';
  const suffixWidth = getDisplayWidth(suffixDisplay);
  const separatorBeforeSuffix = suffixDisplay ? 2 : 0;
  const mainBudget = Math.max(1, leftBudget - suffixWidth - separatorBeforeSuffix);

  let toolNameDisplay = '';
  let keyArgDisplay = '';
  if (keyArg) {
    const rawToolWidth = getDisplayWidth(toolName);
    const preferredToolWidth = Math.min(
      Math.max(rawToolWidth, TOOL_NAME_MIN_WIDTH),
      TOOL_NAME_MAX_WIDTH,
      Math.max(TOOL_NAME_MIN_WIDTH, Math.floor(mainBudget * 0.4)),
    );
    const toolNameWidth = Math.min(preferredToolWidth, Math.max(1, mainBudget - 3));
    const keyArgWidth = Math.max(0, mainBudget - toolNameWidth - 2);
    toolNameDisplay = truncateDisplay(toolName, toolNameWidth);
    keyArgDisplay = truncateDisplay(keyArg, keyArgWidth);
  } else {
    toolNameDisplay = truncateDisplay(toolName, mainBudget);
  }

  if (toolNameDisplay) {
    segments.push({ text: toolNameDisplay, fg: '#00ffcc', bold: true });
  }
  if (keyArgDisplay) {
    segments.push({ text: '  ', fg: t.fg.primary });
    segments.push({ text: keyArgDisplay, fg: '252' });
  }
  if (suffixDisplay) {
    segments.push({ text: '  ', fg: t.fg.primary });
    segments.push({
      text: suffixDisplay,
      fg: suffixText.startsWith('- ') ? t.chrome.bad : '244',
      dim: true,
    });
  }
  return segments;
}

/**
 * Extract the most meaningful argument from a tool call for display.
 */
function extractKeyArg(toolCall: ToolCall): string {
  const args = toolCall.arguments;
  // Path-based tools
  if (typeof args.path === 'string') return args.path;
  if (typeof args.file === 'string') return args.file;
  if (typeof args.query === 'string') return args.query;
  if (typeof args.title === 'string') return args.title;
  // Array-based (read/write)
  if (Array.isArray(args.files) && args.files.length > 0) {
    const first = args.files[0];
    if (typeof first === 'string') return first;
    const path = readStringField(first, 'path');
    if (path) return path;
  }
  // Exec
  if (typeof args.command === 'string') return args.command;
  if (typeof args.cmd === 'string') return args.cmd;
  if (Array.isArray(args.commands) && args.commands.length > 0) {
    const first = args.commands[0];
    const cmd = readStringField(first, 'cmd');
    if (cmd) return cmd;
  }
  // Find/grep
  if (typeof args.pattern === 'string') return args.pattern;
  if (Array.isArray(args.queries) && args.queries.length > 0) {
    const first = args.queries[0];
    const query = readStringField(first, 'query');
    if (query) return query;
    const pattern = readStringField(first, 'pattern');
    if (pattern) return pattern;
  }
  // Fetch
  if (Array.isArray(args.urls) && args.urls.length > 0) {
    const first = args.urls[0];
    const url = readStringField(first, 'url');
    if (url) return url;
  }
  // Agent
  if (typeof args.task === 'string') return [...args.task].slice(0, 40).join('');
  if (typeof args.mode === 'string') return args.mode;
  // Fallback: first string value
  for (const val of Object.values(args)) {
    if (typeof val === 'string' && val.length > 0) return [...val].slice(0, 40).join('');
  }
  return '';
}

/**
 * Render a tool call as a single collapsed line.
 *
 * Layout: [margin] [icon] [space] [tool name padded] [key arg] [summary] [duration]
 *
 * @param toolCall - The tool call being executed
 * @param status - 'executing' | 'done' | 'error'
 * @param resultSummary - Optional brief summary (e.g., "3 files", "exit 0")
 * @param width - Terminal width
 * @param durationMs - Optional duration in milliseconds
 * @param errorMsg - Optional error message for failed calls
 */
export function renderToolCallBlock(
  toolCall: ToolCall,
  status: 'executing' | 'done' | 'error',
  resultSummary: string | undefined,
  width: number,
  durationMs?: number,
  errorMsg?: string,
  frameIndex?: number,
): Line[] {
  const line = createEmptyLine(width);
  const margin = LAYOUT.LEFT_MARGIN;
  const rightMargin = LAYOUT.RIGHT_MARGIN;
  const contentEnd = width - rightMargin;

  // Status icon
  const icon = status === 'done' ? TOOL_STATUS.SUCCESS_ICON
    : status === 'error' ? TOOL_STATUS.FAIL_ICON
    : TOOL_STATUS.SPINNER_FRAMES[(frameIndex ?? 0) % TOOL_STATUS.SPINNER_FRAMES.length];
  const iconColor = status === 'done' ? '#22c55e'
    : status === 'error' ? '#ef4444'
    : '244';
  const rightText = (() => {
    if (durationMs !== undefined && status === 'done') {
      return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
    }
    return status === 'executing' ? '...' : '';
  })();
  const rightWidth = getDisplayWidth(rightText);
  const rightStart = rightText
    ? Math.max(margin + 2, contentEnd - rightWidth)
    : contentEnd;
  const leftStart = margin;
  const leftEndExclusive = rightText
    ? Math.max(leftStart, rightStart - 1)
    : contentEnd;
  let col: number = leftStart;

  if (col < leftEndExclusive) {
    line[col] = createStyledCell(icon, { fg: iconColor, bold: status !== 'executing' });
  }
  col += 2; // icon + space

  // Human phrase for the tool ("Searching the web") instead of the raw name.
  const rawName = friendlyToolLabel(toolCall.name);
  const keyArg = stripDangerousAnsi(extractKeyArg(toolCall));
  const suffixText = status === 'error' && errorMsg
    ? `- ${[...stripDangerousAnsi(errorMsg)].slice(0, 40).join('')}`
    : status === 'done' && resultSummary
      ? `(${stripDangerousAnsi(resultSummary)})`
      : '';
  const leftBudget = Math.max(0, leftEndExclusive - col);
  const leftSegments = buildLeftSegments(rawName, keyArg, suffixText, leftBudget);
  for (const segment of leftSegments) {
    col = writeStyledText(line, col, leftEndExclusive, segment.text, {
      fg: segment.fg,
      bold: segment.bold ?? false,
      dim: segment.dim ?? false,
    });
  }

  if (rightText) {
    writeStyledText(line, rightStart, contentEnd, rightText, { fg: '238', dim: true });
  }

  return [line];
}

/**
 * Render a list of tool calls. All calls are treated as completed (done).
 * Used for historical message rendering where status/timing is unavailable.
 */
export function renderToolCallList(
  toolCalls: ToolCall[],
  width: number,
): Line[] {
  const lines: Line[] = [];
  for (const tc of toolCalls) {
    lines.push(...renderToolCallBlock(tc, 'done', undefined, width));
  }
  return lines;
}
