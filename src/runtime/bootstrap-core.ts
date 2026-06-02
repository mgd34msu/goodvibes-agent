import { ConversationManager } from '../core/conversation';
import { SelectionManager } from '../input/selection.ts';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import { ConfigManager, getConfiguredSystemPrompt } from '../config/index.ts';
import { getProviderIdFromModel } from '../config/provider-model.ts';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { registerAllTools } from '@pellux/goodvibes-sdk/platform/tools';
import { PermissionManager, createPermissionConfigReader } from '@pellux/goodvibes-sdk/platform/permissions';
import { Notifier } from '@pellux/goodvibes-sdk/platform/integrations';
import { WebhookNotifier } from '@pellux/goodvibes-sdk/platform/integrations';
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
import { registerBootstrapRuntimeEvents } from '@/runtime/index.ts';
import { createRuntimeServices, type RuntimeServices } from './services.ts';
import { createUiRuntimeServices, type UiRuntimeServices } from './ui-services.ts';
import { installAgentToolPolicyGuard } from '../tools/agent-tool-policy-guard.ts';
import { registerAgentLocalRegistryTool } from '../tools/agent-local-registry-tool.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';

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
    capabilities: ['session', 'panels', 'commands', 'automation'],
    metadata: {
      product: 'goodvibes-agent',
      surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
      clientKindNote: 'SDK has no dedicated agent client kind yet; using service for the Agent operator surface.',
    },
  }, 'bootstrap.control-plane');

  const {
    approvalBroker,
    automationManager,
    deliveryManager,
    hookDispatcher,
    hookWorkbench,
    memoryStore,
    panelManager,
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

  const conversation = new ConversationManager(() => {
    const width = stdout.columns || 80;
    if (panelManager.isVisible() && panelManager.getAllOpen().length > 0) {
      return Math.max(1, panelManager.getLeftWidth(width) - 1);
    }
    return width;
  });
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
    wrfcController: services.wrfcController,
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
  registerAgentLocalRegistryTool(toolRegistry, services.shellPaths, services.memoryRegistry);
  installAgentToolPolicyGuard(toolRegistry, {
    getLastUserMessage: () => conversation.getLastUserMessage(),
  });
  services.agentOrchestrator.setDependencies({
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
  });

  const bootstrapUnsubs: Array<() => void> = [];
  await memoryStore.init();
  bootstrapUnsubs.push(() => {
    void memoryStore.save();
    memoryStore.close();
  });

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
  const { unsubs: runtimeUnsubs, agentStatusIntervalRef } = registerBootstrapRuntimeEvents({
    runtimeBus,
    domainDispatch,
    getSystemMessageRouter: () => systemMessageRouterRef.value,
    queueConversationFollowUp: (item) => conversationFollowUpRef.value?.(item),
    requestRender,
    configManager,
    agentManager: services.agentManager,
    wrfcController: services.wrfcController,
  });

  // Subscribe to companion main-chat messages received from the daemon's HTTP layer.
  // The daemon emits COMPANION_MESSAGE_RECEIVED on the runtime bus when a companion
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
    const webhookNotifier = WebhookNotifier.fromConfig(webhookUrls);
    webhookNotifier.attachToRuntimeBus(runtimeBus);
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
    metadata: { source: 'goodvibes-agent' },
    participant: {
      surfaceKind: 'service',
      surfaceId: 'surface:goodvibes-agent',
      displayName: 'GoodVibes Agent',
      lastSeenAt: Date.now(),
    },
  }).catch((err) => { logger.debug('session broker create session failed at bootstrap', { err }); });

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
