import { describe, test, expect } from 'bun:test';
import { renderProcessIndicator, renderVoiceCaptureIndicator } from '../../renderer/process-indicator.ts';
import { lineToString } from '../setup.ts';

const W = 100;

describe('renderProcessIndicator', () => {
  test('returns a single Line when idle (0 delegations, 0 tools)', () => {
    const lines = renderProcessIndicator(W, 0, 0);
    expect(lines.length).toBe(1);
  });

  test('idle line has correct terminal width', () => {
    const lines = renderProcessIndicator(W, 0, 0);
    expect(lines[0].length).toBe(W);
  });

  test('idle state contains idle label text', () => {
    const lines = renderProcessIndicator(W, 0, 0);
    const text = lineToString(lines[0]);
    expect(text).toContain('No runtime activity');
  });

  test('idle state cells are dimmed', () => {
    const lines = renderProcessIndicator(W, 0, 0);
    const dimCells = lines[0].filter((c) => c.char !== ' ' && c.dim);
    expect(dimCells.length).toBeGreaterThan(0);
  });

  test('returns a single Line when active', () => {
    const lines = renderProcessIndicator(W, 2, 1);
    expect(lines.length).toBe(1);
  });

  test('active line has correct terminal width', () => {
    const lines = renderProcessIndicator(W, 2, 1);
    expect(lines[0].length).toBe(W);
  });

  test('active state shows delegation count', () => {
    const lines = renderProcessIndicator(W, 2, 0);
    const text = lineToString(lines[0]);
    expect(text).toContain('2 delegations');
    expect(text).not.toContain('agents');
  });

  test('active state shows tool count', () => {
    const lines = renderProcessIndicator(W, 0, 3);
    const text = lineToString(lines[0]);
    expect(text).toContain('3 tools running');
  });

  test('active state shows both delegations and tools', () => {
    const lines = renderProcessIndicator(W, 1, 2);
    const text = lineToString(lines[0]);
    expect(text).toContain('1 delegation');
    expect(text).toContain('2 tools running');
    expect(text).toContain('│');
  });

  test('pluralization: 1 delegation singular', () => {
    const lines = renderProcessIndicator(W, 1, 0);
    const text = lineToString(lines[0]);
    expect(text).toContain('1 delegation');
    expect(text).not.toContain('1 delegations');
    expect(text).not.toContain('1 agent');
  });

  test('pluralization: 2 delegations plural', () => {
    const lines = renderProcessIndicator(W, 2, 0);
    const text = lineToString(lines[0]);
    expect(text).toContain('2 delegations');
  });

  test('pluralization: 1 tool singular', () => {
    const lines = renderProcessIndicator(W, 0, 1);
    const text = lineToString(lines[0]);
    expect(text).toContain('1 tool running');
    expect(text).not.toContain('1 tools running');
  });

  test('open hint present when active', () => {
    const lines = renderProcessIndicator(W, 1, 0);
    const text = lineToString(lines[0]);
    expect(text).toContain('Enter to view');
  });

  test('open hint not present when idle', () => {
    const lines = renderProcessIndicator(W, 0, 0);
    const text = lineToString(lines[0]);
    expect(text).not.toContain('Enter to view');
  });

  test('width handling: narrow terminal (40 cols)', () => {
    const narrow = 40;
    const lines = renderProcessIndicator(narrow, 2, 1);
    expect(lines.length).toBe(1);
    expect(lines[0].length).toBe(narrow);
  });

  test('active label cells are cyan + bold', () => {
    const lines = renderProcessIndicator(W, 1, 0);
    // Find a cell with cyan foreground from the label
    const cyanBold = lines[0].filter((c) => c.fg === '#00ffff' && c.bold);
    expect(cyanBold.length).toBeGreaterThan(0);
  });

  test('focused with zero processes shows the focused idle hint without gutter chrome', () => {
    const lines = renderProcessIndicator(80, 0, 0, true);
    expect(lines.length).toBe(1);
    const text = lines[0].map(c => c.char).join('');
    expect(text).toContain('▸');
    expect(text).toContain('No runtime activity');
  });

  test('focused with active processes shows Enter hint', () => {
    const lines = renderProcessIndicator(80, 2, 0, true);
    expect(lines.length).toBe(1);
    const text = lines[0].map(c => c.char).join('');
    expect(text).toContain('Enter to open');
    expect(text).toContain('back to input');
    expect(text).toContain('•');
  });

  test('focused line uses cyan bold styling', () => {
    const lines = renderProcessIndicator(80, 1, 0, true);
    const firstNonSpace = lines[0].find(c => c.char.trim() !== '');
    expect(firstNonSpace?.fg).toBe('#7dd3fc');
    expect(firstNonSpace?.bold).toBe(true);
  });

  test('focused line uses a bounded background highlight', () => {
    const lines = renderProcessIndicator(80, 1, 0, true);
    const highlighted = lines[0].filter((c) => c.bg === '#31506f');
    expect(highlighted.length).toBeGreaterThan(10);
    expect(lines[0][0]?.bg).not.toBe('#31506f');
    expect(lines[0][79]?.bg).not.toBe('#31506f');
  });

  test('focused line respects terminal width', () => {
    const lines = renderProcessIndicator(120, 1, 0, true);
    expect(lines[0].length).toBe(120);
  });

  test('unfocused with explicit false matches default behavior', () => {
    const defaultLines = renderProcessIndicator(80, 1, 0);
    const explicitLines = renderProcessIndicator(80, 1, 0, false);
    const defaultText = defaultLines[0].map(c => c.char).join('');
    const explicitText = explicitLines[0].map(c => c.char).join('');
    expect(defaultText).toBe(explicitText);
  });

  test('agentProgress appears in rendered output when passed', () => {
    const progress = 'Turn 3 | precision_write';
    const lines = renderProcessIndicator(W, 1, 0, false, progress);
    const text = lineToString(lines[0]);
    expect(text).toContain(progress);
  });

  test('agentProgress is truncated when it exceeds available width', () => {
    // With a narrow terminal, progress is either truncated or omitted entirely
    const progress = 'A'.repeat(100);
    const lines = renderProcessIndicator(60, 1, 0, false, progress);
    const text = lineToString(lines[0]);
    // Should not overflow the line width
    expect(lines[0].length).toBe(60);
    // The full 100-char string must not appear verbatim
    expect(text).not.toContain('A'.repeat(100));
  });

  test('no agentProgress shows no progress suffix', () => {
    const lines = renderProcessIndicator(W, 1, 0, false, undefined);
    const text = lineToString(lines[0]);
    // Should contain delegation count but no progress suffix beyond it
    expect(text).toContain('1 delegation');
    expect(text).not.toContain(' | Turn');
  });
});

