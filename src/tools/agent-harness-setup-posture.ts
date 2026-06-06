import { getOperatorContract } from '@pellux/goodvibes-sdk/contracts';
import type { OnboardingStep1CapabilityItem, OnboardingSurfaceRecord } from '../runtime/onboarding/index.ts';
import { collectOnboardingSnapshot, deriveStep1Capabilities, deriveStep1CapabilityFlags } from '../runtime/onboarding/index.ts';
import type { CommandContext } from '../input/command-registry.ts';
import { previewAgentWorkspaceTuiSettingsImport } from '../input/agent-workspace-settings.ts';
import { buildProviderAccountSnapshot } from '../panels/provider-account-snapshot.ts';
import { requireLocalUserAuthManager, requirePlatform, requireProvider, requireSecretsManager, requireServiceRegistry, requireShellPaths, requireSubscriptionManager } from '../input/commands/runtime-services.ts';
import type { BrowserControlPosture } from './agent-harness-browser-control.ts';
import { browserControlPosture } from './agent-harness-browser-control.ts';
import { localModelCookbook } from './agent-harness-model-routing.ts';
import { previewHarnessText } from './agent-harness-text.ts';
import { buildCliServicePosture, type CliServicePosture } from '../cli/service-posture.ts';
import { connectedHostOperatorTokenFingerprint, readConnectedHostOperatorToken } from '../runtime/connected-host-auth.ts';

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
type SetupRepairCardState = 'available' | 'requires-live-host' | 'missing';
type SetupRepairCardEffect = 'read-only' | 'confirmed-effect';
type SetupRepairRecommendation = 'recommended' | 'inspect-first' | 'not-needed' | 'unavailable';
type SetupServiceProbeStatus = 'reachable' | 'unreachable' | 'not-enabled' | 'not-probed';

interface OperatorContractMethod {
  readonly id: string;
}

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
  readonly repairCards?: readonly SetupRepairCard[];
  readonly bootstrapPlan?: SetupBootstrapPlan;
  readonly serviceProbe?: SetupServiceProbe;
  readonly authPosture?: SetupConnectedHostAuthPosture;
  readonly localModelReadiness?: Record<string, unknown>;
}

interface SetupRepairCard {
  readonly id: string;
  readonly label: string;
  readonly state: SetupRepairCardState;
  readonly effect: SetupRepairCardEffect;
  readonly methodId?: string;
  readonly modelRoute?: string;
  readonly userRoute: string;
  readonly prerequisite?: string;
  readonly recommendation: SetupRepairRecommendation;
  readonly liveEvidence?: SetupRepairLiveEvidence;
  readonly recommendedWhen: string;
  readonly safety: string;
}

interface SetupRepairLiveEvidence {
  readonly probeStatus: SetupServiceProbeStatus;
  readonly summary: string;
}

interface SetupServiceProbe {
  readonly status: SetupServiceProbeStatus;
  readonly endpointId: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly binding: string;
  readonly diagnosticRoute: string;
  readonly issues: readonly string[];
}

interface SetupConnectedHostAuthPosture {
  readonly owner: 'connected-host';
  readonly operatorToken: {
    readonly present: boolean;
    readonly usable: boolean;
    readonly path: string;
    readonly fingerprint?: string;
    readonly error?: string;
  };
  readonly compatibilityAuth: {
    readonly userStorePath: string;
    readonly userStorePresent: boolean;
    readonly bootstrapCredentialPath: string;
    readonly bootstrapCredentialPresent: boolean;
    readonly users: number;
    readonly sessions: number;
  };
  readonly routes: {
    readonly reviewCommand: string;
    readonly connectedHostStatus: string;
    readonly pairingPosture: string;
  };
}

interface SetupBootstrapStep {
  readonly id: string;
  readonly label: string;
  readonly purpose: string;
  readonly commands: readonly string[];
  readonly expected: string;
  readonly fallback?: string;
}

