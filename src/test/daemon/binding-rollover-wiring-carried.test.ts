/**
 * Binding-rollover wiring: carried by the SDK path this fork already uses, not
 * duplicated here.
 *
 * The SDK's daemon facade composition gained two pieces this round: the session
 * broker's own voice on a channel, used when it heals a route binding that named
 * an unusable session (so the person on the other end is told the conversation
 * moved instead of meeting an assistant that has silently forgotten the last two
 * days), and one ingress alarm across every inbound path (so the first failed
 * inbound owner message pings the owner through a working channel rather than
 * warning into a debug log).
 *
 * This fork composes NO daemon facade of its own — it builds a runtime graph and
 * hands it to the SDK's DaemonServer (see services.ts's "This fork composes no
 * DaemonServer" note, and startHostServices, which constructs one from this
 * graph). So both pieces are wired by the SDK, onto the very instances this
 * composition root returns, and re-doing either here would be a second sender
 * competing with the first for the same channel.
 *
 * What that leaves worth asserting is the HANDOFF, which is the half that can
 * break here: the facade reaches the wiring through `runtimeServices.sessionBroker`,
 * `runtimeServices.routeBindings` and `runtimeServices.channelPlugins`, and calls
 * a specific method on each. A composition root that stopped returning one of
 * those members, or returned something that no longer carried the method, would
 * leave a daemon whose rollovers announce nothing — and it would still compile,
 * because the call sites are inside the SDK.
 *
 * A type pin cannot cover it: services.ts already carries one (`_SdkRuntimeServicesPin`)
 * and it proves the graph is ASSIGNABLE to what startHostServices takes, which is
 * a statement about the declared type rather than about what this composition
 * actually constructed.
 */
import { describe, expect, test } from 'bun:test';
import { getTestRuntimeServices } from '../helpers/runtime-services.ts';

describe('binding-rollover wiring is reachable on this fork\'s composed graph', () => {
  const services = getTestRuntimeServices();

  test('the graph carries the three members the facade wires the rollover through', () => {
    expect(services.sessionBroker).toBeTruthy();
    expect(services.routeBindings).toBeTruthy();
    expect(services.channelPlugins).toBeTruthy();
  });

  test('the session broker accepts the notice sender the facade installs', () => {
    // `setSurfaceNoticeSender` is how a healed binding gets a voice. Absent, a
    // rollover is silent to the person it happened to.
    expect(typeof services.sessionBroker.setSurfaceNoticeSender).toBe('function');
    // The sender the facade installs resolves the binding by route id before
    // delivering, so this is part of the same one path.
    expect(typeof services.routeBindings.getBinding).toBe('function');
  });

  test('the channel plugin registry accepts the one ingress alarm', () => {
    expect(typeof services.channelPlugins.setIngressAlarm).toBe('function');
  });

  test('the reply binder the same helper installs is also reachable', () => {
    // Named here because it is the sibling seam on the same object: if a future
    // SDK bump renamed the notice sender, it would most likely rename this too,
    // and one assertion covering both narrows the search.
    expect(typeof services.sessionBroker.setSurfaceReplyBinder).toBe('function');
  });
});
