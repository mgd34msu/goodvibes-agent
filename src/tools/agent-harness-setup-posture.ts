import { statSync } from 'node:fs';
import { join } from 'node:path';
import { getOperatorContract } from '@pellux/goodvibes-sdk/contracts';
import { getOrCreateCompanionToken } from '@pellux/goodvibes-sdk/platform/pairing';
import type { ArtifactDescriptor, ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { OnboardingStep1CapabilityItem, OnboardingSurfaceRecord } from '../runtime/onboarding/index.ts';
import { collectOnboardingSnapshot, deriveStep1Capabilities, deriveStep1CapabilityFlags } from '../runtime/onboarding/index.ts';
import type { CommandContext } from '../input/command-registry.ts';
import { GOODVIBES_AGENT_PAIRING_SURFACE } from '../config/surface.ts';
import { previewAgentWorkspaceTuiSettingsImport } from '../input/agent-workspace-settings.ts';
import { buildProviderAccountSnapshot } from '../panels/provider-account-snapshot.ts';
import { requireLocalUserAuthManager, requirePlatform, requireProvider, requireSecretsManager, requireServiceRegistry, requireShellPaths, requireSubscriptionManager } from '../input/commands/runtime-services.ts';
import type { BrowserControlPosture } from './agent-harness-browser-control.ts';
import { browserControlPosture } from './agent-harness-browser-control.ts';
import { localModelCookbook } from './agent-harness-model-routing.ts';
import { previewHarnessText } from './agent-harness-text.ts';
import { buildCliServicePosture, type CliServicePosture } from '../cli/service-posture.ts';
import { connectedHostOperatorTokenFingerprint, connectedHostOperatorTokenPath, readConnectedHostOperatorToken } from '../runtime/connected-host-auth.ts';

export interface AgentHarnessSetupArgs {
  readonly setupItemId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
  readonly fields?: unknown;
  readonly explicitUserRequest?: unknown;
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
type SetupSmokeArtifactStore = Partial<Pick<ArtifactStore, 'create' | 'list'>>;
type SetupHandoffKind = 'diagnostic' | 'workspace-action' | 'ui-surface' | 'confirmed-route' | 'operator-method' | 'conversation' | 'user-command' | 'tool-discovery';
type SetupHandoffEffect = 'read-only' | 'visible-navigation' | 'confirmed-effect' | 'user-run';

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
  readonly installSmokePlan?: SetupInstallSmokePlan;
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
    readonly qrPairingRoute: string;
    readonly manualTokenRoute: string;
    readonly provisionTokenRoute: string;
    readonly tokenProvisioningOwner: string;
    readonly tokenProvisioningSource: string;
  };
}

interface SetupInstallSmokeCheck {
  readonly id: string;
  readonly label: string;
  readonly status: 'ready' | 'blocked' | 'user-run';
  readonly evidence: string;
  readonly route: string;
}

interface SetupInstallSmokePlan {
  readonly status: 'ready-to-run' | 'blocked';
  readonly source: string;
  readonly checks: readonly SetupInstallSmokeCheck[];
  readonly successCriteria: readonly string[];
  readonly policy: string;
}

interface SetupInstallSmokeRunSummary {
  readonly ready: number;
  readonly blocked: number;
  readonly userRun: number;
  readonly total: number;
}

interface SetupSmokeEvidenceField {
  readonly id: string;
  readonly label: string;
  readonly value: string;
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

interface SetupHandoffCard {
  readonly id: string;
  readonly label: string;
  readonly kind: SetupHandoffKind;
  readonly effect: SetupHandoffEffect;
  readonly userRoute: string;
  readonly modelRoute: string;
  readonly nextStep: string;
  readonly safety: string;
  readonly requiresConfirmation?: boolean;
  readonly prerequisite?: string;
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

function readFieldMap(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry === 'string' ? entry : String(entry)]));
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

function provisionConnectedHostTokenRoute(): string {
  return 'agent_harness mode:"provision_connected_host_token" setupItemId:"connected-host-auth" confirm:true explicitUserRequest:"..."';
}

function safeFileMode(path: string): string | null {
  try {
    return `0${(statSync(path).mode & 0o777).toString(8)}`;
  } catch {
    return null;
  }
}

function setupSmokeArtifactStore(context: CommandContext): SetupSmokeArtifactStore | null {
  const candidate = (context.platform as { readonly artifactStore?: unknown }).artifactStore;
  if (candidate && typeof candidate === 'object') {
    return candidate as SetupSmokeArtifactStore;
  }
  return null;
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
    setupHandoffsForItem(item).map((handoff) => [
      handoff.id,
      handoff.label,
      handoff.kind,
      handoff.effect,
      handoff.modelRoute,
      handoff.userRoute,
      handoff.nextStep,
      handoff.safety,
      handoff.prerequisite ?? '',
    ].join(' ')).join('\n'),
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
    JSON.stringify(item.installSmokePlan ?? {}),
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
      qrPairingRoute: 'agent_harness mode:"pairing_route" pairingRouteId:"qr-pairing"',
      manualTokenRoute: 'agent_harness mode:"pairing_route" pairingRouteId:"manual-token-display"',
      provisionTokenRoute: provisionConnectedHostTokenRoute(),
      tokenProvisioningOwner: 'connected GoodVibes host canonical token store',
      tokenProvisioningSource: 'SDK getOrCreateCompanionToken writes ~/.goodvibes/daemon/operator-tokens.json with mode 0600; Agent exposes it only through confirmed setup and never returns the raw token',
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
    return 'Run the confirmed connected-host token provisioning route, inspect pairing posture for visible handoff routes, then rerun auth review and connected-host status.';
  }
  if (!posture.operatorToken.usable) {
    return 'Run the confirmed connected-host token provisioning route to repair the local token file, then rerun auth review and connected-host status.';
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
    `token provisioning route: ${posture.routes.provisionTokenRoute}`,
    `compatibility auth users: ${posture.compatibilityAuth.users}`,
    `compatibility auth sessions: ${posture.compatibilityAuth.sessions}`,
    `bootstrap credential: ${posture.compatibilityAuth.bootstrapCredentialPresent ? 'present' : 'missing'} (${posture.compatibilityAuth.bootstrapCredentialPath})`,
    `token provisioning owner: ${posture.routes.tokenProvisioningOwner}`,
    `token provisioning source: ${posture.routes.tokenProvisioningSource}`,
  ];
}

function installSmokeCheckStatus(ready: boolean): 'ready' | 'blocked' {
  return ready ? 'ready' : 'blocked';
}

