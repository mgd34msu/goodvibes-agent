import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { mockFetch } from '../helpers/typed-fetch-mock.ts';
import {
  AGENT_SPINE_PARTICIPANT,
  foldLegacySpineStore,
  SessionSpineClient,
  createSessionSpineRestProbe as createSpineRestProbe,
  createSessionSpineRestTransport as createSpineRestTransport,
  type SessionSpineClientOptions,
} from '@pellux/goodvibes-sdk/platform/runtime/session-spine';
import type { SessionRegistrationConnection } from '../../runtime/session-spine-rest-transport.ts';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

const CONNECTION: SessionRegistrationConnection = {
  baseUrl: 'http://127.0.0.1:3421',
  token: 'spine-token',
  tokenPath: '/tmp/operator-tokens.json',
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
};

function makeClient(overrides: Partial<SessionSpineClientOptions> = {}): SessionSpineClient {
  return new SessionSpineClient({
    participant: AGENT_SPINE_PARTICIPANT,
    // Matches production (services.ts): the agent stamps kind:'agent' itself
    // rather than relying on server-side inference, since the live daemon-sdk
    // route defaults an absent kind to 'tui' (verified in runtime-session-register.js).
    recordKind: 'agent',
    transport: createSpineRestTransport({ resolveConnection: () => CONNECTION }),
    log: { debug: () => {}, info: () => {} },
    ...overrides,
  });
}

