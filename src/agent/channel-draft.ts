/**
 * channel-draft.ts
 *
 * Agent-side outbox + draft model for channel messages.
 *
 * Provides:
 *   - `ChannelDraft` — a composed-but-not-yet-sent message
 *   - `saveDraft`    — persist a draft to the local JSON store
 *   - `listDrafts`   — read all drafts
 *   - `getDraft`     — read one draft by id
 *   - `deleteDraft`  — remove a draft
 *   - `queueDraftToSend` — promote a draft to a confirmed send input, consuming it
 *
 * Sends always route through the EXISTING `deliverAgentChannelMessage` path
 * (which wraps `ChannelDeliveryRouter.deliver` via the agent_channel_send confirm
 * pattern). No new SDK contract is introduced.
 *
 * Persistence: JSON file at {agentRoot}/channels/drafts.json via ShellPathService.
 *
 * SEAM — a future daemon `channels.drafts.*` operator method could mirror this
 * store server-side for multi-surface sync. The local model is the source of
 * truth until that contract is published.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ShellPathService } from '@/runtime/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';
import type { AgentChannelDeliveryInput } from './channel-delivery.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChannelDraftStatus = 'draft' | 'queued' | 'sent' | 'failed';

export interface ChannelDraft {
  readonly version: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: ChannelDraftStatus;
  /** Human-readable subject / title. */
  readonly title?: string;
  /** Message body. */
  readonly message: string;
  /** Surface target shorthand: e.g. "slack:ops" */
  readonly channel?: string;
  /** Named route id. */
  readonly route?: string;
  /** Webhook URL (stored redacted-safe — callers must redact before persisting). */
  readonly webhook?: string;
  /** Link address. */
  readonly link?: string;
  /** Optional tags for grouping drafts. */
  readonly tags?: readonly string[];
  /** If the draft was sent, the delivery response id. */
  readonly sentResponseId?: string;
  /** If the draft failed to send, the error message. */
  readonly sendError?: string;
}

export interface ChannelDraftSnapshot {
  readonly path: string;
  readonly exists: boolean;
  readonly drafts: readonly ChannelDraft[];
  readonly parseError?: string;
}

export interface ChannelDraftSaveResult {
  readonly draft: ChannelDraft;
  readonly path: string;
}

export interface ChannelDraftQueueResult {
  /** The draft id that was promoted. */
  readonly draftId: string;
  /** The delivery input ready to pass to deliverAgentChannelMessage. */
  readonly deliveryInput: AgentChannelDeliveryInput;
  /** The updated draft (status: 'queued'). */
  readonly draft: ChannelDraft;
}

// ---------------------------------------------------------------------------
// Internal file model
// ---------------------------------------------------------------------------

interface ChannelDraftFile {
  readonly version: 1;
  readonly drafts: readonly ChannelDraft[];
}

type ShellPaths = Pick<ShellPathService, 'resolveUserPath'>;

const DRAFT_VERSION = 1 as const;
const DRAFT_FILE_VERSION = 1 as const;
const DRAFT_LIMIT = 200;

// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------

export function channelDraftFilePath(shellPaths: ShellPaths): string {
  return shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'channels', 'drafts.json');
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readOptString(value: unknown): string | undefined {
  const s = readString(value);
  return s || undefined;
}

function parseDraftStatus(value: unknown): ChannelDraftStatus {
  if (value === 'queued' || value === 'sent' || value === 'failed') return value;
  return 'draft';
}

function parseTags(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value.map(readString).filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

function parseDraft(value: unknown): ChannelDraft | null {
  if (!isRecord(value) || value.version !== DRAFT_VERSION) return null;
  const id = readString(value.id);
  const createdAt = readString(value.createdAt);
  const updatedAt = readString(value.updatedAt);
  const message = readString(value.message);
  if (!id || !createdAt || !updatedAt || !message) return null;
  if (Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(updatedAt))) return null;
  return {
    version: DRAFT_VERSION,
    id,
    createdAt,
    updatedAt,
    status: parseDraftStatus(value.status),
    message,
    ...( readOptString(value.title) ? { title: readOptString(value.title) } : {}),
    ...( readOptString(value.channel) ? { channel: readOptString(value.channel) } : {}),
    ...( readOptString(value.route) ? { route: readOptString(value.route) } : {}),
    ...( readOptString(value.webhook) ? { webhook: readOptString(value.webhook) } : {}),
    ...( readOptString(value.link) ? { link: readOptString(value.link) } : {}),
    ...(parseTags(value.tags) ? { tags: parseTags(value.tags) } : {}),
    ...( readOptString(value.sentResponseId) ? { sentResponseId: readOptString(value.sentResponseId) } : {}),
    ...( readOptString(value.sendError) ? { sendError: readOptString(value.sendError) } : {}),
  };
}