function installSmokePlan(
  providerAccess: OnboardingStep1CapabilityItem,
  serviceProbe: SetupServiceProbe,
  authPosture: SetupConnectedHostAuthPosture,
): SetupInstallSmokePlan {
  const hostReady = serviceProbe.status === 'reachable';
  const authReady = authPosture.operatorToken.usable;
  const modelReady = providerAccess.selected;
  const checks: SetupInstallSmokeCheck[] = [
    {
      id: 'agent-binary',
      label: 'Agent binary starts',
      status: 'user-run',
      evidence: 'The installed package binary should answer version/help/status without exposing secrets.',
      route: 'goodvibes-agent --version && goodvibes-agent status --json',
    },
    {
      id: 'connected-host-status',
      label: 'Connected host reachable',
      status: installSmokeCheckStatus(hostReady),
      evidence: `Runtime probe is ${serviceProbe.status} at ${serviceProbe.binding}.`,
      route: 'agent_harness mode:"connected_host_status" includeParameters:true',
    },
    {
      id: 'connected-host-auth',
      label: 'Connected-host operator auth usable',
      status: installSmokeCheckStatus(authReady),
      evidence: authReady
        ? `Operator token is usable (${authPosture.operatorToken.fingerprint ?? 'fingerprint unavailable'}).`
        : `Operator token is ${authPosture.operatorToken.present ? 'present but not usable' : 'missing'} at ${authPosture.operatorToken.path}.`,
      route: 'agent_harness mode:"setup_item" setupItemId:"connected-host-auth"',
    },
    {
      id: 'provider-model',
      label: 'Provider/model route selected',
      status: installSmokeCheckStatus(modelReady),
      evidence: modelReady ? 'Provider/model access is selected in onboarding state.' : 'Provider/model access is not selected yet.',
      route: 'agent_harness mode:"model_routing" includeParameters:true',
    },
    {
      id: 'setup-posture',
      label: 'Setup posture reviewed',
      status: 'user-run',
      evidence: 'Setup posture should show no unresolved autonomy blockers before ongoing work.',
      route: 'agent_harness mode:"setup_posture" includeParameters:true',
    },
    {
      id: 'first-assistant-turn',
      label: 'First assistant turn responds',
      status: modelReady ? 'user-run' : 'blocked',
      evidence: modelReady
        ? 'Ask the main assistant for a short ready response after model routing is selected.'
        : 'A first assistant turn needs a provider/model route first.',
      route: 'Ask the assistant: "Say ready in one sentence and list the active model route."',
    },
  ];
  return {
    status: hostReady && authReady && modelReady ? 'ready-to-run' : 'blocked',
    source: 'GoodVibes Agent installed package plus connected GoodVibes host',
    checks,
    successCriteria: [
      'The Agent binary starts and reports status without printing connected-host tokens.',
      'The connected GoodVibes host is reachable from Agent.',
      'Connected-host operator auth is usable or the user has an explicit pairing handoff.',
      'A provider/model route is selected for normal assistant turns.',
      'The first assistant turn responds in the main conversation.',
    ],
    policy: 'Install smoke is read-only, token-safe guidance. Agent does not run package, host, or shell smoke commands implicitly; use explicit user-run commands or confirmed routes only.',
  };
}

function installSmokeSignals(plan: SetupInstallSmokePlan): readonly string[] {
  return [
    `install smoke: ${plan.status}`,
    ...plan.checks.map((check) => `${check.id}: ${check.status}`),
  ];
}

const SETUP_SMOKE_EVIDENCE_FIELD_DEFINITIONS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'agentBinaryOutput', label: 'Agent binary output' },
  { id: 'statusJson', label: 'Agent status JSON' },
  { id: 'connectedHostStatusOutput', label: 'Connected-host status output' },
  { id: 'setupPostureOutput', label: 'Setup posture output' },
  { id: 'firstAssistantTurn', label: 'First assistant turn' },
  { id: 'notes', label: 'Operator notes' },
];

const MAX_SETUP_SMOKE_FIELD_CHARS = 8_000;

