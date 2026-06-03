import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBrowserGoodVibesSdk } from '@pellux/goodvibes-sdk/browser';
import type { OperatorMethodInput, OperatorMethodOutput } from '@pellux/goodvibes-sdk/contracts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { getModelIdFromProviderModel, getProviderIdFromModel } from '../config/provider-model.ts';
import { SDK_VERSION } from '../version.ts';
import type { AgentRoutineRecord } from './routine-registry.ts';

export const ROUTINE_SCHEDULE_ROUTE = '/api/automation/schedules';
export const ROUTINE_SCHEDULE_METHOD = 'schedules.create';
export const ROUTINE_SCHEDULE_LIST_METHOD = 'schedules.list';

type ScheduleCreateInput = OperatorMethodInput<'schedules.create'>;
type ScheduleCreateOutput = OperatorMethodOutput<'schedules.create'>;
type ScheduleDeliveryInput = NonNullable<ScheduleCreateInput['delivery']>;
type ScheduleDeliveryTargetInput = ScheduleDeliveryInput['targets'] extends readonly (infer T)[] ? T : never;

export interface AgentConnectedHostConfigReader {
  get(key: string): unknown;
}

export interface AgentConnectedHostConnection {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly tokenPath: string;
}

export type RoutineScheduleKind = 'cron' | 'every' | 'at';

export interface RoutineScheduleSpec {
  readonly kind: RoutineScheduleKind;
  readonly value: string;
}

export type RoutineScheduleDeliveryKind = 'webhook' | 'surface' | 'integration' | 'link';

export type RoutineScheduleDeliverySurfaceKind =
  | 'tui'
  | 'web'
  | 'slack'
  | 'discord'
  | 'ntfy'
  | 'webhook'
  | 'telegram'
  | 'google-chat'
  | 'signal'
  | 'whatsapp'
  | 'imessage'
  | 'msteams'
  | 'bluebubbles'
  | 'mattermost'
  | 'matrix'
  | 'service';

export interface RoutineScheduleDeliveryTargetSpec {
  readonly kind: RoutineScheduleDeliveryKind;
  readonly surfaceKind?: RoutineScheduleDeliverySurfaceKind;
  readonly address?: string;
  readonly routeId?: string;
  readonly label?: string;
}

export interface RoutineScheduleReceiptDeliveryTarget {
  readonly kind: RoutineScheduleDeliveryKind;
  readonly surfaceKind?: RoutineScheduleDeliverySurfaceKind;
  readonly address?: string;
  readonly routeId?: string;
  readonly label?: string;
}

export interface ParsedRoutineSchedulePromotionArgs {
  readonly routineId: string | null;
  readonly schedule: RoutineScheduleSpec | null;
  readonly deliveryTargets: readonly RoutineScheduleDeliveryTargetSpec[];
  readonly name?: string;
  readonly timezone?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly enabled: boolean;
  readonly yes: boolean;
  readonly errors: readonly string[];
}

export interface RoutineSchedulePromotionPreview {
  readonly routineId: string;
  readonly routineName: string;
  readonly route: typeof ROUTINE_SCHEDULE_ROUTE;
  readonly method: typeof ROUTINE_SCHEDULE_METHOD;
  readonly payload: ScheduleCreateInput;
}

export interface RoutineSchedulePromotionSuccess {
  readonly ok: true;
  readonly kind: typeof ROUTINE_SCHEDULE_METHOD;
  readonly route: typeof ROUTINE_SCHEDULE_ROUTE;
  readonly routineId: string;
  readonly routineName: string;
  readonly schedule: ScheduleCreateOutput;
  readonly request: ScheduleCreateInput;
}

