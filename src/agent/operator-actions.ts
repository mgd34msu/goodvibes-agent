import type { OperatorMethodInput } from '@pellux/goodvibes-sdk/contracts';
import { scheduleNextRouteLines } from './schedule-next-routes.ts';

export type JsonRecord = Record<string, unknown>;

export type ApprovalActionId = 'approvals.approve' | 'approvals.deny' | 'approvals.cancel';
export type AutomationActionId =
  | 'automation.jobs.run'
  | 'automation.jobs.pause'
  | 'automation.jobs.resume'
  | 'automation.runs.cancel'
  | 'automation.runs.retry'
  | 'schedules.delete'
  | 'schedules.disable'
  | 'schedules.enable'
  | 'schedules.run';
export type OperatorActionId = ApprovalActionId | AutomationActionId;
export type OperatorActionHttpMethod = 'POST' | 'DELETE';

type ApprovalActionInput =
  | OperatorMethodInput<'approvals.approve'>
  | OperatorMethodInput<'approvals.deny'>
  | OperatorMethodInput<'approvals.cancel'>;

export interface OperatorActionArgs {
  readonly action?: unknown;
  readonly targetId?: unknown;
  readonly approvalId?: unknown;
  readonly jobId?: unknown;
  readonly runId?: unknown;
  readonly scheduleId?: unknown;
  readonly note?: unknown;
  readonly remember?: unknown;
}

export interface OperatorActionDescriptor {
  readonly action: OperatorActionId;
  readonly label: string;
  readonly pathTemplate: string;
  readonly targetField: 'approvalId' | 'jobId' | 'runId' | 'scheduleId';
  readonly httpMethod?: OperatorActionHttpMethod;
}

export interface OperatorActionRequest {
  readonly ok: true;
  readonly descriptor: OperatorActionDescriptor;
  readonly targetId: string;
  readonly body: JsonRecord | null;
}

export interface OperatorActionSuccess {
  readonly ok: true;
  readonly methodId: OperatorActionId;
  readonly httpMethod: OperatorActionHttpMethod;
  readonly path: string;
  readonly body: unknown;
}

export interface OperatorActionFailure {
  readonly ok: false;
  readonly kind:
    | 'auth_required'
    | 'connected_host_unavailable'
    | 'connected_host_route_unavailable'
    | 'connected_host_error';
  readonly error: string;
  readonly methodId: OperatorActionId;
  readonly httpMethod: OperatorActionHttpMethod;
  readonly path: string;
}

export type OperatorActionResult = OperatorActionSuccess | OperatorActionFailure;
export type OperatorActionParseResult = OperatorActionRequest | { readonly ok: false; readonly error: string };

export interface OperatorActionConnection {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly tokenPath?: string;
}

export const OPERATOR_ACTIONS: Record<OperatorActionId, OperatorActionDescriptor> = {
  'approvals.approve': {
    action: 'approvals.approve',
    label: 'approve approval',
    pathTemplate: '/api/approvals/{approvalId}/approve',
    targetField: 'approvalId',
  },
  'approvals.deny': {
    action: 'approvals.deny',
    label: 'deny approval',
    pathTemplate: '/api/approvals/{approvalId}/deny',
    targetField: 'approvalId',
  },
  'approvals.cancel': {
    action: 'approvals.cancel',
    label: 'cancel approval',
    pathTemplate: '/api/approvals/{approvalId}/cancel',
    targetField: 'approvalId',
  },
  'automation.jobs.run': {
    action: 'automation.jobs.run',
    label: 'run automation job',
    pathTemplate: '/api/automation/jobs/{jobId}/run',
    targetField: 'jobId',
  },
  'automation.jobs.pause': {
    action: 'automation.jobs.pause',
    label: 'pause automation job',
    pathTemplate: '/api/automation/jobs/{jobId}/pause',
    targetField: 'jobId',
  },
  'automation.jobs.resume': {
    action: 'automation.jobs.resume',
    label: 'resume automation job',
    pathTemplate: '/api/automation/jobs/{jobId}/resume',
    targetField: 'jobId',
  },
  'automation.runs.cancel': {
    action: 'automation.runs.cancel',
    label: 'cancel automation run',
    pathTemplate: '/api/automation/runs/{runId}/cancel',
    targetField: 'runId',
  },
  'automation.runs.retry': {
    action: 'automation.runs.retry',
    label: 'retry automation run',
    pathTemplate: '/api/automation/runs/{runId}/retry',
    targetField: 'runId',
  },
  'schedules.run': {
    action: 'schedules.run',
    label: 'run schedule',
    pathTemplate: '/api/automation/schedules/{scheduleId}/run',
    targetField: 'scheduleId',
  },
  'schedules.enable': {
    action: 'schedules.enable',
    label: 'enable schedule',
    pathTemplate: '/api/automation/schedules/{scheduleId}/enable',
    targetField: 'scheduleId',
  },
  'schedules.disable': {
    action: 'schedules.disable',
    label: 'disable schedule',
    pathTemplate: '/api/automation/schedules/{scheduleId}/disable',
    targetField: 'scheduleId',
  },
  'schedules.delete': {
    action: 'schedules.delete',
    label: 'delete schedule',
    pathTemplate: '/api/automation/schedules/{scheduleId}',
    targetField: 'scheduleId',
    httpMethod: 'DELETE',
  },
};

