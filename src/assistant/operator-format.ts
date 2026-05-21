import { firstString, isRecord } from '../types.js';
import { truncate } from '../utils/format.js';

type ReadonlyUnknownRecord = Readonly<Record<string, unknown>>;

export interface WorkPlanCountsSummary {
  readonly total: number;
  readonly pending: number;
  readonly inProgress: number;
  readonly blocked: number;
  readonly done: number;
  readonly failed: number;
  readonly cancelled: number;
}

export interface WorkPlanTaskSummary {
  readonly taskId: string;
  readonly title: string;
  readonly status: string;
  readonly owner: string | null;
  readonly phaseId: string | null;
  readonly priority: number | null;
  readonly notes: string | null;
  readonly tags: readonly string[];
}

export interface WorkPlanSummary {
  readonly ok: boolean | null;
  readonly projectId: string | null;
  readonly knowledgeSpaceId: string | null;
  readonly workPlanId: string | null;
  readonly error: string | null;
  readonly updatedAt: number | null;
  readonly counts: WorkPlanCountsSummary;
  readonly tasks: readonly WorkPlanTaskSummary[];
}

export interface ApprovalItemSummary {
  readonly id: string | null;
  readonly requestId: string | null;
  readonly status: string;
  readonly tool: string;
  readonly category: string | null;
  readonly riskLevel: string | null;
  readonly reason: string | null;
}

export interface ApprovalsSummary {
  readonly awaitingDecision: boolean | null;
  readonly mode: string | null;
  readonly approvalCount: number | null;
  readonly denialCount: number | null;
  readonly cachedChecks: number | null;
  readonly totalChecks: number | null;
  readonly pendingCount: number;
  readonly approvals: readonly ApprovalItemSummary[];
}

export function summarizeWorkPlan(data: unknown): WorkPlanSummary {
  const root = recordOrEmpty(data);
  const counts = recordValue(root, 'counts') ?? {};
  const tasks = recordsValue(root, 'tasks').map(summarizeWorkPlanTask);
  return {
    ok: booleanValue(root, 'ok'),
    projectId: nullableString(root, 'projectId'),
    knowledgeSpaceId: nullableString(root, 'knowledgeSpaceId'),
    workPlanId: nullableString(root, 'workPlanId'),
    error: firstString(root, ['error', 'message', 'reason']) || null,
    updatedAt: nullableNumber(root, 'updatedAt'),
    counts: {
      total: numberValue(counts, 'total') ?? tasks.length,
      pending: numberValue(counts, 'pending') ?? 0,
      inProgress: numberValue(counts, 'in_progress') ?? 0,
      blocked: numberValue(counts, 'blocked') ?? 0,
      done: numberValue(counts, 'done') ?? 0,
      failed: numberValue(counts, 'failed') ?? 0,
      cancelled: numberValue(counts, 'cancelled') ?? 0,
    },
    tasks,
  };
}

export function summarizeApprovals(data: unknown): ApprovalsSummary {
  const root = recordOrEmpty(data);
  const approvals = recordsValue(root, 'approvals').map(summarizeApprovalItem);
  return {
    awaitingDecision: booleanValue(root, 'awaitingDecision'),
    mode: nullableString(root, 'mode'),
    approvalCount: nullableNumber(root, 'approvalCount'),
    denialCount: nullableNumber(root, 'denialCount'),
    cachedChecks: nullableNumber(root, 'cachedChecks'),
    totalChecks: nullableNumber(root, 'totalChecks'),
    pendingCount: approvals.filter((approval) => approval.status === 'pending').length,
    approvals,
  };
}

export function formatWorkPlan(data: unknown): string {
  const summary = summarizeWorkPlan(data);
  const counts = summary.counts;
  const lines = [
    `Work plan ${summary.workPlanId ?? 'current'}`,
    `${counts.total} total, ${counts.inProgress} active, ${counts.pending} pending, ${counts.blocked} blocked, ${counts.done} done, ${counts.failed} failed, ${counts.cancelled} cancelled`,
  ];
  if (summary.ok === false) lines.push(`Warning: ${summary.error ?? 'daemon returned an unsuccessful work-plan snapshot'}`);
  if (summary.projectId || summary.knowledgeSpaceId) {
    lines.push(`Project: ${summary.projectId ?? 'unknown'}${summary.knowledgeSpaceId ? ` (${summary.knowledgeSpaceId})` : ''}`);
  }
  if (summary.tasks.length === 0) {
    lines.push('No work-plan tasks.');
    return lines.join('\n');
  }
  lines.push('', 'Tasks');
  for (const task of summary.tasks.slice(0, 12)) {
    lines.push(`- [${task.status}] ${truncate(task.title, 100)}${task.taskId ? ` (${task.taskId})` : ''}`);
    const details = [
      task.owner ? `owner ${task.owner}` : '',
      task.phaseId ? `phase ${task.phaseId}` : '',
      task.priority !== null ? `priority ${task.priority}` : '',
      task.tags.length > 0 ? `tags ${task.tags.slice(0, 6).join(', ')}` : '',
    ].filter((detail) => detail.length > 0);
    if (details.length > 0) lines.push(`  ${details.join('; ')}`);
    if (task.notes) lines.push(`  ${truncate(task.notes, 140)}`);
  }
  if (summary.tasks.length > 12) lines.push(`  +${summary.tasks.length - 12} more tasks`);
  return lines.join('\n');
}

