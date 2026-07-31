/**
 * Activity sidebar — the ambient right-hand surface of the shell.
 *
 * One glanceable column with at most four sections:
 *
 *   Now        what the assistant is doing this second (only while busy)
 *   Needs you  approvals waiting on the user (only when non-empty)
 *   Coming up  next scheduled work, when known (only when non-empty)
 *   Recent     the activity feed, newest first
 *
 * Deliberately display-only: no focus, no tabs, no selection. Interactions
 * stay in the conversation and the Agent workspace.
 */

import type { Line } from '../types/grid.ts';
import { createEmptyLine } from '../types/grid.ts';
import type { ActivityEntry, ActivityKind } from '../core/activity-feed.ts';
import {
  DEFAULT_PANEL_PALETTE,
  buildPanelLine,
  buildSectionHeader,
  buildBodyText,
} from './polish.ts';
import { getDisplayWidth, truncateDisplay } from '../utils/terminal-width.ts';

export interface ActivitySidebarNow {
  /** True while a turn is streaming or tools are running. */
  readonly busy: boolean;
  /** Short human label for the current work, e.g. "Searching the web…". */
  readonly label?: string;
  /**
   * Background agents with their latest progress lines. `headline` is the
   * fleet read-model's per-node headline (derived from task/phase identity
   * only, replaced in place — never a feed) and wins over the raw progress
   * line when present; `quietForMs` is the fleet stall tell (pure timestamp
   * comparison), rendered as a quiet-duration marker.
   */
  readonly agents: ReadonlyArray<{
    readonly label: string;
    readonly progress?: string;
    readonly headline?: string;
    readonly quietForMs?: number;
  }>;
  /** Count of running background processes. */
  readonly processes: number;
}

/** How many agent rows the Now section has room for. */
const SIDEBAR_AGENT_ROWS = 3;

/** States a fleet node is in while it is still doing something. */
const LIVE_FLEET_STATES: ReadonlySet<string> = new Set(['running', 'starting', 'waiting', 'blocked', 'paused']);

/**
 * Build the Now section's agent rows from the active agents and the fleet
 * nodes.
 *
 * Rows this process is running come first and carry their live progress: the
 * per-node headline (task/phase identity only — replaced in place, never a
 * feed) wins over the raw progress line, and the stall tell renders as a
 * quiet-duration marker. Agent-kind nodes the fleet carries that no active
 * agent here matches are work running elsewhere — the daemon's scheduled and
 * channel-driven runs — and fill whatever room is left, labeled so the two are
 * never confused.
 */
export function buildSidebarAgentRows(
  activeAgents: ReadonlyArray<{ readonly id: string; readonly label: string; readonly latestProgress?: string | undefined }>,
  fleetNodes: ReadonlyArray<{
    readonly id: string;
    readonly kind?: string | undefined;
    readonly label?: string | undefined;
    readonly state?: string | undefined;
    readonly headline?: { readonly text: string } | undefined;
    readonly stall?: { readonly quietForMs: number } | undefined;
  }>,
): ActivitySidebarNow['agents'] {
  const nodesById = new Map(fleetNodes.map((node) => [node.id, node]));
  const localIds = new Set(activeAgents.map((agent) => agent.id));
  const rows: Array<ActivitySidebarNow['agents'][number]> = activeAgents.slice(0, SIDEBAR_AGENT_ROWS).map((agent) => {
    const node = nodesById.get(agent.id);
    return {
      label: agent.label,
      progress: agent.latestProgress?.trim() || undefined,
      headline: node?.headline?.text,
      quietForMs: node?.stall?.quietForMs,
    };
  });

  for (const node of fleetNodes) {
    if (rows.length >= SIDEBAR_AGENT_ROWS) break;
    if (localIds.has(node.id)) continue;
    if (node.kind !== 'agent') continue;
    if (node.state !== undefined && !LIVE_FLEET_STATES.has(node.state)) continue;
    rows.push({
      label: `${node.label ?? node.id} (elsewhere)`,
      headline: node.headline?.text,
      quietForMs: node.stall?.quietForMs,
    });
  }
  return rows;
}

