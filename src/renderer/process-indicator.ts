import { type Line } from '@pellux/goodvibes-sdk/platform/types';
import { UIFactory } from './ui-factory.ts';
import { getDisplayWidth } from '../utils/terminal-width.ts';
import { GLYPHS, UI_TONES } from './ui-primitives.ts';
import { activeUiTones } from './theme.ts';
import { voiceCaptureRowVisible, type VoiceCaptureIndicatorState } from '../core/voice-capture-status.ts';

/** Truncate a string to fit within maxWidth display columns. */
function truncateToWidth(text: string, maxWidth: number): string {
  let width = 0;
  let i = 0;
  for (const char of text) {
    const cw = getDisplayWidth(char);
    if (width + cw > maxWidth) break;
    width += cw;
    i += char.length;
  }
  return text.slice(0, i);
}

/**
 * renderProcessIndicator, shows a one-line summary of active runtime
 * activity below the input area.
 *
 * Dimmed when no entries are active, highlighted (cyan) when delegated work
 * records or shell exec processes are running. Includes an `Enter to view`
 * hint when active.
 */
export function renderProcessIndicator(
  width: number,
  agentCount: number,
  toolCount: number,
  focused: boolean = false,
  agentProgress?: string,
): Line[] {
  const total = agentCount + toolCount;
  const delegationLabel = (count: number): string => `${count} delegation${count !== 1 ? 's' : ''}`;
  const renderPlainStatus = (text: string, style: { fg: string; bold?: boolean; dim?: boolean }): Line[] => (
    [UIFactory.stringToLine(`   ${text}`, width, style)]
  );
  const renderFocusedStatus = (text: string): Line[] => {
    const bg = '#31506f';
    const fg = '#eefaff';
    // Opaque highlight bar (bg/fg fixed), marker sourced from the shared
    // browser accent token (dark == the prior browser-cyan marker).
    const markerFg = UI_TONES.accent.browser;
    const line = UIFactory.stringToLine(' '.repeat(width), width, { fg: '238' });
    const prefix = `${GLYPHS.navigation.selected} `;
    const body = truncateToWidth(text, Math.max(0, width - 8));
    const highlighted = ` ${prefix}${body} `;
    const startX = 2;
    for (let i = 0; i < highlighted.length && startX + i < width - 2; i++) {
      const ch = highlighted[i]!;
      const isMarker = i < prefix.length + 1;
      line[startX + i].char = ch;
      line[startX + i].fg = isMarker ? markerFg : fg;
      line[startX + i].bg = bg;
      line[startX + i].bold = true;
      line[startX + i].dim = false;
    }
    return [line];
  };

  // --- Focused state: always render before idle/active branches ---
  if (focused) {
    const parts: string[] = [];
    if (agentCount > 0) parts.push(delegationLabel(agentCount));
    if (toolCount > 0) parts.push(`${toolCount} tool${toolCount !== 1 ? 's' : ''} running`);
    const label = total === 0
      ? `No runtime activity  ${GLYPHS.status.pending}  back to input`
      : `${parts.join(` ${GLYPHS.navigation.pipeSeparator} `)}  ${GLYPHS.status.pending}  Enter to open  ${GLYPHS.status.pending}  back to input`;
    return renderFocusedStatus(label);
  }

  if (total === 0) {
    return renderPlainStatus('No runtime activity', { fg: '238', dim: true });
  }

  // Build the label: "2 delegations | Turn 3 | write - src/foo.ts"
  const parts: string[] = [];
  if (agentCount > 0) {
    parts.push(delegationLabel(agentCount));
  }
  if (toolCount > 0) {
    parts.push(`${toolCount} tool${toolCount !== 1 ? 's' : ''} running`);
  }
  // Append the first running agent's progress (truncated to fit)
  /**
   * Number of columns reserved for the delegation count label and hint text.
   * Breakdown: "N delegations" prefix (~15 chars) + " | " separator (~3)
   * + "  Enter to view  " hint (~17) + padding (~8) ≈ 43 chars.
   */
  const PROGRESS_RESERVED_CHARS = 43;
  const progressMaxLen = Math.max(0, width - PROGRESS_RESERVED_CHARS); // reserve space for count + hint
  const progressSuffix = agentProgress && progressMaxLen > 10
    ? ` | ${agentProgress.length > progressMaxLen ? agentProgress.slice(0, Math.max(0, progressMaxLen - 3)) + '...' : agentProgress}`
    : '';
  const label = `${parts.join(` ${GLYPHS.navigation.pipeSeparator} `)}${progressSuffix}`;
  const hint = `  ${GLYPHS.status.pending}  Enter to view`;
  // Active-status label paints on the transparent terminal bg → read the live
  // brand accent so it flips to a legible value in light mode (dark == brand cyan).
  return renderPlainStatus(`${label}${hint}`, { fg: activeUiTones().accent.brand, bold: true });
}

