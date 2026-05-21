import type { AssistantRuntime } from '../assistant/runtime.js';
import type { DaemonDiagnosticResult } from '../daemon/client.js';
import type { MemoryRecord } from '../store/memory.js';
import type { PersonaRecord } from '../store/personas.js';
import type { SkillRecord } from '../store/skills.js';
import { summarizeApprovals, summarizeWorkPlan } from '../assistant/operator-format.js';
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
  const active = input.runtime.activeProfile();
  return [
    'Status',
    daemonLine(input.daemon),
    `Chat ${chat.sessionId ?? 'new'}`,
    `Model ${chat.providerModelDisplay}`,
    `Local ${memoryCount} memory, ${skillCount} skills, ${personaCount} personas`,
    `Active ${active.persona.name}; skills ${active.skills.length ? active.skills.map((skill) => skill.name).join(', ') : 'none'}`,
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
  if (snapshot.data === null || snapshot.data === undefined) return ['No work-plan data'];
  const summary = summarizeWorkPlan(snapshot.data);
  const counts = summary.counts;
  const lines = [`${counts.total} total, ${counts.inProgress} active, ${counts.pending} pending, ${counts.blocked} blocked`];
  for (const task of summary.tasks.slice(0, 3)) {
    lines.push(`${task.status} ${truncate(task.title, 64)}`);
  }
  return lines;
}

function approvalLines(snapshot: RemoteSnapshot): readonly string[] {
  if (snapshot.error) return [`warn ${truncate(snapshot.error, 72)}`];
  if (snapshot.data === null || snapshot.data === undefined) return ['No approval data'];
  const summary = summarizeApprovals(snapshot.data);
  const lines = [`${summary.pendingCount} pending, mode ${summary.mode ?? 'unknown'}`];
  for (const approval of summary.approvals.slice(0, 3)) {
    lines.push(`${approval.status} ${truncate(approval.tool, 64)}`);
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
