import { createBrowserGoodVibesSdk } from '@pellux/goodvibes-sdk/browser';
import type { OperatorMethodInput, OperatorMethodOutput } from '@pellux/goodvibes-sdk/contracts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { getModelIdFromProviderModel, getProviderIdFromModel } from '../config/provider-model.ts';
import {
  resolveAgentConnectedHostConnection,
  ROUTINE_SCHEDULE_METHOD,
  ROUTINE_SCHEDULE_ROUTE,
  type AgentConnectedHostConfigReader,
  type AgentConnectedHostConnection,
  type RoutineScheduleDeliveryKind,
  type RoutineScheduleDeliverySurfaceKind,
  type RoutineScheduleDeliveryTargetSpec,
  type RoutineScheduleKind,
  type RoutineScheduleSpec,
} from './routine-schedule-promotion.ts';

type ScheduleCreateInput = OperatorMethodInput<'automation.schedules.create'>;
type ScheduleCreateOutput = OperatorMethodOutput<'automation.schedules.create'>;
type ScheduleDeliveryInput = NonNullable<ScheduleCreateInput['delivery']>;
type ScheduleDeliveryTargetInput = ScheduleDeliveryInput['targets'] extends readonly (infer T)[] ? T : never;

export const AUTONOMY_SCHEDULE_METHOD = ROUTINE_SCHEDULE_METHOD;
export const AUTONOMY_SCHEDULE_ROUTE = ROUTINE_SCHEDULE_ROUTE;

export interface ParsedAutonomyScheduleArgs {
  readonly task: string | null;
  readonly successCriteria: string | null;
  readonly schedule: RoutineScheduleSpec | null;
  readonly deliveryTargets: readonly RoutineScheduleDeliveryTargetSpec[];
  readonly name?: string;
  readonly timezone?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly enabled: boolean;
  readonly yes: boolean;
  readonly explicitUserRequest: string | null;
  readonly errors: readonly string[];
}

export interface AutonomySchedulePreview {
  readonly task: string;
  readonly successCriteria: string;
  readonly explicitUserRequest: string;
  readonly route: typeof AUTONOMY_SCHEDULE_ROUTE;
  readonly method: typeof AUTONOMY_SCHEDULE_METHOD;
  readonly payload: ScheduleCreateInput;
}

export interface AutonomyScheduleSuccess {
  readonly ok: true;
  readonly kind: typeof AUTONOMY_SCHEDULE_METHOD;
  readonly route: typeof AUTONOMY_SCHEDULE_ROUTE;
  readonly task: string;
  readonly successCriteria: string;
  readonly schedule: ScheduleCreateOutput;
  readonly request: ScheduleCreateInput;
}

export interface AutonomyScheduleFailure {
  readonly ok: false;
  readonly kind:
    | 'confirmation_required'
    | 'auth_required'
    | 'connected_host_unavailable'
    | 'connected_host_incompatible'
    | 'connected_host_route_unavailable'
    | 'connected_host_error';
  readonly error: string;
  readonly route: typeof AUTONOMY_SCHEDULE_ROUTE;
  readonly baseUrl?: string;
}

export type AutonomyScheduleResult = AutonomyScheduleSuccess | AutonomyScheduleFailure;

const DELIVERY_SURFACE_KINDS: readonly RoutineScheduleDeliverySurfaceKind[] = [
  'tui',
  'web',
  'slack',
  'discord',
  'ntfy',
  'webhook',
  'telegram',
  'google-chat',
  'signal',
  'whatsapp',
  'telephony',
  'imessage',
  'msteams',
  'bluebubbles',
  'mattermost',
  'matrix',
  'service',
];

function optionValue(args: readonly string[], index: number, inlineValue: string | undefined): {
  readonly value: string | undefined;
  readonly nextIndex: number;
} {
  if (inlineValue !== undefined) return { value: inlineValue, nextIndex: index };
  const next = args[index + 1];
  if (next === undefined || next.startsWith('--')) return { value: undefined, nextIndex: index };
  return { value: next, nextIndex: index + 1 };
}

