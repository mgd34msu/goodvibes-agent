import { logger, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import type { HookDispatcher, HookEventPath, HookPhase, HookCategory } from '@pellux/goodvibes-sdk/platform/hooks';
import type { SessionManager } from '@pellux/goodvibes-sdk/platform/sessions';
import {
  checkRecoveryFile,
  formatReturnContextForDisplay,
  persistConversation,
  writeRecoveryFile,
} from '@/runtime/index.ts';
import type { SessionSnapshot } from '@/runtime/index.ts';

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

  return { recoveryInterval, recoveryPending };
}
