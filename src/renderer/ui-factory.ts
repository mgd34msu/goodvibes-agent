import { type Line, type Cell, createEmptyLine, createEmptyCell } from '../types/grid.ts';
import { LAYOUT } from './layout.ts';
import { VERSION } from '../version.ts';
import { fitDisplay, getDisplayWidth, truncateDisplay, wrapText, interpolateColor } from '../utils/terminal-width.ts';
import { renderConversationFragment, renderConversationStatusLine, type ConversationStatusSegment } from './conversation-surface.ts';
import { GLYPHS } from './ui-primitives.ts';

/** Number of frames before the animated gradient completes one full cycle. */
const GRADIENT_CYCLE_FRAMES = 50;
/** Number of frames before rotating to the next thinking phrase (~30 seconds at 80ms/frame). */
const PHRASE_ROTATION_FRAMES = 375;

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
    const CYAN = '#00ffff';
    const GREY = '244';
    const TITLE_COLOR = '250';
    const brand = ` GoodVibes Agent `;
    const ver = `v${VERSION} `;
    const stats = ` ${model} `;
    const prov = `(${provider}) `;
    const line = createEmptyLine(width);
    let curX = 0;
    for (const char of brand) { line[curX++] = { char, fg: CYAN, bg: '', bold: true, dim: false, underline: false, italic: false, strikethrough: false }; }
    for (const char of ver) { line[curX++] = { char, fg: GREY, bg: '', bold: false, dim: true, underline: false, italic: false, strikethrough: false }; }
    // Optional conversation title — shown after brand/ver, truncated to fit
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
      for (const char of displayTitle) { if (curX < width) line[curX++] = { char, fg: TITLE_COLOR, bg: '', bold: false, dim: true, underline: false, italic: false, strikethrough: false }; }
    }
    const rightSideText = stats + prov;
    const rightSideW = getDisplayWidth(rightSideText);
    let rightX = width - rightSideW;
    for (const char of stats) { if (rightX < width) line[rightX++] = { char, fg: CYAN, bg: '', bold: true, dim: false, underline: false, italic: false, strikethrough: false }; }
    for (const char of prov) { if (rightX < width) line[rightX++] = { char, fg: GREY, bg: '', bold: false, dim: true, underline: false, italic: false, strikethrough: false }; }
    lines.push(line);
    lines.push(this.stringToLine('━'.repeat(width), width, { fg: '244' }));
    return lines;
  }

  /**
   * createMessageBar - Renders a historical user message.
   * Logic: Calculates the longest line to create a "hugging" block.
   */
  public static createMessageBar(
    width: number, text: string,
    bgColor = '#2a2a2a', textColor = '252', prefixStr = ' › ',
    strikethrough = false
  ): Line[] {
    return renderConversationFragment(text, width, {
      prefix: prefixStr,
      prefixFg: '135',
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
      prefixFg: '135',
      text: '240',
      bodyBg: '#1a1a1a',
      dim: true,
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
  ): Line[] {
    const lines: Line[] = [];
    const promptLines = prompt.split('\n');
    const TEXT_COLOR = promptFocused ? '252' : '246';
    const BG_COLOR = promptFocused ? '#2a2a2a' : '#1f2430';
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
      // Render text without cursor insertion — cursor is overlaid after
      const rawText = `${prefix}${text}`;
      const paddedText = fitDisplay(rawText, contentW);
      const contentLine = createBaseLine();
      for (let x = 0; x < boxWidth; x++) {
        const char = (x >= 2 && x < boxWidth - 2) ? paddedText[x - 2] || ' ' : ' ';
        contentLine[boxStartX + x] = {
          char,
          fg: (x < 5 && i === 0) ? (promptFocused ? '135' : '244') : TEXT_COLOR,
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
              fg: cell.char === ' ' ? '252' : '#000000',
              bg: cell.char === ' ' ? (promptFocused ? BG_COLOR : '#334155') : '#ffffff',
              bold: false, dim: false, underline: false, italic: false, strikethrough: false
            };
          }
        }
      } else if (promptFocused && i === promptLines.length - 1) {
        // No cursorPos provided — show block at end (fallback)
        const endX = boxStartX + 2 + prefix.length + text.length;
        if (endX < boxStartX + boxWidth - 2) {
          contentLine[endX] = { char: GLYPHS.surface.cursor, fg: '252', bg: promptFocused ? BG_COLOR : '#334155', bold: false, dim: false, underline: false, italic: false, strikethrough: false };
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
            contentLine[hx] = { char: ch, fg: '238', bg: BG_COLOR, bold: false, dim: true, underline: false, italic: false, strikethrough: false };
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
      statusTokens.push({ text: provider ? `${model} · ${provider}` : model, fg: '245' });
    }
    if (contextWindow && contextWindow > 0) {
      const ctxTokens = lastInputTokens ?? 0;
      const pct = Math.min(100, Math.round((ctxTokens / contextWindow) * 100));
      const filled = Math.round((pct / 100) * 6);
      const meter = GLYPHS.meter.filled.repeat(filled) + GLYPHS.meter.empty.repeat(6 - filled);
      const meterFg = pct >= 85 ? '#ef4444' : pct >= 65 ? '#f59e0b' : '240';
      statusTokens.push({ text: `context ${meter} ${pct}%`, fg: meterFg, bold: pct >= 85 });
    }
    if (inp > 0 || out > 0) {
      statusTokens.push({ text: `↑${fmtNum(inp)} ↓${fmtNum(out)}`, fg: '240' });
    }
    if (composerPendingRisk === 'approval-wait') {
      statusTokens.push({ text: 'waiting for your approval', fg: '#f59e0b', bold: true });
    }
    const rightNotice = isRecentlyCopied
      ? { text: `copied ${GLYPHS.status.success} `, fg: '81', bold: true }
      : dangerMode
        ? { text: '⚠ auto-approve is on ', fg: '#ef4444', bold: true }
        : null;
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
      if (index > 0) writeStatusText(`  ${GLYPHS.navigation.pipeSeparator}  `, '238');
      writeStatusText(token.text, token.fg, token.bold ?? false);
    });
    if (rightNotice) {
      let col = Math.max(sx + 2, width - getDisplayWidth(rightNotice.text));
      for (const ch of rightNotice.text) {
        if (col >= width) break;
        statusLine[col] = { char: ch, fg: rightNotice.fg, bg: '', bold: rightNotice.bold ?? false, dim: false, underline: false, italic: false, strikethrough: false };
        col += getDisplayWidth(ch);
      }
    }
    lines.push(statusLine);

    // ── Hints line ──
    if (showExitNotice) {
      lines.push(this.stringToLine(fitDisplay('   Press Ctrl+C again to exit ', width), width, { fg: '196', bold: true }));
    } else {
      const hints = `   /help commands  ${GLYPHS.navigation.pipeSeparator}  Ctrl+P settings  ${GLYPHS.navigation.pipeSeparator}  Ctrl+O activity `;
      lines.push(this.stringToLine(truncateDisplay(hints, width), width, { fg: '240', dim: true }));
    }
    return lines;
  }

  /** Rotating thinking phrases — vaporwave / good vibes themed. */
  private static readonly THINKING_PHRASES = [
    'Thinking...',
    'Vibing...',
    'Manifesting...',
    'Channeling energy...',
    'Tuning frequencies...',
    'Riding the wave...',
    'Aligning chakras...',
    'Entering flow state...',
    'Consulting the void...',
    'Absorbing aesthetics...',
    'Synthesizing vibes...',
    'Transcending...',
    'Dreaming in neon...',
    'Parsing the cosmos...',
    'Loading good vibes...',
    'Meditating...',
    'Catching a vibe...',
    'Harmonizing...',
    'Feeling it...',
    'In the zone...',
  ];

  /** Gradient colors for thinking text — cyan to purple (matches splash). */
  private static readonly THINK_GRADIENT_START = '#00ffff';
  private static readonly THINK_GRADIENT_END = '#d000ff';

  public static createThinkingFragment(width: number, spinner: string, frame: number = 0, tokenSpeed?: number, toolPreview?: string, inputTokens?: number, outputTokens?: number): Line[] {
    // Rotate phrase every ~30 seconds (frame ticks at 80ms, so ~375 frames)
    const phraseIndex = Math.floor(frame / PHRASE_ROTATION_FRAMES) % this.THINKING_PHRASES.length;
    const phrase = this.THINKING_PHRASES[phraseIndex];
    const speedSuffix = (tokenSpeed !== undefined && tokenSpeed > 0) ? ` (${Math.round(tokenSpeed)} tok/s)` : '';
    const text = `  ${spinner} ${phrase}${speedSuffix} `;

    const textWidth = Math.max(1, getDisplayWidth(text) - 1);
    const segments: ConversationStatusSegment[] = Array.from(text).map((char, index) => {
      const rawUnwrapped = (index / textWidth) - (frame % GRADIENT_CYCLE_FRAMES) * 0.02;
      const raw = ((rawUnwrapped % 1.0) + 1.0) % 1.0;
      const gradientPos = raw <= 0.5 ? raw * 2 : (1 - raw) * 2;
      return {
        text: char,
        fg: interpolateColor(this.THINK_GRADIENT_START, this.THINK_GRADIENT_END, gradientPos),
        bold: true,
      };
    });
    if (inputTokens !== undefined || outputTokens !== undefined) {
      const inTok = inputTokens ?? 0;
      const outTok = outputTokens ?? 0;
      segments.push({ text: ` in ${fmtNum(inTok)} `, fg: '243', dim: true });
      segments.push({ text: `out ${fmtNum(outTok)}`, fg: '#00ffff' });
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
          fg: '#38bdf8',
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
          fg: '243',
          bg: '',
          bold: false,
          dim: true,
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
    const color = pct < 0.6 ? '82' : pct < 0.85 ? '220' : '196';
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
