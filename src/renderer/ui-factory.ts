import { type Line, type Cell, createEmptyLine, createEmptyCell } from '@pellux/goodvibes-sdk/platform/types';
import { LAYOUT } from './layout.ts';
import { VERSION } from '../version.ts';
import { fitDisplay, getDisplayWidth, truncateDisplay, wrapText, interpolateColor } from '../utils/terminal-width.ts';
import { renderConversationFragment, renderConversationStatusLine, type ConversationStatusSegment } from './conversation-surface.ts';
import { GLYPHS } from './ui-primitives.ts';
import { activeTheme, activeTokens, activeUiTones } from './theme.ts';
import {
  THINKING_PHRASES,
  waitingPhrase,
  type WaitingState,
} from '@pellux/goodvibes-sdk/platform/presentation';

/** Number of frames before the animated gradient completes one full cycle. */
const GRADIENT_CYCLE_FRAMES = 50;
/** Number of frames before rotating to the next thinking phrase (~30 seconds at 80ms/frame). */
const PHRASE_ROTATION_FRAMES = 375;
/**
 * Silence threshold before the whimsical phrase rotation freezes and an honest
 * label (Waiting for model Ns / Stalled Ns) takes over. Matches the TUI.
 */
const THINKING_STALL_FREEZE_MS = 2_500;

/**
 * Per-turn stall signal derived from stream metrics, computed from the last
 * delta clock every render (not from any event), so it degrades gracefully with
 * zero new SDK events. `reconnect` is set only when the transport surfaces retry
 * counters (the agent's SDK orchestrator does not today, see computeStallInfo).
 */
export interface ThinkingStallInfo {
  /** Ms since the last output-token advance (or the turn start if none yet). */
  readonly msSinceLastDelta: number;
  readonly reconnect?: { readonly attempt: number; readonly maxAttempts: number };
}

/** One colored run within the footer status line's right-side notice area. */
export interface RightNoticeSegment {
  readonly text: string;
  readonly fg: string;
  readonly bold?: boolean;
}

const RIGHT_NOTICE_SEPARATOR = ' · ';
// Notice colours are getters over the active theme (read at each paint).
const NOTICE_FG = {
  get separator(): string { return activeTokens().textFaint; },
  get danger(): string { return activeTokens().error; },
  get power(): string { return activeTokens().warning; },
};
const DANGER_MODE_FULL_TEXT = '⚠ auto-approve is on';
const DANGER_MODE_COMPACT_TEXT = '⚠ auto-approve';
const DANGER_MODE_ICON_TEXT = '⚠';

/**
 * Compose the danger-mode (auto-approve) and power (sleep/keep-awake) safety
 * notices for the footer status line's right-side slot. Both are
 * safety-relevant and must render SIMULTANEOUSLY, neither ever silently
 * suppresses the other (the defect this replaces: the two notices shared one
 * slot with dangerMode always winning, so the sleep-disabled note vanished
 * exactly when danger mode made it matter most).
 *
 * When both are active and full text does not fit `availableWidth`, this
 * steps down through shorter forms of the danger-mode text (never dropping
 * the power note, which is already short) so both notices keep SOME visible
 * text at any reasonable width, rather than one disappearing outright. Only
 * at pathologically narrow widths does it fall through to a single
 * ellipsis-truncated combined string (truncateDisplay never overlaps or
 * cuts a glyph in half, it always ends the string cleanly).
 */
