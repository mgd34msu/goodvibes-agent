/**
 * Bootstrap composition root for GoodVibes Agent.
 *
 * Initializes all runtime subsystems in dependency order and returns a
 * RuntimeContext that main.ts uses to drive the render loop and terminal I/O.
 *
 * Separation of concerns:
 *   - bootstrap.ts: initialization, event wiring, manager setup
 *   - main.ts: terminal setup, render loop, stdin/stdout handlers
 *   - lifecycle.ts: save/shutdown helpers
 */
import { Orchestrator, type OrchestratorUserInputOptions } from '../core/orchestrator.ts';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import type { PermissionRequestHandler } from '@pellux/goodvibes-sdk/platform/permissions';
import type { CommandContext } from '../input/command-registry.ts';
import type { InputHistory } from '../input/input-history.ts';
import type { SelectionManager } from '../input/selection.ts';
import type { Compositor } from '../renderer/compositor.ts';

import type { RuntimeContext, BootstrapOptions } from './context.ts';
import { shutdownRuntime, fireSessionStart, saveSession } from '@/runtime/index.ts';
import { createTaskManager } from '@/runtime/index.ts';
import { OpsControlPlane } from '@/runtime/index.ts';
import type { SystemMessageRouter } from '../core/system-message-router.ts';
import { emitSessionReady, emitSessionStarted } from '@/runtime/index.ts';
import {
  loadLastConversation,
  writeLastSessionPointer,
} from '@/runtime/index.ts';
import { scheduleBackgroundMcpDiscovery, startBackgroundProviderRegistration } from '@/runtime/index.ts';
import { restoreSavedModel } from '@/runtime/index.ts';
import type { ExternalServicesHandle, HostServiceStatus, TurnEvent } from '@/runtime/index.ts';
import type { UiRuntimeServices } from './ui-services.ts';
import { createDeferredStartupCoordinator } from '@/runtime/index.ts';
import { initializeBootstrapCore } from './bootstrap-core.ts';
import { createBootstrapShell } from './bootstrap-shell.ts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { startMcpConfigAutoReload } from '../mcp/runtime-reload.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';
import { AgentPromptContextReceiptStore, composeRuntimePromptWithReceipt } from '../agent/prompt-context-receipts.ts';
import { registerAgentAutonomyTool } from '../tools/agent-autonomy-tool.ts';
import { registerAgentChannelsTool } from '../tools/agent-channels-tool.ts';
import { registerAgentComputerTool } from '../tools/agent-computer-tool.ts';
import { registerAgentContextTool } from '../tools/agent-context-tool.ts';
import { registerAgentDelegationTool } from '../tools/agent-delegation-tool.ts';
import { registerAgentDeviceTool } from '../tools/agent-device-tool.ts';
import { registerAgentExecutionTool } from '../tools/agent-execution-tool.ts';
import { registerAgentHarnessTool } from '../tools/agent-harness-tool.ts';
import { registerAgentHostTool } from '../tools/agent-host-tool.ts';
import { registerAgentMemoryTool } from '../tools/agent-memory-tool.ts';
import { registerAgentModelsTool } from '../tools/agent-models-tool.ts';
import { registerAgentPersonalOpsTool } from '../tools/agent-personal-ops-tool.ts';
import { registerAgentResearchTool } from '../tools/agent-research-tool.ts';
import { registerAgentSetupTool } from '../tools/agent-setup-tool.ts';
import { registerAgentSettingsImportTool } from '../tools/agent-settings-import-tool.ts';
import { registerAgentSettingsTool } from '../tools/agent-settings-tool.ts';
import { registerAgentTerminalProcessTools } from '../tools/agent-terminal-process-tools.ts';
import { registerAgentVibeTool } from '../tools/agent-vibe-tool.ts';
import { registerAgentWorkspaceTool } from '../tools/agent-workspace-tool.ts';
import { compactRegisteredToolDefinitions } from '../tools/tool-definition-compaction.ts';

