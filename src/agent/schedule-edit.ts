import { createBrowserGoodVibesSdk } from '@pellux/goodvibes-sdk/browser';
import type { OperatorMethodInput, OperatorMethodOutput } from '@pellux/goodvibes-sdk/contracts';
import {
  formatEveryInterval,
  normalizeAtSchedule,
  normalizeCronSchedule,
  normalizeEverySchedule,
  type AutomationScheduleDefinition,
} from '@pellux/goodvibes-sdk/platform/automation';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import {
  buildAutonomySchedulePrompt,
} from './autonomy-schedule.ts';
import {
  resolveAgentConnectedHostConnection,
  ROUTINE_SCHEDULE_LIST_METHOD,
  ROUTINE_SCHEDULE_ROUTE,
  type AgentConnectedHostConfigReader,
  type AgentConnectedHostConnection,
  type RoutineScheduleKind,
  type RoutineScheduleSpec,
} from './routine-schedule-promotion.ts';

type SchedulePatchInput = OperatorMethodInput<'automation.jobs.patch'>;
type SchedulePatchOutput = OperatorMethodOutput<'automation.jobs.patch'>;
type ScheduleListOutput = OperatorMethodOutput<'schedules.list'>;

export const SCHEDULE_EDIT_METHOD = 'automation.jobs.patch';
export const SCHEDULE_EDIT_ROUTE = '/api/automation/jobs/{jobId}';

export interface ParsedScheduleEditArgs {
  readonly scheduleId: string | null;
  readonly schedule: RoutineScheduleSpec | null;
  readonly name?: string;
  readonly prompt?: string;
  readonly task?: string;
  readonly successCriteria?: string;
  readonly timezone?: string;
  readonly staggerMs?: number;
  readonly yes: boolean;
  readonly explicitUserRequest: string | null;
  readonly errors: readonly string[];
}

export interface ParseScheduleEditOptions {
  readonly defaultExplicitUserRequest?: string;
}

export interface ScheduleEditPreview {
  readonly scheduleId: string;
  readonly route: typeof SCHEDULE_EDIT_ROUTE;
  readonly method: typeof SCHEDULE_EDIT_METHOD;
  readonly explicitUserRequest: string;
  readonly changes: readonly string[];
  readonly payload: SchedulePatchInput;
  readonly current?: ScheduleEditCurrentSchedule;
}

export interface ScheduleEditFieldDiff {
  readonly field: 'name' | 'schedule' | 'prompt';
  readonly before: string;
  readonly after: string;
  readonly changed: boolean;
}

export interface ScheduleEditCurrentSchedule {
  readonly method: typeof ROUTINE_SCHEDULE_LIST_METHOD;
  readonly route: typeof ROUTINE_SCHEDULE_ROUTE;
  readonly scheduleId: string;
  readonly found: boolean;
  readonly status?: string;
  readonly diffs: readonly ScheduleEditFieldDiff[];
  readonly note?: string;
}

export interface ScheduleEditSuccess {
  readonly ok: true;
  readonly kind: typeof SCHEDULE_EDIT_METHOD;
  readonly route: typeof SCHEDULE_EDIT_ROUTE;
  readonly scheduleId: string;
  readonly schedule: SchedulePatchOutput;
  readonly request: SchedulePatchInput;
}

export interface ScheduleEditFailure {
  readonly ok: false;
  readonly kind:
    | 'confirmation_required'
    | 'auth_required'
    | 'connected_host_unavailable'
    | 'connected_host_incompatible'
    | 'connected_host_route_unavailable'
    | 'connected_host_error';
  readonly error: string;
  readonly route: typeof SCHEDULE_EDIT_ROUTE;
  readonly baseUrl?: string;
}

export type ScheduleEditResult = ScheduleEditSuccess | ScheduleEditFailure;

function optionValue(args: readonly string[], index: number, inlineValue: string | undefined): {
  readonly value: string | undefined;
  readonly nextIndex: number;
} {
  if (inlineValue !== undefined) return { value: inlineValue, nextIndex: index };
  const next = args[index + 1];
  if (next === undefined || next.startsWith('--')) return { value: undefined, nextIndex: index };
  return { value: next, nextIndex: index + 1 };
}

function parseOptionalNumber(raw: string, flag: string): number | string {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return `${flag} must be a finite number greater than or equal to 0.`;
  return value;
}

