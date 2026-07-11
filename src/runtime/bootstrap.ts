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
import { scheduleBackgroundMcpDiscovery } from '@/runtime/index.ts';
import { restoreSavedModel } from '@/runtime/index.ts';
import { runGatedLanScan } from './lan-scan-consent.ts';
import { scheduleCalendarSubscriptionBootRefresh } from './calendar-boot-refresh.ts';
import type { TurnEvent } from '@/runtime/index.ts';
import type { UiRuntimeServices } from './ui-services.ts';
import { createDeferredStartupCoordinator } from '@/runtime/index.ts';
import { wireAgentExternalServices } from './bootstrap-external-services.ts';
import { initializeBootstrapCore } from './bootstrap-core.ts';
import { bindOrchestratorContextAccounting } from './context-accounting-source.ts';
import { createBootstrapShell } from './bootstrap-shell.ts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { startMcpConfigAutoReload } from '../mcp/runtime-reload.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';
import { foldLegacySpineStore } from '@pellux/goodvibes-sdk/platform/runtime/session-spine';
import { reconcileMemorySpineAdoption } from './memory-spine-adoption.ts';
import { AgentPromptContextReceiptStore, composeRuntimePromptWithReceipt } from '../agent/prompt-context-receipts.ts';
import { createMemoryConsolidationScheduler } from './memory-consolidation-wiring.ts';
import { recordTurnAnchor, summarizeTurnLabel } from '../core/rewind-turn-anchors.ts';
import { createMemoryUsageTracker } from './memory-usage-wiring.ts';
import { registerAgentAuditTool } from '../tools/agent-audit-tool.ts';
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
import { registerAgentRouteTool } from '../tools/agent-route-tool.ts';
import { registerAgentSecurityTool } from '../tools/agent-security-tool.ts';
import { registerAgentSessionsTool } from '../tools/agent-sessions-tool.ts';
import { registerAgentSetupTool } from '../tools/agent-setup-tool.ts';
import { registerAgentSettingsImportTool } from '../tools/agent-settings-import-tool.ts';
import { registerAgentSettingsTool } from '../tools/agent-settings-tool.ts';
import { registerAgentSupportTool } from '../tools/agent-support-tool.ts';
import { registerAgentTerminalProcessTools } from '../tools/agent-terminal-process-tools.ts';
import { registerAgentVibeTool } from '../tools/agent-vibe-tool.ts';
import { registerAgentWorkspaceTool } from '../tools/agent-workspace-tool.ts';
import { compactRegisteredToolDefinitions } from '../tools/tool-definition-compaction.ts';

