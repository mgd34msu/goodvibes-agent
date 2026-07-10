/**
 * Gate: every ws-only gateway verb the daemon advertises must actually be
 * invokable on the runtime this package vendors.
 *
 * Regression context (found by the companion app against the 1.13.0 daemon):
 * the TUI's createRuntimeServices built a GatewayMethodCatalog whose builtin
 * DESCRIPTORS were present but never called registerGatewayVerbGroups, so
 * fleet.* (including plain fleet.snapshot), checkpoints.*, and
 * sessions.search all answered 501 "Gateway method is not invokable" over
 * both websocket and HTTP invoke — on every daemon build ever shipped. The
 * contract gates never caught it because they validate descriptors, not
 * handler attachment.
 */
import { describe, expect, test } from 'bun:test';
import { assertEveryDescriptorHasHandler } from '@pellux/goodvibes-terminal-shell/conformance';
import { getTestRuntimeServices } from '../helpers/runtime-services.ts';

const WS_ONLY_METHOD_IDS = [
  'fleet.snapshot',
  'fleet.list',
  'fleet.archive',
  'fleet.unarchive',
  'fleet.archiveFinished',
  'fleet.archived.list',
  'checkpoints.list',
  'checkpoints.create',
  'checkpoints.diff',
  'checkpoints.restore',
  'sessions.search',
  'push.vapid.get',
  'push.subscriptions.list',
] as const;

describe('ws-only gateway verbs are invokable on the vendored runtime', () => {
  const services = getTestRuntimeServices();

  // The descriptor must exist on the catalog. The shipped conformance gate
  // below only sweeps descriptors the catalog actually lists, so a descriptor
  // that went entirely missing would slip past its onlyIds filter — this
  // per-id presence check is what catches that case.
  for (const methodId of WS_ONLY_METHOD_IDS) {
    test(`${methodId} descriptor is registered on the catalog`, () => {
      expect(services.gatewayMethods.get(methodId), `${methodId} descriptor missing from the catalog`).toBeTruthy();
    });
  }

  // Handler-attachment enforcement is the conformance gate shipped by
  // @pellux/goodvibes-terminal-shell, not a hand-rolled hasHandler loop, so the
  // exact drift check the package ships is what guards this vendored runtime.
  // Scoped to the ws-only family via onlyIds: builtin descriptors whose handlers
  // are attached by other layers are legitimately out of scope for this test.
  test('every ws-only descriptor has an attached handler (shipped conformance gate)', () => {
    expect(() =>
      assertEveryDescriptorHasHandler(services.gatewayMethods, { onlyIds: WS_ONLY_METHOD_IDS }),
    ).not.toThrow();
  });

  test('fleet.snapshot invokes end-to-end and answers with real nodes shape', async () => {
    const result = await services.gatewayMethods.invoke('fleet.snapshot', {
      methodId: 'fleet.snapshot',
      body: {},
    } as never) as { capturedAt: number; nodes: unknown[]; truncated: boolean; totalCount: number };
    expect(typeof result.capturedAt).toBe('number');
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(typeof result.truncated).toBe('boolean');
  });

  test('fleet.archived.list invokes end-to-end (empty archive on a fresh runtime)', async () => {
    const result = await services.gatewayMethods.invoke('fleet.archived.list', {
      methodId: 'fleet.archived.list',
      body: {},
    } as never) as { capturedAt: number; nodes: unknown[] };
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(result.nodes).toHaveLength(0);
  });
});
