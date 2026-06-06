import type { OnboardingStep1CapabilityItem, OnboardingSurfaceRecord } from '../runtime/onboarding/index.ts';
import { collectOnboardingSnapshot, deriveStep1Capabilities, deriveStep1CapabilityFlags } from '../runtime/onboarding/index.ts';
import type { CommandContext } from '../input/command-registry.ts';
import { previewAgentWorkspaceTuiSettingsImport } from '../input/agent-workspace-settings.ts';
import { buildProviderAccountSnapshot } from '../panels/provider-account-snapshot.ts';
import { requireLocalUserAuthManager, requirePlatform, requireProvider, requireSecretsManager, requireServiceRegistry, requireShellPaths, requireSubscriptionManager } from '../input/commands/runtime-services.ts';
import type { BrowserControlPosture } from './agent-harness-browser-control.ts';
import { browserControlPosture } from './agent-harness-browser-control.ts';
import { previewHarnessText } from './agent-harness-text.ts';

export interface AgentHarnessSetupArgs {
  readonly setupItemId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

type SetupResolution =
  | { readonly status: 'found'; readonly item: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

type SetupLookupSource = 'setupItemId' | 'target' | 'query';

interface SurfaceRegistryLike {
  syncConfiguredSurfaces(): readonly OnboardingSurfaceRecord[];
}

type SetupPlanStatus = 'ready' | 'blocked' | 'recommended' | 'optional' | 'check';

interface SetupPlanItem {
  readonly id: string;
  readonly label: string;
  readonly status: SetupPlanStatus;
  readonly priority: number;
  readonly blocksAutonomy: boolean;
  readonly reason: string;
  readonly nextAction: string;
  readonly userRoute: string;
  readonly modelRoute: string;
  readonly relatedSetupItemId?: string;
  readonly signals?: readonly string[];
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function safeIso(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

function surfaceRegistry(context: CommandContext): SurfaceRegistryLike | undefined {
  const candidate = (context.platform as { readonly surfaceRegistry?: unknown }).surfaceRegistry;
  if (candidate && typeof candidate === 'object' && 'syncConfiguredSurfaces' in candidate) {
    return candidate as SurfaceRegistryLike;
  }
  return undefined;
}

async function collectSnapshot(context: CommandContext) {
  const registry = surfaceRegistry(context);
  return await collectOnboardingSnapshot({
    config: requirePlatform(context).configManager,
    shellPaths: requireShellPaths(context),
    acknowledgementScope: 'project',
    subscriptions: requireSubscriptionManager(context),
    secrets: requireSecretsManager(context),
    auth: requireLocalUserAuthManager(context),
    services: requireServiceRegistry(context),
    ...(registry ? {
      surfaces: {
        list: () => registry.syncConfiguredSurfaces(),
      },
    } : {}),
    providerAccounts: {
      loadSnapshot: () => buildProviderAccountSnapshot({
        providerModels: requireProvider(context).providerRegistry,
        services: requireServiceRegistry(context),
        subscriptions: requireSubscriptionManager(context),
        environment: {
          hasEnvironmentVariable: (name: string) => Boolean(process.env[name]),
        },
      }),
    },
  });
}

function lookupFromArgs(args: AgentHarnessSetupArgs): { readonly source: SetupLookupSource; readonly input: string } | null {
  const setupItemId = readString(args.setupItemId);
  if (setupItemId) return { source: 'setupItemId', input: setupItemId };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

function itemSearchText(item: OnboardingStep1CapabilityItem): string {
  return [
    item.id,
    item.label,
    item.detail,
    item.selected ? 'selected ready configured enabled' : 'optional attention unselected',
  ].join('\n').toLowerCase();
}

function planSearchText(item: SetupPlanItem): string {
  return [
    item.id,
    item.label,
    item.status,
    item.reason,
    item.nextAction,
    item.userRoute,
    item.modelRoute,
    item.relatedSetupItemId ?? '',
    item.signals?.join('\n') ?? '',
  ].join('\n').toLowerCase();
}

function summarizeLocalBehavior(snapshot: Awaited<ReturnType<typeof collectSnapshot>>): Record<string, unknown> {
  const discovery = snapshot.localBehaviorDiscovery;
  return {
    personas: discovery.personas,
    skills: discovery.skills,
    routines: discovery.routines,
  };
}

function setupProviderSignalIds(snapshot: Awaited<ReturnType<typeof collectSnapshot>>): readonly string[] {
  return [...new Set<string>([
    ...(snapshot.providerAccounts?.providers ?? [])
      .filter((provider) => provider.activeRoute !== 'unconfigured' || provider.oauthReady || provider.pendingLogin)
      .map((provider) => provider.providerId),
    ...snapshot.services.oauthProviderIds,
    ...snapshot.services.services
      .filter((service) => service.hasPrimaryCredential || service.hasPasswordCredential)
      .map((service) => service.providerId),
    ...snapshot.subscriptions.activeProviderIds,
    ...snapshot.subscriptions.pendingProviderIds,
  ])].sort((left, right) => left.localeCompare(right));
}

function capabilityById(items: readonly OnboardingStep1CapabilityItem[], id: OnboardingStep1CapabilityItem['id']): OnboardingStep1CapabilityItem {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing onboarding capability ${id}`);
  return item;
}

function setupPlanStatusForCapability(
  item: OnboardingStep1CapabilityItem,
  fallback: Exclude<SetupPlanStatus, 'check' | 'ready'>,
): SetupPlanStatus {
  return item.selected ? 'ready' : fallback;
}

function hostSetupStatus(snapshot: Awaited<ReturnType<typeof collectSnapshot>>): SetupPlanStatus {
  return snapshot.collectionIssues.some((issue) => issue.area === 'host') ? 'blocked' : 'check';
}

function browserControlSignals(posture: BrowserControlPosture): readonly string[] {
  const signals: string[] = [];
  if (posture.toolMatches.length > 0) signals.push(`tools: ${posture.toolMatches.join(', ')}`);
  if (posture.mcpServers.length > 0) {
    signals.push(...posture.mcpServers.slice(0, 5).map((server) => (
      `mcp:${server.name} ${server.connected ? 'connected' : 'disconnected'} role=${server.role} trust=${server.trustMode} schema=${server.schemaFreshness}`
    )));
  }
  if (signals.length === 0) signals.push('No browser, desktop, computer-use, screenshot, or screen-recording tool is configured.');
  return signals;
}

function settingsImportChangeCount(preview: ReturnType<typeof previewAgentWorkspaceTuiSettingsImport>): number {
  if (!preview) return 0;
  return preview.summary.settingsToImport
    + preview.summary.activeSubscriptionsToImport
    + preview.summary.pendingSubscriptionsToImport;
}

function settingsImportSignals(preview: ReturnType<typeof previewAgentWorkspaceTuiSettingsImport>): readonly string[] {
  if (!preview) return ['Import preview unavailable in this runtime.'];
  return [
    `settings to import: ${preview.summary.settingsToImport}`,
    `active subscriptions to import: ${preview.summary.activeSubscriptionsToImport}`,
    `pending subscriptions to import: ${preview.summary.pendingSubscriptionsToImport}`,
    `unchanged items: ${preview.summary.settingsUnchanged + preview.summary.subscriptionsUnchanged}`,
    `parse issues: ${preview.summary.parseErrors}`,
  ];
}

function buildSetupPlan(
  context: CommandContext,
  snapshot: Awaited<ReturnType<typeof collectSnapshot>>,
  capabilities: readonly OnboardingStep1CapabilityItem[],
): readonly SetupPlanItem[] {
  const providerAccess = capabilityById(capabilities, 'provider-access');
  const agentKnowledge = capabilityById(capabilities, 'agent-knowledge');
  const localBehavior = capabilityById(capabilities, 'local-behavior');
  const communicationChannels = capabilityById(capabilities, 'communication-channels');
  const automationReview = capabilityById(capabilities, 'automation-review');
  const tuiDelegation = capabilityById(capabilities, 'tui-delegation');
  const setupMarkerDone = snapshot.acknowledgements.exists;
  const browserControl = browserControlPosture(context);
  const settingsImport = previewAgentWorkspaceTuiSettingsImport(context);
  const settingsImportChanges = settingsImportChangeCount(settingsImport);

  const plan: SetupPlanItem[] = [
    {
      id: 'connected-host-readiness',
      label: 'Connected host readiness',
      status: hostSetupStatus(snapshot),
      priority: 10,
      blocksAutonomy: true,
      reason: 'Daemon-backed automation, Agent Knowledge, channels, and companion routes need a reachable compatible GoodVibes host.',
      nextAction: 'Run connected-host status, then start, update, or repair the owning GoodVibes host if the live check reports a gap.',
      userRoute: 'Agent Workspace -> Home -> Host compatibility',
      modelRoute: 'agent_harness mode:"connected_host_status"',
      relatedSetupItemId: 'operator-terminal',
      signals: snapshot.collectionIssues.filter((issue) => issue.area === 'host').map((issue) => issue.message),
    },
    {
      id: 'goodvibes-settings-import',
      label: 'GoodVibes settings import',
      status: settingsImport?.summary.parseErrors ? 'check' : settingsImportChanges > 0 ? 'recommended' : 'optional',
      priority: 15,
      blocksAutonomy: false,
      reason: 'Existing GoodVibes TUI settings can seed Agent provider, subscription, behavior, permission, UI, TTS, channel, helper, tool, release, and automation state.',
      nextAction: settingsImportChanges > 0
        ? 'Preview the import, explain the changed setting and subscription counts, then apply only after the user confirms migration.'
        : 'Use this when migrating from GoodVibes TUI; the preview shows whether anything importable is present.',
      userRoute: 'Agent Workspace -> Start -> Import GoodVibes settings',
      modelRoute: 'agent_harness mode:"run_workspace_action" actionId:"import-goodvibes-tui-settings"',
      signals: settingsImportSignals(settingsImport),
    },
    {
      id: 'provider-access',
      label: 'Provider and model access',
      status: setupPlanStatusForCapability(providerAccess, 'blocked'),
      priority: 20,
      blocksAutonomy: true,
      reason: providerAccess.detail,
      nextAction: providerAccess.selected ? 'Review the current model route and provider accounts.' : 'Choose a provider/model route or store a provider credential before relying on assistant turns.',
      userRoute: 'Agent Workspace -> Start -> Choose main model',
      modelRoute: 'agent_harness mode:"model_routing" or mode:"provider_accounts"',
      relatedSetupItemId: providerAccess.id,
      signals: setupProviderSignalIds(snapshot),
    },
    {
      id: 'agent-knowledge',
      label: 'Agent Knowledge readiness',
      status: 'recommended',
      priority: 30,
      blocksAutonomy: false,
      reason: agentKnowledge.detail,
      nextAction: 'Inspect isolated Agent Knowledge status before source-backed memory or research ingest.',
      userRoute: 'Agent Workspace -> Knowledge',
      modelRoute: 'agent_harness mode:"connected_host_status" or agent_knowledge',
      relatedSetupItemId: agentKnowledge.id,
    },
    {
      id: 'local-behavior',
      label: 'Local memory, skills, and routines',
      status: setupPlanStatusForCapability(localBehavior, 'recommended'),
      priority: 40,
      blocksAutonomy: false,
      reason: localBehavior.detail,
      nextAction: localBehavior.selected ? 'Review imported or customized local behavior.' : 'Import discovered behavior files or create the first persona, skill, or routine.',
      userRoute: 'Agent Workspace -> Local Context',
      modelRoute: 'agent_harness mode:"learning_curator" or mode:"workspace_actions" categoryId:"onboarding-context"',
      relatedSetupItemId: localBehavior.id,
    },
    {
      id: 'communication-channels',
      label: 'Communication channels',
      status: setupPlanStatusForCapability(communicationChannels, 'optional'),
      priority: 50,
      blocksAutonomy: false,
      reason: communicationChannels.detail,
      nextAction: communicationChannels.selected ? 'Review channel readiness and delivery safety.' : 'Enable only the channels where the assistant should be reachable.',
      userRoute: 'Agent Workspace -> Channels',
      modelRoute: 'agent_harness mode:"channels"',
      relatedSetupItemId: communicationChannels.id,
      signals: snapshot.surfaces.configuredEnabledKinds,
    },
    {
      id: 'automation-review',
      label: 'Automation review',
      status: setupPlanStatusForCapability(automationReview, 'recommended'),
      priority: 60,
      blocksAutonomy: false,
      reason: automationReview.detail,
      nextAction: 'Review schedules, approvals, routine promotion, and visible autonomy queue controls before ongoing background work.',
      userRoute: 'Agent Workspace -> Personal Ops -> Autonomy queue',
      modelRoute: 'agent_harness mode:"autonomy_queue"',
      relatedSetupItemId: automationReview.id,
    },
    {
      id: 'browser-desktop-control',
      label: 'Browser and desktop control',
      status: browserControl.configured ? 'ready' : 'recommended',
      priority: 65,
      blocksAutonomy: false,
      reason: browserControl.configured
        ? 'A trusted browser, desktop, computer-use, screenshot, or screen-recording route is configured.'
        : 'Live browser navigation, UI testing, screenshots, screen recording, and desktop or device actions need a trusted MCP server or first-class tool before the Agent can perform them.',
      nextAction: browserControl.configured
        ? 'Inspect the browser/desktop execution route before using live UI automation.'
        : 'Configure and review a trusted browser or desktop MCP server, then inspect the execution route before offering live UI automation.',
      userRoute: 'Agent Workspace -> Tools & MCP',
      modelRoute: browserControl.recommendedRoute,
      signals: browserControlSignals(browserControl),
    },
    {
      id: 'build-delegation',
      label: 'Build delegation boundary',
      status: setupPlanStatusForCapability(tuiDelegation, 'optional'),
      priority: 70,
      blocksAutonomy: false,
      reason: tuiDelegation.detail,
      nextAction: 'Use delegation for explicit build, fix, review, isolation, or parallelism work rather than as a setup prerequisite.',
      userRoute: 'Agent Workspace -> Home -> Connected host',
      modelRoute: 'agent_harness mode:"delegation_posture"',
      relatedSetupItemId: tuiDelegation.id,
    },
    {
      id: 'finish-onboarding',
      label: 'Finish onboarding state',
      status: setupMarkerDone ? 'ready' : 'recommended',
      priority: 80,
      blocksAutonomy: false,
      reason: setupMarkerDone ? 'A setup marker already exists for this Agent scope.' : 'No setup marker exists yet, so the user may see first-run guidance again.',
      nextAction: setupMarkerDone ? 'Reopen setup only when changing provider, channel, automation, or local behavior decisions.' : 'Open onboarding, review the selected choices, then apply and close when the assistant is usable.',
      userRoute: 'Agent Workspace -> Start -> Onboarding',
      modelRoute: 'agent_harness mode:"open_ui_surface" surfaceId:"onboarding"',
    },
  ];

  return plan.sort((left, right) => left.priority - right.priority);
}

function describePlanItem(item: SetupPlanItem, includeParameters: boolean): Record<string, unknown> {
  return {
    setupItemId: item.id,
    label: item.label,
    status: item.status,
    priority: item.priority,
    blocksAutonomy: item.blocksAutonomy,
    summary: previewHarnessText(item.reason, includeParameters ? 180 : 96),
    nextAction: previewHarnessText(item.nextAction, includeParameters ? 180 : 96),
    userRoute: previewHarnessText(item.userRoute, includeParameters ? 140 : 96),
    modelRoute: previewHarnessText(item.modelRoute, includeParameters ? 140 : 96),
    ...(item.relatedSetupItemId ? { relatedSetupItemId: item.relatedSetupItemId } : {}),
    ...(item.signals && item.signals.length > 0 ? { signals: item.signals.slice(0, includeParameters ? 10 : 3) } : {}),
    ...(includeParameters ? {
      policy: {
        effect: 'read-only',
        mutation: 'Setup plan rows only point to visible setup, status, settings, and confirmed tool routes.',
      },
    } : {}),
  };
}

function planSummary(plan: readonly SetupPlanItem[]): Record<string, number> {
  return {
    ready: plan.filter((item) => item.status === 'ready').length,
    blocked: plan.filter((item) => item.status === 'blocked').length,
    recommended: plan.filter((item) => item.status === 'recommended').length,
    optional: plan.filter((item) => item.status === 'optional').length,
    check: plan.filter((item) => item.status === 'check').length,
    blocksAutonomy: plan.filter((item) => item.blocksAutonomy && item.status !== 'ready').length,
  };
}

function signalsForItem(
  item: OnboardingStep1CapabilityItem,
  snapshot: Awaited<ReturnType<typeof collectSnapshot>>,
): Record<string, unknown> {
  if (item.id === 'provider-access') {
    return {
      currentRoute: snapshot.providerRouting,
      providerAccounts: {
        providers: snapshot.providerAccounts?.providers.length ?? 0,
        configured: snapshot.providerAccounts?.configuredCount ?? 0,
        issues: snapshot.providerAccounts?.issueCount ?? 0,
      },
      subscriptions: {
        active: snapshot.subscriptions.active.length,
        pending: snapshot.subscriptions.pending.length,
        activeProviderIds: snapshot.subscriptions.activeProviderIds,
        pendingProviderIds: snapshot.subscriptions.pendingProviderIds,
      },
      credentialReferences: snapshot.secrets.records.length,
    };
  }
  if (item.id === 'local-behavior') {
    return summarizeLocalBehavior(snapshot);
  }
  if (item.id === 'communication-channels') {
    return {
      configuredEnabledKinds: snapshot.surfaces.configuredEnabledKinds,
      surfaces: snapshot.surfaces.records.map((surface) => ({
        id: surface.id,
        kind: surface.kind,
        label: surface.label,
        enabled: surface.enabled,
        state: surface.state,
        capabilities: surface.capabilities,
      })),
    };
  }
  if (item.id === 'automation-review') {
    return {
      permissionsMode: snapshot.runtimeDefaults.permissionsMode,
      helperEnabled: snapshot.providerRouting.helperEnabled,
      toolLlmEnabled: snapshot.providerRouting.toolLlmEnabled,
    };
  }
  if (item.id === 'operator-terminal') {
    return {
      display: snapshot.runtimeDefaults.display,
      setupMarker: {
        scope: snapshot.acknowledgements.scope,
        exists: snapshot.acknowledgements.exists,
        updatedAt: safeIso(snapshot.acknowledgements.updatedAt),
        source: snapshot.acknowledgements.source,
        mode: snapshot.acknowledgements.mode ?? null,
      },
      collectionIssues: snapshot.collectionIssues,
    };
  }
  return {
    status: item.selected ? 'covered' : 'available',
  };
}

function describeItem(
  item: OnboardingStep1CapabilityItem,
  snapshot: Awaited<ReturnType<typeof collectSnapshot>>,
  options: {
    readonly includeParameters?: boolean;
    readonly lookup?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return {
    setupItemId: item.id,
    label: item.label,
    selected: item.selected,
    modelRoute: setupItemModelRoute(),
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(options.includeParameters
      ? {
        detail: item.detail,
        signals: signalsForItem(item, snapshot),
        policy: {
          effect: 'read-only',
          values: 'Setup posture returns onboarding readiness, counts, safe setting keys, and route metadata only; secret values and raw provider tokens are never returned.',
          mutation: 'Setup apply, provider auth, local behavior import/create, channel delivery, and starter profile changes stay visible workspace, settings, slash-command, or first-class tool flows.',
        },
        modelAccess: {
          inspectSetup: 'agent_harness mode:"setup_posture"',
          inspectSetupItem: 'agent_harness mode:"setup_item"',
          openOnboarding: 'agent_harness mode:"open_ui_surface" surfaceId:"onboarding" confirm:true explicitUserRequest:"..."',
          setupWorkspace: 'agent_harness mode:"workspace_action" target:"setup"',
          settings: 'agent_harness mode:"settings"; inspect or mutate with get_setting, set_setting, or reset_setting',
          providerRouting: 'agent_harness mode:"model_routing"',
          providerAccounts: 'agent_harness mode:"provider_accounts"',
          channels: 'agent_harness mode:"channels"',
          media: 'agent_harness mode:"media_posture"',
          security: 'agent_harness mode:"security_posture"',
        },
      }
      : {
        summary: previewHarnessText(item.detail),
      }),
  };
}

function setupItemModelRoute(): string {
  return 'agent_harness mode:"setup_item" or mode:"open_ui_surface"';
}

function describeCandidate(item: OnboardingStep1CapabilityItem): Record<string, unknown> {
  return {
    setupItemId: item.id,
    label: item.label,
    selected: item.selected,
    modelRoute: setupItemModelRoute(),
  };
}

export async function setupPostureCatalogStatus(context: CommandContext): Promise<Record<string, unknown>> {
  const snapshot = await collectSnapshot(context);
  const plan = buildSetupPlan(context, snapshot, deriveStep1Capabilities(snapshot));
  return {
    modes: ['setup_posture', 'setup_item'],
    capabilities: deriveStep1Capabilities(snapshot).length,
    planItems: plan.length,
    blockedPlanItems: plan.filter((item) => item.status === 'blocked').length,
    autonomyBlockers: plan.filter((item) => item.blocksAutonomy && item.status !== 'ready').length,
    collectionIssues: snapshot.collectionIssues.length,
    setupMarkerExists: snapshot.acknowledgements.exists,
    readOnly: true,
  };
}

export async function setupPostureSummary(context: CommandContext, args: AgentHarnessSetupArgs): Promise<Record<string, unknown>> {
  const snapshot = await collectSnapshot(context);
  const query = readString(args.query).toLowerCase();
  const includeParameters = args.includeParameters === true;
  const all = deriveStep1Capabilities(snapshot);
  const plan = buildSetupPlan(context, snapshot, all);
  const filtered = all
    .filter((item) => !query || itemSearchText(item).includes(query))
    .slice(0, readLimit(args.limit, 100));
  const filteredPlan = plan
    .filter((item) => !query || planSearchText(item).includes(query))
    .slice(0, readLimit(args.limit, 100));
  return {
    capturedAt: new Date(snapshot.capturedAt).toISOString(),
    setupMarker: {
      scope: snapshot.acknowledgements.scope,
      exists: snapshot.acknowledgements.exists,
      updatedAt: safeIso(snapshot.acknowledgements.updatedAt),
      source: snapshot.acknowledgements.source,
      mode: snapshot.acknowledgements.mode ?? null,
      acceptedCount: Object.values(snapshot.acknowledgements.accepted).filter(Boolean).length,
    },
    summary: {
      capabilities: all.length,
      selectedCapabilities: all.filter((item) => item.selected).length,
      collectionIssues: snapshot.collectionIssues.length,
      services: snapshot.services.total,
      oauthProviders: snapshot.services.oauthProviderIds.length,
      subscriptionSessions: snapshot.subscriptions.active.length,
      pendingSubscriptionSessions: snapshot.subscriptions.pending.length,
      providerAccounts: snapshot.providerAccounts?.providers.length ?? 0,
      providerAccountIssues: snapshot.providerAccounts?.issueCount ?? 0,
      secretsStoredKeys: snapshot.secrets.review.storedKeys,
      secretRecordCount: snapshot.secrets.records.length,
      authUsers: snapshot.auth.snapshot.userCount,
      authSessions: snapshot.auth.snapshot.sessionCount,
      enabledSurfaceKinds: snapshot.surfaces.configuredEnabledKinds.length,
      localBehavior: summarizeLocalBehavior(snapshot),
      capabilityFlags: deriveStep1CapabilityFlags(snapshot),
      readinessPlan: planSummary(plan),
    },
    currentRoute: snapshot.providerRouting,
    issues: snapshot.collectionIssues,
    readinessPlan: filteredPlan.map((item) => describePlanItem(item, includeParameters)),
    nextSetupActions: plan
      .filter((item) => item.status === 'blocked' || item.status === 'check' || item.status === 'recommended')
      .slice(0, 5)
      .map((item) => ({
        setupItemId: item.id,
        label: item.label,
        status: item.status,
        nextAction: previewHarnessText(item.nextAction, 140),
        modelRoute: previewHarnessText(item.modelRoute, 96),
      })),
    capabilities: filtered.map((item) => describeItem(item, snapshot, { includeParameters })),
    returned: filtered.length,
    total: all.length,
    policy: 'Read-only setup/onboarding posture. Apply, import, auth, profile, channel, and setting mutations remain confirmation-gated through visible workspace, settings, slash-command, or first-class tool flows.',
  };
}

export async function describeHarnessSetupItem(context: CommandContext, args: AgentHarnessSetupArgs): Promise<SetupResolution> {
  const lookup = lookupFromArgs(args);
  if (!lookup) {
    return {
      status: 'missing_lookup',
      usage: 'setup_item requires setupItemId, target, or query. Use mode:"setup_posture" to inspect setup item ids.',
    };
  }
  const snapshot = await collectSnapshot(context);
  const items = deriveStep1Capabilities(snapshot);
  const plan = buildSetupPlan(context, snapshot, items);
  const normalized = lookup.input.toLowerCase();
  const exact = items.find((item) => item.id === lookup.input);
  if (exact) return { status: 'found', item: describeItem(exact, snapshot, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'id' } }) };
  const exactPlan = plan.find((item) => item.id === lookup.input);
  if (exactPlan) return { status: 'found', item: { ...describePlanItem(exactPlan, true), lookup: { ...lookup, resolvedBy: 'plan-id' } } };
  const insensitive = items.find((item) => item.id.toLowerCase() === normalized);
  if (insensitive) return { status: 'found', item: describeItem(insensitive, snapshot, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-id' } }) };
  const insensitivePlan = plan.find((item) => item.id.toLowerCase() === normalized);
  if (insensitivePlan) return { status: 'found', item: { ...describePlanItem(insensitivePlan, true), lookup: { ...lookup, resolvedBy: 'case-insensitive-plan-id' } } };
  const searched = items.filter((item) => itemSearchText(item).includes(normalized));
  const searchedPlan = plan.filter((item) => planSearchText(item).includes(normalized));
  if (searched.length === 1 && searchedPlan.length === 0) return { status: 'found', item: describeItem(searched[0]!, snapshot, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'search' } }) };
  if (searched.length === 0 && searchedPlan.length === 1) return { status: 'found', item: { ...describePlanItem(searchedPlan[0]!, true), lookup: { ...lookup, resolvedBy: 'plan-search' } } };
  if (searched.length > 0 || searchedPlan.length > 0) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: [
        ...searched.map(describeCandidate),
        ...searchedPlan.map((item) => describePlanItem(item, false)),
      ].slice(0, 8),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown setup item ${lookup.input}. Use mode:"setup_posture" to inspect setup item ids.`,
  };
}
