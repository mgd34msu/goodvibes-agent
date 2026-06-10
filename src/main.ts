#!/usr/bin/env bun
import { homedir } from 'node:os';
import { Compositor } from './renderer/compositor.ts';
import { UIFactory } from './renderer/ui-factory.ts';
import { Orchestrator } from './core/orchestrator';
import { conversationMessagesAsSessionRecords } from './core/conversation-message-snapshot.ts';
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
import { getTierPromptSupplement, getTierForContextWindow } from '@pellux/goodvibes-sdk/platform/providers';
import { createShellLayout } from './renderer/layout-engine.ts';
import { buildShellFooter, estimateShellFooterHeight } from './renderer/shell-surface.ts';
import { buildConversationViewport } from './renderer/conversation-layout.ts';
import { applyConversationOverlays } from './renderer/conversation-overlays.ts';
import { buildActivitySidebarLines, resolveActivitySidebarWidth } from './renderer/activity-sidebar.ts';
import { logger } from '@pellux/goodvibes-sdk/platform/utils';
import { bootstrapRuntime } from './runtime/bootstrap.ts';
import type { BootstrapContext } from './runtime/bootstrap.ts';
import type { HITLMode } from '@pellux/goodvibes-sdk/platform/state';
import { wireSessionPersistenceAndRecovery } from './shell/startup-wiring.ts';
import {
  deleteRecoveryFile,
  loadRecoveryConversation,
} from '@/runtime/index.ts';
import type { SessionSnapshot } from '@/runtime/index.ts';
import { handleBlockingShellInput, type PendingPermissionState } from './shell/blocking-input.ts';
import { createAgentWorkspaceFullscreenComposite, createFullscreenCompositeFromLines } from './shell/agent-workspace-fullscreen.ts';
import { getTerminalSize } from './shell/terminal-size.ts';
import { buildShellSessionContinuityHints } from './shell/session-continuity-hints.ts';
import { wireShellUiOpeners } from './shell/ui-openers.ts';
import { deriveComposerState } from './core/composer-state.ts';
import { buildPersistedSessionContext } from '@/runtime/index.ts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { prepareShellCliRuntime } from './cli/entrypoint.ts';
import { applyInitialTuiCliState, formatFatalStartupErrorForLog, formatFatalStartupErrorForUser, getInteractiveTerminalLaunchError } from './cli/tui-startup.ts';
import { wireSpokenTurnRuntime } from './audio/spoken-turn-wiring.ts';
import { attachSpokenTurnModelRouting, createSpokenTurnInputOptions } from './audio/spoken-turn-model-routing.ts';
import { allowTerminalWrite, installTuiTerminalOutputGuard } from './runtime/terminal-output-guard.ts';
import { buildCommandArgsHint } from './input/command-args-hint.ts';
import { GOODVIBES_AGENT_PAIRING_SURFACE } from './config/surface.ts';
import { createAutonomySurfacing, buildCalendarEventsLister, buildSkillDraftProposer } from './shell/autonomy-surfacing.ts';
import { startHardwareProbe } from './core/hardware-profile.ts';

const ALT_SCREEN_ENTER = '\x1b[?1049h', ALT_SCREEN_EXIT = '\x1b[?1049l', MOUSE_ENABLE = '\x1b[?1000h\x1b[?1002h\x1b[?1006h', MOUSE_DISABLE = '\x1b[?1006l\x1b[?1002l\x1b[?1000l', CURSOR_HIDE = '\x1b[?25l', CURSOR_SHOW = '\x1b[?25h', CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H';
const KEYBOARD_EXT_ENABLE = '\x1b[>4;2m' + '\x1b[?1u', KEYBOARD_EXT_DISABLE = '\x1b[>4;0m' + '\x1b[?1l', PASTE_ENABLE = '\x1b[?2004h', PASTE_DISABLE = '\x1b[?2004l';

