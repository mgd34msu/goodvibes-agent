import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { ShellPathService } from '@/runtime/index.ts';
import type { AgentDaemonConfigReader } from '../agent/routine-schedule-promotion.ts';
import { resolveAgentDaemonConnection } from '../agent/routine-schedule-promotion.ts';

type JsonRecord = Record<string, unknown>;

interface OperatorRouteDescriptor {
  readonly id: string;
  readonly path: string;
}

interface OperatorRouteSuccess {
  readonly ok: true;
  readonly route: OperatorRouteDescriptor;
  readonly body: unknown;
}

interface OperatorRouteFailure {
  readonly ok: false;
  readonly route: OperatorRouteDescriptor;
  readonly kind: 'auth_required' | 'daemon_unavailable' | 'route_unavailable' | 'daemon_error';
  readonly error: string;
}

type OperatorRouteResult = OperatorRouteSuccess | OperatorRouteFailure;

const OPERATOR_BRIEFING_ROUTES: readonly OperatorRouteDescriptor[] = [
  { id: 'projectPlanning.workPlan.snapshot', path: '/api/projects/planning/work-plan' },
  { id: 'approvals.list', path: '/api/approvals' },
  { id: 'automation.integration.snapshot', path: '/api/automation' },
  { id: 'schedules.list', path: '/api/automation/schedules' },
  { id: 'scheduler.capacity', path: '/api/runtime/scheduler' },
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRecord(value: unknown, key: string): JsonRecord {
  return isRecord(value) && isRecord(value[key]) ? value[key] as JsonRecord : {};
}

function readArray(value: unknown, key: string): readonly unknown[] {
  return isRecord(value) && Array.isArray(value[key]) ? value[key] : [];
}

function readNumber(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null;
  const candidate = value[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function readString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : null;
}

function summarizeFetchError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function classifyHttpFailure(route: OperatorRouteDescriptor, status: number, body: unknown): OperatorRouteFailure {
  const detail = isRecord(body) && typeof body.error === 'string' ? body.error : '';
  return {
    ok: false,
    route,
    kind: status === 401 || status === 403
      ? 'auth_required'
      : status === 404
        ? 'route_unavailable'
        : 'daemon_error',
    error: `HTTP ${status}${detail ? `: ${detail}` : ''}`,
  };
}

async function fetchOperatorRoute(
  baseUrl: string,
  token: string,
  route: OperatorRouteDescriptor,
): Promise<OperatorRouteResult> {
  try {
    const response = await fetch(`${baseUrl}${route.path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await readResponseBody(response);
    if (!response.ok) return classifyHttpFailure(route, response.status, body);
    return { ok: true, route, body };
  } catch (error) {
    return {
      ok: false,
      route,
      kind: 'daemon_unavailable',
      error: summarizeFetchError(error),
    };
  }
}

function formatWorkPlan(body: unknown): string {
  const counts = readRecord(body, 'counts');
  const total = readNumber(counts, 'total') ?? readArray(body, 'tasks').length;
  return `  work plan: total ${total}; pending ${readNumber(counts, 'pending') ?? 0}; active ${readNumber(counts, 'in_progress') ?? 0}; blocked ${readNumber(counts, 'blocked') ?? 0}; done ${readNumber(counts, 'done') ?? 0}`;
}

function formatApprovals(body: unknown): string {
  const approvals = readArray(body, 'approvals');
  const pending = approvals.filter((entry) => readString(entry, 'status') === 'pending').length;
  return `  approvals: pending ${pending}; total ${approvals.length}; mode ${readString(body, 'mode') ?? 'unknown'}; awaiting decision ${readString(body, 'awaitingDecision') ?? String(Boolean(isRecord(body) && body.awaitingDecision))}`;
}

function formatAutomation(body: unknown): string {
  const totals = readRecord(body, 'totals');
  const jobs = readNumber(totals, 'jobs') ?? readArray(body, 'jobs').length;
  return `  automation: jobs ${jobs}; enabled ${readNumber(totals, 'enabled') ?? 0}; paused ${readNumber(totals, 'paused') ?? 0}; recent runs ${readNumber(totals, 'runs') ?? readArray(body, 'recentRuns').length}`;
}

function formatSchedules(body: unknown): string {
  const jobs = readArray(body, 'jobs');
  const runs = readArray(body, 'runs');
  const enabled = jobs.filter((entry) => isRecord(entry) && entry.enabled === true).length;
  return `  schedules: jobs ${jobs.length}; enabled ${enabled}; runs ${runs.length}`;
}

function formatCapacity(body: unknown): string {
  return `  scheduler: slots ${readNumber(body, 'slotsInUse') ?? 0}/${readNumber(body, 'slotsTotal') ?? 0}; queue ${readNumber(body, 'queueDepth') ?? 0}; oldest queued ms ${readNumber(body, 'oldestQueuedAgeMs') ?? 0}`;
}

function formatRoute(result: OperatorRouteResult): string {
  if (!result.ok) return `  ${result.route.id}: unavailable (${result.kind}: ${result.error})`;
  if (result.route.id === 'projectPlanning.workPlan.snapshot') return formatWorkPlan(result.body);
  if (result.route.id === 'approvals.list') return formatApprovals(result.body);
  if (result.route.id === 'automation.integration.snapshot') return formatAutomation(result.body);
  if (result.route.id === 'schedules.list') return formatSchedules(result.body);
  return formatCapacity(result.body);
}

function formatBriefing(baseUrl: string, results: readonly OperatorRouteResult[]): string {
  const failures = results.filter((result): result is OperatorRouteFailure => !result.ok);
  return [
    'Agent operator briefing',
    `  connected host: ${baseUrl}`,
    '  policy: read-only public operator routes; no connected-host lifecycle, mutation routes, local workers, WRFC, default Knowledge/Wiki, or non-Agent knowledge segments',
    '',
    ...results.map(formatRoute),
    '',
    failures.length === 0
      ? '  warnings: none'
      : `  warnings: ${failures.length} route(s) unavailable; retry after host/auth/version repair`,
  ].join('\n');
}

export function createAgentOperatorBriefingTool(
  shellPaths: ShellPathService,
  configManager: AgentDaemonConfigReader,
): Tool {
  return {
    definition: {
      name: 'agent_operator_briefing',
      description: [
        'Read connected GoodVibes operator state for a concise main-conversation briefing.',
        'Use when the user asks what needs attention, what is pending, what is scheduled, or what the operator status is.',
        'This is read-only and calls only public work-plan, approvals, automation, schedules, and scheduler routes.',
        'It never uses default Knowledge/Wiki, non-Agent knowledge segments, channel send routes, mutation routes, connected-host lifecycle, local workers, or WRFC.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      sideEffects: ['network'],
    },
    execute: async () => {
      const connection = resolveAgentDaemonConnection(configManager, shellPaths.homeDirectory);
      if (!connection.token) {
        return {
          success: false,
          error: `auth_required: no runtime operator token found at ${connection.tokenPath}`,
        };
      }
      const results: OperatorRouteResult[] = [];
      for (const route of OPERATOR_BRIEFING_ROUTES) {
        results.push(await fetchOperatorRoute(connection.baseUrl, connection.token, route));
      }
      return {
        success: true,
        output: formatBriefing(connection.baseUrl, results),
      };
    },
  };
}

export function registerAgentOperatorBriefingTool(
  registry: ToolRegistry,
  shellPaths: ShellPathService,
  configManager: AgentDaemonConfigReader,
): void {
  registry.register(createAgentOperatorBriefingTool(shellPaths, configManager));
}
