/**
 * thinking-overlay.ts (W4-R4) — the thinking-indicator overlay + its honest
 * stall clock, extracted from main.ts's render loop.
 *
 * The SDK orchestrator surfaces no lastDeltaAtMs / reconnect signal directly, so
 * ThinkingStallClock derives a per-turn last-delta clock from streaming
 * output-token advances — a real, honest proxy that degrades gracefully with
 * zero new SDK events. buildThinkingOverlay turns that into the honest waiting
 * state (via UIFactory.createThinkingFragment, which consumes the SDK
 * presentation contract's waitingPhrase).
 */

import { UIFactory, type ThinkingStallInfo } from '../renderer/ui-factory.ts';
import type { Line } from '../types/grid.ts';
import type { Orchestrator } from './orchestrator.ts';
import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';

/**
 * Per-turn last-delta clock. tick() seeds at turn start, then pushes the clock
 * forward whenever the streaming output-token count advances; reset() clears it
 * so the next turn re-seeds. Suppresses stall detection while a tool is active
 * (the model isn't producing tokens then — a "Stalled" label would be a false
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
 * Build the thinking-indicator overlay lines. Returns [] when not thinking (and
 * resets the stall clock so the next turn re-seeds). The stall/approval signals
 * drive the honest waiting state inside createThinkingFragment.
 */
export function buildThinkingOverlay(deps: ThinkingOverlayDeps): Line[] {
  if (!deps.orchestrator.isThinking) {
    deps.clock.reset();
    return [];
  }
  const showSpeed = deps.configManager.get('display.showTokenSpeed') as boolean;
  const showPreview = deps.configManager.get('display.showToolPreview') as boolean;
  const stallInfo = deps.clock.tick(deps.orchestrator.streamingOutputTokens, !!deps.streamToolPreview, Date.now());
  return UIFactory.createThinkingFragment(
    deps.width,
    deps.orchestrator.getSpinner(),
    deps.orchestrator.thinkingFrame,
    showSpeed ? deps.streamTokenSpeed : undefined,
    showPreview ? deps.streamToolPreview : undefined,
    deps.orchestrator.streamingInputTokens > 0 ? deps.orchestrator.streamingInputTokens : undefined,
    deps.orchestrator.streamingOutputTokens > 0 ? deps.orchestrator.streamingOutputTokens : undefined,
    stallInfo,
    deps.approvalPending,
  );
}
