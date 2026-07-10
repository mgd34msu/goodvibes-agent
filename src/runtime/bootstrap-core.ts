import { ConversationManager } from '../core/conversation';
import { SelectionManager } from '../input/selection.ts';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import { ConfigManager, getConfiguredSystemPrompt } from '../config/index.ts';
import { getProviderIdFromModel } from '../config/provider-model.ts';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { registerAllTools } from '@pellux/goodvibes-sdk/platform/tools';
import { PermissionManager, createPermissionConfigReader } from '@pellux/goodvibes-sdk/platform/permissions';
import { Notifier, WebhookNotifier } from '@pellux/goodvibes-sdk/platform/integrations';

import { Compositor } from '../renderer/compositor.ts';
import type { PermissionRequestHandler } from '@pellux/goodvibes-sdk/platform/permissions';
import type { SystemMessageRouter } from '../core/system-message-router.ts';
import type { ConversationFollowUpItem } from '@pellux/goodvibes-sdk/platform/core';
import type { OrchestratorUserInputOptions } from '../core/orchestrator.ts';
import type { ControlPlaneRecentEvent } from '@pellux/goodvibes-sdk/platform/control-plane';
import type { MutableRuntimeState } from '@/runtime/index.ts';
import type { BootstrapOptions } from './context.ts';
import { createFeatureFlagManager } from '@/runtime/index.ts';
import { RuntimeEventBus } from '@/runtime/index.ts';
import type { SessionEvent } from '@/runtime/index.ts';
import { createRuntimeStore, createDomainDispatch, type RuntimeStore } from './store/index.ts';
import { ForensicsCollector, ForensicsRegistry } from '@/runtime/index.ts';
import {
  generateUserSessionId,
} from '@/runtime/index.ts';
import { loadBootstrapSystemPrompt, syncConfiguredServices } from '@/runtime/index.ts';
import { registerBootstrapHookBridge } from '@/runtime/index.ts';
import { createRuntimeServices, foldAgentLegacyMemory, type RuntimeServices } from './services.ts';
import { formatMemoryFoldReport } from '@pellux/goodvibes-sdk/platform/state';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { importVibeFilesIntoMemoryOnce } from '../agent/vibe-file.ts';
import { createUiRuntimeServices, type UiRuntimeServices } from './ui-services.ts';
import { installAgentToolPolicyGuard } from '../tools/agent-tool-policy-guard.ts';
import { registerAgentChannelSendTool } from '../tools/agent-channel-send-tool.ts';
import { registerAgentAutonomyScheduleTool } from '../tools/agent-autonomy-schedule-tool.ts';
import { registerAgentArtifactsTool } from '../tools/agent-artifacts-tool.ts';
import { registerAgentDocumentsTool } from '../tools/agent-documents-tool.ts';
import { registerAgentKnowledgeIngestTool } from '../tools/agent-knowledge-ingest-tool.ts';
import { registerAgentKnowledgeTool } from '../tools/agent-knowledge-tool.ts';
import { registerAgentLearningConsolidationTool } from '../tools/agent-learning-consolidation-tool.ts';
import { registerAgentLocalRegistryTool } from '../tools/agent-local-registry-tool.ts';
import { registerAgentMediaGenerateTool } from '../tools/agent-media-generate-tool.ts';
import { registerAgentModelCompareTool } from '../tools/agent-model-compare-tool.ts';
import { registerAgentNotifyTool } from '../tools/agent-notify-tool.ts';
import { registerAgentOperatorActionTool } from '../tools/agent-operator-action-tool.ts';
import { registerAgentOperatorBriefingTool } from '../tools/agent-operator-briefing-tool.ts';
import { registerAgentOperatorMethodTool } from '../tools/agent-operator-method-tool.ts';
import { registerAgentReminderScheduleTool } from '../tools/agent-reminder-schedule-tool.ts';
import { registerAgentReviewPacketPresetsTool } from '../tools/agent-review-packet-presets-tool.ts';
import { registerAgentReviewPacketShareTool } from '../tools/agent-review-packet-share-tool.ts';
import { registerAgentResearchReportTool } from '../tools/agent-research-report-tool.ts';
import { registerAgentResearchRunsTool } from '../tools/agent-research-runs-tool.ts';
import { registerAgentResearchSourcesTool } from '../tools/agent-research-sources-tool.ts';
import { registerAgentScheduleEditTool } from '../tools/agent-schedule-edit-tool.ts';
import { registerAgentScheduleTool } from '../tools/agent-schedule-tool.ts';
import { getTerminalSize } from '../shell/terminal-size.ts';
import { registerAgentWorkPlanTool } from '../tools/agent-work-plan-tool.ts';
import { compactRegisteredToolDefinitions } from '../tools/tool-definition-compaction.ts';
import { installToolExecutionSafetyGuard } from '../tools/tool-execution-safety.ts';
import { installPermissionManagerSafetyGuard } from './tool-permission-safety.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';
import { registerAgentRuntimeEvents } from './agent-runtime-events.ts';