export function composeSafetyNoticeSegments(
  dangerMode: boolean | undefined,
  powerNote: string | undefined,
  availableWidth: number,
): RightNoticeSegment[] {
  if (availableWidth <= 0) return [];
  const powerText = powerNote ? `⚡ ${powerNote}` : undefined;
  if (dangerMode && powerText) {
    const dangerCandidates = [DANGER_MODE_FULL_TEXT, DANGER_MODE_COMPACT_TEXT, DANGER_MODE_ICON_TEXT];
    for (const dangerText of dangerCandidates) {
      const combinedWidth = getDisplayWidth(dangerText) + getDisplayWidth(RIGHT_NOTICE_SEPARATOR) + getDisplayWidth(powerText);
      if (combinedWidth <= availableWidth) {
        return [
          { text: dangerText, fg: NOTICE_FG.danger, bold: true },
          { text: RIGHT_NOTICE_SEPARATOR, fg: NOTICE_FG.separator },
          { text: powerText, fg: NOTICE_FG.power },
        ];
      }
    }
    // Neither the icon-only danger text plus the full power note fits: fall
    // back to a single truncated string carrying both icons, so both are
    // still represented rather than one vanishing.
    const minimal = `${DANGER_MODE_ICON_TEXT}${RIGHT_NOTICE_SEPARATOR}${powerText}`;
    const fitted = truncateDisplay(minimal, availableWidth);
    return fitted ? [{ text: fitted, fg: NOTICE_FG.danger, bold: true }] : [];
  }
  if (dangerMode) {
    const fitted = truncateDisplay(DANGER_MODE_FULL_TEXT, availableWidth);
    return fitted ? [{ text: fitted, fg: NOTICE_FG.danger, bold: true }] : [];
  }
  if (powerText) {
    const fitted = truncateDisplay(powerText, availableWidth);
    return fitted ? [{ text: fitted, fg: NOTICE_FG.power }] : [];
  }
  return [];
}

/** Format a number: up to 999, then 1.0k, 1.0M, 1.0B, 1.0T */
function fmtNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'k';
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n < 1_000_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  return (n / 1_000_000_000_000).toFixed(1) + 'T';
}

/**
 * UIFactory - Generates standard UI fragments without needing Ink/React overhead.
 */
export class UIFactory {
  public static createHeader(width: number, model: string, provider: string, title?: string): Line[] {
    const lines: Line[] = [];
    const t = activeUiTones();
    const CYAN = t.accent.brand;
    const GREY = t.chrome.faint;
    // The title used a light grey under SGR dim; the faint token replaces that pairing.
    const TITLE_COLOR = t.chrome.faint;
    const brand = ` GoodVibes Agent `;
    const ver = `v${VERSION} `;
    const stats = ` ${model} `;
    const prov = `(${provider}) `;
    const line = createEmptyLine(width);
    let curX = 0;
    for (const char of brand) { line[curX++] = { char, fg: CYAN, bg: '', bold: true, dim: false, underline: false, italic: false, strikethrough: false }; }
    for (const char of ver) { line[curX++] = { char, fg: GREY, bg: '', bold: false, dim: false, underline: false, italic: false, strikethrough: false }; }
    // Optional conversation title, shown after brand/ver, truncated to fit
    if (title) {
      const titleStr = `│ ${title} `;
      // Reserve space for model/provider on the right.
      const rightReserved = getDisplayWidth(stats + prov);
      const maxTitleW = width - curX - rightReserved - 1;
      let displayTitle: string;
      if (getDisplayWidth(titleStr) <= maxTitleW) {
        displayTitle = titleStr;
      } else {
        let truncated = '';
        let w = 0;
        for (const ch of titleStr) {
          const cw = getDisplayWidth(ch);
          if (w + cw > maxTitleW - 3) { truncated += '...'; break; }
          truncated += ch;
          w += cw;
        }
        displayTitle = truncated;
      }
      for (const char of displayTitle) { if (curX < width) line[curX++] = { char, fg: TITLE_COLOR, bg: '', bold: false, dim: false, underline: false, italic: false, strikethrough: false }; }
    }
    const rightSideText = stats + prov;
    const rightSideW = getDisplayWidth(rightSideText);
    let rightX = width - rightSideW;
    for (const char of stats) { if (rightX < width) line[rightX++] = { char, fg: CYAN, bg: '', bold: true, dim: false, underline: false, italic: false, strikethrough: false }; }
    for (const char of prov) { if (rightX < width) line[rightX++] = { char, fg: GREY, bg: '', bold: false, dim: false, underline: false, italic: false, strikethrough: false }; }
    lines.push(line);
    lines.push(this.stringToLine('━'.repeat(width), width, { fg: activeTokens().textMuted }));
    return lines;
  }

