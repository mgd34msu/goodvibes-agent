/**
 * unified-inbox.ts
 *
 * Agent-side unified inbox read-model. Aggregates the three existing daemon-exposed
 * sources that the triage layer already fetches:
 *
 *   1. /api/deliveries           — outbound delivery attempts (status / failures)
 *   2. /api/control-plane/messages — surface messages visible to the TUI client
 *   3. /api/routes/bindings      — live route binding continuity records
 *
 * SEAM — Provider-specific inbound inbox feeds (Slack DMs, Discord DMs, email
 * threads, etc.) are NOT published by any current daemon contract. When the
 * daemon publishes a `channels.inbox.*` operator method or a matching REST
 * endpoint, add an adapter here by implementing `InboundChannelFeedAdapter` and
 * registering it in `aggregateUnifiedInbox`. The rest of the model is already
 * shaped to accept per-channel inbound items.
 */

import type { AgentWorkspaceChannelTriage } from '../input/agent-workspace-channel-triage.ts';

// ---------------------------------------------------------------------------
// Item kinds
// ---------------------------------------------------------------------------

/** An outbound delivery attempt reported by /api/deliveries. */
export interface UnifiedInboxDeliveryItem {
  readonly kind: 'delivery';
  readonly id: string;
  readonly runId: string;
  readonly jobId: string;
  readonly status: 'queued' | 'sending' | 'completed' | 'failed' | 'dead_lettered' | string;
  readonly target: UnifiedInboxTarget;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly error?: string;
  readonly responseId?: string;
  /** Inspect route for the daemon UI / model tool. */
  readonly inspectRoute: string;
}

/** A control-plane surface message reported by /api/control-plane/messages. */
export interface UnifiedInboxSurfaceMessageItem {
  readonly kind: 'surface_message';
  readonly id: string;
  readonly surface: string;
  readonly level: 'info' | 'warning' | 'error' | string;
  readonly title: string;
  readonly bodyPreview: string;
  readonly routeId: string | null;
  readonly surfaceId: string | null;
  readonly clientId: string | null;
  readonly attachmentCount: number;
  readonly createdAt: number | null;
}

/** A route binding reported by /api/routes/bindings. */
export interface UnifiedInboxRouteBindingItem {
  readonly kind: 'route_binding';
  readonly id: string;
  readonly bindingKind: string;
  readonly surfaceKind: string;
  readonly surfaceId: string | null;
  /** External id is digested — never the raw identifier. */
  readonly externalIdDigest: string | null;
  readonly sessionPolicy: string | null;
  readonly threadPolicy: string | null;
  readonly deliveryGuarantee: string | null;
  readonly lastSeenAt: number | null;
  readonly sessionId: string | null;
  readonly runId: string | null;
  readonly jobId: string | null;
}

export type UnifiedInboxItem =
  | UnifiedInboxDeliveryItem
  | UnifiedInboxSurfaceMessageItem
  | UnifiedInboxRouteBindingItem;

export interface UnifiedInboxTarget {
  readonly kind: string;
  readonly surfaceKind: string | null;
  readonly routeId: string | null;
  readonly label: string | null;
  readonly address?: string;
}

// ---------------------------------------------------------------------------
// Aggregate model
// ---------------------------------------------------------------------------

export type UnifiedInboxSourceState = 'ready' | 'empty' | 'unavailable';

export interface UnifiedInboxSource {
  readonly name: string;
  readonly route: string;
  readonly state: UnifiedInboxSourceState;
  readonly itemCount: number;
  readonly error?: string;
}

export interface UnifiedInboxSummary {
  readonly totalItems: number;
  readonly deliveryItems: number;
  readonly surfaceMessageItems: number;
  readonly routeBindingItems: number;
  readonly attentionCount: number;
  readonly failureCount: number;
}

/**
 * SEAM: When the daemon exposes per-channel inbound feeds, add items here.
 * The `inboundChannelFeed` field is intentionally typed as a discriminated union
 * so callers can detect the absent-contract case at compile time.
 */