let originalFetch: typeof fetch;
let requests: CapturedRequest[];

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function installFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = mockFetch(async (input, init) => {
    const url = urlOf(input);
    let parsed: unknown;
    try { parsed = init && typeof init.body === 'string' ? JSON.parse(init.body) : undefined; } catch { parsed = init?.body; }
    requests.push({ url, method: init?.method ?? 'GET', body: parsed });
    return handler(url, init);
  });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  requests = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('SessionSpineClient fire-and-forget (SDK core via the agent REST transport adapter)', () => {
  test('register returns synchronously and does not block on the wire', async () => {
    let resolveFetch: (r: Response) => void = () => {};
    installFetch(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const client = makeClient();

    // register() must return void synchronously; the network has NOT settled yet.
    client.register({ sessionId: 'user-1', project: '/p', title: 'GoodVibes Agent session' });
    expect(client.status()).toBe('unknown'); // no synchronous wire wait / no premature 'online'

    resolveFetch(new Response(JSON.stringify({ session: { id: 'user-1', kind: 'agent', status: 'active' }, reopened: false }), { status: 200 }));
    await settle();
    expect(client.status()).toBe('online');
    // Exactly one register wire call, carrying the canonical agent kind.
    const registers = requests.filter((r) => r.url.endsWith('/api/sessions/register'));
    expect(registers).toHaveLength(1);
    expect((registers[0]?.body as { kind: string }).kind).toBe('agent');
    client.dispose();
  });

  test('register never throws into the caller when fetch rejects, and status stays honest', async () => {
    installFetch(() => { throw new Error('ECONNREFUSED'); });
    const client = makeClient();
    expect(() => client.register({ sessionId: 'user-1', project: '/p' })).not.toThrow();
    await settle();
    expect(client.status()).toBe('offline');
    expect(client.status()).not.toBe('online');
    expect(client.pendingOps).toBe(1); // buffered for later flush
    client.dispose();
  });
});

describe('SessionSpineClient offline queue', () => {
  test('offline register enqueues; a later successful probe flushes idempotently', async () => {
    installFetch(() => { throw new Error('ECONNREFUSED'); });
    // Production shape: the real self-probe (GET /status), not a bare override,
    // proves the adapter's probe wiring, not just the core's queue mechanics.
    const client = makeClient({ probe: createSpineRestProbe({ resolveConnection: () => CONNECTION }) });
    client.register({ sessionId: 'user-1', project: '/p', title: 'T' });
    await settle();
    expect(client.status()).toBe('offline');
    expect(client.pendingOps).toBe(1);

    // Daemon comes back: probe + all ops now resolve 200. Clear the capture so we
    // measure only the flush replay, not the earlier failed offline attempt.
    requests.length = 0;
    installFetch(() => new Response(JSON.stringify({ session: { id: 'user-1', kind: 'agent', status: 'active' }, reopened: false }), { status: 200 }));
    const reachability = await client.probeReachability();
    await settle();
    expect(reachability).toBe('online');
    expect(client.pendingOps).toBe(0);
    const registers = requests.filter((r) => r.url.endsWith('/api/sessions/register'));
    expect(registers).toHaveLength(1); // replayed exactly once (no duplicate flood)
    client.dispose();
  });

  test('bounded ring drops the oldest op past the cap', async () => {
    installFetch(() => { throw new Error('ECONNREFUSED'); });
    const client = makeClient({ queueLimit: 2 });
    for (const id of ['a', 'b', 'c']) {
      client.register({ sessionId: id, project: '/p' });
      await settle();
    }
    expect(client.pendingOps).toBe(2); // 'a' dropped
    client.dispose();
  });
});

describe('SessionSpineClient heartbeat debounce', () => {
  test('coalesces bursty turn activity to at most one leading wire call per window', async () => {
    let clock = 100_000;
    installFetch(() => new Response(JSON.stringify({ session: { id: 'user-1', kind: 'agent', status: 'active' }, reopened: false }), { status: 200 }));
    const client = makeClient({ now: () => clock, heartbeatMinIntervalMs: 1_000 });

    client.register({ sessionId: 'user-1', project: '/p', title: 'GoodVibes Agent session' });
    await settle();
    const registersAfterCreate = requests.filter((r) => r.url.endsWith('/api/sessions/register')).length;

    // First heartbeat past the window boundary → immediate leading beat.
    client.heartbeat('user-1');
    await settle();
    let beats = requests.filter((r) => r.url.endsWith('/api/sessions/register')).length - registersAfterCreate;
    expect(beats).toBe(1);

    // Bursty heartbeats WITHIN the window produce no additional immediate wire calls.
    clock = 100_200;
    client.heartbeat('user-1');
    clock = 100_400;
    client.heartbeat('user-1');
    await settle();
    beats = requests.filter((r) => r.url.endsWith('/api/sessions/register')).length - registersAfterCreate;
    expect(beats).toBe(1); // coalesced

    // A new window allows one more leading beat.
    clock = 101_500;
    client.heartbeat('user-1');
    await settle();
    beats = requests.filter((r) => r.url.endsWith('/api/sessions/register')).length - registersAfterCreate;
    expect(beats).toBe(2);

    // Heartbeat wire bodies omit the title (never rename a titled session).
    const beatBodies = requests
      .filter((r) => r.url.endsWith('/api/sessions/register'))
      .slice(registersAfterCreate)
      .map((r) => r.body as Record<string, unknown>);
    for (const body of beatBodies) expect('title' in body).toBe(false);
    client.dispose();
  });

  test('heartbeat for an unknown session id is a no-op', async () => {
    installFetch(() => new Response('{}', { status: 200 }));
    const client = makeClient();
    client.heartbeat('never-registered');
    await settle();
    expect(requests.filter((r) => r.url.endsWith('/api/sessions/register'))).toHaveLength(0);
    client.dispose();
  });
});

describe('SessionSpineClient reachability probe', () => {
  test('boot with no daemon yields honest offline and never claims online', async () => {
    const client = makeClient({ probe: async () => false });
    expect(client.status()).toBe('unknown');
    const reachability = await client.probeReachability();
    expect(reachability).toBe('offline');
    expect(client.status()).toBe('offline');
    client.dispose();
  });
});

describe('SessionSpineClient legacy fold', () => {
  test('registers each record and closes locally-closed records', async () => {
    installFetch((url) => {
      if (url.endsWith('/close')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ session: { id: 'x', kind: 'agent', status: 'active' }, reopened: false }), { status: 200 });
    });
    const client = makeClient();
    client.foldLegacyRecords(
      [
        { sessionId: 'open-1', project: '/p', title: 'Open one' },
        { sessionId: 'closed-1', project: '/p', title: 'Closed one' },
      ],
      new Set(['closed-1']),
    );
    await settle();

    const registers = requests.filter((r) => r.url.endsWith('/api/sessions/register'));
    const closes = requests.filter((r) => r.url.endsWith('/close'));
    expect(registers).toHaveLength(2);
    for (const r of registers) expect((r.body as { kind: string }).kind).toBe('agent');
    // Only the locally-closed record is also closed on the daemon.
    expect(closes).toHaveLength(1);
    expect(closes[0]?.url).toContain('/api/sessions/closed-1/close');
    client.dispose();
  });
});

