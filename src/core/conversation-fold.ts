// ---------------------------------------------------------------------------
// conversation-fold.ts
//
// The Agent's ADAPTER onto the canonical fold policy.
//
// What a folded block IS, the short-content threshold, the fold default, the
// separator rule, the preview rule, is stated once, in
// @pellux/goodvibes-terminal-shell's conversation-fold-policy, and shared by
// every terminal product. This module holds no decision of its own: it threads
// this product's local render-node and collapse-state types into those
// predicates and returns what they say.
//
// That split is the point. The two renderers drifted apart four separate times
// while each carried its own copy of these rules; a product that wants a
// different answer now changes the policy module, where the other product's
// parity tests will see it.
//
// The row's GEOMETRY belongs to renderConversationFoldedRow in
// renderer/conversation-surface.ts, which draws all three fold classes.
// ---------------------------------------------------------------------------

import {
  FOLDED_SHORT_CONTENT_CHARS,
  foldedToolResult,
  trailingBlankAfterRow,
} from '@pellux/goodvibes-terminal-shell';
import { collapseKeyForNode, type RenderNode } from './conversation-turn-structure.ts';
import { isTurnCollapsed, type ConversationRenderContext } from './conversation-render-context.ts';

/** Re-exported from the policy so callers here have one import to reach for. */
export { FOLDED_SHORT_CONTENT_CHARS };

/**
 * Tool results in this product carry no separate one-line summary field (see
 * ConversationMessageSnapshot: a tool message is callId + content + toolName).
 * The policy's summary branch therefore never applies here, stated once,
 * rather than passed as a bare `false` at each call site.
 */
const TOOL_RESULTS_HAVE_SUMMARY = false;

/** The parts of a render context the fold decision actually reads. */
export type ConversationFoldState = Pick<ConversationRenderContext, 'collapseState' | 'assistantTurns'>;

/**
 * Whether a tool result of this size, with this stored collapse state, renders
 * folded. The renderer calls this for the row it is about to draw; the
 * separator rule below calls it for a row that has not drawn yet. Both get the
 * policy's answer, so asking before and after a row renders agrees.
 */
export function foldedToolResultContent(
  content: string,
  storedCollapsed: boolean | undefined,
): boolean {
  return foldedToolResult({
    contentLength: content.length,
    hasSummary: TOOL_RESULTS_HAVE_SUMMARY,
    storedCollapsed,
  });
}

/**
 * Whether a plan node renders as a single folded tool-result row.
 *
 * Local adaptation only: reject the node kinds that are not tool results at
 * all, then hand the size and the stored collapse state to the policy.
 */
export function isToolResultFolded(state: ConversationFoldState, node: RenderNode | undefined): boolean {
  if (!node || node.kind === 'toolcall') return false;
  const message = node.message;
  if (message.role !== 'tool') return false;
  // A result inside a collapsed turn renders nothing at all, so it is neither
  // a folded row nor something a separator has to follow.
  if (isTurnCollapsed(state.assistantTurns?.get(node.absIdx), state.collapseState)) return false;
  return foldedToolResultContent(message.content, state.collapseState.get(collapseKeyForNode(node)));
}

/** Whether a node is more of the same tool run rather than the answer to it. */
function isToolMachinery(node: RenderNode | undefined): boolean {
  if (!node) return false;
  return node.kind === 'toolcall' || node.message.role === 'tool';
}

/**
 * Whether a blank separator belongs after the unit that just rendered.
 *
 * Local adaptation only: read the three facts the policy asks about off the
 * plan, and let it rule.
 */
export function trailingBlankAfter(
  state: ConversationFoldState,
  node: RenderNode,
  next: RenderNode | undefined,
): boolean {
  return trailingBlankAfterRow({
    nextIsBranchRow: Boolean(next && next.depth > 0),
    nextIsToolMachinery: isToolMachinery(next),
    rowRendersFolded: isToolResultFolded(state, node),
  });
}
