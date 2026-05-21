import { firstString, isRecord } from '../types.js';
import { truncate } from '../utils/format.js';

type ReadonlyUnknownRecord = Readonly<Record<string, unknown>>;

export interface AutomationJobSummary {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly enabled: boolean | null;
  readonly scheduleKind: string | null;
  readonly nextRunAt: number | null;
  readonly runCount: number | null;
  readonly failureCount: number | null;
}

export interface AutomationRunSummary {
  readonly id: string;
  readonly jobId: string | null;
  readonly status: string;
  readonly trigger: string | null;
  readonly queuedAt: number | null;
  readonly error: string | null;
}

export interface AutomationCapacitySummary {
  readonly slotsTotal: number;
  readonly slotsInUse: number;
  readonly queueDepth: number;
  readonly oldestQueuedAgeMs: number | null;
}

export interface AutomationSnapshotSummary {
  readonly jobsTotal: number;
  readonly enabled: number;
  readonly paused: number;
  readonly runsTotal: number;
  readonly jobs: readonly AutomationJobSummary[];
  readonly recentRuns: readonly AutomationRunSummary[];
}

export function summarizeAutomationSnapshot(data: unknown): AutomationSnapshotSummary {
  const root = recordOrEmpty(data);
  const totals = recordValue(root, 'totals') ?? {};
  const jobs = recordsValue(root, 'jobs').map(summarizeJob);
  const recentRuns = recordsValue(root, 'recentRuns').map(summarizeRun);
  return {
    jobsTotal: numberValue(totals, 'jobs') ?? jobs.length,
    enabled: numberValue(totals, 'enabled') ?? jobs.filter((job) => job.enabled === true).length,
    paused: numberValue(totals, 'paused') ?? jobs.filter((job) => job.status === 'paused').length,
    runsTotal: numberValue(totals, 'runs') ?? recentRuns.length,
    jobs,
    recentRuns,
  };
}

export function summarizeJobs(data: unknown): readonly AutomationJobSummary[] {
  return recordsValue(recordOrEmpty(data), 'jobs').map(summarizeJob);
}

export function summarizeRuns(data: unknown): readonly AutomationRunSummary[] {
  return recordsValue(recordOrEmpty(data), 'runs').map(summarizeRun);
}

export function summarizeCapacity(data: unknown): AutomationCapacitySummary {
  const root = recordOrEmpty(data);
  return {
    slotsTotal: numberValue(root, 'slotsTotal') ?? 0,
    slotsInUse: numberValue(root, 'slotsInUse') ?? 0,
    queueDepth: numberValue(root, 'queueDepth') ?? 0,
    oldestQueuedAgeMs: nullableNumber(root, 'oldestQueuedAgeMs'),
  };
}

export function formatAutomationSnapshot(data: unknown): string {
  const summary = summarizeAutomationSnapshot(data);
  const lines = [
    'Automation',
    `${summary.jobsTotal} jobs, ${summary.enabled} enabled, ${summary.paused} paused, ${summary.runsTotal} runs`,
  ];
  if (summary.jobs.length === 0) {
    lines.push('No automation jobs.');
  } else {
    lines.push('', 'Jobs');
    for (const job of summary.jobs.slice(0, 8)) lines.push(formatJobLine(job));
    if (summary.jobs.length > 8) lines.push(`  +${summary.jobs.length - 8} more jobs`);
  }
  if (summary.recentRuns.length > 0) {
    lines.push('', 'Recent Runs');
    for (const run of summary.recentRuns.slice(0, 6)) lines.push(formatRunLine(run));
  }
  return lines.join('\n');
}

export function formatAutomationJobs(data: unknown): string {
  const jobs = summarizeJobs(data);
  const lines = [`Automation jobs ${jobs.length}`];
  if (jobs.length === 0) {
    lines.push('No automation jobs.');
    return lines.join('\n');
  }
  for (const job of jobs.slice(0, 12)) lines.push(formatJobLine(job));
  if (jobs.length > 12) lines.push(`  +${jobs.length - 12} more jobs`);
  return lines.join('\n');
}

export function formatAutomationRuns(data: unknown): string {
  const runs = summarizeRuns(data);
  const lines = [`Automation runs ${runs.length}`];
  if (runs.length === 0) {
    lines.push('No automation runs.');
    return lines.join('\n');
  }
  for (const run of runs.slice(0, 12)) lines.push(formatRunLine(run));
  if (runs.length > 12) lines.push(`  +${runs.length - 12} more runs`);
  return lines.join('\n');
}