export interface RoutineSchedulePromotionFailure {
  readonly ok: false;
  readonly kind:
    | 'confirmation_required'
    | 'auth_required'
    | 'connected_host_unavailable'
    | 'version_mismatch'
    | 'connected_host_route_unavailable'
    | 'connected_host_error';
  readonly error: string;
  readonly route: typeof ROUTINE_SCHEDULE_ROUTE;
  readonly baseUrl?: string;
  readonly connectedHostVersion?: string;
  readonly expectedSdkVersion?: string;
}

export type RoutineSchedulePromotionResult =
  | RoutineSchedulePromotionSuccess
  | RoutineSchedulePromotionFailure;

export interface RoutineScheduleReceipt {
  readonly id: string;
  readonly createdAt: string;
  readonly routineId: string;
  readonly routineName: string;
  readonly route: typeof ROUTINE_SCHEDULE_ROUTE;
  readonly method: typeof ROUTINE_SCHEDULE_METHOD;
  readonly status: 'created' | 'failed';
  readonly connectedHostBaseUrl: string;
  readonly scheduleId?: string;
  readonly scheduleStatus?: string;
  readonly scheduleName: string;
  readonly scheduleKind: RoutineScheduleKind;
  readonly scheduleValue: string;
  readonly timezone?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly enabled: boolean;
  readonly target: {
    readonly kind?: string;
    readonly surfaceKind?: string;
    readonly preserveThread?: boolean;
    readonly createIfMissing?: boolean;
  };
  readonly deliveryMode?: string;
  readonly deliveryTargets?: readonly RoutineScheduleReceiptDeliveryTarget[];
  readonly failureKind?: RoutineSchedulePromotionFailure['kind'];
  readonly failureError?: string;
}

export interface RoutineScheduleReceiptSnapshot {
  readonly path: string;
  readonly receipts: readonly RoutineScheduleReceipt[];
}

export interface RoutineScheduleLiveRecord {
  readonly id: string;
  readonly name: string;
  readonly status?: string;
  readonly enabled?: boolean;
  readonly scheduleKind?: RoutineScheduleKind;
  readonly scheduleValue?: string;
  readonly timezone?: string;
  readonly nextRunAt?: number;
  readonly lastRunAt?: number;
  readonly runCount?: number;
  readonly successCount?: number;
  readonly failureCount?: number;
}

export interface RoutineScheduleCorrelation {
  readonly receipt: RoutineScheduleReceipt;
  readonly liveStatus: 'matched' | 'missing' | 'failed-receipt';
  readonly matchReason: 'schedule-id' | 'name-and-cadence' | 'failed-receipt' | 'not-found';
  readonly schedule?: RoutineScheduleLiveRecord;
}

export interface RoutineScheduleCorrelationSuccess {
  readonly ok: true;
  readonly kind: typeof ROUTINE_SCHEDULE_LIST_METHOD;
  readonly route: typeof ROUTINE_SCHEDULE_ROUTE;
  readonly baseUrl: string;
  readonly scheduleCount: number;
  readonly receiptCount: number;
  readonly correlations: readonly RoutineScheduleCorrelation[];
}

export interface RoutineScheduleCorrelationFailure {
  readonly ok: false;
  readonly kind:
    | 'auth_required'
    | 'connected_host_unavailable'
    | 'version_mismatch'
    | 'connected_host_route_unavailable'
    | 'connected_host_error';
  readonly error: string;
  readonly route: typeof ROUTINE_SCHEDULE_ROUTE;
  readonly baseUrl?: string;
  readonly connectedHostVersion?: string;
  readonly expectedSdkVersion?: string;
}

export type RoutineScheduleCorrelationResult =
  | RoutineScheduleCorrelationSuccess
  | RoutineScheduleCorrelationFailure;


function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function normalizeProviderModel(provider: string | undefined, model: string | undefined): {
  readonly provider?: string;
  readonly model?: string;
} {
  if (!model) return provider ? { provider } : {};
  const normalizedProvider = provider ?? getProviderIdFromModel(model);
  return {
    provider: normalizedProvider,
    model: getModelIdFromProviderModel(model),
  };
}