function isDeliverySurfaceKind(value: string): value is RoutineScheduleDeliverySurfaceKind {
  return DELIVERY_SURFACE_KINDS.includes(value as RoutineScheduleDeliverySurfaceKind);
}

function parseChannelDeliveryTarget(raw: string): RoutineScheduleDeliveryTargetSpec | string {
  const [surfaceKind = '', routeId, label] = raw.split(':');
  if (!isDeliverySurfaceKind(surfaceKind)) {
    return `Unsupported delivery channel "${surfaceKind}".`;
  }
  return {
    kind: 'surface',
    surfaceKind,
    routeId: routeId?.trim() || undefined,
    label: label?.trim() || undefined,
  };
}

function parseWebhookDeliveryTarget(raw: string): RoutineScheduleDeliveryTargetSpec | string {
  const normalized = raw.trim();
  if (!normalized) return '--delivery-webhook requires a URL.';
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '--delivery-webhook must be an http(s) URL.';
  } catch {
    return '--delivery-webhook must be a valid URL.';
  }
  return {
    kind: 'webhook',
    address: normalized,
  };
}

function parseRouteDeliveryTarget(raw: string): RoutineScheduleDeliveryTargetSpec | string {
  const [routeId = '', label] = raw.split(':');
  const normalizedRouteId = routeId.trim();
  if (!normalizedRouteId) return '--delivery-route requires a route id.';
  return {
    kind: 'surface',
    routeId: normalizedRouteId,
    label: label?.trim() || undefined,
  };
}

function parseLinkDeliveryTarget(raw: string): RoutineScheduleDeliveryTargetSpec | string {
  const normalized = raw.trim();
  if (!normalized) return '--delivery-link requires a URL or label.';
  return {
    kind: 'link',
    address: normalized,
  };
}

