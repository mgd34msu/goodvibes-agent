/**
 * Fork-drift firewall: one pinned list of every gateway verb FAMILY landed in
 * SDK 1.6.1's registerGatewayVerbGroups (see the SDK's
 * platform/control-plane/routes/register-gateway-verb-groups.ts), asserting
 * each one registers a real, invokable handler on THIS fork's composed
 * daemon (src/runtime/services.ts) — not just a cataloged-but-unhandled
 * descriptor answering 501 "Gateway method is not invokable" (the regression
 * class gateway-ws-only-invokable.test.ts's header documents).
 *
 * This file is deliberately the SINGLE source of truth for "does family X
 * register live here" across the whole verb surface the SDK ships, so a
 * future SDK bump that silently stops wiring a dep (or a services.ts edit
 * that drops one) fails a release-blocking test instead of shipping a 501
 * nobody notices until a real caller hits it. Deeper functional round-trips
 * for individual families already exist elsewhere (this file intentionally
 * does not duplicate them) — see:
 *   - src/test/daemon/gateway-ws-only-invokable.test.ts: fleet.*, checkpoints.*
 *     (list/create/diff/restore), sessions.search, push.*, fleet.attempts.*,
 *     workspaces.registrations.* and workspaces.resolve.
 *   - src/test/daemon/ci-principals-channel-profiles-gateway.test.ts: ci.*,
 *     principals.*, channels.profiles.*.
 *   - src/test/daemon/checkin-gateway.test.ts: checkin.*.
 *
 * Registration gating (read from register-gateway-verb-groups.ts directly,
 * not inferred): every family below is either (a) ALWAYS registered — no
 * dep gate, constructed internally from shellPaths/config — or (b)
 * registered when a specific dep this fork's services.ts already threads is
 * present. There is no family in the SDK's 1.6.1 verb-group surface this
 * fork deliberately leaves unregistered; the one gap the sweep that wrote
 * this file found (worktrees.setup.run needing `workingDirectory`, which was
 * already in scope in services.ts but not threaded into
 * attachWsOnlyGatewayVerbHandlers) was fixed rather than pinned as an
 * absence — see services.ts's `workingDirectory` param on that call.
 */
import { describe, expect, test } from 'bun:test';
import { assertEveryDescriptorHasHandler } from '@pellux/goodvibes-terminal-shell/conformance';
import { getTestRuntimeServices } from '../helpers/runtime-services.ts';

/**
 * Every family this sweep covers, with why it's live here. Grouped by verb
 * family (not flattened) so a missing method id inside an otherwise-live
 * family is still legible in a failure.
 */
