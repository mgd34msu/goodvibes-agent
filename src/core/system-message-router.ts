/**
 * SystemMessageRouter — routes system messages to the right surfaces.
 *
 * Every message lands in the ActivityFeed (the ambient "Recent" record shown
 * in the Activity sidebar). High-priority messages — errors, confirmations the
 * user explicitly caused, session lifecycle — additionally land in the main
 * conversation so they are impossible to miss.
 *
 * Two tiers:
 *   - 'high' — conversation AND activity feed. Use for: fatal errors,
 *     model/provider confirmations, session save/load, compaction events.
 *   - 'low'  — activity feed only. Use for: scan results, provider discovery,
 *     plugin load/unload, tool execution status, permission decisions,
 *     health events, debug/operational info.
 *
 * The `ui.systemMessages` / `ui.operationalMessages` settings keep their
 * historical values ('panel' | 'conversation' | 'both'); 'panel' now means
 * "activity feed only".
 */

import type { ConversationManager } from './conversation';
import type { ActivityFeed } from './activity-feed.ts';
import {
  classifySystemMessageKind,
  classifySystemMessagePriority,
  defaultSystemMessageTarget,
  resolveSystemMessageDelivery,
  type SystemMessageKind,
  type SystemMessageTarget,
} from '@/runtime/index.ts';

export type {
  SystemMessageKind,
  SystemMessageTarget,
} from '@/runtime/index.ts';

export type SystemMessagePriority = 'high' | 'low';

/**
 * Routes system messages to the conversation and/or the ActivityFeed
 * based on priority level and per-kind targets.
 */
export class SystemMessageRouter {
  constructor(
    private readonly conversation: ConversationManager,
    private feed: ActivityFeed | null,
    private readonly getTargetForKind: (kind: SystemMessageKind) => SystemMessageTarget = defaultSystemMessageTarget,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────────

  routeTypedSystemMessage(
    message: string,
    priority: SystemMessagePriority,
    kind: SystemMessageKind,
  ): void {
    const target = this.getTargetForKind(kind);
    const delivery = resolveSystemMessageDelivery(target, this.feed !== null);
    if (delivery.toPanel) {
      this.feed?.push(message, priority);
    }
    if (delivery.toConversation) {
      this.conversation.addSystemMessage(message);
    }
  }

  routeSystemMessage(message: string, priority: SystemMessagePriority): void {
    this.routeTypedSystemMessage(message, priority, classifySystemMessageKind(message));
  }

  /**
   * Automatically classify the message priority by content and route.
   * Drop-in replacement for conversation.addSystemMessage().
   */
  routeAuto(message: string): void {
    const priority: SystemMessagePriority = classifySystemMessagePriority(message);
    this.routeTypedSystemMessage(message, priority, classifySystemMessageKind(message));
  }

  /** High-priority shortcut — conversation + activity feed. */
  high(message: string): void {
    this.routeSystemMessage(message, 'high');
  }

  /** Low-priority shortcut — activity feed only. */
  low(message: string): void {
    this.routeSystemMessage(message, 'low');
  }

  wrfc(message: string, priority: SystemMessagePriority = 'high'): void {
    this.routeTypedSystemMessage(message, priority, 'wrfc');
  }

  /** Returns the current activity feed reference. */
  getFeed(): ActivityFeed | null {
    return this.feed;
  }

  /**
   * Replace the feed reference after construction (late binding).
   * Pass null to detach.
   */
  setFeed(feed: ActivityFeed | null): void {
    this.feed = feed;
  }
}

/**
 * Create a SystemMessageRouter wired to the given conversation and feed.
 *
 * @param conversation - The ConversationManager for high-priority messages.
 * @param feed         - The ActivityFeed for ambient traffic. Can be null
 *                       (router still works; feed routing is dropped until
 *                       a feed is attached).
 */
export function createSystemMessageRouter(
  conversation: ConversationManager,
  feed: ActivityFeed | null = null,
  getTargetForKind: (kind: SystemMessageKind) => SystemMessageTarget = defaultSystemMessageTarget,
): SystemMessageRouter {
  return new SystemMessageRouter(conversation, feed, getTargetForKind);
}