  /**
   * createMessageBar - Renders a historical user message.
   * Logic: Calculates the longest line to create a "hugging" block.
   */
  public static createMessageBar(
    width: number, text: string,
    bgColor: string = activeTokens().backgroundElement, textColor: string = activeTokens().text, prefixStr = ' › ',
    strikethrough = false
  ): Line[] {
    return renderConversationFragment(text, width, {
      prefix: prefixStr,
      prefixFg: activeTokens().secondary,
      text: textColor,
      bodyBg: bgColor,
      strikethrough,
    });
  }

  /**
   * createQueuedMessageFragment - Renders a dimmed message bar for queued prompts.
   */
  public static createQueuedMessageFragment(width: number, text: string): Line[] {
    return renderConversationFragment(text, width, {
      prefix: ' (...) ',
      prefixFg: activeTokens().secondary,
      text: activeTokens().textFaint,
      bodyBg: activeTheme().collapsedBodyBg,
    });
  }

  public static createFooter(
    width: number,
    prompt: string,
    usage: { up: number; down: number; max?: number },
    showExitNotice: boolean,
    lastCopyTime: number,
    model?: string,
    toolCount?: number,
    cursorPos?: number,
    workingDir?: string,
    provider?: string,
    contextWindow?: number,
    compactThreshold?: number,
    dangerMode?: boolean,
    lastInputTokens?: number,
    commandArgsHint?: string,
    hitlMode?: string,
    promptFocused: boolean = true,
    composerMode?: string,
    composerStatus?: string,
    composerFlags?: readonly string[],
    composerPendingRisk?: 'none' | 'approval-wait' | 'shell' | 'command' | 'remote',
    powerNote?: string,
  ): Line[] {
    const lines: Line[] = [];
    const promptLines = prompt.split('\n');
    // Unfocused, the composer text reads faint (the faint token replaces the
    // SGR dim this box used to apply).
    const tk = activeTokens();
    const TEXT_COLOR = promptFocused ? tk.text : tk.textFaint;
    const BG_COLOR = promptFocused ? tk.backgroundInput : tk.backgroundPanel;
    const BORDER_COLOR = BG_COLOR;
    const boxMargin = 2; const boxWidth = width - (boxMargin * 2); const boxStartX = boxMargin;
    const createBaseLine = () => {
      const l = createEmptyLine(width);
      for (let x = 0; x < width; x++) l[x].bg = '';
      return l;
    };
    const topLine = createBaseLine();
    for (let x = 0; x < boxWidth; x++) topLine[boxStartX + x] = { char: GLYPHS.surface.top, fg: BORDER_COLOR, bg: '', bold: false, dim: false, underline: false, italic: false, strikethrough: false };
    lines.push(topLine);
    promptLines.forEach((text, i) => {
      const contentW = boxWidth - 4;
      const prefix = i === 0 ? ' › ' : '   ';
      // Render text without cursor insertion, cursor is overlaid after
      const rawText = `${prefix}${text}`;
      const paddedText = fitDisplay(rawText, contentW);
      const contentLine = createBaseLine();
      for (let x = 0; x < boxWidth; x++) {
        const char = (x >= 2 && x < boxWidth - 2) ? paddedText[x - 2] || ' ' : ' ';
        contentLine[boxStartX + x] = {
          char,
          fg: (x < 5 && i === 0) ? (promptFocused ? tk.secondary : tk.textFaint) : TEXT_COLOR,
          bg: BG_COLOR,
          bold: false,
          dim: !promptFocused,
          underline: false,
          italic: false,
          strikethrough: false,
        };
      }

      // Overlay cursor only while the prompt owns focus.
      if (promptFocused && cursorPos !== undefined) {
        let lineStart = 0;
        for (let li = 0; li < i; li++) lineStart += promptLines[li].length + 1;
        const posInLine = cursorPos - lineStart;
        if (posInLine >= 0 && posInLine <= text.length) {
          // Cursor column in cell coordinates: prefix width (3) + posInLine + box padding (2)
          const cursorX = boxStartX + 2 + prefix.length + posInLine;
          if (cursorX < boxStartX + boxWidth - 2) {
            const cell = contentLine[cursorX];
            // Invert: bright fg on the text bg, swap to make cursor visible
            contentLine[cursorX] = {
              char: cell.char === ' ' ? GLYPHS.surface.cursor : cell.char,
              // Block cursor: the glyph on the box fill, or the character
              // inverted (box fill on the text colour).
              fg: cell.char === ' ' ? tk.text : BG_COLOR,
              bg: cell.char === ' ' ? (promptFocused ? BG_COLOR : tk.borderSubtle) : tk.text,
              bold: false, dim: false, underline: false, italic: false, strikethrough: false
            };
          }
        }
      } else if (promptFocused && i === promptLines.length - 1) {
        // No cursorPos provided, show block at end (fallback)
        const endX = boxStartX + 2 + prefix.length + text.length;
        if (endX < boxStartX + boxWidth - 2) {
          contentLine[endX] = { char: GLYPHS.surface.cursor, fg: tk.text, bg: promptFocused ? BG_COLOR : tk.borderSubtle, bold: false, dim: false, underline: false, italic: false, strikethrough: false };
        }
      }

      // Overlay args hint: dim grey text after cursor on the last prompt line.
      // Only shown when a commandArgsHint is provided and cursor is at the end of input.
      if (commandArgsHint && i === promptLines.length - 1) {
        // Determine where the cursor sits on this line
        let cursorColOnLine: number;
        if (cursorPos !== undefined) {
          let lineStart = 0;
          for (let li = 0; li < i; li++) lineStart += promptLines[li].length + 1;
          cursorColOnLine = cursorPos - lineStart;
        } else {
          cursorColOnLine = text.length;
        }
        // Only show hint when cursor is at end of the last line (no args typed yet)
        if (cursorColOnLine >= text.length) {
          // Hint starts one cell after the cursor block
          const hintStartX = boxStartX + 2 + prefix.length + text.length + 1;
          const hintText = ' ' + commandArgsHint;
          let hx = hintStartX;
          for (const ch of hintText) {
            if (hx >= boxStartX + boxWidth - 2) break;
            contentLine[hx] = { char: ch, fg: tk.textFaint, bg: BG_COLOR, bold: false, dim: false, underline: false, italic: false, strikethrough: false };
            hx++;
          }
        }
      }

      lines.push(contentLine);
    });
    const bottomLine = createBaseLine();
    for (let x = 0; x < boxWidth; x++) bottomLine[boxStartX + x] = { char: GLYPHS.surface.bottom, fg: BORDER_COLOR, bg: '', bold: false, dim: false, underline: false, italic: false, strikethrough: false };
    lines.push(bottomLine);

    // ── Status line: model · context meter · tokens, with alerts on the right ──
    const isRecentlyCopied = Date.now() - lastCopyTime < 2000;
    const u = usage as { input?: number; output?: number; up?: number; down?: number };
    const inp = u.input ?? u.up ?? 0;
    const out = u.output ?? u.down ?? 0;
    const statusTokens: Array<{ text: string; fg: string; bold?: boolean }> = [];
    if (model) {
      statusTokens.push({ text: provider ? `${model} · ${provider}` : model, fg: tk.textMuted });
    }
    if (contextWindow && contextWindow > 0) {
      const ctxTokens = lastInputTokens ?? 0;
      const pct = Math.min(100, Math.round((ctxTokens / contextWindow) * 100));
      const filled = Math.round((pct / 100) * 6);
      const meter = GLYPHS.meter.filled.repeat(filled) + GLYPHS.meter.empty.repeat(6 - filled);
      const meterFg = pct >= 85 ? tk.error : pct >= 65 ? tk.warning : tk.textFaint;
      statusTokens.push({ text: `context ${meter} ${pct}%`, fg: meterFg, bold: pct >= 85 });
    }
    if (inp > 0 || out > 0) {
      statusTokens.push({ text: `↑${fmtNum(inp)} ↓${fmtNum(out)}`, fg: tk.textFaint });
    }
    // The attachment chip, the ONE composer flag this row renders.
    //
    // The status line is deliberately compact here: mode, state and the flag
    // list are all withheld on purpose (see the test that pins it, and the note
    // below about the retired approval-wait token). An attachment is the
    // exception that earns its place, because it changes what the next message
    // actually carries, and because the only other evidence of it is the
    // [IMAGE: ...] marker sitting in the prompt, which reads as text you typed,
    // not as a picture that is going to be sent. Every other flag stays silent.
    if (composerFlags?.includes('attachments')) {
      statusTokens.push({ text: `${GLYPHS.status.active} image attached`, fg: tk.info, bold: true });
    }
    // The disconnected footer 'waiting for your approval' token is retired
    // here, the approval-wait truth now lives in the unified waiting state of the
    // thinking indicator (createThinkingFragment's approvalPending path) and in the
    // permission prompt itself, so the footer no longer carries a separate,
    // easily-desynced copy. composerPendingRisk stays in the signature for the
    // composer flags row; it just no longer mints its own status token.
    //
    // The transient "copied" flash stays exclusive (it is a 2-second
    // confirmation, not a persistent safety state), but dangerMode and
    // powerNote are BOTH safety-relevant and must never suppress each other;
    // see composeSafetyNoticeSegments.
    const statusLine = createBaseLine();
    let sx = 3;
    const writeStatusText = (text: string, fg: string, bold = false) => {
      for (const ch of text) {
        if (sx >= width - 1) break;
        statusLine[sx] = { char: ch, fg, bg: '', bold, dim: false, underline: false, italic: false, strikethrough: false };
        sx += getDisplayWidth(ch);
      }
    };
    statusTokens.forEach((token, index) => {
      if (index > 0) writeStatusText(`  ${GLYPHS.navigation.pipeSeparator}  `, tk.textFaint);
      writeStatusText(token.text, token.fg, token.bold ?? false);
    });
    const rightAreaStart = sx + 2;
    const availableNoticeWidth = Math.max(0, width - rightAreaStart);
    const rightNoticeSegments: RightNoticeSegment[] = isRecentlyCopied
      ? [{ text: `copied ${GLYPHS.status.success} `, fg: tk.info, bold: true }]
      : composeSafetyNoticeSegments(dangerMode, powerNote, availableNoticeWidth);
    if (rightNoticeSegments.length > 0) {
      const totalWidth = rightNoticeSegments.reduce((sum, seg) => sum + getDisplayWidth(seg.text), 0);
      // A single trailing space of breathing room against the right border,
      // when there's spare width for it, purely cosmetic.
      if (totalWidth < availableNoticeWidth) {
        const last = rightNoticeSegments[rightNoticeSegments.length - 1]!;
        rightNoticeSegments[rightNoticeSegments.length - 1] = { ...last, text: `${last.text} ` };
      }
      let col = Math.max(rightAreaStart, width - rightNoticeSegments.reduce((sum, seg) => sum + getDisplayWidth(seg.text), 0));
      for (const seg of rightNoticeSegments) {
        for (const ch of seg.text) {
          if (col >= width) break;
          statusLine[col] = { char: ch, fg: seg.fg, bg: '', bold: seg.bold ?? false, dim: false, underline: false, italic: false, strikethrough: false };
          col += getDisplayWidth(ch);
        }
      }
    }
    lines.push(statusLine);

    // ── Hints line ──
    if (showExitNotice) {
      lines.push(this.stringToLine(fitDisplay('   Press Ctrl+C again to exit ', width), width, { fg: tk.error, bold: true }));
    } else {
      const hints = `   /help commands  ${GLYPHS.navigation.pipeSeparator}  Ctrl+P settings  ${GLYPHS.navigation.pipeSeparator}  Ctrl+O activity `;
      lines.push(this.stringToLine(truncateDisplay(hints, width), width, { fg: tk.textFaint }));
    }
    return lines;
  }

