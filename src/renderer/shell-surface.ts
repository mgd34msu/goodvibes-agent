import type { Line } from '@pellux/goodvibes-sdk/platform/types';
import { calcSessionCost, isModelPriced } from '@pellux/goodvibes-sdk/platform/providers';
import { voiceCaptureRowVisible, type VoiceCaptureIndicatorState } from '../core/voice-capture-status.ts';
import { activeTokens, activeUiTones } from './theme.ts';
import { renderComposer, COMPOSER_FIXED_ROWS } from './composer.ts';
import { renderStatusLine, type StatusBusyState, type StatusChip } from './status-line.ts';
import { voiceCaptureChip } from './voice-capture-chip.ts';

/**
 * shell-surface.ts, everything under the transcript: the composer, then the
 * one-row status line.
 *
 * At rest that is 4 rows (composer 3 + status 1); with the header, the
 * resting chrome is 5 rows. The composer holds only input. The status line
 * opens with the chips that are never dropped for lack of room: the mode
 * (muted; plan in the info color), or "! auto-approve" in the error color
 * while everything is auto-approved, the live microphone and the power note
 * ("sleep disabled" / "held: …"). Then a running turn (spinner, honest
 * phrase, elapsed, `esc` interrupt) or the working directory and any
 * background work, then the cost, the context bar and the `ctrl+p` keycap for
 * the Agent workspace. A context window near compaction keeps its bar.
 *
 * Inside an agent or process view (shell/session-views.ts) the composer's bar
 * takes that session's color and its own placeholder (or a one-line reason in
 * place of input), and the status line shows the view's keys, the first of
 * which says what the next Esc does, then main kept in sight.
 */

/** The work tree's keys, shown on the status line while the keyboard is in it. */
const WORK_TREE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['↑↓', 'move between beads'], ['←→', 'fold / unfold'], ['enter', 'open'], ['y', 'copy'], ['esc', 'back to typing'],
];

/** What an agent or process view changes under the transcript. */
export interface ShellFooterView {
  /** The composer bar: the agent's lane color, or the process color. */
  readonly barColor: string;
  readonly placeholder?: string;
  /** The composer takes no input; this says why. */
  readonly disabledReason?: string;
  /** The view's keys on the status line (esc back to main, ctrl+x stop, …). */
  readonly keys: ReadonlyArray<readonly [string, string]>;
  /** After the keys: main kept in sight (◐ main · working). */
  readonly trail?: { readonly text: string; readonly fg: string } | null;
  /** A notice in place of the keys (press ctrl+x again to stop). */
  readonly notice?: { readonly text: string; readonly tone: 'error' | 'info' } | null;
  /** The process view shows no context bar or cost. */
  readonly noContext?: boolean;
  /** The cost this view states instead of the session's (an agent's own, when priced). */
  readonly cost?: string | null;
}

export interface ShellFooterBuildOptions {
  readonly width: number;
  readonly promptText: string;
  readonly promptLineCount: number;
  readonly promptCursorPos?: number;
  readonly promptFocused?: boolean;
  /** The keyboard is in the conversation work tree: the status line shows its keys. */
  readonly workTreeFocused?: boolean;
  readonly usage: { up: number; down: number; cacheRead?: number; cacheWrite?: number };
  readonly showExitNotice: boolean;
  readonly lastCopyTime: number;
  /** The model the session cost is priced against; not drawn (the header names the model). */
  readonly model?: string;
  readonly workingDir?: string;
  /** The home directory, drawn as ~ at the start of the working directory. */
  readonly homeDirectory?: string;
  /** An agent or process view is showing (core/session-focus.ts). */
  readonly view?: ShellFooterView | null;
  readonly contextWindow?: number;
  /**
   * The compaction threshold. behavior.autoCompactThreshold is stored as a
   * percent (80); a fraction (0.8) is accepted too.
   */
  readonly compactThreshold?: number;
  readonly dangerMode?: boolean;
  readonly lastInputTokens?: number;
  readonly commandArgsHint?: string;
  /** The interaction mode (quiet / balanced / operator), the mode chip's name at rest. */
  readonly hitlMode?: string;
  readonly runningAgentCount: number;
  readonly runningProcessCount: number;
  readonly indicatorFocused: boolean;
  readonly runningAgentProgress?: string;
  /** The submission intent's label (prompt, command, shell, plan, delegation, ...). */
  readonly composerMode?: string;
  readonly composerFlags?: readonly string[];
  readonly composerPendingRisk?: 'none' | 'approval-wait' | 'shell' | 'command' | 'remote';
  /**
   * The power status note (see power-status.ts's describePowerStatus),
   * "sleep disabled" while the owner keep-awake toggle holds, or
   * "held: <reasons>" while the automatic work inhibitor holds. A kept chip at
   * the left end of the status line beside the auto-approve warning: both are
   * safety-relevant and both stay visible at once.
   */
  readonly powerNote?: string;
  /** Live microphone state; a visible state renders the microphone chip. */
  readonly voiceCapture?: VoiceCaptureIndicatorState | null;
  /** A running turn: its spinner, phrase and timer take the status line's left side. */
  readonly busy?: StatusBusyState | null;
}