function parseDraftFile(raw: unknown): ChannelDraftFile {
  if (!isRecord(raw)) return { version: DRAFT_FILE_VERSION, drafts: [] };
  const drafts = Array.isArray(raw.drafts)
    ? raw.drafts.map(parseDraft).filter((d): d is ChannelDraft => d !== null)
    : [];
  return { version: DRAFT_FILE_VERSION, drafts };
}

// ---------------------------------------------------------------------------
// Read / write helpers
// ---------------------------------------------------------------------------

export function readChannelDrafts(shellPaths: ShellPaths): ChannelDraftSnapshot {
  const path = channelDraftFilePath(shellPaths);
  if (!existsSync(path)) return { path, exists: false, drafts: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return { path, exists: true, drafts: parseDraftFile(parsed).drafts };
  } catch (error) {
    return {
      path,
      exists: true,
      drafts: [],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function writeDrafts(path: string, drafts: readonly ChannelDraft[]): void {
  const file: ChannelDraftFile = { version: DRAFT_FILE_VERSION, drafts: drafts.slice(0, DRAFT_LIMIT) };
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, path);
}

function generateDraftId(): string {
  const ts = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `draft-${ts}-${randomUUID().slice(0, 8)}`;
}

function draftDigest(message: string): string {
  return createHash('sha256').update(message).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save a new draft or overwrite an existing draft by id.
 *
 * If `id` is provided in `input` and a draft with that id exists, it is
 * updated in-place (updatedAt refreshed). Otherwise a new draft is created.
 */
export function saveDraft(
  shellPaths: ShellPaths,
  input: {
    readonly id?: string;
    readonly title?: string;
    readonly message: string;
    readonly channel?: string;
    readonly route?: string;
    readonly webhook?: string;
    readonly link?: string;
    readonly tags?: readonly string[];
    readonly status?: ChannelDraftStatus;
  },
): ChannelDraftSaveResult {
  const message = input.message.trim();
  if (!message) throw new Error('Draft message is required.');

  const snapshot = readChannelDrafts(shellPaths);
  const path = channelDraftFilePath(shellPaths);
  const now = new Date().toISOString();

  // Try to find existing draft to update
  const existingIndex = input.id ? snapshot.drafts.findIndex((d) => d.id === input.id) : -1;
  const existing = existingIndex >= 0 ? snapshot.drafts[existingIndex] : null;

  const draft: ChannelDraft = {
    version: DRAFT_VERSION,
    id: existing?.id ?? generateDraftId(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    status: input.status ?? existing?.status ?? 'draft',
    message,
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.channel?.trim() ? { channel: input.channel.trim() } : {}),
    ...(input.route?.trim() ? { route: input.route.trim() } : {}),
    ...(input.webhook?.trim() ? { webhook: input.webhook.trim() } : {}),
    ...(input.link?.trim() ? { link: input.link.trim() } : {}),
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
  };

  let updatedDrafts: readonly ChannelDraft[];
  if (existingIndex >= 0) {
    updatedDrafts = snapshot.drafts.map((d, i) => (i === existingIndex ? draft : d));
  } else {
    // Prepend new draft (most recent first)
    updatedDrafts = [draft, ...snapshot.drafts];
  }

  writeDrafts(path, updatedDrafts);
  return { draft, path };
}

/** List all drafts, optionally filtered by status. */
export function listDrafts(
  shellPaths: ShellPaths,
  options: { readonly status?: ChannelDraftStatus; readonly limit?: number } = {},
): ChannelDraftSnapshot {
  const snapshot = readChannelDrafts(shellPaths);
  let drafts = snapshot.drafts;
  if (options.status) {
    drafts = drafts.filter((d) => d.status === options.status);
  }
  if (typeof options.limit === 'number' && options.limit > 0) {
    drafts = drafts.slice(0, options.limit);
  }
  return { ...snapshot, drafts };
}

/** Get a single draft by id. Returns null if not found. */
export function getDraft(shellPaths: ShellPaths, draftId: string): ChannelDraft | null {
  const snapshot = readChannelDrafts(shellPaths);
  return snapshot.drafts.find((d) => d.id === draftId) ?? null;
}

/** Delete a draft by id. Returns true if deleted, false if not found. */
export function deleteDraft(shellPaths: ShellPaths, draftId: string): boolean {
  const snapshot = readChannelDrafts(shellPaths);
  const before = snapshot.drafts.length;
  const updated = snapshot.drafts.filter((d) => d.id !== draftId);
  if (updated.length === before) return false;
  writeDrafts(channelDraftFilePath(shellPaths), updated);
  return true;
}

/**
 * Promote a draft to 'queued' status and return an AgentChannelDeliveryInput
 * ready to pass to `deliverAgentChannelMessage`.
 *
 * The draft is updated to status 'queued'. The caller is responsible for
 * calling `deliverAgentChannelMessage` and then `markDraftSent` or
 * `markDraftFailed` to record the outcome.
 *
 * This routes through the EXISTING confirmed send path — no new SDK contract.
 */
export function queueDraftToSend(
  shellPaths: ShellPaths,
  draftId: string,
): ChannelDraftQueueResult {
  const draft = getDraft(shellPaths, draftId);
  if (!draft) throw new Error(`Draft not found: ${draftId}`);
  if (draft.status === 'sent') throw new Error(`Draft ${draftId} is already sent.`);

  const deliveryInput: AgentChannelDeliveryInput = {
    message: draft.message,
    ...(draft.title ? { title: draft.title } : {}),
    ...(draft.channel ? { channel: draft.channel } : {}),
    ...(draft.route ? { route: draft.route } : {}),
    ...(draft.webhook ? { webhook: draft.webhook } : {}),
    ...(draft.link ? { link: draft.link } : {}),
  };

  const queuedDraft = saveDraft(shellPaths, {
    id: draft.id,
    ...deliveryInput,
    ...(draft.title ? { title: draft.title } : {}),
    ...(draft.tags ? { tags: draft.tags } : {}),
    status: 'queued',
  }).draft;

  return { draftId, deliveryInput, draft: queuedDraft };
}

/**
 * Mark a draft as successfully sent. Records the response id from the delivery.
 */
export function markDraftSent(
  shellPaths: ShellPaths,
  draftId: string,
  responseId?: string,
): ChannelDraft {
  const snapshot = readChannelDrafts(shellPaths);
  const existing = snapshot.drafts.find((d) => d.id === draftId);
  if (!existing) throw new Error(`Draft not found: ${draftId}`);
  const now = new Date().toISOString();
  const patched: ChannelDraft = {
    ...existing,
    updatedAt: now,
    status: 'sent',
    ...(responseId ? { sentResponseId: responseId } : {}),
  };
  const updatedDrafts = snapshot.drafts.map((d) => (d.id === draftId ? patched : d));
  writeDrafts(channelDraftFilePath(shellPaths), updatedDrafts);
  return patched;
}

/**
 * Mark a draft as failed to send. Records the error message.
 */
export function markDraftFailed(
  shellPaths: ShellPaths,
  draftId: string,
  error: string,
): ChannelDraft {
  const snapshot = readChannelDrafts(shellPaths);
  const existing = snapshot.drafts.find((d) => d.id === draftId);
  if (!existing) throw new Error(`Draft not found: ${draftId}`);
  const now = new Date().toISOString();
  const patched: ChannelDraft = {
    ...existing,
    updatedAt: now,
    status: 'failed',
    sendError: error,
  };
  const updatedDrafts = snapshot.drafts.map((d) => (d.id === draftId ? patched : d));
  writeDrafts(channelDraftFilePath(shellPaths), updatedDrafts);
  return patched;
}

/** Format a single draft for human-readable display. */
export function formatChannelDraft(draft: ChannelDraft): string {
  const targetPart = draft.channel
    ? `channel=${draft.channel}`
    : draft.route
      ? `route=${draft.route}`
      : draft.webhook
        ? 'webhook=[redacted]'
        : draft.link
          ? `link=${draft.link}`
          : 'no-target';
  const digest = draftDigest(draft.message);
  const lines = [
    `draft ${draft.id}`,
    `  status: ${draft.status}`,
    `  target: ${targetPart}`,
    ...(draft.title ? [`  title: ${draft.title}`] : []),
    `  message: ${draft.message.length} chars sha256:${digest}`,
    `  created: ${draft.createdAt}  updated: ${draft.updatedAt}`,
    ...(draft.tags && draft.tags.length > 0 ? [`  tags: ${draft.tags.join(', ')}`] : []),
    ...(draft.sentResponseId ? [`  sent response: ${draft.sentResponseId}`] : []),
    ...(draft.sendError ? [`  error: ${draft.sendError}`] : []),
  ];
  return lines.join('\n');
}

/** Format the draft list summary. */
export function formatChannelDraftList(snapshot: ChannelDraftSnapshot): string {
  const lines = [
    'Channel Drafts',
    `  path: ${snapshot.path}`,
    `  total: ${snapshot.drafts.length}`,
    `  status: ${snapshot.parseError ? 'attention' : snapshot.exists ? 'ready' : 'empty'}`,
    ...(snapshot.parseError ? [`  parse error: ${snapshot.parseError}`] : []),
    '  policy: drafts are agent-local; sends require queueDraftToSend + deliverAgentChannelMessage with explicit user confirmation',
    '',
  ];
  if (snapshot.drafts.length === 0) {
    lines.push('  no drafts');
  } else {
    for (const draft of snapshot.drafts) {
      const targetPart = draft.channel ?? draft.route ?? (draft.webhook ? 'webhook=[redacted]' : null) ?? draft.link ?? 'no-target';
      lines.push(`  [${draft.status}] ${draft.id}  target=${targetPart}  ${draft.message.slice(0, 60)}${draft.message.length > 60 ? '...' : ''}`);
    }
  }
  return lines.join('\n');
}