  /**
   * Per-frame stall info from stream metrics, computed from a last-delta clock
   * every render (not from any event) so it degrades gracefully with zero new
   * SDK events. Undefined until a delta clock exists this turn. Renderer-local
   * by design (per the S1 decision record: the SDK owns state->wording; deriving
   * WHICH state applies stays with each renderer's own stream-metrics shape).
   */
  public static computeStallInfo(
    lastDeltaAtMs: number | undefined,
    reconnectAttempt: number | undefined,
    reconnectMaxAttempts: number | undefined,
    nowMs: number,
  ): ThinkingStallInfo | undefined {
    if (lastDeltaAtMs === undefined) return undefined;
    const reconnect = reconnectAttempt !== undefined && reconnectMaxAttempts !== undefined
      ? { attempt: reconnectAttempt, maxAttempts: reconnectMaxAttempts }
      : undefined;
    return { msSinceLastDelta: nowMs - lastDeltaAtMs, reconnect };
  }

  /**
   * Render-loop stall decision: suppress stall detection entirely while a tool
   * is actively executing. The last-delta clock only advances on output-token
   * deltas and is never advanced during tool execution (the model isn't
   * producing tokens then), so without this gate any tool call longer than
   * THINKING_STALL_FREEZE_MS would print "Stalled Ns..." above a ticking tool
   * row, a false positive. Genuine no-delta silence while waiting on the
   * provider (including pre-first-token) still stall-detects here, since no tool
   * is active then, the honest stall case this indicator exists for.
   */
  public static computeRenderStallInfo(
    metrics: { toolActive: boolean; lastDeltaAtMs: number | undefined; nowMs: number },
  ): ThinkingStallInfo | undefined {
    return metrics.toolActive
      ? undefined
      : this.computeStallInfo(metrics.lastDeltaAtMs, undefined, undefined, metrics.nowMs);
  }