function scheduleDefinition(schedule: RoutineScheduleSpec, timezone?: string, staggerMs?: number): AutomationScheduleDefinition {
  if (schedule.kind === 'cron') return normalizeCronSchedule(schedule.value, timezone, staggerMs);
  if (timezone) throw new Error('--timezone is only valid with --cron.');
  if (staggerMs !== undefined) throw new Error('--stagger-ms is only valid with --cron.');
  if (schedule.kind === 'every') return normalizeEverySchedule(schedule.value);
  const at = Date.parse(schedule.value);
  if (!Number.isFinite(at)) throw new Error(`Invalid --at timestamp: ${schedule.value}`);
  return normalizeAtSchedule(at);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function scheduleValue(schedule: unknown): string {
  if (!isRecord(schedule)) return 'unknown';
  if (schedule.kind === 'cron') {
    return [
      readString(schedule, 'expression') ?? '',
      readString(schedule, 'timezone') ? `[${readString(schedule, 'timezone')}]` : '',
      typeof schedule.staggerMs === 'number' ? `[stagger ${schedule.staggerMs}ms]` : '',
    ].filter(Boolean).join(' ') || 'cron';
  }
  if (schedule.kind === 'every' && typeof schedule.intervalMs === 'number') return formatEveryInterval(schedule.intervalMs);
  if (schedule.kind === 'at' && typeof schedule.at === 'number') return new Date(schedule.at).toISOString();
  return String(schedule.kind ?? 'unknown');
}

function promptState(job: Record<string, unknown>): string {
  const execution = isRecord(job.execution) ? job.execution : {};
  const prompt = readString(execution, 'prompt') ?? readString(job, 'prompt');
  return prompt?.trim() ? 'existing prompt present' : 'no existing prompt';
}

function readScheduleJob(output: ScheduleListOutput, scheduleId: string): Record<string, unknown> | null {
  const record: Record<string, unknown> = isRecord(output as unknown) ? output as Record<string, unknown> : {};
  const jobs = Array.isArray(record.jobs) ? record.jobs : [];
  for (const job of jobs) {
    if (!isRecord(job)) continue;
    if (readString(job, 'id') === scheduleId) return job;
  }
  return null;
}

function diffChanged(before: string, after: string): boolean {
  return before.trim() !== after.trim();
}

function buildCurrentScheduleContext(
  preview: ScheduleEditPreview,
  output: ScheduleListOutput,
): ScheduleEditCurrentSchedule {
  const job = readScheduleJob(output, preview.scheduleId);
  if (!job) {
    return {
      method: ROUTINE_SCHEDULE_LIST_METHOD,
      route: ROUTINE_SCHEDULE_ROUTE,
      scheduleId: preview.scheduleId,
      found: false,
      diffs: [],
      note: 'No current schedule record matched this id; review the requested patch before confirming.',
    };
  }

  const diffs: ScheduleEditFieldDiff[] = [];
  if (preview.payload.name) {
    const before = readString(job, 'name') ?? 'unknown';
    const after = preview.payload.name;
    diffs.push({ field: 'name', before, after, changed: diffChanged(before, after) });
  }
  if (preview.payload.schedule) {
    const before = scheduleValue(job.schedule);
    const after = scheduleValue(preview.payload.schedule);
    diffs.push({ field: 'schedule', before, after, changed: diffChanged(before, after) });
  }
  if (preview.payload.prompt) {
    diffs.push({
      field: 'prompt',
      before: promptState(job),
      after: 'replacement prompt prepared',
      changed: true,
    });
  }

  return {
    method: ROUTINE_SCHEDULE_LIST_METHOD,
    route: ROUTINE_SCHEDULE_ROUTE,
    scheduleId: preview.scheduleId,
    found: true,
    status: readString(job, 'status') ?? undefined,
    diffs,
  };
}

function pushRequiredPairErrors(parsed: {
  readonly prompt?: string;
  readonly task?: string;
  readonly successCriteria?: string;
}, errors: string[]): void {
  const hasTaskPrompt = Boolean(parsed.task || parsed.successCriteria);
  if (parsed.prompt && hasTaskPrompt) {
    errors.push('Use either --prompt or --task with --success-criteria, not both.');
  }
  if (hasTaskPrompt && (!parsed.task || !parsed.successCriteria)) {
    errors.push('Use --task and --success-criteria together when rebuilding an autonomous schedule prompt.');
  }
}

export function parseScheduleEditArgs(
  args: readonly string[],
  options: ParseScheduleEditOptions = {},
): ParsedScheduleEditArgs {
  let scheduleId: string | null = null;
  let schedule: RoutineScheduleSpec | null = null;
  let name: string | undefined;
  let prompt: string | undefined;
  let task: string | undefined;
  let successCriteria: string | undefined;
  let timezone: string | undefined;
  let staggerMs: number | undefined;
  let yes = false;
  let explicitUserRequest: string | null = options.defaultExplicitUserRequest ?? null;
  const errors: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index] ?? '';
    const equals = raw.indexOf('=');
    const optionName = equals >= 0 ? raw.slice(0, equals) : raw;
    const inlineValue = equals >= 0 ? raw.slice(equals + 1) : undefined;

    if (raw === '--yes') {
      yes = true;
      continue;
    }
    if (
      optionName === '--schedule-id'
      || optionName === '--job-id'
      || optionName === '--name'
      || optionName === '--prompt'
      || optionName === '--task'
      || optionName === '--success-criteria'
      || optionName === '--timezone'
      || optionName === '--explicit-user-request'
    ) {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
      if (optionName === '--schedule-id' || optionName === '--job-id') scheduleId = value;
      if (optionName === '--name') name = value;
      if (optionName === '--prompt') prompt = value;
      if (optionName === '--task') task = value;
      if (optionName === '--success-criteria') successCriteria = value;
      if (optionName === '--timezone') timezone = value;
      if (optionName === '--explicit-user-request') explicitUserRequest = value;
      continue;
    }
    if (optionName === '--cron' || optionName === '--every' || optionName === '--at') {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
      if (schedule) {
        errors.push('Choose exactly one schedule selector: --cron, --every, or --at.');
        continue;
      }
      schedule = {
        kind: optionName === '--cron' ? 'cron' : optionName === '--every' ? 'every' : 'at',
        value,
      };
      continue;
    }
    if (optionName === '--stagger-ms') {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push('--stagger-ms requires a value.');
        continue;
      }
      const parsed = parseOptionalNumber(value, '--stagger-ms');
      if (typeof parsed === 'string') errors.push(parsed);
      else staggerMs = parsed;
      continue;
    }
    if (raw.startsWith('--')) {
      errors.push(`Unknown option ${raw}`);
      continue;
    }
    if (!scheduleId) {
      scheduleId = raw;
      continue;
    }
    errors.push(`Unexpected argument: ${raw}`);
  }

  if (!scheduleId) errors.push('Schedule id is required.');
  if (!explicitUserRequest) errors.push('Explicit user request is required: use --explicit-user-request <authorizing request>.');
  pushRequiredPairErrors({ prompt, task, successCriteria }, errors);
  if (!schedule && !name && !prompt && !task && !successCriteria) {
    errors.push('At least one edit is required: --cron, --every, --at, --name, --prompt, or --task with --success-criteria.');
  }
  if (!schedule && (timezone || staggerMs !== undefined)) {
    errors.push('--timezone and --stagger-ms require a schedule selector.');
  }
  if (schedule && schedule.kind !== 'cron' && (timezone || staggerMs !== undefined)) {
    errors.push('--timezone and --stagger-ms are only valid with --cron.');
  }
  return { scheduleId, schedule, name, prompt, task, successCriteria, timezone, staggerMs, yes, explicitUserRequest, errors };
}

