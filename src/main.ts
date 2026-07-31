#!/usr/bin/env bun
import { homedir } from 'node:os';
import { Compositor } from './renderer/compositor.ts';
import { installStartupThemeProbe } from './renderer/startup-theme-probe.ts';
import { ThinkingStallClock, buildThinkingOverlay } from './core/thinking-overlay.ts';
import { UIFactory } from './renderer/ui-factory.ts';
import { Orchestrator } from './core/orchestrator';
import { conversationMessagesAsSessionRecords } from './core/conversation-message-snapshot.ts';
import { createTranscriptNavigators } from './shell/transcript-navigation.ts';
import { InputHandler } from './input/handler.ts';
import { SelectionManager } from './input/selection.ts';
import type { ContentPart } from '@pellux/goodvibes-sdk/platform/providers';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { registerAllTools } from '@pellux/goodvibes-sdk/platform/tools';
import { FileUndoManager } from '@pellux/goodvibes-sdk/platform/state';
import { PermissionManager } from '@pellux/goodvibes-sdk/platform/permissions';
import { PermissionPromptUI } from './permissions/prompt.ts';
import { CommandRegistry } from './input/command-registry.ts';
import type { CommandContext } from './input/command-registry.ts';
import { renderProcessIndicator } from './renderer/process-indicator.ts';
import { renderModelWorkspace } from './renderer/model-workspace.ts';
import { renderSettingsModal } from './renderer/settings-modal.ts';
import { registerBuiltinCommands } from './input/commands.ts';
import { ScheduleManager } from '@pellux/goodvibes-sdk/platform/tools';
import { InputHistory } from './input/input-history.ts';
import { ShellPassthrough, SHELL_USAGE_HINT } from './input/shell-passthrough.ts';
import { getTierPromptSupplement, getTierForContextWindow } from '@pellux/goodvibes-sdk/platform/providers';
import { createShellLayout } from './renderer/layout-engine.ts';
import { buildShellFooter, estimateShellFooterHeight } from './renderer/shell-surface.ts';
import { buildConversationViewport } from './renderer/conversation-layout.ts';
import { applyConversationOverlays } from './renderer/conversation-overlays.ts';
import { buildActivitySidebarLines, buildSidebarAgentRows, resolveSidebarWidthWithOverride } from './renderer/activity-sidebar.ts';
import { logger, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { bootstrapRuntime } from './runtime/bootstrap.ts';
import type { BootstrapContext } from './runtime/bootstrap.ts';
import type { HITLMode } from '@pellux/goodvibes-sdk/platform/state';
import { startFirstRenderFollowups } from './shell/first-render-followups.ts';
import { localModelCookbook } from './tools/agent-harness-model-routing.ts';
import { localModelSetupStatus } from './tools/agent-harness-setup-model-helpers.ts';
import {
  consumeRecovery,
  removeRecoveryPoint,
} from '@/runtime/index.ts';
import type { SessionSnapshot } from '@/runtime/index.ts';
import { handleBlockingShellInput, type PendingPermissionState, type PendingWorkspaceRegistrationState } from './shell/blocking-input.ts';
import { createAgentWorkspaceFullscreenComposite, createFullscreenCompositeFromLines } from './shell/agent-workspace-fullscreen.ts';
import { getTerminalSize } from './shell/terminal-size.ts';
import { buildShellSessionContinuityHints } from './shell/session-continuity-hints.ts';
import { wireShellUiOpeners } from './shell/ui-openers.ts';
import { deriveComposerState } from './core/composer-state.ts';
import { describePowerStatus } from './renderer/power-status.ts';
import { buildPersistedSessionContext } from '@/runtime/index.ts';
import { installFocusModeExitGuard, markFocusModeEnabled, wrapRequestPermissionWithApprovalAlert } from './shell/terminal-focus-mode.ts';
import { CLEAR_VIEWPORT_HOME, buildEnterSequence, buildExitSequence } from './renderer/terminal-escapes.ts';
import { prepareShellCliRuntime } from './cli/entrypoint.ts';
import { reachabilityAtLaunch } from './runtime/path-shadow-startup.ts';
import { selfUpdateAtLaunch } from './cli/launch-auto-update.ts';
import { startPeriodicSelfUpdate } from './runtime/periodic-update.ts';
import { applyInitialTuiCliState, getInteractiveTerminalLaunchError, reportFatalStartupError } from './cli/tui-startup.ts';
import { writeFatalLine } from './utils/fatal-boot-write.ts';
import { wireSpokenTurnRuntime } from './audio/spoken-turn-wiring.ts';
import { installVoiceCapture } from './shell/voice-capture-shell.ts';
import { createUnhandledRejectionHandler } from './runtime/unhandled-rejection-guard.ts';
import { attachSpokenTurnModelRouting, createSpokenTurnInputOptions } from './audio/spoken-turn-model-routing.ts';
import { allowTerminalWrite, installFullScreenTerminalOutputGuard } from '@pellux/goodvibes-terminal-shell';
import { buildCommandArgsHint } from './input/command-args-hint.ts';
import { GOODVIBES_AGENT_PAIRING_SURFACE } from './config/surface.ts';
import { createAutonomySurfacing, buildCalendarEventsLister, buildSkillDraftProposer } from './shell/autonomy-surfacing.ts';
import { bindApprovalsPanel } from './shell/approvals-panel.ts';
import { buildListAutomationRunsSince } from './agent/automation-runs-source.ts';
import { startHardwareProbe } from './core/hardware-profile.ts';
import { readApprovalPostureFromConfig } from './permissions/approval-posture.ts';

// Escape bytes and enter/exit sequencing live in renderer/terminal-escapes.ts (re-exported from @pellux/goodvibes-terminal-shell) so this file never holds its own drifting copy.

async function main() {
  const stdout = process.stdout;
  const stdin = process.stdin;
  installFocusModeExitGuard(stdout); // see shell/terminal-focus-mode.ts
  const { cli, configManager, bootstrapWorkingDir, bootstrapHomeDirectory } = await prepareShellCliRuntime(process.argv.slice(2), {
    defaultWorkingDirectory: process.env['GOODVIBES_WORKING_DIR'] ?? process.cwd(),
    homeDirectory: process.env['GOODVIBES_AGENT_HOME'] ?? homedir(),
  }, 'goodvibes-agent');

  const terminalLaunchError = getInteractiveTerminalLaunchError({
    binary: cli.binary,
    stdinIsTTY: stdin.isTTY,
    stdoutIsTTY: stdout.isTTY,
  });
  if (terminalLaunchError !== null) {
    // Descriptor write, not process.stderr: this is a refusal that exits
    // immediately, and a stream write can still be in flight when the process
    // stops existing. See utils/fatal-boot-write.ts.
    writeFatalLine(terminalLaunchError);
    process.exit(2);
  }

  // Launch-time self-update, before any bootstrap or terminal mode change; on
  // an installed update this restarts onto the swapped binary and never returns.
  const launchUpdateLines = await selfUpdateAtLaunch({ configManager, stdout });
  const reachabilityLines = await reachabilityAtLaunch({ stdout });

  const ctx: BootstrapContext = await bootstrapRuntime(stdout, {
    configManager,
    workingDir: bootstrapWorkingDir,
    homeDirectory: bootstrapHomeDirectory,
  });
  const {
    conversation,
    orchestrator,
    runtime,
    toolRegistry,
    compositor,
    selection,
    commandContext,
    uiServices,
    commandRegistry,
    inputHistory,
    hookDispatcher,
    bootstrapUnsubs,
    agentStatusIntervalRef,
    orchestratorRefs,
    setRenderRequest,
    permissionPromptRef,
    systemMessageRouter,
  } = ctx;
  const workingDir = ctx.services.workingDirectory;
  const homeDirectory = ctx.services.homeDirectory;
  const { approvalBroker, agentManager, modeManager, processManager, providerRegistry, secretsManager, subscriptionManager } = ctx.services;
  conversation.setSessionMemoryStore(ctx.services.sessionMemoryStore);
  conversation.setSessionLineageTracker(ctx.services.sessionLineageTracker);
  orchestrator.setCoreServices({
    configManager,
    providerRegistry,
    favoritesStore: ctx.services.favoritesStore,
    planManager: ctx.services.planManager,
    adaptivePlanner: ctx.services.adaptivePlanner,
    sessionMemoryStore: ctx.services.sessionMemoryStore,
    sessionLineageTracker: ctx.services.sessionLineageTracker,
    idempotencyStore: ctx.services.idempotencyStore,
  });
  let activeConversationWidth = getTerminalSize(stdout).width;
  conversation.setWidthProvider(() => activeConversationWidth);

  // Re-surface pre-bootstrap launch-update lines in-session (the alternate
  // screen wipes the stdout copies written before the renderer existed).
  for (const line of launchUpdateLines) systemMessageRouter.high(`[Update] ${line}`);
  for (const line of reachabilityLines) systemMessageRouter.high(`[Install] ${line}`);
  {
    const hitlMode = configManager.get('behavior.hitlMode') as HITLMode | undefined;
    if (hitlMode && (hitlMode === 'quiet' || hitlMode === 'balanced' || hitlMode === 'operator')) {
      modeManager.setHITLMode(hitlMode);
    }
  }

  const buildSessionContinuityHints = () => buildShellSessionContinuityHints(
    uiServices.readModels.session.getSnapshot(),
    uiServices.readModels.tasks.getSnapshot(),
    uiServices.readModels.remote.getSnapshot(),
  );
  const buildCurrentSessionSnapshot = (): SessionSnapshot => {
    const messages = conversation.getMessageSnapshot();
    const persisted = buildPersistedSessionContext(messages, conversation.getTitleSource(), buildSessionContinuityHints());
    return {
      messages: conversationMessagesAsSessionRecords(messages),
      timestamp: Date.now(),
      title: conversation.title,
      ...persisted,
    };
  };

  let pendingPermission: PendingPermissionState | null = null;
  const approvalsPanel = bindApprovalsPanel({
    broker: approvalBroker,
    approvalsView: ctx.services.approvalsView,
    // Deferred: `render` is declared further down, and the binding only ever
    // calls it from inside the broker subscription.
    render: () => { render(); },
    getPending: () => pendingPermission,
    setPending: (next) => { pendingPermission = next; },
  });

  let streamTokenSpeed = 0;

  const thinkingClock = new ThinkingStallClock(); // thinking-indicator stall clock

  let scrollTop = 0;
  let scrollLocked = true;

  const shellPassthrough = new ShellPassthrough();

  // Ambient autonomy surfacing: away digest at launch + sidebar Coming up.
  const autonomy = createAutonomySurfacing({
    shellPaths: ctx.services.shellPaths,
    listAutomationJobs: () => ctx.services.automationManager.listJobs(),
    listAutomationRunsSince: buildListAutomationRunsSince(configManager, homeDirectory),
    listApprovals: approvalsPanel.listApprovals,
    describeApprovalsUnavailable: approvalsPanel.describeApprovalsUnavailable,
    getTasksSnapshot: () => uiServices.readModels.tasks.getSnapshot().tasks,
    router: {
      high: (message) => systemMessageRouter.high(message),
      getFeed: () => systemMessageRouter.getFeed(),
    },
    render: () => render(),
    listCalendarEvents: buildCalendarEventsLister(ctx.services.shellPaths),
    onAwayDigest: buildSkillDraftProposer(ctx.services.shellPaths, commandContext),
  });

  // Activity sidebar: shows ambient status on wide terminals. null = automatic
  // (visible when the terminal is wide enough); the user can toggle it with
  // Ctrl+O, which pins an explicit on/off override for the session.
  let sidebarOverride: boolean | null = null;
  const sidebarWidthFor = (width: number): number => resolveSidebarWidthWithOverride(width, sidebarOverride);

  const getPromptContentWidth = () => {
    const w = getTerminalSize(stdout).width;
    const boxMargin = 2;
    const boxWidth = w - (boxMargin * 2);
    return boxWidth - 4 - 3; // minus padding (4) minus prefix width (3: ' > ')
  };

  // Live-microphone footer row (the wake detector); assigned once voice capture is wired below, null until then so pre-wiring frames size correctly.
  let voiceCaptureStatus: () => import('./core/voice-capture-status.ts').VoiceCaptureIndicatorState | null = () => null;

  const getViewportHeight = (): number => {
    const { height } = getTerminalSize(stdout);
    if (input.agentWorkspace.active) return height;
    const promptLines: number = input.getVisiblePromptLineCount(getPromptContentWidth());
    const currentModel = providerRegistry.getCurrentModel();
    return height - 2 - estimateShellFooterHeight(promptLines, currentModel.contextWindow, voiceCaptureStatus());
  };

  const scroll = (delta: number) => {
    const vHeight = getViewportHeight();
    const maxScroll = Math.max(0, conversation.history.getLineCount() - vHeight);
    scrollTop = Math.max(0, Math.min(scrollTop + delta, maxScroll));
    // Re-lock if user scrolled to bottom, otherwise unlock
    scrollLocked = scrollTop >= maxScroll;
  };

  const scrollToEnd = (vHeight: number) => {
    scrollTop = Math.max(0, conversation.history.getLineCount() - vHeight);
  };

  const unsubs: Array<() => void> = [];
  let recoveryInterval: ReturnType<typeof setInterval> | null = null;
  let stopSpokenOutputForExit: (() => Promise<void>) | null = null;
  // sessionId of the offered recovery snapshot, or null when none is pending.
  let recoveryPending: string | null = null, pendingWorkspaceRegistration: PendingWorkspaceRegistrationState | null = null;
  // Set by exitApp before the terminal-restore write; render() checks this so no late frame can paint over the screen after the terminal has been handed back.
  let terminalRestored = false;

  const sigintHandler = (): void => input.feed('\x03');
  const unhandledRejectionHandler = createUnhandledRejectionHandler({
    notifyHigh: (message) => systemMessageRouter.high(message),
    render: () => render(),
  });
  const resizeHandler = (): void => {
    input.setContentWidth(getPromptContentWidth());
    compositor.resetDiff();
    render();
  };

  let exiting = false;
  // `handOver` replaces the process AFTER the orderly teardown below and exits
  // with its code — how a periodic self-update restarts onto its new binary.
  const exitApp = (handOver?: () => number): void => {
    // Reentrancy guard: a second /exit or keypress during the bounded
    // spoken-audio drain below must not re-run teardown.
    if (exiting) return;
    exiting = true;
    // Gate render() before anything else so no late frame follows the terminal-restore write below.
    terminalRestored = true;
    // Exit lets the spoken audio the user is already hearing finish inside a
    // short bounded window (capped inside stopForExit) instead of killing the
    // player mid-drain; queued-but-unplayed speech is dropped. Deliberate
    // interrupts (Ctrl+C, /tts stop) still cut instantly via spokenTurns.stop().
    let spokenOutputDrain: Promise<void> = Promise.resolve();
    try {
      spokenOutputDrain = Promise.resolve(stopSpokenOutputForExit?.()).then(() => undefined);
    } catch { /* non-fatal to exit */ }
    unsubs.forEach(fn => fn());
    // Persist last-seen before shutdown so the next launch can compute the digest.
    autonomy.stop();
    const snapshot = buildCurrentSessionSnapshot();
    ctx.shutdown(snapshot).catch((err) => {
      logger.debug('ctx.shutdown error during exitApp (non-fatal)', { error: summarizeError(err) });
    });
    if (recoveryInterval !== null) { clearInterval(recoveryInterval); recoveryInterval = null; }
    // Scoped to this session only — a keyless call would clear every snapshot in the recovery dir.
    removeRecoveryPoint(ctx.services.surface, runtime.sessionId);
    stdin.removeAllListeners('data');
    stdout.removeListener('resize', resizeHandler);
    process.removeListener('SIGINT', sigintHandler);
    process.removeListener('unhandledRejection', unhandledRejectionHandler);
    allowTerminalWrite(() => stdout.write(buildExitSequence(cli.flags.noAltScreen)));
    terminalOutputGuard.dispose();
    stdin.setRawMode(false);
    // The terminal is already restored above; only the process exit waits for
    // the (internally capped, ~2s max) audio drain.
    void spokenOutputDrain.catch(() => undefined).then(() => process.exit(handOver ? handOver() : 0));
  };

  commandContext.exit = exitApp;

  // A long-running agent looks for a newer release too, not only at launch: it
  // installs at an idle moment and restarts in place (runtime/periodic-update.ts).
  unsubs.push(startPeriodicSelfUpdate({
    configManager, services: ctx.services, exit: exitApp,
    notify: (line) => { systemMessageRouter.high(`[Update] ${line}`); render(); },
  }));

  const spokenTurns = wireSpokenTurnRuntime({
    voiceService: ctx.services.voiceService,
    configManager,
    events: uiServices.events,
    notify: (message) => { systemMessageRouter.high(message); render(); },
  });
  // Exit-path stop: bounded drain of the audio already playing (see stopForExit).
  stopSpokenOutputForExit = () => spokenTurns.stopForExit();
  unsubs.push(...spokenTurns.unsubs);
  unsubs.push(attachSpokenTurnModelRouting({
    orchestrator,
    providerRegistry,
    configManager,
    notify: (message) => { systemMessageRouter.high(message); render(); },
  }));
  const submitInput = (text: string, content?: ContentPart[], options: { readonly spokenOutput?: boolean } = {}) => {
    input.clearModalStack();
    scrollLocked = true; // Re-lock on user input
    const AT_MODEL_RE = /@model:([^\s]+)/g;
    let processedText = text;
    let atModelMatch: RegExpExecArray | null;
    while ((atModelMatch = AT_MODEL_RE.exec(text)) !== null) {
      const modelId = atModelMatch[1];
      try {
        providerRegistry.setCurrentModel(modelId);
        const def = providerRegistry.getCurrentModel();
        runtime.model = def.id;
        runtime.provider = def.provider;
        configManager.set('provider.model', def.registryKey);
        systemMessageRouter.high(`[Model] Switched to ${def.displayName} (${def.provider}) via @model:`);
      } catch {
        systemMessageRouter.high(`[Model] Unknown model: ${modelId}`);
      }
      processedText = processedText.replace(atModelMatch[0], '').trim();
    }
    if (processedText.startsWith('!#')) {
      const memoryText = processedText.slice(2).trim();
      if (!memoryText) {
        systemMessageRouter.high('[Memory] Usage: !# <text to pin as conversation-pinned memory>');
        render();
        processedText = '';
      } else {
        const memId = ctx.services.sessionMemoryStore.add(memoryText);
        systemMessageRouter.high(`[Memory] Pinned: "${memoryText}" (${memId})`);
        processedText = memoryText;
      }
    } else if (processedText.startsWith('!')) {
      const command = processedText.slice(1).trim();
      if (!command) {
        systemMessageRouter.high(SHELL_USAGE_HINT);
        render();
        return;
      }
      systemMessageRouter.high(`[Shell] $ ${command}`); render();
      void shellPassthrough.run(command, workingDir)
        .then((result) => systemMessageRouter.high(result.display))
        .catch((shellErr: unknown) => systemMessageRouter.high(`[Shell] Failed to run: ${summarizeError(shellErr)}`))
        .finally(() => render());
      return;
    }
    if (processedText || content) {
      void (async () => {
        const inputOptions = options.spokenOutput ? createSpokenTurnInputOptions() : undefined;
        const outgoing = shellPassthrough.consumeContext(processedText);
        if (options.spokenOutput && processedText) {
          spokenTurns.submitNextTurn(processedText);
        }
        orchestrator.handleUserInput(outgoing, content, inputOptions).catch((err: unknown) => {
          logger.debug('handleUserInput safety catch (already handled by runTurn)', { error: summarizeError(err) });
        });
      })();
    } else {
      render();
    }
  };

  const cancelGeneration = () => {
    spokenTurns.stop('Spoken output stopped.');
    if (orchestrator.isThinking) {
      orchestrator.abort();
    }
  };

  const { jumpToBookmark, scrollToLine } = createTranscriptNavigators({
    conversation,
    getViewportHeight,
    setScrollTop: (line) => { scrollLocked = false; scrollTop = line; },
    render: () => render(),
    notify: (message) => systemMessageRouter.high(message),
  });

  commandContext.submitInput = submitInput;
  commandContext.submitSpokenInput = (text, content) => submitInput(text, content, { spokenOutput: true });
  commandContext.stopSpokenOutput = () => spokenTurns.stop();
  commandContext.pasteFromClipboard = () => input.handlePaste();
  // Composer line prompts: masked for card material, echoed for addresses (see input/handler-line-prompts.ts).
  commandContext.beginConcealedInput = (request) => input.beginConcealedInput(request);
  commandContext.beginPlainInput = (request) => input.beginPlainInput(request);
  commandContext.executeCommand = (name, args) => commandRegistry.execute(name, args, commandContext);
  commandContext.cancelGeneration = cancelGeneration;
  commandContext.jumpToBookmark = jumpToBookmark;
  commandContext.scrollToLine = scrollToLine;
  commandContext.clearScreen = () => {
    compositor.resetDiff();
    allowTerminalWrite(() => stdout.write(CLEAR_VIEWPORT_HOME));
    render();
  };
  commandContext.toggleActivitySidebar = () => {
    const width = getTerminalSize(stdout).width;
    sidebarOverride = !(sidebarWidthFor(width) > 0);
    render();
  };
  const rawRequestPermission: typeof permissionPromptRef.requestPermission = (request) => new Promise((resolve) => { // see shell/terminal-focus-mode.ts
    pendingPermission = { ...request, resolve: (approved: boolean, remember = false) => resolve({ approved, remember }) };
    render();
  });
  permissionPromptRef.requestPermission = wrapRequestPermissionWithApprovalAlert(rawRequestPermission, { focusTracker: ctx.services.focusTracker });

  const input: InputHandler = new InputHandler(
    () => render(),
    selection,
    () => scrollTop,
    getViewportHeight,
    () => conversation.history,
    scroll,
    exitApp,
    {
      providers: {
        benchmarkStore: ctx.services.benchmarkStore,
        favoritesStore: ctx.services.favoritesStore,
        providerRegistry: ctx.services.providerRegistry,
      },
      platform: {
        configManager: ctx.services.configManager,
        localUserAuthManager: ctx.services.localUserAuthManager,
        mcpRegistry: ctx.services.mcpRegistry,
        serviceRegistry: ctx.services.serviceRegistry,
        surfaceRegistry: ctx.services.surfaceRegistry,
        subscriptionManager: ctx.services.subscriptionManager,
        secretsManager: ctx.services.secretsManager,
        tokenAuditor: ctx.services.tokenAuditor,
        replayEngine: ctx.services.replayEngine,
        webhookNotifier: ctx.services.webhookNotifier,
        focusTracker: ctx.services.focusTracker,
        policyRuntimeState: ctx.services.policyRuntimeState,
        externalServices: uiServices.platform.externalServices,
      },
      shell: {
        bookmarkManager: ctx.services.bookmarkManager,
        keybindingsManager: ctx.services.keybindingsManager,
        processManager,
        profileManager: ctx.services.profileManager,
      },
      sessions: {
        sessionManager: ctx.services.sessionManager,
        sessionBroker: ctx.services.automationSessionRegister,
        sessionOrchestration: ctx.services.sessionOrchestration,
        sessionMemoryStore: ctx.services.sessionMemoryStore,
      },
      environment: {
        workingDirectory: ctx.services.workingDirectory,
        homeDirectory: ctx.services.homeDirectory,
        shellPaths: ctx.services.shellPaths,
      },
    },
  );

  orchestratorRefs.getViewportHeight = getViewportHeight;
  orchestratorRefs.scrollToEnd = scrollToEnd;

  input.setCommandRegistry(commandRegistry, commandContext);
  input.setConversationManager(conversation);
  input.setContentWidth(getPromptContentWidth());
  input.filePicker.setOnUpdate(() => render());
  input.processModal.setOnRefresh(() => render());

  // Model picker callback is handled in bootstrap.ts — do not duplicate here.
  input.setHistory(inputHistory);
  // The wake-word capture host: one microphone path, opened only when voice.wake.enabled AND voice.wake.surfaces.agent are both on (shell/voice-capture-shell.ts).
  voiceCaptureStatus = installVoiceCapture({ configManager, voiceService: ctx.services.voiceService, voiceProviders: ctx.services.voiceProviders, shellPaths: ctx.services.shellPaths, sessionId: runtime.sessionId, unsubs, buffer: input, submitInput, notify: (m) => { systemMessageRouter.high(m); render(); }, render: () => render() });

  const toolCount = toolRegistry.list().length;
  conversation.splashOptions = {
    workingDir,
    model: runtime.model,
    provider: runtime.provider,
    toolCount,
  };

  const render = () => {
    // The terminal has already been handed back to the shell; never paint another frame over it.
    if (terminalRestored) return;
    const { width, height } = getTerminalSize(stdout);

    // Fire-and-forget refresh for the 'Coming up' sidebar section.
    autonomy.refreshComingUp();

    if (input.agentWorkspace.active) {
      activeConversationWidth = width;
      conversation.setSplashSuppressed(true);
      if (input.modelPicker.active) {
        compositor.composite(createFullscreenCompositeFromLines(renderModelWorkspace(input.modelPicker, width, height), width, height));
        return;
      }
      if (input.settingsModal.active) {
        compositor.composite(createFullscreenCompositeFromLines(renderSettingsModal(input.settingsModal, width, height), width, height));
        return;
      }
      compositor.composite(createAgentWorkspaceFullscreenComposite(input.agentWorkspace, width, height));
      return;
    }

    // Cache the current model for consistent values across the entire render frame
    const currentModel = providerRegistry.getCurrentModel();
    const sessionSnapshot = uiServices.readModels.session.getSnapshot();
    const agentSnapshot = uiServices.readModels.agents.getSnapshot();
    const activeAgents = agentSnapshot.active;
    const primaryActiveAgent = activeAgents.find((agent) => agent.latestProgress?.trim())
      ?? activeAgents[0];

    const headerLines = UIFactory.createHeader(width, currentModel.id, currentModel.provider, conversation.title || undefined);
    const runningAgentCount = activeAgents.length;
    const runningProcessCount = processManager.list().filter((p) => !p.status.startsWith('done')).length;
    const cw = getPromptContentWidth();
    const promptInfo = input.getWrappedPromptInfo(cw);
    const commandArgsHint = buildCommandArgsHint(input.prompt, commandRegistry);
    const composerState = deriveComposerState({
      text: input.prompt,
      commandMode: input.commandMode,
      pendingApproval: pendingPermission !== null,
      hasAttachments: input.getImageAttachments().size > 0,
      turnState: sessionSnapshot.turnState,
    });
    const footerLines = buildShellFooter({
      width,
      promptText: promptInfo.visibleLines.join('\n'),
      promptLineCount: promptInfo.visibleLines.length,
      promptCursorPos: promptInfo.visibleCursorLine >= 0
        ? promptInfo.visibleLines
          .slice(0, promptInfo.visibleCursorLine)
          .reduce((sum: number, line: string) => sum + line.length + 1, 0) + promptInfo.visibleCursorCol
        : undefined,
      usage: { up: orchestrator.usage.input, down: orchestrator.usage.output },
      showExitNotice: input.showExitNotice,
      lastCopyTime: input.lastCopyTime,
      model: runtime.model,
      toolCount: toolRegistry.list().length,
      workingDir,
      provider: runtime.provider,
      contextWindow: currentModel.contextWindow,
      compactThreshold: configManager.get('behavior.autoCompactThreshold') as number,
      // Single source of truth for "will this bypass the approval prompt?" — computed
      // the same way cli/status.ts and the policy-explain tool compute it (behavior.autoApprove
      // first, then permissions.mode), so the footer can never disagree with them.
      dangerMode: readApprovalPostureFromConfig(configManager).bypassesPrompts,
      powerNote: describePowerStatus(ctx.services.powerManager.getState()) ?? undefined, // see power-status.ts
      lastInputTokens: orchestrator.lastInputTokens,
      commandArgsHint,
      hitlMode: modeManager.getHITLMode(),
      runningAgentCount,
      runningProcessCount,
      indicatorFocused: input.indicatorFocused,
      runningAgentProgress: primaryActiveAgent
        ? `${primaryActiveAgent.label}: ${primaryActiveAgent.latestProgress?.trim() || primaryActiveAgent.status}`
        : undefined,
      composerMode: composerState.modeLabel,
      composerStatus: composerState.statusLabel,
      composerFlags: composerState.flags,
      composerPendingRisk: composerState.pendingRisk,
      voiceCapture: voiceCaptureStatus(),
    }).lines;

    const shellHeaderLines = headerLines;
    const shellFooterLines = footerLines;
    const sidebarWidth = sidebarWidthFor(width);
    const shellLayout = createShellLayout({
      width,
      height,
      headerHeight: shellHeaderLines.length,
      footerHeight: shellFooterLines.length,
      panelWidth: sidebarWidth,
    });
    const vHeight = shellLayout.body.height;
    const conversationWidth = shellLayout.conversation.width;
    activeConversationWidth = conversationWidth;
    conversation.setSplashSuppressed(false);

    // Flush pending renders after updating the width provider and splash posture
    // so the transcript and splash rebuild against the current shell layout.
    conversation.getDisplayBlocks();

    // Calculate how many rows are consumed by overlays (thinking, permissions, queue, file picker)
    let overlayRows = 0;
    if (orchestrator.isThinking) overlayRows += 2; // spinner + blank
    if (pendingPermission) overlayRows += PermissionPromptUI.getPromptHeight(pendingPermission);
    overlayRows += orchestrator.messageQueue.length * 3; // queued messages
    // File picker and model picker overlay rows computed from actual rendered line count below
    // Selection modal overlay rows are computed from actual rendered line count below
    if (input.searchManager.active) {
      overlayRows += 1;
    }

    const conversationViewport = buildConversationViewport({
      conversation,
      width: conversationWidth,
      viewportHeight: vHeight,
      scrollTop,
      scrollLocked,
      overlayRows,
    });
    scrollTop = conversationViewport.nextScrollTop;
    let viewport = conversationViewport.viewport;

    viewport.push(...buildThinkingOverlay({ // honest waiting state; [] when not thinking
      orchestrator, configManager, streamTokenSpeed, clock: thinkingClock,
      streamToolPreview: sessionSnapshot.streamToolPreview,
      approvalPending: pendingPermission !== null, width: conversationWidth,
    }));

    if (pendingPermission) {
      viewport.push(...PermissionPromptUI.createPromptLines(conversationWidth, pendingPermission));
    }

    orchestrator.messageQueue.forEach(msg => {
      viewport.push(...UIFactory.createQueuedMessageFragment(conversationWidth, msg.text));
    });

    viewport = applyConversationOverlays(viewport, {
      input,
      conversation,
      commandRegistry,
      keybindingsManager: ctx.services.keybindingsManager,
      conversationWidth,
      viewportHeight: vHeight,
      contextWindow: currentModel.contextWindow,
    });

    // Activity sidebar (ambient status on wide terminals). Agent rows carry
    // the fleet read-model's headline and stall tell (see activity-sidebar.ts).
    const sidebar = sidebarWidth > 0
      ? {
          lines: buildActivitySidebarLines({
            now: {
              busy: orchestrator.isThinking,
              label: sessionSnapshot.streamToolPreview?.trim() || undefined,
              agents: buildSidebarAgentRows(activeAgents, ctx.services.fleetUnion.nodes()),
              processes: runningProcessCount,
            },
            needsYou: pendingPermission
              ? ['Approval needed — answer the prompt under the conversation.']
              : [],
            comingUp: [...autonomy.comingUpItems()],
            recent: systemMessageRouter.getFeed()?.latest(Math.max(4, vHeight - 8)) ?? [],
          }, sidebarWidth, vHeight),
        }
      : undefined;

    compositor.composite({
      width, height,
      header: shellHeaderLines,
      viewport,
      footer: shellFooterLines,
      selection: {
        isCellSelected: (col, row) => selection.isCellSelected(col, row),
        scrollTop,
        lineCount: conversation.history.getLineCount(),
      },
      search: input.searchManager.active ? {
        manager: input.searchManager,
        scrollTop,
        viewportStartY: shellHeaderLines.length,
      } : undefined,
      sidebar,
      sidebarWidth,
    });
  };
  const terminalOutputGuard = installFullScreenTerminalOutputGuard({ stdout, stderr: process.stderr, notify: (message) => { systemMessageRouter.low(message); render(); } });

  setRenderRequest(render);
  orchestratorRefs.requestRender = render;
  commandContext.renderRequest = render;
  wireShellUiOpeners({
    commandContext,
    input,
    conversation,
    configManager,
    providerRegistry,
    runtime,
    featureFlags: ctx.featureFlags,
    mcpRegistry: ctx.services.mcpRegistry,
    subscriptionManager,
    secretsManager,
    serviceRegistry: ctx.services.serviceRegistry,
    workingDirectory: workingDir,
    homeDirectory,
    getConfiguredProviderIds: ctx._getConfiguredProviderIds,
    getPinned: ctx._getPinned,
    render,
  });

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  allowTerminalWrite(() => { markFocusModeEnabled(); return stdout.write(buildEnterSequence(cli.flags.noAltScreen)); });

  // Forced dark/light before first paint; auto (TTY) probes + repaints once if light.
  const themeProbe = installStartupThemeProbe({
    configManager, stdout, writeAllowed: allowTerminalWrite,
    resetDiff: () => compositor.resetDiff(), render,
  });

  applyInitialTuiCliState({
    cli,
    input,
    commandRegistry,
    commandContext,
    shellPaths: ctx.services.shellPaths,
    surface: ctx.services.surface,
    render,
  });

  stdin.on('data', (raw: string) => {
    // Strip any OSC 11 background-probe reply before the input pipeline sees it.
    const data = themeProbe.filterInput(raw);
    if (data.length === 0) return;
    const blocking = handleBlockingShellInput({
      data,
      pendingPermission,
      recoveryPending,
      pendingWorkspaceRegistration,
      abortTurn: () => orchestrator.abort(),
      conversation,
      systemMessageRouter,
      render,
      // Keyed to the OFFERED snapshot's sessionId (recoveryPending) so a
      // second, unrelated recovery snapshot on disk is never touched.
      consumeRecovery: () => consumeRecovery(ctx.services.surface, recoveryPending ?? undefined).snapshot,
      removeRecoveryPoint: () => { removeRecoveryPoint(ctx.services.surface, recoveryPending ?? undefined); },
    });
    ({ pendingPermission, recoveryPending, pendingWorkspaceRegistration } = blocking);
    if (blocking.handled) {
      return;
    }

    input.feed(data);
  });
  process.on('SIGINT', sigintHandler);
  process.on('unhandledRejection', unhandledRejectionHandler);
  stdout.on('resize', resizeHandler);

  conversation.rebuildHistory();
  render();

  ({ recoveryInterval, recoveryPending, pendingWorkspaceRegistration } = startFirstRenderFollowups({
    shellPaths: ctx.services.shellPaths,
    providerRegistry,
    commandContext,
    autonomy,
    buildCurrentSessionSnapshot,
    runtime,
    conversation,
    workingDir,
    homeDirectory,
    surface: ctx.services.surface,
    systemMessageRouter,
    render,
    unsubs,
    uiServicesTurns: uiServices.events.turns,
    hookDispatcher,
    onStreamSpeedUpdate: (speed) => { streamTokenSpeed = speed; },
  }));
}
main().catch((err: unknown) => {
  reportFatalStartupError(err, {
    binary: 'goodvibes-agent',
    debug: process.env['GOODVIBES_AGENT_DEBUG'] === '1',
  }, {
    logError: (message, context) => logger.error(message, context),
    // NOT process.stderr.write: installFullScreenTerminalOutputGuard above
    // replaces it, so a failure raised after that install had its explanation
    // intercepted and swallowed — measured on a compiled binary as exit 1 with
    // zero bytes on both streams. A descriptor write cannot be intercepted.
    writeStderr: writeFatalLine,
    exit: (code) => process.exit(code),
  });
});