import type { AgentConfig } from '../config.js';
import { classifyDaemonError, daemonErrorMessage } from '../daemon/client.js';
import type { RouteId } from '../daemon/routes.js';
import type { DelegationReceipt, DelegationReceiptStore } from '../store/delegations.js';
import { firstString, isRecord } from '../types.js';
import { truncate } from '../utils/format.js';
import { summarizeWorkPlan, type WorkPlanTaskSummary } from './operator-format.js';
import type { OperatorMethodOutput } from '@pellux/goodvibes-sdk/contracts';

type ReadonlyUnknownRecord = Readonly<Record<string, unknown>>;

export interface DelegationStatusClient {
  invoke<T = unknown>(routeId: RouteId, input?: Record<string, unknown>): Promise<T>;
}

export interface RemoteFailure {
  readonly kind: string;
  readonly message: string;
}

export interface RemoteSnapshot<T> {
  readonly data: T | null;
  readonly error: RemoteFailure | null;
}

export interface SharedSessionSummary {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly messageCount: number;
  readonly pendingInputCount: number;
  readonly activeAgentId: string | null;
  readonly lastAgentId: string | null;
  readonly lastError: string | null;
}

export interface RuntimeTaskCounts {
  readonly queued: number;
  readonly running: number;
  readonly blocked: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
}

export interface RuntimeTaskSummary {
  readonly counts: RuntimeTaskCounts;
  readonly tasks: readonly {
    readonly id: string;
    readonly kind: string;
    readonly title: string;
    readonly status: string;
    readonly owner: string;
    readonly error: string | null;
  }[];
}

export interface DelegationStatusSnapshot {
  readonly selector: string | null;
  readonly selected: DelegationReceipt | null;
  readonly receipts: readonly DelegationReceipt[];
  readonly sessions: RemoteSnapshot<readonly SharedSessionSummary[]>;
  readonly runtimeTasks: RemoteSnapshot<RuntimeTaskSummary>;
  readonly workPlan: RemoteSnapshot<readonly WorkPlanTaskSummary[]>;
  readonly publicListingNote: string;
}

export async function loadDelegationStatusSnapshot(
  client: DelegationStatusClient,
  config: AgentConfig,
  store: DelegationReceiptStore,
  selector?: string | undefined,
): Promise<DelegationStatusSnapshot> {
  const selected = selector ? store.find(selector) : null;
  const receipts = selected ? [selected] : store.list(12);
  const receiptSessionIds = new Set(receipts.map((receipt) => receipt.sessionId));
  const sessions = await safeRemote(async () => {
    const output = await client.invoke<OperatorMethodOutput<'sessions.list'>>('sessions.list');
    return summarizeSessions(output).filter((session) => receiptSessionIds.has(session.id));
  });
  const runtimeTasks = await safeRemote(async () => {
    const output = await client.invoke<OperatorMethodOutput<'tasks.list'>>('tasks.list');
    return summarizeRuntimeTasks(output);
  });
  const workPlan = await safeRemote(async () => {
    const output = await client.invoke<OperatorMethodOutput<'projectPlanning.workPlan.snapshot'>>('projectPlanning.workPlan.snapshot', { limit: 50 });
    return relatedWorkPlanTasks(summarizeWorkPlan(output).tasks, receipts, config);
  });
  return {
    selector: selector ?? null,
    selected,
    receipts,
    sessions,
    runtimeTasks,
    workPlan,
    publicListingNote: 'Public shared-session routes are not origin-filtered yet; local delegation receipts are the interim source of delegated-session history.',
  };
}

export function formatDelegationReceipt(receipt: DelegationReceipt): string {
  return [
    'Delegated to GoodVibes TUI',
    `Receipt: ${receipt.id}`,
    `Session: ${receipt.sessionId}`,
    `Mode: ${receipt.mode}`,
    `WRFC requested: ${receipt.requestedWrfc ? 'yes' : 'no'}`,
    `Task: ${receipt.summary}`,
    `Next: ${receipt.checkCommand}`,
  ].join('\n');
}

