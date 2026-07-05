import { describe, expect, test } from 'bun:test';
import { mockFetch } from '../helpers/typed-fetch-mock.ts';
import {
  SESSION_REGISTER_KIND,
  SESSION_REGISTER_PATH,
  buildSessionCloseRequest,
  buildSessionRegisterRequest,
  postSessionClose,
  postSessionRegister,
  type SessionRegistrationConnection,
  type SessionRegistrationInput,
} from '../../agent/session-registration.ts';

const CONNECTION: SessionRegistrationConnection = {
  baseUrl: 'http://127.0.0.1:3421',
  token: 'spine-token',
  tokenPath: '/home/user/.goodvibes/daemon/operator-tokens.json',
};

function input(overrides: Partial<SessionRegistrationInput> = {}): SessionRegistrationInput {
  return {
    sessionId: 'user-abc',
    project: '/home/user/project',
    title: 'GoodVibes Agent session',
    participant: {
      surfaceKind: 'service',
      surfaceId: 'surface:goodvibes-agent',
      displayName: 'GoodVibes Agent',
      userId: 'user-1',
      lastSeenAt: 1000,
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('buildSessionRegisterRequest', () => {
  test('stamps the canonical agent kind and the transport participant, project and title', () => {
    const request = buildSessionRegisterRequest(input());
    expect(request.path).toBe(SESSION_REGISTER_PATH);
    expect(request.method).toBe('POST');
    expect(request.body).toEqual({
      sessionId: 'user-abc',
      kind: SESSION_REGISTER_KIND,
      project: '/home/user/project',
      title: 'GoodVibes Agent session',
      participant: {
        surfaceKind: 'service',
        surfaceId: 'surface:goodvibes-agent',
        displayName: 'GoodVibes Agent',
        userId: 'user-1',
        lastSeenAt: 1000,
      },
    });
    // TRANSPORT ⊂ CANONICAL: participant.surfaceKind is NEVER 'agent'.
    expect((request.body.participant as { surfaceKind: string }).surfaceKind).toBe('service');
    expect(request.body.kind).toBe('agent');
  });

  test('omits reopen by default and only emits reopen when explicitly true', () => {
    expect('reopen' in buildSessionRegisterRequest(input()).body).toBe(false);
    expect(buildSessionRegisterRequest(input({ reopen: true })).body.reopen).toBe(true);
    // reopen:false is treated as "not a reopen" and omitted from the wire body.
    expect('reopen' in buildSessionRegisterRequest(input({ reopen: false })).body).toBe(false);
  });

  test('omits title on a heartbeat-shaped input', () => {
    const request = buildSessionRegisterRequest(input({ title: undefined }));
    expect('title' in request.body).toBe(false);
  });
});

describe('buildSessionCloseRequest', () => {
  test('encodes the session id into the close route', () => {
    expect(buildSessionCloseRequest('user abc/1')).toEqual({
      path: '/api/sessions/user%20abc%2F1/close',
      method: 'POST',
    });
  });
});

describe('postSessionRegister', () => {
  test('registers a fresh record and reports outcome registered', async () => {
    const original = globalThis.fetch;
    let capturedBody = '';
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : '';
      return jsonResponse({ session: { id: 'user-abc', kind: 'agent', status: 'active' }, reopened: false });
    });
    try {
      const result = await postSessionRegister(CONNECTION, input());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.outcome).toBe('registered');
      expect(result.reopened).toBe(false);
      expect(result.session?.kind).toBe('agent');
      expect(JSON.parse(capturedBody).kind).toBe('agent');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('404 (0.38.0 daemon / route absent) degrades honestly to route_unavailable', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch(async () => jsonResponse({ error: 'not found' }, 404));
    try {
      const result = await postSessionRegister(CONNECTION, input());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe('connected_host_route_unavailable');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('401/403 map to auth_required', async () => {
    const original = globalThis.fetch;
    for (const status of [401, 403]) {
      globalThis.fetch = mockFetch(async () => jsonResponse({ error: 'nope' }, status));
      const result = await postSessionRegister(CONNECTION, input());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe('auth_required');
    }
    globalThis.fetch = original;
  });

  test('absent token fails closed as auth_required without any wire call', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = mockFetch(async () => { calls += 1; return jsonResponse({}); });
    try {
      const result = await postSessionRegister({ ...CONNECTION, token: null }, input());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('auth_required');
        expect(result.error).toContain('no connected-host operator token found');
      }
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  test('network rejection maps to connected_host_unavailable', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch(async () => { throw new Error('ECONNREFUSED'); });
    try {
      const result = await postSessionRegister(CONNECTION, input());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe('connected_host_unavailable');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('CLOSED-CONFLICT on a 200 surfaces as still_closed, never registered/reopened', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch(async () => jsonResponse({
      session: { id: 'user-abc', kind: 'agent', status: 'closed' },
      reopened: false,
      conflict: { status: 'closed' },
    }));
    try {
      const result = await postSessionRegister(CONNECTION, input({ title: undefined }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.outcome).toBe('still_closed');
      expect(result.reopened).toBe(false);
      expect(result.conflict?.status).toBe('closed');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('reopen:true path reports outcome reopened', async () => {
    const original = globalThis.fetch;
    let capturedBody = '';
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : '';
      return jsonResponse({ session: { id: 'user-abc', kind: 'agent', status: 'active' }, reopened: true });
    });
    try {
      const result = await postSessionRegister(CONNECTION, input({ reopen: true, title: undefined }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.outcome).toBe('reopened');
      expect(result.reopened).toBe(true);
      expect(JSON.parse(capturedBody).reopen).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('postSessionClose', () => {
  test('posts the close route and reports ok', async () => {
    const original = globalThis.fetch;
    let url = '';
    let method = '';
    globalThis.fetch = mockFetch(async (reqInput, init) => {
      url = typeof reqInput === 'string' ? reqInput : reqInput instanceof URL ? reqInput.toString() : reqInput.url;
      method = init?.method ?? 'GET';
      return jsonResponse({ ok: true });
    });
    try {
      const result = await postSessionClose(CONNECTION, 'user-abc');
      expect(result.ok).toBe(true);
      expect(url).toBe('http://127.0.0.1:3421/api/sessions/user-abc/close');
      expect(method).toBe('POST');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('close without a token fails closed as auth_required with no wire call', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = mockFetch(async () => { calls += 1; return jsonResponse({}); });
    try {
      const result = await postSessionClose({ ...CONNECTION, token: null }, 'user-abc');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe('auth_required');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
