/**
 * Gate: this process serves no gateway verb, and the catalog it still carries
 * is local dispatch for its own tools.
 *
 * ── What this file used to assert, and why it inverted ────────────────────
 *
 * It asserted that every ws-only verb the daemon advertises — fleet.*,
 * checkpoints.*, sessions.search, push.*, workspaces.*, permissions.rules.* —
 * was INVOKABLE on the runtime this package composes. That was the right gate
 * when this package vendored a daemon: a catalog with descriptors and no
 * handlers answered 501 over websocket and HTTP, and the companion app found it
 * against a shipped build.
 *
 * This package vendors no daemon. It composes no DaemonServer, starts no
 * listener, and its own CLI parser refuses host commands in those words. So the
 * handlers it registered were reachable only by a caller that cannot exist here,
 * while the daemon served the same families for real to every surface including
 * this one. Registering them was fifteen verb families of dead weight and a
 * standing second implementation of each.
 *
 * ── What it asserts now ───────────────────────────────────────────────────
 *
 * The inverse, which is the property that actually has to hold: no daemon-served
 * verb carries a handler in this process. If one comes back, this package has
 * started answering a question it cannot see the whole of — a fleet snapshot
 * missing every other surface's agents, a checkpoint list missing the daemon's.
 *
 * Two families went with them that this fork DID dispatch in-process:
 * `occasions.*` and `profile.*`. The same registrar served all of them and the
 * SDK publishes no entry point for those two alone, so keeping them meant
 * keeping the other fifteen — and what that registration composed was an owner
 * profile store over a Markdown file at DAEMON scope, a second writer of a file
 * the daemon owns. Both tools were built for this: they probe the catalog and
 * fall back to the connected host, which they now always take.
 *
 * The catalog itself is deliberately NOT gone: bootstrap.ts hands it to
 * `pluginManager.init({ gatewayMethods })`, so a loaded plugin can register
 * verbs into it, and those same two probes are what pick them up.
 */
import { describe, expect, test } from 'bun:test';
import { getTestRuntimeServices } from '../helpers/runtime-services.ts';

/**
 * The families the daemon serves. Every one of these was registered here and is
 * not any more; each is reachable from this process over the one gateway-method
 * route in runtime/client/daemon-verbs.ts, against the daemon that holds the
 * whole picture.
 */
const DAEMON_SERVED_METHOD_IDS = [
  'fleet.snapshot',
  'fleet.list',
  'fleet.archive',
  'fleet.unarchive',
  'fleet.archiveFinished',
  'fleet.archived.list',
  'fleet.attempts.list',
  'fleet.attempts.pick',
  'fleet.attempts.judge',
  'fleet.graph.get',
  'checkpoints.list',
  'checkpoints.create',
  'checkpoints.diff',
  'checkpoints.restore',
  'sessions.search',
  'push.vapid.get',
  'push.subscriptions.list',
  'workspaces.registrations.list',
  'workspaces.registrations.add',
  'workspaces.registrations.remove',
  'workspaces.resolve',
  'permissions.rules.list',
  'permissions.rules.delete',
] as const;

describe('this process serves no gateway verb', () => {
  const services = getTestRuntimeServices();

  for (const methodId of DAEMON_SERVED_METHOD_IDS) {
    test(`${methodId} has no handler here — the daemon serves it`, () => {
      expect(
        services.gatewayMethods.hasHandler(methodId),
        `${methodId} has a handler in the agent process. Nothing outside this process can call it, `
        + 'and the daemon already serves it with the whole picture; a handler here is a second, '
        + 'partial implementation answering from one surface\'s state.',
      ).toBe(false);
    });
  }

  test('invoking one refuses rather than answering from this process\'s partial state', async () => {
    // The refusal is the honest outcome. A fleet snapshot built here would list
    // this agent's own sub-agents and no other surface's, and look complete.
    await expect(
      services.gatewayMethods.invoke('fleet.snapshot', { methodId: 'fleet.snapshot', body: {} } as never),
    ).rejects.toThrow();
  });

  test('the descriptors remain — they are the shared contract, not a claim to serve them', () => {
    // Descriptors are how a client knows a verb's shape. Keeping them while
    // dropping the handlers is the whole distinction: this process describes
    // the platform's verbs and answers none of them.
    for (const methodId of DAEMON_SERVED_METHOD_IDS) {
      expect(services.gatewayMethods.get(methodId), `${methodId} descriptor missing`).toBeTruthy();
    }
  });
});

describe('the catalog is kept for the consumers that are actually live', () => {
  const services = getTestRuntimeServices();

  test('the graph still carries it, because the plugin manager is handed it at boot', () => {
    expect(services.gatewayMethods).toBeTruthy();
    expect(typeof services.gatewayMethods.hasHandler).toBe('function');
  });

  test('occasions and profile verbs are unhandled here, so those tools use the connected host', () => {
    // This fork DID serve these in-process, over an owner-profile store it
    // composed against the daemon's own Markdown file. One file, one writer:
    // the daemon's. Both invokers probe `hasHandler` first and fall back, so
    // the fallback is now the live route — pinned here so it is not read as a
    // defect and "fixed" by re-registering a second writer.
    for (const methodId of ['occasions.pending', 'occasions.list', 'profile.get', 'profile.status']) {
      expect(services.gatewayMethods.hasHandler(methodId)).toBe(false);
    }
  });
});