export function formatSchedules(data: unknown): string {
  const jobs = summarizeJobs(data);
  const runs = summarizeRuns(data);
  const lines = [`Schedules ${jobs.length} jobs, ${runs.length} runs`];
  if (jobs.length === 0) {
    lines.push('No schedules.');
    return lines.join('\n');
  }
  for (const job of jobs.slice(0, 12)) lines.push(formatJobLine(job));
  if (jobs.length > 12) lines.push(`  +${jobs.length - 12} more schedules`);
  return lines.join('\n');
}

export function formatHeartbeat(data: unknown): string {
  const pending = recordsValue(recordOrEmpty(data), 'pending');
  const lines = [`Automation heartbeat ${pending.length} pending`];
  if (pending.length === 0) {
    lines.push('No pending heartbeat work.');
    return lines.join('\n');
  }
  for (const item of pending.slice(0, 12)) {
    const jobName = firstString(item, ['jobName']) || firstString(item, ['jobId']) || 'job';
    const trigger = firstString(item, ['trigger']) || 'unknown';
    const reason = firstString(item, ['reason']);
    lines.push(`- ${trigger} ${truncate(jobName, 80)}${reason ? `: ${truncate(reason, 100)}` : ''}`);
  }
  if (pending.length > 12) lines.push(`  +${pending.length - 12} more heartbeat items`);
  return lines.join('\n');
}

export function formatCapacity(data: unknown): string {
  const capacity = summarizeCapacity(data);
  const oldest = capacity.oldestQueuedAgeMs === null
    ? 'none'
    : `${Math.round(capacity.oldestQueuedAgeMs / 1000)}s`;
  return [
    'Scheduler capacity',
    `${capacity.slotsInUse}/${capacity.slotsTotal} slots in use, queue depth ${capacity.queueDepth}, oldest queued ${oldest}`,
  ].join('\n');
}

function summarizeJob(job: ReadonlyUnknownRecord): AutomationJobSummary {
  const schedule = recordValue(job, 'schedule');
  return {
    id: firstString(job, ['id', 'jobId']),
    name: firstString(job, ['name', 'title']) || firstString(job, ['id', 'jobId']) || 'automation job',
    status: firstString(job, ['status']) || (booleanValue(job, 'enabled') === true ? 'enabled' : 'unknown'),
    enabled: booleanValue(job, 'enabled'),
    scheduleKind: nullableString(schedule, 'kind') ?? nullableString(job, 'scheduleKind'),
    nextRunAt: nullableNumber(job, 'nextRunAt'),
    runCount: nullableNumber(job, 'runCount'),
    failureCount: nullableNumber(job, 'failureCount'),
  };
}

function summarizeRun(run: ReadonlyUnknownRecord): AutomationRunSummary {
  return {
    id: firstString(run, ['id', 'runId']),
    jobId: nullableString(run, 'jobId'),
    status: firstString(run, ['status']) || 'unknown',
    trigger: nullableString(run, 'trigger'),
    queuedAt: nullableNumber(run, 'queuedAt'),
    error: nullableString(run, 'error'),
  };
}

function formatJobLine(job: AutomationJobSummary): string {
  const details = [
    job.scheduleKind ? `schedule ${job.scheduleKind}` : '',
    job.nextRunAt !== null ? `next ${formatTimestamp(job.nextRunAt)}` : '',
    job.runCount !== null ? `${job.runCount} runs` : '',
    job.failureCount !== null && job.failureCount > 0 ? `${job.failureCount} failures` : '',
  ].filter((detail) => detail.length > 0);
  return `- [${job.status}] ${truncate(job.name, 100)}${job.id ? ` (${job.id})` : ''}${details.length ? `; ${details.join('; ')}` : ''}`;
}

function formatRunLine(run: AutomationRunSummary): string {
  const details = [
    run.trigger ? `trigger ${run.trigger}` : '',
    run.jobId ? `job ${run.jobId}` : '',
    run.queuedAt !== null ? `queued ${formatTimestamp(run.queuedAt)}` : '',
    run.error ? `error ${truncate(run.error, 100)}` : '',
  ].filter((detail) => detail.length > 0);
  return `- [${run.status}] ${run.id || 'run'}${details.length ? `; ${details.join('; ')}` : ''}`;
}

function formatTimestamp(value: number): string {
  return new Date(value).toISOString();
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
  return Array.isArray(value) ? value.filter(isRecord) : [];
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
  return numberValue(record, key) ?? null;
}

function nullableString(record: ReadonlyUnknownRecord | undefined, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
