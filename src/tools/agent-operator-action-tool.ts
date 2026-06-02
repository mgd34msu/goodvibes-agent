import type { OperatorMethodInput } from '@pellux/goodvibes-sdk/contracts';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { ShellPathService } from '@/runtime/index.ts';
import type { AgentDaemonConfigReader } from '../agent/routine-schedule-promotion.ts';
import { resolveAgentDaemonConnection } from '../agent/routine-schedule-promotion.ts';

type JsonRecord = Record<string, unknown>;

type ApprovalActionId = 'approvals.approve' | 'approvals.deny' | 'approvals.cancel';
type AutomationActionId =
  | 'automation.jobs.run'
  | 'automation.jobs.pause'
  | 'automation.jobs.resume'
  | 'automation.runs.cancel'
  | 'automation.runs.retry'
  | 'schedules.run';
type OperatorActionId = ApprovalActionId | AutomationActionId;

type ApprovalActionInput =
  | OperatorMethodInput<'approvals.approve'>
  | OperatorMethodInput<'approvals.deny'>
  | OperatorMethodInput<'approvals.cancel'>;

interface OperatorActionToolArgs {
  readonly action?: unknown;
  readonly targetId?: unknown;
  readonly approvalId?: unknown;
  readonly jobId?: unknown;
  readonly runId?: unknown;
  readonly scheduleId?: unknown;
  readonly note?: unknown;
  readonly remember?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

interface OperatorActionDescriptor {
  readonly action: OperatorActionId;
  readonly label: string;
  readonly pathTemplate: string;
  readonly targetField: 'approvalId' | 'jobId' | 'runId' | 'scheduleId';
}

interface OperatorActionRequest {
  readonly ok: true;
  readonly descriptor: OperatorActionDescriptor;
  readonly targetId: string;
  readonly body: JsonRecord | null;
}

interface OperatorActionSuccess {
  readonly ok: true;
  readonly methodId: OperatorActionId;
  readonly path: string;
  readonly body: unknown;
}

interface OperatorActionFailure {
  readonly ok: false;
  readonly kind:
    | 'auth_required'
    | 'daemon_unavailable'
    | 'daemon_route_unavailable'
    | 'daemon_error';
  readonly error: string;
  readonly methodId: OperatorActionId;
  readonly path: string;
}

type OperatorActionResult = OperatorActionSuccess | OperatorActionFailure;
type OperatorActionParseResult = OperatorActionRequest | { readonly ok: false; readonly error: string };

const OPERATOR_ACTIONS: Record<OperatorActionId, OperatorActionDescriptor> = {
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
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes';
}

function isOperatorActionId(value: unknown): value is OperatorActionId {
  return typeof value === 'string' && value in OPERATOR_ACTIONS;
}

function targetValue(args: OperatorActionToolArgs, descriptor: OperatorActionDescriptor): string {
  const specific = args[descriptor.targetField];
  return readString(specific) || readString(args.targetId);
}

function renderPath(descriptor: OperatorActionDescriptor, targetId: string): string {
  return descriptor.pathTemplate.replace(`{${descriptor.targetField}}`, encodeURIComponent(targetId));
}

function approvalBody(args: OperatorActionToolArgs): ApprovalActionInput {
  const note = readString(args.note);
  const body: ApprovalActionInput = {
    approvalId: targetValue(args, OPERATOR_ACTIONS['approvals.approve']),
  };
  if (note) body.note = note;
  if (args.remember !== undefined) body.remember = readBoolean(args.remember);
  return body;
}

function requestBody(args: OperatorActionToolArgs, action: OperatorActionId): JsonRecord | null {
  if (action !== 'approvals.approve' && action !== 'approvals.deny' && action !== 'approvals.cancel') return null;
  const body = approvalBody(args);
  const out: JsonRecord = {};
  if (body.note) out.note = body.note;
  if (body.remember !== undefined) out.remember = body.remember;
  return Object.keys(out).length > 0 ? out : null;
}

function buildRequest(rawArgs: unknown): OperatorActionParseResult {
  if (!isRecord(rawArgs)) return { ok: false, error: 'Tool arguments must be an object.' };
  const args = rawArgs as OperatorActionToolArgs;
  if (!isOperatorActionId(args.action)) {
    return {
      ok: false,
      error: `action must be one of: ${Object.keys(OPERATOR_ACTIONS).join(', ')}`,
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
  path: string,
  status: number,
  body: unknown,
): OperatorActionFailure {
  const detail = isRecord(body) && typeof body.error === 'string' ? body.error : '';
  return {
    ok: false,
    methodId,
    path,
    kind: status === 401 || status === 403
      ? 'auth_required'
      : status === 404
        ? 'daemon_route_unavailable'
        : 'daemon_error',
    error: `HTTP ${status}${detail ? `: ${detail}` : ''}`,
  };
}

async function postOperatorAction(
  baseUrl: string,
  token: string,
  request: OperatorActionRequest,
): Promise<OperatorActionResult> {
  const path = renderPath(request.descriptor, request.targetId);
  const headers: HeadersInit = {
    authorization: `Bearer ${token}`,
  };
  const init: RequestInit = {
    method: 'POST',
    headers,
  };
  if (request.body) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(request.body);
  }
  try {
    const response = await fetch(`${baseUrl}${path}`, init);
    const body = await readResponseBody(response);
    if (!response.ok) return classifyHttpFailure(request.descriptor.action, path, response.status, body);
    return {
      ok: true,
      methodId: request.descriptor.action,
      path,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      methodId: request.descriptor.action,
      path,
      kind: 'daemon_unavailable',
      error: summarizeError(error),
    };
  }
}

function statusFromBody(body: unknown): string {
  if (!isRecord(body)) return 'ok';
  const approval = body.approval;
  if (isRecord(approval) && typeof approval.status === 'string') return approval.status;
  const run = body.run;
  if (isRecord(run) && typeof run.status === 'string') return run.status;
  if (typeof body.status === 'string') return body.status;
  if (typeof body.enabled === 'boolean') return body.enabled ? 'enabled' : 'disabled';
  return 'ok';
}

function successOutput(baseUrl: string, result: OperatorActionSuccess): string {
  return [
    'Agent operator action completed',
    `  method: ${result.methodId}`,
    `  route: POST ${result.path}`,
    `  connected host: ${baseUrl}`,
    `  status: ${statusFromBody(result.body)}`,
  ].join('\n');
}

function failureError(result: OperatorActionFailure): string {
  return [
    `Agent operator action failed: ${result.kind}`,
    `  method: ${result.methodId}`,
    `  route: POST ${result.path}`,
    `  error: ${result.error}`,
  ].join('\n');
}

function confirmationError(request: OperatorActionRequest, explicitUserRequest: string): string {
  return [
    'Agent operator action preview',
    `  method: ${request.descriptor.action}`,
    `  action: ${request.descriptor.label}`,
    `  target: ${request.targetId}`,
    `  route: POST ${renderPath(request.descriptor, request.targetId)}`,
    explicitUserRequest ? `  requested by: ${explicitUserRequest}` : '  requested by: (missing)',
    '',
    'Model tool confirmation required: call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to perform this exact operator action.',
  ].join('\n');
}

export function createAgentOperatorActionTool(
  shellPaths: ShellPathService,
  configManager: AgentDaemonConfigReader,
): Tool {
  return {
    definition: {
      name: 'agent_operator_action',
      description: [
        'Perform one explicit, confirmed connected-host operator action from the main conversation.',
        'Allowed actions are approvals.approve, approvals.deny, approvals.cancel, automation.jobs.run, automation.jobs.pause, automation.jobs.resume, automation.runs.cancel, automation.runs.retry, and schedules.run.',
        'Use only when the user explicitly asks for that exact approval, automation job, automation run, or schedule action.',
        'This tool never creates, edits, deletes, or discovers automation definitions; never starts a daemon; never uses default Knowledge/Wiki, HomeGraph, local workers, background agents, WRFC, or arbitrary route invocation.',
        'Set confirm:true only for an explicit user request. Otherwise return the preview/confirmation error.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: Object.keys(OPERATOR_ACTIONS),
            description: 'Exact allowlisted public operator method id to execute.',
          },
          targetId: {
            type: 'string',
            description: 'Generic target id. Prefer the specific approvalId, jobId, runId, or scheduleId field when known.',
          },
          approvalId: {
            type: 'string',
            description: 'Approval id for approvals.approve, approvals.deny, or approvals.cancel.',
          },
          jobId: {
            type: 'string',
            description: 'Automation job id for automation.jobs.run, automation.jobs.pause, or automation.jobs.resume.',
          },
          runId: {
            type: 'string',
            description: 'Automation run id for automation.runs.cancel or automation.runs.retry.',
          },
          scheduleId: {
            type: 'string',
            description: 'Schedule id for schedules.run.',
          },
          note: {
            type: 'string',
            description: 'Optional approval note for approval actions.',
          },
          remember: {
            type: 'boolean',
            description: 'Optional approval remember flag for approval actions only.',
          },
          confirm: {
            type: 'boolean',
            description: 'Required true only when the user explicitly asked for this exact operator action.',
          },
          explicitUserRequest: {
            type: 'string',
            description: 'Short quote or summary of the user request that authorized this action.',
          },
        },
        required: ['action', 'confirm', 'explicitUserRequest'],
        additionalProperties: false,
      },
      sideEffects: ['network', 'state'],
    },
    execute: async (rawArgs: unknown) => {
      const request = buildRequest(rawArgs);
      if (!request.ok) {
        return { success: false, error: request.error };
      }
      const args = isRecord(rawArgs) ? rawArgs as OperatorActionToolArgs : {};
      const explicitUserRequest = readString(args.explicitUserRequest);
      if (!explicitUserRequest) {
        return {
          success: false,
          error: confirmationError(request, ''),
        };
      }
      if (!readBoolean(args.confirm)) {
        return {
          success: false,
          error: confirmationError(request, explicitUserRequest),
        };
      }
      const connection = resolveAgentDaemonConnection(configManager, shellPaths.homeDirectory);
      if (!connection.token) {
        return {
          success: false,
          error: `auth_required: no runtime operator token found at ${connection.tokenPath}`,
        };
      }
      const result = await postOperatorAction(connection.baseUrl, connection.token, request);
      if (!result.ok) return { success: false, error: failureError(result) };
      return {
        success: true,
        output: successOutput(connection.baseUrl, result),
      };
    },
  };
}

export function registerAgentOperatorActionTool(
  registry: ToolRegistry,
  shellPaths: ShellPathService,
  configManager: AgentDaemonConfigReader,
): void {
  registry.register(createAgentOperatorActionTool(shellPaths, configManager));
}