function schedulePatchPrompt(parsed: ParsedScheduleEditArgs): string | undefined {
  if (parsed.prompt) return parsed.prompt;
  if (!parsed.task || !parsed.successCriteria || !parsed.explicitUserRequest) return undefined;
  return buildAutonomySchedulePrompt({
    task: parsed.task,
    successCriteria: parsed.successCriteria,
    explicitUserRequest: parsed.explicitUserRequest,
  });
}

function changeList(parsed: ParsedScheduleEditArgs): readonly string[] {
  return [
    parsed.name ? 'name' : '',
    parsed.schedule ? 'schedule' : '',
    parsed.prompt ? 'prompt' : '',
    parsed.task ? 'autonomous-task-prompt' : '',
  ].filter((value): value is string => value.length > 0);
}

export function buildScheduleEditPayload(parsed: ParsedScheduleEditArgs): SchedulePatchInput {
  if (!parsed.scheduleId) throw new Error('Schedule id is required.');
  const payload: SchedulePatchInput = { jobId: parsed.scheduleId };
  if (parsed.name) payload.name = parsed.name;
  const prompt = schedulePatchPrompt(parsed);
  if (prompt) payload.prompt = prompt;
  if (parsed.schedule) payload.schedule = scheduleDefinition(parsed.schedule, parsed.timezone, parsed.staggerMs);
  return payload;
}