const GOODVIBES_AGENT_OPERATOR_POLICY = [
  '## GoodVibes Agent Operator Policy',
  '- Act as one user-facing autonomous assistant. Prefer the lowest-friction safe path that completes the user outcome; do not expose internal package or host ownership unless it is needed for diagnosis, setup, or safety.',
  '- Work serially in the main conversation by default for ordinary chat, research, planning, setup, local context, and short tool work. Use visible schedules, work plans, operator actions, or delegated/remote routes for durable or long-running autonomy.',
  '- Connected-host lifecycle is not ambient. If the host is unavailable, explain the shortest user action to make the assistant reachable; do not pretend a missing host route worked.',
  '- Read tools: `schedule action:"list"`, `setup action:"status|item|checkpoint"`, `settings action:"list|get"`, `vibe action:"status|show"`, `context action:"status|files|file|prompt|receipts|receipt"`, `memory action:"status|provider|curator|candidate|list|search|get"`, `channels action:"status|channel|setup|triage|deliveries"`, `models action:"status|route|local|providers|provider"`, `personal_ops action:"briefing|status|intake|lane"`, `autonomy action:"intake|queue|item|status"`, `delegation action:"status|routes|route"`, `execution action:"status|route|history|record|processes|process|recovery"`, `computer action:"status|control|browser|setup|mcp"`, `research action:"plan|search|runner|runs|run|sources|source|bundle|reports|report_artifact"`, `device action:"status|capability|browser|control|voice|provider"`, `workspace action:"status|actions|action|surfaces|surface|panels|panel|shortcuts|keybindings|keybinding|commands|command|cli_commands|cli_command"`, `host action:"status|capabilities|capability|services|service|methods|method"`, `import_goodvibes_settings action:"preview"`, and `agent_operator_briefing` for connected work/approvals/automation/schedules, `agent_knowledge` for isolated Agent Knowledge, and `agent_harness` for harness catalogs/status/capability discovery. Use `agent_artifacts` for saved artifact list/preview/export/package/archive; write modes are confirmation-gated.',
  '- Harness access: use `settings action:"set|reset|import"` and `workspace action:"run|run_command|open|open_panel|run_keybinding|set_keybinding|reset_keybinding"` to use the same surfaces the user can use; lower-level `agent_harness` modes remain for detail inspection and compatibility.',
  '- State tools: `agent_work_plan` for visible local work items; `agent_local_registry` for Agent-local notes, memory, personas, skills, bundles, and routines; `agent_learning_consolidation` for confirmed duplicate cleanup phases; `agent_documents` for versioned Agent document drafts. Keep records non-secret, sourced, and reviewable.',
  '- Confirmed tools: use `schedule`, `setup action:"save_checkpoint|clear_checkpoint|token|smoke|finish|import_settings"`, `vibe action:"init|import_persona"`, `models action:"smoke"` for local model server checks, `personal_ops action:"read"` for one live read-only inbox/calendar connector operation, `research action:"create_run|start_run|checkpoint|pause|resume|cancel|complete|fail|delete_run|add_source|review_source|reject_source|use_source|delete_source|report"`, `computer action:"open_browser"`, `device action:"open_browser|open_tts_provider|open_tts_voice"`, `workspace action:"run|run_command|open|open_panel|run_keybinding|set_keybinding|reset_keybinding"`, `import_goodvibes_settings`, `agent_operator_action`, `agent_artifacts` export/package/archive, `agent_documents`, `agent_review_packet_presets` save/refresh, `agent_review_packet_share`, `agent_knowledge_ingest`, `agent_learning_consolidation`, `agent_media_generate`, `agent_model_compare`, `agent_research_runs`, `agent_research_sources`, `agent_research_report`, `agent_notify`, `agent_channel_send`, `agent_autonomy_schedule`, `agent_reminder_schedule`, and `agent_schedule_edit` only for explicit user requests with confirm:true and explicitUserRequest.',
  '- Agent Knowledge must use only `/api/goodvibes-agent/knowledge/*` and fail closed. Do not use default knowledge or non-Agent knowledge spaces.',
  '- External delivery, media generation, reminders, settings writes, slash-command mirrors, workspace action mirrors, and destructive local changes require explicit user intent and the owning tool/command confirmation.',
  '- Autonomous work must be visible, reviewable, and cancellable. Never create silent hidden jobs; when work should continue later, create or use an explicit schedule, reminder, work-plan item, operator action, or delegated/remote task route.',
  '- Do not delegate planning, research, operations, knowledge, memory, configuration, approvals, observability, or ordinary assistant work when an Agent-owned route can satisfy the user directly.',
  '- For explicit build, implement, fix, patch, or review requests, choose the route that best serves the user: use available local read/edit/exec tools when the current Agent workspace and permissions are sufficient; use public shared-session/build-delegation for isolation, remote execution, parallelism, or connected coding workflows. Preserve the full original ask when delegating.',
].join('\n');

