import type { Line } from '@pellux/goodvibes-sdk/platform/types';
import { renderProcessIndicator, renderVoiceCaptureIndicator } from './process-indicator.ts';
import { UIFactory } from './ui-factory.ts';
import { voiceCaptureRowVisible, type VoiceCaptureIndicatorState } from '../core/voice-capture-status.ts';

export interface ShellFooterBuildOptions {
  readonly width: number;
  readonly promptText: string;
  readonly promptLineCount: number;
  readonly promptCursorPos?: number;
  readonly promptFocused?: boolean;
  readonly usage: { up: number; down: number };
  readonly showExitNotice: boolean;
  readonly lastCopyTime: number;
  readonly model?: string;
  readonly toolCount?: number;
  readonly workingDir?: string;
  readonly provider?: string;
  readonly contextWindow?: number;
  readonly compactThreshold?: number;
  readonly dangerMode?: boolean;
  readonly lastInputTokens?: number;
  readonly commandArgsHint?: string;
  readonly hitlMode?: string;
  readonly runningAgentCount: number;
  readonly runningProcessCount: number;
  readonly indicatorFocused: boolean;
  readonly runningAgentProgress?: string;
  readonly composerMode?: string;
  readonly composerStatus?: string;
  readonly composerFlags?: readonly string[];
  readonly composerPendingRisk?: 'none' | 'approval-wait' | 'shell' | 'command' | 'remote';
  /**
   * The power status note (see power-status.ts's describePowerStatus) —
   * "sleep disabled" while the owner keep-awake toggle holds, or
   * "held: <reasons>" while the automatic work inhibitor holds. Shares the
   * status line's right-side notice area with dangerMode, but the two are
   * COMPOSED together (see composeSafetyNoticeSegments in ui-factory.ts),
   * never suppressing each other — both are safety-relevant and must stay
   * visible at once. Only the transient 2-second "copied" confirmation is
   * exclusive (a flash, not a persistent safety state).
   */
  readonly powerNote?: string;
  /**
   * Live microphone state — the wake detector, for as long as it runs. Rendered as
   * a persistent row beside the process indicator, because a capture device held
   * open with nothing on screen saying so is the one state a voice feature must
   * never be in. Null (or a state with `voice.wake.indicator: off`) renders
   * nothing.
   */
  readonly voiceCapture?: VoiceCaptureIndicatorState | null;
}

export interface ShellFooterBuildResult {
  readonly lines: Line[];
  readonly height: number;
}

// Footer chrome: box top + box bottom + status line + hints line.
const FOOTER_BASE_ROWS = 4;
const PROCESS_INDICATOR_ROWS = 1;
/** The live-microphone row, when one is showing (see renderVoiceCaptureIndicator). */
const VOICE_CAPTURE_ROWS = 1;

export function estimateShellFooterHeight(
  promptLineCount: number,
  _contextWindow?: number,
  voiceCapture: VoiceCaptureIndicatorState | null = null,
): number {
  const safePromptLines = Math.max(1, promptLineCount);
  // Counted on the cold-start path too: a shell launched with the wake detector
  // already listening renders that row in its very first frame, and a viewport
  // sized one row too tall would draw the transcript's last line under it.
  const voiceRows = voiceCaptureRowVisible(voiceCapture) ? VOICE_CAPTURE_ROWS : 0;
  return FOOTER_BASE_ROWS + safePromptLines + PROCESS_INDICATOR_ROWS + voiceRows;
}

export function buildShellFooter(
  options: ShellFooterBuildOptions,
): ShellFooterBuildResult {
  const lines = UIFactory.createFooter(
    options.width,
    options.promptText,
    options.usage,
    options.showExitNotice,
    options.lastCopyTime,
    options.model,
    options.toolCount,
    options.promptCursorPos,
    options.workingDir,
    options.provider,
    options.contextWindow,
    options.compactThreshold,
    options.dangerMode,
    options.lastInputTokens,
    options.commandArgsHint,
    options.hitlMode,
    options.promptFocused ?? !options.indicatorFocused,
    options.composerMode,
    options.composerStatus,
    options.composerFlags,
    options.composerPendingRisk,
    options.powerNote,
  );
  const processIndicator = renderProcessIndicator(
    options.width,
    options.runningAgentCount,
    options.runningProcessCount,
    options.indicatorFocused,
    options.runningAgentProgress,
  );
  const inputBoxRows = Math.max(1, options.promptLineCount) + 2;
  // The voice row sits directly under the prompt box, ABOVE the process indicator:
  // an open microphone is a live condition the user is acting inside, while the
  // process indicator is a background summary.
  lines.splice(inputBoxRows, 0, ...renderVoiceCaptureIndicator(options.width, options.voiceCapture ?? null), ...processIndicator);
  return { lines, height: lines.length };
}
