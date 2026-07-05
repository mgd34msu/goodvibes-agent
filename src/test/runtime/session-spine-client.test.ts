import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockFetch } from '../helpers/typed-fetch-mock.ts';
import {
  SessionSpineClient,
  foldLegacySpineStore,
  type SessionSpineClientOptions,
} from '../../runtime/session-spine-client.ts';
import type { SessionRegistrationConnection } from '../../agent/session-registration.ts';

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
    resolveConnection: () => CONNECTION,
    log: { debug: () => {} },
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

describe('SessionSpineClient fire-and-forget', () => {
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
    const client = makeClient();
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
    root = mkdtempSync(join(tmpdir(), 'goodvibes-spine-fold-'));
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

    const result = foldLegacySpineStore(stub, { storePath, markerPath, project: '/p', now: () => 42, log: { debug: () => {} } });
    expect(result).toEqual({ folded: 2, skipped: false });
    expect(folded).toHaveLength(1);
    expect(folded[0]?.ids.sort()).toEqual(['user-1', 'user-2']);
    expect(folded[0]?.closed).toEqual(['user-2']);
    expect(existsSync(markerPath)).toBe(true);
    expect((JSON.parse(readFileSync(markerPath, 'utf-8')) as { count: number }).count).toBe(2);
  });

  test('skips when the marker already exists (idempotent, marked migrated)', () => {
    const storePath = join(root, 'sessions.json');
    const markerPath = join(root, 'sessions.spine-folded.json');
    writeFileSync(storePath, JSON.stringify({ sessions: { 'user-1': { id: 'user-1', status: 'active' } } }));
    writeFileSync(markerPath, JSON.stringify({ migratedAt: 1, count: 1 }));

    let called = 0;
    const result = foldLegacySpineStore(
      { foldLegacyRecords: () => { called += 1; } },
      { storePath, markerPath, project: '/p', log: { debug: () => {} } },
    );
    expect(result.skipped).toBe(true);
    expect(called).toBe(0);
  });

  test('a missing store folds nothing and writes no marker', () => {
    const markerPath = join(root, 'sessions.spine-folded.json');
    let called = 0;
    const result = foldLegacySpineStore(
      { foldLegacyRecords: () => { called += 1; } },
      { storePath: join(root, 'does-not-exist.json'), markerPath, project: '/p', log: { debug: () => {} } },
    );
    expect(result).toEqual({ folded: 0, skipped: false });
    expect(called).toBe(0);
    expect(existsSync(markerPath)).toBe(false);
    mkdirSync(root, { recursive: true }); // keep tmp dir referenced
  });
});
