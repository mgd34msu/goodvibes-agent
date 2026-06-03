import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBrowserAgentSdk } from '@pellux/goodvibes-sdk/browser/agent';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { SDK_VERSION, VERSION } from '../version.ts';
import type { ConnectedHostCallMethod } from './agent-knowledge-methods.ts';

export type JsonRecord = Record<string, unknown>;

export interface AgentKnowledgeConnection {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly tokenPath: string;
}

export interface AgentKnowledgeConnectionRuntime {
  readonly configManager: {
    get(key: string): unknown;
  };
  readonly homeDirectory: string;
}

export interface AgentKnowledgeFailure {
  readonly ok: false;
  readonly kind: 'connected_host_unavailable' | 'auth_required' | 'version_mismatch' | 'connected_host_route_unavailable' | 'connected_host_error';
  readonly error: string;
  readonly baseUrl: string;
  readonly route: string;
  readonly connectedHostVersion?: string;
  readonly expectedSdkVersion?: string;
}

export interface AgentKnowledgeSuccess<TData> {
  readonly ok: true;
  readonly kind: string;
  readonly route: string;
  readonly data: TData;
}

export type AgentKnowledgeResult<TData> = AgentKnowledgeSuccess<TData> | AgentKnowledgeFailure;

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readString(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

export function readPackageMetadata(): { readonly version: string; readonly sdkVersion: string } {
  return { version: VERSION, sdkVersion: SDK_VERSION };
}

export function resolveConnectedHostConnection(runtime: AgentKnowledgeConnectionRuntime): AgentKnowledgeConnection {
  const host = String(runtime.configManager.get('controlPlane.host') ?? '127.0.0.1');
  const port = Number(runtime.configManager.get('controlPlane.port') ?? 3421);
  const baseUrl = `http://${host}:${Number.isFinite(port) ? port : 3421}`;
  const tokenPath = join(runtime.homeDirectory, '.goodvibes', 'daemon', 'operator-tokens.json');
  if (!existsSync(tokenPath)) return { baseUrl, token: null, tokenPath };
  try {
    const parsed = JSON.parse(readFileSync(tokenPath, 'utf-8')) as unknown;
    const token = isRecord(parsed) && typeof parsed.token === 'string' ? parsed.token : null;
    return { baseUrl, token, tokenPath };
  } catch {
    return { baseUrl, token: null, tokenPath };
  }
}

export async function fetchConnectedHostStatus(connection: AgentKnowledgeConnection): Promise<{ readonly ok: boolean; readonly status: number; readonly body: unknown }> {
  try {
    const response = await fetch(`${connection.baseUrl}/status`, {
      headers: connection.token ? { authorization: `Bearer ${connection.token}` } : undefined,
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: summarizeError(error) };
  }
}

export async function classifyKnowledgeError(error: unknown, connection: AgentKnowledgeConnection, route: string): Promise<AgentKnowledgeFailure> {
  const message = summarizeError(error);
  const lower = message.toLowerCase();
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('auth')) {
    return { ok: false, kind: 'auth_required', error: message, baseUrl: connection.baseUrl, route };
  }
  if (lower.includes('404') || lower.includes('not found')) {
    const metadata = readPackageMetadata();
    const connectedHost = await fetchConnectedHostStatus(connection);
    const connectedHostRecord = isRecord(connectedHost.body) ? connectedHost.body : {};
    const connectedHostVersion = readString(connectedHostRecord, 'version') ?? 'unknown';
    if (connectedHost.ok && connectedHostVersion !== metadata.sdkVersion) {
      return {
        ok: false,
        kind: 'version_mismatch',
        error: `Connected GoodVibes host SDK version ${connectedHostVersion} does not match Agent SDK pin ${metadata.sdkVersion}; Agent Knowledge route is unavailable.`,
        baseUrl: connection.baseUrl,
        route,
        connectedHostVersion,
        expectedSdkVersion: metadata.sdkVersion,
      };
    }
    return { ok: false, kind: 'connected_host_route_unavailable', error: message, baseUrl: connection.baseUrl, route };
  }
  if (lower.includes('fetch') || lower.includes('connect') || lower.includes('econnrefused')) {
    return { ok: false, kind: 'connected_host_unavailable', error: message, baseUrl: connection.baseUrl, route };
  }
  return { ok: false, kind: 'connected_host_error', error: message, baseUrl: connection.baseUrl, route };
}

export function createAgentSdk(connection: AgentKnowledgeConnection) {
  return createBrowserAgentSdk({
    baseUrl: connection.baseUrl,
    authToken: connection.token,
  });
}

export async function postAgentKnowledgeJson<TData>(
  connection: AgentKnowledgeConnection,
  route: string,
  body: JsonRecord,
): Promise<TData> {
  const response = await fetch(`${connection.baseUrl}${route}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${connection.token ?? ''}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    const detail = isRecord(parsed) && typeof parsed.error === 'string' ? parsed.error : text;
    throw new Error(`HTTP ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
  }
  return parsed as TData;
}

function queryRoute(route: string, query: JsonRecord): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim().length > 0) params.append(key, item);
      }
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, String(value));
    }
  }
  const suffix = params.toString();
  return suffix ? `${route}?${suffix}` : route;
}

export async function getAgentKnowledgeJson<TData>(
  connection: AgentKnowledgeConnection,
  route: string,
  query: JsonRecord = {},
): Promise<TData> {
  const response = await fetch(`${connection.baseUrl}${queryRoute(route, query)}`, {
    headers: {
      authorization: `Bearer ${connection.token ?? ''}`,
    },
  });
  const text = await response.text();
  let parsed: unknown = text;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    const detail = isRecord(parsed) && typeof parsed.error === 'string' ? parsed.error : text;
    throw new Error(`HTTP ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
  }
  return parsed as TData;
}

export function findDisallowedKnowledgeScopeFlag(args: readonly string[]): string | null {
  const disallowed = [
    '--space',
    '--knowledge-space',
    '--knowledge-space-id',
    ['--knowledge', 'SpaceId'].join(''),
    '--include-all-spaces',
    ['--include', 'AllSpaces'].join(''),
    ['--home', 'graph'].join(''),
    ['--home', '-graph'].join(''),
  ];
  for (const token of args) {
    for (const flag of disallowed) {
      if (token === flag || token.startsWith(`${flag}=`)) return flag;
    }
  }
  return null;
}

export function formatScopeFlagRejection(flag: string): string {
  return [
    `Agent Knowledge is isolated; ${flag} is not accepted.`,
    'GoodVibes Agent must not use default knowledge or non-Agent product spaces.',
    'Use only /api/goodvibes-agent/knowledge/* Agent-owned routes.',
  ].join('\n');
}

export async function runKnowledgeCall<TData>(
  runtime: AgentKnowledgeConnectionRuntime,
  method: ConnectedHostCallMethod,
  call: (connection: AgentKnowledgeConnection) => Promise<TData>,
): Promise<AgentKnowledgeResult<TData>> {
  const connection = resolveConnectedHostConnection(runtime);
  if (!connection.token) {
    return {
      ok: false,
      kind: 'auth_required',
      error: `No connected-host operator token found at ${connection.tokenPath}`,
      baseUrl: connection.baseUrl,
      route: method.route,
    };
  }
  try {
    const data = await call(connection);
    return { ok: true, kind: method.kind, route: method.route, data };
  } catch (error) {
    return classifyKnowledgeError(error, connection, method.route);
  }
}
