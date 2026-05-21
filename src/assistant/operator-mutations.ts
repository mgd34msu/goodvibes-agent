import type { RouteId } from '../daemon/routes.js';
import { getRoute } from '../daemon/routes.js';
import { firstString, isRecord } from '../types.js';
import { EXPECTED_GOODVIBES_SDK_VERSION } from '../version.js';

export type ApprovalMutationAction = 'approve' | 'deny' | 'cancel';
export type AutomationMutationAction = 'run' | 'pause' | 'resume' | 'cancel' | 'retry';
export type ScheduleMutationAction = 'run';
export type OperatorMutationKind = 'approval' | 'automation' | 'schedule';

type AllowedMutationRouteId = typeof OPERATOR_MUTATION_ROUTE_ALLOWLIST[number];
type MutationTargetField = 'approvalId' | 'jobId' | 'runId' | 'scheduleId';

interface OperatorMutationClient {
  invoke<T = unknown>(routeId: RouteId, input?: Record<string, unknown>): Promise<T>;
}

interface MutationDefinition {
  readonly routeId: AllowedMutationRouteId;
  readonly targetField: MutationTargetField;
  readonly targetKind: string;
  readonly label: string;
}

export interface OperatorMutationRequest {
  readonly kind: OperatorMutationKind;
  readonly action: string;
  readonly targetId: string;
  readonly confirmed: boolean;
  readonly note?: string | undefined;
}

export interface OperatorMutationResult {
  readonly routeId: AllowedMutationRouteId;
  readonly kind: OperatorMutationKind;
  readonly action: string;
  readonly targetKind: string;
  readonly targetId: string;
  readonly confirmed: true;
  readonly data: unknown;
}

export type OperatorMutationErrorKind = 'confirmation_required' | 'validation_error' | 'route_unavailable';

export class OperatorMutationError extends Error {
  constructor(
    readonly kind: OperatorMutationErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'OperatorMutationError';
  }
}

export const OPERATOR_MUTATION_ROUTE_ALLOWLIST = [
  'approvals.approve',
  'approvals.deny',
  'approvals.cancel',
  'automation.jobs.run',
  'automation.jobs.pause',
  'automation.jobs.resume',
  'automation.runs.cancel',
  'automation.runs.retry',
  'schedules.run',
] as const satisfies readonly RouteId[];

const APPROVAL_MUTATIONS = {
  approve: {
    routeId: 'approvals.approve',
    targetField: 'approvalId',
    targetKind: 'approval',
    label: 'approve approval',
  },
  deny: {
    routeId: 'approvals.deny',
    targetField: 'approvalId',
    targetKind: 'approval',
    label: 'deny approval',
  },
  cancel: {
    routeId: 'approvals.cancel',
    targetField: 'approvalId',
    targetKind: 'approval',
    label: 'cancel approval',
  },
} as const satisfies Record<ApprovalMutationAction, MutationDefinition>;

const AUTOMATION_MUTATIONS = {
  run: {
    routeId: 'automation.jobs.run',
    targetField: 'jobId',
    targetKind: 'automation job',
    label: 'run automation job',
  },
  pause: {
    routeId: 'automation.jobs.pause',
    targetField: 'jobId',
    targetKind: 'automation job',
    label: 'pause automation job',
  },
  resume: {
    routeId: 'automation.jobs.resume',
    targetField: 'jobId',
    targetKind: 'automation job',
    label: 'resume automation job',
  },
  cancel: {
    routeId: 'automation.runs.cancel',
    targetField: 'runId',
    targetKind: 'automation run',
    label: 'cancel automation run',
  },
  retry: {
    routeId: 'automation.runs.retry',
    targetField: 'runId',
    targetKind: 'automation run',
    label: 'retry automation run',
  },
} as const satisfies Record<AutomationMutationAction, MutationDefinition>;

const SCHEDULE_MUTATIONS = {
  run: {
    routeId: 'schedules.run',
    targetField: 'scheduleId',
    targetKind: 'schedule',
    label: 'run schedule',
  },
} as const satisfies Record<ScheduleMutationAction, MutationDefinition>;

