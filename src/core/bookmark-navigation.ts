/**
 * bookmark-navigation.ts — fallback resolution for a bookmark whose direct
 * BlockMeta lookup misses.
 *
 * A bookmark stores a block's collapseKey at the time it was set (see
 * handler-content-actions.ts's handleBookmark). A tool-result message hidden
 * by a collapsed assistant turn (see conversation-turn-structure.ts) pushes
 * no BlockMeta of its own while that turn stays collapsed — its own
 * collapseKey (`msg_<absoluteIdx>`) never appears in getBlockRegistry() until
 * the turn is expanded. A direct
 * find(entry => entry.collapseKey === key) then reports "not found", even
 * though the message is still present in the transcript, just folded under
 * its turn's header.
 *
 * Resolution: parse the message's absolute index out of the `msg_<idx>` key
 * and resolve it through ConversationManager.getMessageLine(idx) instead of
 * the block registry. That registry is keyed by absolute message index and,
 * for a row hidden by a collapsed turn, already resolves to that turn's own
 * header line rather than the position of whatever renders next (see
 * getMessageLine's doc and conversation-rendering.ts, which anchors a hidden
 * row's registered line at its turn's header) — landing on the header is an
 * honest, reachable result rather than a false "not found".
 *
 * Ported from goodvibes-tui's module of the same name.
 */

import type { ConversationManager } from './conversation.ts';

const MESSAGE_BOOKMARK_KEY = /^msg_(\d+)$/;

/**
 * Resolve a bookmark key that missed a direct BlockMeta lookup. Returns the
 * line to scroll to, or null when the key isn't a message-scoped bookmark
 * (`msg_<idx>`) or that message index has never been rendered.
 */
export function resolveFoldedBookmarkLine(
  conversation: Pick<ConversationManager, 'getMessageLine'>,
  key: string,
): number | null {
  const match = MESSAGE_BOOKMARK_KEY.exec(key);
  if (!match) return null;
  const absoluteIdx = Number(match[1]);
  const line = conversation.getMessageLine(absoluteIdx);
  return line === undefined ? null : line;
}
