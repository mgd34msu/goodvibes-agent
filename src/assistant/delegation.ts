import type { AgentConfig } from '../config.js';
import type { RouteId } from '../daemon/routes.js';
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
  readonly sessionId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly taskId?: string | undefined;
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
  return {
    delegated: true,
    mode: typeof output.mode === 'string' ? output.mode : 'unknown',
    sessionId: typeof output.sessionId === 'string'
      ? output.sessionId
      : typeof output.session === 'object' && output.session !== null && 'id' in output.session && typeof output.session.id === 'string'
        ? output.session.id
        : session.sessionId,
    agentId: typeof output.agentId === 'string' ? output.agentId : undefined,
    output,
  };
}