function redactSetupSmokeEvidence(input: string): string {
  const bounded = input.slice(0, MAX_SETUP_SMOKE_FIELD_CHARS);
  return bounded
    .replace(/(\bauthorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, '$1<redacted>')
    .replace(/("?\b(?:api[-_]?key|apikey|token|secret|password|credential)\b"?\s*:\s*)("[^"]*"|[^\s,}]+)/gi, '$1"<redacted>"')
    .replace(/(\b(?:api[-_]?key|apikey|token|secret|password|credential)\b\s*=\s*)[^\s&]+/gi, '$1<redacted>')
    .replace(/([?&](?:api[-_]?key|apikey|token|secret|password|credential)=)[^&\s]+/gi, '$1<redacted>');
}

function setupSmokeEvidenceFields(fields: unknown): readonly SetupSmokeEvidenceField[] {
  const values = readFieldMap(fields);
  return SETUP_SMOKE_EVIDENCE_FIELD_DEFINITIONS
    .map((definition) => {
      const raw = values[definition.id]?.trim() ?? '';
      return raw ? { ...definition, value: redactSetupSmokeEvidence(raw) } : null;
    })
    .filter((entry): entry is SetupSmokeEvidenceField => entry !== null);
}

function safeSetupSmokeFilename(capturedAt: string): string {
  return `setup-smoke-${capturedAt.replace(/[:.]/g, '-').replace(/[^a-zA-Z0-9-]+/g, '-')}.md`;
}

function setupSmokeEvidenceMarkdown(input: {
  readonly capturedAt: string;
  readonly explicitUserRequest: string;
  readonly smokePlan: SetupInstallSmokePlan;
  readonly summary: SetupInstallSmokeRunSummary;
  readonly blockedChecks: readonly string[];
  readonly userRunChecks: readonly string[];
  readonly evidenceFields: readonly SetupSmokeEvidenceField[];
}): string {
  const checkLines = input.smokePlan.checks.map((check) => `- ${check.id}: ${check.status} - ${redactSetupSmokeEvidence(check.evidence)}`);
  const evidenceSections = input.evidenceFields.map((field) => [
    `## ${field.label}`,
    '',
    '```text',
    field.value,
    '```',
  ].join('\n'));
  return [
    '# GoodVibes Agent Setup Smoke Evidence',
    '',
    `Captured: ${input.capturedAt}`,
    `Explicit user request: ${redactSetupSmokeEvidence(input.explicitUserRequest)}`,
    `Smoke status: ${input.smokePlan.status}`,
    `Ready checks: ${input.summary.ready}`,
    `Blocked checks: ${input.blockedChecks.join(', ') || 'none'}`,
    `User-run checks: ${input.userRunChecks.join(', ') || 'none'}`,
    '',
    '## Check Statuses',
    '',
    ...checkLines,
    '',
    '## Success Criteria',
    '',
    ...input.smokePlan.successCriteria.map((criterion) => `- ${criterion}`),
    '',
    ...evidenceSections,
    '',
    '## Policy',
    '',
    input.smokePlan.policy,
    'Evidence fields are redacted before storage. Agent does not run package, host, or shell smoke commands implicitly.',
  ].join('\n');
}

async function saveSetupSmokeArtifact(input: {
  readonly context: CommandContext;
  readonly capturedAt: string;
  readonly explicitUserRequest: string;
  readonly smokePlan: SetupInstallSmokePlan;
  readonly summary: SetupInstallSmokeRunSummary;
  readonly blockedChecks: readonly string[];
  readonly userRunChecks: readonly string[];
  readonly evidenceFields: readonly SetupSmokeEvidenceField[];
}): Promise<Record<string, unknown>> {
  if (input.evidenceFields.length === 0) {
    return {
      status: 'not_requested',
      reason: 'Pass fields with user-run smoke output to save a redacted setup evidence artifact.',
      supportedFields: SETUP_SMOKE_EVIDENCE_FIELD_DEFINITIONS.map((field) => field.id),
    };
  }
  const artifactStore = setupSmokeArtifactStore(input.context);
  if (!artifactStore?.create) {
    return {
      status: 'unavailable',
      reason: 'This runtime did not provide an artifact store with create support.',
      evidenceFields: input.evidenceFields.map((field) => field.id),
    };
  }
  const descriptor = await artifactStore.create({
    kind: 'document',
    mimeType: 'text/markdown',
    filename: safeSetupSmokeFilename(input.capturedAt),
    text: setupSmokeEvidenceMarkdown(input),
    metadata: {
      purpose: 'agent-setup-smoke-evidence',
      source: 'agent-harness-run-setup-smoke',
      capturedAt: input.capturedAt,
      smokeStatus: input.smokePlan.status,
      result: input.blockedChecks.length > 0 ? 'blocked' : 'ready-for-user-run',
      blockedChecks: input.blockedChecks,
      userRunChecks: input.userRunChecks,
      evidenceFields: input.evidenceFields.map((field) => field.id),
      checkStatuses: Object.fromEntries(input.smokePlan.checks.map((check) => [check.id, check.status])),
      explicitUserRequest: redactSetupSmokeEvidence(input.explicitUserRequest),
      redaction: 'token, secret, password, credential, authorization, and api-key-like values redacted before storage',
    },
  });
  return {
    status: 'saved',
    artifactId: descriptor.id,
    filename: descriptor.filename ?? null,
    mimeType: descriptor.mimeType,
    sizeBytes: descriptor.sizeBytes,
    purpose: 'agent-setup-smoke-evidence',
    evidenceFields: input.evidenceFields.map((field) => ({
      id: field.id,
      preview: previewHarnessText(field.value, 120),
    })),
    inspectRoute: `agent_artifacts show artifactId:"${descriptor.id}" includeContent:false`,
  };
}

function readArtifactMetadataString(artifact: ArtifactDescriptor, key: string): string {
  const value = artifact.metadata[key];
  return typeof value === 'string' ? value : '';
}

function readArtifactMetadataStringArray(artifact: ArtifactDescriptor, key: string): readonly string[] {
  const value = artifact.metadata[key];
  return Array.isArray(value) ? value.map((entry) => readString(entry)).filter(Boolean) : [];
}

function setupSmokeEvidenceArtifacts(context: CommandContext): { readonly status: 'available'; readonly artifacts: readonly ArtifactDescriptor[] } | { readonly status: 'unavailable'; readonly reason: string } {
  const artifactStore = setupSmokeArtifactStore(context);
  if (!artifactStore?.list) {
    return {
      status: 'unavailable',
      reason: 'Artifact list support is unavailable in this runtime.',
    };
  }
  const artifacts = artifactStore.list(100)
    .filter((artifact) => readArtifactMetadataString(artifact, 'purpose') === 'agent-setup-smoke-evidence')
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
  return { status: 'available', artifacts };
}

function setupSmokeEvidenceScore(artifact: ArtifactDescriptor): number {
  const result = readArtifactMetadataString(artifact, 'result');
  if (result === 'ready-for-user-run') return 2;
  if (result === 'blocked') return 0;
  return 1;
}

function setupSmokeEvidenceTrend(artifacts: readonly ArtifactDescriptor[]): string {
  if (artifacts.length === 0) return 'none';
  if (artifacts.length === 1) return 'first-run';
  const latest = setupSmokeEvidenceScore(artifacts[0]!);
  const previous = setupSmokeEvidenceScore(artifacts[1]!);
  if (latest > previous) return 'improving';
  if (latest < previous) return 'regressing';
  const result = readArtifactMetadataString(artifacts[0]!, 'result');
  if (result === 'ready-for-user-run') return 'unchanged-ready';
  if (result === 'blocked') return 'unchanged-blocked';
  return 'unchanged';
}

function setupSmokeBlockedCheckFrequency(artifacts: readonly ArtifactDescriptor[]): readonly Record<string, unknown>[] {
  const counts = new Map<string, number>();
  for (const artifact of artifacts) {
    for (const check of readArtifactMetadataStringArray(artifact, 'blockedChecks')) {
      counts.set(check, (counts.get(check) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([checkId, count]) => ({ checkId, count }));
}

function describeSetupSmokeEvidenceArtifact(artifact: ArtifactDescriptor): Record<string, unknown> {
  return {
    artifactId: artifact.id,
    filename: artifact.filename ?? null,
    capturedAt: readArtifactMetadataString(artifact, 'capturedAt') || safeIso(artifact.createdAt),
    result: readArtifactMetadataString(artifact, 'result') || 'unknown',
    smokeStatus: readArtifactMetadataString(artifact, 'smokeStatus') || 'unknown',
    blockedChecks: readArtifactMetadataStringArray(artifact, 'blockedChecks'),
    userRunChecks: readArtifactMetadataStringArray(artifact, 'userRunChecks'),
    evidenceFields: readArtifactMetadataStringArray(artifact, 'evidenceFields'),
    inspectRoute: `agent_artifacts show artifactId:"${artifact.id}" includeContent:false`,
  };
}

function latestSetupSmokeEvidence(context: CommandContext): Record<string, unknown> {
  const listed = setupSmokeEvidenceArtifacts(context);
  if (listed.status === 'unavailable') return listed;
  const artifacts = listed.artifacts;
  const latest = artifacts[0];
  if (!latest) {
    return {
      status: 'none',
      reason: 'No saved setup smoke evidence artifact found.',
      saveRoute: 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke" fields:{...} confirm:true explicitUserRequest:"..."',
    };
  }
  return {
    status: 'saved',
    ...describeSetupSmokeEvidenceArtifact(latest),
    rerunRoute: 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke" confirm:true explicitUserRequest:"..."',
  };
}

function setupSmokeEvidenceHistory(context: CommandContext): Record<string, unknown> {
  const listed = setupSmokeEvidenceArtifacts(context);
  if (listed.status === 'unavailable') return listed;
  const artifacts = listed.artifacts;
  if (artifacts.length === 0) {
    return {
      status: 'none',
      total: 0,
      trend: 'none',
      reason: 'No saved setup smoke evidence artifact found.',
      saveRoute: 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke" fields:{...} confirm:true explicitUserRequest:"..."',
    };
  }
  const resultCounts = artifacts.reduce<Record<string, number>>((counts, artifact) => {
    const result = readArtifactMetadataString(artifact, 'result') || 'unknown';
    counts[result] = (counts[result] ?? 0) + 1;
    return counts;
  }, {});
  return {
    status: 'available',
    total: artifacts.length,
    trend: setupSmokeEvidenceTrend(artifacts),
    latestResult: readArtifactMetadataString(artifacts[0]!, 'result') || 'unknown',
    previousResult: artifacts[1] ? readArtifactMetadataString(artifacts[1], 'result') || 'unknown' : null,
    resultCounts,
    blockedCheckFrequency: setupSmokeBlockedCheckFrequency(artifacts),
    recent: artifacts.slice(0, 5).map(describeSetupSmokeEvidenceArtifact),
    inspectLatestRoute: `agent_artifacts show artifactId:"${artifacts[0]!.id}" includeContent:false`,
    rerunRoute: 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke" confirm:true explicitUserRequest:"..."',
    saveRoute: 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke" fields:{...} confirm:true explicitUserRequest:"..."',
  };
}

function installSmokeRunSummary(plan: SetupInstallSmokePlan): SetupInstallSmokeRunSummary {
  return {
    ready: plan.checks.filter((check) => check.status === 'ready').length,
    blocked: plan.checks.filter((check) => check.status === 'blocked').length,
    userRun: plan.checks.filter((check) => check.status === 'user-run').length,
    total: plan.checks.length,
  };
}

function installSmokeRunResult(plan: SetupInstallSmokePlan): 'blocked' | 'ready-for-user-run' {
  return plan.checks.some((check) => check.status === 'blocked') ? 'blocked' : 'ready-for-user-run';
}

function installSmokeNextAction(plan: SetupInstallSmokePlan): string {
  const blocked = plan.checks.filter((check) => check.status === 'blocked').map((check) => check.id);
  if (blocked.length > 0) {
    return `Resolve blocked checks (${blocked.join(', ')}), then rerun mode:"run_setup_smoke".`;
  }
  const userRun = plan.checks.filter((check) => check.status === 'user-run').map((check) => check.id);
  return `Run user-visible checks (${userRun.join(', ')}), then keep the redacted output with the setup evidence.`;
}

function describeInstallSmokeCheck(check: SetupInstallSmokeCheck, includeParameters: boolean): Record<string, unknown> {
  return {
    id: check.id,
    label: check.label,
    status: check.status,
    evidence: previewHarnessText(check.evidence, includeParameters ? 180 : 120),
    route: previewHarnessText(check.route, includeParameters ? 180 : 120),
    action: check.status === 'blocked'
      ? 'fix-before-smoke'
      : check.status === 'user-run'
        ? 'user-visible-run'
        : 'evidence-ready',
  };
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

function setupHandoff(options: SetupHandoffCard): SetupHandoffCard {
  return options;
}

function confirmedWorkspaceActionRoute(actionId: string, explicitUserRequest: string): string {
  return `agent_harness mode:"run_workspace_action" actionId:"${quoteRouteValue(actionId)}" confirm:true explicitUserRequest:"${quoteRouteValue(explicitUserRequest)}"`;
}

function inspectWorkspaceActionRoute(actionId: string): string {
  return `agent_harness mode:"workspace_action" actionId:"${quoteRouteValue(actionId)}" includeParameters:true`;
}

function openSurfaceRoute(surfaceId: string, explicitUserRequest: string): string {
  return `agent_harness mode:"open_ui_surface" surfaceId:"${quoteRouteValue(surfaceId)}" confirm:true explicitUserRequest:"${quoteRouteValue(explicitUserRequest)}"`;
}

function handoffFromRepairCard(card: SetupRepairCard): SetupHandoffCard | null {
  if (!card.modelRoute) return null;
  return setupHandoff({
    id: card.id,
    label: card.label,
    kind: card.methodId ? 'operator-method' : 'diagnostic',
    effect: card.effect,
    userRoute: card.userRoute,
    modelRoute: card.modelRoute,
    nextStep: card.effect === 'confirmed-effect'
      ? 'Confirm only after the diagnostic card proves this mutation is the right repair.'
      : 'Inspect this diagnostic before choosing any host repair.',
    safety: card.safety,
    ...(card.effect === 'confirmed-effect' ? { requiresConfirmation: true } : {}),
    ...(card.prerequisite ? { prerequisite: card.prerequisite } : {}),
  });
}

function connectedHostReadinessHandoffs(item: SetupPlanItem): readonly SetupHandoffCard[] {
  const repairCards = item.repairCards ?? [];
  const recommendedRepairs = repairCards
    .filter((card) => card.state === 'available' && card.recommendation === 'recommended')
    .map(handoffFromRepairCard)
    .filter((card): card is SetupHandoffCard => card !== null)
    .slice(0, 2);
  const bootstrap = item.bootstrapPlan
    ? [setupHandoff({
      id: 'connected-host-bootstrap',
      label: item.bootstrapPlan.status === 'recommended' ? 'Show host bootstrap checklist' : 'Show host bootstrap reference',
      kind: 'user-command',
      effect: 'user-run',
      userRoute: item.userRoute,
      modelRoute: 'agent_harness mode:"setup_item" setupItemId:"connected-host-readiness"',
      nextStep: 'Show the Bun install, service start, binary verification, and reconnect commands for the user to run on the owning host.',
      safety: item.bootstrapPlan.policy,
    })]
    : [];
  return [
    setupHandoff({
      id: 'connected-host-status',
      label: 'Inspect connected-host status',
      kind: 'diagnostic',
      effect: 'read-only',
      userRoute: item.userRoute,
      modelRoute: 'agent_harness mode:"connected_host_status" includeParameters:true',
      nextStep: 'Check reachability, compatibility, token posture, and Agent Knowledge readiness before repair.',
      safety: 'Read-only host diagnostic; redacts token values.',
    }),
    ...recommendedRepairs,
    ...bootstrap,
    setupHandoff({
      id: 'service-posture',
      label: 'Inspect service posture',
      kind: 'diagnostic',
      effect: 'read-only',
      userRoute: 'Agent Workspace -> Home -> Doctor diagnostics',
      modelRoute: 'agent_harness mode:"service_posture" includeParameters:true',
      nextStep: 'Review endpoint binding, reachability, and logs when host status is inconclusive.',
      safety: 'Read-only service diagnostic.',
    }),
  ];
}

function setupHandoffsForItem(item: SetupPlanItem): readonly SetupHandoffCard[] {
  switch (item.id) {
    case 'connected-host-readiness':
      return connectedHostReadinessHandoffs(item);
    case 'connected-host-auth': {
      const authPosture = item.authPosture;
      const tokenUsable = authPosture?.operatorToken.usable === true;
      return [
        tokenUsable
          ? setupHandoff({
            id: 'verify-connected-host-auth',
            label: 'Verify connected-host auth',
            kind: 'diagnostic',
            effect: 'read-only',
            userRoute: item.userRoute,
            modelRoute: 'agent_harness mode:"connected_host_status" includeParameters:true',
            nextStep: 'Verify protected route readiness and Agent Knowledge before relying on daemon-backed automation.',
            safety: 'Read-only diagnostic; token values are never returned.',
          })
          : setupHandoff({
            id: 'provision-connected-host-token',
            label: 'Provision connected-host token',
            kind: 'confirmed-route',
            effect: 'confirmed-effect',
            userRoute: item.userRoute,
            modelRoute: authPosture?.routes.provisionTokenRoute ?? provisionConnectedHostTokenRoute(),
            nextStep: 'Create or repair the local companion token file, then rerun auth and connected-host status.',
            safety: 'Confirmed local token provisioning; returns only path, fingerprint, peer id, and timestamps, never the raw token.',
            requiresConfirmation: true,
          }),
        setupHandoff({
          id: 'pairing-posture',
          label: 'Inspect pairing posture',
          kind: 'diagnostic',
          effect: 'read-only',
          userRoute: 'Agent Workspace -> Host -> Connected-host auth owner',
          modelRoute: 'agent_harness mode:"pairing_posture" includeParameters:true',
          nextStep: 'Use the visible QR/manual pairing routes when the user needs a non-file token handoff.',
          safety: 'Read-only pairing posture; no token is printed by setup posture.',
        }),
      ];
    }
    case 'goodvibes-settings-import':
      return [
        setupHandoff({
          id: 'preview-goodvibes-settings-import',
          label: 'Preview GoodVibes import',
          kind: 'workspace-action',
          effect: 'read-only',
          userRoute: item.userRoute,
          modelRoute: inspectWorkspaceActionRoute('import-goodvibes-tui-settings'),
          nextStep: 'Show importable setting and subscription counts before any migration.',
          safety: 'Read-only preview; raw provider secrets are not returned.',
        }),
        setupHandoff({
          id: 'apply-goodvibes-settings-import',
          label: 'Apply GoodVibes import',
          kind: 'workspace-action',
          effect: 'confirmed-effect',
          userRoute: item.userRoute,
          modelRoute: confirmedWorkspaceActionRoute('import-goodvibes-tui-settings', 'Import reviewed GoodVibes TUI settings into Agent-owned state.'),
          nextStep: 'Apply only after the user has reviewed the preview and wants Agent to import the values.',
          safety: 'Confirmed Agent-owned settings migration; does not mutate the source GoodVibes TUI settings.',
          requiresConfirmation: true,
        }),
      ];
    case 'provider-access':
      return [
        setupHandoff({
          id: 'open-main-model-picker',
          label: 'Open main model picker',
          kind: 'ui-surface',
          effect: 'visible-navigation',
          userRoute: item.userRoute,
          modelRoute: openSurfaceRoute('model-picker', 'Choose the main provider and model route for normal assistant turns.'),
          nextStep: 'Let the user choose the normal assistant route in the visible provider/model picker.',
          safety: 'Visible UI navigation; provider/model selection remains in the shared picker flow.',
          requiresConfirmation: true,
        }),
        setupHandoff({
          id: 'inspect-model-routing',
          label: 'Inspect model routing',
          kind: 'diagnostic',
          effect: 'read-only',
          userRoute: 'Agent Workspace -> Model Routing',
          modelRoute: 'agent_harness mode:"model_routing" includeParameters:true',
          nextStep: 'Inspect current route, provider readiness, local recipes, and route quality before choosing.',
          safety: 'Read-only model routing posture.',
        }),
        setupHandoff({
          id: 'inspect-provider-accounts',
          label: 'Inspect provider accounts',
          kind: 'diagnostic',
          effect: 'read-only',
          userRoute: 'Agent Workspace -> Start -> Provider accounts',
          modelRoute: 'agent_harness mode:"provider_accounts" includeParameters:true',
          nextStep: 'Review provider account readiness and credential posture without printing secrets.',
          safety: 'Read-only account posture; secret values are never returned.',
        }),
      ];
    case 'install-smoke':
      return [
        setupHandoff({
          id: 'run-setup-smoke',
          label: item.status === 'blocked' ? 'List smoke blockers' : 'Run setup smoke',
          kind: 'confirmed-route',
          effect: 'confirmed-effect',
          userRoute: item.userRoute,
          modelRoute: 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke" confirm:true explicitUserRequest:"Run the install smoke checks."',
          nextStep: item.status === 'blocked'
            ? 'Return the exact blocked checks and user-run checks without running shell or host commands implicitly.'
            : 'Capture the setup smoke result and then save redacted user-run evidence.',
          safety: 'Confirmed token-safe setup smoke; no package, host, or shell commands run implicitly.',
          requiresConfirmation: true,
        }),
        setupHandoff({
          id: 'inspect-smoke-plan',
          label: 'Inspect smoke plan',
          kind: 'diagnostic',
          effect: 'read-only',
          userRoute: item.userRoute,
          modelRoute: 'agent_harness mode:"setup_item" setupItemId:"install-smoke"',
          nextStep: 'Review check status, success criteria, and policy before asking the user to run evidence commands.',
          safety: 'Read-only smoke plan.',
        }),
      ];
    case 'local-model-readiness':
      return [
        setupHandoff({
          id: 'inspect-local-model-cookbook',
          label: 'Inspect local model cookbook',
          kind: 'diagnostic',
          effect: 'read-only',
          userRoute: item.userRoute,
          modelRoute: 'agent_harness mode:"model_routing" query:"local" includeParameters:true',
          nextStep: 'Review detected local routes, top recipe, setup gaps, and benchmark route before changing defaults.',
          safety: 'Read-only model cookbook; local server install/start remains user-run.',
        }),
        setupHandoff({
          id: 'open-local-model-picker',
          label: 'Open model picker',
          kind: 'ui-surface',
          effect: 'visible-navigation',
          userRoute: 'Agent Workspace -> Model Routing',
          modelRoute: openSurfaceRoute('model-picker', 'Review or choose the main local model route.'),
          nextStep: 'Use the visible picker only after local readiness and benchmark evidence are reviewed.',
          safety: 'Visible UI navigation; route change stays explicit.',
          requiresConfirmation: true,
        }),
      ];
    case 'agent-knowledge':
      return [
        setupHandoff({
          id: 'agent-knowledge-status',
          label: 'Inspect Agent Knowledge status',
          kind: 'diagnostic',
          effect: 'read-only',
          userRoute: item.userRoute,
          modelRoute: 'agent_knowledge action:"status"',
          nextStep: 'Verify isolated Agent Knowledge readiness, counts, and connector posture before ingesting sources.',
          safety: 'Read-only Agent Knowledge status; never falls back to default knowledge.',
        }),
        setupHandoff({
          id: 'open-knowledge-panel',
          label: 'Open Knowledge panel',
          kind: 'ui-surface',
          effect: 'visible-navigation',
          userRoute: item.userRoute,
          modelRoute: openSurfaceRoute('knowledge-panel', 'Review isolated Agent Knowledge readiness.'),
          nextStep: 'Open the visible Knowledge workspace for source, search, connector, and ingest controls.',
          safety: 'Visible UI navigation; ingest and review actions remain separate confirmed routes.',
          requiresConfirmation: true,
        }),
      ];
    case 'local-behavior':
      return [
        setupHandoff({
          id: 'review-local-behavior',
          label: 'Review local behavior',
          kind: 'diagnostic',
          effect: 'read-only',
          userRoute: item.userRoute,
          modelRoute: 'agent_harness mode:"learning_curator" includeParameters:true',
          nextStep: 'Review memory, notes, personas, skills, routines, and suggested local behavior updates.',
          safety: 'Read-only curator posture; creates and imports stay confirmed workspace actions.',
        }),
        setupHandoff({
          id: 'capture-learned-behavior',
          label: 'Capture learned behavior',
          kind: 'workspace-action',
          effect: 'confirmed-effect',
          userRoute: 'Agent Workspace -> Local Context',
          modelRoute: confirmedWorkspaceActionRoute('learned-behavior', 'Save a reviewed lesson, workflow, or operating style as Agent-local behavior.'),
          nextStep: 'Create a persona, skill, or routine only from a reviewed user-visible lesson.',
          safety: 'Confirmed Agent-local behavior write; no default knowledge write.',
          requiresConfirmation: true,
        }),
      ];
    case 'communication-channels':
      return [
        setupHandoff({
          id: 'inspect-channels',
          label: 'Inspect channel readiness',
          kind: 'diagnostic',
          effect: 'read-only',
          userRoute: item.userRoute,
          modelRoute: 'agent_harness mode:"channels" includeParameters:true',
          nextStep: 'Review paired surfaces, delivery targets, and channel safety before sending or enabling reminders.',
          safety: 'Read-only channel posture; no external message is sent.',
        }),
        setupHandoff({
          id: 'open-channels-workspace',
          label: 'Open Channels workspace',
          kind: 'ui-surface',
          effect: 'visible-navigation',
          userRoute: item.userRoute,
          modelRoute: 'agent_harness mode:"open_ui_surface" surfaceId:"agent-workspace" target:"channels" confirm:true explicitUserRequest:"Open the Channels workspace for communication setup."',
          nextStep: 'Use visible channel setup only for surfaces where the assistant should be reachable.',
          safety: 'Visible UI navigation; channel pairing and delivery remain explicit.',
          requiresConfirmation: true,
        }),
      ];
    case 'automation-review':
      return [
        setupHandoff({
          id: 'inspect-autonomy-queue',
          label: 'Inspect autonomy queue',
          kind: 'diagnostic',
          effect: 'read-only',
          userRoute: item.userRoute,
          modelRoute: 'agent_harness mode:"autonomy_queue" includeParameters:true',
          nextStep: 'Review visible schedules, approvals, work plans, automation runs, receipts, and cancel routes.',
          safety: 'Read-only autonomy queue posture.',
        }),
        setupHandoff({
          id: 'open-automation-workspace',
          label: 'Open Automation workspace',
          kind: 'ui-surface',
          effect: 'visible-navigation',
          userRoute: 'Agent Workspace -> Automation',
          modelRoute: 'agent_harness mode:"open_ui_surface" surfaceId:"agent-workspace" target:"automation" confirm:true explicitUserRequest:"Open Automation workspace for schedule and background work setup."',
          nextStep: 'Create reminders or promote routines only through confirmed visible forms.',
          safety: 'Visible UI navigation; schedule and run mutations remain confirmed.',
          requiresConfirmation: true,
        }),
      ];
    case 'browser-desktop-control':
      return [
        setupHandoff({
          id: 'inspect-browser-desktop-route',
          label: 'Inspect browser and desktop route',
          kind: 'tool-discovery',
          effect: 'read-only',
          userRoute: item.userRoute,
          modelRoute: item.modelRoute,
          nextStep: 'Review MCP trust, connection, schema freshness, and execution route before live UI automation.',
          safety: 'Read-only tool posture; no browser or desktop action is executed.',
        }),
        setupHandoff({
          id: 'open-tools-mcp-workspace',
          label: 'Open Tools & MCP workspace',
          kind: 'ui-surface',
          effect: 'visible-navigation',
          userRoute: item.userRoute,
          modelRoute: 'agent_harness mode:"open_ui_surface" surfaceId:"agent-workspace" target:"tools" confirm:true explicitUserRequest:"Open Tools and MCP setup for browser or desktop control."',
          nextStep: 'Configure and review only trusted browser or desktop connectors.',
          safety: 'Visible UI navigation; connector writes stay in confirmed setup forms.',
          requiresConfirmation: true,
        }),
      ];
    case 'build-delegation':
      return [
        setupHandoff({
          id: 'inspect-delegation-posture',
          label: 'Inspect delegation posture',
          kind: 'diagnostic',
          effect: 'read-only',
          userRoute: item.userRoute,
          modelRoute: 'agent_harness mode:"delegation_posture" includeParameters:true',
          nextStep: 'Check explicit GoodVibes TUI handoff routes and boundaries before delegating code work.',
          safety: 'Read-only delegation posture; no task is delegated.',
        }),
        setupHandoff({
          id: 'delegate-build-task',
          label: 'Delegate build task',
          kind: 'workspace-action',
          effect: 'confirmed-effect',
          userRoute: 'Agent Workspace -> Build Delegation',
          modelRoute: confirmedWorkspaceActionRoute('delegate-task', 'Delegate one explicit build, fix, review, or isolation task to GoodVibes TUI.'),
          nextStep: 'Use only when isolation, parallelism, remote execution, or explicit user request makes delegation helpful.',
          safety: 'Confirmed delegation; preserves the original ask and keeps review explicit.',
          requiresConfirmation: true,
        }),
      ];
    case 'finish-onboarding':
      return [
        setupHandoff({
          id: 'finish-onboarding',
          label: 'Apply and close onboarding',
          kind: 'workspace-action',
          effect: 'confirmed-effect',
          userRoute: 'Agent Workspace -> Finish',
          modelRoute: confirmedWorkspaceActionRoute('onboarding-apply-close', 'Finish Agent onboarding after setup review.'),
          nextStep: 'Persist the setup completion marker only after the assistant is usable.',
          safety: 'Confirmed local onboarding marker write; no provider, host, channel, or automation mutation.',
          requiresConfirmation: true,
        }),
        setupHandoff({
          id: 'open-onboarding',
          label: 'Open onboarding',
          kind: 'ui-surface',
          effect: 'visible-navigation',
          userRoute: item.userRoute,
          modelRoute: openSurfaceRoute('onboarding', 'Review Agent onboarding before finishing setup.'),
          nextStep: 'Review selected setup choices in the visible onboarding surface.',
          safety: 'Visible UI navigation only.',
          requiresConfirmation: true,
        }),
      ];
    default:
      return [setupHandoff({
        id: `${item.id}-inspect`,
        label: `Inspect ${item.label}`,
        kind: 'diagnostic',
        effect: 'read-only',
        userRoute: item.userRoute,
        modelRoute: item.modelRoute,
        nextStep: item.nextAction,
        safety: 'Read-only setup inspection unless the returned route explicitly requires confirmation.',
      })];
  }
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
  const smokePlan = installSmokePlan(providerAccess, serviceProbe, authPosture);

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
      reason: 'Protected daemon routes, approvals, schedules, channels, and Agent Knowledge writes need a usable connected-host operator token from the canonical GoodVibes host token store.',
      nextAction: connectedHostAuthNextAction(authPosture),
      userRoute: 'Agent Workspace -> Host -> Connected-host auth owner; /auth review',
      modelRoute: authPosture.operatorToken.usable
        ? 'agent_harness mode:"connected_host_status" includeParameters:true'
        : authPosture.routes.provisionTokenRoute,
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
      id: 'install-smoke',
      label: 'Install smoke',
      status: smokePlan.status === 'ready-to-run' ? 'recommended' : 'blocked',
      priority: 22,
      blocksAutonomy: false,
      reason: 'A fresh install should be provable from package binary to reachable host, usable auth, selected model route, reviewed setup posture, and one successful assistant turn.',
      nextAction: smokePlan.status === 'ready-to-run'
        ? 'Run the confirmed setup smoke route, then complete the user-visible package/status and first-turn checks.'
        : 'Resolve connected-host, connected-host auth, and provider/model blockers, then rerun the confirmed setup smoke route.',
      userRoute: 'Agent Workspace -> Start -> Install smoke',
      modelRoute: 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke"',
      signals: installSmokeSignals(smokePlan),
      installSmokePlan: smokePlan,
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

function describeHandoffCard(card: SetupHandoffCard, includeParameters: boolean): Record<string, unknown> {
  return {
    id: card.id,
    label: card.label,
    kind: card.kind,
    effect: card.effect,
    userRoute: previewHarnessText(card.userRoute, includeParameters ? 140 : 96),
    modelRoute: previewHarnessText(card.modelRoute, includeParameters ? 220 : 120),
    nextStep: previewHarnessText(card.nextStep, includeParameters ? 180 : 120),
    safety: previewHarnessText(card.safety, includeParameters ? 180 : 120),
    ...(card.requiresConfirmation ? { requiresConfirmation: true } : {}),
    ...(card.prerequisite ? { prerequisite: previewHarnessText(card.prerequisite, includeParameters ? 160 : 100) } : {}),
  };
}

function describePlanItem(item: SetupPlanItem, includeParameters: boolean): Record<string, unknown> {
  const availableRepairCards = item.repairCards
    ?.filter((card) => card.state === 'available')
    .map((card) => card.id);
  const recommendedRepairCards = item.repairCards
    ?.filter((card) => card.state === 'available' && card.recommendation === 'recommended')
    .map((card) => card.id);
  const handoffs = setupHandoffsForItem(item);
  const primaryHandoff = handoffs[0];
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
    ...(primaryHandoff ? { primaryHandoff: describeHandoffCard(primaryHandoff, includeParameters) } : {}),
    ...(item.relatedSetupItemId ? { relatedSetupItemId: item.relatedSetupItemId } : {}),
    ...(item.signals && item.signals.length > 0 ? { signals: item.signals.slice(0, includeParameters ? 10 : 3) } : {}),
    ...(availableRepairCards && availableRepairCards.length > 0 ? { availableRepairCards } : {}),
    ...(recommendedRepairCards && recommendedRepairCards.length > 0 ? { recommendedRepairCards } : {}),
    ...(item.bootstrapPlan ? { bootstrapRoute: 'agent_harness mode:"setup_item" setupItemId:"connected-host-readiness"' } : {}),
    ...(includeParameters && item.serviceProbe ? { serviceProbe: item.serviceProbe } : {}),
    ...(includeParameters && item.authPosture ? { authPosture: item.authPosture } : {}),
    ...(includeParameters && item.installSmokePlan ? { installSmokePlan: item.installSmokePlan } : {}),
    ...(includeParameters && item.localModelReadiness ? { localModelReadiness: item.localModelReadiness } : {}),
    ...(includeParameters && handoffs.length > 0 ? { handoffs: handoffs.map((handoff) => describeHandoffCard(handoff, true)) } : {}),
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

function nextSetupHandoffSummaries(plan: readonly SetupPlanItem[], limit: number): readonly Record<string, unknown>[] {
  return plan
    .filter((item) => item.status === 'blocked' || item.status === 'check' || item.status === 'recommended')
    .slice(0, limit)
    .map((item) => {
      const primaryHandoff = setupHandoffsForItem(item)[0];
      return {
        setupItemId: item.id,
        label: item.label,
        status: item.status,
        nextAction: previewHarnessText(item.nextAction, 140),
        modelRoute: previewHarnessText(item.modelRoute, 96),
        ...(primaryHandoff ? {
          handoffLabel: primaryHandoff.label,
          handoffKind: primaryHandoff.kind,
          handoffRoute: previewHarnessText(primaryHandoff.modelRoute, 140),
          handoffUserRoute: previewHarnessText(primaryHandoff.userRoute, 120),
          ...(primaryHandoff.requiresConfirmation ? { requiresConfirmation: true } : {}),
        } : {}),
      };
    });
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
  const setupSmokeEvidence = latestSetupSmokeEvidence(context);
  const setupSmokeHistory = setupSmokeEvidenceHistory(context);
  return {
    modes: ['setup_posture', 'setup_item', 'provision_connected_host_token', 'run_setup_smoke'],
    capabilities: deriveStep1Capabilities(snapshot).length,
    planItems: plan.length,
    blockedPlanItems: plan.filter((item) => item.status === 'blocked').length,
    autonomyBlockers: plan.filter((item) => item.blocksAutonomy && item.status !== 'ready').length,
    nextSetupHandoffs: nextSetupHandoffSummaries(plan, 5),
    collectionIssues: snapshot.collectionIssues.length,
    setupMarkerExists: snapshot.acknowledgements.exists,
    setupSmokeEvidence,
    setupSmokeHistory,
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
  const setupSmokeEvidence = latestSetupSmokeEvidence(context);
  const setupSmokeHistory = setupSmokeEvidenceHistory(context);
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
      setupSmokeEvidence,
      setupSmokeHistory,
    },
    setupSmokeEvidence,
    setupSmokeHistory,
    currentRoute: snapshot.providerRouting,
    issues: snapshot.collectionIssues,
    readinessPlan: filteredPlan.map((item) => describePlanItem(item, includeParameters)),
    nextSetupActions: nextSetupHandoffSummaries(plan, 5),
    capabilities: filtered.map((item) => describeItem(item, snapshot, { includeParameters })),
    returned: filtered.length,
    total: all.length,
    policy: 'Read-only setup/onboarding posture. Apply, import, auth, profile, channel, and setting mutations remain confirmation-gated through visible workspace, settings, slash-command, or first-class tool flows.',
  };
}

export function provisionConnectedHostOperatorToken(context: CommandContext, args: AgentHarnessSetupArgs): Record<string, unknown> {
  const setupItemId = readString(args.setupItemId);
  if (setupItemId && setupItemId !== 'connected-host-auth') {
    return {
      status: 'unsupported_setup_item',
      usage: 'provision_connected_host_token supports setupItemId:"connected-host-auth" only.',
    };
  }

  const shellPaths = requireShellPaths(context);
  const before = readConnectedHostOperatorToken(shellPaths.homeDirectory);
  const explicitUserRequest = readString(args.explicitUserRequest);
  const beforeFingerprint = before.token ? connectedHostOperatorTokenFingerprint(before.token) : null;
  if (before.token && before.path.startsWith('env:')) {
    return {
      status: 'already_usable_env_token',
      mode: 'provision_connected_host_token',
      setupItemId: 'connected-host-auth',
      explicitUserRequest: previewHarnessText(explicitUserRequest, 160),
      token: {
        path: before.path,
        present: true,
        usable: true,
        fingerprint: beforeFingerprint,
        rawValueReturned: false,
      },
      mutation: {
        performed: false,
        reason: 'Environment-provided connected-host token is already effective; no local token file was written.',
      },
      routes: {
        inspectAuth: 'agent_harness mode:"setup_item" setupItemId:"connected-host-auth"',
        inspectStatus: 'agent_harness mode:"connected_host_status" includeParameters:true',
        pairingPosture: 'agent_harness mode:"pairing_posture" includeParameters:true',
      },
      policy: {
        effect: 'confirmed-local-token-provisioning',
        secrets: 'Raw connected-host tokens are never returned.',
        boundary: 'Environment-provided tokens take precedence and are not modified by this route.',
      },
    };
  }

  const daemonHomeDir = join(shellPaths.homeDirectory, '.goodvibes', 'daemon');
  const canonicalPath = connectedHostOperatorTokenPath(shellPaths.homeDirectory);
  try {
    const record = getOrCreateCompanionToken(GOODVIBES_AGENT_PAIRING_SURFACE, { daemonHomeDir });
    const after = readConnectedHostOperatorToken(shellPaths.homeDirectory);
    if (!after.token) {
      return {
        status: 'failed',
        mode: 'provision_connected_host_token',
        setupItemId: 'connected-host-auth',
        explicitUserRequest: previewHarnessText(explicitUserRequest, 160),
        error: after.error ? previewHarnessText(after.error, 160) : 'SDK token provisioning completed but no usable connected-host token was readable.',
        token: {
          path: after.path,
          present: after.present,
          usable: false,
          rawValueReturned: false,
        },
        routes: {
          inspectAuth: 'agent_harness mode:"setup_item" setupItemId:"connected-host-auth"',
          inspectStatus: 'agent_harness mode:"connected_host_status" includeParameters:true',
        },
      };
    }
    const afterFingerprint = connectedHostOperatorTokenFingerprint(after.token);
    const changed = beforeFingerprint !== afterFingerprint;
    const result = before.token
      ? changed ? 'repaired' : 'already_usable'
      : before.present ? 'repaired' : 'created';
    return {
      status: result,
      mode: 'provision_connected_host_token',
      setupItemId: 'connected-host-auth',
      explicitUserRequest: previewHarnessText(explicitUserRequest, 160),
      token: {
        path: after.path,
        canonicalPath,
        present: true,
        usable: true,
        fingerprint: afterFingerprint,
        rawValueReturned: false,
        fileMode: safeFileMode(canonicalPath),
      },
      companionRecord: {
        surface: GOODVIBES_AGENT_PAIRING_SURFACE,
        peerId: record.peerId,
        createdAt: safeIso(record.createdAt),
      },
      mutation: {
        performed: result === 'created' || result === 'repaired',
        result,
        existingTokenPreserved: result === 'already_usable',
        source: 'getOrCreateCompanionToken',
      },
      routes: {
        inspectAuth: 'agent_harness mode:"setup_item" setupItemId:"connected-host-auth"',
        inspectStatus: 'agent_harness mode:"connected_host_status" includeParameters:true',
        pairingPosture: 'agent_harness mode:"pairing_posture" includeParameters:true',
        runSetupSmoke: 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke" confirm:true explicitUserRequest:"..."',
      },
      policy: {
        effect: 'confirmed-local-token-provisioning',
        source: 'SDK platform pairing helper writes the canonical connected-host operator token file with owner-only permissions.',
        secrets: 'Only path, fingerprint, peer id, and timestamps are returned; the raw token is not returned.',
        rotation: 'This route preserves a valid existing token and only creates or repairs the local canonical file.',
      },
    };
  } catch (error) {
    return {
      status: 'failed',
      mode: 'provision_connected_host_token',
      setupItemId: 'connected-host-auth',
      explicitUserRequest: previewHarnessText(explicitUserRequest, 160),
      error: previewHarnessText(error instanceof Error ? error.message : String(error), 160),
      token: {
        path: canonicalPath,
        present: before.present,
        usable: false,
        rawValueReturned: false,
      },
      routes: {
        inspectAuth: 'agent_harness mode:"setup_item" setupItemId:"connected-host-auth"',
        inspectStatus: 'agent_harness mode:"connected_host_status" includeParameters:true',
      },
      policy: {
        effect: 'confirmed-local-token-provisioning',
        secrets: 'Raw connected-host tokens are never returned.',
      },
    };
  }
}

export async function runSetupInstallSmoke(context: CommandContext, args: AgentHarnessSetupArgs): Promise<Record<string, unknown>> {
  const setupItemId = readString(args.setupItemId);
  if (setupItemId && setupItemId !== 'install-smoke') {
    return {
      status: 'unsupported_setup_item',
      usage: 'run_setup_smoke currently supports setupItemId:"install-smoke" only.',
    };
  }

  const snapshot = await collectSnapshot(context);
  const servicePosture = await collectServicePosture(context);
  const plan = buildSetupPlan(context, snapshot, deriveStep1Capabilities(snapshot), servicePosture);
  const installSmoke = plan.find((item) => item.id === 'install-smoke');
  const smokePlan = installSmoke?.installSmokePlan;
  if (!smokePlan) {
    return {
      status: 'missing_smoke_plan',
      usage: 'Install smoke plan is not available. Inspect mode:"setup_posture" for setup readiness.',
    };
  }

  const includeParameters = args.includeParameters === true;
  const summary = installSmokeRunSummary(smokePlan);
  const blockedChecks = smokePlan.checks.filter((check) => check.status === 'blocked').map((check) => check.id);
  const userRunChecks = smokePlan.checks.filter((check) => check.status === 'user-run').map((check) => check.id);
  const capturedAt = new Date(snapshot.capturedAt).toISOString();
  const explicitUserRequest = readString(args.explicitUserRequest);
  const evidenceFields = setupSmokeEvidenceFields(args.fields);
  const artifact = await saveSetupSmokeArtifact({
    context,
    capturedAt,
    explicitUserRequest,
    smokePlan,
    summary,
    blockedChecks,
    userRunChecks,
    evidenceFields,
  });
  return {
    status: 'executed',
    mode: 'run_setup_smoke',
    setupItemId: 'install-smoke',
    capturedAt,
    smokeStatus: smokePlan.status,
    result: installSmokeRunResult(smokePlan),
    explicitUserRequest: previewHarnessText(explicitUserRequest, 160),
    summary,
    blockedChecks,
    userRunChecks,
    checks: smokePlan.checks.map((check) => describeInstallSmokeCheck(check, includeParameters)),
    artifact,
    successCriteria: includeParameters ? smokePlan.successCriteria : smokePlan.successCriteria.map((entry) => previewHarnessText(entry, 120)),
    nextAction: installSmokeNextAction(smokePlan),
    routes: {
      inspectSetup: 'agent_harness mode:"setup_posture" includeParameters:true',
      inspectSmoke: 'agent_harness mode:"setup_item" setupItemId:"install-smoke"',
      rerunSmoke: 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke" confirm:true explicitUserRequest:"..."',
      saveEvidence: 'agent_harness mode:"run_setup_smoke" setupItemId:"install-smoke" fields:{...} confirm:true explicitUserRequest:"..."',
    },
    policy: {
      effect: 'confirmed-redacted-setup-smoke',
      shell: 'No package, host, or shell commands were executed implicitly.',
      secrets: 'Secrets and connected-host tokens are never returned; token evidence remains presence, path, and fingerprint only.',
      source: smokePlan.policy,
    },
    source: smokePlan.source,
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