interface SetupBootstrapPlan {
  readonly status: 'recommended' | 'optional';
  readonly source: string;
  readonly recommendedWhen: string;
  readonly steps: readonly SetupBootstrapStep[];
  readonly reconnectRoutes: Record<string, string>;
  readonly policy: string;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map((entry) => readString(entry)).filter(Boolean) : [];
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function quoteRouteValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function operatorMethodRoute(methodId: string, confirmed: boolean): string {
  return `agent_operator_method methodId:"${quoteRouteValue(methodId)}" input:{}${confirmed ? ' confirm:true explicitUserRequest:"..."' : ''}`;
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

function setupServiceRuntime(context: CommandContext) {
  const shellPaths = requireShellPaths(context);
  return {
    configManager: requirePlatform(context).configManager,
    workingDirectory: shellPaths.workingDirectory,
    homeDirectory: shellPaths.homeDirectory,
  };
}

async function collectServicePosture(context: CommandContext): Promise<CliServicePosture | null> {
  try {
    return await buildCliServicePosture(setupServiceRuntime(context), {
      probe: true,
      logTailBytes: 0,
    });
  } catch {
    return null;
  }
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
    JSON.stringify(item.localModelReadiness ?? {}),
    item.repairCards?.map((card) => [
      card.id,
      card.label,
      card.state,
      card.effect,
      card.methodId ?? '',
      card.modelRoute ?? '',
      card.prerequisite ?? '',
      card.recommendation,
      card.liveEvidence?.probeStatus ?? '',
      card.liveEvidence?.summary ?? '',
      card.recommendedWhen,
      card.safety,
    ].join(' ')).join('\n') ?? '',
    JSON.stringify(item.serviceProbe ?? {}),
    JSON.stringify(item.authPosture ?? {}),
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

function connectedHostServiceProbe(posture: CliServicePosture | null): SetupServiceProbe {
  const endpoint = posture?.endpoints.find((candidate) => candidate.id === 'controlPlane');
  if (!posture || !endpoint) {
    return {
      status: 'not-probed',
      endpointId: 'controlPlane',
      label: 'runtime connection',
      enabled: false,
      binding: '(unavailable)',
      diagnosticRoute: 'agent_harness mode:"service_posture" includeParameters:true',
      issues: ['Service posture probe is unavailable in this runtime.'],
    };
  }
  const binding = `${endpoint.binding.host}:${endpoint.binding.port}`;
  const status: SetupServiceProbeStatus = !endpoint.enabled
    ? 'not-enabled'
    : endpoint.reachable === true
      ? 'reachable'
      : endpoint.reachable === false
        ? 'unreachable'
        : 'not-probed';
  return {
    status,
    endpointId: endpoint.id,
    label: endpoint.label,
    enabled: endpoint.enabled,
    binding,
    diagnosticRoute: 'agent_harness mode:"service_posture" endpointId:"controlPlane" includeParameters:true',
    issues: posture.issues,
  };
}

function serviceProbeSignal(probe: SetupServiceProbe): string {
  return `runtime connection probe: ${probe.status} ${probe.binding}`;
}

function repairLiveEvidence(probe: SetupServiceProbe, summary: string): SetupRepairLiveEvidence {
  return {
    probeStatus: probe.status,
    summary,
  };
}

function lifecycleRepairRecommendation(probe: SetupServiceProbe): SetupRepairRecommendation {
  if (probe.status === 'reachable') return 'not-needed';
  if (probe.status === 'unreachable') return 'inspect-first';
  return 'inspect-first';
}

function hostSetupStatus(snapshot: Awaited<ReturnType<typeof collectSnapshot>>, probe: SetupServiceProbe): SetupPlanStatus {
  if (snapshot.collectionIssues.some((issue) => issue.area === 'host')) return 'blocked';
  if (probe.status === 'unreachable') return 'blocked';
  return 'check';
}

function connectedHostAuthPosture(
  context: CommandContext,
  snapshot: Awaited<ReturnType<typeof collectSnapshot>>,
): SetupConnectedHostAuthPosture {
  const shellPaths = requireShellPaths(context);
  const token = readConnectedHostOperatorToken(shellPaths.homeDirectory);
  const usable = Boolean(token.token);
  return {
    owner: 'connected-host',
    operatorToken: {
      present: token.present,
      usable,
      path: token.path,
      ...(token.token ? { fingerprint: connectedHostOperatorTokenFingerprint(token.token) } : {}),
      ...(token.error ? { error: previewHarnessText(token.error, 120) } : {}),
    },
    compatibilityAuth: {
      userStorePath: snapshot.auth.snapshot.userStorePath,
      userStorePresent: snapshot.auth.snapshot.persisted,
      bootstrapCredentialPath: snapshot.auth.snapshot.bootstrapCredentialPath,
      bootstrapCredentialPresent: snapshot.auth.snapshot.bootstrapCredentialPresent,
      users: snapshot.auth.snapshot.userCount,
      sessions: snapshot.auth.snapshot.sessionCount,
    },
    routes: {
      reviewCommand: '/auth review',
      connectedHostStatus: 'agent_harness mode:"connected_host_status" includeParameters:true',
      pairingPosture: 'agent_harness mode:"pairing_posture" includeParameters:true',
    },
  };
}

function connectedHostAuthStatus(posture: SetupConnectedHostAuthPosture): SetupPlanStatus {
  if (!posture.operatorToken.usable) return 'blocked';
  if (posture.compatibilityAuth.bootstrapCredentialPresent) return 'check';
  return 'ready';
}

function connectedHostAuthNextAction(posture: SetupConnectedHostAuthPosture): string {
  if (!posture.operatorToken.present) {
    return 'Pair or provision connected-host operator access through the owning GoodVibes host, then rerun auth review and connected-host status.';
  }
  if (!posture.operatorToken.usable) {
    return 'Repair or replace the connected-host operator token through the owning GoodVibes host, then rerun auth review.';
  }
  if (posture.compatibilityAuth.bootstrapCredentialPresent) {
    return 'Review auth status and clear or rotate the compatibility bootstrap credential through the owning GoodVibes host if it is no longer needed.';
  }
  return 'Verify the token against connected-host status and Agent Knowledge readiness before relying on protected daemon routes.';
}

function connectedHostAuthSignals(posture: SetupConnectedHostAuthPosture): readonly string[] {
  return [
    `operator token: ${posture.operatorToken.usable ? 'usable' : posture.operatorToken.present ? 'present but unusable' : 'missing'} (${posture.operatorToken.path})`,
    ...(posture.operatorToken.fingerprint ? [`operator token fingerprint: ${posture.operatorToken.fingerprint}`] : []),
    ...(posture.operatorToken.error ? [`operator token parse error: ${posture.operatorToken.error}`] : []),
    `compatibility auth users: ${posture.compatibilityAuth.users}`,
    `compatibility auth sessions: ${posture.compatibilityAuth.sessions}`,
    `bootstrap credential: ${posture.compatibilityAuth.bootstrapCredentialPresent ? 'present' : 'missing'} (${posture.compatibilityAuth.bootstrapCredentialPath})`,
  ];
}

function browserControlSignals(posture: BrowserControlPosture): readonly string[] {
  const signals: string[] = [];
  if (posture.toolMatches.length > 0) signals.push(`tools: ${posture.toolMatches.join(', ')}`);
  if (posture.mcpServers.length > 0) {
    signals.push(...posture.mcpServers.slice(0, 5).map((server) => (
      `mcp:${server.name} ${server.connected ? 'connected' : 'disconnected'} ${server.readiness} role=${server.role} trust=${server.trustMode} schema=${server.schemaFreshness}`
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

function topLocalModelRecipe(cookbook: Record<string, unknown>): Record<string, unknown> {
  const recipes = Array.isArray(cookbook.recipes) ? cookbook.recipes.map(readRecord) : [];
  return recipes[0] ?? {};
}

function localModelSetupReadiness(cookbook: Record<string, unknown>): Record<string, unknown> {
  const detected = readRecord(cookbook.detected);
  const topRecipe = topLocalModelRecipe(cookbook);
  const setupPlan = readRecord(topRecipe.setupPlan);
  const readiness = readRecord(topRecipe.readiness);
  return {
    cookbookStatus: readString(cookbook.status),
    recommendation: readString(cookbook.recommendation),
    detected: {
      stacks: readStringArray(detected.stacks),
      providerIds: readStringArray(detected.providerIds),
      modelRoutes: readStringArray(detected.modelRoutes),
    },
    topRecipe: {
      id: readString(topRecipe.id),
      label: readString(topRecipe.label),
      fitScore: topRecipe.fitScore ?? null,
      fitLevel: topRecipe.fitLevel ?? null,
      readinessScore: topRecipe.readinessScore ?? null,
      readinessLevel: topRecipe.readinessLevel ?? null,
      detected: topRecipe.detected === true,
      setupStatus: readString(setupPlan.status),
      missingSignals: Array.isArray(readiness.missingSignals) ? readiness.missingSignals.slice(0, 3) : [],
    },
    readinessRubric: cookbook.readinessRubric ?? null,
    benchmarkHistory: cookbook.benchmarkHistory ?? null,
    nextActions: readStringArray(cookbook.nextActions).slice(0, 4),
    inspectRoute: 'agent_harness mode:"model_routing" query:"local" includeParameters:true',
    inspectRecipeRoute: 'agent_harness mode:"model_route" modelRouteId:"local-model-cookbook"',
  };
}

function localModelSetupSignals(cookbook: Record<string, unknown>): readonly string[] {
  const readiness = localModelSetupReadiness(cookbook);
  const detected = readRecord(readiness.detected);
  const topRecipe = readRecord(readiness.topRecipe);
  const stacks = readStringArray(detected.stacks);
  const routes = readStringArray(detected.modelRoutes);
  const providerIds = readStringArray(detected.providerIds);
  const signals = [
    `cookbook status: ${readString(readiness.cookbookStatus) || 'unknown'}`,
    stacks.length > 0 ? `detected stacks: ${stacks.join(', ')}` : 'detected stacks: none',
    routes.length > 0 ? `detected model routes: ${routes.join(', ')}` : providerIds.length > 0 ? `detected providers: ${providerIds.join(', ')}` : 'detected local routes: none',
    `top recipe: ${readString(topRecipe.label) || 'unknown'} readiness=${topRecipe.readinessScore ?? 'unknown'} fit=${topRecipe.fitScore ?? 'unknown'}`,
  ];
  return signals;
}

function localModelSetupStatus(cookbook: Record<string, unknown>): SetupPlanStatus {
  return readString(cookbook.status) === 'detected-local-route' ? 'ready' : 'recommended';
}

function localModelSetupNextAction(cookbook: Record<string, unknown>): string {
  const readiness = localModelSetupReadiness(cookbook);
  const topRecipe = readRecord(readiness.topRecipe);
  if (readString(cookbook.status) === 'detected-local-route') {
    return 'Inspect detected local model readiness, then run the benchmark prompt before making a local route the default.';
  }
  const topLabel = readString(topRecipe.label) || 'the top local recipe';
  return `Review ${topLabel} setupPlan, start the local server outside Agent, refresh models, then run the benchmark prompt before changing the default route.`;
}

function operatorMethodIds(): ReadonlySet<string> {
  const contract = getOperatorContract();
  const methods = Array.isArray(contract.operator?.methods)
    ? contract.operator.methods as OperatorContractMethod[]
    : [];
  return new Set(methods.map((method) => method.id).filter(Boolean));
}

function setupRepairCard(
  methodIds: ReadonlySet<string>,
  options: {
    readonly id: string;
    readonly label: string;
    readonly methodId?: string;
    readonly effect: SetupRepairCardEffect;
    readonly userRoute: string;
    readonly prerequisite?: string;
    readonly recommendation?: SetupRepairRecommendation;
    readonly liveEvidence?: SetupRepairLiveEvidence;
    readonly recommendedWhen: string;
    readonly safety: string;
    readonly liveHostRequired?: boolean;
  },
): SetupRepairCard {
  const methodPresent = options.methodId ? methodIds.has(options.methodId) : true;
  const state: SetupRepairCardState = !methodPresent
    ? 'missing'
    : options.liveHostRequired
      ? 'requires-live-host'
      : 'available';
  return {
    id: options.id,
    label: options.label,
    state,
    effect: options.effect,
    ...(options.methodId ? { methodId: options.methodId } : {}),
    ...(options.methodId && methodPresent ? { modelRoute: operatorMethodRoute(options.methodId, options.effect === 'confirmed-effect') } : {}),
    userRoute: options.userRoute,
    ...(options.prerequisite ? { prerequisite: options.prerequisite } : {}),
    recommendation: !methodPresent || state === 'requires-live-host' ? 'unavailable' : options.recommendation ?? 'inspect-first',
    ...(options.liveEvidence ? { liveEvidence: options.liveEvidence } : {}),
    recommendedWhen: options.recommendedWhen,
    safety: options.safety,
  };
}

function connectedHostRepairCards(
  snapshot: Awaited<ReturnType<typeof collectSnapshot>>,
  probe: SetupServiceProbe,
): readonly SetupRepairCard[] {
  const methodIds = operatorMethodIds();
  const hostIssue = snapshot.collectionIssues.some((issue) => issue.area === 'host');
  const liveHostPrerequisite = hostIssue
    ? 'Run connected-host status first; confirmed service methods require a reachable compatible operator endpoint and usable token.'
    : 'Requires a reachable compatible operator endpoint and usable token.';
  const statusRecommendation: SetupRepairRecommendation = probe.status === 'unreachable'
    ? 'recommended'
    : probe.status === 'reachable'
      ? 'not-needed'
      : 'inspect-first';
  const postureRecommendation: SetupRepairRecommendation = probe.status === 'unreachable' || probe.issues.length > 0
    ? 'recommended'
    : probe.status === 'reachable'
      ? 'not-needed'
      : 'inspect-first';
  const lifecycleRecommendation = lifecycleRepairRecommendation(probe);
  return [
    {
      id: 'connected-host-status',
      label: 'Inspect connected-host status',
      state: 'available',
      effect: 'read-only',
      modelRoute: 'agent_harness mode:"connected_host_status" includeParameters:true',
      userRoute: 'Agent Workspace -> Home -> Host compatibility',
      recommendation: statusRecommendation,
      liveEvidence: repairLiveEvidence(probe, probe.status === 'reachable'
        ? 'Runtime endpoint is reachable; use connected-host status when token, compatibility, or Knowledge readiness still needs review.'
        : probe.status === 'unreachable'
          ? 'Runtime endpoint is enabled but not reachable; inspect connected-host status and service posture before any lifecycle mutation.'
          : 'Runtime endpoint reachability is not proven; inspect connected-host status before lifecycle mutation.'),
      recommendedWhen: 'Use first for every host setup or repair question.',
      safety: 'Read-only diagnostic; returns redacted token posture and route readiness.',
    },
    {
      id: 'service-posture',
      label: 'Inspect service posture',
      state: 'available',
      effect: 'read-only',
      modelRoute: 'agent_harness mode:"service_posture" includeParameters:true',
      userRoute: 'Agent Workspace -> Home -> Doctor diagnostics',
      recommendation: postureRecommendation,
      liveEvidence: repairLiveEvidence(probe, probe.issues.length > 0
        ? `Service posture reports ${probe.issues.length} issue(s); inspect endpoint binding, reachability, and logs before mutation.`
        : probe.status === 'reachable'
          ? 'Runtime endpoint is reachable and service posture has no current probe issue.'
          : 'Inspect endpoint binding, reachability, and logs before choosing a lifecycle action.'),
      recommendedWhen: 'Use when endpoints, bind addresses, ports, logs, or listener exposure may be the blocker.',
      safety: 'Read-only diagnostic; probes endpoints only when requested with includeParameters.',
    },
    setupRepairCard(methodIds, {
      id: 'service-status',
      label: 'Read service install/runtime status',
      methodId: 'services.status',
      effect: 'read-only',
      userRoute: 'Agent Workspace -> Home -> Host compatibility',
      prerequisite: liveHostPrerequisite,
      recommendation: statusRecommendation,
      liveEvidence: repairLiveEvidence(probe, probe.status === 'reachable'
        ? 'Runtime endpoint is reachable; service status is optional unless the user is auditing install/autostart posture.'
        : 'Read service status before deciding whether install, start, or restart is actually needed.'),
      recommendedWhen: 'Use when the daemon is reachable and the user needs install/autostart/running posture.',
      safety: 'Read-only daemon method.',
      liveHostRequired: hostIssue,
    }),
    setupRepairCard(methodIds, {
      id: 'service-install',
      label: 'Install service',
      methodId: 'services.install',
      effect: 'confirmed-effect',
      userRoute: 'Connected-host service control',
      prerequisite: liveHostPrerequisite,
      recommendation: lifecycleRecommendation,
      liveEvidence: repairLiveEvidence(probe, probe.status === 'reachable'
        ? 'Runtime endpoint is already reachable; install is not recommended without service status evidence.'
        : 'Install is not recommended from endpoint reachability alone; require service status to prove the service is not installed.'),
      recommendedWhen: 'Use only when service status says the platform service is not installed and the user explicitly asks to install it.',
      safety: 'Confirmed service mutation; no uninstall or stop action is included in first-run setup.',
      liveHostRequired: hostIssue,
    }),
    setupRepairCard(methodIds, {
      id: 'service-start',
      label: 'Start service',
      methodId: 'services.start',
      effect: 'confirmed-effect',
      userRoute: 'Connected-host service control',
      prerequisite: liveHostPrerequisite,
      recommendation: lifecycleRecommendation,
      liveEvidence: repairLiveEvidence(probe, probe.status === 'reachable'
        ? 'Runtime endpoint is already reachable; start is not recommended without service status evidence.'
        : 'Start is not recommended from endpoint reachability alone; require service status to prove the service is installed but stopped.'),
      recommendedWhen: 'Use only when service status says the service is installed but not running and the user explicitly asks to start it.',
      safety: 'Confirmed service mutation.',
      liveHostRequired: hostIssue,
    }),
    setupRepairCard(methodIds, {
      id: 'service-restart',
      label: 'Restart service',
      methodId: 'services.restart',
      effect: 'confirmed-effect',
      userRoute: 'Connected-host service control',
      prerequisite: liveHostPrerequisite,
      recommendation: lifecycleRecommendation,
      liveEvidence: repairLiveEvidence(probe, probe.status === 'reachable'
        ? 'Runtime endpoint is reachable; restart is not recommended unless diagnostics prove the host is unhealthy or incompatible.'
        : 'Restart is not recommended from endpoint reachability alone; require diagnostics or service status to prove a running unhealthy service.'),
      recommendedWhen: 'Use only when the service is running but unhealthy or incompatible and the user explicitly asks to restart it.',
      safety: 'Confirmed service mutation; use diagnostics first to avoid disrupting a healthy host.',
      liveHostRequired: hostIssue,
    }),
  ];
}

function connectedHostBootstrapPlan(
  snapshot: Awaited<ReturnType<typeof collectSnapshot>>,
  probe: SetupServiceProbe,
): SetupBootstrapPlan {
  const hostIssue = snapshot.collectionIssues.some((issue) => issue.area === 'host');
  const probeIssue = probe.status === 'unreachable';
  return {
    status: hostIssue || probeIssue ? 'recommended' : 'optional',
    source: 'goodvibes-tui README, package.json, and bin launchers from the connected-host checkout',
    recommendedWhen: hostIssue
      ? 'Use when Agent cannot reach a compatible connected host, so operator service methods cannot be trusted yet.'
      : probeIssue
        ? 'Use when the configured runtime connection is enabled but unreachable, before confirmed service methods have proven an install/start fix.'
      : 'Use only when the user is setting up a new GoodVibes host or wants to verify the owning host install.',
    steps: [
      {
        id: 'verify-bun',
        label: 'Verify Bun is installed',
        purpose: 'GoodVibes TUI and the daemon package are Bun programs; package lifecycle scripts also need Bun.',
        commands: ['bun --version'],
        expected: 'Prints a Bun version.',
        fallback: 'Install Bun, reopen the terminal so PATH is refreshed, then retry.',
      },
      {
        id: 'install-goodvibes-host',
        label: 'Install the owning GoodVibes host',
        purpose: 'Install the package that provides both the TUI and goodvibes-daemon launchers.',
        commands: [
          'bun add -g @pellux/goodvibes-tui',
          'bun pm trust -g @pellux/goodvibes-tui @pellux/goodvibes-sdk core-js tree-sitter-css tree-sitter-javascript tree-sitter-json tree-sitter-python tree-sitter-typescript',
        ],
        expected: 'Global package install completes and Bun reports lifecycle scripts are trusted.',
        fallback: 'If release assets cannot download, use the goodvibes-tui source checkout and run bun install before bun run daemon.',
      },
      {
        id: 'verify-goodvibes-binaries',
        label: 'Verify host binaries',
        purpose: 'Confirm the package installed both user-facing and daemon entrypoints.',
        commands: [
          'bun pm -g untrusted',
          'goodvibes --version',
          'goodvibes-daemon --version',
        ],
        expected: 'Untrusted reports zero remaining lifecycle-script packages, and both binaries print versions.',
        fallback: 'Rerun the full trust command if Bun still reports untrusted package scripts.',
      },
      {
        id: 'start-goodvibes-host',
        label: 'Start or install the host service',
        purpose: 'Bring up the daemon/API host that owns schedules, channels, Knowledge, media, and operator routes.',
        commands: [
          'goodvibes service status',
          'goodvibes service install',
          'goodvibes service start',
        ],
        expected: 'Service status reports an installed running service, or the interactive GoodVibes TUI starts the daemon/listener surfaces configured by the user.',
        fallback: 'For a one-shot headless host from source, use GOODVIBES_DAEMON_TOKEN=... GOODVIBES_HTTP_TOKEN=... bun run daemon inside goodvibes-tui.',
      },
      {
        id: 'reconnect-agent',
        label: 'Reconnect Agent to the host',
        purpose: 'Verify Agent can reach the default host or an explicitly configured runtime URL.',
        commands: [
          'goodvibes-agent status --json',
          'goodvibes-agent compat',
        ],
        expected: 'Agent status reports reachable connected-host and compatible Agent Knowledge routes.',
        fallback: 'Use goodvibes-agent --runtime-url http://host:port or GOODVIBES_AGENT_RUNTIME_URL=http://host:port when the host is not on http://127.0.0.1:3421.',
      },
    ],
    reconnectRoutes: {
      agentStatus: 'agent_harness mode:"connected_host_status" includeParameters:true',
      serviceDiagnostics: 'agent_harness mode:"service_posture" includeParameters:true',
      setupItem: 'agent_harness mode:"setup_item" setupItemId:"connected-host-readiness"',
    },
    policy: 'Bootstrap commands are user-run setup guidance. Agent does not run host install/start commands implicitly; once the host is reachable, exact service mutations stay on confirmed operator methods.',
  };
}

function buildSetupPlan(
  context: CommandContext,
  snapshot: Awaited<ReturnType<typeof collectSnapshot>>,
  capabilities: readonly OnboardingStep1CapabilityItem[],
  servicePosture: CliServicePosture | null,
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
  const localModels = localModelCookbook(context, true);
  const localModelReadiness = localModelSetupReadiness(localModels);
  const serviceProbe = connectedHostServiceProbe(servicePosture);
  const authPosture = connectedHostAuthPosture(context, snapshot);

  const plan: SetupPlanItem[] = [
    {
      id: 'connected-host-readiness',
      label: 'Connected host readiness',
      status: hostSetupStatus(snapshot, serviceProbe),
      priority: 10,
      blocksAutonomy: true,
      reason: 'Daemon-backed automation, Agent Knowledge, channels, and companion routes need a reachable compatible GoodVibes host.',
      nextAction: 'Run connected-host status, then start, update, or repair the owning GoodVibes host if the live check reports a gap.',
      userRoute: 'Agent Workspace -> Home -> Host compatibility',
      modelRoute: 'agent_harness mode:"connected_host_status"',
      relatedSetupItemId: 'operator-terminal',
      signals: [
        serviceProbeSignal(serviceProbe),
        ...serviceProbe.issues.slice(0, 3),
        ...snapshot.collectionIssues.filter((issue) => issue.area === 'host').map((issue) => issue.message),
      ],
      repairCards: connectedHostRepairCards(snapshot, serviceProbe),
      bootstrapPlan: connectedHostBootstrapPlan(snapshot, serviceProbe),
      serviceProbe,
    },
    {
      id: 'connected-host-auth',
      label: 'Connected-host auth',
      status: connectedHostAuthStatus(authPosture),
      priority: 12,
      blocksAutonomy: true,
      reason: 'Protected daemon routes, approvals, schedules, channels, and Agent Knowledge writes need a usable connected-host operator token without Agent owning credential lifecycle.',
      nextAction: connectedHostAuthNextAction(authPosture),
      userRoute: 'Agent Workspace -> Host -> Connected-host auth owner; /auth review',
      modelRoute: 'agent_harness mode:"connected_host_status" includeParameters:true',
      relatedSetupItemId: 'operator-terminal',
      signals: connectedHostAuthSignals(authPosture),
      authPosture,
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
      id: 'local-model-readiness',
      label: 'Local model readiness',
      status: localModelSetupStatus(localModels),
      priority: 25,
      blocksAutonomy: false,
      reason: 'A local route gives the assistant a private/offline fallback and can reduce cost, but it should be set up through visible server, refresh, and benchmark steps.',
      nextAction: localModelSetupNextAction(localModels),
      userRoute: 'Agent Workspace -> Start -> Local model cookbook',
      modelRoute: 'agent_harness mode:"model_routing" query:"local"',
      signals: localModelSetupSignals(localModels),
      localModelReadiness,
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
      status: browserControl.status === 'ready' ? 'ready' : browserControl.status === 'attention' ? 'check' : 'recommended',
      priority: 65,
      blocksAutonomy: false,
      reason: browserControl.configured
        ? 'A trusted browser, desktop, computer-use, screenshot, or screen-recording route is configured.'
        : browserControl.status === 'attention'
          ? 'A browser or desktop connector is present but needs trust, connection, or schema review before use.'
        : 'Live browser navigation, UI testing, screenshots, screen recording, and desktop or device actions need a trusted MCP server or first-class tool before the Agent can perform them.',
      nextAction: browserControl.configured
        ? 'Inspect the browser/desktop execution route before using live UI automation.'
        : browserControl.status === 'attention'
          ? 'Review the matching MCP server trust, connection, and schema freshness before using live UI automation.'
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

function describeRepairCard(card: SetupRepairCard): Record<string, unknown> {
  return {
    id: card.id,
    label: card.label,
    state: card.state,
    effect: card.effect,
    recommendation: card.recommendation,
    ...(card.methodId ? { methodId: card.methodId } : {}),
    ...(card.modelRoute ? { modelRoute: card.modelRoute } : {}),
    userRoute: card.userRoute,
    ...(card.prerequisite ? { prerequisite: previewHarnessText(card.prerequisite, 140) } : {}),
    ...(card.liveEvidence ? { liveEvidence: {
      probeStatus: card.liveEvidence.probeStatus,
      summary: previewHarnessText(card.liveEvidence.summary, 160),
    } } : {}),
    recommendedWhen: previewHarnessText(card.recommendedWhen, 160),
    safety: previewHarnessText(card.safety, 160),
  };
}

function describePlanItem(item: SetupPlanItem, includeParameters: boolean): Record<string, unknown> {
  const availableRepairCards = item.repairCards
    ?.filter((card) => card.state === 'available')
    .map((card) => card.id);
  const recommendedRepairCards = item.repairCards
    ?.filter((card) => card.state === 'available' && card.recommendation === 'recommended')
    .map((card) => card.id);
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
    ...(availableRepairCards && availableRepairCards.length > 0 ? { availableRepairCards } : {}),
    ...(recommendedRepairCards && recommendedRepairCards.length > 0 ? { recommendedRepairCards } : {}),
    ...(item.bootstrapPlan ? { bootstrapRoute: 'agent_harness mode:"setup_item" setupItemId:"connected-host-readiness"' } : {}),
    ...(includeParameters && item.serviceProbe ? { serviceProbe: item.serviceProbe } : {}),
    ...(includeParameters && item.authPosture ? { authPosture: item.authPosture } : {}),
    ...(includeParameters && item.localModelReadiness ? { localModelReadiness: item.localModelReadiness } : {}),
    ...(includeParameters && item.repairCards && item.repairCards.length > 0 ? { repairCards: item.repairCards.map(describeRepairCard) } : {}),
    ...(includeParameters && item.bootstrapPlan ? { bootstrapPlan: item.bootstrapPlan } : {}),
    ...(includeParameters ? {
      policy: {
        effect: 'read-only',
        mutation: 'Setup plan rows only point to visible setup, status, settings, read-only diagnostics, and confirmed tool routes. Destructive service stop/uninstall actions are intentionally excluded from first-run repair cards.',
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
  const servicePosture = await collectServicePosture(context);
  const plan = buildSetupPlan(context, snapshot, deriveStep1Capabilities(snapshot), servicePosture);
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
  const servicePosture = await collectServicePosture(context);
  const query = readString(args.query).toLowerCase();
  const includeParameters = args.includeParameters === true;
  const all = deriveStep1Capabilities(snapshot);
  const plan = buildSetupPlan(context, snapshot, all, servicePosture);
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
  const servicePosture = await collectServicePosture(context);
  const items = deriveStep1Capabilities(snapshot);
  const plan = buildSetupPlan(context, snapshot, items, servicePosture);
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
