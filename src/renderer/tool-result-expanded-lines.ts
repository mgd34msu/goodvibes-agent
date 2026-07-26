/**
 * tool-result-expanded-lines.ts — the single source of truth for how many
 * screen lines a tool-result message's EXPANDED form actually renders to.
 *
 * Tool-result content gets pretty-printed (JSON.stringify(parsed, null, 2))
 * before display, so the raw message's `content.split('\n')` length is not
 * what the user sees once expanded — a one-line JSON blob can pretty-print to
 * 50 lines. Both the per-block "N lines" badge (conversation-rendering.ts) and
 * every collapsed row's badge (conversation-rendering.ts) must count the SAME
 * post-render lines, or the two disagree with each other and both can disagree
 * with what Tab actually reveals.
 *
 * Adapted from the goodvibes-tui module of the same name. The TUI version has
 * an extra branch that renders unified diffs through renderDiffView; this
 * renderer does NOT — a tool result whose content looks like a diff is still
 * rendered through the markdown path here (only its header glyph/label and
 * BlockMeta type differ). Keeping that difference means these counts stay
 * byte-honest about what this app's expand toggle really reveals.
 */

import type { Line } from '../types/grid.ts';
import { renderMarkdownTracked } from './markdown.ts';

/** True when `content` looks like a unified diff (matches the detection used
 *  by renderConversationToolMessage to pick the diff block type). */
export function isDiffContent(content: string): boolean {
  const contentLines = content.split('\n');
  const hasDiffHeader = contentLines.some((l) => l.startsWith('--- ')) && contentLines.some((l) => l.startsWith('+++ '));
  const hasHunk = contentLines.some((l) => l.startsWith('@@ '));
  return hasDiffHeader && hasHunk;
}

/**
 * Render a tool result's content exactly as its EXPANDED form would appear in
 * the transcript (pretty-printed JSON when parseable, plain markdown
 * otherwise). The caller decides whether to actually display these lines or
 * just count them.
 */
export function renderExpandedToolResultLines(content: string, width: number): Line[] {
  let contentToRender = content;
  const trimmed = contentToRender.trimStart();
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && contentToRender.length < 100_000) {
    try {
      const parsed = JSON.parse(contentToRender);
      contentToRender = `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
    } catch {
      // Leave invalid JSON as-is — falls through to the plain markdown render below.
    }
  }
  return renderMarkdownTracked(contentToRender, width).lines;
}

/**
 * Memoised expanded-line COUNTS, keyed width → content.
 *
 * Why this exists: the "N lines" badge on a COLLAPSED tool result, and the
 * folded group header's total, must both name the expanded render's line count
 * — so the number tells the truth about what expanding reveals. Computing that
 * honestly means running the expanded render even when its lines are thrown
 * away.
 *
 * This renderer has no per-message line cache: ConversationManager rebuilds the
 * entire transcript on every markDirty(), which includes every streaming delta.
 * Re-rendering every tool result's full body on every delta allocates
 * enormously — a handful of 190-line JSON payloads in scrollback turns each
 * keystroke of streamed output into megabytes of throwaway Line[] objects.
 * Measured before this cache: heap climbed 89 MB -> 205 MB across ten rebuilds
 * of a 20-turn transcript, with forced GC between samples.
 *
 * Only the integer count is retained, never the Line[]. The outer map is keyed
 * by width (a number) and the inner map by the content string itself, so the
 * key is a reference to a string the message already holds rather than a fresh
 * concatenation that would duplicate the payload.
 */
const expandedLineCounts = new Map<number, Map<string, number>>();
/** Total memoised entries across all widths, before the cache is dropped. */
let expandedLineCountEntries = 0;
const MAX_EXPANDED_LINE_COUNT_ENTRIES = 2048;

/**
 * Line count of `content`'s EXPANDED render at `width` — the same number
 * renderExpandedToolResultLines(content, width).length would give, without
 * retaining the rendered lines and without recomputing it on every rebuild.
 */
export function countExpandedToolResultLines(content: string, width: number): number {
  let byContent = expandedLineCounts.get(width);
  if (byContent === undefined) {
    byContent = new Map<string, number>();
    expandedLineCounts.set(width, byContent);
  }
  const cached = byContent.get(content);
  if (cached !== undefined) return cached;

  const count = renderExpandedToolResultLines(content, width).length;
  // Wholesale clear rather than LRU bookkeeping: entries are only ever a
  // string reference plus a number, the working set is the visible transcript,
  // and a rebuild immediately repopulates whatever is still on screen.
  if (expandedLineCountEntries >= MAX_EXPANDED_LINE_COUNT_ENTRIES) {
    expandedLineCounts.clear();
    expandedLineCountEntries = 0;
    byContent = new Map<string, number>();
    expandedLineCounts.set(width, byContent);
  }
  byContent.set(content, count);
  expandedLineCountEntries++;
  return count;
}
