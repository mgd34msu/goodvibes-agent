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
import { assertEveryDescriptorHasHandler } from '@pellux/goodvibes-terminal-shell/conformance';
import { getTestRuntimeServices } from '../helpers/runtime-services.ts';
import { buildDaemonGatewayCatalog } from '../helpers/daemon-gateway.ts';

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
  {
    // Found by the SDK 1.6.1 repack sweep (2026-07-10): registerSessionRuntimeGatewayMethods
    // (platform/control-plane/routes/session-runtime.ts) was landed unconditionally in
    // register-gateway-verb-groups.ts but never added to this pin — the "no family ...
    // deliberately leaves unregistered" claim above was inaccurate for this one family. Not a
    // wiring gap (it needs only configManager/runtimeStore, both always present), just a
    // pre-existing gap in THIS TEST's coverage. Closed here rather than left for a future sweep
    // to rediscover.
    family: 'sessions.permissionMode.* / sessions.contextUsage.get',
    reason: "Always registered — the SDK's createSessionRuntimeControls is built internally from configManager + runtimeStore, both always present in this fork's composition.",
    methodIds: ['sessions.permissionMode.get', 'sessions.permissionMode.set', 'sessions.contextUsage.get'],
  },
  {
    family: 'permissions.rules.*',
    reason: 'Registered because userPermissionRuleStore is threaded in services.ts (durable remembered-approval rules; the same store feeds the PermissionManager in bootstrap-core). Deeper round-trip: gateway-ws-only-invokable.test.ts.',
    methodIds: ['permissions.rules.list', 'permissions.rules.delete'],
  },
  {
    family: 'fleet.graph.get',
    reason: 'Registered because attemptsController (the orchestration engine) is threaded in services.ts and already implements getGraphSnapshot(workstreamId) structurally — the SAME dep fleet.attempts.* uses. Deeper round-trip: gateway-ws-only-invokable.test.ts.',
    methodIds: ['fleet.graph.get'],
  },
  {
    family: 'sessions.toolCalls.cancel / sessions.queuedMessages.*',
    reason: 'Always registered — createSessionRuntimeControls is built internally from configManager + runtimeStore; the sessionLiveTurnControls holder (bound to this repo\'s Orchestrator in bootstrap.ts) makes the verbs act on the live turn instead of refusing LIVE_TURN_CONTROLS_UNAVAILABLE.',
    methodIds: ['sessions.toolCalls.cancel', 'sessions.queuedMessages.list', 'sessions.queuedMessages.edit', 'sessions.queuedMessages.delete'],
  },
  {
    // The owner profile: one Markdown file at daemon scope, and the nine verbs
    // the Agent's `profile` tool and `owner-profile` CLI both call. Registered
    // by composeOwnerProfile inside registerGatewayVerbGroups, gated only on
    // configManager, which this fork always threads — so the tool's in-process
    // route is live here and never silently degrades to the connected host.
    family: 'profile.*',
    reason: "Always registered — the SDK's composeOwnerProfile builds the OwnerProfileStore internally from configManager (its enablement and file-path settings) plus the resolved daemon home. The key names are deliberately not spelled here: this repo has no consumer for them, and naming them would put two permanently unverifiable rows into the verification ledger's settings denominator.",
    methodIds: [
      'profile.read', 'profile.get', 'profile.person', 'profile.provenance',
      'profile.set', 'profile.append', 'profile.forget', 'profile.undo', 'profile.status',
    ],
  },
  {
    // Occasions: dates in the owner's life that need an action, and the sixteen
    // verbs the Agent's `occasions` tool and its nudge surface both call.
    // Registered by installOccasions INSIDE composeOwnerProfile (see the SDK's
    // routes/owner-profile-composition.ts, which passes the whole verb-group dep
    // bag straight through as OccasionsInstallDeps) — so it is gated on the same
    // configManager the profile family is, plus shellPaths for the state file's
    // path. Both are always threaded here, which is why this needed no new dep
    // in services.ts: channelDeliveryRouter and disposal are the only other
    // pieces the composition reads and both were already passed for other
    // families. The key names are deliberately not spelled here for the same
    // reason profile.* does not spell its own — see that entry's note.
    family: 'occasions.*',
    reason: "Always registered — the SDK's installOccasions is composed over the same OwnerProfileStore composeOwnerProfile builds from configManager, with the machine-owned state file resolved from shellPaths. No dep threading was needed for this family.",
    methodIds: [
      'occasions.list', 'occasions.pending', 'occasions.state', 'occasions.sweep',
      'occasions.propose', 'occasions.confirm', 'occasions.remove', 'occasions.answer',
      'occasions.interview.get', 'occasions.interview.answer', 'occasions.interview.record',
      'occasions.gifts', 'occasions.conflict.resolve',
      'occasions.plans.list', 'occasions.plans.propose', 'occasions.plans.confirm',
    ],
  },
  {
    family: 'power.status.get / power.keepAwake.set',
    reason: 'Registered because powerManager is threaded in services.ts (wireRuntimePower — sleep ownership, keep-awake toggle). Deeper round-trip: gateway-power.test.ts.',
    methodIds: ['power.status.get', 'power.keepAwake.set'],
  },
];