export interface ShellFooterBuildResult {
  readonly lines: Line[];
  readonly height: number;
}

/** The status line under the composer. */
const STATUS_ROWS = 1;

/** Rows the footer takes for this many prompt rows. */
export function estimateShellFooterHeight(promptLineCount: number): number {
  return COMPOSER_FIXED_ROWS + Math.max(1, promptLineCount) + STATUS_ROWS;
}

/** The mode's name and the composer bar's color. */
function composerModeStyle(options: ShellFooterBuildOptions): { label: string; color: string } {
  const t = activeTokens();
  const intent = options.composerMode ?? 'prompt';
  switch (intent) {
    case 'shell': return { label: 'shell', color: t.accent };
    case 'command': return { label: 'command', color: t.info };
    case 'plan': return { label: 'plan', color: t.info };
    case 'delegation':
    case 'orchestration':
      return { label: intent, color: activeUiTones().chrome.remote };
    case 'memory pin': return { label: 'memory pin', color: t.secondary };
    default: return { label: options.hitlMode || 'prompt', color: t.brand };
  }
}

/**
 * The status line's mode chip: the mode's name (muted; plan in the info
 * color; a request that leaves this terminal in the remote color), or
 * "! auto-approve" in the error color while everything is auto-approved.
 * While the warning shows, only plan keeps its name beside it (a read-only
 * posture still worth knowing); any other name would only repeat or
 * contradict it.
 */
function modeChips(label: string, dangerMode: boolean): StatusChip[] {
  const t = activeTokens();
  const chips: StatusChip[] = [];
  if (!dangerMode || label === 'plan') {
    const remote = label === 'delegation' || label === 'orchestration';
    const fg = label === 'plan' ? t.info : remote ? activeUiTones().chrome.remote : t.textMuted;
    chips.push({ text: label, fg, bold: label === 'plan' || remote, keep: true });
  }
  if (dangerMode) chips.push({ text: '! auto-approve', fg: t.error, bold: true, keep: true });
  return chips;
}

/** Format a USD amount with a precision that suits its magnitude. */
function fmtCost(usd: number): string {
  if (!(usd > 0)) return '0.00';
  if (usd < 0.01) return usd.toFixed(4);
  if (usd < 1) return usd.toFixed(3);
  return usd.toFixed(2);
}

/** "~$0.246" for a priced model (an estimate, hence the ~); null when the model has no price. */
export function statusCostText(usage: ShellFooterBuildOptions['usage'], model: string | undefined): string | null {
  if (!model || !isModelPriced(model)) return null;
  return `~$${fmtCost(calcSessionCost(usage.up, usage.down, usage.cacheRead ?? 0, usage.cacheWrite ?? 0, model))}`;
}

/** The chips no view hides: auto-approve, the live microphone, the power note. */
function safetyChips(options: ShellFooterBuildOptions): StatusChip[] {
  const t = activeTokens();
  const chips: StatusChip[] = [];
  if (options.dangerMode) chips.push({ text: '! auto-approve', fg: t.error, bold: true, keep: true });
  const voice = options.voiceCapture ?? null;
  if (voice && voiceCaptureRowVisible(voice)) chips.push(voiceCaptureChip(voice));
  if (options.powerNote) chips.push({ text: options.powerNote, fg: t.warning, bold: true, keep: true });
  return chips;
}