  public static createThinkingFragment(width: number, spinner: string, frame: number = 0, tokenSpeed?: number, toolPreview?: string, inputTokens?: number, outputTokens?: number, stallInfo?: ThinkingStallInfo, approvalPending?: boolean): Line[] {
    // Live thinking row paints on the transparent terminal bg → read the
    // mode-resolved chrome tones per render (gradient/brand flip in light mode).
    const tones = activeUiTones();
    // Decide WHICH honest waiting state applies (renderer-local), then defer the
    // exact wording to the SDK presentation contract's waitingPhrase(). Precedence
    // matches the contract: approval > reconnecting > pre-first-token > stalled >
    // thinking. Pre-first-token silence reads "Waiting for model Ns..." (blame-free
    // for reasoning models that think before emitting), NOT "Stalled".
    const isStalled = stallInfo !== undefined && stallInfo.msSinceLastDelta >= THINKING_STALL_FREEZE_MS;
    let state: WaitingState;
    if (approvalPending) state = 'approval';
    else if (stallInfo?.reconnect) state = 'reconnecting';
    else if (isStalled && (outputTokens ?? 0) === 0) state = 'pre-first-token';
    else if (isStalled) state = 'stalled';
    else state = 'thinking';
    const phrase = waitingPhrase(state, {
      reconnectAttempt: stallInfo?.reconnect?.attempt,
      reconnectMaxAttempts: stallInfo?.reconnect?.maxAttempts,
      msSinceLastDelta: stallInfo?.msSinceLastDelta,
      frame,
    });
    // A tok/s figure next to an approval prompt reads as if the model were still
    // working, suppress it while waiting on the user.
    const speedSuffix = (!approvalPending && tokenSpeed !== undefined && tokenSpeed > 0) ? ` (${Math.round(tokenSpeed)} tok/s)` : '';
    const text = `  ${spinner} ${phrase}${speedSuffix} `;

    const textWidth = Math.max(1, getDisplayWidth(text) - 1);
    const segments: ConversationStatusSegment[] = Array.from(text).map((char, index) => {
      const rawUnwrapped = (index / textWidth) - (frame % GRADIENT_CYCLE_FRAMES) * 0.02;
      const raw = ((rawUnwrapped % 1.0) + 1.0) % 1.0;
      const gradientPos = raw <= 0.5 ? raw * 2 : (1 - raw) * 2;
      return {
        text: char,
        fg: interpolateColor(tones.accent.gradientStart, tones.accent.gradientEnd, gradientPos),
        bold: true,
      };
    });
    if (inputTokens !== undefined || outputTokens !== undefined) {
      const inTok = inputTokens ?? 0;
      const outTok = outputTokens ?? 0;
      segments.push({ text: ` in ${fmtNum(inTok)} `, fg: activeTokens().textFaint });
      segments.push({ text: `out ${fmtNum(outTok)}`, fg: tones.accent.brand });
    }
    const line = createEmptyLine(width);
    let col = 1;
    for (const segment of segments) {
      for (const char of segment.text) {
        if (col >= width) break;
        const charWidth = getDisplayWidth(char);
        if (charWidth <= 0 || col + charWidth > width) break;
        line[col] = {
          char,
          fg: segment.fg,
          bg: '',
          bold: segment.bold ?? false,
          dim: segment.dim ?? false,
          underline: false,
          italic: segment.italic ?? false,
          strikethrough: false,
        };
        if (charWidth === 2 && col + 1 < width) {
          line[col + 1] = { ...line[col], char: '' };
        }
        col += charWidth;
      }
      if (col >= width) break;
    }

    const lines: Line[] = [
      this.stringToLine(' '.repeat(width), width),
      line,
    ];

    if (toolPreview) {
      const previewLine = createEmptyLine(width);
      const label = ' tool: ';
      let px = 0;
      for (const ch of label) {
        if (px >= width) break;
        previewLine[px] = {
          char: ch,
          fg: tones.state.info,
          bg: '',
          bold: true,
          dim: false,
          underline: false,
          italic: false,
          strikethrough: false,
        };
        px += getDisplayWidth(ch);
      }
      for (const ch of toolPreview) {
        if (px >= width) break;
        const charWidth = getDisplayWidth(ch);
        if (charWidth <= 0 || px + charWidth > width) break;
        previewLine[px] = {
          char: ch,
          fg: activeTokens().textFaint,
          bg: '',
          bold: false,
          dim: false,
          underline: false,
          italic: false,
          strikethrough: false,
        };
        if (charWidth === 2 && px + 1 < width) {
          previewLine[px + 1] = { ...previewLine[px], char: '' };
        }
        px += charWidth;
      }
      lines.push(previewLine);
    }

    lines.push(this.stringToLine(' '.repeat(width), width));
    return lines;
  }

