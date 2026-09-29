/**
 * thinking-overlay.ts, the running turn's busy state for the status line and
 * its honest stall clock, extracted from main.ts's render loop.
 *
 * The SDK orchestrator surfaces no lastDeltaAtMs / reconnect signal directly, so
 * ThinkingStallClock derives a per-turn last-delta clock from streaming
 * output-token advances, a real, honest proxy that degrades gracefully with
 * zero new SDK events. buildBusyState turns that into the status line's busy
 * state (spinner, the honest waiting phrase from the SDK presentation
 * contract, elapsed time); buildThinkingOverlay keeps only the opt-in partial
 * tool preview as a faint row under the transcript.
 */

import { UIFactory, type ThinkingStallInfo } from '../renderer/ui-factory.ts';
import type { StatusBusyState } from '../renderer/status-line.ts';
import type { Line } from '@pellux/goodvibes-sdk/platform/types';
import type { Orchestrator } from '@pellux/goodvibes-sdk/platform/core';
import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';

/**
 * Per-turn last-delta clock. tick() seeds at turn start, then pushes the clock
 * forward whenever the streaming output-token count advances; reset() clears it
 * so the next turn re-seeds. Suppresses stall detection while a tool is active
 * (the model isn't producing tokens then, a "Stalled" label would be a false
 * positive).
 */
export class ThinkingStallClock {
  private startedAt: number | null = null;
  private lastDeltaAt = 0;
  private lastOutputTokens = 0;

  tick(streamingOutputTokens: number, toolActive: boolean, nowMs: number): ThinkingStallInfo | undefined {
    if (this.startedAt === null) {
      this.startedAt = nowMs;
      this.lastDeltaAt = nowMs;
      this.lastOutputTokens = streamingOutputTokens;
    } else if (streamingOutputTokens > this.lastOutputTokens) {
      this.lastDeltaAt = nowMs;
      this.lastOutputTokens = streamingOutputTokens;
    }
    return UIFactory.computeRenderStallInfo({ toolActive, lastDeltaAtMs: this.lastDeltaAt, nowMs });
  }

  reset(): void {
    this.startedAt = null;
  }

  /** Ms since the turn started, undefined before the first tick. */
  elapsed(nowMs: number): number | undefined {
    return this.startedAt === null ? undefined : Math.max(0, nowMs - this.startedAt);
  }
}

export interface ThinkingOverlayDeps {
  readonly orchestrator: Pick<Orchestrator,
    'isThinking' | 'getSpinner' | 'thinkingFrame' | 'streamingInputTokens' | 'streamingOutputTokens'>;
  readonly configManager: Pick<ConfigManager, 'get'>;
  /** The raw snapshot tool preview (a truthy value means a tool is executing). */
  readonly streamToolPreview: string | undefined;
  readonly streamTokenSpeed: number;
  readonly approvalPending: boolean;
  readonly width: number;
  readonly clock: ThinkingStallClock;
}

/**
 * The status line's busy state for a running turn, or null when idle (which
 * resets the stall clock so the next turn re-seeds). The stall and approval
 * signals decide the honest waiting phrase.
 */
export function buildBusyState(deps: ThinkingOverlayDeps): StatusBusyState | null {
  if (!deps.orchestrator.isThinking) {
    deps.clock.reset();
    return null;
  }
  const now = Date.now();
  const stallInfo = deps.clock.tick(deps.orchestrator.streamingOutputTokens, !!deps.streamToolPreview, now);
  const showSpeed = deps.configManager.get('display.showTokenSpeed') as boolean;
  return {
    spinner: deps.orchestrator.getSpinner(),
    frame: deps.orchestrator.thinkingFrame,
    phrase: UIFactory.busyPhrase(deps.orchestrator.thinkingFrame, deps.orchestrator.streamingOutputTokens, stallInfo, deps.approvalPending),
    elapsedMs: deps.clock.elapsed(now),
    tokenSpeed: showSpeed ? deps.streamTokenSpeed : undefined,
    approvalPending: deps.approvalPending,
  };
}

/**
 * The transcript rows a running turn adds: only the opt-in partial tool
 * preview (display.showToolPreview), faint. [] when idle or when the preview
 * is off; the spinner and phrase live on the status line.
 */
export function buildThinkingOverlay(deps: ThinkingOverlayDeps): Line[] {
  if (!deps.orchestrator.isThinking) return [];
  const showPreview = deps.configManager.get('display.showToolPreview') as boolean;
  if (!showPreview || !deps.streamToolPreview) return [];
  return [UIFactory.createToolPreviewRow(deps.width, deps.streamToolPreview)];
}