export function buildScheduleEditPreview(parsed: ParsedScheduleEditArgs): ScheduleEditPreview {
  if (!parsed.scheduleId) throw new Error('Schedule id is required.');
  if (!parsed.explicitUserRequest) throw new Error('Explicit user request is required.');
  return {
    scheduleId: parsed.scheduleId,
    route: SCHEDULE_EDIT_ROUTE,
    method: SCHEDULE_EDIT_METHOD,
    explicitUserRequest: parsed.explicitUserRequest,
    changes: changeList(parsed),
    payload: buildScheduleEditPayload(parsed),
  };
}

export async function enrichScheduleEditPreviewFromConnectedHost(
  connection: AgentConnectedHostConnection,
  preview: ScheduleEditPreview,
): Promise<ScheduleEditPreview> {
  if (!connection.token) return preview;
  try {
    const sdk = createBrowserGoodVibesSdk({ baseUrl: connection.baseUrl, authToken: connection.token });
    const output = await sdk.operator.invoke(ROUTINE_SCHEDULE_LIST_METHOD, {});
    return {
      ...preview,
      current: buildCurrentScheduleContext(preview, output),
    };
  } catch (error) {
    return {
      ...preview,
      current: {
        method: ROUTINE_SCHEDULE_LIST_METHOD,
        route: ROUTINE_SCHEDULE_ROUTE,
        scheduleId: preview.scheduleId,
        found: false,
        diffs: [],
        note: `Could not read current schedule state: ${summarizeError(error)}`,
      },
    };
  }
}

async function fetchConnectedHostStatus(connection: AgentConnectedHostConnection): Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}> {
  try {
    const response = await fetch(`${connection.baseUrl}/status`, {
      headers: connection.token ? { authorization: `Bearer ${connection.token}` } : undefined,
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text.trim() ? JSON.parse(text) as unknown : {};
    } catch {
      body = text;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: summarizeError(error) };
  }
}

async function classifyScheduleEditError(
  error: unknown,
  connection: AgentConnectedHostConnection,
): Promise<ScheduleEditFailure> {
  const message = summarizeError(error);
  const lower = message.toLowerCase();
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('auth')) {
    return { ok: false, kind: 'auth_required', error: message, route: SCHEDULE_EDIT_ROUTE, baseUrl: connection.baseUrl };
  }
  if (lower.includes('404') || lower.includes('not found')) {
    const connectedHost = await fetchConnectedHostStatus(connection);
    if (connectedHost.ok) {
      return {
        ok: false,
        kind: 'connected_host_incompatible',
        error: 'Connected GoodVibes host compatibility does not satisfy Agent schedule edit requirements; automation.jobs.patch is unavailable.',
        route: SCHEDULE_EDIT_ROUTE,
        baseUrl: connection.baseUrl,
      };
    }
    return { ok: false, kind: 'connected_host_route_unavailable', error: message, route: SCHEDULE_EDIT_ROUTE, baseUrl: connection.baseUrl };
  }
  if (lower.includes('fetch') || lower.includes('connect') || lower.includes('econnrefused')) {
    return { ok: false, kind: 'connected_host_unavailable', error: message, route: SCHEDULE_EDIT_ROUTE, baseUrl: connection.baseUrl };
  }
  return { ok: false, kind: 'connected_host_error', error: message, route: SCHEDULE_EDIT_ROUTE, baseUrl: connection.baseUrl };
}

export async function editConnectedSchedule(
  connection: AgentConnectedHostConnection,
  preview: ScheduleEditPreview,
): Promise<ScheduleEditResult> {
  if (!connection.token) {
    return {
      ok: false,
      kind: 'auth_required',
      error: `No connected-host operator token found at ${connection.tokenPath}`,
      route: SCHEDULE_EDIT_ROUTE,
      baseUrl: connection.baseUrl,
    };
  }
  try {
    const sdk = createBrowserGoodVibesSdk({ baseUrl: connection.baseUrl, authToken: connection.token });
    const schedule = await sdk.operator.invoke(SCHEDULE_EDIT_METHOD, preview.payload);
    return {
      ok: true,
      kind: SCHEDULE_EDIT_METHOD,
      route: SCHEDULE_EDIT_ROUTE,
      scheduleId: preview.scheduleId,
      schedule,
      request: preview.payload,
    };
  } catch (error) {
    return classifyScheduleEditError(error, connection);
  }
}

export function resolveScheduleEditConnectedHostConnection(
  configManager: AgentConnectedHostConfigReader,
  homeDirectory: string,
): AgentConnectedHostConnection {
  return resolveAgentConnectedHostConnection(configManager, homeDirectory);
}

export function scheduleEditKindFromValue(value: unknown): RoutineScheduleKind | null {
  return value === 'at' || value === 'every' || value === 'cron' ? value : null;
}
