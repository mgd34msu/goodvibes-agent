/**
 * A generic connected-host operator gateway call helper for CLI subcommands
 * that reach ci.*, principals.*, and channels.profiles.* over the daemon's
 * operator gateway. This mirrors the exact connection resolution and error
 * classification pattern established in routine-schedule-promotion.ts
 * (resolveAgentConnectedHostConnection + classifyScheduleError) so every
 * connected-host CLI command reports failures the same way: auth_required
 * when no token is on disk, connected_host_unavailable when the fetch itself
 * fails, connected_host_route_unavailable / connected_host_incompatible when
 * the method route answers 404, and connected_host_error otherwise.
 */
import { createBrowserGoodVibesSdk } from '@pellux/goodvibes-sdk/browser';
import type { OperatorMethodId } from '@pellux/goodvibes-sdk/contracts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import type { AgentConnectedHostConnection } from './routine-schedule-promotion.ts';

export type OperatorGatewayCallFailureKind =
  | 'auth_required'
  | 'connected_host_unavailable'
  | 'connected_host_incompatible'
  | 'connected_host_route_unavailable'
  | 'connected_host_error';

export interface OperatorGatewayCallSuccess<T> {
  readonly ok: true;
  readonly data: T;
  readonly methodId: OperatorMethodId;
  readonly route: string;
}

export interface OperatorGatewayCallFailure {
  readonly ok: false;
  readonly kind: OperatorGatewayCallFailureKind;
  readonly error: string;
  readonly methodId: OperatorMethodId;
  readonly route: string;
  readonly baseUrl?: string;
}

export type OperatorGatewayCallResult<T> = OperatorGatewayCallSuccess<T> | OperatorGatewayCallFailure;

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

async function classifyOperatorGatewayError(
  error: unknown,
  connection: AgentConnectedHostConnection,
  methodId: OperatorMethodId,
  route: string,
): Promise<OperatorGatewayCallFailure> {
  const message = summarizeError(error);
  const lower = message.toLowerCase();
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('auth')) {
    return { ok: false, kind: 'auth_required', error: message, methodId, route, baseUrl: connection.baseUrl };
  }
  if (lower.includes('404') || lower.includes('not found')) {
    const connectedHost = await fetchConnectedHostStatus(connection);
    if (connectedHost.ok) {
      return {
        ok: false,
        kind: 'connected_host_incompatible',
        error: `Connected GoodVibes host compatibility does not satisfy Agent requirements; ${methodId} is unavailable.`,
        methodId,
        route,
        baseUrl: connection.baseUrl,
      };
    }
    return { ok: false, kind: 'connected_host_route_unavailable', error: message, methodId, route, baseUrl: connection.baseUrl };
  }
  if (lower.includes('fetch') || lower.includes('connect') || lower.includes('econnrefused')) {
    return { ok: false, kind: 'connected_host_unavailable', error: message, methodId, route, baseUrl: connection.baseUrl };
  }
  return { ok: false, kind: 'connected_host_error', error: message, methodId, route, baseUrl: connection.baseUrl };
}

/**
 * Invoke one operator gateway method against the connected host, returning a
 * discriminated result instead of throwing. `route` is an informational HTTP
 * route label used in error/preview output; the SDK's operator.invoke resolves
 * the actual HTTP method/path from the operator contract itself.
 */
export async function invokeOperatorGatewayMethod<T>(
  connection: AgentConnectedHostConnection,
  methodId: OperatorMethodId,
  route: string,
  payload: unknown,
): Promise<OperatorGatewayCallResult<T>> {
  if (!connection.token) {
    return {
      ok: false,
      kind: 'auth_required',
      error: `No connected-host operator token found at ${connection.tokenPath}`,
      methodId,
      route,
      baseUrl: connection.baseUrl,
    };
  }
  try {
    const sdk = createBrowserGoodVibesSdk({ baseUrl: connection.baseUrl, authToken: connection.token });
    const data = await sdk.operator.invoke(methodId, payload as never) as T;
    return { ok: true, data, methodId, route };
  } catch (error) {
    return classifyOperatorGatewayError(error, connection, methodId, route);
  }
}

export function formatOperatorGatewayFailure(failure: OperatorGatewayCallFailure): string {
  const lines = [
    `Connected-host call failed: ${failure.methodId} (${failure.kind})`,
    `  route ${failure.route}`,
    failure.baseUrl ? `  connected host ${failure.baseUrl}` : '',
    `  ${failure.error}`,
  ];
  return lines.filter(Boolean).join('\n');
}