const GOODVIBES_AGENT_OPERATOR_POLICY = [
  '## GoodVibes Agent Operator Policy',
  '- Act as one user-facing autonomous assistant. Prefer the lowest-friction safe path that completes the user outcome; do not expose internal package or host ownership unless it is needed for diagnosis, setup, or safety.',
  '- Work serially in the main conversation by default for ordinary chat, research, planning, setup, local context, and short tool work. Use visible schedules, work plans, operator actions, or delegated/remote routes for durable or long-running autonomy.',
  '- Connected-host lifecycle is not ambient. If the host is unavailable, explain the shortest user action to make the assistant reachable; do not pretend a missing host route worked.',
  '- Read tools: `route action:"plan|status"`, `schedule action:"list"`, `setup action:"status|item|repair|checkpoint"`, `settings action:"list|get"`, `vibe action:"status|show"`, `context action:"status|files|file|prompt|receipts|receipt"`, `memory action:"status|provider|curator|candidate|list|search|get"`, `channels action:"status|channel|setup|triage|deliveries"`, `models action:"status|route|local|providers|provider"`, `personal_ops action:"briefing|status|queue|intake|lane"`, `autonomy action:"intake|queue|item|status"`, `delegation action:"status|routes|route"`, `execution action:"status|route|history|record|processes|process_capabilities|process|recovery"`, `security action:"status|finding|explain"`, `support action:"status|bundle"`, `sessions action:"list|get"`, `audit action:"readiness|item|evidence|artifact"`, `computer action:"status|plan|control|browser|setup|mcp"`, `research action:"plan|search|runner|runs|run|sources|source|bundle|reports|report_artifact"`, `device action:"status|capability|browser|control|voice|provider"`, `workspace action:"status|actions|action|surfaces|surface|shortcuts|keybindings|keybinding|commands|command|cli_commands|cli_command"`, `host action:"status|capabilities|capability|services|service|methods|method"`, `import_goodvibes_settings action:"preview"`, and `agent_operator_briefing` for connected work/approvals/automation/schedules, `agent_knowledge` for isolated Agent Knowledge, and `agent_harness` for harness catalogs/status/capability discovery. Use `agent_artifacts` for saved artifact list/preview/export/package/archive; write modes are confirmation-gated.',
  '- Harness access: use `settings action:"set|reset|import"` and `workspace action:"run|run_command|open|run_keybinding|set_keybinding|reset_keybinding"` to use the same surfaces the user can use; lower-level `agent_harness` modes remain for detail inspection and compatibility.',
  '- State tools: `agent_work_plan` for visible local work items; `agent_local_registry` for Agent-local notes, memory, personas, skills, bundles, and routines; `agent_learning_consolidation` for confirmed duplicate cleanup phases; `agent_documents` for versioned Agent document drafts. Keep records non-secret, sourced, and reviewable.',
  '- Confirmed tools: use `schedule`, `setup action:"save_checkpoint|clear_checkpoint|token|smoke|finish|import_settings"`, `vibe action:"init|import_persona"`, `models action:"smoke"` for local model server checks, `personal_ops action:"read"` for one live read-only inbox/calendar connector operation, `research action:"create_run|start_run|checkpoint|pause|resume|cancel|complete|fail|delete_run|add_source|review_source|reject_source|use_source|delete_source|report"`, `computer action:"open_browser"`, `device action:"open_browser|open_tts_provider|open_tts_voice"`, `workspace action:"run|run_command|open|run_keybinding|set_keybinding|reset_keybinding"`, `import_goodvibes_settings`, `agent_operator_action`, `agent_artifacts` export/package/archive, `agent_documents`, `agent_review_packet_presets` save/refresh, `agent_review_packet_share`, `agent_knowledge_ingest`, `agent_learning_consolidation`, `agent_media_generate`, `agent_model_compare`, `agent_research_runs`, `agent_research_sources`, `agent_research_report`, `agent_notify`, `agent_channel_send`, `agent_autonomy_schedule`, `agent_reminder_schedule`, and `agent_schedule_edit` only for explicit user requests with confirm:true and explicitUserRequest.',
  '- Agent Knowledge must use only `/api/goodvibes-agent/knowledge/*` and fail closed. Do not use default knowledge or non-Agent knowledge spaces.',
  '- External delivery, media generation, reminders, settings writes, slash-command mirrors, workspace action mirrors, and destructive local changes require explicit user intent and the owning tool/command confirmation.',
  '- Autonomous work must be visible, reviewable, and cancellable. Never create silent hidden jobs; when work should continue later, create or use an explicit schedule, reminder, work-plan item, operator action, or delegated/remote task route.',
  '- Do not delegate planning, research, operations, knowledge, memory, configuration, approvals, observability, or ordinary assistant work when an Agent-owned route can satisfy the user directly.',
  '- When the safest user route is not obvious, call `route action:"plan"` with the plain user task, then follow the preferred visible route and confirmation boundary returned there.',
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
  // The current turn's raw text: the injection seam
  // (composeRuntimePromptWithReceipt, invoked from getSystemPrompt below) needs the
  // active turn's intent to rank the already-eligible memory set by relevance. This is
  // the real seam that was left unthreaded — TURN_SUBMITTED already carries `prompt`, it
  // was just never captured. Mirrors activePromptTurnId's lifecycle exactly: set on
  // TURN_SUBMITTED, cleared on every terminal event for that turn.
  let activePromptTurnText: string | null = null;
  // Idle-time memory consolidation: reviews stored memory when the agent is
  // genuinely idle (no active turn) and no sooner than the configured interval,
  // off by default. Every run leaves a receipt of what it merged/archived/proposed.
  // Usage-outcome instrumentation: records which memories were injected and, at
  // turn completion, whether the model output plausibly referenced them (honest
  // heuristic overlap). Feeds consolidation's never-referenced-first decay.
  const memoryUsageTracker = createMemoryUsageTracker(services.shellPaths, services.memoryRegistry);
  const memoryConsolidationScheduler = createMemoryConsolidationScheduler({
    configManager,
    memoryRegistry: services.memoryRegistry,
    shellPaths: services.shellPaths,
    isIdle: () => activePromptTurnId === null,
    usageLookup: (id) => memoryUsageTracker.lookup(id),
  });
  runtimeUnsubs.push(
    runtimeBus.on<Extract<TurnEvent, { type: 'TURN_SUBMITTED' }>>('TURN_SUBMITTED', (event) => {
      activePromptTurnId = event.payload.turnId;
      activePromptTurnText = event.payload.prompt;
      // Per-turn recall refresh (SDK 1.2.0 sync-recall seam): the ASYNC
      // pre-turn hook. getSystemPrompt below is SYNCHRONOUS and cannot await
      // this, so it is fired here (not awaited) and read back via the cached
      // recallSnapshot() a moment later when the orchestrator actually builds
      // the prompt. A miss (this turn's prompt reads last turn's snapshot, or
      // the still-empty boot snapshot on a very first turn) is surfaced
      // honestly by the snapshot's own staleness note, never silently hidden.
      services.memorySpineClient.refreshRecallSnapshot(undefined, { recall: false }).catch((error: unknown) => {
        logger.debug('Per-turn memory recall snapshot refresh failed', { error: summarizeError(error) });
      });
    }),
    runtimeBus.on<Extract<TurnEvent, { type: 'TURN_COMPLETED' }>>('TURN_COMPLETED', (event) => {
      promptContextReceipts.recordTurnOutcome({
        turnId: event.payload.turnId,
        status: 'completed',
        terminalEvent: 'TURN_COMPLETED',
        stopReason: event.payload.stopReason,
      });
      // Record this turn's rewind anchor: pair the turnId (shared with the
      // workspace checkpoint the turn engine snapshots for this same turn)
      // with the live conversation message count, so a later message-anchored
      // rewind.plan/apply (scope 'conversation' or 'both') can truncate the
      // conversation to exactly this boundary — the join key between
      // conversation and files rewind (see core/rewind-turn-anchors.ts and
      // services.ts's conversationRewindPort wiring).
      try {
        recordTurnAnchor(runtimeSessionIdRef.value, {
          turnId: event.payload.turnId,
          label: summarizeTurnLabel(conversation.getLastUserMessage()),
          messageCount: conversation.getMessageCount(),
          at: Date.now(),
        });
      } catch (error) {
        // Best-effort; a rewind-anchor miss must never break the turn.
        logger.debug('rewind turn-anchor recording failed', { error: summarizeError(error) });
      }
      if (activePromptTurnId === event.payload.turnId) {
        activePromptTurnId = null;
        activePromptTurnText = null;
      }
      memoryUsageTracker.onTurnCompleted(event.payload.turnId, event.payload.response);
      memoryConsolidationScheduler.onTurnSettled();
    }),
    runtimeBus.on<Extract<TurnEvent, { type: 'TURN_ERROR' }>>('TURN_ERROR', (event) => {
      promptContextReceipts.recordTurnOutcome({
        turnId: event.payload.turnId,
        status: 'error',
        terminalEvent: 'TURN_ERROR',
        stopReason: event.payload.stopReason,
        detail: event.payload.error,
      });
      if (activePromptTurnId === event.payload.turnId) {
        activePromptTurnId = null;
        activePromptTurnText = null;
      }
      memoryUsageTracker.onTurnAborted(event.payload.turnId);
      memoryConsolidationScheduler.onTurnSettled();
    }),
    runtimeBus.on<Extract<TurnEvent, { type: 'TURN_CANCEL' }>>('TURN_CANCEL', (event) => {
      promptContextReceipts.recordTurnOutcome({
        turnId: event.payload.turnId,
        status: 'cancelled',
        terminalEvent: 'TURN_CANCEL',
        stopReason: event.payload.stopReason,
        detail: event.payload.reason,
      });
      if (activePromptTurnId === event.payload.turnId) {
        activePromptTurnId = null;
        activePromptTurnText = null;
      }
      memoryUsageTracker.onTurnAborted(event.payload.turnId);
      memoryConsolidationScheduler.onTurnSettled();
    }),
  );
  const {
    automationManager,
    hookDispatcher,
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
        turnText: activePromptTurnText,
        memoryRecallSnapshot: services.memorySpineClient.recallSnapshot(),
      });
      promptContextReceipts.record(composed.receipt);
      memoryUsageTracker.onComposed(activePromptTurnId, composed.receipt);
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

  // Bind the context_accounting tool (SDK 1.6.1) to THIS Orchestrator so it
  // reports real session data instead of the unbound-holder honesty message.
  // Must run after setCoreServices (nothing here depends on it, but this
  // keeps every orchestrator.* wiring call grouped) and before the first
  // turn — see context-accounting-source.ts for what each facet reads.
  runtimeUnsubs.push(bindOrchestratorContextAccounting({
    orchestrator,
    holder: services.contextAccountingHolder,
    runtimeBus,
    runtimeStore: store,
    sessionId: runtime.sessionId,
    getContextWindow: () => providerRegistry.getContextWindowForModel(providerRegistry.getCurrentModel()),
  }));

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
  registerAgentAuditTool(toolRegistry, commandRegistry, commandContext);
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
  registerAgentRouteTool(toolRegistry, commandContext);
  registerAgentSecurityTool(toolRegistry, commandRegistry, commandContext);
  registerAgentSessionsTool(toolRegistry, commandRegistry, commandContext);
  registerAgentSetupTool(toolRegistry, commandRegistry, commandContext);
  registerAgentSettingsTool(toolRegistry, commandRegistry, commandContext);
  registerAgentSupportTool(toolRegistry, commandRegistry, commandContext);
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

  // GoodVibes Agent never owns the connected daemon's (or HTTP listener's)
  // lifecycle — see bootstrap-external-services.ts for the adopt-only wiring
  // and the deferred discovery probe it schedules.
  const agentExternalServices = wireAgentExternalServices({
    configManager,
    runtimeBus,
    hookDispatcher,
    services,
    uiServices,
    deferredStartup,
    systemMessageRouter,
    requestRender,
  });

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
  // W2A: probe the daemon spine OFF the interactive path. On a reachable daemon,
  // fold the agent's own per-cwd legacy session store into it (once; marked
  // migrated). Never starts the daemon; a down/absent daemon leaves the agent
  // local-only with an honest offline status.
  deferredStartup.schedule({
    label: 'session-spine',
    run: async () => {
      const reachability = await services.sessionSpineClient.probeReachability();
      if (reachability !== 'online') return;
      foldLegacySpineStore(services.sessionSpineClient, {
        storePath: services.shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'control-plane', 'sessions.json'),
        markerPath: services.shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'control-plane', 'sessions.spine-folded.json'),
        project: workingDir,
        log: logger,
      });
    },
    onError: (error) => {
      logger.debug('Deferred session-spine startup failed', { error: summarizeError(error) });
    },
  });
  // Memory spine (SDK 1.1.0): the daemon-owned canonical memory store is
  // single-writer, so the agent must make an explicit adopted/not-adopted decision
  // rather than trying the wire per call. Reuses the SAME reachability signal as the
  // session-spine fold above (services.sessionSpineClient.probeReachability(), one
  // daemon, one connected-host token) instead of inventing a second probe. On a
  // reachable daemon, activate the spine for CLIENT mode — every wire-covered memory
  // op now routes over HTTP and the local store is never written again. Embedded/
  // offline is unaffected: the agent must keep working with no daemon running, and a
  // failed/absent probe simply leaves the client in its constructed LOCAL mode.
  //
  // A daemon can also appear or disappear AFTER boot, so this keeps checking for the
  // whole process lifetime on the same cadence as the runtime heartbeat: adopt late
  // if one shows up, and hand back to local (deactivate) the moment a PREVIOUSLY
  // adopted daemon stops answering — never guess and keep routing to a dead wire.
  let memorySpineHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const reconcileMemorySpine = (): Promise<void> => reconcileMemorySpineAdoption({
    memorySpineClient: services.memorySpineClient,
    transport: services.memorySpineTransport,
    probeReachability: () => services.sessionSpineClient.probeReachability(),
  });
  deferredStartup.schedule({
    label: 'memory-spine',
    run: async () => {
      await reconcileMemorySpine();
      // Prime the recall snapshot (SDK 1.2.0 sync-recall seam) so the FIRST
      // system prompt built after boot already has a real snapshot to read
      // instead of the honest-but-empty "not yet captured" one — see
      // recallSnapshot's doc comment on prompt-context-receipts.ts's
      // memoryRecallSnapshot field. { recall: false } captures an unfiltered
      // browse set: the receipt's own eligibility/suppression logic (not the
      // snapshot) decides what is prompt-active, so this must mirror the old
      // memoryRegistry.getAll() read exactly, not the recall-floor-filtered set.
      await services.memorySpineClient.refreshRecallSnapshot(undefined, { recall: false }).catch((error: unknown) => {
        logger.debug('Initial memory recall snapshot refresh failed', { error: summarizeError(error) });
      });
      if (configManager.get('watchers.enabled')) {
        const intervalMs = Number(configManager.get('watchers.heartbeatIntervalMs') ?? 30_000);
        memorySpineHeartbeatTimer = setInterval(() => {
          reconcileMemorySpine().catch((error: unknown) => {
            logger.debug('Memory-spine reachability recheck failed', { error: summarizeError(error) });
          });
        }, intervalMs);
        memorySpineHeartbeatTimer.unref?.();
      }
    },
    onError: (error) => {
      logger.debug('Deferred memory-spine startup failed', { error: summarizeError(error) });
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
  //
  // Gated: the SDK's discovery pass probes every host on the local subnet
  // unconditionally, so it is only ever invoked through runGatedLanScan,
  // which requires an explicit, persisted consent decision first and reframes
  // whatever the SDK emits into a single honest summary line. See
  // src/runtime/lan-scan-consent.ts.

  runGatedLanScan({
    configManager,
    providerRegistry,
    runtime,
    requestRender,
    restoreRuntimeModel: restoreSavedModel,
    systemMessageRouter,
    shellPaths: services.shellPaths,
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
  });
  // Refresh explicitly-subscribed external calendar feeds that are DUE
  // per their own bounded interval (conditional 304 requests keep it cheap).
  // Consent was given at subscribe time ("now and on each refresh"); with no
  // subscriptions this touches nothing. Non-blocking — boot never waits on it;
  // one honest aggregate line only when something refreshed or failed.
  void scheduleCalendarSubscriptionBootRefresh({
    shellPaths: services.shellPaths,
    secretsManager: services.secretsManager,
    systemMessageRouter,
    requestRender,
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
      // W2A: best-effort spine close (short timeout, fire-and-forget) then stop
      // the heartbeat timer. Tolerates a racing daemon stop; never blocks teardown.
      services.sessionSpineClient.close(runtime.sessionId);
      services.sessionSpineClient.dispose();
      // Stop the memory-spine reachability recheck timer (see the 'memory-spine'
      // deferred startup task above). No wire close call needed — unlike sessions,
      // memory ops are request/response, not a registered/heartbeat-tracked record.
      if (memorySpineHeartbeatTimer !== null) {
        clearInterval(memorySpineHeartbeatTimer);
        memorySpineHeartbeatTimer = null;
      }
      // Clear bootstrap-owned subscriptions
      bootstrapUnsubs.forEach(fn => fn());
      bootstrapUnsubs.length = 0;
      runtimeUnsubs.forEach((fn) => fn());
      runtimeUnsubs.length = 0;
      forensicsCollector.dispose();
      services.executionLedger.dispose();
      await deferredStartup.drain(100);
      await agentExternalServices.stop();
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