/** Compact quiet-duration text for the stall tell, e.g. "quiet 4m". */
function fmtQuietFor(quietForMs: number): string {
  const minutes = Math.floor(quietForMs / 60_000);
  if (minutes < 60) return `quiet ${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return `quiet ${hours}h${minutes % 60 > 0 ? ` ${minutes % 60}m` : ''}`;
}

export interface ActivitySidebarView {
  readonly now: ActivitySidebarNow;
  /** Plain-language items waiting on the user (approvals, prompts). */
  readonly needsYou: readonly string[];
  /** Plain-language upcoming scheduled work, soonest first. */
  readonly comingUp: readonly string[];
  /** Activity feed entries, newest first. */
  readonly recent: readonly ActivityEntry[];
}

const C = DEFAULT_PANEL_PALETTE;

const KIND_GLYPHS: Record<ActivityKind, string> = {
  status: '·',
  tool: '·',
  agent: '»',
  schedule: '◷',
  delivery: '↗',
  security: '!',
  system: '·',
};

const KIND_COLORS: Record<ActivityKind, string> = {
  status: C.dim,
  tool: C.dim,
  agent: C.info,
  schedule: C.accent,
  delivery: C.good,
  security: C.warn,
  system: C.dim,
};

function fmtClock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function entryLine(width: number, entry: ActivityEntry): Line {
  const time = fmtClock(entry.at);
  const glyph = KIND_GLYPHS[entry.kind];
  const color = KIND_COLORS[entry.kind];
  // Strip the leading "[Tag]" — the glyph and color already carry the kind,
  // and horizontal space is the scarcest resource in the sidebar.
  const text = entry.text.replace(/^\[[^\]]+\]\s*/, '');
  const room = Math.max(4, width - time.length - 5);
  return buildPanelLine(width, [
    [` ${time} `, C.dim],
    [`${glyph} `, color],
    [truncateDisplay(text, room), entry.priority === 'high' ? C.value : C.dim],
  ]);
}

function wrappedItemLines(width: number, text: string, fg: string, bullet: string, bulletFg: string): Line[] {
  const bodyWidth = Math.max(4, width - 3);
  const body = buildBodyText(bodyWidth, text, C, fg);
  return body.map((line, index) => {
    const prefix = index === 0 ? ` ${bullet} ` : '   ';
    const cells = buildPanelLine(width, [[prefix, bulletFg]]);
    for (let i = 0; i < bodyWidth; i++) {
      const cell = line[i];
      if (cell !== undefined && 3 + i < width) cells[3 + i] = cell;
    }
    return cells;
  });
}

/**
 * Render the sidebar to exactly `height` lines of exactly `width` cells.
 */
export function buildActivitySidebarLines(
  view: ActivitySidebarView,
  width: number,
  height: number,
): Line[] {
  const lines: Line[] = [];
  const push = (line: Line) => {
    if (lines.length < height) lines.push(line);
  };
  const blank = () => push(createEmptyLine(width));

  // ── Now ──
  if (view.now.busy || view.now.agents.length > 0 || view.now.processes > 0) {
    push(buildSectionHeader(width, 'Now', C));
    if (view.now.busy) {
      push(buildPanelLine(width, [
        [' ● ', C.info],
        [truncateDisplay(view.now.label ?? 'Working…', Math.max(4, width - 4)), C.value],
      ]));
    }
    for (const agent of view.now.agents.slice(0, 3)) {
      const detail = agent.headline ?? agent.progress;
      const text = detail ? `${agent.label} — ${detail}` : agent.label;
      const quiet = agent.quietForMs !== undefined ? ` ${fmtQuietFor(agent.quietForMs)}` : '';
      const room = Math.max(4, width - 4 - getDisplayWidth(quiet));
      push(buildPanelLine(width, [
        [' » ', C.info],
        [truncateDisplay(text, room), C.dim],
        ...(quiet ? [[quiet, C.warn] as [string, string]] : []),
      ]));
    }
    if (view.now.processes > 0) {
      push(buildPanelLine(width, [
        [' ▸ ', C.dim],
        [`${view.now.processes} background ${view.now.processes === 1 ? 'process' : 'processes'}`, C.dim],
      ]));
    }
    blank();
  }

  // ── Needs you ──
  if (view.needsYou.length > 0) {
    push(buildSectionHeader(width, 'Needs you', C));
    for (const item of view.needsYou.slice(0, 4)) {
      for (const line of wrappedItemLines(width, item, C.value, '!', C.warn)) push(line);
    }
    blank();
  }

  // ── Coming up ──
  if (view.comingUp.length > 0) {
    push(buildSectionHeader(width, 'Coming up', C));
    for (const item of view.comingUp.slice(0, 4)) {
      for (const line of wrappedItemLines(width, item, C.dim, '◷', C.accent)) push(line);
    }
    blank();
  }

  // ── Recent ──
  push(buildSectionHeader(width, 'Recent', C));
  const remaining = Math.max(0, height - lines.length);
  if (view.recent.length === 0) {
    push(buildPanelLine(width, [[' Nothing yet — activity will show up here.', C.dim]]));
  } else {
    for (const entry of view.recent.slice(0, remaining)) {
      push(entryLine(width, entry));
    }
  }

  while (lines.length < height) lines.push(createEmptyLine(width));
  return lines.slice(0, height);
}

/**
 * Pick the sidebar width for a terminal width, or 0 when it should not render.
 * The sidebar only earns its space on wide terminals; the conversation always
 * keeps at least ~80 usable columns.
 */
export function resolveActivitySidebarWidth(terminalWidth: number): number {
  if (terminalWidth < 120) return 0;
  return Math.min(44, Math.max(32, Math.floor(terminalWidth * 0.24)));
}

/**
 * Applies the user's Ctrl+O on/off override (see main.ts's `sidebarOverride`)
 * on top of the automatic width above: `null` defers to automatic sizing,
 * `false` forces hidden (0), `true` forces visible at the automatic width
 * (or a sane fallback when the terminal is too narrow for the automatic
 * threshold to produce one).
 */
export function resolveSidebarWidthWithOverride(terminalWidth: number, override: boolean | null): number {
  const auto = resolveActivitySidebarWidth(terminalWidth);
  if (override === null) return auto;
  if (!override) return 0;
  return auto > 0 ? auto : Math.min(36, Math.max(28, Math.floor(terminalWidth * 0.3)));
}

/** True when `getDisplayWidth` would matter; exported for tests. */
export const __test__ = { fmtClock, entryLine, KIND_GLYPHS, getDisplayWidth };