describe('foldLegacySpineStore', () => {
  let root: string;

  beforeEach(() => {
    root = makeProjectTempDir('goodvibes-spine-fold');
  });

  test('reads the per-cwd store, folds records, and writes a migration marker', () => {
    const storePath = join(root, 'sessions.json');
    const markerPath = join(root, 'sessions.spine-folded.json');
    writeFileSync(storePath, JSON.stringify({
      sessions: {
        'user-1': { id: 'user-1', kind: 'agent', title: 'One', status: 'active' },
        'user-2': { id: 'user-2', kind: 'tui', title: 'Two', status: 'closed' },
      },
    }));

    const folded: Array<{ ids: string[]; closed: string[] }> = [];
    const stub = {
      foldLegacyRecords: (records: readonly { sessionId: string }[], closedIds: ReadonlySet<string>) => {
        folded.push({ ids: records.map((r) => r.sessionId), closed: [...closedIds] });
      },
    };

    const result = foldLegacySpineStore(stub, { storePath, markerPath, project: '/p', now: () => 42, log: { debug: () => {}, info: () => {} } });
    expect(result).toEqual({ folded: 2, skipped: false });
    expect(folded).toHaveLength(1);
    expect(folded[0]?.ids.sort()).toEqual(['user-1', 'user-2']);
    expect(folded[0]?.closed).toEqual(['user-2']);
    expect(existsSync(markerPath)).toBe(true);
    expect((JSON.parse(readFileSync(markerPath, 'utf-8')) as { count: number }).count).toBe(2);
  });

  test('skips when the marker asserts a completed fold (idempotent, marked migrated)', () => {
    const storePath = join(root, 'sessions.json');
    const markerPath = join(root, 'sessions.spine-folded.json');
    writeFileSync(storePath, JSON.stringify({ sessions: { 'user-1': { id: 'user-1', status: 'active' } } }));
    writeFileSync(markerPath, JSON.stringify({ schemaVersion: 1, completed: true, migratedAt: 1, count: 1 }));

    let called = 0;
    const result = foldLegacySpineStore(
      { foldLegacyRecords: () => { called += 1; } },
      { storePath, markerPath, project: '/p', log: { debug: () => {}, info: () => {} } },
    );
    expect(result.skipped).toBe(true);
    expect(called).toBe(0);
  });

  test('re-folds once when the marker cannot prove the fold completed', () => {
    // A marker's mere existence is no longer trusted: an interrupted write used
    // to strand the legacy store forever. Only a marker that asserts its own
    // completion short-circuits, so the pre-completion-flag shape below folds
    // again, a one-time, idempotent re-register (the legacy file never changes
    // again, and register is an upsert) that then writes a marker which does
    // assert completion.
    const storePath = join(root, 'sessions.json');
    const markerPath = join(root, 'sessions.spine-folded.json');
    writeFileSync(storePath, JSON.stringify({ sessions: { 'user-1': { id: 'user-1', status: 'active' } } }));
    writeFileSync(markerPath, JSON.stringify({ migratedAt: 1, count: 1 }));

    let called = 0;
    const result = foldLegacySpineStore(
      { foldLegacyRecords: () => { called += 1; } },
      { storePath, markerPath, project: '/p', log: { debug: () => {}, info: () => {} } },
    );
    expect(result.skipped).toBe(false);
    expect(called).toBe(1);
    expect(readFileSync(markerPath, 'utf-8')).toContain('"completed": true');
  });

  test('a missing store folds nothing and writes no marker', () => {
    const markerPath = join(root, 'sessions.spine-folded.json');
    let called = 0;
    const result = foldLegacySpineStore(
      { foldLegacyRecords: () => { called += 1; } },
      { storePath: join(root, 'does-not-exist.json'), markerPath, project: '/p', log: { debug: () => {}, info: () => {} } },
    );
    expect(result).toEqual({ folded: 0, skipped: false });
    expect(called).toBe(0);
    expect(existsSync(markerPath)).toBe(false);
    mkdirSync(root, { recursive: true }); // keep tmp dir referenced
  });
});

