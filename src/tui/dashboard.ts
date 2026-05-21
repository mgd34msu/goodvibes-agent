import type { AssistantRuntime } from '../assistant/runtime.js';
import type { DaemonDiagnosticResult } from '../daemon/client.js';
import type { MemoryRecord } from '../store/memory.js';
import type { PersonaRecord } from '../store/personas.js';
import type { SkillRecord } from '../store/skills.js';
import { isRecord } from '../types.js';
import { truncate } from '../utils/format.js';

export interface DashboardRemoteState {
  readonly approvals: RemoteSnapshot;
  readonly workPlan: RemoteSnapshot;
}

export interface RemoteSnapshot {
  readonly data: unknown;
  readonly error: string | null;
}

export interface DashboardInput {
  readonly runtime: AssistantRuntime;
  readonly daemon: DaemonDiagnosticResult | null;
  readonly remote: DashboardRemoteState;
}

export function emptyRemoteState(): DashboardRemoteState {
  return {
    approvals: { data: null, error: null },
    workPlan: { data: null, error: null },
  };
}

export function buildDashboard(input: DashboardInput): readonly string[] {
  const chat = input.runtime.chatStatus();
  const memory = input.runtime.memory.list().slice(0, 4);
  const skills = input.runtime.skills.list().slice(0, 3);
  const personas = input.runtime.personas.list().slice(0, 3);
  const memoryCount = input.runtime.memory.list().length;
  const skillCount = input.runtime.skills.list().length;
  const personaCount = input.runtime.personas.list().length;
  return [
    'Status',
    daemonLine(input.daemon),
    `Chat ${chat.sessionId ?? 'new'}`,
    `Model ${chat.providerModelDisplay}`,
    `Local ${memoryCount} memory, ${skillCount} skills, ${personaCount} personas`,
    '',
    'Work Plan',
    ...workPlanLines(input.remote.workPlan),
    '',
    'Approvals',
    ...approvalLines(input.remote.approvals),
    '',
    'Memory',
    ...memoryLines(memory),
    '',
    'Skills',
    ...skillLines(skills),
    '',
    'Personas',
    ...personaLines(personas),
  ];
}

function daemonLine(daemon: DaemonDiagnosticResult | null): string {
  if (!daemon) return 'Daemon checking';
  if (daemon.ok) return `Daemon ok ${daemon.compatibility?.daemonVersion ?? ''}`.trim();
  return `Daemon ${daemon.kind}`;
}

function workPlanLines(snapshot: RemoteSnapshot): readonly string[] {
  if (snapshot.error) return [`warn ${truncate(snapshot.error, 72)}`];
  const data = snapshot.data;
  if (!isRecord(data)) return ['No work-plan data'];
  const counts = isRecord(data.counts) ? data.counts : {};
  const total = numberField(counts, 'total');
  const pending = numberField(counts, 'pending');
  const active = numberField(counts, 'in_progress');
  const blocked = numberField(counts, 'blocked');
  const lines = [`${total} total, ${active} active, ${pending} pending, ${blocked} blocked`];
  const tasks = Array.isArray(data.tasks) ? data.tasks.slice(0, 3) : [];
  for (const task of tasks) {
    if (!isRecord(task)) continue;
    const title = typeof task.title === 'string' ? task.title : 'Untitled task';
    const status = typeof task.status === 'string' ? task.status : 'unknown';
    lines.push(`${status} ${truncate(title, 64)}`);
  }
  return lines;
}

function approvalLines(snapshot: RemoteSnapshot): readonly string[] {
  if (snapshot.error) return [`warn ${truncate(snapshot.error, 72)}`];
  const data = snapshot.data;
  if (!isRecord(data)) return ['No approval data'];
  const approvals = Array.isArray(data.approvals) ? data.approvals : [];
  const pending = approvals.filter((approval) => isRecord(approval) && approval.status === 'pending').length;
  const mode = typeof data.mode === 'string' ? data.mode : 'unknown';
  const lines = [`${pending} pending, mode ${mode}`];
  for (const approval of approvals.slice(0, 3)) {
    if (!isRecord(approval)) continue;
    const request = isRecord(approval.request) ? approval.request : {};
    const tool = typeof request.tool === 'string' ? request.tool : 'approval';
    const status = typeof approval.status === 'string' ? approval.status : 'unknown';
    lines.push(`${status} ${truncate(tool, 64)}`);
  }
  return lines;
}

function memoryLines(records: readonly MemoryRecord[]): readonly string[] {
  if (records.length === 0) return ['No local memory'];
  return records.map((record) => `${record.cls}/${record.reviewState} ${truncate(record.summary, 64)}`);
}

function skillLines(records: readonly SkillRecord[]): readonly string[] {
  if (records.length === 0) return ['No local skills'];
  return records.map((record) => `${record.reviewState} ${truncate(record.name, 64)}`);
}

function personaLines(records: readonly PersonaRecord[]): readonly string[] {
  if (records.length === 0) return ['No personas'];
  return records.map((record) => `${record.reviewState} ${truncate(record.name, 64)}`);
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
