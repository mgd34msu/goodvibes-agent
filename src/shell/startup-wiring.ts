import { logger, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import type { HookDispatcher, HookEventPath, HookPhase, HookCategory } from '@pellux/goodvibes-sdk/platform/hooks';
import type { SessionManager } from '@pellux/goodvibes-sdk/platform/sessions';
import {
  checkRecoveryFile,
  createShellPathService,
  formatReturnContextForDisplay,
  persistConversation,
  writeRecoveryFile,
} from '@/runtime/index.ts';
import type { SessionSnapshot } from '@/runtime/index.ts';
import {
  readOnboardingCheckMarker,
  readOnboardingCompletionMarker,
} from '../runtime/onboarding/index.ts';
import { deriveOnboardingState } from '../runtime/onboarding/onboarding-state.ts';
import { buildSetupIncompleteHint } from '../core/setup-incomplete-hint.ts';
import { isBroadWorkspaceRoot, normalizeWorkspaceRoot, resolveWorkspaceRegistrationSync } from '../config/workspace-registration.ts';
import type { PendingWorkspaceRegistrationState } from './blocking-input.ts';

export interface SessionPersistenceAndRecoveryDeps {
  readonly buildCurrentSessionSnapshot: () => SessionSnapshot;
  readonly runtime: { readonly sessionId: string; readonly model: string; readonly provider: string };
  readonly conversation: { readonly title?: string | null };
  readonly workingDir: string;
  readonly homeDirectory: string;
  readonly systemMessageRouter: { high(message: string): void; low(message: string): void };
  readonly render: () => void;
  readonly unsubs: Array<() => void>;
  readonly uiServicesTurns: {
    on(event: 'TURN_COMPLETED' | 'STREAM_START' | 'STREAM_DELTA', handler: () => void): () => void;
  };
  readonly hookDispatcher: HookDispatcher;
  readonly sessionManager: SessionManager;
  /**
   * Called whenever the computed stream-token speed changes so that main.ts
   * (which owns the render closure) can keep the value up to date.
   */
  readonly onStreamSpeedUpdate: (tokensPerSecond: number) => void;
}

export interface SessionPersistenceAndRecoveryResult {
  /** Interval handle for the periodic recovery-file writer; clear it on exit. */
  recoveryInterval: ReturnType<typeof setInterval>;
  /** True if an unsaved recovery session was found and the user prompt was shown. */
  recoveryPending: boolean;
  /** Set when the first-start registration prompt was shown this launch (see below). */
  pendingWorkspaceRegistration: PendingWorkspaceRegistrationState | null;
}

/**
 * Wires streaming-speed event subscriptions, auto-save on turn completion,
 * and the post-first-render recovery-file check + periodic writer.
 *
 * Call AFTER the first render() so that:
 * - announceAwayDigest has already run
 * - startHardwareProbe has already fired
 * - The recovery prompt lands as ambient context, not a startup blocker
 */
export function wireSessionPersistenceAndRecovery(
  deps: SessionPersistenceAndRecoveryDeps,
): SessionPersistenceAndRecoveryResult {
  const {
    buildCurrentSessionSnapshot,
    runtime,
    conversation,
    workingDir,
    homeDirectory,
    systemMessageRouter,
    render,
    unsubs,
    uiServicesTurns,
    hookDispatcher,
    sessionManager,
    onStreamSpeedUpdate,
  } = deps;
  const shellPaths = createShellPathService({ workingDirectory: workingDir, homeDirectory });

  // --- Streaming speed + tool preview wiring ---
  let streamStartTime = 0;
  let streamDeltaCount = 0;

  unsubs.push(uiServicesTurns.on('TURN_COMPLETED', () => {
    // Auto-save after every LLM turn so kills don't lose the session
    try {
      const snapshot = buildCurrentSessionSnapshot();
      persistConversation(
        runtime.sessionId,
        snapshot,
        runtime.model,
        runtime.provider,
        conversation.title || '',
        { workingDirectory: workingDir, homeDirectory, sessionManager },
      );
      hookDispatcher.fire({ path: 'Lifecycle:session:save' as HookEventPath, phase: 'Lifecycle' as HookPhase, category: 'session' as HookCategory, specific: 'save', sessionId: runtime.sessionId, timestamp: Date.now(), payload: { sessionId: runtime.sessionId } }).catch((err: unknown) => logger.debug('hook fire error', { error: summarizeError(err) }));
    } catch (e) { logger.debug('auto-save on turn:complete failed', { error: summarizeError(e) }); }
  }));

  unsubs.push(uiServicesTurns.on('STREAM_START', () => {
    streamStartTime = Date.now();
    streamDeltaCount = 0;
    onStreamSpeedUpdate(0);
  }));
  unsubs.push(uiServicesTurns.on('STREAM_DELTA', () => {
    streamDeltaCount++;
    const elapsed = (Date.now() - streamStartTime) / 1000;
    // Note: counts stream deltas, not actual tokens. ~1 delta per token for most providers.
    onStreamSpeedUpdate(elapsed > 0 ? streamDeltaCount / elapsed : 0);
  }));

  // Recovery file check: display prompt if an unsaved session exists.
  // Runs after the first render so the message lands as ambient context.
  let recoveryPending = false;
  const recoveryInfo = checkRecoveryFile({ workingDirectory: workingDir, homeDirectory });
  if (recoveryInfo) {
    systemMessageRouter.high(`[Recovery] Found unsaved session from ${new Date(recoveryInfo.timestamp).toLocaleString()}. Title: "${recoveryInfo.title}". Press Ctrl+R to restore, Esc to discard, or start typing to ignore it.`);
    for (const line of formatReturnContextForDisplay(recoveryInfo.returnContext)) {
      systemMessageRouter.low(`[Recovery] ${line}`);
    }
    render();
    recoveryPending = true;
  }

  const recoveryInterval = setInterval(() => {
    const snapshot = buildCurrentSessionSnapshot();
    writeRecoveryFile(
      snapshot,
      runtime.sessionId,
      conversation.title ?? '',
      { workingDirectory: workingDir, homeDirectory },
    );
  }, 60_000);

  // First-start registration prompt (owner-approved design): only when this
  // directory resolves to unknown (not covered, not declined) AND it isn't a
  // broad root the store would refuse anyway (see isBroadWorkspaceRoot's own
  // doc comment on why an "offer" check is safe to keep separate from the
  // store's authoritative write-time guard). Skipped when a recovery prompt
  // already claimed this launch's ambient attention, and while onboarding is
  // still incomplete — the full-screen onboarding wizard would otherwise
  // compete with this prompt for the very next keypress the owner types.
  let pendingWorkspaceRegistration: PendingWorkspaceRegistrationState | null = null;
  const onboardingDone = Boolean(readOnboardingCompletionMarker(shellPaths, 'user').payload);
  if (!recoveryPending && onboardingDone) {
    const resolution = resolveWorkspaceRegistrationSync(shellPaths, workingDir);
    if (resolution.status === 'unknown' && !isBroadWorkspaceRoot(shellPaths, workingDir)) {
      systemMessageRouter.high(`[Workspace] "${workingDir}" is not a registered workspace, so automatic (turn-end) checkpoints are off here. Register it? Press "y" to register, any other key to decline (won't ask again for this location).`);
      render();
      pendingWorkspaceRegistration = { root: normalizeWorkspaceRoot(workingDir), shellPaths };
    }
  }

  return { recoveryInterval, recoveryPending, pendingWorkspaceRegistration };
}

/**
 * Deps for the setup-incomplete hint, kept narrow so the function is easily
 * testable and doesn't pull in the full bootstrap context.
 */
export interface SetupIncompleteHintDeps {
  /**
   * Shell path service — used to locate onboarding marker files.
   * Must satisfy the minimal interface required by readOnboardingCheckMarker.
   */
  readonly shellPaths: Parameters<typeof readOnboardingCheckMarker>[0];
  /**
   * Whether a model route is currently configured and usable for chat.
   * Pass true when the provider registry has a ready model, false otherwise.
   */
  readonly providerReady: boolean;
  /**
   * Whether a local model route has been detected and is ready for chat.
   * Pass true when the local-model-cookbook status === 'detected-local-route'.
   * Omit or pass false when unavailable. Best-effort: errors should produce false.
   * This mirrors the 'local-model-readiness' plan item in the real buildSetupPlan.
   */
  readonly localReady?: boolean;
  /**
   * Whether the assistant service (connected host) is known to be running.
   * Pass true/false for a confirmed live signal; omit or pass null/undefined
   * when the signal is unreliable or unavailable at startup time.
   */
  readonly hostReady?: boolean | null;
  /** Low-priority message channel — same interface as SystemMessageRouter.low(). */
  readonly systemMessageRouter: { low(message: string): void };
}

/**
 * Derives the current onboarding state from disk markers and, if setup is
 * in-progress, pushes a plain-language hint to the conversation feed.
 *
 * Best-effort: any error is caught silently so startup is never blocked.
 * Call after the first render, alongside announceAwayDigest.
 */
export function wireSetupIncompleteHint(deps: SetupIncompleteHintDeps): void {
  try {
    const { shellPaths, providerReady, localReady, hostReady, systemMessageRouter } = deps;

    const checkMarker = readOnboardingCheckMarker(shellPaths, 'user');
    const completionMarker = readOnboardingCompletionMarker(shellPaths, 'user');

    // Build a minimal plan with BOTH provider-access AND local-model-readiness so
    // that deriveReadyToChat mirrors the workspace's canonical definition:
    //   readyToChat = providerItem.ready OR localModelItem.ready
    //
    // local-model-readiness uses blocksAutonomy:false so it never becomes a false
    // blocker when only the local route is available (matching real plan behaviour).
    // We intentionally skip the full buildSetupPlan (requires CommandContext +
    // async collectSnapshot) because this is a best-effort ambient hint.
    const minimalPlan = [
      {
        id: 'provider-access',
        label: 'Model access',
        status: providerReady ? ('ready' as const) : ('blocked' as const),
        priority: 20,
        blocksAutonomy: true,
        reason: '',
        nextAction: 'Choose a model to start chatting.',
        userRoute: 'Agent Workspace -> Start -> Choose main model',
        modelRoute: '',
      },
      {
        id: 'local-model-readiness',
        label: 'Local model',
        status: localReady ? ('ready' as const) : ('recommended' as const),
        priority: 25,
        blocksAutonomy: false,
        reason: '',
        nextAction: 'Run /agent to set up a local model route.',
        userRoute: 'Agent Workspace -> Models -> Local models',
        modelRoute: '',
      },
    ];

    const state = deriveOnboardingState({ plan: minimalPlan, checkMarker, completionMarker });

    const hint = buildSetupIncompleteHint(state, hostReady);
    if (hint === null) return;

    for (const line of hint.lines) {
      systemMessageRouter.low(`[Setup] ${line}`);
    }
  } catch {
    // Never block startup on hint errors.
  }
}
