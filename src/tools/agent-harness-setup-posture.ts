import type { OnboardingStep1CapabilityItem, OnboardingSurfaceRecord } from '../runtime/onboarding/index.ts';
import { collectOnboardingSnapshot, deriveStep1Capabilities, deriveStep1CapabilityFlags } from '../runtime/onboarding/index.ts';
import type { CommandContext } from '../input/command-registry.ts';
import { buildProviderAccountSnapshot } from '../panels/provider-account-snapshot.ts';
import { requireLocalUserAuthManager, requirePlatform, requireProvider, requireSecretsManager, requireServiceRegistry, requireShellPaths, requireSubscriptionManager } from '../input/commands/runtime-services.ts';

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

function summarizeLocalBehavior(snapshot: Awaited<ReturnType<typeof collectSnapshot>>): Record<string, unknown> {
  const discovery = snapshot.localBehaviorDiscovery;
  return {
    personas: discovery.personas,
    skills: discovery.skills,
    routines: discovery.routines,
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
    detail: item.detail,
    signals: signalsForItem(item, snapshot),
    ...(options.lookup ? { lookup: options.lookup } : {}),
    policy: {
      effect: 'read-only',
      values: 'Setup posture returns onboarding readiness, counts, safe setting keys, and route metadata only; secret values and raw provider tokens are never returned.',
      mutation: 'Setup apply, provider auth, local behavior import/create, channel delivery, and starter profile changes stay visible workspace, settings, slash-command, or first-class tool flows.',
    },
    ...(options.includeParameters ? {
      modelAccess: {
        inspectSetup: 'agent_harness mode:"setup_posture"',
        inspectSetupItem: 'agent_harness mode:"setup_item"',
        openOnboarding: 'agent_harness mode:"open_ui_surface" surfaceId:"onboarding" confirm:true',
        setupWorkspace: 'agent_harness mode:"workspace_action" target:"setup"',
        settings: 'agent_harness modes settings/get_setting/set_setting/reset_setting',
        providerRouting: 'agent_harness mode:"model_routing"',
        providerAccounts: 'agent_harness mode:"provider_accounts"',
        channels: 'agent_harness mode:"channels"',
        media: 'agent_harness mode:"media_posture"',
        security: 'agent_harness mode:"security_posture"',
      },
    } : {}),
  };
}

function describeCandidate(item: OnboardingStep1CapabilityItem): Record<string, unknown> {
  return {
    setupItemId: item.id,
    label: item.label,
    selected: item.selected,
  };
}

export async function setupPostureCatalogStatus(context: CommandContext): Promise<Record<string, unknown>> {
  const snapshot = await collectSnapshot(context);
  return {
    modes: ['setup_posture', 'setup_item'],
    capabilities: deriveStep1Capabilities(snapshot).length,
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
  const filtered = all
    .filter((item) => !query || itemSearchText(item).includes(query))
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
    },
    currentRoute: snapshot.providerRouting,
    issues: snapshot.collectionIssues,
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
  const normalized = lookup.input.toLowerCase();
  const exact = items.find((item) => item.id === lookup.input);
  if (exact) return { status: 'found', item: describeItem(exact, snapshot, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'id' } }) };
  const insensitive = items.find((item) => item.id.toLowerCase() === normalized);
  if (insensitive) return { status: 'found', item: describeItem(insensitive, snapshot, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-id' } }) };
  const searched = items.filter((item) => itemSearchText(item).includes(normalized));
  if (searched.length === 1) return { status: 'found', item: describeItem(searched[0]!, snapshot, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'search' } }) };
  if (searched.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: searched.slice(0, 8).map(describeCandidate),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown setup item ${lookup.input}. Use mode:"setup_posture" to inspect setup item ids.`,
  };
}