  /**
   * createProgressBarLine - Renders a labeled progress bar line.
   * @param label - Left-side label string (padded as-is)
   * @param pct - Fill fraction 0..1
   * @param barWidth - Number of bar characters
   * @param lineWidth - Total terminal width to slice to
   */
  private static createProgressBarLine(label: string, pct: number, barWidth: number, lineWidth: number, suffix?: string): Line {
    const pctDisplay = Math.round(pct * 100);
    const filled = Math.round(pct * barWidth);
    const tk = activeTokens();
    const color = pct < 0.6 ? tk.success : pct < 0.85 ? tk.warning : tk.error;
    const bar = GLYPHS.meter.filled.repeat(filled) + GLYPHS.meter.empty.repeat(barWidth - filled);
    const pctStr = `  ${pctDisplay}%`;
    const full = label + bar + pctStr + (suffix ?? '');
    return this.stringToLine(truncateDisplay(full, lineWidth), lineWidth, { fg: color, dim: true });
  }

  public static stringToLine(text: string, width: number, style: Partial<Cell> = {}): Line {
    const line = createEmptyLine(width);
    let currentColumn = 0;
    for (const char of text) {
      if (currentColumn >= width) break;
      const code = char.codePointAt(0) ?? 0;
      if (code < 32 || code === 127) continue;
      const charWidth = getDisplayWidth(char);
      line[currentColumn] = {
        char,
        fg: style.fg || '',
        bg: style.bg || '',
        bold: style.bold || false,
        dim: style.dim || false,
        underline: style.underline || false,
        italic: style.italic || false,
        strikethrough: style.strikethrough || false
      };
      if (charWidth === 2 && currentColumn + 1 < width) {
        line[currentColumn + 1] = { ...line[currentColumn], char: '' };
      }
      currentColumn += charWidth;
    }
    return line;
  }
}
