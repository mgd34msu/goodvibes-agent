import { type Line, createStyledCell, createEmptyLine } from '@pellux/goodvibes-sdk/platform/types';
import { LAYOUT, TOOL_STATUS } from './layout.ts';
import { getDisplayWidth, truncateDisplay } from '../utils/terminal-width.ts';
import type { ToolCall } from '@pellux/goodvibes-sdk/platform/types';
import { stripDangerousAnsi } from '@pellux/goodvibes-terminal-shell';
import { friendlyToolLabel } from './tool-labels.ts';
import { activeUiTones } from './theme.ts';
import { GLYPHS } from '@pellux/goodvibes-sdk/platform/presentation';
import { treeContentCol, treeTextCol, writeTreeStatusMarker } from '@pellux/goodvibes-terminal-shell';

const TOOL_NAME_MIN_WIDTH = 8;
const TOOL_NAME_MAX_WIDTH = 30;

/** Tree placement for a tool-call row rendered as a branch of its turn. */
export interface ToolCallTreeOptions {
  /** Effective indent in columns, already clamped by treeIndentCols(). */
  readonly indentCols?: number;
  readonly branchFg?: string;
  /** Suppress the tool label because the turn header already carries it. */
  readonly omitToolName?: boolean;
}

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
  omitToolName = false,
): Array<{ text: string; fg: string; bold?: boolean; dim?: boolean }> {
  if (leftBudget <= 0) return [];

  // When every call in the turn shares one label, the label rides on the turn
  // header and each row leads with the argument that actually distinguishes it
  // (`config.get`, `services.restart`). Falls back to showing the name when
  // there is no key argument, so a row can never render empty.
  if (omitToolName && keyArg) {
    return buildLeftSegments(keyArg, '', suffixText, leftBudget, false);
  }

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
 * @param status - 'executing' | 'done' | 'error' | 'pending' | 'cancelled'
 * @param resultSummary - Optional brief summary (e.g., "3 files", "exit 0")
 * @param width - Terminal width
 * @param durationMs - Optional duration in milliseconds
 * @param errorMsg - Optional error message for failed calls
 * @param frameIndex - Spinner frame index for the animated icon
 * @param tree - Branch placement when the row is a child of a turn header
 *               (see conversation-tree.ts); omitted for a flush row
 */
export function renderToolCallBlock(
  toolCall: ToolCall,
  status: 'executing' | 'done' | 'error' | 'pending' | 'cancelled',
  resultSummary: string | undefined,
  width: number,
  durationMs?: number,
  errorMsg?: string,
  frameIndex?: number,
  tree?: ToolCallTreeOptions,
): Line[] {
  const line = createEmptyLine(width);
  const indent = Math.max(0, tree?.indentCols ?? 0);
  const inTree = indent > 0;
  // In tree mode the row's columns come from the shared grid: the branch glyph
  // where the parent's content began, the status marker in the bullet column,
  // and the row's text at this depth's text column.
  const margin = inTree ? treeContentCol(indent) : LAYOUT.LEFT_MARGIN;
  const rightMargin = LAYOUT.RIGHT_MARGIN;
  const contentEnd = width - rightMargin;

  // Status icon
  // 'pending' means the call has NOT run yet — it is awaiting a decision (e.g.
  // an approval prompt) — so it uses the hollow idle glyph rather than the
  // completed ✓. 'cancelled' means the user stopped THIS call mid-flight: the
  // blocked glyph in the warn tone, distinct from both success and a real
  // error. Without these two, a call that had not finished still rendered as
  // done, so a turn only ever looked settled and never looked like work in
  // progress.
  const icon = status === 'done' ? TOOL_STATUS.SUCCESS_ICON
    : status === 'error' ? TOOL_STATUS.FAIL_ICON
    : status === 'cancelled' ? GLYPHS.status.blocked
    : status === 'pending' ? GLYPHS.status.idle
    : TOOL_STATUS.SPINNER_FRAMES[(frameIndex ?? 0) % TOOL_STATUS.SPINNER_FRAMES.length];
  const iconColor = status === 'done' ? '#22c55e'
    : status === 'error' ? '#ef4444'
    : status === 'cancelled' ? '#f59e0b'
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
  const leftStart = inTree ? treeTextCol(indent) : margin;
  const leftEndExclusive = rightText
    ? Math.max(leftStart, rightStart - 1)
    : contentEnd;
  let col: number = leftStart;

  // In tree mode the status glyph goes in the bullet column — the same column
  // as the `●` of the `● assistant` header this row hangs under — so a turn's
  // markers read as that bullet's column continuing down the turn. The row's
  // own text then starts at its depth's text column with no inline icon slot.
  if (inTree) {
    writeTreeStatusMarker(line, icon, iconColor, width);
  } else {
    if (col < leftEndExclusive) {
      line[col] = createStyledCell(icon, { fg: iconColor, bold: status === 'done' || status === 'error' || status === 'cancelled' });
    }
    col += 2; // icon + space
  }

  // Human phrase for the tool ("Searching the web") instead of the raw name.
  const rawName = friendlyToolLabel(toolCall.name);
  const keyArg = stripDangerousAnsi(extractKeyArg(toolCall));
  const suffixText = status === 'cancelled'
    ? '- cancelled'
    : status === 'error' && errorMsg
    ? `- ${[...stripDangerousAnsi(errorMsg)].slice(0, 40).join('')}`
    : status === 'done' && resultSummary
      ? `(${stripDangerousAnsi(resultSummary)})`
      : '';
  const leftBudget = Math.max(0, leftEndExclusive - col);
  const leftSegments = buildLeftSegments(rawName, keyArg, suffixText, leftBudget, tree?.omitToolName ?? false);
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