/**
 * The live-microphone row (`voice.wake.indicator`).
 *
 * A held-open capture device with nothing on screen saying so is the one state a
 * voice feature must never be in, so these assert the words and the prominence,
 * not just that a line came back.
 */
describe('renderVoiceCaptureIndicator', () => {
  test('nothing renders when no microphone is open', () => {
    expect(renderVoiceCaptureIndicator(W, null)).toEqual([]);
  });

  test('statusline renders one row naming what the microphone is doing and what opened it', () => {
    const lines = renderVoiceCaptureIndicator(W, {
      kind: 'wake-listening',
      deviceLabel: 'parecord',
      indicator: 'statusline',
    });
    expect(lines.length).toBe(1);
    const text = lineToString(lines[0]);
    expect(text).toContain('listening for the wake phrase');
    expect(text).toContain('parecord');
  });

  test('each phase says a DIFFERENT thing, so "listening" is never shown for "recording"', () => {
    const say = (kind: 'wake-listening' | 'wake-capturing' | 'wake-restarting' | 'wake-latched'): string =>
      lineToString(renderVoiceCaptureIndicator(W, { kind, deviceLabel: null, indicator: 'statusline' })[0]);
    const sentences = [say('wake-listening'), say('wake-capturing'), say('wake-restarting'), say('wake-latched')];
    expect(new Set(sentences).size).toBe(4);
    expect(sentences[1]).toContain('recording what follows');
    expect(sentences[3]).toContain('stopped');
  });

  test('voice.wake.indicator "off" removes the row entirely, while "banner" fills the width', () => {
    expect(renderVoiceCaptureIndicator(W, { kind: 'wake-listening', deviceLabel: 'parecord', indicator: 'off' })).toEqual([]);

    const banner = renderVoiceCaptureIndicator(W, { kind: 'wake-listening', deviceLabel: 'parecord', indicator: 'banner' });
    expect(banner.length).toBe(1);
    expect(banner[0].length).toBe(W);
    expect(lineToString(banner[0])).toContain('listening for the wake phrase');
    // The prominent variant paints a background across the row; the quiet one does not.
    const statusline = renderVoiceCaptureIndicator(W, { kind: 'wake-listening', deviceLabel: 'parecord', indicator: 'statusline' });
    const bannerBg = new Set(banner[0].map((cell) => cell.bg));
    const statuslineBg = new Set(statusline[0].map((cell) => cell.bg));
    expect(bannerBg.size).toBeGreaterThan(statuslineBg.size);
  });

  test('a restart delay or latch reason is carried into the row rather than left in a log', () => {
    // A wide row, so the assertion is about the detail being CARRIED rather than
    // about where 100 columns happen to cut it (truncation has its own test).
    const text = lineToString(renderVoiceCaptureIndicator(160, {
      kind: 'wake-restarting',
      deviceLabel: 'parecord',
      indicator: 'statusline',
      detail: 'restarting the wake-word detector in 2000 ms (attempt 1)',
    })[0]);
    expect(text).toContain('attempt 1');
    expect(lineToString(renderVoiceCaptureIndicator(160, {
      kind: 'wake-restarting', deviceLabel: 'parecord', indicator: 'statusline',
    })[0])).not.toContain('attempt 1');
  });

  test('a long detail is truncated to the row rather than overflowing it', () => {
    const lines = renderVoiceCaptureIndicator(60, {
      kind: 'wake-latched',
      deviceLabel: 'parecord',
      indicator: 'statusline',
      detail: 'B'.repeat(200),
    });
    expect(lines[0].length).toBe(60);
    expect(lineToString(lines[0])).not.toContain('B'.repeat(200));
  });
});
