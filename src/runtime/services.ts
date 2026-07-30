import { join } from 'node:path';
import { StepUpService } from '@pellux/goodvibes-sdk/daemon';
import { PairingTokenManager } from '@pellux/goodvibes-sdk/platform/pairing';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { shell as runtimeShell, operations as runtimeOperations } from '@pellux/goodvibes-sdk/platform/runtime';
// The graph's shutdown seam. Shared with the SDK composition root rather than
// reimplemented here, so "which pollers exist" has exactly one answer across
// both compositions: RuntimePollerOwners is all-required, and a poller added to
// this fork's graph later cannot compile without being named for teardown.
import { createDisposalScope, registerRuntimePollers } from '@pellux/goodvibes-sdk/platform/runtime/disposal';
import type { shell as RuntimeShell, bootstrap as RuntimeBootstrap } from '@pellux/goodvibes-sdk/platform/runtime';
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
import { reasoningEffortSpecFromLevels } from '@pellux/goodvibes-sdk/platform/providers';
import { logger, singleFlight, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
// SDK-owned memory governance (public since sdk 4d5e247b published the
// composition surface): the same CacheRegistry/PauseController/MemoryGovernor
// wiring the SDK's own daemon composition constructs and starts.
import {
  CacheRegistry,
  PauseController,
  wireDaemonMemoryGovernance,
  type MemoryGovernor,
} from '@pellux/goodvibes-sdk/platform/runtime/memory';
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
import { AgentManager, cancelAllAgentRuns } from '@pellux/goodvibes-sdk/platform/tools';
import { AgentMessageBus } from '@pellux/goodvibes-sdk/platform/agents';
import { WrfcController } from '@pellux/goodvibes-sdk/platform/agents';
import { continuationChainOptions } from '@pellux/goodvibes-sdk/platform/agents';
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
import { createUnavailablePowerSeam, wireRuntimePower } from '@pellux/goodvibes-sdk/platform/power';
import { forwardKeepAwakeToAdoptedDaemon } from '../agent/power-keep-awake-remote.ts';
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
import { TriggerManager } from '@pellux/goodvibes-sdk/platform/triggers';
import { createBunStreamHost, createProcessManagerTriggerHost, createTriggerActionExecutor } from '@pellux/goodvibes-sdk/platform/triggers';
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
import {
  VoiceProviderRegistry,
  VoiceService,
  ensureBuiltinVoiceProviders,
} from '@pellux/goodvibes-sdk/platform/voice';
import { createVoiceSetupService, type VoiceSetupService } from '@pellux/goodvibes-sdk/platform/runtime/voice-setup';
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
import { createSessionSurface, type SessionSurface } from '@/runtime/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';
import type { FeatureFlagManager } from '@/runtime/index.ts';
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
import { attachAgentSessionWriteLedger, clearAgentSessionWrites } from '../tools/agent-session-write-ledger.ts';
import { VERSION } from '../version.ts';
import { ClientBuildGuard } from './client-build-compatibility.ts';

type WorktreeRegistry = RuntimeShell.WorktreeRegistry;
// The SDK's FULL runtime-services shape, taken from the runtime bootstrap
// namespace's public RuntimeServices type alias. This repo's RuntimeServices
// extends it and is handed to SDK consumers typed against the whole thing
// (startHostServices, DaemonServer, createObservabilityReadModels).
type SdkRuntimeServices = RuntimeBootstrap.RuntimeServices;
// Compile-pin: the public RuntimeServices alias must stay exactly the shape
// startHostServices consumes as its 4th parameter. If the SDK ever diverges
// its two public runtime surfaces, this mutual-assignability check fails and
// surfaces the drift here at build time.
type AssertTrue<T extends true> = T;
type _SdkRuntimeServicesPin = AssertTrue<
  SdkRuntimeServices extends Parameters<typeof import('@/runtime/index.ts').startHostServices>[3]
    ? Parameters<typeof import('@/runtime/index.ts').startHostServices>[3] extends SdkRuntimeServices
      ? true
      : false
    : false
>;
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
    ...(isReasoningProvider ? { reasoningEffort: reasoningEffortSpecFromLevels(['instant', 'low', 'medium', 'high']) } : {}),
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

export function ensureConfiguredModelIsRoutable(providerRegistry: ProviderRegistry, configManager: ConfigManager): void {
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

/**
 * Managed voice provisioning: the surface this Agent exposes both to its own
 * slash commands (/voice status, /voice setup, /voice wake status, /voice wake
 * setup) and to the voice.local.* and voice.wake.* gateway verbs.
 *
 * An alias for the SDK's own service type rather than a locally-declared shape.
 * It was declared locally while the SDK's composition was internal; now that
 * createVoiceSetupService is exported, a separate declaration could only drift
 * from what is actually constructed — and the wake trio it grew (wakeStatus,
 * wakeProvision, wakeModelChunk) is exactly the kind of addition a hand-written
 * mirror silently misses until the gateway registration stops typechecking.
 */
export type AgentVoiceSetupService = VoiceSetupService;

/**
 * The narrow live-snapshot slice /health memory reads. A Pick over the SDK's
 * real MemoryGovernor so the command surface can be handed the composed
 * governor without gaining pause/exit authority.
 */
export type AgentMemoryDiagnostics = Pick<MemoryGovernor, 'snapshot'>;

/**
 * How a runtime treats the live model-discovery sweep. See
 * {@link RuntimeServicesOptions.modelDiscovery}.
 */
export type ModelDiscoveryMode = 'refresh' | 'skip';

/**
 * The default is `'refresh'` — absent means refresh, which is what every
 * composition did before the option existed. Exported so the decision can be
 * driven directly rather than inferred from the source text of its call site.
 */
export function shouldRefreshModels(mode: ModelDiscoveryMode | undefined): boolean {
  return (mode ?? 'refresh') === 'refresh';
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
  /**
   * Host power seam opt-in. Left ABSENT, createRuntimeServices defaults to the
   * SDK's non-spawning "unavailable" seam so a test-constructed runtime never
   * spawns systemd-inhibit inhibitors or a dbus-monitor sleep-edge watcher.
   * Only the real long-lived composition that owns the sleep edge (the embedded
   * interactive runtime — see bootstrap-core.ts) passes createHostPowerSeam()
   * to opt into live OS keep-awake / idle-inhibit.
   */
  readonly powerSeam?: Parameters<typeof wireRuntimePower>[0]['seam'];
  /**
   * What the runtime does about the provider registry's live model-discovery
   * sweep.
   *
   * DEFAULT `'refresh'`, which is what every composition did before this option
   * existed. The sweep reaches each configured provider's models endpoint and
   * writes `<configDir>/provider-models/<provider>.json`, so the runtime routes
   * against the models a provider actually serves rather than a stale list.
   *
   * `'skip'` starts nothing and leaves whatever list is already on disk in
   * place. It exists for callers whose process will not outlive the sweep: the
   * write is unawaited, and under test it landed AFTER the run had finished and
   * re-created a temp workspace that cleanup had already removed. That is a
   * property of the caller's lifetime, not a property of the product, so the
   * test setup opts out explicitly and the shipped default is unchanged.
   *
   * A named mode rather than a boolean because a third answer is foreseeable
   * (refresh-and-await, for a one-shot CLI that wants a fresh list before it
   * answers) and a boolean cannot grow one without changing every call site.
   */
  readonly modelDiscovery?: ModelDiscoveryMode;
}

export interface RuntimeServices extends SdkRuntimeServices {
  readonly workingDirectory: string;
  readonly homeDirectory: string;
  /**
   * The declare-once session-storage handle (platform/runtime/session-surface.ts),
   * built exactly once here from workingDirectory/homeDirectory/GOODVIBES_AGENT_SURFACE_ROOT.
   * Every session-persistence, SessionManager, and checkpoint call site threads
   * this through instead of re-deriving those three values independently, so a
   * writer and a reader can never disagree about where a file lives.
   */
  readonly surface: SessionSurface;
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
  /**
   * Trigger family supervisor (stream watchers, model-free condition checks,
   * on-exit process triggers). Constructed unconditionally so
   * `watchers.triggers.enabled` is a real runtime toggle; it does no work
   * while that flag is false. The SDK daemon facade start()/shutdown()s it.
   */
  readonly triggerManager: TriggerManager;
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
  /**
   * Managed local-voice provisioning: status read + one-act install, mirroring
   * the SDK's own daemon composition (platform/runtime/services.ts).
   */
  readonly voiceSetup: AgentVoiceSetupService;
  /**
   * SDK-owned memory governance, composed here exactly as the SDK's own
   * daemon composition does (constructed and STARTED by default — it is a
   * safety feature): samples RSS/heap, sheds registered caches by tier,
   * pauses deferrable background jobs, and trips on a genuine leak before
   * the OS OOM-kills the process. Serves ops.memory.get and /health memory.
   */
  readonly memoryGovernor: MemoryGovernor;
  /** Registry of every retained cache the governor can observe and shrink. */
  readonly cacheRegistry: CacheRegistry;
  /** Backpressure seam the governor drives to pause/resume deferrable background jobs. */
  readonly pauseController: PauseController;
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
  /** Detaches the session write ledger from the runtime bus and clears it. */
  readonly disposeSessionWriteLedger: () => void;
  /**
   * Stop every poller this graph started (config watch, fleet tick, memory
   * governor, watcher registry, cross-session sweep, orchestration writer, push
   * sweep, both knowledge schedulers, the snapshot/retention/consolidation
   * schedulers, the spine keepalive) and release their handles.
   *
   * Restated from the SDK interface because ownership differs here: this fork
   * composes no DaemonServer of its own, so nothing else will ever call this.
   * Every path that builds a graph owns taking it back down. Best-effort, total
   * and idempotent — an owner that throws is logged and the rest still come down.
   */
  dispose(): void;
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
  const disposalScope = createDisposalScope('RuntimeServices'); // see @pellux/goodvibes-sdk/platform/runtime/disposal
  const workingDirectory = options.workingDir;
  const homeDirectory = options.homeDirectory;
  const shellPaths = createShellPathService({
    workingDirectory,
    homeDirectory,
  });
  const surface = createSessionSurface({
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
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
  // featureFlags is REQUIRED here in practice, even though the SDK types it
  // optional. `isFeatureGateEnabled(null, ...)` is permissive by design — a
  // narrow embed with no manager wired gets the capability rather than a silent
  // off — so omitting it did not disable route binding. It did something worse:
  // it made `integrations.routeBinding` configure nothing at all. The setting
  // rendered, accepted a write, reported success, and the manager went on
  // resolving bindings either way, which is the exact shape of the defect the
  // Telegram-bot-username round was about: a value that looks applied and is
  // not. The TUI has always threaded it (runtime/channel-composition.ts); this
  // fork's composition root did not.
  //
  // Threading it preserves current effective behaviour rather than changing it:
  // the config default is true (the SDK's schema-domain-features.ts), the flag's
  // own defaultState is 'enabled', and the flag declares no notOperable record —
  // so with nothing configured the gate reads exactly as it did before, and the
  // difference is only that turning it OFF now turns it off.
  const routeBindings = new RouteBindingManager({
    store: new AutomationRouteStore({ configManager }),
    runtimeStore: options.runtimeStore,
    runtimeBus: options.runtimeBus,
    featureFlags,
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
  if (shouldRefreshModels(options.modelDiscovery)) providerRegistry.initProviderModelDiscovery();
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
  const sessionManager = new SessionManager(workingDirectory, { surface });
  const sessionOrchestration = new CrossSessionTaskRegistry(
    shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'sessions', 'task-graph.json'),
  );
  const hookActivityTracker = new HookActivityTracker();
  // featureFlags is REQUIRED here in practice, even though the SDK types it
  // optional. isFeatureGateEnabled(null, ...) is permissive by design — a
  // narrow embed with no manager wired gets the capability rather than a
  // silent off — so omitting it did not disable the watcher framework when
  // watchers.enabled is turned off; it made the setting configure nothing.
  // Threading it preserves current effective behaviour rather than changing
  // it: watchers.enabled defaults true, the watcher-framework flag's own
  // defaultState is 'enabled', and the flag declares no notOperable record —
  // so with nothing configured the gate reads exactly as before, and the
  // difference is only that turning it OFF now turns it off. The TUI has
  // always threaded it the same way.
  const watcherRegistry = new WatcherRegistry({
    storePath: shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'watchers.json'),
    featureFlags,
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
  // agentManager is DELIBERATELY not threaded, unlike the TUI's own dispatcher.
  // A `type: 'agent'` hook here answers "agent hook runner is not configured in
  // this runtime" and spawns nothing, which is this product's chosen posture and
  // is pinned by src/test/runtime/bootstrap-services.test.ts. Do not "fix" this
  // by passing the manager that sits a few lines above: the omission is the
  // feature, and the test asserts both the refusal and that no agent was spawned.
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
    // Without this the conversation gate runs on DEFAULTS: an inbound channel
    // message landing in an already-live session takes the live-agent handover
    // and starts work whatever conversationGate.mode/gatedSurfaces say.
    conversationGateConfig: configManager,
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
  // A daemon update swaps the daemon binary and leaves this process running the
  // build it started with. The daemon announces the minimum client build it
  // accepts on the same /status read the liveness probe already makes; when
  // this build is below it, the guard latches, the owner is told in the receipt
  // feed that already renders daemon notices, and the continuation runner below
  // stops taking shared-session work rather than executing it under superseded
  // rules. See runtime/client-build-compatibility.ts.
  const clientBuildGuard = new ClientBuildGuard({
    clientVersion: VERSION,
    onRestartRequired: (verdict) => {
      logger.warn('daemon requires a newer client build; shared-session work is paused', {
        clientVersion: verdict.clientVersion,
        floor: verdict.floor,
      });
      daemonReceiptFeed.push([{ id: `client-build-floor:${verdict.floor ?? 'unknown'}`, text: verdict.message, at: Date.now() }]);
    },
  });
  const sessionSpineClient = new SessionSpineClient({
    participant: AGENT_SPINE_PARTICIPANT,
    transport: createSpineRestTransport({ resolveConnection: spineResolveConnection }),
    // Liveness only: a plain /status read that never consumes receipts. The
    // once-per-attach consuming read above is the agent's receipt reader.
    probe: createSpineRestProbe({
      resolveConnection: spineResolveConnection,
      onDaemonFloor: (floor) => clientBuildGuard.observeFloor(floor),
    }),
    log: logger,
  });
  sessionBroker.setContinuationRunner(async ({ task, input }) => {
    // Too old for the live daemon: refuse the work instead of doing it the old
    // way. The owner has already been told to restart this process.
    if (!clientBuildGuard.maySharedSessionWork()) {
      logger.warn('declined a shared-session continuation: this build is below the daemon floor', {
        sessionId: input.sessionId,
        floor: clientBuildGuard.current().floor,
      });
      return null;
    }
    const record = agentManager.spawn({
      mode: 'spawn',
      task,
      // Conversation first: a follow-up message in a session gets an answer,
      // not a write-review-fix-confirm chain with a reviewer, quality gates,
      // and a second agent. A chain opens only for an explicit authorization
      // marker — set by the channel confirmation the owner gave, or by the
      // schedule/trigger that was confirmed when it was created — or for a
      // follow-up typed on a local surface. Both `conversationGate.mode` and
      // the `gatedSurfaces` list now read the live config: the 1.21.0 re-pin
      // carries the `conversationGate` schema domain, so `getCategory` reads
      // the configured surface list instead of falling back to the SDK's
      // shipped defaults.
      ...continuationChainOptions(input, {
        configReader: {
          get: (key: string) => configManager.get(key as never),
          getCategory: (name: string) => configManager.getCategory(name as never),
        },
      }),
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
  // featureFlags is REQUIRED here in practice, even though the SDK types it
  // optional. isFeatureGateEnabled(null, ...) is permissive by design, so
  // omitting it did not disable delivery tracking when
  // integrations.deliveryTracking is turned off — deliverText/deliverJobRun
  // kept running either way. Threading it preserves current effective
  // behaviour rather than changing it: the config default is true, the
  // delivery-engine flag's own defaultState is 'enabled', and the flag
  // declares no notOperable record — so with nothing configured the gate
  // reads exactly as before. Same fix as goodvibes-tui's services.ts.
  const deliveryManager = new AutomationDeliveryManager({
    configManager,
    // Required: the router this builds resolves goodvibes://secrets/...
    // surface credentials through it. Omitting it produced a delivery path
    // that accepted replies and dropped them at send time — see the same fix
    // in goodvibes-tui and the SDK's now-mandatory parameter.
    secretsManager,
    serviceRegistry,
    runtimeBus: options.runtimeBus,
    runtimeStore: options.runtimeStore,
    routeBindings,
    artifactStore,
    featureFlags,
  });
  // Same shape as deliveryManager above: automation.enabled defaults true, the
  // automation-domain flag's own defaultState is 'enabled', so threading
  // featureFlags here does not change what a default install does — it only
  // makes turning automation.enabled off actually turn AutomationManager's own
  // create/update/run/list surface off. This composes with bootstrap.ts's own
  // `if (configManager.get('automation.enabled'))` gate around scheduling
  // automationManager.start(): that check reads the same key, and
  // AutomationManager.start() re-checks the same gate internally (it no-ops
  // and stops rather than starting when disabled), so the two can never
  // disagree — this fix only reaches the manager's OTHER entry points
  // (createJob/updateJob/runNow/etc.) that the bootstrap.ts gate does not
  // cover.
  const automationManager = new AutomationManager({
    configManager,
    defaultSurfaceKind: 'service',
    routeBindings,
    sessionBroker,
    runtimeStore: options.runtimeStore,
    runtimeBus: options.runtimeBus,
    deliveryManager,
    providerRegistry,
    featureFlags,
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
  // Memory-governance seams, built EARLY exactly as the SDK's own daemon
  // composition builds them (platform/runtime/services.ts): the knowledge
  // background job and the consolidation scheduler consult the pause
  // controller and the late-bound admission gate below before the
  // MemoryGovernor (constructed + started at the composition tail via
  // wireDaemonMemoryGovernance) drives them. `admitExpensiveWork` is a
  // late-bound closure: until the governor exists, everything is admitted
  // (the process is still booting).
  const cacheRegistry = new CacheRegistry();
  const pauseController = new PauseController();
  // Same job ids as the SDK composition. This fork runs the first two for
  // real; 'code-index-reindex' is registered for contract parity even though
  // this fork's reindex scheduler is permanently disabled (isEnabled: () =>
  // false below) — a registered-but-never-scheduled job pauses as a no-op.
  const MEMORY_BACKGROUND_JOB_IDS = ['knowledge-self-improvement', 'memory-consolidation', 'code-index-reindex'];
  const admitExpensiveWorkRef: { current: ((label: string) => { allowed: boolean; reason?: string | undefined }) | null } = { current: null };
  const admitExpensiveWork = (label: string): { allowed: boolean; reason?: string | undefined } =>
    admitExpensiveWorkRef.current?.(label) ?? { allowed: true };
  const isKnowledgeBackgroundPaused = (): boolean => pauseController.isPaused('knowledge-self-improvement');
  const knowledgeSemanticLlm = createProviderBackedKnowledgeSemanticLlm(providerRegistry, {
    timeoutMs: 20_000,
    maxConcurrent: 1,
  });
  const agentKnowledgeSemanticService = new KnowledgeSemanticService(agentKnowledgeStore, {
    llm: knowledgeSemanticLlm,
    maxLlmSourcesPerReindex: 3,
    isBackgroundPaused: isKnowledgeBackgroundPaused,
    admitExpensiveWork,
  });
  const homeGraphSemanticService = new KnowledgeSemanticService(homeGraphKnowledgeStore, {
    llm: knowledgeSemanticLlm,
    maxLlmSourcesPerReindex: 3,
    objectProfiles: HOME_GRAPH_KNOWLEDGE_EXTENSION.objectProfiles,
    isBackgroundPaused: isKnowledgeBackgroundPaused,
    admitExpensiveWork,
  });
  const agentKnowledgeService = new KnowledgeService(agentKnowledgeStore, artifactStore, undefined, {
    memoryRegistry,
    runtimeBus: options.runtimeBus,
    semanticService: agentKnowledgeSemanticService,
    admitExpensiveWork,
  });
  agentKnowledgeService.attachRuntimeBus(options.runtimeBus);
  const homeGraphService = new companionGraphServiceConstructor(homeGraphKnowledgeStore, artifactStore, {
    semanticService: homeGraphSemanticService,
    admitExpensiveWork,
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

  // Managed local-voice provisioning (voice.local.status/install) AND the
  // wake-word artifact service behind voice.wake.status/provision/model.get.
  //
  // This used to be a hand-mirrored copy of the SDK's own daemon composition,
  // because platform/runtime/voice-setup.ts was internal there. It is exported
  // now, so the copy is gone and the platform owns what it always owned: the
  // single-flight install, the ownership-aware preconfigure that never
  // overwrites a genuinely user-set value, the reset of the local engine's
  // tripped failure state after a successful (re-)install, the critical-tier
  // MemoryGovernor admission gate, the live install-progress tracker folded
  // into status() while (and only while) an install runs, and the checksum-
  // pinned wake provisioning the same managed root holds under `wake`.
  const managedVoiceRoot = shellPaths.resolveUserPath('voice');
  const voiceSetup: AgentVoiceSetupService = createVoiceSetupService({
    managedVoiceRoot,
    getConfig: (key) => String(configManager.get(key as never) ?? ''),
    setConfig: (key, value) => configManager.setDynamic(key as never, value),
    resetLocalEngineFailureState: () => { voiceProviders.get('local')?.resetEngineFailureState?.(); },
    admitExpensiveWork,
  });

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
  // featureFlags is REQUIRED here in practice, even though the SDK types it
  // optional. isFeatureGateEnabled(null, ...) is permissive by design, so
  // omitting it did not disable managed blocking when
  // security.tokenAudit.enabled is turned off. Threading it preserves current
  // effective behaviour rather than changing it: managed is hardcoded false
  // here (advisory reporting only; excess-scope/overdue tokens are reported,
  // never blocked, regardless of this flag — see isBlocked()'s
  // `this._config.managed && this._managedBlockingEnabled()` guard), the
  // config default for security.tokenAudit.enabled is true, and the
  // token-scope-rotation-audit flag's own defaultState is 'enabled' — so with
  // nothing configured the gate reads exactly as before either way.
  const tokenAuditor = new ApiTokenAuditor({ managed: false, featureFlags });
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
  // featureFlags is REQUIRED here in practice, even though the SDK types it
  // optional. isFeatureGateEnabled(null, ...) is permissive by design, so
  // omitting it did not disable the HITL UX mode system when
  // behavior.hitlMode is set to 'off' — setHITLMode/setDomainVerbosity kept
  // accepting writes either way. Threading it preserves current effective
  // behaviour rather than changing it: behavior.hitlMode defaults to
  // 'balanced' (not 'off'), and the hitl-ux-modes flag's own defaultState is
  // 'enabled' — so with nothing configured the gate reads exactly as before.
  const modeManager = new ModeManager({ featureFlags });
  const fileUndoManager = new FileUndoManager();
  const executionLedger = new AgentExecutionLedger(options.runtimeBus);
  // Tracks which paths this session's own write/edit tools produced, so the
  // read guard can tell a file the agent just authored from someone else's
  // hidden file (see tools/agent-read-policy.ts).
  const detachSessionWriteLedger = attachAgentSessionWriteLedger(options.runtimeBus);
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
  // Surface-scoped, not the loose workingDirectory/homeDirectory pair. This
  // product declares its own `.goodvibes/<surface>/` root and writes everything
  // through it, and the SDK's two construction scopes are a mutually exclusive
  // union precisely so the choice is deliberate: constructed with the legacy
  // fields, this service's continuity reads — the recovery-file check among them
  // — resolve to the UNSCOPED directories, i.e. to paths nothing in this product
  // has ever written to. It answers, and it answers about the wrong place. The
  // TUI carries the same note on its own construction.
  const integrationHelpers = new IntegrationHelperService({
    surface,
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
    join(workingDirectory, '.goodvibes', GOODVIBES_AGENT_SURFACE_ROOT, 'code-index.sqlite'),
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
      { name: 'code index store', dbPath: join(workingDirectory, '.goodvibes', GOODVIBES_AGENT_SURFACE_ROOT, 'code-index.sqlite') },
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
  const appendOnlyRetentionRoots = {
    workingDirectory,
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    homeDirectory,
    logDir: shellPaths.resolveProjectPath('logs'),
    telemetryDir: shellPaths.resolveProjectPath('telemetry'),
  };
  const appendOnlyRetentionConfigGet = (key: string): unknown => configManager.get(key as never);
  runtimeOperations.runStartupAppendOnlySweep(appendOnlyRetentionRoots, appendOnlyRetentionConfigGet);
  // ...and again on a cadence for as long as this process lives. A start-time
  // sweep alone never prunes a long-lived process again after boot, which is
  // exactly the window in which these stores grow. Unref'd timers; the host
  // that tears the runtime down stop()s it, same posture as
  // storeSnapshotScheduler.
  const appendOnlyRetentionScheduler = new runtimeOperations.AppendOnlyRetentionScheduler({
    roots: appendOnlyRetentionRoots,
    configGet: appendOnlyRetentionConfigGet,
  });
  appendOnlyRetentionScheduler.start();
  // External config edits apply LIVE through the same subscribe() pipeline an
  // in-process set() uses — a hand-edited settings.json needs no restart to
  // take effect. The underlying file watchers are unref'd (SDK round), so
  // this can never pin the process open.
  const stopConfigWatch = configManager.watchConfigFiles(); // handle kept: dropping it is what left a 250ms poll running forever
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
  // Trigger family. Mirrors the SDK factory's own composition: config is a
  // CLOSURE over configManager (so the flag toggles at runtime rather than only
  // at restart) and the process host is ProcessManager-backed, so a supervised
  // on-exit child inherits the same credential-env scrub, live output
  // collection and SIGTERM/SIGKILL watchdog as any other background command.
  const triggerManager = new TriggerManager({
    storePath: shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'triggers.json'),
    config: () => ({
      enabled: configManager.get('watchers.triggers.enabled'),
      backoffLadderMs: configManager.get('watchers.triggers.backoffLadderMs'),
      breakerStrikes: configManager.get('watchers.triggers.breakerStrikes'),
      defaultCheckIntervalMs: configManager.get('watchers.triggers.defaultCheckIntervalMs'),
      probeTimeoutMs: configManager.get('watchers.triggers.probeTimeoutMs'),
      maxConcurrentChecks: configManager.get('watchers.triggers.maxConcurrentChecks'),
      observationRingSize: configManager.get('watchers.triggers.observationRingSize'),
      runHistoryLimit: configManager.get('watchers.triggers.runHistoryLimit'),
      runHistoryTtlHours: configManager.get('watchers.triggers.runHistoryTtlHours'),
      eventLogLimit: configManager.get('watchers.triggers.eventLogLimit'),
      eventLogTtlHours: configManager.get('watchers.triggers.eventLogTtlHours'),
      sweepIntervalMs: configManager.get('watchers.triggers.sweepIntervalMs'),
      supervisionTickMs: configManager.get('watchers.triggers.supervisionTickMs'),
      streamQueueLimit: configManager.get('watchers.triggers.streamQueueLimit'),
      streamBatchLines: configManager.get('watchers.triggers.streamBatchLines'),
      streamBatchIntervalMs: configManager.get('watchers.triggers.streamBatchIntervalMs'),
      onExitMaxDurationMs: configManager.get('watchers.triggers.onExitMaxDurationMs'),
      onExitStdin: configManager.get('watchers.triggers.onExitStdin'),
      outputTailBytes: configManager.get('watchers.triggers.outputTailBytes'),
    }),
    actions: createTriggerActionExecutor({ agents: agentManager, processManager }),
    processHost: createProcessManagerTriggerHost(processManager),
    streamHost: createBunStreamHost(),
    sessionIsLive: (sessionId: string) => sessionBroker.getSession(sessionId) !== null,
  });

  const processRegistry = createArchivableFleetRegistry({
    agentManager,
    wrfcController,
    orchestrationEngine,
    codeIndexService: codeIndexStore,
    processManager,
    watcherRegistry,
    triggerSupervisor: triggerManager,
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
    // Resolves the checkpoint git store to surface.checkpointsDir
    // (<workingDirectory>/.goodvibes/agent/checkpoints) instead of the legacy,
    // surface-unaware <workspaceRoot>/.goodvibes/checkpoints — which the TUI
    // and Agent would otherwise SHARE when run against the same working
    // directory. Fixed to the surface's own workingDirectory regardless of
    // preferGitRoot; readCheckpointGuardSettings may still override via an
    // explicit checkpointDir, which the SDK's own resolution order respects
    // over this surface default. The SDK migrates the legacy checkpoint dir
    // into this scoped location automatically on first surface use.
    surface,
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
    // Idle AND not paused by the governor AND admitted at the current memory
    // tier — memory pressure defers consolidation (mirrors the SDK's own
    // daemon composition of this same scheduler).
    isIdle: () => sessionBroker.countBusySessions() === 0
      && !pauseController.isPaused('memory-consolidation')
      && admitExpensiveWork('memory consolidation').allowed,
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
    // Non-spawning default: without an explicit opt-in the seam is the SDK's
    // honest "unavailable" seam, NOT the spawning host seam that
    // wireRuntimePower would otherwise pick for an undefined seam. This keeps
    // every test-constructed runtime (and one-shot CLI subcommands) from
    // spawning systemd-inhibit inhibitors or a dbus-monitor sleep-edge watcher.
    // Only the real long-lived composition that owns the sleep edge — the
    // embedded interactive runtime in bootstrap-core.ts — passes
    // powerSeam: createHostPowerSeam() to hold a LOCAL OS inhibitor for
    // keep-awake / idle-inhibit while the process lives. Pinned by
    // power-keep-awake-composition.test.ts.
    seam: options.powerSeam ?? createUnavailablePowerSeam('runtime services constructed without a host power seam'),
    readConfig: (key) => configManager.get(key as never),
    writeConfig: (key, value) => configManager.setDynamic(key as never, value),
    // Live-apply straight from the SDK's own PowerManager (SDK round: the
    // config live-apply is SDK-side now — see manager.ts's
    // unsubscribeKeepAwakeConfig). A power.keepAwake change from ANY origin
    // (settings modal, CLI flag, or an external settings.json edit reaching
    // configManager via watchConfigFiles()) flips this process's real
    // inhibitor with no bespoke onSettingApplied special case needed —
    // ui-openers.ts's former manual `powerManager.setKeepAwake(...)` call is
    // retired in favor of this.
    subscribeConfig: (key, cb) => configManager.subscribe(key as never, (newValue) => cb(newValue)),
    runtimeBus: options.runtimeBus,
    sleepCheckpoint: () => storeSnapshotScheduler.tick(),
    wakeCatchUp: [
      () => memoryConsolidationScheduler.tick(),
      () => storeSnapshotScheduler.tick(),
    ],
  });
  // DAEMON-held reach: this process's own PowerManager above holds a LOCAL
  // inhibitor that releases the moment this agent exits — the opposite of
  // "survives surfaces closing". power.keepAwake is a surface-local config
  // key (see shared-config-tier.ts — only tts.* rides the shared tier), so a
  // local config write never reaches an externally-adopted daemon's own
  // config file; the only way to reach a durable, out-of-process hold is to
  // forward the toggle explicitly over the wire whenever a daemon is
  // reachable right now (the same adoption signal the memory/session spine
  // already use). Best-effort and silent on failure beyond a warn log — a
  // down or incompatible daemon must never break the local settings-modal
  // apply this rides alongside.
  configManager.subscribe('power.keepAwake', (newValue, oldValue) => {
    if (newValue === oldValue) return;
    void forwardKeepAwakeToAdoptedDaemon(newValue, {
      probeReachability: () => sessionSpineClient.probeReachability(),
      resolveConnection: spineResolveConnection,
    }).then((outcome) => {
      if (outcome.attempted && !outcome.result.ok) {
        logger.warn('[power] keep-awake daemon forward failed', { error: outcome.result.error, kind: outcome.result.kind });
      }
    }).catch((error) => {
      logger.warn('[power] keep-awake daemon forward failed', { error: summarizeError(error) });
    });
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
  // Memory governance: construct + START the MemoryGovernor (default ON — it
  // is a safety feature) with REAL cache adapters, exactly as the SDK's own
  // daemon composition does (platform/runtime/services.ts, via the same
  // public wireDaemonMemoryGovernance — exported since sdk 4d5e247b, which
  // fixed the export-surface gap this repo previously reported and carried as
  // an honest divergence). Registered caches: this fork's two knowledge
  // stores (job-run history pruning is the real reclaim) and the shared
  // session broker (GC + bucket truncation). Registered pausable jobs:
  // MEMORY_BACKGROUND_JOB_IDS (declared with the early seams above).
  const { memoryGovernor } = wireDaemonMemoryGovernance({
    config: {
      budgetMb: configManager.get('memory.budgetMb'),
      elevatedPct: configManager.get('memory.tier.elevatedPct'),
      highPct: configManager.get('memory.tier.highPct'),
      criticalPct: configManager.get('memory.tier.criticalPct'),
      tripwireRateMbPerSec: configManager.get('memory.tripwire.rateMbPerSec'),
      tripwireSustainSec: configManager.get('memory.tripwire.sustainSec'),
      hardLimitPct: configManager.get('memory.hardLimitPct'),
    },
    runtimeBus: options.runtimeBus,
    cacheRegistry,
    pauseController,
    jobIds: MEMORY_BACKGROUND_JOB_IDS,
    receiptPath: shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'memory', 'tripwire-receipt.json'),
    // This fork's knowledge stores: the compatibility `knowledgeService`
    // alias points at agent knowledge (no separate regular store exists
    // here), so the real set is agent + home-graph.
    knowledgeStores: [agentKnowledgeStore, homeGraphKnowledgeStore],
    sessionBroker,
    // Graceful tripwire shutdown flushes in-flight state via ASYNC store
    // snapshots, same as the SDK composition: sync copies on a stalled disk
    // would block the event loop and defeat the governor's 10s shutdown
    // ceiling.
    onTripwireShutdown: async () => { await storeSnapshotScheduler.snapshotAllAsync('tripwire'); },
  });
  // Late-bind the admission gate now that the governor exists: the expensive
  // entry points (knowledge services, consolidation scheduler, voice install)
  // captured `admitExpensiveWork` earlier via this holder.
  admitExpensiveWorkRef.current = (label) => memoryGovernor.admitExpensiveWork(label);

  // sessionLiveTurnControls and powerManager (SDK round): register the
  // session-runtime live-turn verbs and the power.* verbs the same way,
  // graceful-degrading to cataloged-but-unhandled if either were ever absent.
  attachWsOnlyGatewayVerbHandlers(gatewayMethods, {
    processRegistry,
    sessionLiveTurnControls,
    powerManager,
    // ops.memory.get: the live governor snapshot (tier, budget vs rss,
    // per-cache footprints, paused jobs, tripwire state) — real now that the
    // governor above exists; previously left unregistered on the pre-export
    // SDK build rather than serving a fabricated snapshot.
    memoryGovernor,
    // voice.local.status/voice.local.install: the SAME instance this
    // repo's /voice slash command reads directly (see RuntimeServices return
    // below) — one voiceSetup, reachable both locally and over the gateway.
    voiceSetup,
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
    // The push-subscription sweep is constructed INSIDE this registration, so
    // it is unreachable from out here; handing the registry in is the only way
    // its hourly interval ever gets stopped.
    disposal: disposalScope.registry,
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

  // Teardown for every poller started above. This fork composes no DaemonServer
  // — it hands its graph to one, and the SDK's ownership rule leaves a
  // caller-supplied graph alone — so dispose() below is the ONLY thing that
  // stops these, and the shutdown paths (runtime/bootstrap-shutdown.ts,
  // cli/management.ts, cli/bundle-command.ts) are the ones that must call it.
  const disposeSessionWriteLedgerOnce = (): void => { detachSessionWriteLedger(); clearAgentSessionWrites(); };
  registerRuntimePollers(disposalScope.registry, {
    stopConfigWatch, watcherRegistry, storeSnapshotScheduler, appendOnlyRetentionScheduler,
    memoryConsolidationScheduler, codeIndexReindexScheduler, sessionOrchestration,
    // This fork has no separate regular knowledge store: the `knowledgeService`
    // compatibility alias points at isolated Agent Knowledge (pinned by
    // scripts/check-architecture.ts), so both slots are the same instance.
    // KnowledgeService.dispose() clears its schedule-timer map — disposing it
    // twice is a no-op, not a double-free.
    knowledgeService: agentKnowledgeService, agentKnowledgeService,
    wrfcController, orchestrationEngine, processRegistry, memoryGovernor, triggerManager,
    // Named here rather than registered separately below: RuntimePollerOwners
    // is all-required precisely so a poller cannot be forgotten, and this fork
    // had been registering the home-graph service by hand where the contract
    // could not see it.
    homeGraphService, agentOrchestrator,
    // By dispose() time the registries and bus these runs report through are
    // already down, so a run still described as "running" is orphaned rather
    // than preserved — and this is the only shutdown-reachable way to abort its
    // in-flight provider call instead of letting it sleep out a retry backoff.
    cancelHostedAgentRuns: () => cancelAllAgentRuns(agentManager),
  });
  // Owners this fork has that the SDK's composition does not. The session-spine
  // client's keepalive is graph-owned even though the interactive shutdown path
  // also closes it by session id first — dispose() is idempotent, and
  // registering here is what covers the CLI paths that never had one.
  //
  // The home-graph knowledge service used to be registered here too. It is a
  // named member of RuntimePollerOwners now, so it goes through the contract
  // with everything else — which is the point of that list being all-required.
  disposalScope.registry.add('session spine client', () => sessionSpineClient.dispose());
  disposalScope.registry.add('session write ledger', disposeSessionWriteLedgerOnce);

  return {
    // The REAL SDK memory-governance instances composed above (governor
    // constructed + started by wireDaemonMemoryGovernance). The SDK's
    // DaemonServer facade (facade-composition.ts) genuinely consumes these
    // when this repo hands its RuntimeServices to it — e.g. it registers the
    // control-plane event-replay ring onto cacheRegistry.
    memoryGovernor,
    cacheRegistry,
    pauseController,
    stepUpService,
    pairingTokens,
    workingDirectory,
    homeDirectory,
    surface,
    shellPaths,
    configManager,
    featureFlags,
    contextAccountingHolder,
    orchestrationEngine,
    codeIndexStore,
    codeIndexReindexScheduler,
    storeSnapshotScheduler,
    appendOnlyRetentionScheduler,
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
    triggerManager,
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
    voiceSetup,
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
    // Kept as its own member because the interactive shutdown path detaches the
    // ledger at a specific point in its ordering, well before the graph goes
    // down. It is the SAME closure the disposal scope holds, so the two are one
    // mechanism rather than two: whichever runs first does the work, the other
    // is a no-op.
    disposeSessionWriteLedger: disposeSessionWriteLedgerOnce,
    dispose: (): void => disposalScope.dispose(),
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
