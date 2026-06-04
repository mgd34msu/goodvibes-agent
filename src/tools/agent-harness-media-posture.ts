import { buildAgentWorkspaceVoiceMediaReadiness } from '../input/agent-workspace-voice-media.ts';
import type { AgentWorkspaceVoiceMediaProviderStatus } from '../input/agent-workspace-voice-media.ts';
import type { CommandContext } from '../input/command-registry.ts';
import { previewHarnessText } from './agent-harness-text.ts';

export interface AgentHarnessMediaArgs {
  readonly mediaProviderId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

type MediaProviderResolution =
  | { readonly status: 'found'; readonly provider: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

interface RuntimeProviderStatus {
  readonly id: string;
  readonly state: string;
  readonly configured: boolean;
  readonly detail?: string;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function readConfigBoolean(context: CommandContext, key: string, fallback: boolean): boolean {
  try {
    const value = (context.platform.configManager as { get(settingKey: string): unknown }).get(key);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function readConfigString(context: CommandContext, key: string): string {
  try {
    const value = (context.platform.configManager as { get(settingKey: string): unknown }).get(key);
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

function providerSearchText(provider: AgentWorkspaceVoiceMediaProviderStatus, runtimeStatus?: RuntimeProviderStatus): string {
  return [
    provider.id,
    provider.label,
    provider.domain,
    provider.setupState,
    provider.nextStep,
    ...provider.features,
    ...provider.secretKeyOptions,
    ...(runtimeStatus ? [runtimeStatus.state, runtimeStatus.configured ? 'configured' : 'unconfigured', runtimeStatus.detail ?? ''] : []),
  ].join('\n').toLowerCase();
}

function describeProviderCandidate(provider: AgentWorkspaceVoiceMediaProviderStatus): Record<string, unknown> {
  return {
    mediaProviderId: `${provider.domain}:${provider.id}`,
    id: provider.id,
    domain: provider.domain,
    label: provider.label,
    setupState: provider.setupState,
    selected: provider.selected,
    modelRoute: mediaProviderModelRoute(),
  };
}

function mediaProviderModelRoute(): string {
  return 'agent_media_generate or agent_harness mode:"media_provider"';
}

function statusMap(statuses: readonly RuntimeProviderStatus[]): ReadonlyMap<string, RuntimeProviderStatus> {
  return new Map(statuses.map((status) => [status.id, status]));
}

function describeProvider(
  provider: AgentWorkspaceVoiceMediaProviderStatus,
  runtimeStatus: RuntimeProviderStatus | undefined,
  options: {
    readonly includeParameters?: boolean;
    readonly lookup?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return {
    mediaProviderId: `${provider.domain}:${provider.id}`,
    id: provider.id,
    label: provider.label,
    domain: provider.domain,
    features: provider.features,
    setupState: provider.setupState,
    selected: provider.selected,
    configuredSecretKeyNames: provider.configuredSecretKeys,
    missingSecretKeyNames: provider.missingSecretKeyOptions,
    nextStep: provider.nextStep,
    modelRoute: mediaProviderModelRoute(),
    ...(runtimeStatus ? {
      runtimeStatus: {
        state: runtimeStatus.state,
        configured: runtimeStatus.configured,
        ...(options.includeParameters && runtimeStatus.detail ? { detail: runtimeStatus.detail } : {}),
      },
    } : {}),
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(options.includeParameters
      ? {
        modelRoutes: {
          inspectPosture: 'agent_harness mode:"media_posture"',
          inspectProvider: 'agent_harness mode:"media_provider"',
          generateMedia: 'agent_media_generate with confirm:true and explicitUserRequest',
          ttsSettings: 'agent_harness mode:"settings", mode:"get_setting", mode:"set_setting" for tts.provider, tts.voice, tts.llmProvider, and tts.llmModel',
        },
        policy: {
          effect: 'read-only',
          values: 'Provider posture returns capability, setup, selected, health, and safe environment key names only; secret values and media payloads are never returned.',
          mutation: 'Media generation, voice enable/disable, TTS setting changes, and bundle export stay explicit confirmation-gated tool, setting, workspace, or slash-command flows.',
        },
      }
      : {
        summary: previewHarnessText(provider.nextStep || `${provider.domain} provider ${provider.setupState}`),
      }),
  };
}

async function readRuntimeStatuses(context: CommandContext): Promise<{
  readonly voice: readonly RuntimeProviderStatus[];
  readonly media: readonly RuntimeProviderStatus[];
}> {
  const voice = await (async () => {
    try {
      return (await context.platform.voiceProviderRegistry?.status() ?? []).map((status) => ({
        id: status.id,
        state: status.state,
        configured: status.configured,
        ...(status.detail ? { detail: status.detail } : {}),
      }));
    } catch {
      return [];
    }
  })();
  const media = await (async () => {
    try {
      return (await context.platform.mediaProviderRegistry?.status() ?? []).map((status) => ({
        id: status.id,
        state: status.state,
        configured: status.configured,
        ...(status.detail ? { detail: status.detail } : {}),
      }));
    } catch {
      return [];
    }
  })();
  return { voice, media };
}

function buildReadiness(context: CommandContext) {
  return buildAgentWorkspaceVoiceMediaReadiness({
    context,
    voiceProviders: context.platform.voiceProviderRegistry?.list() ?? [],
    mediaProviders: context.platform.mediaProviderRegistry?.list() ?? [],
  });
}

export function mediaPostureCatalogStatus(context: CommandContext): Record<string, unknown> {
  const readiness = buildReadiness(context);
  return {
    modes: ['media_posture', 'media_provider'],
    voiceProviders: readiness.voiceProviders.length,
    mediaProviders: readiness.mediaProviders.length,
    readyVoiceProviders: readiness.readyVoiceProviderCount,
    readyMediaProviders: readiness.readyMediaProviderCount,
    readOnly: true,
  };
}

export async function mediaPostureSummary(context: CommandContext, args: AgentHarnessMediaArgs): Promise<Record<string, unknown>> {
  const readiness = buildReadiness(context);
  const runtimeStatuses = await readRuntimeStatuses(context);
  const voiceStatuses = statusMap(runtimeStatuses.voice);
  const mediaStatuses = statusMap(runtimeStatuses.media);
  const providers = [
    ...readiness.voiceProviders.map((provider) => ({ provider, runtimeStatus: voiceStatuses.get(provider.id) })),
    ...readiness.mediaProviders.map((provider) => ({ provider, runtimeStatus: mediaStatuses.get(provider.id) })),
  ];
  const query = readString(args.query).toLowerCase();
  const filtered = providers
    .filter(({ provider, runtimeStatus }) => !query || providerSearchText(provider, runtimeStatus).includes(query))
    .slice(0, readLimit(args.limit, 100));
  return {
    status: 'available',
    summary: {
      voiceProviders: readiness.voiceProviders.length,
      mediaProviders: readiness.mediaProviders.length,
      readyVoiceProviders: readiness.readyVoiceProviderCount,
      readyMediaProviders: readiness.readyMediaProviderCount,
      selectedTtsProviderStatus: readiness.selectedTtsProviderStatus,
      selectedTtsProviderLabel: readiness.selectedTtsProviderLabel,
      ttsVoiceConfigured: readiness.ttsVoiceConfigured,
      ttsResponseRouteConfigured: readiness.ttsResponseRouteConfigured,
      voiceSurfaceEnabled: readConfigBoolean(context, 'ui.voiceEnabled', false),
      browserToolState: readiness.browserToolState,
      artifactStoreAvailable: Boolean(context.platform.artifactStore),
      ttsProviderSetting: readConfigString(context, 'tts.provider') || null,
      ttsVoiceSettingConfigured: readConfigString(context, 'tts.voice').length > 0,
      nextSteps: readiness.nextSteps,
    },
    providers: filtered.map(({ provider, runtimeStatus }) => describeProvider(provider, runtimeStatus, {
      includeParameters: args.includeParameters === true,
    })),
    returned: filtered.length,
    total: providers.length,
    policy: 'Read-only voice/media posture. Media generation, voice enable/disable, TTS setting changes, and bundle export stay confirmation-gated through first-class tools, settings modes, workspace actions, or slash-command mirrors.',
    ...(args.includeParameters === true ? { modelAccess: {
      mediaGenerateTool: 'agent_media_generate',
      providerCatalogMode: 'media_posture',
      singleProviderMode: 'media_provider',
      ttsProviderPicker: 'agent_harness mode:"open_ui_surface" surfaceId:"tts-provider-picker" confirm:true explicitUserRequest:"..."',
      ttsVoicePicker: 'agent_harness mode:"open_ui_surface" surfaceId:"tts-voice-picker" confirm:true explicitUserRequest:"..."',
      commands: ['/media providers', '/voice review', '/tts <prompt>', '/image <path>'],
    } } : {}),
  };
}

export async function describeHarnessMediaProvider(context: CommandContext, args: AgentHarnessMediaArgs): Promise<MediaProviderResolution> {
  const mediaProviderId = readString(args.mediaProviderId);
  const target = readString(args.target);
  const query = readString(args.query);
  const input = mediaProviderId || target || query;
  if (!input) {
    return {
      status: 'missing_lookup',
      usage: 'media_provider requires mediaProviderId, target, or query. Use mode:"media_posture" to inspect provider ids.',
    };
  }
  const readiness = buildReadiness(context);
  const runtimeStatuses = await readRuntimeStatuses(context);
  const voiceStatuses = statusMap(runtimeStatuses.voice);
  const mediaStatuses = statusMap(runtimeStatuses.media);
  const providers = [
    ...readiness.voiceProviders.map((provider) => ({ provider, runtimeStatus: voiceStatuses.get(provider.id) })),
    ...readiness.mediaProviders.map((provider) => ({ provider, runtimeStatus: mediaStatuses.get(provider.id) })),
  ];
  const normalized = input.toLowerCase();
  const exact = providers.find(({ provider }) => `${provider.domain}:${provider.id}` === input || provider.id === input);
  if (exact) {
    return {
      status: 'found',
      provider: describeProvider(exact.provider, exact.runtimeStatus, { includeParameters: true, lookup: { input, source: mediaProviderId ? 'mediaProviderId' : target ? 'target' : 'query', resolvedBy: 'id' } }),
    };
  }
  const insensitive = providers.find(({ provider }) => `${provider.domain}:${provider.id}`.toLowerCase() === normalized || provider.id.toLowerCase() === normalized);
  if (insensitive) {
    return {
      status: 'found',
      provider: describeProvider(insensitive.provider, insensitive.runtimeStatus, { includeParameters: true, lookup: { input, source: mediaProviderId ? 'mediaProviderId' : target ? 'target' : 'query', resolvedBy: 'case-insensitive-id' } }),
    };
  }
  const searched = providers.filter(({ provider, runtimeStatus }) => providerSearchText(provider, runtimeStatus).includes(normalized));
  if (searched.length === 1) {
    const found = searched[0]!;
    return {
      status: 'found',
      provider: describeProvider(found.provider, found.runtimeStatus, { includeParameters: true, lookup: { input, source: mediaProviderId ? 'mediaProviderId' : target ? 'target' : 'query', resolvedBy: 'search' } }),
    };
  }
  if (searched.length > 1) {
    return {
      status: 'ambiguous',
      input,
      candidates: searched.slice(0, 8).map(({ provider }) => describeProviderCandidate(provider)),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown media provider ${input}. Use mode:"media_posture" to inspect provider ids.`,
  };
}
