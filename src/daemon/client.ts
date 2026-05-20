import { getRoute, type RouteId } from './routes.js';
import type { AgentConfig } from '../config.js';
import { isRecord } from '../types.js';
import { EXPECTED_GOODVIBES_SDK_VERSION } from '../version.js';
import type {
  CompanionChatMessage,
  OperatorMethodInput,
  OperatorMethodOutput,
} from '@pellux/goodvibes-sdk/contracts';

export interface RequestOptions {
  readonly query?: Record<string, unknown> | undefined;
  readonly body?: unknown | undefined;
  readonly timeoutMs?: number | undefined;
}

export type DaemonErrorKind = 'daemon_unavailable' | 'daemon_timeout' | 'auth_required' | 'http_error';

export class DaemonRequestError extends Error {
  readonly kind: DaemonErrorKind;

  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'DaemonRequestError';
    this.kind = status === 401 || status === 403 ? 'auth_required' : 'http_error';
  }
}

export class DaemonConnectionError extends Error {
  constructor(
    readonly kind: DaemonErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'DaemonConnectionError';
  }
}

export class GoodVibesDaemonClient {
  constructor(private readonly config: AgentConfig) {}

  get baseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  async invoke<T = unknown>(routeId: RouteId, input: Record<string, unknown> = {}, options: RequestOptions = {}): Promise<T> {
    const route = getRoute(routeId);
    let path = route.path;
    const rest: Record<string, unknown> = { ...input };
    path = path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const value = rest[key];
      if (value === undefined || value === null || value === '') {
        throw new Error(`Missing route parameter: ${key}`);
      }
      delete rest[key];
      return encodeURIComponent(String(value));
    });

    const query = route.method === 'GET' ? { ...rest, ...(options.query ?? {}) } : options.query;
    const body = route.method === 'GET' ? undefined : options.body ?? rest;
    return this.request<T>(path, { method: route.method, query, body, timeoutMs: options.timeoutMs });
  }

  async request<T = unknown>(
    path: string,
    options: RequestOptions & { readonly method?: string | undefined } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 60_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const method = options.method ?? 'GET';
      const url = this.buildUrl(path, options.query);
      const headers: HeadersInit = {};
      if (this.config.token) headers.Authorization = `Bearer ${this.config.token}`;
      if (method !== 'GET' && options.body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(url, {
        method,
        headers,
        credentials: 'include',
        signal: controller.signal,
        ...(method !== 'GET' && options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      const body = await readResponseBody(response);
      if (!response.ok) {
        const authHint = response.status === 401 || response.status === 403
          ? ' Auth failed; check GOODVIBES_AGENT_TOKEN, GOODVIBES_HTTP_TOKEN, GOODVIBES_DAEMON_TOKEN, or the daemon token file.'
          : '';
        throw new DaemonRequestError(`${method} ${path} failed: ${response.status} ${response.statusText}.${authHint}`.trim(), response.status, body);
      }
      return body as T;
    } catch (error) {
      if (error instanceof DaemonRequestError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new DaemonConnectionError(
          'daemon_timeout',
          `GoodVibes daemon at ${this.baseUrl} did not respond within ${timeoutMs}ms. The daemon is expected to already be running; check its health and GOODVIBES_AGENT_BASE_URL.`,
        );
      }
      throw new DaemonConnectionError(
        'daemon_unavailable',
        `Could not connect to the GoodVibes daemon at ${this.baseUrl}. The daemon is expected to already be running; check GOODVIBES_AGENT_BASE_URL and token configuration.`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async status(): Promise<unknown> {
    return this.invoke('control.status');
  }

  async checkCompatibility(): Promise<DaemonCompatibilityResult> {
    const status = await this.status();
    const daemonVersion = isRecord(status) && typeof status.version === 'string'
      ? status.version
      : undefined;
    if (!daemonVersion) {
      return {
        ok: false,
        expectedVersion: EXPECTED_GOODVIBES_SDK_VERSION,
        status,
        reason: 'GoodVibes daemon status did not include a version.',
      };
    }
    const comparison = compareSemver(daemonVersion, EXPECTED_GOODVIBES_SDK_VERSION);
    if (comparison < 0) {
      return {
        ok: false,
        daemonVersion,
        expectedVersion: EXPECTED_GOODVIBES_SDK_VERSION,
        status,
        reason: `GoodVibes daemon ${daemonVersion} is older than goodvibes-agent expects (${EXPECTED_GOODVIBES_SDK_VERSION}).`,
      };
    }
    return {
      ok: true,
      daemonVersion,
      expectedVersion: EXPECTED_GOODVIBES_SDK_VERSION,
      status,
      reason: comparison > 0
        ? `GoodVibes daemon ${daemonVersion} is newer than the pinned SDK contract ${EXPECTED_GOODVIBES_SDK_VERSION}.`
        : 'GoodVibes daemon version matches the pinned SDK contract.',
    };
  }

  async assertCompatibility(): Promise<DaemonCompatibilityResult> {
    const compatibility = await this.checkCompatibility();
    if (!compatibility.ok) throw new Error(compatibility.reason);
    return compatibility;
  }

  async currentAuth(): Promise<unknown> {
    return this.invoke('control.auth.current');
  }

  async diagnostics(): Promise<DaemonDiagnosticResult> {
    try {
      const compatibility = await this.checkCompatibility();
      let auth: unknown = null;
      let authenticated = false;
      try {
        auth = await this.currentAuth();
        authenticated = isRecord(auth) && auth.authenticated === true;
      } catch (error) {
        return {
          ok: false,
          kind: classifyDaemonError(error),
          baseUrl: this.baseUrl,
          compatibility,
          auth,
          message: daemonErrorMessage(error),
        };
      }
      return {
        ok: compatibility.ok && authenticated,
        kind: compatibility.ok
          ? authenticated ? 'ok' : 'auth_required'
          : 'version_mismatch',
        baseUrl: this.baseUrl,
        compatibility,
        auth,
        message: compatibility.ok
          ? authenticated
            ? 'GoodVibes daemon is reachable, authenticated, and compatible.'
            : 'GoodVibes daemon is reachable but auth is not confirmed.'
          : compatibility.reason,
      };
    } catch (error) {
      return {
        ok: false,
        kind: classifyDaemonError(error),
        baseUrl: this.baseUrl,
        compatibility: null,
        auth: null,
        message: daemonErrorMessage(error),
      };
    }
  }

  async createCompanionChat(
    input: OperatorMethodInput<'companion.chat.sessions.create'>,
  ): Promise<OperatorMethodOutput<'companion.chat.sessions.create'>> {
    return this.invoke('companion.chat.sessions.create', input as Record<string, unknown>);
  }

  async getCompanionChatSession(sessionId: string): Promise<OperatorMethodOutput<'companion.chat.sessions.get'>> {
    return this.invoke('companion.chat.sessions.get', { sessionId });
  }

  async updateCompanionChatSession(
    sessionId: string,
    input: Omit<OperatorMethodInput<'companion.chat.sessions.update'>, 'sessionId'>,
  ): Promise<OperatorMethodOutput<'companion.chat.sessions.update'>> {
    return this.invoke('companion.chat.sessions.update', { sessionId, ...input });
  }

  async createSharedSession(input: { readonly title: string; readonly surfaceKind: string; readonly surfaceId: string }): Promise<{ sessionId: string; session: unknown }> {
    const response = await this.invoke('sessions.create', input);
    const session = isRecord(response) ? response.session : null;
    if (!isRecord(session) || typeof session.id !== 'string') {
      throw new Error('Daemon did not return a shared session id.');
    }
    return { sessionId: session.id, session };
  }

  async postCompanionMessage(
    sessionId: string,
    content: string,
    metadata?: OperatorMethodInput<'companion.chat.messages.create'>['metadata'],
  ): Promise<OperatorMethodOutput<'companion.chat.messages.create'>> {
    return this.invoke('companion.chat.messages.create', {
      sessionId,
      body: content,
      ...(metadata ? { metadata } : {}),
    });
  }

  async listCompanionMessages(sessionId: string): Promise<readonly CompanionChatMessage[]> {
    const response = await this.invoke<OperatorMethodOutput<'companion.chat.messages.list'>>('companion.chat.messages.list', { sessionId });
    return response.messages;
  }

  async waitForCompanionAssistantMessage(sessionId: string, afterEpochMs: number, timeoutMs = 90_000): Promise<string> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const messages = await this.listCompanionMessages(sessionId);
      const assistant = [...messages].reverse().find((message) => (
        message.role === 'assistant'
        && message.createdAt >= afterEpochMs
        && message.content.trim()
      ));
      if (assistant) return assistant.content;
      await sleep(750);
    }
    throw new Error(`Timed out waiting for assistant reply in companion chat session ${sessionId}`);
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(path, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null && item !== '') url.searchParams.append(key, String(item));
        }
      } else if (typeof value === 'object') {
        url.searchParams.set(key, JSON.stringify(value));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DaemonCompatibilityResult {
  readonly ok: boolean;
  readonly daemonVersion?: string | undefined;
  readonly expectedVersion: string;
  readonly status: unknown;
  readonly reason: string;
}

export interface DaemonDiagnosticResult {
  readonly ok: boolean;
  readonly kind: 'ok' | 'daemon_unavailable' | 'daemon_timeout' | 'auth_required' | 'http_error' | 'version_mismatch';
  readonly baseUrl: string;
  readonly compatibility: DaemonCompatibilityResult | null;
  readonly auth: unknown;
  readonly message: string;
}

export function classifyDaemonError(error: unknown): DaemonDiagnosticResult['kind'] {
  if (error instanceof DaemonConnectionError) return error.kind;
  if (error instanceof DaemonRequestError) return error.kind;
  return 'http_error';
}

export function daemonErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function compareSemver(actual: string, expected: string): number {
  const actualParts = parseSemver(actual);
  const expectedParts = parseSemver(expected);
  for (let index = 0; index < expectedParts.length; index += 1) {
    const actualPart = actualParts[index] ?? 0;
    const expectedPart = expectedParts[index] ?? 0;
    if (actualPart > expectedPart) return 1;
    if (actualPart < expectedPart) return -1;
  }
  return 0;
}

function parseSemver(version: string): readonly number[] {
  const [core = ''] = version.split('-', 1);
  return core.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}