export function formatApprovals(data: unknown): string {
  const summary = summarizeApprovals(data);
  const lines = [`Approvals ${summary.pendingCount} pending, mode ${summary.mode ?? 'unknown'}`];
  const countDetails = [
    summary.totalChecks !== null ? `${summary.totalChecks} total checks` : '',
    summary.cachedChecks !== null ? `${summary.cachedChecks} cached checks` : '',
    summary.approvalCount !== null ? `${summary.approvalCount} approved` : '',
    summary.denialCount !== null ? `${summary.denialCount} denied` : '',
  ].filter((detail) => detail.length > 0);
  if (countDetails.length > 0) lines.push(countDetails.join(', '));
  if (summary.awaitingDecision === true) lines.push('A decision is currently awaiting user action.');
  if (summary.approvals.length === 0) {
    lines.push('No approval records.');
    return lines.join('\n');
  }
  lines.push('', 'Approval Records');
  const ordered = [
    ...summary.approvals.filter((approval) => approval.status === 'pending'),
    ...summary.approvals.filter((approval) => approval.status !== 'pending'),
  ];
  for (const approval of ordered.slice(0, 12)) {
    lines.push(`- [${approval.status}] ${truncate(approval.tool, 100)}${approval.requestId ? ` (${approval.requestId})` : approval.id ? ` (${approval.id})` : ''}`);
    const details = [approval.riskLevel ? `risk ${approval.riskLevel}` : '', approval.category, approval.reason]
      .filter((detail): detail is string => typeof detail === 'string' && detail.length > 0);
    if (details.length > 0) lines.push(`  ${details.join('; ')}`);
  }
  if (summary.approvals.length > 12) lines.push(`  +${summary.approvals.length - 12} more approval records`);
  return lines.join('\n');
}

function summarizeWorkPlanTask(task: ReadonlyUnknownRecord): WorkPlanTaskSummary {
  return {
    taskId: firstString(task, ['taskId', 'id']),
    title: firstString(task, ['title', 'summary']) || 'Untitled task',
    status: firstString(task, ['status']) || 'unknown',
    owner: nullableString(task, 'owner'),
    phaseId: nullableString(task, 'phaseId'),
    priority: nullableNumber(task, 'priority'),
    notes: nullableString(task, 'notes'),
    tags: stringsValue(task, 'tags'),
  };
}

function summarizeApprovalItem(approval: ReadonlyUnknownRecord): ApprovalItemSummary {
  const request = recordValue(approval, 'request');
  const analysis = recordValue(request, 'analysis');
  const lastDecision = recordValue(approval, 'lastDecision');
  const requestId = nullableString(request, 'callId') ?? nullableString(approval, 'callId');
  return {
    id: firstString(approval, ['id', 'approvalId', 'callId']) || nullableString(lastDecision, 'callId'),
    requestId,
    status: firstString(approval, ['status', 'outcome']) || firstString(lastDecision, ['outcome']) || 'unknown',
    tool: firstString(approval, ['title', 'toolName', 'summary'])
      || firstString(request, ['tool', 'toolName', 'title'])
      || firstString(lastDecision, ['toolName'])
      || 'approval',
    category: nullableString(approval, 'category') ?? nullableString(request, 'category') ?? nullableString(lastDecision, 'category'),
    riskLevel: nullableString(approval, 'riskLevel') ?? nullableString(analysis, 'riskLevel') ?? nullableString(lastDecision, 'riskLevel'),
    reason: nullableString(approval, 'reason') ?? nullableString(analysis, 'summary') ?? nullableString(lastDecision, 'reason'),
  };
}

function recordOrEmpty(value: unknown): ReadonlyUnknownRecord {
  return isRecord(value) ? value : {};
}

function recordValue(record: ReadonlyUnknownRecord | undefined, key: string): ReadonlyUnknownRecord | undefined {
  if (!record) return undefined;
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function recordsValue(record: ReadonlyUnknownRecord, key: string): readonly ReadonlyUnknownRecord[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function stringsValue(record: ReadonlyUnknownRecord, key: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

function nullableString(record: ReadonlyUnknownRecord | undefined, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function booleanValue(record: ReadonlyUnknownRecord, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function numberValue(record: ReadonlyUnknownRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nullableNumber(record: ReadonlyUnknownRecord | undefined, key: string): number | null {
  if (!record) return null;
  const value = numberValue(record, key);
  return value ?? null;
}