// ── Bootstrap context type ──────────────────────────────────────────────────

/**
 * The fully-initialized context returned by bootstrapRuntime().
 *
 * A typed superset of RuntimeContext that exposes the additional fields required
 * by main.ts (UI-layer objects that do not belong in the shared RuntimeContext
 * interface, since they are not needed by anything else).
 */
export type BootstrapContext = RuntimeContext & {
  /** Compositor handles double-buffered terminal output. */
  compositor: Compositor;
  /** Manages text selection state. */
  selection: SelectionManager;
  /** Context object passed to slash-command handlers. */
  commandContext: CommandContext;
  /** Shell-facing read models, events, and narrow runtime services. */
  uiServices: UiRuntimeServices;
  /** Persists and navigates input history across sessions. */
  inputHistory: InputHistory;
  /** Unsubscribe functions owned by bootstrap (cleared on shutdown). */
  bootstrapUnsubs: Array<() => void>;
  /** Ref holding the periodic agent-status interval (use ref — not local var — to keep shutdown in sync). */
  agentStatusIntervalRef: { value: ReturnType<typeof setInterval> | null };
  /** Mutable refs for viewport/scroll/render functions; main.ts patches these after constructing UI state. */
  orchestratorRefs: { getViewportHeight: () => number; scrollToEnd: (vHeight: number) => void; requestRender: () => void };
  /** Patch the bootstrap-owned render route after main.ts constructs the real render loop. */
  setRenderRequest: (fn: () => void) => void;
  /** Shell-owned permission prompt route that main.ts patches after UI setup. */
  permissionPromptRef: { requestPermission: PermissionRequestHandler };
  /** Load the most recently saved conversation from disk. */
  loadLastConversation: () => { messages: Array<Record<string, unknown>> } | null;
  /** Write the last-session pointer file (used after session resume). */
  _writeLastSessionPointer: (sessionId: string) => void;
  /** Save a conversation snapshot to disk. */
  _saveSession: typeof saveSession;
  /** Retrieve pinned model IDs for the model picker. */
  _getPinned: () => Promise<string[]>;
  /** Retrieve configured provider IDs for the model picker. */
  _getConfiguredProviderIds: () => string[];
  /** Command registry used by InputHandler. main.ts needs this to wire input. */
  commandRegistry: import('../input/command-registry.ts').CommandRegistry;
  /**
   * System message router instantiated at startup, wired to conversation and panel manager.
   *
   * @remarks
   * Route operational messages through this rather than calling
   * conversation.addSystemMessage() directly so that low-priority messages
   * stay out of the main conversation and go to the SystemMessagesPanel instead.
   */
  systemMessageRouter: SystemMessageRouter;
};

// ── Bootstrap function ────────────────────────────────────────────────────

/**
 * Initialize all runtime subsystems and return a fully-wired RuntimeContext.
 *
 * main.ts calls this once, then uses the returned context to:
 *   - Run the render loop
 *   - Handle stdin/stdout events
 *   - Manage terminal lifecycle (alt-screen, raw mode, resize)
 *
 * Phase summary:
 *   1. Config, caches, keybindings
 *   2. Runtime event bus, conversation, compositor, selection
 *   3. Tool registry + agent wiring
 *   4. Runtime bus subscriptions (delegation, subagent, hook route)
 *   5. Providers, webhooks, PermissionManager, HookDispatcher
 *   6. Orchestrator and Agent-local task read models
 *   7. MCP auto-connect + workspace/panel manager
 *   8. Command registry + plugin init + CommandContext
 *   9. Input handler wiring
 *  10. Input history, splash options
 *  11. Background: provider auto-registration, persisted providers, scan
 */