async function main() {
  const stdout = process.stdout;
  const stdin = process.stdin;
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
    process.stderr.write(`${terminalLaunchError}\n`);
    process.exit(2);
  }

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
    _writeLastSessionPointer: writeLastSessionPointer,
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
  approvalBroker.subscribe((approval) => {
    if (!pendingPermission) return;
    if (pendingPermission.callId !== approval.callId) return;
    if (approval.status === 'pending' || approval.status === 'claimed') return;
    pendingPermission = null;
    render();
  });

  let streamTokenSpeed = 0;

  let scrollTop = 0;
  let scrollLocked = true;

  // Ambient autonomy surfacing: away digest at launch + sidebar Coming up.
  const autonomy = createAutonomySurfacing({
    shellPaths: ctx.services.shellPaths,
    listAutomationJobs: () => ctx.services.automationManager.listJobs(),
    listApprovals: () => ctx.services.approvalBroker.listApprovals(),
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
  const sidebarWidthFor = (width: number): number => {
    const auto = resolveActivitySidebarWidth(width);
    if (sidebarOverride === null) return auto;
    if (!sidebarOverride) return 0;
    return auto > 0 ? auto : Math.min(36, Math.max(28, Math.floor(width * 0.3)));
  };

  const getPromptContentWidth = () => {
    const w = getTerminalSize(stdout).width;
    const boxMargin = 2;
    const boxWidth = w - (boxMargin * 2);
    return boxWidth - 4 - 3; // minus padding (4) minus prefix width (3: ' > ')
  };

  const getViewportHeight = (): number => {
    const { height } = getTerminalSize(stdout);
    if (input.agentWorkspace.active) return height;
    const promptLines: number = input.getVisiblePromptLineCount(getPromptContentWidth());
    const currentModel = providerRegistry.getCurrentModel();
    return height - 2 - estimateShellFooterHeight(promptLines, currentModel.contextWindow);
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
  let stopSpokenOutputForExit: (() => void) | null = null;
  let recoveryPending = false;

  const sigintHandler = (): void => input.feed('\x03');
  let _unhandledRejectionCount = 0;
  let _unhandledRejectionWindowStart = Date.now();
  const unhandledRejectionHandler = (reason: unknown): void => {
    const now = Date.now();
    if (now - _unhandledRejectionWindowStart > 10000) {
      _unhandledRejectionCount = 0;
      _unhandledRejectionWindowStart = now;
    }
    _unhandledRejectionCount++;
    const msg = reason instanceof Error ? reason.message : String(reason);
    if (_unhandledRejectionCount > 3) {
      logger.error('CRITICAL: cascading unhandled rejections — consider restarting', {
        count: _unhandledRejectionCount,
        windowMs: now - _unhandledRejectionWindowStart,
        error: String(reason),
      });
      systemMessageRouter.high(
        `[Critical] Multiple errors detected (${_unhandledRejectionCount} in 10s). If the issue persists, please restart. Latest: ${msg}`
      );
    } else {
      systemMessageRouter.high(`[Error] ${msg}`);
      logger.error('unhandledRejection', { error: String(reason) });
    }
    render();
  };
  const resizeHandler = (): void => {
    input.setContentWidth(getPromptContentWidth());
    compositor.resetDiff();
    render();
  };

  const exitApp = (): void => {
    stopSpokenOutputForExit?.();
    unsubs.forEach(fn => fn());
    // Persist last-seen before shutdown so the next launch can compute the digest.
    autonomy.stop();
    const snapshot = buildCurrentSessionSnapshot();
    ctx.shutdown(snapshot).catch((err) => {
      logger.debug('ctx.shutdown error during exitApp (non-fatal)', { error: summarizeError(err) });
    });
    if (recoveryInterval !== null) { clearInterval(recoveryInterval); recoveryInterval = null; }
    deleteRecoveryFile({ homeDirectory });
    stdin.removeAllListeners('data');
    stdout.removeListener('resize', resizeHandler);
    process.removeListener('SIGINT', sigintHandler);
    process.removeListener('unhandledRejection', unhandledRejectionHandler);
    const exitScreen = cli.flags.noAltScreen ? CLEAR_SCREEN : CLEAR_SCREEN + ALT_SCREEN_EXIT;
    allowTerminalWrite(() => stdout.write(PASTE_DISABLE + KEYBOARD_EXT_DISABLE + MOUSE_DISABLE + CURSOR_SHOW + exitScreen));
    terminalOutputGuard.dispose();
    stdin.setRawMode(false);
    process.exit(0);
  };

  commandContext.exit = exitApp;

  const spokenTurns = wireSpokenTurnRuntime({
    voiceService: ctx.services.voiceService,
    configManager,
    events: uiServices.events,
    notify: (message) => { systemMessageRouter.high(message); render(); },
  });
  stopSpokenOutputForExit = () => spokenTurns.stop();
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
    }
    if (processedText || content) {
      void (async () => {
        const inputOptions = options.spokenOutput ? createSpokenTurnInputOptions() : undefined;
        if (options.spokenOutput && processedText) {
          spokenTurns.submitNextTurn(processedText);
        }
        orchestrator.handleUserInput(processedText, content, inputOptions).catch((err: unknown) => {
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

  const jumpToBookmark = (key: string) => {
    conversation.getDisplayBlocks();
    const block = conversation.getBlockRegistry().find((entry) => entry.collapseKey === key);
    if (!block) {
      systemMessageRouter.high(`[Bookmark] Not found: ${key}`);
      render();
      return;
    }
    scrollLocked = false;
    scrollTop = Math.max(0, block.startLine);
    render();
  };

  const scrollToLine = (line: number) => {
    conversation.getDisplayBlocks();
    const maxScroll = Math.max(0, conversation.history.getLineCount() - getViewportHeight());
    scrollLocked = false;
    scrollTop = Math.max(0, Math.min(line, maxScroll));
    render();
  };

  commandContext.submitInput = submitInput;
  commandContext.submitSpokenInput = (text, content) => submitInput(text, content, { spokenOutput: true });
  commandContext.stopSpokenOutput = () => spokenTurns.stop();
  commandContext.pasteFromClipboard = () => input.handlePaste();
  commandContext.executeCommand = (name, args) => commandRegistry.execute(name, args, commandContext);
  commandContext.cancelGeneration = cancelGeneration;
  commandContext.jumpToBookmark = jumpToBookmark;
  commandContext.scrollToLine = scrollToLine;
  commandContext.clearScreen = () => {
    compositor.resetDiff();
    allowTerminalWrite(() => stdout.write(CLEAR_SCREEN));
    render();
  };
  commandContext.toggleActivitySidebar = () => {
    const width = getTerminalSize(stdout).width;
    sidebarOverride = !(sidebarWidthFor(width) > 0);
    render();
  };
  permissionPromptRef.requestPermission = (request) =>
    new Promise((resolve) => {
      pendingPermission = {
        ...request,
        resolve: (approved: boolean, remember = false) => resolve({ approved, remember }),
      };
      render();
    });

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
        sessionBroker: ctx.services.sessionBroker,
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

  const toolCount = toolRegistry.list().length;
  conversation.splashOptions = {
    workingDir,
    model: runtime.model,
    provider: runtime.provider,
    toolCount,
  };

  const render = () => {
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
      dangerMode: (() => {
        if (configManager.get('behavior.autoApprove')) return true;
        const permMode = configManager.get('permissions.mode');
        if (permMode === 'allow-all') return true;
        if (permMode === 'custom') {
          const tools = configManager.getCategory('permissions').tools;
          if (Object.values(tools).every(v => v === 'allow')) return true;
        }
        return false;
      })(),
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

    if (orchestrator.isThinking) {
      const showSpeed = configManager.get('display.showTokenSpeed') as boolean;
      const showPreview = configManager.get('display.showToolPreview') as boolean;
      const partialToolPreview = showPreview ? sessionSnapshot.streamToolPreview : undefined;
      const thinking = UIFactory.createThinkingFragment(
        conversationWidth,
        orchestrator.getSpinner(),
        orchestrator.thinkingFrame,
        showSpeed ? streamTokenSpeed : undefined,
        showPreview ? partialToolPreview : undefined,
        orchestrator.streamingInputTokens > 0 ? orchestrator.streamingInputTokens : undefined,
        orchestrator.streamingOutputTokens > 0 ? orchestrator.streamingOutputTokens : undefined,
      );
      viewport.push(...thinking);
    }

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

    // Activity sidebar (ambient status on wide terminals)
    const sidebar = sidebarWidth > 0
      ? {
          lines: buildActivitySidebarLines({
            now: {
              busy: orchestrator.isThinking,
              label: sessionSnapshot.streamToolPreview?.trim() || undefined,
              agents: activeAgents.slice(0, 3).map((agent) => ({
                label: agent.label,
                progress: agent.latestProgress?.trim() || undefined,
              })),
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
  const terminalOutputGuard = installTuiTerminalOutputGuard({ stdout, stderr: process.stderr, notify: (message) => { systemMessageRouter.low(message); render(); } });

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
  allowTerminalWrite(() => stdout.write((cli.flags.noAltScreen ? '' : ALT_SCREEN_ENTER) + CLEAR_SCREEN + CURSOR_HIDE + MOUSE_ENABLE + KEYBOARD_EXT_ENABLE + PASTE_ENABLE));

  applyInitialTuiCliState({
    cli,
    input,
    commandRegistry,
    commandContext,
    shellPaths: ctx.services.shellPaths,
    render,
  });

  stdin.on('data', (data: string) => {
    const blocking = handleBlockingShellInput({
      data,
      pendingPermission,
      recoveryPending,
      abortTurn: () => orchestrator.abort(),
      conversation,
      systemMessageRouter,
      render,
      loadRecoveryConversation: () => loadRecoveryConversation({ homeDirectory }),
      deleteRecoveryFile: () => deleteRecoveryFile({ homeDirectory }),
    });
    pendingPermission = blocking.pendingPermission;
    recoveryPending = blocking.recoveryPending;
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

  // Async GPU probe runs off the render frame — nvidia-smi result will populate
  // the module cache and appear on the next render cycle after it completes.
  startHardwareProbe();

  // Away digest runs after the first render so it lands as ambient context,
  // never a startup blocker.
  autonomy.announceAwayDigest();

  // Wire streaming-speed metrics, auto-save, and recovery — all run after the
  // first render so they land as ambient context, never startup blockers.
  ({ recoveryInterval, recoveryPending } = wireSessionPersistenceAndRecovery({
    buildCurrentSessionSnapshot,
    runtime,
    conversation,
    workingDir,
    homeDirectory,
    systemMessageRouter,
    render,
    unsubs,
    uiServicesTurns: uiServices.events.turns,
    hookDispatcher,
    sessionManager: ctx.services.sessionManager,
    onStreamSpeedUpdate: (speed) => { streamTokenSpeed = speed; },
  }));
}
main().catch((err: unknown) => {
  const detail = formatFatalStartupErrorForLog(err);
  try {
    logger.error('Fatal error', { error: detail });
  } catch {
    // Startup diagnostics must never hide the original launch failure.
  }
  const userDetail = formatFatalStartupErrorForUser(err, {
    binary: 'goodvibes-agent',
    debug: process.env['GOODVIBES_AGENT_DEBUG'] === '1',
  });
  try {
    process.stderr.write(`goodvibes-agent failed to launch:\n${userDetail}\n`);
  } catch {
    // Ignore secondary stderr failures during process teardown.
  }
  process.exit(1);
});