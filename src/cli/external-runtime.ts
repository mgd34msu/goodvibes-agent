import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { SDK_VERSION } from '../version.ts';
import { readConnectedHostOperatorToken } from '../runtime/connected-host-auth.ts';

type JsonRecord = Record<string, unknown>;

export interface CliExternalRuntimeInspectionOptions {
  readonly configManager: Pick<ConfigManager, 'get'>;
  readonly homeDirectory: string;
  readonly timeoutMs?: number;
}

export interface CliExternalRuntimeSnapshot {
  readonly baseUrl: string;
  readonly statusCode: number | null;
  readonly reachable: boolean;
  readonly version: string;
  readonly expectedVersion: string;
  readonly compatible: boolean;
  readonly operatorToken: {
    readonly present: boolean;
    readonly path: string;
  };
  readonly agentKnowledge: {
    readonly route: '/api/goodvibes-agent/knowledge/status';
    readonly ready: boolean;
    readonly kind: 'ok' | 'auth_required' | 'connected_host_unavailable' | 'version_mismatch' | 'connected_host_route_unavailable' | 'connected_host_error';
    readonly statusCode: number | null;
  };
  readonly error: string | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

function resolveBaseUrl(configManager: Pick<ConfigManager, 'get'>): string {
  const host = String(configManager.get('controlPlane.host') ?? '127.0.0.1');
  const port = Number(configManager.get('controlPlane.port') ?? 3421);
  return `http://${host}:${Number.isFinite(port) ? port : 3421}`;
}

async function fetchJson(
  url: string,
  token: string | null,
  timeoutMs: number,
): Promise<{ readonly ok: boolean; readonly status: number; readonly body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = text;
    if (text.trim().length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export async function inspectCliExternalRuntime(
  options: CliExternalRuntimeInspectionOptions,
): Promise<CliExternalRuntimeSnapshot> {
  const baseUrl = resolveBaseUrl(options.configManager);
  const token = readConnectedHostOperatorToken(options.homeDirectory);
  const timeoutMs = options.timeoutMs ?? 1500;
  const route = '/api/goodvibes-agent/knowledge/status' as const;

  try {
    const status = await fetchJson(`${baseUrl}/status`, token.token, timeoutMs);
    const statusRecord = isRecord(status.body) ? status.body : {};
    const version = readString(statusRecord, 'version') ?? 'unknown';
    const compatible = status.ok && version === SDK_VERSION;

    if (!status.ok) {
      return {
        baseUrl,
        statusCode: status.status,
        reachable: false,
        version,
        expectedVersion: SDK_VERSION,
        compatible: false,
        operatorToken: { present: Boolean(token.token), path: token.path },
        agentKnowledge: {
          route,
          ready: false,
          kind: status.status === 401 ? 'auth_required' : 'connected_host_unavailable',
          statusCode: status.status,
        },
        error: typeof status.body === 'string' ? status.body : `HTTP ${status.status}`,
      };
    }

    if (!token.token) {
      return {
        baseUrl,
        statusCode: status.status,
        reachable: true,
        version,
        expectedVersion: SDK_VERSION,
        compatible,
        operatorToken: { present: false, path: token.path },
        agentKnowledge: {
          route,
          ready: false,
          kind: 'auth_required',
          statusCode: null,
        },
        error: null,
      };
    }

    if (!compatible) {
      return {
        baseUrl,
        statusCode: status.status,
        reachable: true,
        version,
        expectedVersion: SDK_VERSION,
        compatible: false,
        operatorToken: { present: true, path: token.path },
        agentKnowledge: {
          route,
          ready: false,
          kind: 'version_mismatch',
          statusCode: null,
        },
        error: null,
      };
    }

    const knowledge = await fetchJson(`${baseUrl}${route}`, token.token, timeoutMs);
    return {
      baseUrl,
      statusCode: status.status,
      reachable: true,
      version,
      expectedVersion: SDK_VERSION,
      compatible,
      operatorToken: { present: true, path: token.path },
      agentKnowledge: {
        route,
        ready: knowledge.ok,
        kind: knowledge.ok
          ? 'ok'
          : knowledge.status === 401
            ? 'auth_required'
            : knowledge.status === 404
              ? 'connected_host_route_unavailable'
              : 'connected_host_error',
        statusCode: knowledge.status,
      },
      error: knowledge.ok ? null : typeof knowledge.body === 'string' ? knowledge.body : `HTTP ${knowledge.status}`,
    };
  } catch (error) {
    return {
      baseUrl,
      statusCode: null,
      reachable: false,
      version: 'unknown',
      expectedVersion: SDK_VERSION,
      compatible: false,
      operatorToken: { present: Boolean(token.token), path: token.path },
      agentKnowledge: {
        route,
        ready: false,
        kind: 'connected_host_unavailable',
        statusCode: null,
      },
      error: summarizeError(error),
    };
  }
}
