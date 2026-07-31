/**
 * daemon-build-compatibility.test.ts — this process judging the daemon it
 * attached to.
 *
 * The forward guard (client-build-compatibility) covers this build being too
 * old for the daemon. This covers the reverse, and the reason it matters is
 * that its failure mode is invisible: a daemon too old to serve a verb answers
 * one call with a 400, which reads as a broken feature. Nobody goes looking at
 * the daemon's version.
 *
 * The two properties under test are the ones a guard gets wrong:
 *
 *  - An UNREADABLE version is 'unknown', never 'ok'. A peer that cannot prove
 *    it carries a behavior is treated as one that does not.
 *  - The finding LATCHES, so a later read that cannot determine a version does
 *    not silently clear it — but `reset()` drops it, because a verdict about
 *    one daemon says nothing about a different one.
 */

import { describe, expect, test } from 'bun:test';
import {
  AGENT_DAEMON_BUILD_FLOOR,
  DaemonBuildGuard,
  readDaemonStatusPayload,
} from '../../runtime/daemon-build-compatibility.ts';

describe('the floor this product declares', () => {
  test('is unset, which the SDK reads as asking for nothing', () => {
    // Deliberate. Raising it costs every operator on an older daemon a forced
    // update, so the number is an owner decision with a release note, not
    // something to infer. This test exists so changing it is a conscious act.
    expect(AGENT_DAEMON_BUILD_FLOOR).toBeUndefined();

    const guard = new DaemonBuildGuard({ floor: AGENT_DAEMON_BUILD_FLOOR });
    expect(guard.observeStatus({ status: 'running', version: '0.0.1' }).status).toBe('ok');
  });
});

describe('judging an attached daemon', () => {
  test('a daemon at or above the floor is fine', () => {
    const guard = new DaemonBuildGuard({ floor: '1.20.0' });

    const verdict = guard.observeStatus({ status: 'running', version: '1.21.0' });

    expect(verdict.status).toBe('ok');
    expect(verdict.daemonVersion).toBe('1.21.0');
    expect(guard.mayUseDaemonCapabilities()).toBe(true);
  });

  test('a daemon below the floor is refused, naming both versions', () => {
    const guard = new DaemonBuildGuard({ floor: '1.21.0' });

    const verdict = guard.observeStatus({ status: 'running', version: '1.19.0' });

    expect(verdict.status).toBe('daemon-update-required');
    expect(verdict.message).toContain('1.19.0');
    expect(verdict.message).toContain('1.21.0');
    expect(guard.mayUseDaemonCapabilities()).toBe(false);
  });

  test('the peer is named, so an operator with two daemons knows which one', () => {
    const guard = new DaemonBuildGuard({ floor: '1.21.0' });

    const verdict = guard.observeStatus({ version: '1.19.0' }, 'http://nas.local:3421');

    expect(verdict.message).toContain('http://nas.local:3421');
  });

  test('a daemon that reports no version is unknown, not ok', () => {
    const guard = new DaemonBuildGuard({ floor: '1.21.0' });

    expect(guard.observeStatus({ status: 'running' }).status).toBe('unknown');
    expect(guard.observeStatus('not an object').status).toBe('unknown');
  });

  test('the owner is told once, not on every attach', () => {
    const seen: string[] = [];
    const guard = new DaemonBuildGuard({
      floor: '1.21.0',
      onDaemonUpdateRequired: (verdict) => { seen.push(verdict.message); },
    });

    guard.observeStatus({ version: '1.19.0' });
    guard.observeStatus({ version: '1.19.0' });
    guard.observeStatus({ version: '1.19.0' });

    expect(seen).toHaveLength(1);
  });

  test('the finding latches against a later unreadable read', () => {
    const guard = new DaemonBuildGuard({ floor: '1.21.0' });
    guard.observeStatus({ version: '1.19.0' });

    guard.observeStatus({ status: 'running' });

    expect(guard.current().status).toBe('daemon-update-required');
    expect(guard.mayUseDaemonCapabilities()).toBe(false);
  });

  test('reset drops the finding, for an attach to a different daemon', () => {
    const guard = new DaemonBuildGuard({ floor: '1.21.0' });
    guard.observeStatus({ version: '1.19.0' });

    guard.reset();

    expect(guard.mayUseDaemonCapabilities()).toBe(true);
    expect(guard.observeStatus({ version: '1.22.0' }).status).toBe('ok');
  });

  test('a fresh guard has observed nothing and claims nothing', () => {
    const guard = new DaemonBuildGuard({ floor: '1.21.0' });

    expect(guard.current().daemonVersion).toBeUndefined();
    expect(guard.mayUseDaemonCapabilities()).toBe(true);
  });
});

describe('reading the daemon build off /status', () => {
  test('the parsed body is returned', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ status: 'running', version: '1.21.0' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    const payload = await readDaemonStatusPayload({ baseUrl: 'http://d', token: 't' }, { fetchImpl });

    expect(payload).toMatchObject({ version: '1.21.0' });
  });

  test('an unreachable daemon yields null rather than throwing', async () => {
    // Null is "nothing observed", which the guard treats as no verdict at all —
    // an offline laptop must not be reported as running an old daemon.
    const fetchImpl = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;

    const payload = await readDaemonStatusPayload({ baseUrl: 'http://d', token: 't' }, { fetchImpl });

    expect(payload).toBeNull();
  });

  test('a non-2xx answer yields null', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;

    const payload = await readDaemonStatusPayload({ baseUrl: 'http://d', token: 't' }, { fetchImpl });

    expect(payload).toBeNull();
  });

  test('a body that is not JSON yields null', async () => {
    const fetchImpl = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;

    const payload = await readDaemonStatusPayload({ baseUrl: 'http://d', token: 't' }, { fetchImpl });

    expect(payload).toBeNull();
  });

  test('an unreachable daemon leaves the guard with no verdict', async () => {
    const guard = new DaemonBuildGuard({ floor: '1.21.0' });
    const fetchImpl = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;

    const payload = await readDaemonStatusPayload({ baseUrl: 'http://d', token: null }, { fetchImpl });
    if (payload !== null) guard.observeStatus(payload);

    expect(guard.current().status).toBe('ok');
    expect(guard.current().daemonVersion).toBeUndefined();
  });
});