export const OPERATOR_ACTION_IDS = Object.keys(OPERATOR_ACTIONS) as readonly OperatorActionId[];

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readOperatorActionString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readOperatorActionBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes';
}

export function isOperatorActionId(value: unknown): value is OperatorActionId {
  return typeof value === 'string' && value in OPERATOR_ACTIONS;
}

export function targetValue(args: OperatorActionArgs, descriptor: OperatorActionDescriptor): string {
  const specific = args[descriptor.targetField];
  return readOperatorActionString(specific) || readOperatorActionString(args.targetId);
}

export function renderOperatorActionPath(descriptor: OperatorActionDescriptor, targetId: string): string {
  return descriptor.pathTemplate.replace(`{${descriptor.targetField}}`, encodeURIComponent(targetId));
}

export function operatorActionHttpMethod(descriptor: OperatorActionDescriptor): OperatorActionHttpMethod {
  return descriptor.httpMethod ?? 'POST';
}

function approvalBody(args: OperatorActionArgs): ApprovalActionInput {
  const note = readOperatorActionString(args.note);
  const body: ApprovalActionInput = {
    approvalId: targetValue(args, OPERATOR_ACTIONS['approvals.approve']),
  };
  if (note) body.note = note;
  if (args.remember !== undefined) body.remember = readOperatorActionBoolean(args.remember);
  return body;
}

function requestBody(args: OperatorActionArgs, action: OperatorActionId): JsonRecord | null {
  if (action !== 'approvals.approve' && action !== 'approvals.deny' && action !== 'approvals.cancel') return null;
  const body = approvalBody(args);
  const out: JsonRecord = {};
  if (body.note) out.note = body.note;
  if (body.remember !== undefined) out.remember = body.remember;
  return Object.keys(out).length > 0 ? out : null;
}

export function buildOperatorActionRequest(rawArgs: unknown): OperatorActionParseResult {
  if (!isRecord(rawArgs)) return { ok: false, error: 'Operator action arguments must be an object.' };
  const args = rawArgs as OperatorActionArgs;
  if (!isOperatorActionId(args.action)) {
    return {
      ok: false,
      error: `action must be one of: ${OPERATOR_ACTION_IDS.join(', ')}`,
    };
  }
  const descriptor = OPERATOR_ACTIONS[args.action];
  const targetId = targetValue(args, descriptor);
  if (!targetId) {
    return {
      ok: false,
      error: `${descriptor.targetField} or targetId is required for ${descriptor.action}.`,
    };
  }
  return {
    ok: true,
    descriptor,
    targetId,
    body: requestBody(args, descriptor.action),
  };
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

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyHttpFailure(
  methodId: OperatorActionId,
  httpMethod: OperatorActionHttpMethod,
  path: string,
  status: number,
  body: unknown,
): OperatorActionFailure {
  const detail = isRecord(body) && typeof body.error === 'string' ? body.error : '';
  return {
    ok: false,
    methodId,
    httpMethod,
    path,
    kind: status === 401 || status === 403
      ? 'auth_required'
      : status === 404
        ? 'connected_host_route_unavailable'
        : 'connected_host_error',
    error: `HTTP ${status}${detail ? `: ${detail}` : ''}`,
  };
}

export async function postOperatorAction(
  connection: OperatorActionConnection,
  request: OperatorActionRequest,
): Promise<OperatorActionResult> {
  const path = renderOperatorActionPath(request.descriptor, request.targetId);
  const httpMethod = operatorActionHttpMethod(request.descriptor);
  const token = connection.token;
  if (!token) {
    return {
      ok: false,
      methodId: request.descriptor.action,
      httpMethod,
      path,
      kind: 'auth_required',
      error: connection.tokenPath ? `no connected-host operator token found at ${connection.tokenPath}` : 'no connected-host operator token found',
    };
  }
  const headers: HeadersInit = {
    authorization: `Bearer ${token}`,
  };
  const init: RequestInit = {
    method: httpMethod,
    headers,
  };
  if (request.body) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(request.body);
  }
  try {
    const response = await fetch(`${connection.baseUrl}${path}`, init);
    const body = await readResponseBody(response);
    if (!response.ok) return classifyHttpFailure(request.descriptor.action, httpMethod, path, response.status, body);
    return {
      ok: true,
      methodId: request.descriptor.action,
      httpMethod,
      path,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      methodId: request.descriptor.action,
      httpMethod,
      path,
      kind: 'connected_host_unavailable',
      error: summarizeError(error),
    };
  }
}