function validateDeliveryTargets(targets: readonly RoutineScheduleDeliveryTargetSpec[]): string | null {
  const kinds = new Set(targets.map((target) => target.kind));
  return kinds.size > 1 ? 'Use one delivery target kind per autonomous schedule command.' : null;
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

function deliveryModeFromTargets(targets: readonly RoutineScheduleDeliveryTargetSpec[]): RoutineScheduleDeliveryKind | 'none' {
  const first = targets[0];
  return first ? first.kind : 'none';
}

function toDeliveryTargetInput(target: RoutineScheduleDeliveryTargetSpec): ScheduleDeliveryTargetInput {
  return {
    kind: target.kind,
    surfaceKind: target.surfaceKind as ScheduleDeliveryTargetInput['surfaceKind'],
    address: target.address,
    routeId: target.routeId,
    label: target.label,
  };
}

export function parseAutonomyScheduleArgs(args: readonly string[]): ParsedAutonomyScheduleArgs {
  let task: string | null = null;
  let successCriteria: string | null = null;
  let explicitUserRequest: string | null = null;
  let schedule: RoutineScheduleSpec | null = null;
  const deliveryTargets: RoutineScheduleDeliveryTargetSpec[] = [];
  let name: string | undefined;
  let timezone: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let enabled = true;
  let yes = false;
  const errors: string[] = [];
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index] ?? '';
    const equals = raw.indexOf('=');
    const optionName = equals >= 0 ? raw.slice(0, equals) : raw;
    const inlineValue = equals >= 0 ? raw.slice(equals + 1) : undefined;

    if (raw === '--yes') {
      yes = true;
      continue;
    }
    if (raw === '--disabled') {
      enabled = false;
      continue;
    }
    if (
      optionName === '--task'
      || optionName === '--success-criteria'
      || optionName === '--explicit-user-request'
      || optionName === '--name'
      || optionName === '--timezone'
      || optionName === '--provider'
      || optionName === '--model'
    ) {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
      if (optionName === '--task') task = value;
      if (optionName === '--success-criteria') successCriteria = value;
      if (optionName === '--explicit-user-request') explicitUserRequest = value;
      if (optionName === '--name') name = value;
      if (optionName === '--timezone') timezone = value;
      if (optionName === '--provider') provider = value;
      if (optionName === '--model') model = value;
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
    if (optionName === '--delivery-channel' || optionName === '--deliver-channel') {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
      const target = parseChannelDeliveryTarget(value);
      if (typeof target === 'string') errors.push(target);
      else deliveryTargets.push(target);
      continue;
    }
    if (optionName === '--delivery-route' || optionName === '--deliver-route') {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
      const target = parseRouteDeliveryTarget(value);
      if (typeof target === 'string') errors.push(target);
      else deliveryTargets.push(target);
      continue;
    }
    if (optionName === '--delivery-webhook' || optionName === '--deliver-webhook') {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
      const target = parseWebhookDeliveryTarget(value);
      if (typeof target === 'string') errors.push(target);
      else deliveryTargets.push(target);
      continue;
    }
    if (optionName === '--delivery-link' || optionName === '--deliver-link') {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
      const target = parseLinkDeliveryTarget(value);
      if (typeof target === 'string') errors.push(target);
      else deliveryTargets.push(target);
      continue;
    }
    if (raw.startsWith('--')) {
      errors.push(`Unknown option ${raw}`);
      continue;
    }
    positional.push(raw);
  }

  if (!task && positional.length > 0) task = positional.join(' ').trim();
  if (!task) errors.push('Autonomous task is required: use --task <work to perform>.');
  if (!successCriteria) errors.push('Success criteria are required: use --success-criteria <what a good run reports or produces>.');
  if (!explicitUserRequest) errors.push('Explicit user request is required: use --explicit-user-request <authorizing request>.');
  if (!schedule) errors.push('Schedule is required: use --cron <expr>, --every <interval>, or --at <iso-time>.');
  const deliveryError = validateDeliveryTargets(deliveryTargets);
  if (deliveryError) errors.push(deliveryError);
  return { task, successCriteria, schedule, deliveryTargets, name, timezone, provider, model, enabled, yes, explicitUserRequest, errors };
}

export function buildAutonomySchedulePrompt(input: {
  readonly task: string;
  readonly successCriteria: string;
  readonly explicitUserRequest: string;
}): string {
  return [
    'GoodVibes Agent autonomous schedule.',
    '',
    'User request:',
    input.explicitUserRequest,
    '',
    'Task:',
    input.task,
    '',
    'Success criteria:',
    input.successCriteria,
    '',
    'Operator policy:',
    '- Run this as a visible GoodVibes Agent scheduled automation, not a hidden background job.',
    '- Use isolated Agent Knowledge routes only when lookup is needed; never use default knowledge or non-Agent knowledge spaces as fallback.',
    '- Do not perform destructive, costly, externally visible, or secret-handling actions without explicit approval.',
    '- Do not self-expand the scope beyond the task and success criteria; report missing setup or ambiguous requirements instead of improvising.',
    '- Do not request GoodVibes TUI delegation unless this schedule explicitly delegates build/fix/review work and the user asked for that delegation.',
    '- Summarize what was checked, what changed, what still needs review, and the next user-visible action.',
  ].join('\n');
}