/** The working directory with the home directory as ~ (only on a whole path segment). */
function displayDirectory(workingDir: string | undefined, homeDirectory: string | undefined): string | undefined {
  if (!workingDir) return undefined;
  const home = homeDirectory ?? (typeof process !== 'undefined' ? process.env.HOME ?? '' : '');
  if (!home) return workingDir;
  if (workingDir === home) return '~';
  return workingDir.startsWith(home.endsWith('/') ? home : `${home}/`) ? '~' + workingDir.slice(home.replace(/\/$/, '').length) : workingDir;
}

/** The compaction threshold as a fraction [0..1] (0.85 when unset or nonsense). */
function compactFraction(value: number | undefined): number {
  if (value === undefined || !(value > 0)) return 0.85;
  return Math.min(1, value > 1 ? value / 100 : value);
}

export function buildShellFooter(options: ShellFooterBuildOptions): ShellFooterBuildResult {
  const t = activeTokens();
  const lines: Line[] = [];
  const focused = options.promptFocused ?? !options.indicatorFocused;
  const mode = composerModeStyle(options);
  const view = options.view ?? null;
  lines.push(...renderComposer({
    width: options.width,
    promptText: options.promptText,
    cursorPos: options.promptCursorPos,
    focused,
    unfocusedHint: 'Esc returns to the composer',
    argsHint: options.commandArgsHint,
    modeColor: view ? view.barColor : mode.color,
    placeholder: view?.placeholder,
    disabledReason: view?.disabledReason,
  }));

  // The left end of the status line: the mode, auto-approve, microphone and
  // power note are kept at any width; the attachment flag is dropped first.
  const chips: StatusChip[] = modeChips(mode.label, options.dangerMode === true);
  const voice = options.voiceCapture ?? null;
  if (voice && voiceCaptureRowVisible(voice)) chips.push(voiceCaptureChip(voice));
  if (options.powerNote) chips.push({ text: options.powerNote, fg: t.warning, bold: true, keep: true });
  // An attachment changes what the next message carries; the other flags are
  // already said elsewhere (the mode chip, and the status line's waiting
  // phrase while an approval is pending).
  if ((options.composerFlags ?? []).includes('attachments')) chips.push({ text: 'image attached', fg: t.info });

  const copied = Date.now() - options.lastCopyTime < 2000;
  if (view) {
    // Inside an agent or process view: its keys (what Esc does first), then main kept in sight.
    lines.push(renderStatusLine({
      width: options.width,
      chips: safetyChips(options),
      notice: options.showExitNotice ? { text: 'Press Ctrl+C again to exit', tone: 'error' } : view.notice ?? (copied ? { text: 'Copied', tone: 'info' } : null),
      keys: view.keys,
      trail: view.trail ?? null,
      cost: view.noContext ? null : view.cost ?? null,
      context: null,
    }));
    return { lines, height: lines.length };
  }
  lines.push(renderStatusLine({
    width: options.width,
    chips,
    notice: options.showExitNotice
      ? { text: 'Press Ctrl+C again to exit', tone: 'error' }
      : copied ? { text: 'Copied', tone: 'info' } : null,
    // With text in the composer the next Esc clears it; only an empty composer's Esc interrupts.
    busy: options.busy ? { ...options.busy, escAction: options.promptText.trim().length > 0 ? 'clear input' : undefined } : null,
    keys: options.workTreeFocused ? WORK_TREE_KEYS : null,
    directory: displayDirectory(options.workingDir, options.homeDirectory),
    background: {
      agents: options.runningAgentCount,
      processes: options.runningProcessCount,
      focused: options.indicatorFocused,
      progress: options.runningAgentProgress,
    },
    cost: statusCostText(options.usage, options.model),
    context: options.contextWindow && options.contextWindow > 0
      ? {
          usedTokens: options.lastInputTokens ?? 0,
          windowTokens: options.contextWindow,
          compactFraction: compactFraction(options.compactThreshold),
        }
      : null,
  }));
  return { lines, height: lines.length };
}