const VERB_FAMILIES: ReadonlyArray<{ readonly family: string; readonly reason: string; readonly methodIds: readonly string[] }> = [
  {
    family: 'workspaces.registrations.* / workspaces.resolve',
    reason: 'Always registered — the SDK constructs the shared WorkspaceRegistrationStore internally from shellPaths.',
    methodIds: ['workspaces.registrations.list', 'workspaces.registrations.add', 'workspaces.registrations.remove', 'workspaces.resolve'],
  },
  {
    family: 'rewind.plan / rewind.apply',
    reason: 'Always registered (files-only rewind over workspaceCheckpointManager, already threaded). The conversation scope is a separate honesty concern — see gateway-rewind-conversation-scope.test.ts.',
    methodIds: ['rewind.plan', 'rewind.apply'],
  },
  {
    family: 'checkpoints.revertHunk(Preview)',
    reason: 'Registered over the same CheckpointsGatewayManager as checkpoints.list/create/diff/restore, already threaded in services.ts.',
    methodIds: ['checkpoints.revertHunkPreview', 'checkpoints.revertHunk'],
  },
  {
    family: 'sessions.changes.get',
    reason: 'Registered over the same CheckpointsGatewayManager (sessionChanges), already threaded in services.ts.',
    methodIds: ['sessions.changes.get'],
  },
  {
    family: 'fleet.attempts.*',
    reason: 'Registered because attemptsController (the orchestration engine) is threaded in services.ts.',
    methodIds: ['fleet.attempts.list', 'fleet.attempts.pick', 'fleet.attempts.judge'],
  },
  {
    family: 'flags.graduation.report',
    reason: 'Always registered — reads the static flag registry + graduation annotations, no runtime dependency.',
    methodIds: ['flags.graduation.report'],
  },
  {
    family: 'cost.attribution.get / quota.fanout.get',
    reason: 'Always registered — CostAttributionService/QuotaWindowTracker are constructed internally; ingestion is enriched when providerRegistry/runtimeBus are present (both are here) but the verbs register regardless.',
    methodIds: ['cost.attribution.get', 'quota.fanout.get'],
  },
  {
    family: 'channels.test.send',
    reason: 'Registered because channelDeliveryRouter is threaded in services.ts.',
    methodIds: ['channels.test.send'],
  },
  {
    family: 'worktrees.setup.run',
    reason: 'Registered because workingDirectory is threaded in services.ts (fixed by this sweep — see file header).',
    methodIds: ['worktrees.setup.run'],
  },
  {
    family: 'skills.*',
    reason: 'Always registered — the SDK constructs a FileSystemSkillStore-backed SkillService internally from shellPaths.',
    methodIds: ['skills.list', 'skills.get', 'skills.create', 'skills.update', 'skills.delete'],
  },
  {
    family: 'principals.*',
    reason: 'Always registered — the SDK constructs the PrincipalRegistry internally from shellPaths. Deeper round-trip: ci-principals-channel-profiles-gateway.test.ts.',
    methodIds: ['principals.list', 'principals.get', 'principals.create', 'principals.update', 'principals.delete', 'principals.resolve'],
  },
  {
    family: 'channels.profiles.*',
    reason: 'Always registered — the SDK constructs the ChannelProfileRegistry internally from shellPaths. Deeper round-trip: ci-principals-channel-profiles-gateway.test.ts.',
    methodIds: ['channels.profiles.list', 'channels.profiles.get', 'channels.profiles.set', 'channels.profiles.delete'],
  },
  {
    family: 'checkin.*',
    reason: 'Registered because channelDeliveryRouter, providerRegistry, automationManager, and sessionLister are ALL threaded in services.ts. Deeper round-trip: checkin-gateway.test.ts.',
    methodIds: ['checkin.config.get', 'checkin.config.set', 'checkin.run', 'checkin.receipts.list'],
  },
  {
    family: 'ci.*',
    reason: 'Always registered (the gh-CLI source and watch store need no dep); notifier/fix-session enrich when channelDeliveryRouter/automationManager are present (both are here). Deeper round-trip: ci-principals-channel-profiles-gateway.test.ts.',
    methodIds: ['ci.status', 'ci.watches.create', 'ci.watches.list', 'ci.watches.delete', 'ci.watches.run'],
  },
];

const ALL_METHOD_IDS = VERB_FAMILIES.flatMap((entry) => entry.methodIds);

