import type { AgentConfig } from '../config.js';
import type { RouteId } from '../daemon/routes.js';
import type { DelegationReceipt } from '../store/delegations.js';
import { isRecord } from '../types.js';
import { createId } from '../utils/ids.js';
import { explicitlyRequestsWrfc, isBuildLikeRequest, wrfcEligible } from './policy.js';
import { titleFromText } from '../utils/format.js';

export interface DelegationRequest {
  readonly task: string;
  readonly wrfc?: boolean | undefined;
  readonly sessionId?: string | undefined;
  readonly title?: string | undefined;
  readonly reason?: string | undefined;
}

export interface DelegationResult {
  readonly delegated: boolean;
  readonly mode: string;
  readonly receipt: DelegationReceipt;
  readonly sessionId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly messageId?: string | undefined;
  readonly output: unknown;
}

export interface DelegationDaemonClient {
  createSharedSession(input: {
    readonly title: string;
    readonly surfaceKind: string;
    readonly surfaceId: string;
  }): Promise<{ readonly sessionId: string; readonly session: unknown }>;

  invoke<T = unknown>(
    routeId: RouteId,
    input: Record<string, unknown>,
  ): Promise<T>;
}

export function shouldDelegateToTui(text: string): boolean {
  return isBuildLikeRequest(text);
}

export function shouldRequestWrfc(text: string, explicitFlag = false): boolean {
  return explicitFlag || (wrfcEligible(text) && explicitlyRequestsWrfc(text));
}

export async function delegateToTui(
  client: DelegationDaemonClient,
  config: AgentConfig,
  request: DelegationRequest,
): Promise<DelegationResult> {
  const wrfc = shouldRequestWrfc(request.task, request.wrfc === true);
  const session = request.sessionId
    ? { sessionId: request.sessionId, session: null }
    : await client.createSharedSession({
      title: request.title ?? titleFromText(request.task),
      surfaceKind: config.surfaceKind,
      surfaceId: config.surfaceId,
    });
  const body = [
    request.task,
    '',
    'GoodVibes Agent delegation metadata:',
    `- originSurface: ${config.surfaceId}`,
    `- originSurfaceKind: ${config.surfaceKind}`,
    `- requestedExecution: ${wrfc ? 'wrfc' : 'serial-tui'}`,
    `- wrfcRequested: ${wrfc}`,
    '- productBoundary: coding/build execution is owned by GoodVibes TUI',
    '- Note for TUI: use WRFC only when requestedExecution is wrfc; otherwise run serial TUI implementation.',
  ].join('\n');

  const input = {
    sessionId: session.sessionId,
    surfaceKind: config.surfaceKind,
    surfaceId: config.surfaceId,
    kind: 'task',
    body,
    routing: {
      executionIntent: {
        riskClass: 'elevated',
        requiresApproval: false,
        networkPolicy: 'inherit',
        filesystemPolicy: 'workspace-write',
      },
      reasoningEffort: wrfc ? 'high' : 'medium',
    },
  };

  const output = await client.invoke<Record<string, unknown>>('sessions.messages.create', input);
  const mode = typeof output.mode === 'string' ? output.mode : 'unknown';
  const sessionId = outputString(output, 'sessionId') ?? nestedOutputString(output, ['session', 'id']) ?? session.sessionId;
  const agentId = outputString(output, 'agentId') ?? nestedOutputString(output, ['task', 'agentId']);
  const taskId = outputString(output, 'taskId') ?? nestedOutputString(output, ['task', 'id']);
  const messageId = outputString(output, 'messageId') ?? nestedOutputString(output, ['message', 'id']);
  const receiptId = createId('del');
  const receipt: DelegationReceipt = {
    id: receiptId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    task: request.task,
    summary: titleFromText(request.task),
    requestedWrfc: wrfc,
    mode,
    sessionId,
    surfaceKind: config.surfaceKind,
    surfaceId: config.surfaceId,
    checkCommand: `goodvibes-agent delegations status ${receiptId}`,
    reason: request.reason,
    agentId,
    taskId,
    messageId,
  };
  return {
    delegated: true,
    mode,
    receipt,
    sessionId,
    agentId,
    taskId,
    messageId,
    output,
  };
}

function outputString(output: Record<string, unknown>, key: string): string | undefined {
  const value = output[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function nestedOutputString(output: Record<string, unknown>, path: readonly string[]): string | undefined {
  let current: unknown = output;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === 'string' && current.trim().length > 0 ? current.trim() : undefined;
}