export type InboundChannelFeedState =
  | { readonly available: false; readonly reason: 'contract_not_published'; readonly daemonMethodNeeded: 'channels.inbox.list' }
  | { readonly available: true; readonly items: readonly UnifiedInboxItem[] };

export interface UnifiedInbox {
  readonly mode: 'unified_inbox';
  readonly status: 'ready' | 'attention' | 'blocked';
  readonly summary: UnifiedInboxSummary;
  readonly items: readonly UnifiedInboxItem[];
  readonly sources: readonly UnifiedInboxSource[];
  /** Outbound delivery attempts. Subset of items where kind === 'delivery'. */
  readonly deliveryItems: readonly UnifiedInboxDeliveryItem[];
  /** Control-plane surface messages. Subset of items where kind === 'surface_message'. */
  readonly surfaceMessageItems: readonly UnifiedInboxSurfaceMessageItem[];
  /** Route binding continuity. Subset of items where kind === 'route_binding'. */
  readonly routeBindingItems: readonly UnifiedInboxRouteBindingItem[];
  /**
   * SEAM: Provider-specific inbound channel feed.
   *
   * This will remain `{ available: false }` until the daemon publishes the
   * `channels.inbox.list` operator method (or equivalent REST endpoint). Once
   * published, replace the `InboundChannelFeedState` branch here and add an
   * adapter in `aggregateUnifiedInbox`.
   */
  readonly inboundChannelFeed: InboundChannelFeedState;
  readonly policy: string;
}