/**
 * Sentence each capture state renders as. Written out per state rather than
 * assembled from fragments because these are the words that tell a user whether
 * their microphone is open, "listening" and "recording" mean different things and
 * a row that blurred them would be worse than no row.
 */
const VOICE_CAPTURE_LABELS: Record<VoiceCaptureIndicatorState['kind'], string> = {
  'wake-listening': 'listening for the wake phrase',
  'wake-capturing': 'wake heard, recording what follows',
  'wake-restarting': 'capture stream ended, restarting',
  'wake-latched': 'wake detection stopped',
  'wake-starting': 'opening the microphone, not listening yet',
  'wake-no-audio': 'microphone open, but no audio is arriving',
  'wake-no-microphone': 'no microphone on this machine, nothing is listening',
};

/**
 * renderVoiceCaptureIndicator, the persistent row shown while the microphone is
 * open, below the input area beside the process indicator.
 *
 * It exists because a held-open capture device is otherwise invisible: wake
 * detection runs for as long as the feature is on, and nothing else on screen
 * would say so. `voice.wake.indicator` chooses between `statusline` (one dim row),
 * `banner` (a highlighted row that is hard to miss) and `off`.
 *
 * Returns no lines when nothing is captured, or when the row is turned off, the
 * caller splices whatever comes back, so an empty array is "no row".
 */
export function renderVoiceCaptureIndicator(
  width: number,
  state: VoiceCaptureIndicatorState | null,
): Line[] {
  if (!voiceCaptureRowVisible(state) || state === null) return [];
  const tones = activeUiTones();
  const marker = state.kind === 'wake-latched' ? GLYPHS.status.blocked : GLYPHS.status.active;
  const device = state.deviceLabel !== null ? ` ${GLYPHS.navigation.pipeSeparator} ${state.deviceLabel}` : '';
  const extra = state.detail !== undefined && state.detail.length > 0
    ? ` ${GLYPHS.navigation.pipeSeparator} ${state.detail}`
    : '';
  const body = `${marker} Voice: ${VOICE_CAPTURE_LABELS[state.kind]}${device}${extra}`;
  const fg = state.kind === 'wake-latched' || state.kind === 'wake-restarting'
    ? tones.chrome.warn
    : tones.accent.control;

  if (state.indicator === 'banner') {
    // The prominent variant: the row is filled to the terminal width on the footer
    // background so it reads as a standing condition, not a passing note.
    const line = UIFactory.stringToLine(' '.repeat(width), width, { fg: tones.chrome.faint });
    const text = ` ${truncateToWidth(body, Math.max(0, width - 4))} `;
    for (let i = 0; i < text.length && 1 + i < width - 1; i++) {
      const cell = line[1 + i]!;
      cell.char = text[i]!;
      cell.fg = fg;
      cell.bg = tones.bg.footer;
      cell.bold = true;
      cell.dim = false;
    }
    return [line];
  }
  return [UIFactory.stringToLine(`   ${truncateToWidth(body, Math.max(0, width - 4))}`, width, { fg, bold: true })];
}