describe('gateway verb family parity (fork-drift firewall, SDK 1.6.1)', () => {
  const services = getTestRuntimeServices();

  for (const { family, reason, methodIds } of VERB_FAMILIES) {
    test(`${family}: every descriptor is registered on the catalog (${reason})`, () => {
      for (const methodId of methodIds) {
        expect(services.gatewayMethods.get(methodId), `${methodId} descriptor missing from the catalog`).toBeTruthy();
      }
    });
  }

  test('every pinned descriptor across all families has an attached handler (shipped conformance gate)', () => {
    expect(() =>
      assertEveryDescriptorHasHandler(services.gatewayMethods, { onlyIds: ALL_METHOD_IDS }),
    ).not.toThrow();
  });

  test('no family in this pinned list is silently missing from the catalog entirely', () => {
    const missing = ALL_METHOD_IDS.filter((id) => !services.gatewayMethods.get(id));
    expect(missing).toEqual([]);
  });

  // A handful of families have no deeper round-trip test elsewhere in this
  // repo (rewind files-only, revertHunk, sessions.changes, cost/quota,
  // flags.graduation, skills, worktrees.setup.run) — smoke-invoke each so a
  // real wiring break (not just a missing descriptor) still fails loudly here.

  test('flags.graduation.report invokes end-to-end', async () => {
    const result = await services.gatewayMethods.invoke('flags.graduation.report', {
      methodId: 'flags.graduation.report',
      body: {},
    } as never) as { entries: unknown[]; summary: { total: number } };
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.summary.total).toBe(result.entries.length);
  });

  test('cost.attribution.get and quota.fanout.get invoke end-to-end with no usage yet', async () => {
    const cost = await services.gatewayMethods.invoke('cost.attribution.get', {
      methodId: 'cost.attribution.get',
      body: { window: '24h', dimension: 'provider' },
    } as never) as Record<string, unknown>;
    expect(cost).toBeTruthy();

    const quota = await services.gatewayMethods.invoke('quota.fanout.get', {
      methodId: 'quota.fanout.get',
      body: { provider: 'anthropic', agentCount: 1 },
    } as never) as Record<string, unknown>;
    expect(quota).toBeTruthy();
  });

  test('sessions.changes.get invokes end-to-end (no checkpoints on a fresh runtime)', async () => {
    const result = await services.gatewayMethods.invoke('sessions.changes.get', {
      methodId: 'sessions.changes.get',
      body: { sessionId: 'no-such-session' },
    } as never) as { checkpointCount: number };
    expect(result.checkpointCount).toBe(0);
  });

  test('skills.list invokes end-to-end (empty on a fresh runtime)', async () => {
    const result = await services.gatewayMethods.invoke('skills.list', {
      methodId: 'skills.list',
      body: {},
    } as never) as { skills: unknown[] };
    expect(Array.isArray(result.skills)).toBe(true);
  });

  test('rewind.plan invokes end-to-end; conversation scope is wired but honestly reports nothing to drop for an unregistered session', async () => {
    const result = await services.gatewayMethods.invoke('rewind.plan', {
      methodId: 'rewind.plan',
      body: { sessionId: 'no-such-session', scope: 'both' },
    } as never) as { conversation: { available: boolean; messagesToDrop: number; messagesRemaining: number } | null; warnings: readonly string[] };
    // A conversationRewindPort IS threaded in this fork (see
    // gateway-rewind-conversation-scope.test.ts) — a real conversation store
    // is wired on this runtime, so available reports true. This session was
    // never registered (see registerSessionConversation), so the port
    // resolves no live conversation for it and honestly reports zero
    // messages to drop rather than fabricating a count.
    expect(result.conversation?.available).toBe(true);
    expect(result.conversation?.messagesToDrop).toBe(0);
    expect(result.conversation?.messagesRemaining).toBe(0);
  });

  test('worktrees.setup.run has a real handler attached (not a 501 wiring gap)', async () => {
    let wiringGapMessage: string | null = null;
    try {
      await services.gatewayMethods.invoke('worktrees.setup.run', {
        methodId: 'worktrees.setup.run',
        body: { path: '/no/such/worktree-goodvibes-agent-test' },
      } as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/gateway method is not invokable/i.test(message)) wiringGapMessage = message;
    }
    expect(wiringGapMessage).toBeNull();
  });

  test('checkpoints.revertHunkPreview has a real handler attached (not a 501 wiring gap)', async () => {
    let wiringGapMessage: string | null = null;
    try {
      await services.gatewayMethods.invoke('checkpoints.revertHunkPreview', {
        methodId: 'checkpoints.revertHunkPreview',
        body: { path: 'no-such-file.txt', hunk: '@@ -1 +1 @@\n-a\n+b\n' },
      } as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/gateway method is not invokable/i.test(message)) wiringGapMessage = message;
    }
    expect(wiringGapMessage).toBeNull();
  });
});
