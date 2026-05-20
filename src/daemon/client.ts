import { getRoute, type RouteId } from './routes.js';
import type { AgentConfig } from '../config.js';
import { isRecord } from '../types.js';
import { EXPECTED_GOODVIBES_SDK_VERSION } from '../version.js';

export interface RequestOptions {
  readonly query?: Record<string, unknown> | undefined;
  readonly body?: unknown | undefined;
  readonly timeoutMs?: number | undefined;
}

export class DaemonRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'DaemonRequestError';
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
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
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
        throw new DaemonRequestError(`${method} ${path} failed: ${response.status} ${response.statusText}`.trim(), response.status, body);
      }
      return body as T;
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

  async createCompanionChat(input: { readonly title?: string; readonly systemPrompt?: string }): Promise<{ sessionId: string }> {
    return this.invoke('companion.chat.sessions.create', input as Record<string, unknown>);
  }

  async createSharedSession(input: { readonly title: string; readonly surfaceKind: string; readonly surfaceId: string }): Promise<{ sessionId: string; session: unknown }> {
    const response = await this.invoke('sessions.create', input);
    const session = isRecord(response) ? response.session : null;
    if (!isRecord(session) || typeof session.id !== 'string') {
      throw new Error('Daemon did not return a shared session id.');
    }
    return { sessionId: session.id, session };
  }

  async postCompanionMessage(sessionId: string, content: string): Promise<{ messageId: string }> {
    return this.invoke('companion.chat.messages.create', { sessionId, content });
  }

  async listCompanionMessages(sessionId: string): Promise<unknown[]> {
    const response = await this.invoke('companion.chat.messages.list', { sessionId });
    return isRecord(response) && Array.isArray(response.messages) ? response.messages : [];
  }

  async waitForCompanionAssistantMessage(sessionId: string, afterEpochMs: number, timeoutMs = 90_000): Promise<string> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const messages = await this.listCompanionMessages(sessionId);
      const assistant = [...messages].reverse().find((message) => (
        isRecord(message)
        && message.role === 'assistant'
        && typeof message.createdAt === 'number'
        && message.createdAt >= afterEpochMs
      ));
      if (isRecord(assistant)) {
        const text = typeof assistant.content === 'string'
          ? assistant.content
          : typeof assistant.body === 'string'
            ? assistant.body
            : '';
        if (text.trim()) return text;
      }
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