// ---------------------------------------------------------------------------
// Internal helpers — converting triage sub-records to typed items
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string, fallback = ''): string {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringOrNull(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value ? value : null;
}

function toDeliveryItem(raw: Record<string, unknown>): UnifiedInboxDeliveryItem {
  const target = isRecord(raw.target) ? raw.target : {};
  return {
    kind: 'delivery',
    id: readString(raw, 'id', 'delivery'),
    runId: readString(raw, 'runId'),
    jobId: readString(raw, 'jobId'),
    status: readString(raw, 'status', 'unknown'),
    target: {
      kind: readString(target, 'kind', 'unknown'),
      surfaceKind: readStringOrNull(target, 'surfaceKind'),
      routeId: readStringOrNull(target, 'routeId'),
      label: readStringOrNull(target, 'label'),
      ...(typeof target.address === 'string' && target.address ? { address: target.address } : {}),
    },
    ...(readNumber(raw, 'startedAt') !== null ? { startedAt: readNumber(raw, 'startedAt') as number } : {}),
    ...(readNumber(raw, 'endedAt') !== null ? { endedAt: readNumber(raw, 'endedAt') as number } : {}),
    ...(readString(raw, 'error') ? { error: readString(raw, 'error') } : {}),
    ...(readString(raw, 'responseId') ? { responseId: readString(raw, 'responseId') } : {}),
    inspectRoute: readString(raw, 'inspectRoute', `/api/deliveries/${encodeURIComponent(readString(raw, 'id', 'delivery'))}`),
  };
}

function toSurfaceMessageItem(raw: Record<string, unknown>): UnifiedInboxSurfaceMessageItem {
  return {
    kind: 'surface_message',
    id: readString(raw, 'id', 'message'),
    surface: readString(raw, 'surface', 'unknown'),
    level: readString(raw, 'level', 'info'),
    title: readString(raw, 'title'),
    bodyPreview: readString(raw, 'bodyPreview'),
    routeId: readStringOrNull(raw, 'routeId'),
    surfaceId: readStringOrNull(raw, 'surfaceId'),
    clientId: readStringOrNull(raw, 'clientId'),
    attachmentCount: typeof raw.attachmentCount === 'number' ? raw.attachmentCount : 0,
    createdAt: readNumber(raw, 'createdAt'),
  };
}

function toRouteBindingItem(raw: Record<string, unknown>): UnifiedInboxRouteBindingItem {
  return {
    kind: 'route_binding',
    id: readString(raw, 'id', 'binding'),
    bindingKind: readString(raw, 'kind', 'unknown'),
    surfaceKind: readString(raw, 'surfaceKind', 'unknown'),
    surfaceId: readStringOrNull(raw, 'surfaceId'),
    externalIdDigest: readStringOrNull(raw, 'externalIdDigest'),
    sessionPolicy: readStringOrNull(raw, 'sessionPolicy'),
    threadPolicy: readStringOrNull(raw, 'threadPolicy'),
    deliveryGuarantee: readStringOrNull(raw, 'deliveryGuarantee'),
    lastSeenAt: readNumber(raw, 'lastSeenAt'),
    sessionId: readStringOrNull(raw, 'sessionId'),
    runId: readStringOrNull(raw, 'runId'),
    jobId: readStringOrNull(raw, 'jobId'),
  };
}

const DELIVERY_ATTENTION_STATUSES = new Set(['failed', 'dead_lettered', 'pending', 'sending']);

// ---------------------------------------------------------------------------
// Public aggregation API
// ---------------------------------------------------------------------------

/**
 * Build a UnifiedInbox from an already-fetched AgentWorkspaceChannelTriage.
 *
 * This is intentionally a pure transformation — it does not perform any I/O.
 * The caller (command handler or tool) is responsible for calling
 * `buildAgentWorkspaceChannelTriage` first.
 */
export function aggregateUnifiedInbox(
  triage: AgentWorkspaceChannelTriage,
  options: { readonly limit?: number } = {},
): UnifiedInbox {
  const limit = typeof options.limit === 'number' && options.limit > 0 ? Math.min(options.limit, 200) : 50;

  // --- Delivery items ---
  const deliveriesSection = triage.deliveries;
  const rawAttempts = Array.isArray(deliveriesSection.attempts)
    ? (deliveriesSection.attempts as unknown[]).filter(isRecord)
    : [];
  const deliveryItems = rawAttempts.slice(0, limit).map(toDeliveryItem);
  const deliveriesState: UnifiedInboxSourceState = deliveriesSection.state === 'unavailable'
    ? 'unavailable'
    : deliveriesSection.state === 'empty' || deliveryItems.length === 0
      ? 'empty'
      : 'ready';

  // --- Surface message items ---
  const messagesSection = triage.surfaceMessages;
  const rawMessages = Array.isArray(messagesSection.messages)
    ? (messagesSection.messages as unknown[]).filter(isRecord)
    : [];
  const surfaceMessageItems = rawMessages.slice(0, limit).map(toSurfaceMessageItem);
  const messagesState: UnifiedInboxSourceState = messagesSection.state === 'unavailable'
    ? 'unavailable'
    : messagesSection.state === 'empty' || surfaceMessageItems.length === 0
      ? 'empty'
      : 'ready';

  // --- Route binding items ---
  const bindingsSection = triage.routeBindings;
  const rawBindings = Array.isArray(bindingsSection.bindings)
    ? (bindingsSection.bindings as unknown[]).filter(isRecord)
    : [];
  const routeBindingItems = rawBindings.slice(0, limit).map(toRouteBindingItem);
  const bindingsState: UnifiedInboxSourceState = bindingsSection.state === 'unavailable'
    ? 'unavailable'
    : bindingsSection.state === 'empty' || routeBindingItems.length === 0
      ? 'empty'
      : 'ready';

  const items: UnifiedInboxItem[] = [
    ...deliveryItems,
    ...surfaceMessageItems,
    ...routeBindingItems,
  ];

  const attentionCount = deliveryItems.filter((item) => DELIVERY_ATTENTION_STATUSES.has(item.status)).length;
  const failureCount = deliveryItems.filter((item) => item.status === 'failed' || item.status === 'dead_lettered').length;

  const sources: UnifiedInboxSource[] = [
    {
      name: 'deliveries',
      route: '/api/deliveries',
      state: deliveriesState,
      itemCount: deliveryItems.length,
      ...(deliveriesState === 'unavailable' && typeof deliveriesSection.message === 'string'
        ? { error: deliveriesSection.message as string }
        : {}),
    },
    {
      name: 'surface_messages',
      route: '/api/control-plane/messages',
      state: messagesState,
      itemCount: surfaceMessageItems.length,
      ...(messagesState === 'unavailable' && typeof messagesSection.message === 'string'
        ? { error: messagesSection.message as string }
        : {}),
    },
    {
      name: 'route_bindings',
      route: '/api/routes/bindings',
      state: bindingsState,
      itemCount: routeBindingItems.length,
      ...(bindingsState === 'unavailable' && typeof bindingsSection.message === 'string'
        ? { error: bindingsSection.message as string }
        : {}),
    },
  ];

  const blockedSources = sources.filter((s) => s.state === 'unavailable').length;
  const overallStatus: UnifiedInbox['status'] =
    blockedSources === sources.length ? 'blocked' : attentionCount > 0 ? 'attention' : 'ready';

  return {
    mode: 'unified_inbox',
    status: overallStatus,
    summary: {
      totalItems: items.length,
      deliveryItems: deliveryItems.length,
      surfaceMessageItems: surfaceMessageItems.length,
      routeBindingItems: routeBindingItems.length,
      attentionCount,
      failureCount,
    },
    items,
    sources,
    deliveryItems,
    surfaceMessageItems,
    routeBindingItems,
    inboundChannelFeed: {
      available: false,
      reason: 'contract_not_published',
      daemonMethodNeeded: 'channels.inbox.list',
    },
    policy:
      'Read-only unified inbox. Aggregates daemon-exposed delivery attempts, control-plane surface messages, and route bindings. ' +
      'Provider-specific inbound channel feeds (Slack DMs, Discord messages, email threads) are not yet published by the daemon contract — ' +
      'field inboundChannelFeed.available === false until daemon publishes channels.inbox.list.',
  };
}

/**
 * Format a UnifiedInbox for human-readable output.
 */
export function formatUnifiedInbox(inbox: UnifiedInbox): string {
  const { summary, sources, deliveryItems, surfaceMessageItems, routeBindingItems } = inbox;
  const lines: string[] = [
    'Unified Inbox',
    `  status: ${inbox.status}`,
    `  items: ${summary.totalItems} (deliveries: ${summary.deliveryItems}, surface messages: ${summary.surfaceMessageItems}, route bindings: ${summary.routeBindingItems})`,
    `  attention: ${summary.attentionCount}  failures: ${summary.failureCount}`,
    `  inbound channel feed: ${inbox.inboundChannelFeed.available ? 'available' : `not available — daemon method needed: ${inbox.inboundChannelFeed.daemonMethodNeeded}`}`,
    `  policy: ${inbox.policy}`,
    '',
    '  Sources',
  ];

  for (const source of sources) {
    const errorPart = source.error ? ` error=${source.error}` : '';
    lines.push(`  ${source.name}: ${source.state} (${source.itemCount} items) route=${source.route}${errorPart}`);
  }

  if (deliveryItems.length > 0) {
    lines.push('', '  Delivery Attempts');
    for (const item of deliveryItems.slice(0, 10)) {
      const targetDesc = [item.target.surfaceKind, item.target.routeId, item.target.label].filter(Boolean).join('/');
      lines.push(`  - [${item.status}] ${item.id} target=${targetDesc || item.target.kind}${item.error ? ` err=${item.error}` : ''}`);
    }
  }

  if (surfaceMessageItems.length > 0) {
    lines.push('', '  Surface Messages');
    for (const item of surfaceMessageItems.slice(0, 10)) {
      lines.push(`  - [${item.level}] ${item.surface}: ${item.title}`);
    }
  }

  if (routeBindingItems.length > 0) {
    lines.push('', '  Route Bindings');
    for (const item of routeBindingItems.slice(0, 10)) {
      lines.push(`  - ${item.id}: ${item.surfaceKind} ${item.bindingKind} ext=${item.externalIdDigest ?? 'none'}`);
    }
  }

  return lines.join('\n');
}
