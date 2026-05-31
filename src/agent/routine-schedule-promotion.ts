import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createBrowserGoodVibesSdk } from '@pellux/goodvibes-sdk/browser';
import type { OperatorMethodInput, OperatorMethodOutput } from '@pellux/goodvibes-sdk/contracts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import type { ShellPathService } from '@/runtime/index.ts';
import { getModelIdFromProviderModel, getProviderIdFromModel } from '../config/provider-model.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';
import { SDK_VERSION } from '../version.ts';
import type { AgentRoutineRecord } from './routine-registry.ts';

export const ROUTINE_SCHEDULE_ROUTE = '/api/automation/schedules';
export const ROUTINE_SCHEDULE_METHOD = 'schedules.create';

type ScheduleCreateInput = OperatorMethodInput<'schedules.create'>;
type ScheduleCreateOutput = OperatorMethodOutput<'schedules.create'>;

export interface AgentDaemonConfigReader {
  get(key: string): unknown;
}

export interface AgentDaemonConnection {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly tokenPath: string;
}

export type RoutineScheduleKind = 'cron' | 'every' | 'at';

export interface RoutineScheduleSpec {
  readonly kind: RoutineScheduleKind;
  readonly value: string;
}

export interface ParsedRoutineSchedulePromotionArgs {
  readonly routineId: string | null;
  readonly schedule: RoutineScheduleSpec | null;
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
    | 'daemon_unavailable'
    | 'version_mismatch'
    | 'daemon_route_unavailable'
    | 'daemon_error';
  readonly error: string;
  readonly route: typeof ROUTINE_SCHEDULE_ROUTE;
  readonly baseUrl?: string;
  readonly daemonVersion?: string;
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
  readonly daemonBaseUrl: string;
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
  readonly failureKind?: RoutineSchedulePromotionFailure['kind'];
  readonly failureError?: string;
}

export interface RoutineScheduleReceiptSnapshot {
  readonly path: string;
  readonly receipts: readonly RoutineScheduleReceipt[];
}

interface RoutineScheduleReceiptStoreFile {
  readonly version: 1;
  readonly receipts: readonly RoutineScheduleReceipt[];
}