const ALL_METHOD_IDS = VERB_FAMILIES.flatMap((entry) => entry.methodIds);

describe('gateway verb family parity (fork-drift firewall, SDK 1.6.1)', () => {
  const services = getTestRuntimeServices();

  for (const { family, reason, methodIds } of VERB_FAMILIES) {
    test(`${family}: every descriptor is registered on the catalog (${reason})`, () => {
      for (const methodId of methodIds) {
        expect(buildDaemonGatewayCatalog(services).get(methodId), `${methodId} descriptor missing from the catalog`).toBeTruthy();
      }
    });
  }

  test('every pinned descriptor across all families has an attached handler (shipped conformance gate)', () => {
    expect(() =>
      assertEveryDescriptorHasHandler(buildDaemonGatewayCatalog(services), { onlyIds: ALL_METHOD_IDS }),
    ).not.toThrow();
  });

  test('no family in this pinned list is silently missing from the catalog entirely', () => {
    const missing = ALL_METHOD_IDS.filter((id) => !buildDaemonGatewayCatalog(services).get(id));
    expect(missing).toEqual([]);
  });

  // A handful of families have no deeper round-trip test elsewhere in this
  // repo (rewind files-only, revertHunk, sessions.changes, cost/quota,
  // flags.graduation, skills, worktrees.setup.run) — smoke-invoke each so a
  // real wiring break (not just a missing descriptor) still fails loudly here.

  test('flags.graduation.report invokes end-to-end', async () => {
    const result = await buildDaemonGatewayCatalog(services).invoke('flags.graduation.report', {
      methodId: 'flags.graduation.report',
      body: {},
    } as never) as { entries: unknown[]; summary: { total: number } };
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.summary.total).toBe(result.entries.length);
  });

  test('cost.attribution.get and quota.fanout.get invoke end-to-end with no usage yet', async () => {
    const cost = await buildDaemonGatewayCatalog(services).invoke('cost.attribution.get', {
      methodId: 'cost.attribution.get',
      body: { window: '24h', dimension: 'provider' },
    } as never) as Record<string, unknown>;
    expect(cost).toBeTruthy();

    const quota = await buildDaemonGatewayCatalog(services).invoke('quota.fanout.get', {
      methodId: 'quota.fanout.get',
      body: { provider: 'anthropic', agentCount: 1 },
    } as never) as Record<string, unknown>;
    expect(quota).toBeTruthy();
  });

  test('sessions.changes.get invokes end-to-end (no checkpoints on a fresh runtime)', async () => {
    const result = await buildDaemonGatewayCatalog(services).invoke('sessions.changes.get', {
      methodId: 'sessions.changes.get',
      body: { sessionId: 'no-such-session' },
    } as never) as { checkpointCount: number };
    expect(result.checkpointCount).toBe(0);
  });

  test('skills.list invokes end-to-end (empty on a fresh runtime)', async () => {
    const result = await buildDaemonGatewayCatalog(services).invoke('skills.list', {
      methodId: 'skills.list',
      body: {},
    } as never) as { skills: unknown[] };
    expect(Array.isArray(result.skills)).toBe(true);
  });

  test('rewind.plan invokes end-to-end; conversation scope is wired but honestly reports nothing to drop for an unregistered session', async () => {
    const result = await buildDaemonGatewayCatalog(services).invoke('rewind.plan', {
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
      await buildDaemonGatewayCatalog(services).invoke('worktrees.setup.run', {
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
      await buildDaemonGatewayCatalog(services).invoke('checkpoints.revertHunkPreview', {
        methodId: 'checkpoints.revertHunkPreview',
        body: { path: 'no-such-file.txt', hunk: '@@ -1 +1 @@\n-a\n+b\n' },
      } as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/gateway method is not invokable/i.test(message)) wiringGapMessage = message;
    }
    expect(wiringGapMessage).toBeNull();
  });

  test('occasions.pending invokes end-to-end and answers with nothing outstanding on a fresh runtime', async () => {
    const result = await buildDaemonGatewayCatalog(services).invoke('occasions.pending', {
      methodId: 'occasions.pending',
      body: {},
    } as never) as { today: string; nudge: unknown; conflicts: unknown[]; interviews: unknown[] };
    // A real store answered, not a 501: an empty profile has nothing open.
    expect(typeof result.today).toBe('string');
    expect(result.nudge).toBeNull();
    expect(result.conflicts).toEqual([]);
    expect(result.interviews).toEqual([]);
  });

  test('occasions.state discloses a real machine-owned store, not a fabricated snapshot', async () => {
    const result = await buildDaemonGatewayCatalog(services).invoke('occasions.state', {
      methodId: 'occasions.state',
      body: {},
    } as never) as { path: string; acknowledgements: number; openItems: number; corruption: string | null };
    // The path proves the store was resolved from this runtime's own shellPaths
    // rather than defaulted, which is the half of installOccasions' wiring the
    // descriptor check above cannot see.
    expect(result.path.endsWith('occasions-state.json')).toBe(true);
    expect(result.acknowledgements).toBe(0);
    expect(result.openItems).toBe(0);
    expect(result.corruption).toBeNull();
  });

  test('occasions.answer refuses an unknown occasion honestly rather than recording a phantom answer', async () => {
    const result = await buildDaemonGatewayCatalog(services).invoke('occasions.answer', {
      methodId: 'occasions.answer',
      body: { occasionId: 'no-such-occasion', answer: 'yes' },
    } as never) as { ok: boolean; reason: string | null; interview: unknown };
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.interview).toBeNull();
  });

  test('sessions.contextUsage.get invokes end-to-end against the local runtime alias', async () => {
    const result = await buildDaemonGatewayCatalog(services).invoke('sessions.contextUsage.get', {
      methodId: 'sessions.contextUsage.get',
      // 'runtime' is the stable local-session alias createSessionRuntimeControls
      // accepts for the daemon's own runtime, addressable before a surface knows
      // the real store session id (see session-runtime.js's own doc comment).
      body: { sessionId: 'runtime' },
    } as never) as { sessionId: string; estimated: boolean; contextWindow: number | null };
    expect(result.sessionId).toBe('runtime');
    // The estimator's own honesty flag — never claims a provider-measured count.
    expect(result.estimated).toBe(true);
  });

  test('sessions.permissionMode.get/set round-trip against the local runtime alias', async () => {
    const before = await buildDaemonGatewayCatalog(services).invoke('sessions.permissionMode.get', {
      methodId: 'sessions.permissionMode.get',
      body: { sessionId: 'runtime' },
    } as never) as { sessionId: string; mode: string };
    expect(before.sessionId).toBe('runtime');
    expect(['normal', 'auto', 'plan', 'accept-edits', 'custom']).toContain(before.mode);

    const set = await buildDaemonGatewayCatalog(services).invoke('sessions.permissionMode.set', {
      methodId: 'sessions.permissionMode.set',
      body: { sessionId: 'runtime', mode: 'plan' },
    } as never) as { sessionId: string; mode: string; previousMode: string };
    expect(set.mode).toBe('plan');
    expect(set.previousMode).toBe(before.mode);
  });
});