export function formatDelegationStatus(snapshot: DelegationStatusSnapshot): string {
  const lines = [snapshot.selected ? `Delegation ${snapshot.selected.id}` : 'Delegations'];
  if (snapshot.selector && !snapshot.selected) {
    lines.push(`No local delegation receipt found for ${snapshot.selector}.`);
    lines.push(snapshot.publicListingNote);
    return lines.join('\n');
  }
  if (snapshot.receipts.length === 0) {
    lines.push('No local delegation receipts.');
    lines.push(snapshot.publicListingNote);
  } else {
    lines.push(`${snapshot.receipts.length} local receipt${snapshot.receipts.length === 1 ? '' : 's'}`);
    for (const receipt of snapshot.receipts) {
      lines.push(`- ${receipt.id} [${receipt.mode}] ${receipt.summary}`);
      lines.push(`  session ${receipt.sessionId}; wrfc ${receipt.requestedWrfc ? 'yes' : 'no'}; next ${receipt.checkCommand}`);
    }
  }

  lines.push('', 'Remote Status');
  if (snapshot.sessions.error) {
    lines.push(`Sessions warning: ${snapshot.sessions.error.kind}: ${snapshot.sessions.error.message}`);
  } else {
    const sessions = snapshot.sessions.data ?? [];
    lines.push(`Sessions matched: ${sessions.length}`);
    for (const session of sessions.slice(0, 8)) {
      lines.push(`- [${session.status}] ${session.title} (${session.id})`);
      const details = [
        `${session.messageCount} messages`,
        `${session.pendingInputCount} pending inputs`,
        session.activeAgentId ? `active agent ${session.activeAgentId}` : '',
        session.lastAgentId ? `last agent ${session.lastAgentId}` : '',
        session.lastError ? `error ${session.lastError}` : '',
      ].filter((detail) => detail.length > 0);
      if (details.length > 0) lines.push(`  ${details.join('; ')}`);
    }
  }

  if (snapshot.runtimeTasks.error) {
    lines.push(`Tasks warning: ${snapshot.runtimeTasks.error.kind}: ${snapshot.runtimeTasks.error.message}`);
  } else if (snapshot.runtimeTasks.data) {
    const counts = snapshot.runtimeTasks.data.counts;
    lines.push(`Tasks: ${counts.queued} queued, ${counts.running} running, ${counts.blocked} blocked, ${counts.completed} completed, ${counts.failed} failed, ${counts.cancelled} cancelled`);
  }

  if (snapshot.workPlan.error) {
    lines.push(`Work plan warning: ${snapshot.workPlan.error.kind}: ${snapshot.workPlan.error.message}`);
  } else {
    const tasks = snapshot.workPlan.data ?? [];
    lines.push(`Related work-plan items: ${tasks.length}`);
    for (const task of tasks.slice(0, 8)) {
      lines.push(`- [${task.status}] ${truncate(task.title, 96)} (${task.taskId})`);
    }
  }

  return lines.join('\n');
}

function summarizeSessions(output: unknown): readonly SharedSessionSummary[] {
  const root = recordOrEmpty(output);
  const sessions = arrayRecords(root, 'sessions');
  return sessions.map((session) => ({
    id: firstString(session, ['id']),
    title: firstString(session, ['title']) || 'Untitled session',
    status: firstString(session, ['status']) || 'unknown',
    messageCount: numberValue(session, 'messageCount') ?? 0,
    pendingInputCount: numberValue(session, 'pendingInputCount') ?? 0,
    activeAgentId: nullableString(session, 'activeAgentId'),
    lastAgentId: nullableString(session, 'lastAgentId'),
    lastError: nullableString(session, 'lastError'),
  })).filter((session) => session.id.length > 0);
}

function summarizeRuntimeTasks(output: unknown): RuntimeTaskSummary {
  const root = recordOrEmpty(output);
  const totals = recordValue(root, 'totals') ?? {};
  return {
    counts: {
      queued: numberValue(root, 'queued') ?? 0,
      running: numberValue(root, 'running') ?? 0,
      blocked: numberValue(root, 'blocked') ?? 0,
      completed: numberValue(totals, 'completed') ?? 0,
      failed: numberValue(totals, 'failed') ?? 0,
      cancelled: numberValue(totals, 'cancelled') ?? 0,
    },
    tasks: arrayRecords(root, 'tasks').map((task) => ({
      id: firstString(task, ['id']),
      kind: firstString(task, ['kind']) || 'unknown',
      title: firstString(task, ['title']) || 'Untitled task',
      status: firstString(task, ['status']) || 'unknown',
      owner: firstString(task, ['owner']) || 'unknown',
      error: nullableString(task, 'error'),
    })).filter((task) => task.id.length > 0),
  };
}

function relatedWorkPlanTasks(
  tasks: readonly WorkPlanTaskSummary[],
  receipts: readonly DelegationReceipt[],
  config: AgentConfig,
): readonly WorkPlanTaskSummary[] {
  if (tasks.length === 0 || receipts.length === 0) return [];
  const taskIds = new Set(receipts.map((receipt) => receipt.taskId).filter(isString));
  const agentIds = new Set(receipts.map((receipt) => receipt.agentId).filter(isString));
  const messageIds = new Set(receipts.map((receipt) => receipt.messageId).filter(isString));
  return tasks.filter((task) => (
    taskIds.has(task.taskId)
    || (task.agentId !== null && agentIds.has(task.agentId))
    || (task.sourceMessageId !== null && messageIds.has(task.sourceMessageId))
    || task.originSurface === config.surfaceId
    || task.tags.includes(config.surfaceId)
  ));
}

async function safeRemote<T>(loader: () => Promise<T>): Promise<RemoteSnapshot<T>> {
  try {
    return { data: await loader(), error: null };
  } catch (error) {
    return {
      data: null,
      error: {
        kind: classifyDaemonError(error),
        message: daemonErrorMessage(error),
      },
    };
  }
}

function recordOrEmpty(value: unknown): ReadonlyUnknownRecord {
  return isRecord(value) ? value : {};
}

function recordValue(record: ReadonlyUnknownRecord | undefined, key: string): ReadonlyUnknownRecord | undefined {
  if (!record) return undefined;
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function arrayRecords(record: ReadonlyUnknownRecord, key: string): readonly ReadonlyUnknownRecord[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function numberValue(record: ReadonlyUnknownRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nullableString(record: ReadonlyUnknownRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