/** The keepalive window these tests configure, also the fake clock's step size. */
const KEEPALIVE_INTERVAL_MS = 15;

interface KeepaliveHarness {
  readonly client: SessionSpineClient;
  /** Advance the injected clock one full window and fire exactly one keepalive beat. */
  readonly beat: () => Promise<void>;
  /** The interval period the client asked for when it armed the keepalive. */
  readonly armedIntervalMs: () => number | undefined;
  /** True once the client cleared the keepalive interval it armed. */
  readonly keepaliveCleared: () => boolean;
  /** Restores the real setInterval/clearInterval. Call AFTER dispose(). */
  readonly restore: () => void;
}

/**
 * Deterministic keepalive harness.
 *
 * The keepalive used to be driven by a real `setInterval` and observed with
 * wall-clock sleeps, so under full-suite load a beat that had already fired
 * could still be mid-flight when `dispose()` ran, the "no further wire calls
 * after teardown" assertion then saw that straggler and failed (passing solo,
 * failing in a loaded full run). Here the client's interval is CAPTURED instead
 * of armed on the event loop and its clock is injected, so a beat happens
 * exactly when the test says so and never concurrently with teardown. No
 * assertion in this describe depends on elapsed real time.
 */
function startKeepaliveClient(overrides: Partial<SessionSpineClientOptions> = {}): KeepaliveHarness {
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  const handle = { unref: () => {} };
  let armed: { readonly fn: () => void; readonly ms: number } | undefined;
  let cleared = false;
  globalThis.setInterval = ((fn: (...args: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
    // Only the keepalive's own cadence is intercepted; anything else in the
    // process keeps its real timer.
    if (armed === undefined && ms === KEEPALIVE_INTERVAL_MS) {
      armed = { fn: () => { fn(); }, ms };
      return handle as unknown as ReturnType<typeof setInterval>;
    }
    return (realSetInterval as (...a: unknown[]) => ReturnType<typeof setInterval>)(fn, ms, ...rest);
  }) as unknown as typeof globalThis.setInterval;
  globalThis.clearInterval = ((h?: unknown) => {
    if (h === handle) {
      cleared = true;
      return;
    }
    realClearInterval(h as Parameters<typeof clearInterval>[0]);
  }) as typeof globalThis.clearInterval;

  let clock = 1_000_000;
  const client = makeClient({ heartbeatMinIntervalMs: KEEPALIVE_INTERVAL_MS, now: () => clock, ...overrides });
  return {
    client,
    beat: async () => {
      clock += KEEPALIVE_INTERVAL_MS;
      armed?.fn();
      await settle();
    },
    armedIntervalMs: () => armed?.ms,
    keepaliveCleared: () => cleared,
    restore: () => {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
    },
  };
}

describe('SessionSpineClient timer-driven keepalive (an idle-open session must not go stale: ports goodvibes-tui bda3cf5f)', () => {
  const registerCalls = (): CapturedRequest[] => requests.filter((r) => r.url.endsWith('/api/sessions/register'));

  test('keepalive re-heartbeats on its own cadence with NO turn activity', async () => {
    installFetch(() => new Response(JSON.stringify({ session: { id: 'keepalive-1', kind: 'agent', status: 'active' }, reopened: false }), { status: 200 }));
    const harness = startKeepaliveClient();
    try {
      harness.client.register({ sessionId: 'keepalive-1', project: '/p', title: 'T' });
      await settle();
      expect(harness.client.keepaliveSessionId).toBe('keepalive-1');
      // The keepalive is armed on the configured cadence, by the client itself.
      expect(harness.armedIntervalMs()).toBe(KEEPALIVE_INTERVAL_MS);
      const afterRegister = registerCalls().length;

      // Without touching the client again (no register/reopen/heartbeat calls),
      // the keepalive timer alone must produce further heartbeats.
      await harness.beat();
      await harness.beat();

      const beats = registerCalls().slice(afterRegister);
      expect(beats).toHaveLength(2);
      // Every keepalive beat targets the live session id and omits the title.
      for (const beat of beats) {
        expect((beat.body as { sessionId: string }).sessionId).toBe('keepalive-1');
        expect('title' in (beat.body as Record<string, unknown>)).toBe(false);
      }
    } finally {
      harness.client.dispose();
      harness.restore();
    }
  });

  test('dispose() stops the keepalive (no further wire calls after teardown)', async () => {
    installFetch(() => new Response(JSON.stringify({ session: { id: 'keepalive-2', kind: 'agent', status: 'active' }, reopened: false }), { status: 200 }));
    const harness = startKeepaliveClient();
    try {
      harness.client.register({ sessionId: 'keepalive-2', project: '/p', title: 'T' });
      await settle();
      // The keepalive is demonstrably live first, otherwise "no calls after
      // dispose" would also pass on a client that never beat at all.
      await harness.beat();
      const whileLive = registerCalls().length;
      expect(whileLive).toBeGreaterThan(1);

      harness.client.dispose();
      // Teardown is observable, not inferred from a quiet time window: the
      // interval the client armed has been cleared, so it can never fire again.
      expect(harness.keepaliveCleared()).toBe(true);

      const afterDispose = requests.length;
      await settle(); // nothing already in flight may reach the wire either
      expect(requests.length).toBe(afterDispose);
      expect(registerCalls()).toHaveLength(whileLive);
    } finally {
      harness.restore();
    }
  });

  test('close() clears the cached record so a subsequent keepalive tick is a no-op', async () => {
    installFetch(() => new Response(JSON.stringify({ session: { id: 'keepalive-3', kind: 'agent', status: 'active' }, reopened: false }), { status: 200 }));
    const harness = startKeepaliveClient();
    try {
      harness.client.register({ sessionId: 'keepalive-3', project: '/p', title: 'T' });
      await settle();
      harness.client.close('keepalive-3');
      await settle();
      requests.length = 0;

      await harness.beat();

      // heartbeat() is a no-op for a session whose cached record was deleted by close().
      expect(registerCalls()).toHaveLength(0);
    } finally {
      harness.client.dispose();
      harness.restore();
    }
  });

  test('daemon goes offline: keepalive ticks queue (bounded) instead of throwing; a later successful tick flushes and goes back online', async () => {
    installFetch(() => { throw new Error('ECONNREFUSED'); });
    const harness = startKeepaliveClient();
    try {
      harness.client.register({ sessionId: 'keepalive-4', project: '/p', title: 'T' });
      await settle();
      expect(harness.client.status()).toBe('offline');

      // One more keepalive tick while still offline, it must ride the existing
      // bounded queue (drop-oldest), never throw, never spin up a separate
      // faster retry loop.
      await harness.beat();
      expect(harness.client.status()).toBe('offline');
      expect(harness.client.pendingOps).toBeGreaterThan(0); // queued for replay, never thrown/dropped-on-the-floor

      // Daemon comes back: the NEXT keepalive tick (no manual intervention)
      // succeeds and flushes the queue.
      installFetch(() => new Response(JSON.stringify({ session: { id: 'keepalive-4', kind: 'agent', status: 'active' }, reopened: false }), { status: 200 }));
      await harness.beat();
      expect(harness.client.status()).toBe('online');
      expect(harness.client.pendingOps).toBe(0);
    } finally {
      harness.client.dispose();
      harness.restore();
    }
  });
});

describe('SessionSpineClient result-kind fold (REST adapter -> SDK SpineResult, S4 divergence ruling #5)', () => {
  test('a connected_host_unavailable response folds to offline (queue + reachability offline)', async () => {
    installFetch(() => { throw new Error('ECONNREFUSED'); }); // -> connected_host_unavailable
    const client = makeClient();
    client.register({ sessionId: 'fold-1', project: '/p' });
    await settle();
    expect(client.status()).toBe('offline');
    expect(client.pendingOps).toBe(1); // enqueued for idempotent replay
    client.dispose();
  });

  test('an auth_required response folds to rejected: log-only, no queue, no infinite retry', async () => {
    installFetch(() => new Response(JSON.stringify({ error: 'no token' }), { status: 401 })); // -> auth_required
    const client = makeClient();
    client.register({ sessionId: 'fold-2', project: '/p' });
    await settle();
    expect(client.status()).toBe('unknown'); // never claims online; reachability untouched by a durable reject
    expect(client.pendingOps).toBe(0); // NOT enqueued, a durable refusal must not retry-forever
    client.dispose();
  });

  test('a route_unavailable (404) response also folds to rejected: log-only, no queue', async () => {
    installFetch(() => new Response('not found', { status: 404 })); // -> connected_host_route_unavailable
    const client = makeClient();
    client.register({ sessionId: 'fold-3', project: '/p' });
    await settle();
    expect(client.status()).toBe('unknown');
    expect(client.pendingOps).toBe(0);
    client.dispose();
  });
});

describe('SessionSpineClient live-immediately construction (no activate() call)', () => {
  test('a transport supplied at construction registers immediately, with no separate activation step', async () => {
    installFetch(() => new Response(JSON.stringify({ session: { id: 'live-1', kind: 'agent', status: 'active' }, reopened: false }), { status: 200 }));
    const client = makeClient();
    // No client.activate(...) call anywhere in this test, live-immediately mode
    // means the transport passed to the constructor is already active.
    expect(client.active).toBe(true);
    client.register({ sessionId: 'live-1', project: '/p' });
    await settle();
    expect(client.status()).toBe('online');
    const registers = requests.filter((r) => r.url.endsWith('/api/sessions/register'));
    expect(registers).toHaveLength(1);
    client.dispose();
  });
});

describe('SessionSpineClient self-probe reachability', () => {
  test('probeReachability() flips offline -> online -> offline honestly, following the injected probe', async () => {
    const client = makeClient({ probe: async () => false });
    expect(await client.probeReachability()).toBe('offline');
    expect(client.status()).toBe('offline');

    const client2 = makeClient({ probe: async () => true });
    expect(await client2.probeReachability()).toBe('online');
    expect(client2.status()).toBe('online');
    client.dispose();
    client2.dispose();
  });

  test('the real REST probe (createSpineRestProbe, GET /status) flips honestly against a live-vs-dead mock host', async () => {
    installFetch(() => { throw new Error('ECONNREFUSED'); });
    const client = makeClient({ probe: createSpineRestProbe({ resolveConnection: () => CONNECTION }) });
    expect(await client.probeReachability()).toBe('offline');

    installFetch(() => new Response('{}', { status: 200 }));
    expect(await client.probeReachability()).toBe('online');
    const statusCalls = requests.filter((r) => r.url.endsWith('/status'));
    expect(statusCalls.length).toBeGreaterThan(0);
    client.dispose();
  });
});

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

describe('Deletion completeness (grep gate)', () => {
  test('no agent file imports the deleted local session-spine-client module', () => {
    const srcRoot = join(REPO_ROOT, 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) { walk(abs); continue; }
        if (!entry.name.endsWith('.ts')) continue;
        if (abs === import.meta.path) continue; // this file's own text mentions the old name in comments/history only
        const text = readFileSync(abs, 'utf-8');
        if (text.includes('./session-spine-client') || text.includes('runtime/session-spine-client')) {
          offenders.push(abs);
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
    expect(existsSync(join(srcRoot, 'runtime', 'session-spine-client.ts'))).toBe(false);
  });
});

describe('Token-reading stays agent-local (the SDK module never reads token files)', () => {
  test('the SDK session-spine dist has no filesystem token access', () => {
    // The SDK core's client.ts imports node:fs ONLY for foldLegacySpineStore's
    // legacy-store marker read/write (documented, storePath/markerPath are
    // caller-supplied paths, not a token file), it must never read the
    // agent's connected-host operator-tokens.json or otherwise resolve a
    // token itself. That responsibility belongs entirely to this adapter
    // (createSpineConnectionResolver -> readConnectedHostOperatorToken).
    const clientJsPath = join(
      REPO_ROOT, 'node_modules', '@pellux', 'goodvibes-sdk', 'dist', 'platform', 'runtime', 'session-spine', 'client.js',
    );
    // Sanity: the file must actually exist and be non-empty, or the assertions
    // below would be vacuously true.
    expect(existsSync(clientJsPath)).toBe(true);
    expect(statSync(clientJsPath).size).toBeGreaterThan(0);
    const clientSource = readFileSync(clientJsPath, 'utf-8');
    expect(clientSource).not.toContain('operator-tokens.json');
    expect(clientSource).not.toContain('GOODVIBES_CONNECTED_HOST_TOKEN');
    expect(clientSource).not.toContain('GOODVIBES_DAEMON_TOKEN');
  });
});