const RECEIPT_STORE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function optionValue(args: readonly string[], index: number, inlineValue: string | undefined): {
  readonly value: string | undefined;
  readonly nextIndex: number;
} {
  if (inlineValue !== undefined) return { value: inlineValue, nextIndex: index };
  const next = args[index + 1];
  if (next === undefined || next.startsWith('--')) return { value: undefined, nextIndex: index };
  return { value: next, nextIndex: index + 1 };
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

function readReceipt(value: unknown): RoutineScheduleReceipt | null {
  if (!isRecord(value)) return null;
  const id = readString(value, 'id')?.trim();
  const createdAt = readString(value, 'createdAt')?.trim();
  const routineId = readString(value, 'routineId')?.trim();
  const routineName = readString(value, 'routineName')?.trim();
  const status = value.status === 'created' || value.status === 'failed' ? value.status : null;
  const scheduleKind = value.scheduleKind === 'cron' || value.scheduleKind === 'every' || value.scheduleKind === 'at'
    ? value.scheduleKind
    : null;
  const scheduleValue = readString(value, 'scheduleValue')?.trim();
  const target = isRecord(value.target) ? value.target : {};
  if (!id || !createdAt || !routineId || !routineName || !status || !scheduleKind || !scheduleValue) return null;
  return {
    id,
    createdAt,
    routineId,
    routineName,
    route: ROUTINE_SCHEDULE_ROUTE,
    method: ROUTINE_SCHEDULE_METHOD,
    status,
    daemonBaseUrl: readString(value, 'daemonBaseUrl') ?? '',
    scheduleId: readString(value, 'scheduleId') ?? undefined,
    scheduleStatus: readString(value, 'scheduleStatus') ?? undefined,
    scheduleName: readString(value, 'scheduleName') ?? routineName,
    scheduleKind,
    scheduleValue,
    timezone: readString(value, 'timezone') ?? undefined,
    provider: readString(value, 'provider') ?? undefined,
    model: readString(value, 'model') ?? undefined,
    enabled: value.enabled !== false,
    target: {
      kind: readString(target, 'kind') ?? undefined,
      surfaceKind: readString(target, 'surfaceKind') ?? undefined,
      preserveThread: readBoolean(target, 'preserveThread'),
      createIfMissing: readBoolean(target, 'createIfMissing'),
    },
    deliveryMode: readString(value, 'deliveryMode') ?? undefined,
    failureKind: value.failureKind === 'confirmation_required'
      || value.failureKind === 'auth_required'
      || value.failureKind === 'daemon_unavailable'
      || value.failureKind === 'version_mismatch'
      || value.failureKind === 'daemon_route_unavailable'
      || value.failureKind === 'daemon_error'
      ? value.failureKind
      : undefined,
    failureError: readString(value, 'failureError') ?? undefined,
  };
}

function parseReceiptStore(raw: string): RoutineScheduleReceiptStoreFile {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return { version: RECEIPT_STORE_VERSION, receipts: [] };
  return {
    version: RECEIPT_STORE_VERSION,
    receipts: Array.isArray(parsed.receipts)
      ? parsed.receipts.map(readReceipt).filter((receipt): receipt is RoutineScheduleReceipt => receipt !== null)
      : [],
  };
}

function formatReceiptStore(store: RoutineScheduleReceiptStoreFile): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

function receiptId(createdAt: string, routineId: string, existing: readonly RoutineScheduleReceipt[]): string {
  const dayStamp = createdAt.slice(0, 10).replace(/-/g, '');
  const base = `routine-schedule-${routineId}-${dayStamp}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const ids = new Set(existing.map((receipt) => receipt.id));
  if (!ids.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `${base}-${existing.length + 1}`;
}

function scheduleValue(payload: ScheduleCreateInput): string {
  if (payload.kind === 'cron') return String(payload.cron ?? '');
  if (payload.kind === 'every') return String(payload.every ?? '');
  return String(payload.at ?? '');
}

function scheduleKind(payload: ScheduleCreateInput): RoutineScheduleKind {
  if (payload.kind === 'cron' || payload.kind === 'every' || payload.kind === 'at') return payload.kind;
  throw new Error('Routine schedule payload is missing a schedule kind.');
}

function targetSummary(payload: ScheduleCreateInput): RoutineScheduleReceipt['target'] {
  return isRecord(payload.target)
    ? {
      kind: typeof payload.target.kind === 'string' ? payload.target.kind : undefined,
      surfaceKind: typeof payload.target.surfaceKind === 'string' ? payload.target.surfaceKind : undefined,
      preserveThread: typeof payload.target.preserveThread === 'boolean' ? payload.target.preserveThread : undefined,
      createIfMissing: typeof payload.target.createIfMissing === 'boolean' ? payload.target.createIfMissing : undefined,
    }
    : {};
}

function deliveryMode(payload: ScheduleCreateInput): string | undefined {
  return isRecord(payload.delivery) && typeof payload.delivery.mode === 'string' ? payload.delivery.mode : undefined;
}

function resultScheduleRecord(result: RoutineSchedulePromotionResult): Record<string, unknown> {
  return result.ok && isRecord(result.schedule) ? result.schedule : {};
}

function buildReceipt(
  existing: readonly RoutineScheduleReceipt[],
  connection: AgentDaemonConnection,
  preview: RoutineSchedulePromotionPreview,
  result: RoutineSchedulePromotionResult,
): RoutineScheduleReceipt {
  const createdAt = nowIso();
  const kind = scheduleKind(preview.payload);
  const schedule = resultScheduleRecord(result);
  const scheduleId = readString(schedule, 'id') ?? undefined;
  const scheduleStatus = readString(schedule, 'status') ?? (schedule.enabled === false ? 'paused' : schedule.enabled === true ? 'enabled' : undefined);
  return {
    id: receiptId(createdAt, preview.routineId, existing),
    createdAt,
    routineId: preview.routineId,
    routineName: preview.routineName,
    route: ROUTINE_SCHEDULE_ROUTE,
    method: ROUTINE_SCHEDULE_METHOD,
    status: result.ok ? 'created' : 'failed',
    daemonBaseUrl: connection.baseUrl,
    scheduleId,
    scheduleStatus,
    scheduleName: String(preview.payload.name ?? `Agent routine: ${preview.routineName}`),
    scheduleKind: kind,
    scheduleValue: scheduleValue(preview.payload),
    timezone: kind === 'cron' ? preview.payload.timezone : undefined,
    provider: preview.payload.provider,
    model: preview.payload.model,
    enabled: preview.payload.enabled !== false,
    target: targetSummary(preview.payload),
    deliveryMode: deliveryMode(preview.payload),
    failureKind: result.ok ? undefined : result.kind,
    failureError: result.ok ? undefined : result.error,
  };
}

export function routineScheduleReceiptStorePath(shellPaths: ShellPathService): string {
  return shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'routines', 'schedule-receipts.json');
}

export class RoutineScheduleReceiptStore {
  public constructor(private readonly storePath: string) {}

  public static fromShellPaths(shellPaths: ShellPathService): RoutineScheduleReceiptStore {
    return new RoutineScheduleReceiptStore(routineScheduleReceiptStorePath(shellPaths));
  }

  public snapshot(): RoutineScheduleReceiptSnapshot {
    const store = this.readStore();
    return {
      path: this.storePath,
      receipts: [...store.receipts].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    };
  }

  public get(id: string): RoutineScheduleReceipt | null {
    const normalized = id.trim().toLowerCase();
    if (!normalized) return null;
    return this.snapshot().receipts.find((receipt) => receipt.id.toLowerCase() === normalized) ?? null;
  }

  public append(connection: AgentDaemonConnection, preview: RoutineSchedulePromotionPreview, result: RoutineSchedulePromotionResult): RoutineScheduleReceipt {
    const store = this.readStore();
    const receipt = buildReceipt(store.receipts, connection, preview, result);
    this.writeStore({ ...store, receipts: [...store.receipts, receipt] });
    return receipt;
  }

  private readStore(): RoutineScheduleReceiptStoreFile {
    if (!existsSync(this.storePath)) return { version: RECEIPT_STORE_VERSION, receipts: [] };
    try {
      return parseReceiptStore(readFileSync(this.storePath, 'utf-8'));
    } catch (error) {
      throw new Error(`Could not read Agent routine schedule receipt store: ${summarizeError(error)}`);
    }
  }

  private writeStore(store: RoutineScheduleReceiptStoreFile): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    const tmpPath = `${this.storePath}.tmp`;
    writeFileSync(tmpPath, formatReceiptStore(store), 'utf-8');
    renameSync(tmpPath, this.storePath);
  }
}

export function parseRoutineSchedulePromotionArgs(args: readonly string[]): ParsedRoutineSchedulePromotionArgs {
  let routineId: string | null = null;
  let schedule: RoutineScheduleSpec | null = null;
  let name: string | undefined;
  let timezone: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let enabled = true;
  let yes = false;
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
    if (raw === '--disabled') {
      enabled = false;
      continue;
    }
    if (optionName === '--name' || optionName === '--timezone' || optionName === '--provider' || optionName === '--model') {
      const consumed = optionValue(args, index, inlineValue);
      index = consumed.nextIndex;
      const value = consumed.value?.trim();
      if (!value) {
        errors.push(`${optionName} requires a value.`);
        continue;
      }
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
    if (raw.startsWith('--')) {
      errors.push(`Unknown option: ${raw}`);
      continue;
    }
    if (!routineId) {
      routineId = raw;
      continue;
    }
    errors.push(`Unexpected argument: ${raw}`);
  }

  if (!routineId) errors.push('Routine id or name is required.');
  if (!schedule) errors.push('Schedule is required: use --cron <expr>, --every <interval>, or --at <iso-time>.');
  return { routineId, schedule, name, timezone, provider, model, enabled, yes, errors };
}

export function resolveAgentDaemonConnection(
  configManager: AgentDaemonConfigReader,
  homeDirectory: string,
): AgentDaemonConnection {
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
    '- Use isolated Agent Knowledge routes only; never use default Knowledge/Wiki or HomeGraph as fallback.',
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
      mode: 'none',
      targets: [],
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

async function fetchDaemonStatus(connection: AgentDaemonConnection): Promise<{
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
  connection: AgentDaemonConnection,
): Promise<RoutineSchedulePromotionFailure> {
  const message = summarizeError(error);
  const lower = message.toLowerCase();
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('auth')) {
    return { ok: false, kind: 'auth_required', error: message, route: ROUTINE_SCHEDULE_ROUTE, baseUrl: connection.baseUrl };
  }
  if (lower.includes('404') || lower.includes('not found')) {
    const daemon = await fetchDaemonStatus(connection);
    const record = isRecord(daemon.body) ? daemon.body : {};
    const daemonVersion = readString(record, 'version') ?? 'unknown';
    if (daemon.ok && daemonVersion !== SDK_VERSION) {
      return {
        ok: false,
        kind: 'version_mismatch',
        error: `External daemon SDK version ${daemonVersion} does not match Agent SDK pin ${SDK_VERSION}; schedules.create is unavailable.`,
        route: ROUTINE_SCHEDULE_ROUTE,
        baseUrl: connection.baseUrl,
        daemonVersion,
        expectedSdkVersion: SDK_VERSION,
      };
    }
    return { ok: false, kind: 'daemon_route_unavailable', error: message, route: ROUTINE_SCHEDULE_ROUTE, baseUrl: connection.baseUrl };
  }
  if (lower.includes('fetch') || lower.includes('connect') || lower.includes('econnrefused')) {
    return { ok: false, kind: 'daemon_unavailable', error: message, route: ROUTINE_SCHEDULE_ROUTE, baseUrl: connection.baseUrl };
  }
  return { ok: false, kind: 'daemon_error', error: message, route: ROUTINE_SCHEDULE_ROUTE, baseUrl: connection.baseUrl };
}

export async function promoteRoutineToDaemonSchedule(
  connection: AgentDaemonConnection,
  preview: RoutineSchedulePromotionPreview,
): Promise<RoutineSchedulePromotionResult> {
  if (!connection.token) {
    return {
      ok: false,
      kind: 'auth_required',
      error: `No daemon operator token found at ${connection.tokenPath}`,
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

export function formatRoutineSchedulePreview(preview: RoutineSchedulePromotionPreview): string {
  const schedule = preview.payload.kind === 'cron'
    ? `${preview.payload.cron}${preview.payload.timezone ? ` [${preview.payload.timezone}]` : ''}`
    : preview.payload.kind === 'every'
      ? String(preview.payload.every)
      : String(preview.payload.at);
  return [
    'Daemon schedule preview for Agent routine',
    `  routine: ${preview.routineName} (${preview.routineId})`,
    `  route: ${preview.method} ${preview.route}`,
    `  name: ${String(preview.payload.name ?? '(daemon default)')}`,
    `  schedule: ${preview.payload.kind} ${schedule}`,
    `  enabled: ${preview.payload.enabled === false ? 'no' : 'yes'}`,
    '  target: external daemon service/main conversation route',
    '  policy: isolated Agent Knowledge only; no default wiki/HomeGraph fallback; no WRFC unless explicitly delegated',
    '  next: rerun with --yes to create this daemon schedule',
  ].join('\n');
}

export function formatRoutineScheduleSuccess(result: RoutineSchedulePromotionSuccess): string {
  const record: Record<string, unknown> = isRecord(result.schedule) ? result.schedule : {};
  const id = readString(record, 'id') ?? '(unknown)';
  const status = readString(record, 'status') ?? (record.enabled === false ? 'paused' : 'enabled');
  return [
    'Created daemon schedule for Agent routine',
    `  routine: ${result.routineName} (${result.routineId})`,
    `  schedule: ${id}`,
    `  status: ${status}`,
    `  route: ${result.kind} ${result.route}`,
    '  next: inspect with /schedule list or daemon schedule observability',
  ].join('\n');
}

export function formatRoutineScheduleReceipts(snapshot: RoutineScheduleReceiptSnapshot, limit = 10): string {
  const receipts = snapshot.receipts.slice(0, Math.max(1, limit));
  if (snapshot.receipts.length === 0) {
    return [
      'Agent routine schedule receipts',
      `  store: ${snapshot.path}`,
      '  No routine schedule promotions have been recorded yet.',
      '  Create one with /schedule promote-routine <routine-id> --cron <expr> --yes.',
    ].join('\n');
  }
  return [
    `Agent routine schedule receipts (${snapshot.receipts.length})`,
    `  store: ${snapshot.path}`,
    ...receipts.map((receipt) => {
      const schedule = receipt.scheduleId ? ` schedule=${receipt.scheduleId}` : '';
      const failure = receipt.status === 'failed' && receipt.failureKind ? ` failure=${receipt.failureKind}` : '';
      return `  ${receipt.id}  ${receipt.status}  ${receipt.scheduleKind} ${receipt.scheduleValue}  routine=${receipt.routineId}${schedule}${failure}`;
    }),
    snapshot.receipts.length > receipts.length ? `  ...${snapshot.receipts.length - receipts.length} more` : '',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function formatRoutineScheduleReceipt(receipt: RoutineScheduleReceipt): string {
  return [
    `Agent routine schedule receipt ${receipt.id}`,
    `  created: ${receipt.createdAt}`,
    `  status: ${receipt.status}`,
    `  routine: ${receipt.routineName} (${receipt.routineId})`,
    `  route: ${receipt.method} ${receipt.route}`,
    `  daemon: ${receipt.daemonBaseUrl}`,
    `  schedule: ${receipt.scheduleName}${receipt.scheduleId ? ` (${receipt.scheduleId})` : ''}`,
    receipt.scheduleStatus ? `  schedule status: ${receipt.scheduleStatus}` : '',
    `  cadence: ${receipt.scheduleKind} ${receipt.scheduleValue}${receipt.timezone ? ` [${receipt.timezone}]` : ''}`,
    `  enabled: ${receipt.enabled ? 'yes' : 'no'}`,
    receipt.provider ? `  provider: ${receipt.provider}` : '',
    receipt.model ? `  model: ${receipt.model}` : '',
    `  target: ${receipt.target.kind ?? 'unknown'}${receipt.target.surfaceKind ? `/${receipt.target.surfaceKind}` : ''}`,
    receipt.deliveryMode ? `  delivery: ${receipt.deliveryMode}` : '',
    receipt.failureKind ? `  failure: ${receipt.failureKind}` : '',
    receipt.failureError ? `  error: ${receipt.failureError}` : '',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function formatRoutineScheduleFailure(failure: RoutineSchedulePromotionFailure): string {
  return [
    `Daemon schedule error: ${failure.kind}`,
    `  ${failure.error}`,
    failure.baseUrl ? `  daemon: ${failure.baseUrl}` : null,
    `  route: ${ROUTINE_SCHEDULE_METHOD} ${failure.route}`,
    failure.kind === 'version_mismatch' && failure.daemonVersion && failure.expectedSdkVersion
      ? `  versions: daemon=${failure.daemonVersion} expected=${failure.expectedSdkVersion}`
      : null,
    failure.kind === 'auth_required'
      ? '  next: pair/authenticate with the externally managed GoodVibes daemon, then retry with --yes.'
      : null,
    failure.kind === 'daemon_unavailable'
      ? '  next: start/restart the external GoodVibes daemon from TUI or daemon host tooling; Agent does not own daemon lifecycle.'
      : null,
    failure.kind === 'version_mismatch' || failure.kind === 'daemon_route_unavailable'
      ? '  next: update/restart the external GoodVibes daemon so public schedules.create is available.'
      : null,
  ].filter((line): line is string => Boolean(line)).join('\n');
}