export interface BootstrapCoreState {
  readonly userSessionId: string;
  readonly runtimeBus: RuntimeEventBus;
  readonly store: RuntimeStore;
  readonly services: RuntimeServices;
  readonly uiServices: UiRuntimeServices;
  readonly conversation: ConversationManager;
  readonly compositor: Compositor;
  readonly selection: SelectionManager;
  readonly toolRegistry: ToolRegistry;
  readonly fileCache: ReturnType<typeof registerAllTools>['fileCache'];
  readonly projectIndex: ReturnType<typeof registerAllTools>['projectIndex'];
  readonly permissionManager: PermissionManager;
  readonly forensicsCollector: ForensicsCollector;
  readonly forensicsRegistry: ForensicsRegistry;
  readonly runtime: MutableRuntimeState;
  readonly bootstrapUnsubs: Array<() => void>;
  readonly runtimeUnsubs: Array<() => void>;
  readonly agentStatusIntervalRef: { value: ReturnType<typeof setInterval> | null };
  readonly permissionPromptRef: { requestPermission: PermissionRequestHandler };
  readonly systemMessageRouterRef: { value: SystemMessageRouter | null };
  readonly conversationFollowUpRef: { value: ((item: ConversationFollowUpItem) => void) | null };
  /**
   * Mutable ref patched by bootstrap.ts after the Orchestrator is constructed.
   * When non-null, COMPANION_MESSAGE_RECEIVED fires a real LLM turn via
   * orchestrator.handleUserInput() instead of only appending the user message.
   */
  readonly orchestratorHandleUserInputRef: { value: ((text: string, options?: OrchestratorUserInputOptions) => void) | null };
  readonly requestRender: () => void;
  readonly setRenderRequest: (fn: () => void) => void;
  readonly runtimeSessionIdRef: { value: string };
}

export type CompanionMessagePayload = Extract<SessionEvent, { type: 'COMPANION_MESSAGE_RECEIVED' }>;

/**
 * Registers the webhook notifier for the runtime session.
 *
 * Configures the provided WebhookNotifier with the given URL list, attaches it
 * to the runtime bus so it receives SESSION_NOTIFICATION events, and pushes a
 * detach() cleanup into runtimeUnsubs for shutdown. When webhookUrls is empty
 * this function is a complete no-op.
 */
export function registerWebhookNotifier(
  webhookNotifier: WebhookNotifier,
  webhookUrls: string[],
  runtimeBus: RuntimeEventBus,
  runtimeUnsubs: Array<() => void>,
): void {
  if (webhookUrls.length === 0) return;
  webhookNotifier.setUrls(webhookUrls);
  webhookNotifier.attachToRuntimeBus(runtimeBus);
  runtimeUnsubs.push(() => webhookNotifier.detach());
}

export function companionMessageToOrchestratorInputOptions(
  payload: CompanionMessagePayload,
): OrchestratorUserInputOptions {
  const metadata = payload.metadata;
  const surface = typeof metadata?.surface === 'string' ? metadata.surface : undefined;
  const topic = typeof metadata?.topic === 'string' ? metadata.topic : undefined;

  return {
    origin: {
      source: payload.source,
      messageId: payload.messageId,
      ...(surface ? { surface } : {}),
      ...(topic ? { topic } : {}),
      ...(metadata ? { metadata } : {}),
    },
  };
}