function deliveryModeFromTargets(targets: readonly RoutineScheduleDeliveryTargetSpec[]): ScheduleDeliveryInput['mode'] {
  const first = targets[0];
  return first ? first.kind : 'none';
}

function toDeliveryTargetInput(target: RoutineScheduleDeliveryTargetSpec): ScheduleDeliveryTargetInput {
  return {
    kind: target.kind,
    surfaceKind: target.surfaceKind,
    address: target.address,
    routeId: target.routeId,
    label: target.label,
  };
}

export function resolveAgentConnectedHostConnection(
  configManager: AgentConnectedHostConfigReader,
  homeDirectory: string,
): AgentConnectedHostConnection {
  const host = String(configManager.get('controlPlane.host') ?? '127.0.0.1');
  const port = Number(configManager.get('controlPlane.port') ?? 3421);
  const tokenPath = join(homeDirectory, '.goodvibes', 'daemon', 'operator-tokens.json');
  if (!existsSync(tokenPath)) return { baseUrl: `http://${host}:${Number.isFinite(port) ? port : 3421}`, token: null, tokenPath };
  try {
    const parsed = JSON.parse(readFileSync(tokenPath, 'utf-8')) as unknown;
    const token = isRecord(parsed) && typeof parsed.token === 'string' ? parsed.token : null;
    return { baseUrl: `http://${host}:${Number.isFinite(port) ? port : 3421}`, token, tokenPath };
  } catch {
    return { baseUrl: `http://${host}:${Number.isFinite(port) ? port : 3421}`, token: null, tokenPath };
  }
}

export function buildRoutineSchedulePrompt(routine: AgentRoutineRecord): string {
  return [
    'GoodVibes Agent scheduled routine.',
    '',
    `Routine: ${routine.name}`,
    `Routine id: ${routine.id}`,
    `Review state: ${routine.reviewState}`,
    `Tags: ${routine.tags.join(', ') || '(none)'}`,
    `Triggers: ${routine.triggers.join(', ') || '(manual)'}`,
    '',
    'Operator policy:',
    '- Run this as a serial GoodVibes Agent operator routine.',
    '- Use isolated Agent Knowledge routes only; never use default Knowledge/Wiki or non-Agent knowledge spaces as fallback.',
    '- Do not perform destructive, costly, externally visible, or secret-handling actions without explicit approval.',
    '- Do not request WRFC unless this scheduled routine explicitly delegates build/fix/review work to GoodVibes TUI.',
    '- Summarize what was checked, what changed, and what still needs user review.',
    '',
    'Routine description:',
    routine.description,
    '',
    'Routine steps:',
    routine.steps,
  ].join('\n');
}

export function buildRoutineSchedulePayload(
  routine: AgentRoutineRecord,
  parsed: ParsedRoutineSchedulePromotionArgs,
): ScheduleCreateInput {
  if (!parsed.schedule) throw new Error('Schedule is required.');
  const modelRoute = normalizeProviderModel(parsed.provider, parsed.model);
  const payload: ScheduleCreateInput = {
    name: parsed.name ?? `Agent routine: ${routine.name}`,
    prompt: buildRoutineSchedulePrompt(routine),
    kind: parsed.schedule.kind,
    enabled: parsed.enabled,
    target: {
      kind: 'main',
      surfaceKind: 'service',
      preserveThread: true,
      createIfMissing: true,
    },
    delivery: {
      mode: deliveryModeFromTargets(parsed.deliveryTargets),
      targets: parsed.deliveryTargets.map(toDeliveryTargetInput),
      fallbackTargets: [],
      includeSummary: true,
      includeTranscript: false,
      includeLinks: true,
    },
    failure: {
      action: 'retry',
      maxConsecutiveFailures: 3,
      cooldownMs: 3_600_000,
      retryPolicy: {
        maxAttempts: 2,
        delayMs: 60_000,
        strategy: 'exponential',
        maxDelayMs: 900_000,
        jitterMs: 30_000,
      },
      disableAfterFailures: false,
    },
    lightContext: true,
    autoApprove: false,
    allowUnsafeExternalContent: false,
    ...modelRoute,
  };
  if (parsed.schedule.kind === 'cron') {
    return {
      ...payload,
      cron: parsed.schedule.value,
      timezone: parsed.timezone,
    };
  }
  if (parsed.schedule.kind === 'every') {
    return { ...payload, every: parsed.schedule.value };
  }
  return { ...payload, at: parsed.schedule.value };
}

