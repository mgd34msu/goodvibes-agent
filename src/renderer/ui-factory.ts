import { type Cell, type Line, createEmptyLine, createStyledCell } from '../types/grid.ts';
import { GOODVIBES_AGENT_PACKAGE_VERSION } from '../version.js';
import { fitDisplay, getDisplayWidth, interpolateColor, truncateDisplay } from '../utils/terminal-width.ts';
import { renderConversationFragment, renderConversationStatusLine, type ConversationStatusSegment } from './conversation-surface.ts';
import { GLYPHS } from './ui-primitives.ts';

const GRADIENT_CYCLE_FRAMES = 50;
const PHRASE_ROTATION_FRAMES = 375;

function fmtNum(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${(value / 1_000_000_000).toFixed(1)}B`;
}

export class UIFactory {
  static createHeader(
    width: number,
    model: string,
    provider: string,
    title?: string,
  ): Line[] {
    const line = createEmptyLine(width);
    const brand = ' GoodVibes Agent ';
    const version = `v${GOODVIBES_AGENT_PACKAGE_VERSION} `;
    const right = ` ${model} (${provider}) `;
    let x = 0;
    x = writeCells(line, x, width, brand, { fg: '#00ffff', bold: true });
    x = writeCells(line, x, width, version, { fg: '244', dim: true });
    if (title) {
      const maxTitleWidth = Math.max(0, width - x - getDisplayWidth(right) - 2);
      if (maxTitleWidth > 4) {
        x = writeCells(line, x, width, `│ ${truncateDisplay(title, maxTitleWidth)} `, { fg: '250', dim: true });
      }
    }
    writeCells(line, Math.max(x + 1, width - getDisplayWidth(right)), width, right, { fg: '#00ffff', bold: true });
    return [line, this.stringToLine('━'.repeat(width), width, { fg: '244' })];
  }

  static createMessageBar(
    width: number,
    text: string,
    bgColor = '#2a2a2a',
    textColor = '252',
    prefixStr = ' › ',
    strikethrough = false,
  ): Line[] {
    return renderConversationFragment(text, width, {
      prefix: prefixStr,
      prefixFg: '135',
      text: textColor,
      bodyBg: bgColor,
      strikethrough,
    });
  }

  static createQueuedMessageFragment(width: number, text: string): Line[] {
    return renderConversationFragment(text, width, {
      prefix: ' (...) ',
      prefixFg: '135',
      text: '240',
      bodyBg: '#1a1a1a',
      dim: true,
    });
  }

  static createFooter(
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
    promptFocused = true,
    composerMode?: string,
    composerStatus?: string,
    composerFlags?: readonly string[],
    composerPendingRisk?: 'none' | 'approval-wait' | 'shell' | 'command' | 'remote',
  ): Line[] {
    const lines: Line[] = [];
    const promptLines = prompt.split('\n');
    const bgColor = promptFocused ? '#2a2a2a' : '#1f2430';
    const textColor = promptFocused ? '252' : '246';
    const boxMargin = 2;
    const boxWidth = Math.max(8, width - boxMargin * 2);
    const boxStartX = boxMargin;
    const createBaseLine = (): Line => createEmptyLine(width);

    const topLine = createBaseLine();
    for (let x = 0; x < boxWidth && boxStartX + x < width; x++) {
      topLine[boxStartX + x] = createStyledCell(GLYPHS.surface.top, { fg: bgColor });
    }
    lines.push(topLine);

    for (let index = 0; index < promptLines.length; index += 1) {
      const text = promptLines[index] ?? '';
      const prefix = index === 0 ? ' › ' : '   ';
      const contentWidth = Math.max(1, boxWidth - 4);
      const line = createBaseLine();
      for (let x = 0; x < boxWidth && boxStartX + x < width; x++) {
        line[boxStartX + x] = createStyledCell(' ', { fg: textColor, bg: bgColor, dim: !promptFocused });
      }
      writeCells(line, boxStartX + 2, boxStartX + 2 + contentWidth, fitDisplay(`${prefix}${text}`, contentWidth), {
        fg: textColor,
        bg: bgColor,
        dim: !promptFocused,
      });
      if (promptFocused && cursorPos !== undefined) {
        const lineStart = promptLines.slice(0, index).reduce((sum, value) => sum + value.length + 1, 0);
        const posInLine = cursorPos - lineStart;
        if (posInLine >= 0 && posInLine <= text.length) {
          const cursorX = boxStartX + 2 + prefix.length + posInLine;
          if (cursorX < boxStartX + boxWidth - 2) {
            const cell = line[cursorX] ?? createStyledCell(' ', { fg: textColor, bg: bgColor });
            line[cursorX] = createStyledCell(cell.char === ' ' ? GLYPHS.surface.cursor : cell.char, {
              fg: cell.char === ' ' ? '252' : '#000000',
              bg: cell.char === ' ' ? bgColor : '#ffffff',
            });
          }
        }
      }
      if (commandArgsHint && index === promptLines.length - 1) {
        const hintStart = boxStartX + 2 + prefix.length + text.length + 1;
        writeCells(line, hintStart, boxStartX + boxWidth - 2, ` ${commandArgsHint}`, { fg: '238', bg: bgColor, dim: true });
      }
      lines.push(line);
    }

    const bottomLine = createBaseLine();
    for (let x = 0; x < boxWidth && boxStartX + x < width; x++) {
      bottomLine[boxStartX + x] = createStyledCell(GLYPHS.surface.bottom, { fg: bgColor });
    }
    lines.push(bottomLine, createBaseLine());

    const modeTokens: ConversationStatusSegment[] = [];
    if (composerMode) modeTokens.push({ text: ` ${GLYPHS.status.active} ${composerMode} `, fg: '#38bdf8', bold: true });
    if (composerStatus && composerStatus !== 'idle') modeTokens.push({ text: ` state:${composerStatus} `, fg: '244', dim: true });
    if (composerPendingRisk && composerPendingRisk !== 'none') modeTokens.push({ text: ` risk:${composerPendingRisk} `, fg: '#f59e0b', bold: true });
    if (composerFlags && composerFlags.length > 0) modeTokens.push({ text: ` flags:${composerFlags.join(',')} `, fg: '244', dim: true });
    if (modeTokens.length > 0) {
      lines.push(renderConversationStatusLine(width, modeTokens, { markerFg: '#38bdf8' }), createBaseLine());
    }

    const total = usage.up + usage.down;
    const stats = ` Token Usage [ Input: ${fmtNum(usage.up)} │ Output: ${fmtNum(usage.down)} │ Total: ${fmtNum(total)} ]`;
    const copied = Date.now() - lastCopyTime < 2_000 ? ' [COPIED]' : '';
    lines.push(this.stringToLine(fitDisplay(`  ${stats}${copied}`, width), width, { fg: copied ? '81' : '244', bold: Boolean(copied) }));

    if (contextWindow && contextWindow > 0) {
      const current = lastInputTokens ?? 0;
      const pct = Math.min(1, current / contextWindow);
      const barWidth = Math.max(10, Math.min(30, width - 36));
      lines.push(createBaseLine(), this.createProgressBarLine('   Context Usage: ', pct, barWidth, width, ` [ ${fmtNum(current)} / ${fmtNum(contextWindow)} ]`));
    }

    const contextParts = [workingDir, model ? `${model}${provider ? ` (${provider})` : ''}` : undefined, toolCount ? `${toolCount} tools` : undefined, hitlMode ? `hitl:${hitlMode}` : undefined].filter((value): value is string => Boolean(value));
    if (contextParts.length > 0) {
      lines.push(createBaseLine(), this.stringToLine(truncateDisplay(`   ${contextParts.join('  │  ')}`, width), width, { fg: '240', dim: true }), createBaseLine());
    }

    if (showExitNotice) {
      lines.push(this.stringToLine(fitDisplay('   Press Ctrl+C again to exit', width), width, { fg: '196', bold: true }));
    } else {
      const danger = dangerMode ? ' ! DANGER MODE' : '';
      lines.push(this.stringToLine(fitDisplay(`   /help for commands  -  Ctrl+C to quit${danger}`, width), width, {
        fg: dangerMode ? '#ef4444' : '240',
        bold: Boolean(dangerMode),
        dim: !dangerMode,
      }));
    }
    lines.push(createBaseLine());
    return lines;
  }

  static createThinkingFragment(width: number, spinner: string, frame = 0, tokenSpeed?: number): Line[] {
    const phrases = ['Thinking...', 'Working...', 'Checking routes...', 'Reading memory...', 'Delegating...'];
    const phrase = phrases[Math.floor(frame / PHRASE_ROTATION_FRAMES) % phrases.length] ?? phrases[0]!;
    const speedSuffix = tokenSpeed !== undefined && tokenSpeed > 0 ? ` (${Math.round(tokenSpeed)} tok/s)` : '';
    const text = `  ${spinner} ${phrase}${speedSuffix} `;
    const textWidth = Math.max(1, getDisplayWidth(text) - 1);
    const segments: ConversationStatusSegment[] = [...text].map((char, index) => {
      const raw = (((index / textWidth) - (frame % GRADIENT_CYCLE_FRAMES) * 0.02) % 1 + 1) % 1;
      const gradientPos = raw <= 0.5 ? raw * 2 : (1 - raw) * 2;
      return { text: char, fg: interpolateColor('#00ffff', '#d000ff', gradientPos), bold: true };
    });
    return [
      this.stringToLine(' '.repeat(width), width),
      renderConversationStatusLine(width, segments, { marker: ' ', markerFg: '#00ffff' }),
      this.stringToLine(' '.repeat(width), width),
    ];
  }

  static stringToLine(text: string, width: number, style: Partial<Cell> = {}): Line {
    const line = createEmptyLine(width);
    writeCells(line, 0, width, text, style);
    return line;
  }

  private static createProgressBarLine(label: string, pct: number, barWidth: number, lineWidth: number, suffix: string): Line {
    const filled = Math.round(pct * barWidth);
    const color = pct < 0.6 ? '82' : pct < 0.85 ? '220' : '196';
    const bar = GLYPHS.meter.filled.repeat(filled) + GLYPHS.meter.empty.repeat(Math.max(0, barWidth - filled));
    return this.stringToLine(truncateDisplay(`${label}${bar}  ${Math.round(pct * 100)}%${suffix}`, lineWidth), lineWidth, { fg: color, dim: true });
  }
}

function writeCells(line: Line, startCol: number, endColExclusive: number, text: string, style: Partial<Cell> = {}): number {
  let col = Math.max(0, startCol);
  for (const char of text) {
    const charWidth = getDisplayWidth(char);
    if (charWidth <= 0) continue;
    if (col + charWidth > endColExclusive || col >= line.length) break;
    line[col] = createStyledCell(char, {
      fg: style.fg ?? '',
      bg: style.bg ?? '',
      bold: style.bold ?? false,
      dim: style.dim ?? false,
      underline: style.underline ?? false,
      italic: style.italic ?? false,
      strikethrough: style.strikethrough ?? false,
      ...(style.link !== undefined ? { link: style.link } : {}),
    });
    if (charWidth > 1 && col + 1 < line.length) {
      line[col + 1] = createStyledCell('', {
        fg: style.fg ?? '',
        bg: style.bg ?? '',
        bold: style.bold ?? false,
        dim: style.dim ?? false,
        underline: style.underline ?? false,
        italic: style.italic ?? false,
        strikethrough: style.strikethrough ?? false,
      });
    }
    col += charWidth;
  }
  return col;
}