export function buildAutonomySchedulePayload(parsed: ParsedAutonomyScheduleArgs): ScheduleCreateInput {
  if (!parsed.task) throw new Error('Autonomous task is required.');
  if (!parsed.successCriteria) throw new Error('Success criteria are required.');
  if (!parsed.explicitUserRequest) throw new Error('Explicit user request is required.');
  if (!parsed.schedule) throw new Error('Schedule is required.');
  const modelRoute = normalizeProviderModel(parsed.provider, parsed.model);
  const payload: ScheduleCreateInput = {
    name: parsed.name ?? `Agent automation: ${parsed.task.slice(0, 48)}`,
    prompt: buildAutonomySchedulePrompt({
      task: parsed.task,
      successCriteria: parsed.successCriteria,
      explicitUserRequest: parsed.explicitUserRequest,
    }),
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

export function buildAutonomySchedulePreview(parsed: ParsedAutonomyScheduleArgs): AutonomySchedulePreview {
  if (!parsed.task) throw new Error('Autonomous task is required.');
  if (!parsed.successCriteria) throw new Error('Success criteria are required.');
  if (!parsed.explicitUserRequest) throw new Error('Explicit user request is required.');
  return {
    task: parsed.task,
    successCriteria: parsed.successCriteria,
    explicitUserRequest: parsed.explicitUserRequest,
    route: AUTONOMY_SCHEDULE_ROUTE,
    method: AUTONOMY_SCHEDULE_METHOD,
    payload: buildAutonomySchedulePayload(parsed),
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

async function classifyAutonomyScheduleError(
  error: unknown,
  connection: AgentConnectedHostConnection,
): Promise<AutonomyScheduleFailure> {
  const message = summarizeError(error);
  const lower = message.toLowerCase();
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('auth')) {
    return { ok: false, kind: 'auth_required', error: message, route: AUTONOMY_SCHEDULE_ROUTE, baseUrl: connection.baseUrl };
  }
  if (lower.includes('404') || lower.includes('not found')) {
    const connectedHost = await fetchConnectedHostStatus(connection);
    if (connectedHost.ok) {
      return {
        ok: false,
        kind: 'connected_host_incompatible',
        error: 'Connected GoodVibes host compatibility does not satisfy Agent schedule requirements; automation.schedules.create is unavailable.',
        route: AUTONOMY_SCHEDULE_ROUTE,
        baseUrl: connection.baseUrl,
      };
    }
    return { ok: false, kind: 'connected_host_route_unavailable', error: message, route: AUTONOMY_SCHEDULE_ROUTE, baseUrl: connection.baseUrl };
  }
  if (lower.includes('fetch') || lower.includes('connect') || lower.includes('econnrefused')) {
    return { ok: false, kind: 'connected_host_unavailable', error: message, route: AUTONOMY_SCHEDULE_ROUTE, baseUrl: connection.baseUrl };
  }
  return { ok: false, kind: 'connected_host_error', error: message, route: AUTONOMY_SCHEDULE_ROUTE, baseUrl: connection.baseUrl };
}

export async function createAutonomySchedule(
  connection: AgentConnectedHostConnection,
  preview: AutonomySchedulePreview,
): Promise<AutonomyScheduleResult> {
  if (!connection.token) {
    return {
      ok: false,
      kind: 'auth_required',
      error: `No connected-host operator token found at ${connection.tokenPath}`,
      route: AUTONOMY_SCHEDULE_ROUTE,
      baseUrl: connection.baseUrl,
    };
  }
  try {
    const sdk = createBrowserGoodVibesSdk({ baseUrl: connection.baseUrl, authToken: connection.token });
    const schedule = await sdk.operator.invoke(AUTONOMY_SCHEDULE_METHOD, preview.payload);
    return {
      ok: true,
      kind: AUTONOMY_SCHEDULE_METHOD,
      route: AUTONOMY_SCHEDULE_ROUTE,
      task: preview.task,
      successCriteria: preview.successCriteria,
      schedule,
      request: preview.payload,
    };
  } catch (error) {
    return classifyAutonomyScheduleError(error, connection);
  }
}

export function resolveAutonomyConnectedHostConnection(configManager: AgentConnectedHostConfigReader, homeDirectory: string): AgentConnectedHostConnection {
  return resolveAgentConnectedHostConnection(configManager, homeDirectory);
}