export function buildRoutineSchedulePreview(
  routine: AgentRoutineRecord,
  parsed: ParsedRoutineSchedulePromotionArgs,
): RoutineSchedulePromotionPreview {
  return {
    routineId: routine.id,
    routineName: routine.name,
    route: ROUTINE_SCHEDULE_ROUTE,
    method: ROUTINE_SCHEDULE_METHOD,
    payload: buildRoutineSchedulePayload(routine, parsed),
  };
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

async function classifyScheduleError(
  error: unknown,
  connection: AgentConnectedHostConnection,
): Promise<RoutineSchedulePromotionFailure> {
  const message = summarizeError(error);
  const lower = message.toLowerCase();
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('auth')) {
    return { ok: false, kind: 'auth_required', error: message, route: ROUTINE_SCHEDULE_ROUTE, baseUrl: connection.baseUrl };
  }
  if (lower.includes('404') || lower.includes('not found')) {
    const connectedHost = await fetchConnectedHostStatus(connection);
    const record = isRecord(connectedHost.body) ? connectedHost.body : {};
    const connectedHostVersion = readString(record, 'version') ?? 'unknown';
    if (connectedHost.ok && connectedHostVersion !== SDK_VERSION) {
      return {
        ok: false,
        kind: 'version_mismatch',
        error: `Connected GoodVibes service SDK version ${connectedHostVersion} does not match Agent SDK pin ${SDK_VERSION}; schedules.create is unavailable.`,
        route: ROUTINE_SCHEDULE_ROUTE,
        baseUrl: connection.baseUrl,
        connectedHostVersion,
        expectedSdkVersion: SDK_VERSION,
      };
    }
    return { ok: false, kind: 'connected_host_route_unavailable', error: message, route: ROUTINE_SCHEDULE_ROUTE, baseUrl: connection.baseUrl };
  }
  if (lower.includes('fetch') || lower.includes('connect') || lower.includes('econnrefused')) {
    return { ok: false, kind: 'connected_host_unavailable', error: message, route: ROUTINE_SCHEDULE_ROUTE, baseUrl: connection.baseUrl };
  }
  return { ok: false, kind: 'connected_host_error', error: message, route: ROUTINE_SCHEDULE_ROUTE, baseUrl: connection.baseUrl };
}

export async function promoteRoutineToConnectedSchedule(
  connection: AgentConnectedHostConnection,
  preview: RoutineSchedulePromotionPreview,
): Promise<RoutineSchedulePromotionResult> {
  if (!connection.token) {
    return {
      ok: false,
      kind: 'auth_required',
      error: `No connected-host operator token found at ${connection.tokenPath}`,
      route: ROUTINE_SCHEDULE_ROUTE,
      baseUrl: connection.baseUrl,
    };
  }
  try {
    const sdk = createBrowserGoodVibesSdk({ baseUrl: connection.baseUrl, authToken: connection.token });
    const schedule = await sdk.operator.invoke(ROUTINE_SCHEDULE_METHOD, preview.payload);
    return {
      ok: true,
      kind: ROUTINE_SCHEDULE_METHOD,
      route: ROUTINE_SCHEDULE_ROUTE,
      routineId: preview.routineId,
      routineName: preview.routineName,
      schedule,
      request: preview.payload,
    };
  } catch (error) {
    return classifyScheduleError(error, connection);
  }
}
