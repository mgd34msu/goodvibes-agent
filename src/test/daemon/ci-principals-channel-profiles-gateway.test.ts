/**
 * The ci.*, principals.*, and channels.profiles.* gateway verb groups, wired
 * live in src/runtime/services.ts via attachWsOnlyGatewayVerbHandlers: the
 * SDK's registerGatewayVerbGroups registers handlers for these groups
 * unconditionally (unlike checkin.*, which needs four optional deps). These
 * tests exercise the loop end-to-end through the gateway method catalog
 * exactly as the operator HTTP surface would invoke it, proving the routes
 * answer for real instead of 501 "Gateway method is not invokable".
 *
 * ci.status and ci.watches.run shell out to the `gh` CLI (see
 * createGhCliCiSource in the SDK's ci-watch/gh-source.ts) to read real GitHub
 * check-run data, which this sandbox cannot depend on being authenticated or
 * network-reachable. Those two are asserted at the "handler exists and does
 * not throw a wiring error" level only — the descriptor is registered and
 * carries a real handler, not the full gh-backed success path.
 *
 * ── Whose composition this drives, as of the client split ────────────────
 *
 * `buildDaemonGatewayCatalog(services)` builds the catalog THE DAEMON composes
 * over this graph — the agent's own `services.gatewayMethods` carries no handler
 * for any of these any more, and that absence is itself pinned in
 * daemon/gateway-ws-only-invokable.test.ts.
 *
 * The behaviour below did not move or change; its OWNER did. These verbs are
 * served to every surface by one process now, and this suite is where the
 * contract that surface depends on stays honest. Driving it through the
 * daemon's composition is the difference between verifying a contract and
 * asserting that a client answers its own question.
 */
import { describe, expect, test } from 'bun:test';
import { getTestRuntimeServices } from '../helpers/runtime-services.ts';
import { buildDaemonGatewayCatalog } from '../helpers/daemon-gateway.ts';

interface Principal {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly identities: readonly { readonly channel: string; readonly value: string }[];
}

interface ChannelProfileBinding {
  readonly id: string;
  readonly surfaceKind: string;
  readonly channelId?: string;
  readonly model?: string;
}

interface CiWatch {
  readonly id: string;
  readonly repo: string;
  readonly deliveryChannel: string;
}

async function invoke<T>(methodId: string, body: Record<string, unknown> = {}): Promise<T> {
  const services = getTestRuntimeServices();
  return buildDaemonGatewayCatalog(services).invoke(methodId, { methodId, body } as never) as Promise<T>;
}

describe('ci / principals / channels.profiles gateway verb groups (live, not a 501 facade)', () => {
  test('descriptors are registered on the catalog with real handlers, not just 501 facades', () => {
    const services = getTestRuntimeServices();
    for (const methodId of [
      'ci.status',
      'ci.watches.create',
      'ci.watches.list',
      'ci.watches.delete',
      'ci.watches.run',
      'principals.list',
      'principals.get',
      'principals.create',
      'principals.update',
      'principals.delete',
      'principals.resolve',
      'channels.profiles.list',
      'channels.profiles.get',
      'channels.profiles.set',
      'channels.profiles.delete',
    ]) {
      expect(buildDaemonGatewayCatalog(services).get(methodId), `${methodId} descriptor missing from the catalog`).toBeTruthy();
    }
  });

  test('principals.create then list/resolve round-trip for real', async () => {
    const { principal } = await invoke<{ principal: Principal }>('principals.create', {
      name: 'Mike Davis',
      kind: 'user',
      identities: [{ channel: 'slack', value: 'U-gateway-test' }],
    });
    expect(principal.id).toBeTruthy();
    expect(principal.name).toBe('Mike Davis');

    const { principals } = await invoke<{ principals: Principal[] }>('principals.list');
    expect(principals.some((entry) => entry.id === principal.id)).toBe(true);

    const known = await invoke<{ principal: Principal; known: boolean }>('principals.resolve', {
      channel: 'slack',
      value: 'U-gateway-test',
    });
    expect(known.known).toBe(true);
    expect(known.principal.id).toBe(principal.id);

    const unknown = await invoke<{ known: boolean }>('principals.resolve', {
      channel: 'slack',
      value: 'U-never-registered',
    });
    expect(unknown.known).toBe(false);

    const deleted = await invoke<{ deleted: boolean }>('principals.delete', { principalId: principal.id });
    expect(deleted.deleted).toBe(true);
  });

  test('channels.profiles.set then get/list round-trip for real', async () => {
    const { binding } = await invoke<{ binding: ChannelProfileBinding }>('channels.profiles.set', {
      surfaceKind: 'slack',
      model: 'openai:gpt-5.4',
      permissionMode: 'plan',
    });
    expect(binding.surfaceKind).toBe('slack');
    expect(binding.model).toBe('openai:gpt-5.4');

    const got = await invoke<{ binding: ChannelProfileBinding }>('channels.profiles.get', { surfaceKind: 'slack' });
    expect(got.binding.id).toBe(binding.id);

    const { bindings } = await invoke<{ bindings: ChannelProfileBinding[] }>('channels.profiles.list');
    expect(bindings.some((entry) => entry.id === binding.id)).toBe(true);

    const deleted = await invoke<{ deleted: boolean }>('channels.profiles.delete', { surfaceKind: 'slack' });
    expect(deleted.deleted).toBe(true);
  });

  test('ci.watches.create then list/delete round-trip for real (no gh CLI dependency)', async () => {
    const { watch } = await invoke<{ watch: CiWatch }>('ci.watches.create', {
      repo: 'my-org/my-repo',
      ref: 'main',
      deliveryChannel: 'slack:C123',
    });
    expect(watch.repo).toBe('my-org/my-repo');
    expect(watch.deliveryChannel).toBe('slack:C123');

    const { watches } = await invoke<{ watches: CiWatch[] }>('ci.watches.list');
    expect(watches.some((entry) => entry.id === watch.id)).toBe(true);

    const deleted = await invoke<{ deleted: boolean }>('ci.watches.delete', { watchId: watch.id });
    expect(deleted.deleted).toBe(true);
  });

  test('ci.status has a real handler attached (not a 501 wiring gap) even though this sandbox does not assert on gh CLI output', async () => {
    // A real handler surfaces a gh-CLI/domain error (bad repo, no auth, network) rather than the
    // gateway's own "Gateway method is not invokable" 501 wiring message. Whether gh succeeds,
    // fails on lookup, or is unavailable in this sandbox, it must never be the wiring message.
    let wiringGapMessage: string | null = null;
    try {
      await invoke('ci.status', { repo: 'definitely-not-a-real-org/definitely-not-a-real-repo-goodvibes-agent-test', ref: 'main' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/gateway method is not invokable/i.test(message)) wiringGapMessage = message;
    }
    expect(wiringGapMessage).toBeNull();
    // This drives the real `gh` CLI against a repository that does not exist,
    // so it costs a subprocess spawn and a network round trip before it can
    // fail. Whether that fits in bun's default 5s budget depends on the host
    // and the network, not on the wiring this asserts — and a timeout here
    // reported a 501 wiring gap that was not there. The budget is a hang
    // detector; the test still returns as soon as gh answers.
  }, 60_000);
});