export async function executeOperatorMutation(
  client: OperatorMutationClient,
  request: OperatorMutationRequest,
): Promise<OperatorMutationResult> {
  const definition = resolveMutationDefinition(request.kind, request.action);
  const targetId = request.targetId.trim();
  if (!targetId) {
    throw new OperatorMutationError('validation_error', `${definition.label} requires a ${definition.targetField}.`);
  }
  if (!request.confirmed) {
    throw new OperatorMutationError(
      'confirmation_required',
      `Confirmation required: re-run this exact ${definition.label} command with --yes to call ${definition.routeId}.`,
    );
  }
  assertMutationRouteAvailable(definition.routeId);
  const input: Record<string, unknown> = { [definition.targetField]: targetId };
  const note = request.note?.trim();
  if (request.kind === 'approval' && note) input.note = note;
  const data = await client.invoke(definition.routeId, input);
  return {
    routeId: definition.routeId,
    kind: request.kind,
    action: request.action,
    targetKind: definition.targetKind,
    targetId,
    confirmed: true,
    data,
  };
}

export function formatOperatorMutationResult(result: OperatorMutationResult): string {
  const lines = [
    `${titleCase(result.kind)} ${result.action} requested.`,
    `Route: ${result.routeId}`,
    `Target: ${result.targetKind} ${result.targetId}`,
  ];
  const summary = summarizeMutationResponse(result.data);
  if (summary.length > 0) lines.push(`Result: ${summary.join(', ')}`);
  return lines.join('\n');
}

export function isApprovalMutationAction(value: string): value is ApprovalMutationAction {
  return value === 'approve' || value === 'deny' || value === 'cancel';
}

export function isAutomationMutationAction(value: string): value is AutomationMutationAction {
  return value === 'run' || value === 'pause' || value === 'resume' || value === 'cancel' || value === 'retry';
}

export function isScheduleMutationAction(value: string): value is ScheduleMutationAction {
  return value === 'run';
}

export function resolveMutationRouteId(kind: OperatorMutationKind, action: string): AllowedMutationRouteId {
  return resolveMutationDefinition(kind, action).routeId;
}

export function isAllowlistedOperatorMutationRoute(routeId: RouteId): routeId is AllowedMutationRouteId {
  return OPERATOR_MUTATION_ROUTE_ALLOWLIST.includes(routeId as AllowedMutationRouteId);
}

function resolveMutationDefinition(kind: OperatorMutationKind, action: string): MutationDefinition {
  if (kind === 'approval' && isApprovalMutationAction(action)) return APPROVAL_MUTATIONS[action];
  if (kind === 'automation' && isAutomationMutationAction(action)) return AUTOMATION_MUTATIONS[action];
  if (kind === 'schedule' && isScheduleMutationAction(action)) return SCHEDULE_MUTATIONS[action];
  throw new OperatorMutationError('validation_error', `Unknown ${kind} mutation action: ${action || '(empty)'}.`);
}

function assertMutationRouteAvailable(routeId: AllowedMutationRouteId): void {
  try {
    getRoute(routeId);
  } catch {
    throw new OperatorMutationError(
      'route_unavailable',
      `${routeId} is not available in the pinned GoodVibes SDK contract ${EXPECTED_GOODVIBES_SDK_VERSION}.`,
    );
  }
}

function summarizeMutationResponse(data: unknown): readonly string[] {
  if (!isRecord(data)) return [];
  const approval = recordValue(data, 'approval');
  const root = approval ?? data;
  return [
    firstString(root, ['id', 'approvalId', 'jobId', 'runId', 'scheduleId']) ? `id ${firstString(root, ['id', 'approvalId', 'jobId', 'runId', 'scheduleId'])}` : '',
    firstString(root, ['status']) ? `status ${firstString(root, ['status'])}` : '',
    firstString(root, ['jobId']) && firstString(root, ['runId']) ? `job ${firstString(root, ['jobId'])}` : '',
    firstString(root, ['runId']) ? `run ${firstString(root, ['runId'])}` : '',
  ].filter((part) => part.length > 0);
}

function recordValue(record: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, unknown>> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