export async function initializeBootstrapCore(
  stdout: NodeJS.WriteStream,
  options: BootstrapOptions,
  getControlPlaneRecentEvents: (limit: number) => readonly ControlPlaneRecentEvent[],
): Promise<BootstrapCoreState> {
  const workingDir = options.workingDir;
  const homeDirectory = options.homeDirectory;
  const configManager = options.configManager;

  const featureFlags = createFeatureFlagManager();
  featureFlags.loadFromConfig({
    flags: (configManager.getCategory('featureFlags') as Record<string, import('@/runtime/index.ts').FlagState>) ?? {},
  });

  const userSessionId = `user-${generateUserSessionId()}`;
  const runtimeBus = new RuntimeEventBus();
  const store = createRuntimeStore();
  const domainDispatch = createDomainDispatch(store);
  let getConversationTitle = (): string | undefined => undefined;
  const services = createRuntimeServices({
    configManager,
    featureFlags,
    runtimeBus,
    runtimeStore: store,
    getConversationTitle: () => getConversationTitle(),
    workingDir,
    homeDirectory,
  });
  const providerRegistry = services.providerRegistry;
  providerRegistry.initModelLimits();
  services.benchmarkStore.initBenchmarks();
  providerRegistry.initCatalog();
  services.keybindingsManager.loadFromDisk();
  domainDispatch.syncControlPlaneState({
    enabled: Boolean(configManager.get('controlPlane.enabled')),
    host: String(configManager.get('controlPlane.host') ?? '127.0.0.1'),
    port: Number(configManager.get('controlPlane.port') ?? 3421),
    connectionState: configManager.get('controlPlane.enabled') ? 'connected' : 'disabled',
    isRunning: Boolean(configManager.get('controlPlane.enabled')),
  }, 'bootstrap.control-plane');
  domainDispatch.syncControlPlaneClient({
    id: 'client:goodvibes-agent',
    kind: 'service',
    label: 'GoodVibes Agent',
    transport: 'local',
    connected: true,
    sessionId: userSessionId,
    authenticatedAt: Date.now(),
    lastSeenAt: Date.now(),
    capabilities: ['session', 'commands', 'automation'],
    metadata: {
      product: 'goodvibes-agent',
      surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
      clientKindNote: 'Connected-host client kind; GoodVibes Agent remains an interactive operator TUI.',
    },
  }, 'bootstrap.control-plane');

  const {
    approvalBroker,
    automationManager,
    deliveryManager,
    hookDispatcher,
    hookWorkbench,
    memoryStore,
    routeBindings,
    sessionBroker: sharedSessionBroker,
    surfaceRegistry,
    watcherRegistry,
  } = services;

  routeBindings.attachRuntime({ runtimeBus, runtimeStore: store });
  surfaceRegistry.attachRuntime(store);
  surfaceRegistry.syncConfiguredSurfaces();
  watcherRegistry.attachRuntime({ runtimeBus, runtimeStore: store });
  if (configManager.get('watchers.enabled')) {
    watcherRegistry.registerPollingWatcher({
      id: 'runtime-heartbeat',
      label: 'Runtime heartbeat',
      source: {
        id: 'source:runtime-heartbeat',
        kind: 'watcher',
        label: 'Runtime heartbeat',
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
      },
      intervalMs: Number(configManager.get('watchers.heartbeatIntervalMs') ?? 30_000),
      run: () => new Date().toISOString(),
    });
    watcherRegistry.startWatcher('runtime-heartbeat');
  }
  automationManager.attachRuntime({ runtimeBus, runtimeStore: store, deliveryManager });

  const forensicsRegistry = new ForensicsRegistry();
  const forensicsCollector = new ForensicsCollector(runtimeBus, forensicsRegistry);
  const policyRuntimeState = services.policyRuntimeState;
  const uiServices = createUiRuntimeServices(services, {
    forensicsRegistry,
    getControlPlaneRecentEvents,
  });

  const conversation = new ConversationManager(() => getTerminalSize(stdout).width);
  conversation.setConfigManager(configManager);
  getConversationTitle = () => conversation.title;

  const compositor = new Compositor(stdout);
  const selection = new SelectionManager();

  const toolRegistry = new ToolRegistry();
  const { fileCache, projectIndex } = registerAllTools(toolRegistry, {
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    fileUndoManager: services.fileUndoManager,
    modeManager: services.modeManager,
    processManager: services.processManager,
    agentManager: services.agentManager,
    agentMessageBus: services.agentMessageBus,
    archetypeLoader: services.archetypeLoader,
    webSearchService: services.webSearchService,
    channelRegistry: services.channelPlugins,
    remoteRunnerRegistry: services.remoteRunnerRegistry,
    workflowServices: services.workflow,
    mcpRegistry: services.mcpRegistry,
    sessionOrchestration: services.sessionOrchestration,
    sandboxSessionRegistry: services.sandboxSessionRegistry,
    workingDirectory: services.workingDirectory,
    configManager,
    providerRegistry: services.providerRegistry,
    toolLLM: services.toolLLM,
    featureFlags: services.featureFlags,
    serviceRegistry: services.serviceRegistry,
    overflowHandler: services.overflowHandler,
    changeTracker: services.sessionChangeTracker,
  });
  registerAgentArtifactsTool(toolRegistry, services.artifactStore, { projectRoot: services.shellPaths.workingDirectory });
  registerAgentDocumentsTool(toolRegistry, services.shellPaths, services.artifactStore);
  registerAgentKnowledgeIngestTool(toolRegistry, services.shellPaths, configManager);
  registerAgentChannelSendTool(toolRegistry, services.channelDeliveryRouter, { shellPaths: services.shellPaths });
  registerAgentKnowledgeTool(toolRegistry, services.shellPaths, configManager);
  registerAgentLearningConsolidationTool(toolRegistry, services.shellPaths, services.memoryRegistry);
  registerAgentLocalRegistryTool(toolRegistry, services.shellPaths, services.memoryRegistry, services.memorySpineClient);
  registerAgentMediaGenerateTool(toolRegistry, services.mediaProviders, services.artifactStore);
  registerAgentResearchRunsTool(toolRegistry, services.shellPaths);
  registerAgentResearchSourcesTool(toolRegistry, services.shellPaths);
  registerAgentResearchReportTool(toolRegistry, services.artifactStore);
  registerAgentReviewPacketPresetsTool(toolRegistry, services.artifactStore);
  registerAgentReviewPacketShareTool(toolRegistry, services.artifactStore, services.channelDeliveryRouter);
  registerAgentModelCompareTool(toolRegistry, {
    modelCatalog: services.providerRegistry,
    providerRegistry: services.providerRegistry,
    artifactStore: services.artifactStore,
    applyModelRoute: (registryKey) => {
      const previousModel = String(configManager.get('provider.model') ?? '').trim();
      configManager.set('provider.model', registryKey);
      return {
        ...(previousModel ? { previousModel } : {}),
        selectedModel: registryKey,
      };
    },
  });
  registerAgentNotifyTool(toolRegistry, configManager, services.webhookNotifier);
  registerAgentOperatorActionTool(toolRegistry, services.shellPaths, configManager);
  registerAgentOperatorBriefingTool(toolRegistry, services.shellPaths, configManager);
  registerAgentOperatorMethodTool(toolRegistry, services.shellPaths, configManager);
  registerAgentAutonomyScheduleTool(toolRegistry, services.shellPaths, configManager);
  registerAgentReminderScheduleTool(toolRegistry, services.shellPaths, configManager);
  registerAgentScheduleEditTool(toolRegistry, services.shellPaths, configManager);
  registerAgentScheduleTool(toolRegistry, services.shellPaths, configManager);
  registerAgentWorkPlanTool(toolRegistry, services.workPlanStore);
  installAgentToolPolicyGuard(toolRegistry, {
    getLastUserMessage: () => conversation.getLastUserMessage(),
  });
  installToolExecutionSafetyGuard(toolRegistry);
  compactRegisteredToolDefinitions(toolRegistry);
  // Captured so the permissionManager-bearing follow-up call below (issued once
  // permissionManager exists, further down this function) can replay every
  // field — AgentOrchestrator.setDependencies() fully replaces its stored
  // toolDeps rather than merging, so a partial second call would silently drop
  // everything set here.
  const agentOrchestratorToolDeps = {
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    fileCache,
    projectIndex,
    workingDirectory: services.workingDirectory,
    fileUndoManager: services.fileUndoManager,
    modeManager: services.modeManager,
    processManager: services.processManager,
    agentMessageBus: services.agentMessageBus,
    webSearchService: services.webSearchService,
    channelRegistry: services.channelPlugins,
    remoteRunnerRegistry: services.remoteRunnerRegistry,
    knowledgeService: services.agentKnowledgeService,
    archetypeLoader: services.archetypeLoader,
    configManager,
    providerRegistry: services.providerRegistry,
    providerOptimizer: services.providerOptimizer,
    toolLLM: services.toolLLM,
    serviceRegistry: services.serviceRegistry,
    sessionOrchestration: services.sessionOrchestration,
    featureFlags: services.featureFlags,
    overflowHandler: services.overflowHandler,
    memoryRegistry: services.memoryRegistry,
    sandboxSessionRegistry: services.sandboxSessionRegistry,
    workflowServices: services.workflow,
  };
  services.agentOrchestrator.setDependencies(agentOrchestratorToolDeps);

  const bootstrapUnsubs: Array<() => void> = [];
  // D5 fix: stop the heartbeat watcher on shutdown so the setInterval is cleared.
  // Registered here (after declaration) rather than inside the watcher block above.
  if (configManager.get('watchers.enabled')) {
    bootstrapUnsubs.push(() => watcherRegistry.stopWatcher('runtime-heartbeat'));
  }
  await memoryStore.init();
  bootstrapUnsubs.push(() => {
    void memoryStore.save();
    memoryStore.close();
  });

  // Fold the agent's legacy per-surface memory into the canonical
  // cross-surface store (id-keyed, idempotent, never deletes the legacy file) and
  // SURFACE the fold report — migration honesty requires that what moved is visible,
  // not silently swallowed. Non-fatal: a fold failure must never block startup.
  try {
    const foldReport = await foldAgentLegacyMemory(
      services.memoryStore,
      services.memoryEmbeddingRegistry,
      services.shellPaths,
    );
    logger.info('agent legacy memory fold report', { report: formatMemoryFoldReport(foldReport) });
  } catch (err) {
    logger.warn('agent legacy memory fold failed (non-fatal)', { error: summarizeError(err) });
  }

  // ONE-TIME migration of discovered VIBE.md files into persona/constraint
  // records, guarded by a persisted path→hash marker so it never re-imports the same
  // file (which would create near-duplicate persona records). After this, the VIBE
  // prompt is a PROJECTION of those records (buildVibeProjectionPrompt).
  try {
    const importedPersona = await importVibeFilesIntoMemoryOnce(services.memorySpineClient, services.shellPaths);
    if (importedPersona > 0) {
      logger.info('agent VIBE.md persona migration', { records: importedPersona });
    }
  } catch (err) {
    logger.warn('agent VIBE.md persona migration failed (non-fatal)', { error: summarizeError(err) });
  }

  const renderRequestRef = { value: (): void => {} };
  // R1: Coalescing render scheduler — collapses N same-microtask requestRender() calls into 1.
  // Also enforces a 16ms minimum interval to cap at ~60fps during streaming.
  let renderScheduled = false;
  let lastRenderTime = 0;
  const RENDER_INTERVAL_MS = 16;
  const requestRender = (): void => {
    if (renderScheduled) return;
    renderScheduled = true;
    setImmediate(() => {
      // Error Handling: the scheduler flag MUST be cleared even if the render
      // callback throws; otherwise a single render exception would wedge the
      // entire TUI (no future requestRender() call would schedule anything).
      renderScheduled = false;
      const now = Date.now();
      const elapsed = now - lastRenderTime;
      try {
        if (elapsed < RENDER_INTERVAL_MS) {
          // Too soon — debounce to the tail of the current 16ms window
          const delay = RENDER_INTERVAL_MS - elapsed;
          setTimeout(() => {
            try {
              lastRenderTime = Date.now();
              renderRequestRef.value();
            } catch (err) {
              // Throttled-render error: swallow but log at error so the next
              // requestRender() call can still schedule. The renderer itself
              // is expected to surface failures via its own error path.
              logger.error('Throttled render threw; next requestRender will reschedule', { error: String(err) });
            }
          }, delay);
        } else {
          lastRenderTime = now;
          renderRequestRef.value();
        }
      } catch (err) {
        logger.error('Immediate render threw; next requestRender will reschedule', { error: String(err) });
      }
    });
  };
  const permissionPromptRef = {
    requestPermission: (async () => ({ approved: false, remember: false })) as PermissionRequestHandler,
  };
  void approvalBroker.start();
  void sharedSessionBroker.start();
  const runtimeSessionIdRef = { value: userSessionId };
  const systemMessageRouterRef: { value: SystemMessageRouter | null } = { value: null };
  const conversationFollowUpRef: { value: ((item: ConversationFollowUpItem) => void) | null } = { value: null };
  const { unsubs: runtimeUnsubs, agentStatusIntervalRef } = registerAgentRuntimeEvents({
    runtimeBus,
    domainDispatch,
    getSystemMessageRouter: () => systemMessageRouterRef.value,
    queueConversationFollowUp: (item) => conversationFollowUpRef.value?.(item),
    requestRender,
    configManager,
    agentManager: services.agentManager,
  });

  // Subscribe to companion main-chat messages received from the connected host's HTTP layer.
  // The connected host emits COMPANION_MESSAGE_RECEIVED on the runtime bus when a companion
  // POST /api/sessions/:id/messages with kind='message' arrives.
  //
  // bootstrap.ts patches orchestratorHandleUserInputRef.value after the Orchestrator
  // is constructed. When that ref is set, we delegate to orchestrator.handleUserInput()
  // which (a) adds the user message to the conversation view and (b) fires a real LLM
  // turn whose STREAM_DELTA / TURN_COMPLETED events flow to both TUI and companion SSE.
  //
  // The fallback (ref not yet set) adds the message to the conversation view only —
  // this path is unreachable in practice because the event bus is not connected to
  // any live HTTP traffic until after the orchestrator is wired in bootstrap.ts.
  const orchestratorHandleUserInputRef: {
    value: ((text: string, options?: OrchestratorUserInputOptions) => void) | null;
  } = { value: null };
  runtimeUnsubs.push(runtimeBus.on<Extract<SessionEvent, { type: 'COMPANION_MESSAGE_RECEIVED' }>>(
    'COMPANION_MESSAGE_RECEIVED',
    ({ payload }) => {
      if (orchestratorHandleUserInputRef.value) {
        // Delegate to the orchestrator: adds user message + fires a real LLM turn.
        // Preserve surface origin metadata so the SDK can correlate replies back
        // to the originating external channel, including ntfy chat topics.
        orchestratorHandleUserInputRef.value(payload.body, companionMessageToOrchestratorInputOptions(payload));
      } else {
        // Fallback: render the user message immediately (orchestrator not yet ready).
        conversation.addUserMessage(payload.body);
        requestRender();
      }
    },
  ));

  providerRegistry.startWatching(runtimeBus);

  const webhookUrls = (configManager.getCategory('notifications') as { webhookUrls?: string[] }).webhookUrls ?? [];
  if (webhookUrls.length > 0) {
    // Reuse the services.webhookNotifier instance (constructed no-arg in services.ts).
    // Configure it with the resolved URL list via setUrls(), attach it to the runtime
    // bus so it receives SESSION_NOTIFICATION events, and register detach() in
    // runtimeUnsubs so the bus subscription is cleaned up on shutdown.
    registerWebhookNotifier(services.webhookNotifier, webhookUrls, runtimeBus, runtimeUnsubs);
    domainDispatch.syncIntegration({
      id: 'webhooks',
      displayName: 'Webhooks',
      category: 'communication',
      status: 'healthy',
      enabled: true,
      successCount: 0,
      errorCount: 0,
      meta: { urlCount: webhookUrls.length },
    }, 'bootstrap.webhooks');
  }

  const notifier = await Notifier.fromConfig(services.serviceRegistry);
  const queueStatuses = notifier.getQueueStatus();
  if (queueStatuses.length > 0) {
    notifier.attachToRuntimeBus(runtimeBus);
    for (const queueStatus of queueStatuses) {
      domainDispatch.syncIntegration({
        id: queueStatus.channel,
        displayName: queueStatus.channel[0]!.toUpperCase() + queueStatus.channel.slice(1),
        category: 'communication',
        status: queueStatus.metrics.deadLettered > 0 ? 'degraded' : 'healthy',
        enabled: true,
        successCount: queueStatus.metrics.delivered,
        errorCount: queueStatus.metrics.deadLettered,
        ...(queueStatus.dlqEntries[0]?.deadAt ? { lastErrorAt: queueStatus.dlqEntries[0].deadAt } : {}),
        ...(queueStatus.dlqEntries[0]?.finalError ? { lastError: queueStatus.dlqEntries[0].finalError } : {}),
        meta: {
          attempts: queueStatus.metrics.totalAttempts,
          retrying: queueStatus.metrics.retrying,
          deadLetters: queueStatus.metrics.deadLettered,
          dlqSize: queueStatus.metrics.dlqSize,
          sloEnforced: queueStatus.sloEnforced,
        },
      }, 'bootstrap.notifier');
    }
  }

  await syncConfiguredServices(domainDispatch.syncIntegration, services.serviceRegistry);

  const permissionManager = new PermissionManager(
    (request) => approvalBroker.requestApproval({
      request,
      sessionId: runtimeSessionIdRef.value,
      localPrompt: permissionPromptRef.requestPermission,
    }),
    createPermissionConfigReader(configManager),
    policyRuntimeState,
    services.hookDispatcher,
    featureFlags,
  );
  installPermissionManagerSafetyGuard(permissionManager);
  // Wire permissionManager into the SAME AgentOrchestrator instance that runs
  // spawned/background agent tool calls (services.agentOrchestrator, set up
  // above with agentOrchestratorToolDeps before permissionManager existed).
  // Without this, the SDK's gateBackgroundToolCall() sees no permissionManager
  // on context and leaves every background tool call ungated — spawned agents
  // would run with no permission check at all, regardless of permissions.mode
  // or permissions.backgroundAgents. Replays the full toolDeps object because
  // setDependencies() replaces rather than merges.
  services.agentOrchestrator.setDependencies({ ...agentOrchestratorToolDeps, permissionManager });
  await hookWorkbench.loadAndApplyManagedHooks();

  const runtime: MutableRuntimeState = {
    model: configManager.get('provider.model') as string,
    provider: getProviderIdFromModel(configManager.get('provider.model')),
    debugMode: false,
    systemPrompt: loadBootstrapSystemPrompt(configManager) || getConfiguredSystemPrompt(configManager) || '',
    reasoningEffort: (configManager.get('provider.reasoningEffort') as string | undefined) ?? '',
    sessionId: userSessionId,
  };
  runtimeSessionIdRef.value = runtime.sessionId;
  void sharedSessionBroker.createSession({
    id: runtime.sessionId,
    title: 'GoodVibes Agent session',
    // Declares the session permission mode at creation time in the shared
    // metadata bag (SDK 1.6.1 permissions.mode: prompt/allow-all/custom/
    // plan/accept-edits). Read-only declaration — the permission layer
    // itself always reads permissions.mode live off configManager, so this
    // does not change enforcement; it lets cross-session tooling see which
    // mode a session started under without re-deriving it.
    metadata: { source: 'goodvibes-agent', permissionMode: configManager.get('permissions.mode') },
    participant: {
      surfaceKind: 'service',
      surfaceId: 'surface:goodvibes-agent',
      displayName: 'GoodVibes Agent',
      lastSeenAt: Date.now(),
    },
  }).catch((err) => { logger.debug('session broker create session failed at bootstrap', { err }); });

  // W2A: mirror the create into the daemon spine (fire-and-forget; the local
  // broker above stays the source of truth). kind:'agent' is the canonical record
  // identity; participant.surfaceKind stays 'service' (the TRANSPORT axis).
  services.sessionSpineClient.register({
    sessionId: runtime.sessionId,
    project: workingDir,
    title: 'GoodVibes Agent session',
  });
  // Debounced heartbeat off turn activity — coalesced to one wire call per window,
  // no title, reopen:false. Uses the ref so a resumed session id is followed.
  runtimeUnsubs.push(
    uiServices.events.turns.on('TURN_SUBMITTED', () => services.sessionSpineClient.heartbeat(runtimeSessionIdRef.value)),
    uiServices.events.turns.on('TURN_COMPLETED', () => services.sessionSpineClient.heartbeat(runtimeSessionIdRef.value)),
  );

  domainDispatch.syncSessionState({
    id: userSessionId,
    projectRoot: workingDir,
    status: 'active',
    startedAt: Date.now(),
    recoveryState: 'ready',
    isResumed: false,
    wasRepaired: false,
    lineageId: userSessionId,
    lineage: [{ sessionId: userSessionId, createdAt: Date.now() }],
  }, 'bootstrap.session');

  runtimeUnsubs.push(
    ...registerBootstrapHookBridge({
      runtimeBus,
      hookDispatcher,
      runtime,
    }),
  );

  return {
    userSessionId,
    runtimeBus,
    store,
    services,
    uiServices,
    conversation,
    compositor,
    selection,
    toolRegistry,
    fileCache,
    projectIndex,
    permissionManager,
    forensicsCollector,
    forensicsRegistry,
    runtime,
    bootstrapUnsubs,
    runtimeUnsubs,
    agentStatusIntervalRef,
    permissionPromptRef,
    systemMessageRouterRef,
    conversationFollowUpRef,
    orchestratorHandleUserInputRef,
    requestRender,
    setRenderRequest: (fn) => {
      renderRequestRef.value = fn;
    },
    runtimeSessionIdRef,
  };
}
