import { join } from 'node:path';
import { StepUpService } from '@pellux/goodvibes-sdk/daemon';
import { PairingTokenManager } from '@pellux/goodvibes-sdk/platform/pairing';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { shell as runtimeShell, operations as runtimeOperations } from '@pellux/goodvibes-sdk/platform/runtime';
import type { shell as RuntimeShell } from '@pellux/goodvibes-sdk/platform/runtime';
import { SecretsManager } from '../config/secrets.ts';
import { readCheckpointGuardSettings, readCheckpointRegistrationSetting } from '../config/checkpoint-settings.ts';
import { backfillCheckpointEligibilityIfNeeded, createWorkspaceRegistrationLiveChecker, migrateLegacyWorkspaceRegistryIfNeeded } from '../config/workspace-registration.ts';
import { FocusTracker } from '../core/focus-tracker.ts';
import { ServiceRegistry } from '@pellux/goodvibes-sdk/platform/config';
import { SubscriptionManager } from '@pellux/goodvibes-sdk/platform/config';
import { AutomationDeliveryManager, AutomationManager, AutomationRouteStore } from '@pellux/goodvibes-sdk/platform/automation';
import { ChannelPluginRegistry, ChannelPolicyManager, RouteBindingManager, SurfaceRegistry } from '@pellux/goodvibes-sdk/platform/channels';
import { ChannelDeliveryRouter } from '@pellux/goodvibes-sdk/platform/channels';
import { ApprovalBroker, GatewayMethodCatalog, SharedSessionBroker } from '@pellux/goodvibes-sdk/platform/control-plane';
import { attachWsOnlyGatewayVerbHandlers, createArchivableFleetRegistry } from '@pellux/goodvibes-terminal-shell';
import { createSessionConversationRewindPort } from './conversation-rewind-port.ts';
// Not re-exported by @pellux/goodvibes-terminal-shell (only the gateway-verb
// composition and the registry factory are) — reached directly per the SDK
// adoption convention of going straight to the platform package for whatever
// terminal-shell does not already wrap, rather than hand-rolling the bridge.
import { attachFleetEmitBridge } from '@pellux/goodvibes-sdk/platform/runtime/fleet';
import type { SharedSessionRoutingIntent } from '@pellux/goodvibes-sdk/platform/control-plane';
import { computeUsageCostUsd, resolveModelReference, type ModelIdCandidate } from '@pellux/goodvibes-sdk/platform/providers';
import { logger, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { UserPermissionRuleStore } from '@pellux/goodvibes-sdk/platform/permissions';
import { AGENT_SPINE_PARTICIPANT, SessionSpineClient } from '@pellux/goodvibes-sdk/platform/runtime/session-spine';
import {
  createSpineConnectionResolver,
  createSpineReceiptConsumer,
  createSpineRestProbe,
  createSpineRestTransport,
} from './session-spine-rest-transport.ts';
import { MemorySpineClient, createLocalMemoryAccess } from '@pellux/goodvibes-sdk/platform/runtime/memory-spine';
import type { MemoryTransport } from '@pellux/goodvibes-sdk/platform/runtime/memory-spine';
import { createMemorySpineRestTransport } from './memory-spine-rest-transport.ts';
import { WatcherRegistry } from '@pellux/goodvibes-sdk/platform/watchers';
import { ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import {
  GOODVIBES_AGENT_KNOWLEDGE_DB_FILE,
  HOME_GRAPH_KNOWLEDGE_DB_FILE,
  HOME_GRAPH_KNOWLEDGE_EXTENSION,
  KnowledgeService,
  KnowledgeSemanticService,
  KnowledgeStore,
  ProjectPlanningService,
  createProviderBackedKnowledgeSemanticLlm,
  createWebKnowledgeGapRepairer,
  projectPlanningProjectIdFromPath,
} from '@pellux/goodvibes-sdk/platform/knowledge';
import * as KnowledgePlatform from '@pellux/goodvibes-sdk/platform/knowledge';
import { MediaProviderRegistry, ensureBuiltinMediaProviders } from '@pellux/goodvibes-sdk/platform/media';
import { MultimodalService } from '@pellux/goodvibes-sdk/platform/multimodal';
import { AgentManager } from '@pellux/goodvibes-sdk/platform/tools';
import { AgentMessageBus } from '@pellux/goodvibes-sdk/platform/agents';
import { WrfcController } from '@pellux/goodvibes-sdk/platform/agents';
import { AgentOrchestrator } from '@pellux/goodvibes-sdk/platform/agents';
import { ArchetypeLoader } from '@pellux/goodvibes-sdk/platform/agents';
import { CodeIndexStore, resolveMemoryVectorDbPath } from '@pellux/goodvibes-sdk/platform/state';
import { CodeIndexReindexScheduler } from '@pellux/goodvibes-sdk/platform/state';
// Daemon-side idle+schedule memory consolidation driver — the SAME class the
// SDK's own RuntimeServices composition constructs (it superseded this repo's
// retired turn-settled local wiring), consumed from the public platform/state
// barrel (re-exported there since sdk a03bf218).
import { MemoryConsolidationScheduler } from '@pellux/goodvibes-sdk/platform/state';
import type { MemoryConsolidationRunReceipt } from '@pellux/goodvibes-sdk/platform/state';
import { SessionLiveTurnControlsHolder } from '@pellux/goodvibes-sdk/platform/control-plane';
// Sleep ownership (SDK round: power/*): work inhibition, sleep-edge honesty,
// the keep-awake toggle. Constructed exactly as the SDK composition root does
// (wireRuntimePower binds runtimeBus work signals and starts the manager).
import { wireRuntimePower } from '@pellux/goodvibes-sdk/platform/power';
import { createOrchestrationEngine, createProviderBackedAttemptJudge } from '@pellux/goodvibes-sdk/platform/orchestration';
import { StoreSnapshotScheduler } from '@pellux/goodvibes-sdk/platform/state/store-snapshots';
import { buildExecPromptAnswerHandler } from '@pellux/goodvibes-sdk/platform/runtime/permissions/exec-prompt-wiring';
import { AgentDaemonReceiptFeed } from './daemon-receipts.ts';
import { WorkspaceCheckpointManager } from '@pellux/goodvibes-sdk/platform/workspace';

/**
 * Structural mirror of the SDK's CheckpointSessionResolver (checkpoint/manager):
 * maps a triggering turn/agent lifecycle event to its owning session id. Declared
 * locally because the type is re-exported only from the deep checkpoint subpath,
 * not the `platform/workspace` barrel this module already imports; the shape is
 * exact, so a resolver typed against it is assignable to the constructor option.
 */
type CheckpointSessionResolver = (ctx: { readonly turnId?: string | undefined; readonly agentId?: string | undefined }) => string | undefined;
import { ProcessManager } from '@pellux/goodvibes-sdk/platform/tools';
import { ModeManager } from '@pellux/goodvibes-sdk/platform/state';
import { FileUndoManager } from '@pellux/goodvibes-sdk/platform/state';
import { MemoryRegistry } from '@pellux/goodvibes-sdk/platform/state';
import { MemoryStore } from '@pellux/goodvibes-sdk/platform/state';
// One canonical cross-surface memory store + no-loss legacy fold.
import { resolveCanonicalMemoryDbPath, foldMemoryStores } from '@pellux/goodvibes-sdk/platform/state';
import type { LegacyMemorySource, MemoryFoldReport } from '@pellux/goodvibes-sdk/platform/state';
import type { RuntimeEventBus } from '@/runtime/index.ts';
import { createDomainDispatch } from './store/index.ts';
import type { DomainDispatch, RuntimeStore } from './store/index.ts';
import { DistributedRuntimeManager } from '@/runtime/index.ts';
import { RemoteRunnerRegistry, RemoteSupervisor } from '@/runtime/index.ts';
import { IntegrationHelperService } from '@/runtime/index.ts';
import { VoiceProviderRegistry, VoiceService, ensureBuiltinVoiceProviders } from '@pellux/goodvibes-sdk/platform/voice';
import { WebSearchProviderRegistry, WebSearchService } from '@pellux/goodvibes-sdk/platform/web-search';
import { MemoryEmbeddingProviderRegistry } from '@pellux/goodvibes-sdk/platform/state';
import { HookActivityTracker } from '@pellux/goodvibes-sdk/platform/hooks';
import { HookDispatcher, createHookWorkbench, type HookWorkbench } from '@pellux/goodvibes-sdk/platform/hooks';
import { PluginManager } from '@pellux/goodvibes-sdk/platform/plugins';
import { BookmarkManager } from '@pellux/goodvibes-sdk/platform/bookmarks';
import { ProfileManager } from '@pellux/goodvibes-sdk/platform/profiles';
import { SessionManager } from '@pellux/goodvibes-sdk/platform/sessions';
import { CrossSessionTaskRegistry } from '@pellux/goodvibes-sdk/platform/sessions';
import { ApiTokenAuditor } from '@pellux/goodvibes-sdk/platform/security';
import { UserAuthManager } from '@pellux/goodvibes-sdk/platform/security';
import { WebhookNotifier } from '@pellux/goodvibes-sdk/platform/integrations';
import { McpRegistry } from '@pellux/goodvibes-sdk/platform/mcp';
import { DeterministicReplayEngine } from '@pellux/goodvibes-sdk/platform/core';
import { ProviderOptimizer } from '@pellux/goodvibes-sdk/platform/providers';
import { ProviderRegistry } from '@pellux/goodvibes-sdk/platform/providers';
import type { ModelDefinition } from '@pellux/goodvibes-sdk/platform/providers';
import { ProviderCapabilityRegistry } from '@pellux/goodvibes-sdk/platform/providers';
import { CacheHitTracker } from '@pellux/goodvibes-sdk/platform/providers';
import { FavoritesStore } from '@pellux/goodvibes-sdk/platform/providers';
import { BenchmarkStore } from '@pellux/goodvibes-sdk/platform/providers';
import { ModelLimitsService } from '@pellux/goodvibes-sdk/platform/providers';
import { KeybindingsManager } from '../input/keybindings.ts';
import { SessionMemoryStore } from '@pellux/goodvibes-sdk/platform/core';
import { SessionLineageTracker } from '@pellux/goodvibes-sdk/platform/core';
import { SessionChangeTracker } from '@pellux/goodvibes-sdk/platform/sessions';
import { ExecutionPlanManager } from '@pellux/goodvibes-sdk/platform/core';
import { AdaptivePlanner } from '@pellux/goodvibes-sdk/platform/core';
import { FileStateCache } from '@pellux/goodvibes-sdk/platform/state';
import { ProjectIndex } from '@pellux/goodvibes-sdk/platform/state';
import { IdempotencyStore } from '@/runtime/index.ts';
import { OverflowHandler } from '@pellux/goodvibes-sdk/platform/tools';
import { ContextAccountingHolder } from '@pellux/goodvibes-sdk/platform/tools';
import { ToolLLM } from '@pellux/goodvibes-sdk/platform/config';
import { ComponentHealthMonitor } from '@/runtime/index.ts';
import { SandboxSessionRegistry } from '@/runtime/index.ts';
import { createShellPathService, type ShellPathService } from '@/runtime/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';
import type { FeatureFlagManager, RuntimeFoundationClientsOptions } from '@/runtime/index.ts';
import { createFeatureFlagManager, deriveFeatureStates, bindFeatureSettingsBridge } from '@/runtime/index.ts';
import {
  FeatureAnnouncementStore,
  createSandboxContainmentAnnouncer,
  featureAnnouncementsPath,
} from '@pellux/goodvibes-sdk/platform/runtime/feature-announcements';
import {
  buildLocalhostFetchApproval,
  type LocalhostFetchApproval,
} from '@pellux/goodvibes-sdk/platform/runtime/permissions/localhost-fetch-approval';
import { PolicyRuntimeState } from '@/runtime/index.ts';
import {
  createWorkflowServices,
  type WorkflowServices,
} from '@pellux/goodvibes-sdk/platform/tools';
import { WorkPlanStore } from '../work-plans/work-plan-store.ts';
import { AgentExecutionLedger } from './execution-ledger.ts';

type WorktreeRegistry = RuntimeShell.WorktreeRegistry;
type SdkRuntimeServices = RuntimeFoundationClientsOptions['runtimeServices'];
type SdkCompanionGraphService = NonNullable<SdkRuntimeServices>['homeGraphService'];
type KnowledgeServiceConstructor = new (
  store: KnowledgeStore,
  artifactStore: ArtifactStore,
  options?: unknown,
) => SdkCompanionGraphService;

const companionGraphServiceConstructor = KnowledgePlatform[
  ['Home', 'GraphService'].join('') as keyof typeof KnowledgePlatform
] as unknown as KnowledgeServiceConstructor;

function buildFallbackModelDefinition(provider: string, modelId: string): ModelDefinition {
  const providerLower = provider.toLowerCase();
  const isReasoningProvider = providerLower.includes('openai')
    || providerLower.includes('anthropic')
    || providerLower.includes('gemini')
    || providerLower.includes('google');

  return {
    id: modelId,
    provider,
    registryKey: `${provider}:${modelId}`,
    displayName: modelId,
    description: 'Configured model available before the model catalog cache has loaded.',
    capabilities: {
      toolCalling: true,
      codeEditing: false,
      reasoning: isReasoningProvider,
      multimodal: isReasoningProvider,
    },
    contextWindow: isReasoningProvider ? 128_000 : 32_000,
    contextWindowProvenance: 'fallback',
    selectable: true,
    tier: 'standard',
    ...(isReasoningProvider ? { reasoningEffort: ['instant', 'low', 'medium', 'high'] } : {}),
  };
}

/**
 * Fork-mirror of the SDK's buildSharedSessionAgentSpawnRoutingInput
 * (platform/control-plane/session-intents.ts — the builder itself has no
 * public export path; only its intent types do). Bare model ids resolve
 * through the SDK's PUBLIC shared resolver (resolveModelReference from
 * platform/providers): unique across the registry auto-qualifies, an
 * ambiguous id throws the real candidate registryKeys, an unknown id throws
 * closest-match suggestions plus a concrete valid example. Keep the body
 * faithful to the SDK's; any deliberate divergence gets its own comment.
 */
function normalizeSharedSessionModelId(
  modelId: string | undefined,
  providerId: string | undefined,
  modelCandidates?: readonly ModelIdCandidate[],
): string | undefined {
  const trimmedModelId = modelId?.trim();
  if (!trimmedModelId) return undefined;
  const trimmedProviderId = providerId?.trim();
  const separatorIndex = trimmedModelId.indexOf(':');
  if (separatorIndex > 0) {
    const modelProviderId = trimmedModelId.slice(0, separatorIndex);
    if (trimmedProviderId && trimmedProviderId !== modelProviderId) {
      throw new Error(`Shared-session routing model '${trimmedModelId}' conflicts with provider '${trimmedProviderId}'.`);
    }
    return trimmedModelId;
  }
  if (trimmedProviderId) return `${trimmedProviderId}:${trimmedModelId}`;
  if (modelCandidates) {
    try {
      return resolveModelReference(trimmedModelId, modelCandidates);
    } catch (err) {
      throw new Error(`Shared-session routing model: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`Shared-session routing model '${trimmedModelId}' must be provider-qualified.`);
}

function normalizeSharedSessionFallbackModels(
  models: readonly string[] | undefined,
  modelCandidates?: readonly ModelIdCandidate[],
): string[] {
  return (models ?? [])
    .filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
    .map((model) => {
      const trimmed = model.trim();
      if (trimmed.includes(':')) return trimmed;
      if (modelCandidates) {
        try {
          return resolveModelReference(trimmed, modelCandidates);
        } catch (err) {
          throw new Error(`Shared-session fallback model: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      throw new Error(`Shared-session fallback model '${model}' must be provider-qualified.`);
    });
}

/** Exported for the spawn-routing contract tests; the composition root below is the only live caller. */
export function buildAgentSpawnRoutingFromSharedSession(
  routing: SharedSessionRoutingIntent | undefined,
  options: {
    readonly restrictTools?: boolean | undefined;
    /** The live registry's model candidates — enables bare model id resolution when supplied. */
    readonly modelCandidates?: readonly ModelIdCandidate[] | undefined;
  } = {},
): Partial<Parameters<AgentManager['spawn']>[0]> {
  if (!routing) return options.restrictTools ? { restrictTools: true } : {};
  const provider = routing.providerId?.trim();
  const model = normalizeSharedSessionModelId(routing.modelId, provider, options.modelCandidates);
  if (provider && !model) {
    throw new Error('Shared-session provider routing requires a provider-qualified model when provider is supplied.');
  }
  const fallbackModels = normalizeSharedSessionFallbackModels(routing.fallbackModels, options.modelCandidates);
  const providerFailurePolicy = routing.providerFailurePolicy ?? (
    fallbackModels.length ? 'ordered-fallbacks' : 'fail'
  );
  if (providerFailurePolicy === 'ordered-fallbacks' && fallbackModels.length === 0) {
    throw new Error('Shared-session ordered fallback routing requires at least one provider-qualified fallback model.');
  }
  if (providerFailurePolicy === 'fail' && fallbackModels.length > 0) {
    throw new Error('Shared-session fail routing cannot include fallback models; use ordered-fallbacks to enable model failover.');
  }
  return {
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(routing.tools?.length ? { tools: [...routing.tools] } : {}),
    ...(options.restrictTools ? { restrictTools: true } : {}),
    routing: {
      providerSelection: routing.providerSelection ?? (provider ? 'concrete' : 'inherit-current'),
      providerFailurePolicy,
      ...(fallbackModels.length ? { fallbackModels } : {}),
    },
    ...(routing.executionIntent ? { executionIntent: routing.executionIntent } : {}),
    ...(routing.reasoningEffort ? { reasoningEffort: routing.reasoningEffort } : {}),
  };
}

class DisabledAgentWorktreeRegistry extends runtimeShell.WorktreeRegistry {
  public override async list(): Promise<Awaited<ReturnType<WorktreeRegistry['list']>>> {
    return [] as Awaited<ReturnType<WorktreeRegistry['list']>>;
  }

  public override attach(_path: string, _target: { sessionId?: string; taskId?: string }): void {
    throw new Error('GoodVibes Agent does not own local worktree attachment. Delegate build, fix, and review work to GoodVibes TUI.');
  }

  public override setState(_path: string, _state: Parameters<WorktreeRegistry['setState']>[1]): void {
    throw new Error('GoodVibes Agent does not own local worktree state. Delegate build, fix, and review work to GoodVibes TUI.');
  }

  public override async cleanup(_path: string): Promise<void> {
    throw new Error('GoodVibes Agent does not own local worktree cleanup. Delegate build, fix, and review work to GoodVibes TUI.');
  }
}

function createDisabledAgentWorktreeRegistry(workingDirectory: string): WorktreeRegistry {
  return new DisabledAgentWorktreeRegistry(workingDirectory, {
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
  });
}

type AgentWrfcWorktreeFactory = NonNullable<ConstructorParameters<typeof WrfcController>[2]['createWorktree']>;
type AgentWrfcWorktreeOps = ReturnType<AgentWrfcWorktreeFactory>;

function agentWrfcWorktreeError(operation: string): Error {
  return new Error(`GoodVibes Agent does not own local review worktree ${operation}. Delegate build, fix, and review work to GoodVibes TUI.`);
}

function createDisabledAgentWrfcWorktreeOps(): AgentWrfcWorktreeOps {
  return {
    async merge(_agentId: string): Promise<boolean> {
      throw agentWrfcWorktreeError('merge');
    },
    async cleanup(_agentId: string): Promise<void> {
      throw agentWrfcWorktreeError('cleanup');
    },
    // No explicit return-type annotation: this always throws before returning,
    // so it structurally satisfies whatever CommitWorkingTreeResult shape the
    // SDK's WrfcController#createWorktree option currently declares (derived
    // via AgentWrfcWorktreeOps above) without importing that SDK-internal type.
    async commitWorkingTree(_message: string) {
      throw agentWrfcWorktreeError('commit');
    },
    async currentHead(): Promise<string | null> {
      return null;
    },
  };
}

function ensureConfiguredModelIsRoutable(providerRegistry: ProviderRegistry, configManager: ConfigManager): void {
  const configuredModel = String(configManager.get('provider.model') ?? '').trim();
  if (!configuredModel.includes(':')) return;
  if (providerRegistry.listModels().some((model) => model.registryKey === configuredModel)) return;

  const [providerId, ...modelParts] = configuredModel.split(':');
  const modelId = modelParts.join(':').trim();
  if (!providerId || !modelId) return;

  const provider = providerRegistry.tryGet(providerId);
  if (!provider) return;

  providerRegistry.registerRuntimeProvider({
    provider,
    replace: true,
    models: [buildFallbackModelDefinition(providerId, modelId)],
  });
}

const PROVIDER_STARTUP_PLACEHOLDER_API_KEY = 'goodvibes-agent-startup-placeholder';

type ProviderRegistryConstructionOptions = ConstructorParameters<typeof ProviderRegistry>[0];

type ProviderStartupEnv = {
  readonly providerId: string;
  readonly envVars: readonly string[];
};

type MutableApiKeyProvider = {
  apiKey: string;
};

type MutableConfiguredProvider = {
  configured: boolean;
};

const PROVIDER_STARTUP_PLACEHOLDER_ENVS: readonly ProviderStartupEnv[] = [
  { providerId: 'openai', envVars: ['OPENAI_API_KEY', 'OPENAI_KEY'] },
  { providerId: 'inceptionlabs', envVars: ['INCEPTION_API_KEY'] },
  { providerId: 'openrouter', envVars: ['OPENROUTER_API_KEY'] },
  { providerId: 'aihubmix', envVars: ['AIHUBMIX_API_KEY'] },
  { providerId: 'groq', envVars: ['GROQ_API_KEY'] },
  { providerId: 'cerebras', envVars: ['CEREBRAS_API_KEY'] },
  { providerId: 'mistral', envVars: ['MISTRAL_API_KEY'] },
  { providerId: 'ollama-cloud', envVars: ['OLLAMA_CLOUD_API_KEY', 'OLLAMA_API_KEY'] },
  { providerId: 'huggingface', envVars: ['HF_API_KEY', 'HUGGINGFACE_API_KEY', 'HF_TOKEN'] },
  { providerId: 'nvidia', envVars: ['NVIDIA_API_KEY'] },
  { providerId: 'llm7', envVars: ['LLM7_API_KEY'] },
  { providerId: 'deepseek', envVars: ['DEEPSEEK_API_KEY'] },
  { providerId: 'fireworks', envVars: ['FIREWORKS_API_KEY'] },
  { providerId: 'microsoft-foundry', envVars: ['AZURE_OPENAI_API_KEY'] },
  { providerId: 'moonshot', envVars: ['MOONSHOT_API_KEY'] },
  { providerId: 'qianfan', envVars: ['QIANFAN_API_KEY'] },
  { providerId: 'qwen', envVars: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'MODELSTUDIO_API_KEY'] },
  { providerId: 'sglang', envVars: ['SGLANG_API_KEY'] },
  { providerId: 'stepfun', envVars: ['STEPFUN_API_KEY'] },
  { providerId: 'together', envVars: ['TOGETHER_API_KEY'] },
  { providerId: 'venice', envVars: ['VENICE_API_KEY'] },
  { providerId: 'volcengine', envVars: ['VOLCANO_ENGINE_API_KEY'] },
  { providerId: 'xai', envVars: ['XAI_API_KEY'] },
  { providerId: 'xiaomi', envVars: ['XIAOMI_API_KEY'] },
  { providerId: 'zai', envVars: ['ZAI_API_KEY', 'Z_AI_API_KEY'] },
  {
    providerId: ['cloud', 'flare-ai-gateway'].join(''),
    envVars: [['CLOUD', 'FLARE_AI_GATEWAY_API_KEY'].join('')],
  },
  { providerId: 'vercel-ai-gateway', envVars: ['AI_GATEWAY_API_KEY'] },
  { providerId: 'litellm', envVars: ['LITELLM_API_KEY'] },
  { providerId: 'copilot-proxy', envVars: ['COPILOT_PROXY_API_KEY'] },
];

function hasMutableApiKeyProvider(value: unknown): value is MutableApiKeyProvider {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { readonly apiKey?: unknown };
  return typeof candidate.apiKey === 'string';
}

function hasMutableConfiguredProvider(value: unknown): value is MutableConfiguredProvider {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { readonly configured?: unknown };
  return typeof candidate.configured === 'boolean';
}

function hasAnyConfiguredEnv(envVars: readonly string[]): boolean {
  return envVars.some((envVar) => {
    const value = process.env[envVar];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

export function createLaunchTolerantProviderRegistry(options: ProviderRegistryConstructionOptions): ProviderRegistry {
  const placeholders = PROVIDER_STARTUP_PLACEHOLDER_ENVS
    .filter((entry) => !hasAnyConfiguredEnv(entry.envVars))
    .map((entry) => ({ providerId: entry.providerId, envVar: entry.envVars[0] }))
    .filter((entry): entry is { readonly providerId: string; readonly envVar: string } => typeof entry.envVar === 'string');

  if (placeholders.length === 0) {
    return new ProviderRegistry(options);
  }

  const previousValues = new Map<string, string | undefined>();
  for (const placeholder of placeholders) {
    previousValues.set(placeholder.envVar, process.env[placeholder.envVar]);
    process.env[placeholder.envVar] = PROVIDER_STARTUP_PLACEHOLDER_API_KEY;
  }
  let providerRegistry: ProviderRegistry;
  try {
    providerRegistry = new ProviderRegistry(options);
  } finally {
    for (const [envVar, previousValue] of previousValues) {
      if (previousValue === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = previousValue;
      }
    }
  }

  for (const placeholder of placeholders) {
    const provider = providerRegistry.get(placeholder.providerId);
    if (hasMutableApiKeyProvider(provider) && provider.apiKey === PROVIDER_STARTUP_PLACEHOLDER_API_KEY) {
      provider.apiKey = '';
    }
    if (hasMutableConfiguredProvider(provider)) {
      provider.configured = false;
    }
  }
  return providerRegistry;
}

export interface RuntimeServicesOptions {
  readonly runtimeBus: RuntimeEventBus;
  readonly runtimeStore: RuntimeStore;
  readonly configManager: ConfigManager;
  readonly localUserAuthManager?: UserAuthManager;
  readonly featureFlags?: FeatureFlagManager;
  readonly getConversationTitle?: () => string | undefined;
  /**
   * Maps a triggering turn/agent lifecycle event to the owning session id so the
   * WorkspaceCheckpointManager can stamp automatic (and defaulted explicit)
   * checkpoints with it. Without this, same-launch checkpoints are written with
   * an undefined session id and the session-scoped restore/rewind lookup filters
   * them out — so a checkpoint made this launch could not be activated until a
   * restart. Consulted live at each event, so a resolver reading a mutable
   * session-id ref reflects the current session without re-wiring.
   */
  readonly resolveSessionId?: CheckpointSessionResolver;
  readonly workingDir: string;
  readonly homeDirectory: string;
}

export interface RuntimeServices extends SdkRuntimeServices {
  readonly workingDirectory: string;
  readonly homeDirectory: string;
  readonly shellPaths: ShellPathService;
  readonly configManager: ConfigManager;
  readonly featureFlags: FeatureFlagManager;
  readonly runtimeBus: RuntimeEventBus;
  readonly runtimeStore: RuntimeStore;
  readonly runtimeDispatch: DomainDispatch;
  readonly keybindingsManager: KeybindingsManager;
  readonly routeBindings: RouteBindingManager;
  readonly surfaceRegistry: SurfaceRegistry;
  readonly channelPlugins: ChannelPluginRegistry;
  readonly channelDeliveryRouter: ChannelDeliveryRouter;
  readonly watcherRegistry: WatcherRegistry;
  readonly approvalBroker: ApprovalBroker;
  /**
   * Localhost dev-server fetch approval (ask once, persist
   * fetch.allowLocalhost for the project) — same instance wired into the
   * orchestrator's tool deps; bootstrap-core must replay it there.
   */
  readonly localhostFetchApproval: LocalhostFetchApproval;
  /**
   * Announce-once store for default-on feature receipts (shared per-install
   * file under the control-plane config dir).
   */
  readonly featureAnnouncementStore: FeatureAnnouncementStore;
  /**
   * First-contained-exec-run announcer — same instance wired into the
   * orchestrator's tool deps; bootstrap-core must replay it there.
   */
  readonly onSandboxedRun: () => void;
  readonly sessionBroker: SharedSessionBroker;
  readonly sessionSpineClient: SessionSpineClient;
  /**
   * Connected-host honesty receipts ("updated from X to Y", "restarted after
   * a crash") captured off the spine probe's /status reads; the renderer
   * attaches at bootstrap and every receipt is delivered exactly once.
   */
  readonly daemonReceiptFeed: AgentDaemonReceiptFeed;
  /**
   * Performs ONE receipt-consuming /status read (`?receipts=consume`) and pushes
   * whatever the daemon delivered into {@link daemonReceiptFeed}. A current
   * daemon delivers its one-shot honesty receipts only to a consuming read (a
   * plain liveness /status read is receipt-neutral), so bootstrap invokes this
   * exactly once per attach — see the memory-spine adoption reconciler's
   * `onAttach`. Best-effort: it never throws and yields nothing on failure.
   */
  readonly consumeDaemonReceipts: () => Promise<void>;
  /**
   * Local idle-time memory-consolidation run receipts, one honest one-line
   * summary per run with something to report — rendered through the SAME
   * attach-time-notice idiom as {@link daemonReceiptFeed} (buffered until a
   * render sink attaches, delivered exactly once), but on its own feed so a
   * local consolidation run is never mislabeled "[Connected host]".
   */
  readonly memoryConsolidationReceiptFeed: AgentDaemonReceiptFeed;
  readonly deliveryManager: AutomationDeliveryManager;
  readonly automationManager: AutomationManager;
  readonly gatewayMethods: GatewayMethodCatalog;
  readonly artifactStore: ArtifactStore;
  /** Compatibility alias that intentionally points at the isolated Agent Knowledge service, not default knowledge. */
  readonly knowledgeService: KnowledgeService;
  readonly agentKnowledgeService: KnowledgeService;
  readonly homeGraphService: SdkCompanionGraphService;
  readonly projectPlanningService: ProjectPlanningService;
  readonly projectPlanningProjectId: string;
  readonly workPlanStore: WorkPlanStore;
  readonly memoryStore: MemoryStore;
  readonly memoryRegistry: MemoryRegistry;
  /**
   * The consumer half of the daemon-served memory spine (SDK 1.1.0). Constructed
   * in LOCAL mode always (wrapping `memoryRegistry` directly); a deferred boot task
   * (see bootstrap.ts, mirroring the session-spine reachability probe) activates it
   * with the REST wire transport when the agent confirms an adopted daemon, and
   * deactivates it back to local on confirmed daemon loss. Every consumer that can
   * express its memory op through the five wire-covered methods (add/honestSearch/
   * get/updateReview/delete) should route through THIS client, never `memoryRegistry`
   * directly, so it automatically stops touching the local store file the moment a
   * daemon is adopted (the single-writer invariant — see memory-spine/client.ts).
   */
  readonly memorySpineClient: MemorySpineClient;
  /** The wire transport handed to `memorySpineClient.activate()` on daemon adoption; exposed so bootstrap can activate/reuse it without rebuilding the connection resolver. */
  readonly memorySpineTransport: MemoryTransport;
  readonly serviceRegistry: ServiceRegistry;
  readonly secretsManager: SecretsManager;
  readonly subscriptionManager: SubscriptionManager;
  readonly localUserAuthManager: UserAuthManager;
  readonly profileManager: ProfileManager;
  readonly bookmarkManager: BookmarkManager;
  readonly sessionManager: SessionManager;
  readonly sessionOrchestration: CrossSessionTaskRegistry;
  readonly hookDispatcher: HookDispatcher;
  readonly hookActivityTracker: HookActivityTracker;
  readonly hookWorkbench: HookWorkbench;
  readonly pluginManager: PluginManager;
  readonly workflow: WorkflowServices;
  readonly voiceProviders: VoiceProviderRegistry;
  readonly voiceService: VoiceService;
  readonly webSearchProviders: WebSearchProviderRegistry;
  readonly webSearchService: WebSearchService;
  readonly mediaProviders: MediaProviderRegistry;
  readonly multimodalService: MultimodalService;
  readonly memoryEmbeddingRegistry: MemoryEmbeddingProviderRegistry;
  readonly channelPolicy: ChannelPolicyManager;
  readonly mcpRegistry: McpRegistry;
  readonly tokenAuditor: ApiTokenAuditor;
  readonly componentHealthMonitor: ComponentHealthMonitor;
  readonly worktreeRegistry: WorktreeRegistry;
  readonly sandboxSessionRegistry: SandboxSessionRegistry;
  readonly webhookNotifier: WebhookNotifier;
  /** OS-level terminal focus tracker, ported from goodvibes-tui's core/focus-tracker.ts. */
  readonly focusTracker: FocusTracker;
  readonly replayEngine: DeterministicReplayEngine;
  readonly providerOptimizer: ProviderOptimizer;
  readonly providerCapabilityRegistry: ProviderCapabilityRegistry;
  readonly cacheHitTracker: CacheHitTracker;
  readonly favoritesStore: FavoritesStore;
  readonly benchmarkStore: BenchmarkStore;
  readonly modelLimitsService: ModelLimitsService;
  readonly providerRegistry: ProviderRegistry;
  readonly toolLLM: ToolLLM;
  readonly distributedRuntime: DistributedRuntimeManager;
  readonly remoteRunnerRegistry: RemoteRunnerRegistry;
  readonly remoteSupervisor: RemoteSupervisor;
  readonly sessionMemoryStore: SessionMemoryStore;
  readonly sessionLineageTracker: SessionLineageTracker;
  readonly sessionChangeTracker: SessionChangeTracker;
  readonly planManager: ExecutionPlanManager;
  readonly adaptivePlanner: AdaptivePlanner;
  readonly idempotencyStore: IdempotencyStore;
  readonly overflowHandler: OverflowHandler;
  readonly policyRuntimeState: PolicyRuntimeState;
  readonly archetypeLoader: ArchetypeLoader;
  readonly agentManager: AgentManager;
  readonly agentMessageBus: AgentMessageBus;
  readonly agentOrchestrator: AgentOrchestrator;
  readonly wrfcController: WrfcController;
  readonly processManager: ProcessManager;
  readonly modeManager: ModeManager;
  readonly fileUndoManager: FileUndoManager;
  readonly executionLedger: AgentExecutionLedger;
  readonly integrationHelpers: IntegrationHelperService;
  /**
   * Re-root workspace-bound stores to a new working directory.
   * Agent memory is home/profile-owned and intentionally does not move on workspace swap.
   * Called by WorkspaceSwapManager after the new directory has been verified.
   * Stores that require a process restart emit a warn-level log; they continue serving
   * the old path until the externally owned GoodVibes host restarts with the new --working-dir.
   */
  rerootStores(newWorkingDir: string): Promise<void>;
}

/**
 * One honest one-line summary of a consolidation run, or null for a run that
 * genuinely did nothing (nothing merged, archived, decayed, or proposed) —
 * a quiet no-op run should not interrupt the user with an empty notice.
 */
export function describeMemoryConsolidationReceipt(receipt: MemoryConsolidationRunReceipt): string | null {
  const parts: string[] = [];
  if (receipt.merged.length > 0) parts.push(`merged ${receipt.merged.length}`);
  if (receipt.archived.length > 0) parts.push(`archived ${receipt.archived.length}`);
  if (receipt.decayed.length > 0) parts.push(`decayed ${receipt.decayed.length}`);
  if (receipt.proposed.length > 0) parts.push(`${receipt.proposed.length} proposed for review`);
  if (parts.length === 0) return null;
  return `Memory consolidation (${receipt.trigger}): ${parts.join(', ')}.`;
}

export function createRuntimeServices(options: RuntimeServicesOptions): RuntimeServices {
  const workingDirectory = options.workingDir;
  const homeDirectory = options.homeDirectory;
  const shellPaths = createShellPathService({
    workingDirectory,
    homeDirectory,
  });
  const configManager = options.configManager;
  const featureFlags = options.featureFlags ?? createFeatureFlagManager();
  if (options.featureFlags === undefined) {
    // Gate states derive from domain settings keys; the bridge keeps live
    // config.set changes flowing. Wired only for a manager this call owns —
    // an injected manager (bootstrap-core's) is the caller's to seed/bridge.
    featureFlags.loadFromConfig({ flags: deriveFeatureStates(configManager) });
    bindFeatureSettingsBridge(configManager, featureFlags);
  }
  const runtimeDispatch = createDomainDispatch(options.runtimeStore);
  const gatewayMethods = new GatewayMethodCatalog();
  const keybindingsManager = new KeybindingsManager({
    configPath: shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'keybindings.json'),
  });
  const routeBindings = new RouteBindingManager({
    store: new AutomationRouteStore({ configManager }),
    runtimeStore: options.runtimeStore,
    runtimeBus: options.runtimeBus,
  });
  const surfaceRegistry = new SurfaceRegistry(configManager, options.runtimeStore);
  const channelPlugins = new ChannelPluginRegistry();
  surfaceRegistry.attachPluginRegistry(channelPlugins);
  const secretsManager = new SecretsManager({
    projectRoot: workingDirectory,
    globalHome: homeDirectory,
    configManager,
  });
  const subscriptionManager = new SubscriptionManager(
    shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'subscriptions.json'),
  );
  const serviceRegistry = new ServiceRegistry(shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'services.json'), {
    secretsManager,
    subscriptionManager,
  });
  // Settable holder for the context_accounting tool's session source (SDK
  // 1.6.1). Constructed here (unbound) so it exists for the whole runtime
  // services lifetime and every consumer of `services.contextAccountingHolder`
  // sees the SAME instance the tool roster is registered against — bootstrap.ts
  // binds an Orchestrator-backed ContextAccountingSource onto it once the
  // interactive Orchestrator exists (see bindOrchestratorContextAccounting in
  // context-accounting-source.ts). Left unbound here: the tool honestly
  // reports "no live session context bound" until that bind call runs.
  const contextAccountingHolder = new ContextAccountingHolder();
  const providerCapabilityRegistry = new ProviderCapabilityRegistry();
  const cacheHitTracker = new CacheHitTracker();
  const favoritesStore = new FavoritesStore({ dir: shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT) });
  const benchmarkStore = new BenchmarkStore({ dir: shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT) });
  const modelLimitsService = new ModelLimitsService({
    cachePath: shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'model-limits.json'),
  });
  const providerRegistry = createLaunchTolerantProviderRegistry({
    configManager,
    subscriptionManager,
    secretsManager,
    serviceRegistry,
    capabilityRegistry: providerCapabilityRegistry,
    cacheHitTracker,
    favoritesStore,
    benchmarkStore,
    modelLimitsService,
    featureFlags,
    runtimeBus: options.runtimeBus,
  });
  ensureConfiguredModelIsRoutable(providerRegistry, configManager);
  providerRegistry.initCustomProviders();
  providerRegistry.initProviderModelDiscovery();
  // ONE credential chain (env -> secrets -> subscription), mirroring the SDK
  // composition root: boot applies secrets-backed keys; every secrets
  // write/delete re-registers builtin providers LIVE (no restart needed).
  secretsManager.onDidChange(() => void providerRegistry.refreshProviderCredentials().catch((error) => logger.warn('live credential refresh failed', { error: summarizeError(error) })));
  void providerRegistry.refreshProviderCredentials().catch((error) => logger.warn('boot credential refresh failed', { error: summarizeError(error) }));
  const toolLLM = new ToolLLM({
    configManager,
    providerRegistry,
    runtimeBus: options.runtimeBus,
  });
  const localUserAuthManager = options.localUserAuthManager ?? new UserAuthManager({
    bootstrapFilePath: shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'auth-users.json'),
    bootstrapCredentialPath: shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'auth-bootstrap.txt'),
  });
  const profileManager = new ProfileManager(shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'profiles'));
  const bookmarkManager = new BookmarkManager(shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'bookmarks'));
  const sessionManager = new SessionManager(workingDirectory, { surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT });
  const sessionOrchestration = new CrossSessionTaskRegistry(
    shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'sessions', 'task-graph.json'),
  );
  const hookActivityTracker = new HookActivityTracker();
  const watcherRegistry = new WatcherRegistry({
    storePath: shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'watchers.json'),
  });
  watcherRegistry.attachRuntime({
    runtimeStore: options.runtimeStore,
    runtimeBus: options.runtimeBus,
  });
  const agentMessageBus = new AgentMessageBus();
  agentMessageBus.setRuntimeBus(options.runtimeBus);
  const archetypeLoader = new ArchetypeLoader(join(workingDirectory, '.goodvibes', 'agents'));
  const agentOrchestrator = new AgentOrchestrator({
    messageBus: agentMessageBus,
  });
  agentOrchestrator.setRuntimeBus(options.runtimeBus);
  const agentManager = new AgentManager({
    archetypeLoader,
    messageBus: agentMessageBus,
    executor: agentOrchestrator,
    configManager,
    providerRegistry,
  });
  agentManager.setRuntimeBus(options.runtimeBus);
  const wrfcController = Reflect.construct(WrfcController, [options.runtimeBus, agentMessageBus, {
    agentManager,
    configManager,
    projectRoot: workingDirectory,
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    createWorktree: createDisabledAgentWrfcWorktreeOps,
  }]) as WrfcController;
  agentManager.setWrfcController(wrfcController);
  const hookDispatcher = new HookDispatcher({ toolLLM, projectRoot: workingDirectory }, hookActivityTracker);
  configManager.attachHookDispatcher(hookDispatcher);
  const hookWorkbench = createHookWorkbench({
    hookDispatcher,
    configManager,
  });
  const approvalBroker = new ApprovalBroker({
    storePath: shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'control-plane', 'approvals.json'),
  });
  // Durable user-origin permission rules (remembered approvals), mirroring the
  // SDK composition root: one store per project, consumed by the permission
  // manager (bootstrap-core) and the permissions.rules.* gateway verbs below.
  // Background init is fail-safe: a broken store means asks keep prompting.
  const userPermissionRuleStore = new UserPermissionRuleStore(join(configManager.getControlPlaneConfigDir(), 'permission-rules.json'));
  void userPermissionRuleStore.init().catch((error) => logger.warn('user permission rule store init failed; asks will prompt', { error: summarizeError(error) }));
  // Per-device revocable pairing tokens (SDK 1.8.0, pairing.tokens.*
  // gateway verbs). Constructed exactly as the SDK composition root does,
  // same control-plane config dir as userPermissionRuleStore above, from the
  // public @pellux/goodvibes-sdk/platform/pairing export.
  const pairingTokens = new PairingTokenManager(join(configManager.getControlPlaneConfigDir(), 'pairing-tokens.json'));
  const sessionBroker = new SharedSessionBroker({
    storePath: shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'control-plane', 'sessions.json'),
    routeBindings,
    agentStatusProvider: agentManager,
    messageSender: agentMessageBus,
  });
  // The SDK's extracted session-spine core, consumed via this surface's
  // own REST transport adapter (session-spine-rest-transport.ts) — version-
  // tolerant, since the agent may compile against a pinned SDK predating the
  // typed sessions.register client. Live-immediately mode: passing `transport`
  // at construction starts the keepalive now, for the whole process lifetime
  // (no separate activate() step — the agent has none). Client-only; never
  // starts the daemon. All calls are fire-and-forget; a down daemon degrades to
  // an honest offline queue while the local broker keeps rendering.
  const spineResolveConnection = createSpineConnectionResolver(configManager, homeDirectory);
  const daemonReceiptFeed = new AgentDaemonReceiptFeed();
  // The daemon's one-shot honesty receipts are delivered ONLY to an explicit
  // `?receipts=consume` read (a plain /status read is receipt-neutral), so the
  // liveness probe below stays plain and a SEPARATE consuming read runs once
  // per attach (bootstrap wires this to the memory-spine reconciler's onAttach).
  const spineReceiptConsumer = createSpineReceiptConsumer({ resolveConnection: spineResolveConnection });
  const consumeDaemonReceipts = async (): Promise<void> => {
    const receipts = await spineReceiptConsumer();
    if (receipts.length > 0) daemonReceiptFeed.push(receipts);
  };
  const sessionSpineClient = new SessionSpineClient({
    participant: AGENT_SPINE_PARTICIPANT,
    transport: createSpineRestTransport({ resolveConnection: spineResolveConnection }),
    // Liveness only: a plain /status read that never consumes receipts. The
    // once-per-attach consuming read above is the agent's receipt reader.
    probe: createSpineRestProbe({ resolveConnection: spineResolveConnection }),
    log: logger,
  });
  sessionBroker.setContinuationRunner(async ({ task, input }) => {
    const record = agentManager.spawn({
      mode: 'spawn',
      task,
      // Spawn routing resolves through the SDK's shared model-reference
      // resolver contract (unique-across-registry auto-qualifies; ambiguous
      // and unknown ids throw errors naming real candidates) — the live
      // registry's models are the candidate list.
      ...buildAgentSpawnRoutingFromSharedSession(input.routing, { restrictTools: true, modelCandidates: providerRegistry.listModels() }),
      context: `shared-session:${input.sessionId}`,
    });
    return { agentId: record.id };
  });
  const artifactStore = new ArtifactStore({ configManager });
  const memoryEmbeddingRegistry = new MemoryEmbeddingProviderRegistry({ configManager });
  // The agent no longer owns a private per-surface memory.sqlite. It opens
  // the ONE canonical cross-surface store so a fact learned here recalls in the TUI (and
  // vice-versa). The old agent-global path is folded in at boot with no loss (see
  // foldAgentLegacyMemory), then left in place — migration never deletes.
  const memoryDbPath = resolveCanonicalMemoryDbPath(shellPaths.homeDirectory);
  const memoryStore = new MemoryStore(memoryDbPath, {
    embeddingRegistry: memoryEmbeddingRegistry,
  });
  const memoryRegistry = new MemoryRegistry(memoryStore);
  // Consumer half of the memory spine (SDK 1.1.0). Always constructed in LOCAL mode
  // (embedded/offline is a hard requirement — the agent must work with no daemon
  // running). `spineResolveConnection` above is the SAME connected-host connection
  // (host/port/token) already built for the session spine; one daemon, one resolver.
  // Activation to CLIENT mode (routing every op over the wire, for the whole process
  // lifetime, never touching this local store again) happens in a deferred boot task
  // — see bootstrap.ts's 'memory-spine' schedule — once that task confirms a daemon
  // is actually adopted, reusing sessionSpineClient.probeReachability() as the
  // existing daemon-adoption signal rather than inventing a second one.
  const memorySpineClient = new MemorySpineClient({
    local: createLocalMemoryAccess(memoryRegistry),
    log: logger,
  });
  const memorySpineTransport = createMemorySpineRestTransport({ resolveConnection: spineResolveConnection });
  const deliveryManager = new AutomationDeliveryManager({
    configManager,
    serviceRegistry,
    runtimeBus: options.runtimeBus,
    runtimeStore: options.runtimeStore,
    routeBindings,
    artifactStore,
  });
  const automationManager = new AutomationManager({
    configManager,
    defaultSurfaceKind: 'service',
    routeBindings,
    sessionBroker,
    runtimeStore: options.runtimeStore,
    runtimeBus: options.runtimeBus,
    deliveryManager,
    providerRegistry,
    spawnTask: (input) => {
      const record = agentManager.spawn({
        mode: 'spawn',
        task: input.prompt,
        ...(input.modelId ? { model: input.modelId } : {}),
        ...(input.modelProvider ? { provider: input.modelProvider } : {}),
        ...(input.fallbackModels ? { fallbackModels: [...input.fallbackModels] } : {}),
        ...(input.routing ? { routing: input.routing } : {}),
        ...(input.executionIntent ? { executionIntent: input.executionIntent } : {}),
        ...(input.template ? { template: input.template } : {}),
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        ...(input.toolAllowlist ? { tools: [...input.toolAllowlist], restrictTools: true } : {}),
        context: [
          'automation-manager:visible-agent',
          input.context,
        ].filter((part): part is string => Boolean(part?.trim())).join('\n\n'),
      });
      return record.id;
    },
  });
  const agentKnowledgeStore = new KnowledgeStore({
    configManager,
    dbFileName: GOODVIBES_AGENT_KNOWLEDGE_DB_FILE,
  });
  const homeGraphKnowledgeStore = new KnowledgeStore({
    configManager,
    dbFileName: HOME_GRAPH_KNOWLEDGE_DB_FILE,
  });
  const knowledgeSemanticLlm = createProviderBackedKnowledgeSemanticLlm(providerRegistry, {
    timeoutMs: 20_000,
    maxConcurrent: 1,
  });
  const agentKnowledgeSemanticService = new KnowledgeSemanticService(agentKnowledgeStore, {
    llm: knowledgeSemanticLlm,
    maxLlmSourcesPerReindex: 3,
  });
  const homeGraphSemanticService = new KnowledgeSemanticService(homeGraphKnowledgeStore, {
    llm: knowledgeSemanticLlm,
    maxLlmSourcesPerReindex: 3,
    objectProfiles: HOME_GRAPH_KNOWLEDGE_EXTENSION.objectProfiles,
  });
  const agentKnowledgeService = new KnowledgeService(agentKnowledgeStore, artifactStore, undefined, {
    memoryRegistry,
    runtimeBus: options.runtimeBus,
    semanticService: agentKnowledgeSemanticService,
  });
  agentKnowledgeService.attachRuntimeBus(options.runtimeBus);
  const homeGraphService = new companionGraphServiceConstructor(homeGraphKnowledgeStore, artifactStore, {
    semanticService: homeGraphSemanticService,
  });
  const projectPlanningProjectId = projectPlanningProjectIdFromPath(workingDirectory);
  const projectPlanningService = new ProjectPlanningService(agentKnowledgeStore, {
    defaultProjectId: projectPlanningProjectId,
  });
  const workPlanStore = new WorkPlanStore({
    homeDirectory,
    projectId: projectPlanningProjectId,
    projectRoot: workingDirectory,
  });
  const voiceProviders = new VoiceProviderRegistry();
  ensureBuiltinVoiceProviders(voiceProviders);
  const voiceService = new VoiceService(voiceProviders);
  const webSearchProviders = new WebSearchProviderRegistry({
    env: process.env,
    serviceRegistry,
  });
  const webSearchService = new WebSearchService(webSearchProviders, {
    serviceRegistry,
    featureFlags,
  });
  agentKnowledgeSemanticService.setGapRepairer(createWebKnowledgeGapRepairer({
    searchService: webSearchService,
    ingestService: agentKnowledgeService,
  }));
  homeGraphSemanticService.setGapRepairer(createWebKnowledgeGapRepairer({
    searchService: webSearchService,
    ingestService: homeGraphService,
  }));
  const mediaProviders = new MediaProviderRegistry();
  ensureBuiltinMediaProviders(mediaProviders, artifactStore, providerRegistry);
  const multimodalService = new MultimodalService(artifactStore, mediaProviders, voiceService, agentKnowledgeService);
  const pluginManager = new PluginManager({
    pathOptions: {
      cwd: shellPaths.workingDirectory,
      homeDir: shellPaths.homeDirectory,
    },
    stateFilePath: shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'plugins.json'),
  });
  const workflow = createWorkflowServices();
  hookDispatcher.setTriggerManager(workflow.triggerManager);
  const channelPolicy = new ChannelPolicyManager({
    storePath: shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'channels', 'policies.json'),
  });
  const distributedRuntime = new DistributedRuntimeManager(
    shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'remote', 'distributed-runtime.json'),
  );
  distributedRuntime.attachRuntime({
    sessionBridge: sessionBroker,
    approvalBridge: approvalBroker,
    automationBridge: automationManager,
  });
  const remoteRunnerRegistry = new RemoteRunnerRegistry(agentManager);
  const remoteSupervisor = new RemoteSupervisor(remoteRunnerRegistry);
  const sandboxSessionRegistry = new SandboxSessionRegistry(workingDirectory);
  const mcpRegistry = new McpRegistry({
    hookDispatcher,
    sandboxSessions: sandboxSessionRegistry,
  });
  mcpRegistry.setRuntimeBus(options.runtimeBus);
  mcpRegistry.setSandboxRuntime(configManager, sandboxSessionRegistry);
  const tokenAuditor = new ApiTokenAuditor({ managed: false });
  const componentHealthMonitor = new ComponentHealthMonitor();
  const worktreeRegistry = createDisabledAgentWorktreeRegistry(workingDirectory);
  // Configured and attached to the runtime bus during bootstrap when webhook URLs are present.
  const webhookNotifier = new WebhookNotifier();
  // One shared instance for the process lifetime (mirrors goodvibes-tui's
  // runtime/services.ts); fed from 'focus' tokens in handler-feed.ts and read by
  // the approval-alert wiring in main.ts.
  const focusTracker = new FocusTracker();
  const replayEngine = new DeterministicReplayEngine(workingDirectory);
  const providerOptimizer = new ProviderOptimizer(providerRegistry, providerCapabilityRegistry, false);
  const sessionMemoryStore = new SessionMemoryStore();
  const sessionLineageTracker = new SessionLineageTracker();
  const sessionChangeTracker = new SessionChangeTracker();
  const planManager = new ExecutionPlanManager(workingDirectory);
  const adaptivePlanner = new AdaptivePlanner();
  const idempotencyStore = new IdempotencyStore();
  const overflowHandler = new OverflowHandler({ baseDir: workingDirectory });
  const policyRuntimeState = new PolicyRuntimeState();
  const fileCache = new FileStateCache();
  const projectIndex = new ProjectIndex(workingDirectory);
  const channelDeliveryRouter = new ChannelDeliveryRouter({
    configManager,
    secretsManager,
    serviceRegistry,
    artifactStore,
  });
  const processManager = new ProcessManager();
  const modeManager = new ModeManager();
  const fileUndoManager = new FileUndoManager();
  const executionLedger = new AgentExecutionLedger(options.runtimeBus);
  // The SDK's foundation/integration contracts still expect a panel manager;
  // the Agent shell has no panel UI (the Activity sidebar replaced it), so we
  // satisfy those contracts with a no-op implementation.
  const NOOP_PANEL_MANAGER = (() => {
    const emptyPane = { panels: [], activeIndex: 0 } as const;
    return {
      getTopPane: () => emptyPane,
      getBottomPane: () => emptyPane,
      getRegisteredTypes: () => [],
      open: () => undefined,
      show: () => {},
    };
  })();
  const panelManager = NOOP_PANEL_MANAGER;
  const integrationHelpers = new IntegrationHelperService({
    workingDirectory,
    homeDirectory,
    panelManager,
    runtimeStore: options.runtimeStore,
    runtimeBus: options.runtimeBus,
    configManager,
    getConversationTitle: options.getConversationTitle,
    automationManager,
    approvalBroker,
    sessionBroker,
    distributedRuntime,
    remoteRunnerRegistry,
    remoteSupervisor,
    localUserAuthManager,
    providerRegistry,
    serviceRegistry,
    subscriptionManager,
    secretsManager,
  });
  // Localhost dev-server fetches ride the same broker: ask once, one-tap
  // "allow for this project", persisted as fetch.allowLocalhost.
  // An exec command blocked on a terminal prompt (host-key confirmation,
  // credential ask) rides the same broker: the pending prompt surfaces through
  // every surface's approval machinery and the typed answer feeds the same
  // continuing run. The SDK's own wiring (public since this SDK round): the
  // former agent-local mirror existed only because the builder had no public
  // export path.
  const execPromptAnswerHandler = buildExecPromptAnswerHandler({
    requestApproval: (input) => approvalBroker.requestApproval(input),
  });
  const localhostFetchApproval = buildLocalhostFetchApproval({
    requestApproval: (input) => approvalBroker.requestApproval(input),
    configManager,
  });
  // Announce-once receipts for default-on features: the first contained exec
  // run yields the one-time containment line (persisted, once per install).
  const announcementStore = new FeatureAnnouncementStore(featureAnnouncementsPath(configManager));
  const onSandboxedRun = createSandboxContainmentAnnouncer(announcementStore, (announcement) => {
    logger.info(announcement.text, { announcement: announcement.id });
  });
  agentOrchestrator.setDependencies({
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    execPromptAnswerHandler,
    localhostFetchApproval,
    onSandboxedRun,
    fileCache,
    projectIndex,
    workingDirectory,
    fileUndoManager,
    modeManager,
    processManager,
    agentMessageBus,
    webSearchService,
    channelRegistry: channelPlugins,
    remoteRunnerRegistry,
    knowledgeService: agentKnowledgeService,
    memoryRegistry,
    archetypeLoader,
    configManager,
    providerRegistry,
    providerOptimizer,
    toolLLM,
    serviceRegistry,
    sessionOrchestration,
    featureFlags,
    overflowHandler,
    sandboxSessionRegistry,
    workflowServices: workflow,
  });

  // ── One-Platform: RuntimeServices members required by SDK 0.38 ──────
  // The Agent is delegation-only: it does not own local build/worktree work.
  // These are constructed as real-but-inert SDK services purely to satisfy the
  // RuntimeServices contract — none auto-start:
  //   • orchestrationEngine  — never .start()ed here (delegation goes through
  //                            /delegate to the TUI); worktree isolation is
  //                            omitted so any accidental run degrades to shared.
  //   • codeIndexStore       — constructed but neither schema-initialized nor
  //                            auto-built; the Agent runs no repo source-tree
  //                            code index (inert unless explicitly invoked).
  //   • codeIndexReindexScheduler — real-but-inert twin of the above: isEnabled
  //                            is a permanent `() => false`, so tool-driven
  //                            reindex scheduling (Stage B, TUI-only feature)
  //                            never fires for the Agent.
  //   • processRegistry      — fleet observability over the managers the Agent
  //                            already owns (agents, wrfc, processes, watchers).
  //   • workspaceCheckpointManager — a runtimeBus (hence automatic turn/agent-
  //                            lifecycle snapshots) is only passed when
  //                            `workingDirectory` is a registered workspace (or
  //                            the unregistered-workspaces override is
  //                            "guarded"); otherwise it stays inert unless
  //                            explicitly invoked. See the construction site
  //                            below for the full registered-workspaces-only
  //                            rule (owner ruling, 2026-07-10).
  // Honest-unpriced: usage prices through the ONE model pricing resolver
  // (manual -> registration -> provider-served -> catalog -> unknown; any
  // resolvable model). Unknown/subscription yields null (costState
  // 'unpriced'), never $0. SHARED by fleet + orchestration so totals never
  // double-count — mirrors the SDK composition root.
  const priceUsage = (model: string | undefined, usage: { inputTokens: number; outputTokens: number }): number | null => (model ? computeUsageCostUsd(providerRegistry.resolveModelPricing(model), usage) : null);

  const orchestrationEngine = createOrchestrationEngine({
    agentManager,
    configManager,
    runtimeBus: options.runtimeBus,
    projectRoot: workingDirectory,
    priceUsage,
    judgeAttempts: createProviderBackedAttemptJudge(providerRegistry),
  });
  const codeIndexStore = new CodeIndexStore(
    workingDirectory,
    join(workingDirectory, '.goodvibes', 'agent', 'code-index.sqlite'),
    memoryEmbeddingRegistry,
  );
  // Data safety with no discipline: a daily snapshot of every SQLite store
  // this runtime writes, bounded retention, unref'd timers — the SDK's own
  // StoreSnapshotScheduler (public since this SDK round; the former agent-local
  // mirror and its local pruning engine existed only because the class and
  // RetentionPolicy/SnapshotPruner had no public export path). The canonical
  // memory db is shared with the daemon/TUI; the shared snapshot layout means
  // whichever process sweeps first writes that day's copy. The agent's code
  // index is deliberately inert (see the block comment above) — its entry is a
  // no-op until a file actually exists.
  const storeSnapshotScheduler = new StoreSnapshotScheduler({
    stores: [
      { name: 'memory store', dbPath: memoryDbPath },
      { name: 'memory vector index', dbPath: resolveMemoryVectorDbPath(memoryDbPath) },
      { name: 'code index store', dbPath: join(workingDirectory, '.goodvibes', 'agent', 'code-index.sqlite') },
    ],
  });
  storeSnapshotScheduler.start();
  // Start-time janitor: one retention pass over every registered append-only
  // store (best-effort, mirrors the SDK's own composition root at
  // platform/runtime/services.ts). Every root this composition knows is
  // passed — logDir/telemetryDir resolve to THIS repo's actual on-disk
  // locations (join(workingDirectory, '.goodvibes', 'logs'|'telemetry'), the
  // same root entrypoint.ts's configureActivityLogger already writes
  // activity.md into — NOT the home-scoped shellPaths.resolveUserPath('logs')
  // the SDK's own default composition uses, which would silently sweep a
  // directory nothing here ever writes to). Omitting logDir/telemetryDir
  // would leave the registered activity-log and telemetry-ledger entries
  // skipped on every sweep, same defect class the SDK round fixed at its own
  // call site.
  runtimeOperations.runStartupAppendOnlySweep({
    workingDirectory,
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    homeDirectory,
    logDir: shellPaths.resolveProjectPath('logs'),
    telemetryDir: shellPaths.resolveProjectPath('telemetry'),
  }, (key) => configManager.get(key as never));
  // External config edits apply LIVE through the same subscribe() pipeline an
  // in-process set() uses — a hand-edited settings.json needs no restart to
  // take effect. The underlying file watchers are unref'd (SDK round), so
  // this can never pin the process open.
  configManager.watchConfigFiles();
  const codeIndexReindexScheduler = new CodeIndexReindexScheduler({
    target: codeIndexStore,
    workingDirectory,
    isEnabled: () => false,
  });
  // Archive-aware: finished agent/swarm subtrees can be moved out of the
  // live fleet view into a session-scoped archive (SDK fleet/archive.ts).
  // createArchivableFleetRegistry is the shared terminal-shell wrapper over the
  // SDK's withFleetArchive(createProcessRegistry(...)) — one named seam both
  // daemon front-ends build the registry through so it cannot drift.
  const processRegistry = createArchivableFleetRegistry({
    agentManager,
    wrfcController,
    orchestrationEngine,
    codeIndexService: codeIndexStore,
    processManager,
    watcherRegistry,
    workflow,
    approvalBroker,
    sessionBroker,
    messageBus: agentMessageBus,
    automationManager,
    runtimeBus: options.runtimeBus,
    priceUsage,
  });
  // Root/retention guard options come from the user's `checkpoints.*` settings
  // (see config/checkpoint-settings.ts); any key the user did not set is omitted
  // so the SDK manager applies its own default. These guards are defense in
  // depth UNDER the registered-workspaces-only rule below, not replaced by it:
  // even a registered root can still be refused as too broad or too large.
  //
  // Registered-workspaces-only (owner ruling, 2026-07-10; live-gating extended
  // 2026-07-11 so registering mid-launch takes effect without a restart — the
  // same stale-until-restart defect class fixed for permission-mode metadata).
  // The SDK's WorkspaceCheckpointManager only takes automatic turn/agent-
  // lifecycle snapshots when constructed WITH a runtimeBus (see the SDK's own
  // platform/runtime/services.ts, which always passes one). This composition
  // root ALWAYS passes runtimeBus now (so the automatic-snapshot subscription
  // is live from process start regardless of boot-time registration state),
  // and instead gates each individual automatic snapshot attempt through a
  // LIVE re-check via `checkpointsCurrentlyAllowed` below — patched onto this
  // one manager instance's own `create` method, since the SDK has no built-in
  // predicate hook for this. `checkpointsCurrentlyAllowed` is cheap to call on
  // every event: `createWorkspaceRegistrationLiveChecker` probes the git
  // worktree link ONCE (a `git` subprocess spawn) and every call after that
  // only re-reads the shared registration JSON file. "Allowed" means
  // `workingDirectory` resolves as COVERED by the shared registration store
  // (SDK 1.6.1 platform/workspace/registration, via
  // config/workspace-registration.ts — the successor to this fork's local
  // per-user registry, migrated in once below), or the owner has explicitly
  // opted an unregistered workspace back in via
  // `checkpoints.unregisteredWorkspaces: "guarded"` (config/checkpoint-settings.ts;
  // default "off"). Coverage flows down a registered root's subtree AND
  // through the git worktree→main-repo link, so an orchestration-spawned
  // worktree of a registered repo checkpoints automatically without being
  // registered itself. A workspace SWAP at runtime is still not tracked here
  // (WorkspaceSwapManager's rerootStores does not re-root this manager; a swap
  // needs a restart to pick up a new root's registration) — only the
  // registration STATE of this fixed workingDirectory is now live.
  const registrationMigration = migrateLegacyWorkspaceRegistryIfNeeded(shellPaths);
  if (registrationMigration) {
    logger.info('Migrated the local workspace registry into the shared registration store', { ...registrationMigration });
  }
  // After the import migration (records now in the shared store), stamp the ones
  // that came from the agent's OWN explicit list as checkpoint-eligible, so the
  // eligibility boundary below does not retroactively drop workspaces the owner
  // had already opted into checkpoints. Runs once (receipt-gated); derives the
  // explicit set from the still-present legacy registry file. Records lacking the
  // flag (a TUI first-open self-record) stay ineligible — the boundary the owner
  // ruled stays explicit.
  const eligibilityBackfill = backfillCheckpointEligibilityIfNeeded(shellPaths);
  if (eligibilityBackfill && eligibilityBackfill.recordsStamped > 0) {
    logger.info('Marked the agent\'s explicitly-registered workspaces checkpoint-eligible', { ...eligibilityBackfill });
  }
  const checkpointsRegistrationStatus = createWorkspaceRegistrationLiveChecker(shellPaths, workingDirectory);
  const checkpointsCurrentlyAllowed = (): boolean =>
    checkpointsRegistrationStatus() === 'covered' || readCheckpointRegistrationSetting(configManager) === 'guarded';
  const workspaceCheckpointManager = new WorkspaceCheckpointManager({
    workspaceRoot: workingDirectory,
    ...readCheckpointGuardSettings(configManager),
    runtimeBus: options.runtimeBus,
    // Stamp automatic snapshots with the live session id so a checkpoint created
    // during this launch is found by the session-scoped restore/rewind lookup —
    // the fix that makes same-launch activation work without a restart. The
    // resolver is consulted at each lifecycle event, so it tracks the current
    // session even though the id is finalized after this manager is built.
    ...(options.resolveSessionId ? { resolveSessionId: options.resolveSessionId } : {}),
  });
  // Gate AUTOMATIC snapshots (kind 'turn' | 'agent-run', fired internally by
  // the manager's own bus subscription via `this.create(...)`) on the live
  // registration check, by overriding this instance's own `create` method —
  // the manager has no predicate-hook option, and this is the one seam that
  // every automatic-snapshot call and every explicit caller both go through.
  // 'manual' (explicit, gateway-invoked) creates are NOT re-gated here: they
  // already go through checkpointsGatewayManager.create's own live check
  // below, which throws an actionable message BEFORE ever reaching this
  // method — this override would just be a silent, redundant pass for that
  // path. For an automatic snapshot there is no caller to throw to (the
  // manager's own subscription callbacks only `.catch()`-log a rejection), so
  // an automatic attempt against an unregistered/un-guarded workspace resolves
  // to `null` quietly — the same "cheap no-op" contract `create()` already
  // documents for an unchanged tree, not a new error path.
  const originalCreateCheckpoint = workspaceCheckpointManager.create.bind(workspaceCheckpointManager);
  workspaceCheckpointManager.create = ((opts) => {
    if (opts.kind !== 'manual' && !checkpointsCurrentlyAllowed()) return Promise.resolve(null);
    return originalCreateCheckpoint(opts);
  }) as typeof workspaceCheckpointManager.create;
  // Eagerly initialize so the automatic snapshot subscription is wired up
  // immediately (mirrors the SDK's own default runtime services) rather than
  // only on first explicit checkpoints.* call — otherwise the very first
  // TURN_COMPLETED could arrive before anything has touched the manager. Now
  // unconditional (previously skipped for an unregistered-at-boot workspace):
  // the subscription itself is inert-by-gate rather than inert-by-absence, so
  // a workspace registered mid-launch starts producing automatic snapshots on
  // the very next eligible event, with no restart needed to (re)wire the bus.
  void workspaceCheckpointManager.init().catch((err) => {
    logger.warn('WorkspaceCheckpointManager.init failed', { error: err instanceof Error ? err.message : String(err) });
  });
  // Explicit user-invoked checkpoint creation (the ws-only `checkpoints.create`
  // gateway verb) is gated the SAME way: refuse with an actionable hint rather
  // than silently registering the workspace on the caller's behalf. This is
  // the chosen policy for the pending owner ruling (the alternative —
  // register-and-proceed — was NOT chosen, to keep "create a checkpoint" from
  // having a side effect the caller did not ask for). list/diff/restore/
  // sessionChanges are read/restore operations over checkpoints that may
  // already exist (e.g. from a since-unregistered workspace) and are left
  // unrestricted here.
  const checkpointsGatewayManager: Pick<WorkspaceCheckpointManager, 'list' | 'create' | 'diff' | 'restore' | 'sessionChanges' | 'workspaceRoot'> = {
    workspaceRoot: workspaceCheckpointManager.workspaceRoot,
    list: workspaceCheckpointManager.list.bind(workspaceCheckpointManager),
    diff: workspaceCheckpointManager.diff.bind(workspaceCheckpointManager),
    restore: workspaceCheckpointManager.restore.bind(workspaceCheckpointManager),
    sessionChanges: workspaceCheckpointManager.sessionChanges.bind(workspaceCheckpointManager),
    create: (opts) => {
      // Re-reads the registry and setting live via the same cheap checker the
      // automatic-snapshot gate above uses, so registering the workspace via
      // `goodvibes-agent workspaces register` takes effect for the NEXT
      // explicit create call (same as it always has) — and, as of the live
      // gate above, for automatic snapshots too, without a restart either way.
      if (!checkpointsCurrentlyAllowed()) {
        throw new Error(
          `Checkpoints are off for this workspace: ${workingDirectory} is not registered. `
          + 'Register it first, then retry: goodvibes-agent workspaces register --yes '
          + '(or set checkpoints.unregisteredWorkspaces to "guarded" to opt this workspace out of the registration gate).',
        );
      }
      // Default the session stamp from the live resolver when the caller omits it
      // (the resolveSessionId hook only auto-stamps AUTOMATIC snapshots, not
      // explicit create calls). Without this, an explicit checkpoint made this
      // launch would be written unstamped and excluded by the session-scoped
      // restore lookup — the same same-launch activation gap the resolver closes
      // for automatic snapshots. An explicitly supplied sessionId always wins.
      const sessionId = opts.sessionId ?? options.resolveSessionId?.({});
      return workspaceCheckpointManager.create(sessionId ? { ...opts, sessionId } : opts);
    },
  };

  // Live-turn controls holder (SDK round: sessions.toolCalls.cancel,
  // sessions.queuedMessages.list/edit/delete). Empty until an interactive
  // consumer binds a real Orchestrator into it (see bootstrap.ts, right after
  // this repo's own Orchestrator is constructed) — until then the verbs
  // refuse honestly (LIVE_TURN_CONTROLS_UNAVAILABLE), never fake a result.
  const sessionLiveTurnControls = new SessionLiveTurnControlsHolder();

  // Idle-time + slow-schedule memory consolidation, constructed the way the
  // SDK's own RuntimeServices composition root constructs it (platform/
  // runtime/services.ts: `new MemoryConsolidationScheduler({ memoryRegistry,
  // configSource: configManager, isIdle: ... })`), replacing this repo's
  // retired local scheduler/wiring/receipt-store trio. Every run's receipt
  // renders through the SAME attach-time-notice idiom the connected-host
  // receipts use (daemonReceiptFeed below) — a dedicated feed instance so a
  // local consolidation run is never mislabeled "[Connected host]".
  const memoryConsolidationReceiptFeed = new AgentDaemonReceiptFeed();
  const memoryConsolidationScheduler = new MemoryConsolidationScheduler({
    memoryRegistry,
    configSource: configManager,
    isIdle: () => sessionBroker.countBusySessions() === 0,
    onReceipt: (receipt: MemoryConsolidationRunReceipt) => {
      const summary = describeMemoryConsolidationReceipt(receipt);
      if (summary) memoryConsolidationReceiptFeed.push([{ id: receipt.runId, text: summary, at: Date.now() }]);
    },
  });
  memoryConsolidationScheduler.start();

  // Sleep ownership (SDK round: power/*). Constructed exactly as the SDK
  // composition root does: readConfig/writeConfig over the live ConfigManager,
  // runtimeBus bound so real work (a running turn, an active agent, a
  // due schedule) automatically holds the inhibitor, sleep-edge hooks that
  // checkpoint the store snapshots on sleep and catch consolidation + store
  // snapshots + heartbeat back up on wake.
  const powerManager = wireRuntimePower({
    readConfig: (key) => configManager.get(key as never),
    writeConfig: (key, value) => configManager.setDynamic(key as never, value),
    runtimeBus: options.runtimeBus,
    sleepCheckpoint: () => storeSnapshotScheduler.tick(),
    wakeCatchUp: [
      () => memoryConsolidationScheduler.tick(),
      () => storeSnapshotScheduler.tick(),
    ],
  });

  // Attach handlers for every ws-only gateway verb group (fleet.* including
  // the archive verbs, checkpoints.*, sessions.search, push.*, principals.*,
  // channels.profiles.*, ci.*, and — when the deps below are all present —
  // checkin.*). Without this call the catalog carries descriptors but no
  // handlers, and every one of those verbs answers 501 "Gateway method is not
  // invokable" — the same gap the companion app found on the TUI-vendored
  // daemon. Mirrors the SDK runtime's composition root (goodvibes-sdk
  // platform/runtime/services.ts). attachWsOnlyGatewayVerbHandlers is the
  // shared terminal-shell wrapper over the SDK's registerGatewayVerbGroups —
  // the single named call site both front-ends bind these handlers through,
  // gated by the package's conformance check.
  //
  // configManager and runtimeStore are required (SDK 1.6.1): they back
  // sessions.permissionMode.get/set and sessions.contextUsage.get. The four
  // check-in deps (channelDeliveryRouter, providerRegistry, automationManager,
  // sessionLister) are each optional individually, but the check-in verb
  // group (checkin.config.get/set, checkin.run, checkin.receipts.list) is
  // registered ONLY when all four are present — every one of them is already
  // constructed above in this composition root, so the Agent wires all four:
  // the proactive check-in loop runs for real here, not as a facade. Off by
  // default via checkin.enabled (see config/schema-domain-runtime.ts).
  //
  // sessionLiveTurnControls and powerManager (SDK round): register the
  // session-runtime live-turn verbs and the power.* verbs the same way,
  // graceful-degrading to cataloged-but-unhandled if either were ever absent.
  attachWsOnlyGatewayVerbHandlers(gatewayMethods, {
    processRegistry,
    sessionLiveTurnControls,
    powerManager,
    workspaceCheckpointManager: checkpointsGatewayManager,
    sessionBroker,
    secretsManager,
    approvalBroker,
    // The generic broker ask seam (rounds 4-6): CI-watch red runs raise a
    // "fix this?" offer through the same approval machinery as every ask.
    requestApproval: (input) => approvalBroker.requestApproval(input),
    // Recurring CI polling over the same watcher framework the fleet rows
    // already observe; degrades honestly to the manual verb when watchers
    // are disabled (the SDK registrar checks watchers.enabled itself).
    watcherRegistry,
    // permissions.rules.list/.delete over the durable remembered-approval
    // rules constructed above.
    userPermissionRuleStore,
    // Completion push source (rounds 4-6) plus the needs-input source ride
    // the runtime bus's fleet domain. DELIBERATE DIVERGENCE from the SDK
    // composition root: no sessionPresence is passed — the SDK builds its
    // isAttached check from hasFreshSurfaceParticipant, which has no public
    // export path. Absent presence means every needs-input block pushes
    // (the SDK-documented fallback), never a missed notification.
    runtimeBus: options.runtimeBus,
    shellPaths,
    configManager,
    runtimeStore: options.runtimeStore,
    channelDeliveryRouter,
    providerRegistry,
    automationManager,
    sessionLister: sessionBroker,
    // The best-of-N surface (fleet.attempts.list/pick/judge): the
    // orchestration engine already implements FleetAttemptsController
    // (listHeldMergeGroups/pickAttemptWinner/proposeAttemptWinner) — wiring
    // it here is what turns those verbs from cataloged-but-unhandled into
    // real handlers (see src/test/daemon/gateway-ws-only-invokable.test.ts).
    // attemptsController (fleet.attempts.* AND, since the SDK round, fleet.graph.get
    // — the fix workstream's task graph: nodes/edges/pool/stalled tells) — the
    // orchestration engine already implements getGraphSnapshot(workstreamId)
    // structurally, so this ONE line wires both verb families; no local panel
    // renders the graph (this fork has no TUI-style panel system: no
    // src/renderer/*panel* files exist), but the verb still serves the real
    // graph to any remote surface (e.g. a webui FleetView) that queries this
    // runtime — see src/test/daemon/gateway-fleet-graph-get.test.ts.
    attemptsController: orchestrationEngine,
    // worktrees.setup.run (SDK 1.6.1): the rerun affordance for worktree
    // cold-start setup, registered over a WorktreeRegistry rooted at this
    // daemon's own working directory (matching worktrees.snapshot's reader)
    // only when workingDirectory is present. It already is here — this was a
    // real cataloged-but-unhandled gap (found by the gateway parity pin
    // sweep, see src/test/daemon/gateway-parity-verb-families.test.ts) with
    // no reason to leave unfixed: the daemon's own working directory was
    // already in scope in this composition root (see
    // checkpointsGatewayManager above).
    workingDirectory,
    // Conversation half of the unified rewind (rewind.plan/apply with scope
    // 'conversation' or 'both'): this Agent's own ConversationManager (see
    // src/core/conversation.ts) IS a genuine in-process mutable conversation
    // store — the exact shape RewindConversationPort assumes ("a daemon-hosted
    // mutable conversation store") — so it is wired here rather than left
    // null, ported from goodvibes-tui's identical seam
    // (conversation-rewind-port.ts, registerSessionConversation at bootstrap;
    // see bootstrap-core.ts). createSessionConversationRewindPort() reads the
    // live per-session registry lazily (no conversation reference needed at
    // construction time), so it can be called here even though bootstrap
    // wires the actual session registration separately. See
    // src/test/daemon/gateway-rewind-conversation-scope.test.ts for the live
    // proof this resolves a real conversation, not a stub.
    conversationRewindPort: createSessionConversationRewindPort(),
  });
  // Turn the fleet registry's coalesced snapshot tick into poll-free
  // spawn/progress/attention/completion events on the runtime event bus's
  // 'fleet' domain (SDK 1.6.1, runtime/fleet/emit-bridge.ts) — the SDK's own
  // doc note on this bridge: "The control-plane gateway already fans every
  // runtime-bus domain out to subscribed SSE/WebSocket clients, so no
  // gateway/channel change is needed once the fleet domain exists." Without
  // this call the fleet.* gateway verbs above still answer pull queries
  // (fleet.snapshot/fleet.list), but nothing pushes live deltas — a webui
  // FleetView watching this agent's orchestrator-spawned sub-agents would see
  // them only on manual refresh, never their attention state flipping to
  // needs-input in real time. No unsubscribe is kept: the bridge is meant to
  // live for the registry's lifetime (same non-disposed pattern as the
  // fleet/push verb registrations just above; see the SDK's own doc comment
  // on attachFleetEmitBridge).
  attachFleetEmitBridge({ registry: processRegistry, bus: options.runtimeBus });

  // The relay step-up ceremony service the SDK's RuntimeServices requires (and
  // the daemon facade dereferences at start). Constructed exactly as the SDK
  // composition root does, from the public @pellux/goodvibes-sdk/daemon export.
  const stepUpService = new StepUpService({ secrets: secretsManager });

  return {
    stepUpService,
    pairingTokens,
    workingDirectory,
    homeDirectory,
    shellPaths,
    configManager,
    featureFlags,
    contextAccountingHolder,
    orchestrationEngine,
    codeIndexStore,
    codeIndexReindexScheduler,
    storeSnapshotScheduler,
    userPermissionRuleStore,
    processRegistry,
    workspaceCheckpointManager,
    runtimeBus: options.runtimeBus,
    runtimeStore: options.runtimeStore,
    runtimeDispatch,
    panelManager,
    keybindingsManager,
    routeBindings,
    surfaceRegistry,
    channelPlugins,
    channelDeliveryRouter,
    watcherRegistry,
    approvalBroker,
    localhostFetchApproval,
    featureAnnouncementStore: announcementStore,
    onSandboxedRun,
    sessionBroker,
    sessionSpineClient,
    daemonReceiptFeed,
    consumeDaemonReceipts,
    memoryConsolidationReceiptFeed,
    memoryConsolidationScheduler,
    powerManager,
    sessionLiveTurnControls,
    deliveryManager,
    automationManager,
    gatewayMethods,
    artifactStore,
    knowledgeService: agentKnowledgeService,
    agentKnowledgeService,
    homeGraphService,
    projectPlanningService,
    projectPlanningProjectId,
    workPlanStore,
    memoryStore,
    memoryRegistry,
    memorySpineClient,
    memorySpineTransport,
    serviceRegistry,
    secretsManager,
    subscriptionManager,
    localUserAuthManager,
    profileManager,
    bookmarkManager,
    sessionManager,
    sessionOrchestration,
    hookDispatcher,
    hookActivityTracker,
    hookWorkbench,
    pluginManager,
    workflow,
    voiceProviders,
    voiceService,
    webSearchProviders,
    webSearchService,
    mediaProviders,
    multimodalService,
    memoryEmbeddingRegistry,
    channelPolicy,
    mcpRegistry,
    tokenAuditor,
    componentHealthMonitor,
    worktreeRegistry,
    sandboxSessionRegistry,
    webhookNotifier,
    focusTracker,
    replayEngine,
    providerOptimizer,
    providerCapabilityRegistry,
    cacheHitTracker,
    favoritesStore,
    benchmarkStore,
    modelLimitsService,
    providerRegistry,
    toolLLM,
    distributedRuntime,
    remoteRunnerRegistry,
    remoteSupervisor,
    sessionMemoryStore,
    sessionLineageTracker,
    sessionChangeTracker,
    planManager,
    adaptivePlanner,
    idempotencyStore,
    overflowHandler,
    policyRuntimeState,
    archetypeLoader,
    agentManager,
    agentMessageBus,
    agentOrchestrator,
    wrfcController,
    processManager,
    modeManager,
    fileUndoManager,
    executionLedger,
    integrationHelpers,
    async rerootStores(newWorkingDir: string): Promise<void> {
      await projectIndex.reroot(newWorkingDir);
    },
  };
}

/**
 * Fold the agent's legacy per-surface memory store into the canonical
 * cross-surface store. Called once at boot AFTER `memoryStore.init()` so any records
 * written before unification survive. Id-keyed and idempotent — a re-run imports
 * nothing new and never deletes the legacy file. Returns the report so boot can log
 * exactly what moved (nothing is silently dropped).
 */
export async function foldAgentLegacyMemory(
  memoryStore: MemoryStore,
  memoryEmbeddingRegistry: MemoryEmbeddingProviderRegistry,
  shellPaths: ShellPathService,
): Promise<MemoryFoldReport> {
  const legacyAgentGlobal = shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'memory.sqlite');
  const sources: LegacyMemorySource[] = [
    { label: 'agent-global (pre-E6)', dbPath: legacyAgentGlobal },
  ];
  return foldMemoryStores(memoryStore, sources, { embeddingRegistry: memoryEmbeddingRegistry });
}