export async function bootstrapRuntime(
  stdout: NodeJS.WriteStream,
  options: BootstrapOptions,
): Promise<BootstrapContext> {
  const workingDir = options.workingDir;
  const configManager = options.configManager;
  const controlPlaneRecentEventsRef: {
    value: (limit: number) => readonly import('@pellux/goodvibes-sdk/platform/control-plane').ControlPlaneRecentEvent[];
  } = {
    value: (_limit) => [],
  };
  const {
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
    setRenderRequest,
    runtimeSessionIdRef,
  } = await initializeBootstrapCore(stdout, options, (limit) => controlPlaneRecentEventsRef.value(limit));
  const providerRegistry = services.providerRegistry;
  const promptContextReceipts = new AgentPromptContextReceiptStore(
    services.shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'prompt-context-receipts.jsonl'),
  );
  let activePromptTurnId: string | null = null;
  runtimeUnsubs.push(
    runtimeBus.on<Extract<TurnEvent, { type: 'TURN_SUBMITTED' }>>('TURN_SUBMITTED', (event) => {
      activePromptTurnId = event.payload.turnId;
    }),
    runtimeBus.on<Extract<TurnEvent, { type: 'TURN_COMPLETED' }>>('TURN_COMPLETED', (event) => {
      promptContextReceipts.recordTurnOutcome({
        turnId: event.payload.turnId,
        status: 'completed',
        terminalEvent: 'TURN_COMPLETED',
        stopReason: event.payload.stopReason,
      });
      if (activePromptTurnId === event.payload.turnId) activePromptTurnId = null;
    }),
    runtimeBus.on<Extract<TurnEvent, { type: 'TURN_ERROR' }>>('TURN_ERROR', (event) => {
      promptContextReceipts.recordTurnOutcome({
        turnId: event.payload.turnId,
        status: 'error',
        terminalEvent: 'TURN_ERROR',
        stopReason: event.payload.stopReason,
        detail: event.payload.error,
      });
      if (activePromptTurnId === event.payload.turnId) activePromptTurnId = null;
    }),
    runtimeBus.on<Extract<TurnEvent, { type: 'TURN_CANCEL' }>>('TURN_CANCEL', (event) => {
      promptContextReceipts.recordTurnOutcome({
        turnId: event.payload.turnId,
        status: 'cancelled',
        terminalEvent: 'TURN_CANCEL',
        stopReason: event.payload.stopReason,
        detail: event.payload.reason,
      });
      if (activePromptTurnId === event.payload.turnId) activePromptTurnId = null;
    }),
  );
  const {
    automationManager,
    hookDispatcher,
    panelManager,
    pluginManager,
  } = services;

  // ── Phase 6: Orchestrator and Agent-local task read models ───────────────

  // Mutable function refs so main.ts can patch these after constructing the scroll/viewport state.
  // The orchestrator closes over these refs, so patching them in main.ts takes immediate effect.
  const orchestratorRefs = {
    getViewportHeight: (): number => 20,
    scrollToEnd: (_vHeight: number): void => { /* patched by main.ts */ },
    requestRender: (): void => { requestRender(); },
  };

  const orchestrator = new Orchestrator({
    conversation,
    getViewportHeight: () => orchestratorRefs.getViewportHeight(),
    scrollToEnd: (vHeight: number) => orchestratorRefs.scrollToEnd(vHeight),
    toolRegistry,
    permissionManager,
    getSystemPrompt: () => {
      const currentModel = providerRegistry.getCurrentModel();
      const contextWindow = providerRegistry.getContextWindowForModel(currentModel);
      const composed = composeRuntimePromptWithReceipt({
        sessionId: runtime.sessionId,
        turnId: activePromptTurnId,
        source: activePromptTurnId ? 'turn' : 'follow_up',
        provider: runtime.provider,
        model: currentModel,
        contextWindow,
        runtimePrompt: runtime.systemPrompt,
        operatorPolicy: GOODVIBES_AGENT_OPERATOR_POLICY,
        shellPaths: services.shellPaths,
        memoryRegistry: services.memoryRegistry,
      });
      promptContextReceipts.record(composed.receipt);
      return composed.prompt;
    },
    hookDispatcher,
    flagManager: services.featureFlags,
    requestRender: () => orchestratorRefs.requestRender(),
    runtimeBus,
    sessionId: runtime.sessionId,
    services: {
      agentManager: services.agentManager,
      wrfcController: services.wrfcController,
    },
  });
  conversationFollowUpRef.value = (item) => orchestrator.enqueueConversationFollowUp(item);
  // Wire orchestratorHandleUserInputRef so COMPANION_MESSAGE_RECEIVED fires a real LLM turn.
  orchestratorHandleUserInputRef.value = (text: string, options?: OrchestratorUserInputOptions) => {
    orchestrator.handleUserInput(text, undefined, options).catch((err: unknown) => {
      logger.debug('companion handleUserInput safety catch', { error: String(err) });
    });
  };
  orchestrator.setCoreServices({
    configManager,
    providerRegistry,
    cacheHitTracker: services.cacheHitTracker,
    planManager: services.planManager,
    adaptivePlanner: services.adaptivePlanner,
    sessionMemoryStore: services.sessionMemoryStore,
    sessionLineageTracker: services.sessionLineageTracker,
    idempotencyStore: services.idempotencyStore,
  });
  conversation.setSessionLineageTracker(services.sessionLineageTracker);

  const opsTaskManager = createTaskManager(store, runtimeBus, userSessionId);
  const opsControlPlane = services.featureFlags.isEnabled('operator-control-plane')
    ? new OpsControlPlane(opsTaskManager, runtimeBus, store, userSessionId)
    : undefined;

  const shell = createBootstrapShell({
    configManager,
    runtimeBus,
    runtimeStore: store,
    services,
    conversation,
    runtime,
    orchestrator,
    requestRender,
    permissionPromptRef,
    onSessionIdChanged: (sessionId) => {
      runtimeSessionIdRef.value = sessionId;
    },
    writeLastSessionPointer,
    getControlPlaneRecentEvents: (limit) => controlPlaneRecentEventsRef.value(limit),
    toolRegistry,
    promptContextReceipts,
    forensicsRegistry,
    policyRuntimeState: services.policyRuntimeState,
    uiServices,
    taskManager: opsTaskManager,
    opsControlPlane,
    completeModelSelectionSideEffect: () => {
      compositor.resetDiff();
    },
  });
  const systemMessageRouter = shell.systemMessageRouter;
  systemMessageRouterRef.value = systemMessageRouter;
  const commandRegistry = shell.commandRegistry;
  const commandContext = shell.commandContext;
  const inputHistory = shell.inputHistory;
  registerAgentHarnessTool(toolRegistry, commandRegistry, commandContext);
  registerAgentAutonomyTool(toolRegistry, commandRegistry, commandContext);
  registerAgentChannelsTool(toolRegistry, commandRegistry, commandContext);
  registerAgentComputerTool(toolRegistry, commandRegistry, commandContext);
  registerAgentContextTool(toolRegistry, commandRegistry, commandContext);
  registerAgentDelegationTool(toolRegistry, commandRegistry, commandContext);
  registerAgentDeviceTool(toolRegistry, commandRegistry, commandContext);
  registerAgentExecutionTool(toolRegistry, commandRegistry, commandContext);
  registerAgentHostTool(toolRegistry, commandRegistry, commandContext);
  registerAgentMemoryTool(toolRegistry, commandRegistry, commandContext);
  registerAgentModelsTool(toolRegistry, commandRegistry, commandContext);
  registerAgentPersonalOpsTool(toolRegistry, commandRegistry, commandContext);
  registerAgentResearchTool(toolRegistry, commandRegistry, commandContext);
  registerAgentSetupTool(toolRegistry, commandRegistry, commandContext);
  registerAgentSettingsTool(toolRegistry, commandRegistry, commandContext);
  registerAgentVibeTool(toolRegistry, commandContext);
  registerAgentWorkspaceTool(toolRegistry, commandRegistry, commandContext);
  registerAgentSettingsImportTool(toolRegistry, commandContext);
  registerAgentTerminalProcessTools(toolRegistry, commandContext);
  compactRegisteredToolDefinitions(toolRegistry);
  const pluginCommandRegistry = {
    register(command: {
      readonly name: string;
      readonly aliases?: readonly string[];
      readonly description: string;
      readonly usage?: string;
      readonly argsHint?: string;
      readonly handler: (args: string[]) => void | Promise<void>;
    }): void {
      commandRegistry.register({
        ...command,
        aliases: command.aliases ? [...command.aliases] : undefined,
      });
    },
    unregister(name: string): void {
      commandRegistry.unregister(name);
    },
  };

  // ── Phase 7: Connected-host posture + deferred startup ────────────────

  const deferredStartup = createDeferredStartupCoordinator();

  const formatHostServiceBaseUrl = (host: string, port: number): string => {
    const normalized = host.trim().toLowerCase();
    const probeHost = normalized === '0.0.0.0'
      ? '127.0.0.1'
      : normalized === '::' || normalized === '[::]'
        ? '::1'
        : host;
    const urlHost = probeHost.includes(':') && !probeHost.startsWith('[') ? `[${probeHost}]` : probeHost;
    return `http://${urlHost}:${port}`;
  };

  const createAgentDependencyStatus = (
    service: 'daemon' | 'httpListener',
  ): HostServiceStatus => {
    const host = String(configManager.get(service === 'daemon' ? 'controlPlane.host' : 'httpListener.host') ?? '127.0.0.1');
    const port = Number(configManager.get(service === 'daemon' ? 'controlPlane.port' : 'httpListener.port') ?? (service === 'daemon' ? 3421 : 3422));
    return {
      mode: service === 'daemon' ? 'external' : 'disabled',
      host,
      port,
      baseUrl: formatHostServiceBaseUrl(host, port),
      reason: service === 'daemon'
        ? 'GoodVibes Agent connects to a GoodVibes host owned outside this product and does not start or restart it.'
        : 'GoodVibes Agent does not own listener lifecycle.',
    };
  };

  const hostServiceIsActive = (status: HostServiceStatus): boolean => status.mode === 'embedded' || status.mode === 'external';

  const hostServiceIsBlocked = (status: HostServiceStatus): boolean => status.mode === 'blocked';

  const inspectAgentDependencies = () => {
    const daemonStatus = externalServices.daemonStatus;
    const httpListenerStatus = externalServices.httpListenerStatus;
    return {
      connectedHostRunning: hostServiceIsActive(daemonStatus),
      connectedHostPortInUse: hostServiceIsBlocked(daemonStatus),
      httpListenerRunning: hostServiceIsActive(httpListenerStatus),
      httpListenerPortInUse: hostServiceIsBlocked(httpListenerStatus),
      connectedHostStatus: daemonStatus,
      httpListenerStatus,
    };
  };

  let externalServices: ExternalServicesHandle = {
    daemonServer: null,
    httpListener: null,
    daemonStatus: createAgentDependencyStatus('daemon'),
    httpListenerStatus: createAgentDependencyStatus('httpListener'),
    listRecentControlPlaneEvents: () => [],
    async stop(): Promise<void> {},
  };
  const platformExternalServices = uiServices.platform as typeof uiServices.platform & {
    externalServices: NonNullable<typeof uiServices.platform.externalServices>;
  };
  platformExternalServices.externalServices = {
    inspect: inspectAgentDependencies,
    restart: async () => {
      externalServices = {
        ...externalServices,
        daemonStatus: createAgentDependencyStatus('daemon'),
        httpListenerStatus: createAgentDependencyStatus('httpListener'),
      };
      systemMessageRouter.high('[Startup] GoodVibes Agent does not start or restart the connected GoodVibes host. Start it from GoodVibes TUI or the owning host, then refresh status.');
      requestRender();
      return inspectAgentDependencies();
    },
  };
  deferredStartup.schedule({
    label: 'plugins',
    run: async () => {
      await pluginManager.init({
        runtimeBus,
        commandRegistry: pluginCommandRegistry,
        providerRegistry,
        toolRegistry,
        gatewayMethods: services.gatewayMethods,
        channelRegistry: services.channelPlugins,
        channelDeliveryRouter: services.deliveryManager.getDeliveryRouter(),
        memoryEmbeddingRegistry: services.memoryEmbeddingRegistry,
        voiceProviderRegistry: services.voiceProviders,
        mediaProviderRegistry: services.mediaProviders,
        webSearchProviderRegistry: services.webSearchProviders,
        getPluginConfig: (name) => pluginManager.getPluginConfig(name),
        isEnabled: (name) => pluginManager.isEnabled(name),
      });
      requestRender();
    },
    onError: (error) => {
      const message = summarizeError(error);
      logger.error('Deferred plugin startup failed', { error: message });
      systemMessageRouter.high(`[Startup] Plugin initialization failed: ${message}`);
      requestRender();
    },
  });
  const toolCount = toolRegistry.list().length;
  conversation.splashOptions = {
    workingDir,
    model: runtime.model,
    provider: runtime.provider,
    toolCount,
  };

  // ── Phase 8: Background provider registration (non-blocking) ────────────
  // These run after the initial render so they don't delay startup.

  startBackgroundProviderRegistration({
    configManager,
    providerRegistry,
    runtime,
    requestRender,
    restoreRuntimeModel: restoreSavedModel,
    systemMessageRouter,
    shellPaths: services.shellPaths,
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
  });
  const mcpDiscovery = scheduleBackgroundMcpDiscovery({
    mcpRegistry: services.mcpRegistry,
    systemMessageRouter,
    requestRender,
    shellPaths: services.shellPaths,
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
  });
  bootstrapUnsubs.push(() => mcpDiscovery.stop());
  const mcpAutoReload = startMcpConfigAutoReload({
    roots: services.shellPaths,
    registry: services.mcpRegistry,
    onReload: ({ connected, total }) => {
      systemMessageRouter.low(`[MCP] Reloaded config: ${connected}/${total} server(s) connected.`);
      requestRender();
    },
    onError: (error) => {
      const message = summarizeError(error);
      logger.warn('MCP config auto-reload failed', { error: message });
      systemMessageRouter.high(`[MCP] Config reload failed: ${message}`);
      requestRender();
    },
  });
  bootstrapUnsubs.push(() => mcpAutoReload.stop());
  if (configManager.get('automation.enabled')) {
    logger.warn('Local automation startup is disabled in GoodVibes Agent; use connected-host observability instead.');
    systemMessageRouter.low('[Startup] Local automation execution is disabled in GoodVibes Agent; use read-only automation observability or explicit connected-host actions.');
  }

  // ── Phase 12: Session:start lifecycle hook ─────────────────────────────

  fireSessionStart(runtime.sessionId, services.hookDispatcher);
  emitSessionStarted(runtimeBus, {
    sessionId: runtime.sessionId,
    traceId: `${runtime.sessionId}:session-start`,
    source: 'bootstrap',
  }, {
    sessionId: runtime.sessionId,
    profileId: 'default',
    workingDir,
  });
  emitSessionReady(runtimeBus, {
    sessionId: runtime.sessionId,
    traceId: `${runtime.sessionId}:session-ready`,
    source: 'bootstrap',
  }, {
    sessionId: runtime.sessionId,
  });

  // ── Compose RuntimeContext ────────────────────────────────────────────────

  const ctx: BootstrapContext = {
    runtimeBus,
    store,
    services,
    featureFlags: services.featureFlags,
    conversation,
    permissions: permissionManager,
    toolRegistry,
    providerRegistry,
    componentHealthMonitor: services.componentHealthMonitor,
    worktreeRegistry: services.worktreeRegistry,
    sandboxSessionRegistry: services.sandboxSessionRegistry,
    hookDispatcher,
    fileCache,
    projectIndex,
    sessionId: userSessionId,
    isResumed: false, // Sessions start fresh; use /session resume to load a previous one
    runtime,
    orchestrator,
    compositor,
    selection,
    commandContext,
    uiServices,
    inputHistory,
    bootstrapUnsubs,
    agentStatusIntervalRef,
    orchestratorRefs,
    setRenderRequest,
    permissionPromptRef,
    loadLastConversation: () => loadLastConversation({
      workingDirectory: services.workingDirectory,
      homeDirectory: services.homeDirectory,
      sessionManager: services.sessionManager,
    }),
    _writeLastSessionPointer: (sessionId) => writeLastSessionPointer(sessionId, {
      workingDirectory: services.workingDirectory,
      homeDirectory: services.homeDirectory,
    }),
    _saveSession: saveSession,
    _getPinned: () => services.favoritesStore.getPinned(),
    _getConfiguredProviderIds: () => services.providerRegistry.getConfiguredProviderIds(),
    commandRegistry,
    systemMessageRouter,
    shutdown: async (sessionData) => {
      // Clear bootstrap-owned subscriptions
      bootstrapUnsubs.forEach(fn => fn());
      bootstrapUnsubs.length = 0;
      runtimeUnsubs.forEach((fn) => fn());
      runtimeUnsubs.length = 0;
      forensicsCollector.dispose();
      services.executionLedger.dispose();
      await deferredStartup.drain(100);
      await externalServices.stop();
      // Clear agent status interval via ref (consistent with agentStatusIntervalRef usage)
      if (agentStatusIntervalRef.value !== null) {
        clearInterval(agentStatusIntervalRef.value);
        agentStatusIntervalRef.value = null;
      }
      await shutdownRuntime(
        runtime.sessionId,
        sessionData,
        runtime.model,
        runtime.provider,
        conversation.title || '',
        services.workflow.scheduleManager,
        services.hookDispatcher,
        services.providerRegistry,
        services.sessionOrchestration,
        {
          workingDirectory: services.workingDirectory,
          homeDirectory: services.homeDirectory,
          sessionManager: services.sessionManager,
        },
      );
    },
  };

  // Wire exit from options if provided; otherwise main.ts binds the operator route.
  if (options?.exit) {
    ctx.commandContext.exit = options.exit;
  }

  return ctx;
}