export function statusFromOperatorActionBody(body: unknown): string {
  if (!isRecord(body)) return 'ok';
  const approval = body.approval;
  if (isRecord(approval) && typeof approval.status === 'string') return approval.status;
  const run = body.run;
  if (isRecord(run) && typeof run.status === 'string') return run.status;
  if (typeof body.status === 'string') return body.status;
  if (typeof body.enabled === 'boolean') return body.enabled ? 'enabled' : 'disabled';
  return 'ok';
}

function formatOperatorActionFailureKind(kind: OperatorActionFailure['kind']): string {
  if (kind === 'auth_required') return 'authorization required';
  if (kind === 'connected_host_unavailable') return 'connected host unavailable';
  if (kind === 'connected_host_route_unavailable') return 'connected host route unavailable';
  return 'connected host error';
}

function scheduleIdFromActionPath(path: string): string {
  const match = /\/api\/automation\/schedules\/([^/]+)/.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export function formatOperatorActionSuccess(baseUrl: string, result: OperatorActionSuccess): string {
  const scheduleId = result.methodId.startsWith('schedules.') ? scheduleIdFromActionPath(result.path) : '';
  return [
    'Agent operator action completed',
    `  method: ${result.methodId}`,
    `  route: ${result.httpMethod} ${result.path}`,
    `  connected host: ${baseUrl}`,
    `  status: ${statusFromOperatorActionBody(result.body)}`,
    ...(scheduleId ? scheduleNextRouteLines(scheduleId, { deleted: result.methodId === 'schedules.delete' }) : []),
  ].join('\n');
}

export function formatOperatorActionFailure(result: OperatorActionFailure): string {
  return [
    `Agent operator action failed: ${result.kind} (${formatOperatorActionFailureKind(result.kind)})`,
    `  method: ${result.methodId}`,
    `  route: ${result.httpMethod} ${result.path}`,
    `  error: ${result.error}`,
  ].join('\n');
}

export function formatOperatorActionPreview(request: OperatorActionRequest, explicitUserRequest: string): string {
  return [
    'Agent operator action preview',
    `  method ${request.descriptor.action}`,
    `  action ${request.descriptor.label}`,
    `  target ${request.targetId}`,
    `  route ${operatorActionHttpMethod(request.descriptor)} ${renderOperatorActionPath(request.descriptor, request.targetId)}`,
    explicitUserRequest ? `  requested by ${explicitUserRequest}` : '  requested by (missing)',
    '',
    'Confirmation required: type yes in the workspace form or pass --yes only when the user explicitly asked GoodVibes Agent to perform this exact operator action.',
  ].join('\n');
}

export function formatOperatorActionToolPreview(request: OperatorActionRequest, explicitUserRequest: string): string {
  return [
    'Agent operator action preview',
    `  method ${request.descriptor.action}`,
    `  action ${request.descriptor.label}`,
    `  target ${request.targetId}`,
    `  route ${operatorActionHttpMethod(request.descriptor)} ${renderOperatorActionPath(request.descriptor, request.targetId)}`,
    explicitUserRequest ? `  requested by ${explicitUserRequest}` : '  requested by (missing)',
    '',
    'Model tool confirmation required. Call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to perform this exact operator action.',
  ].join('\n');
}
