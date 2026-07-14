import { describe, expect, test } from 'bun:test';
import { buildShellFooter, estimateShellFooterHeight } from '../../renderer/shell-surface.ts';
import { lineToString } from '../setup.ts';

describe('shell surface', () => {
  test('estimated footer height matches rendered footer height without context bar', () => {
    const result = buildShellFooter({
      width: 100,
      promptText: 'hello',
      promptLineCount: 1,
      usage: { up: 0, down: 0 },
      showExitNotice: false,
      lastCopyTime: 0,
      model: 'gpt-test',
      toolCount: 3,
      workingDir: '/tmp/demo',
      provider: 'openai',
      contextWindow: 0,
      runningAgentCount: 0,
      runningProcessCount: 0,
      indicatorFocused: false,
    });
    expect(result.height).toBe(estimateShellFooterHeight(1, 0));
  });

  test('estimated footer height matches rendered footer height with context bar', () => {
    const result = buildShellFooter({
      width: 100,
      promptText: 'hello\nworld',
      promptLineCount: 2,
      usage: { up: 0, down: 0 },
      showExitNotice: false,
      lastCopyTime: 0,
      model: 'claude-test',
      toolCount: 3,
      workingDir: '/tmp/demo',
      provider: 'anthropic',
      contextWindow: 200000,
      lastInputTokens: 1024,
      runningAgentCount: 1,
      runningProcessCount: 0,
      indicatorFocused: false,
      runningAgentProgress: 'Turn 2',
    });
    expect(result.height).toBe(estimateShellFooterHeight(2, 200000));
  });

  test('process indicator sits directly below the prompt box', () => {
    const result = buildShellFooter({
      width: 100,
      promptText: 'hello\nworld',
      promptLineCount: 2,
      usage: { up: 0, down: 0 },
      showExitNotice: false,
      lastCopyTime: 0,
      model: 'gpt-test',
      toolCount: 3,
      workingDir: '/tmp/demo',
      provider: 'openai',
      contextWindow: 0,
      runningAgentCount: 1,
      runningProcessCount: 0,
      indicatorFocused: false,
      runningAgentProgress: 'Turn 2',
    });
    expect(lineToString(result.lines[4])).toContain('1 delegation');
  });

  test('prompt box keeps half-height top and bottom borders', () => {
    const result = buildShellFooter({
      width: 80,
      promptText: 'hello',
      promptLineCount: 1,
      usage: { up: 0, down: 0 },
      showExitNotice: false,
      lastCopyTime: 0,
      model: 'gpt-test',
      toolCount: 3,
      workingDir: '/tmp/demo',
      provider: 'openai',
      contextWindow: 0,
      runningAgentCount: 0,
      runningProcessCount: 0,
      indicatorFocused: false,
    });
    expect(lineToString(result.lines[0])).toContain('▄');
    expect(lineToString(result.lines[2])).toContain('▀');
  });

  test('status line stays compact; approval-wait no longer mints a separate footer token', () => {
    const result = buildShellFooter({
      width: 100,
      promptText: 'hello',
      promptLineCount: 1,
      usage: { up: 1200, down: 800 },
      showExitNotice: false,
      lastCopyTime: 0,
      model: 'gpt-test',
      toolCount: 3,
      workingDir: '/tmp/demo',
      provider: 'openai',
      contextWindow: 0,
      runningAgentCount: 0,
      runningProcessCount: 0,
      indicatorFocused: false,
      composerMode: 'shell',
      composerStatus: 'preflight',
      composerFlags: ['approval'],
      composerPendingRisk: 'approval-wait',
    });
    const text = result.lines.map(lineToString).join('\n');
    expect(text).toContain('gpt-test · openai');
    // The disconnected footer 'waiting for your approval' token is retired.
    // The approval-wait truth now lives in the unified thinking indicator
    // (createThinkingFragment's approvalPending path) and the permission prompt —
    // the footer no longer carries an easily-desynced second copy.
    expect(text).not.toContain('waiting for your approval');
    expect(text).not.toContain('risk:');
    expect(text).not.toContain('state:');
    expect(text).not.toContain('flags:');
    // Footer chrome stays at 5 rows + prompt: box top/bottom, indicator, status, hints.
    expect(result.lines.length).toBe(6);
  });

  test('prompt box visibly loses focus when the indicator is focused', () => {
    const focused = buildShellFooter({
      width: 80,
      promptText: 'hello',
      promptLineCount: 1,
      usage: { up: 0, down: 0 },
      showExitNotice: false,
      lastCopyTime: 0,
      model: 'gpt-test',
      toolCount: 3,
      workingDir: '/tmp/demo',
      provider: 'openai',
      contextWindow: 0,
      runningAgentCount: 1,
      runningProcessCount: 0,
      indicatorFocused: false,
    });
    const unfocused = buildShellFooter({
      width: 80,
      promptText: 'hello',
      promptLineCount: 1,
      usage: { up: 0, down: 0 },
      showExitNotice: false,
      lastCopyTime: 0,
      model: 'gpt-test',
      toolCount: 3,
      workingDir: '/tmp/demo',
      provider: 'openai',
      contextWindow: 0,
      runningAgentCount: 1,
      runningProcessCount: 0,
      indicatorFocused: true,
    });
    expect(lineToString(focused.lines[1])).toContain('›');
    expect(lineToString(unfocused.lines[1])).toContain('›');
    expect(focused.lines[1]![4]!.bg).toBe('#2a2a2a');
    expect(unfocused.lines[1]![4]!.bg).toBe('#1f2430');
    expect(lineToString(unfocused.lines[1])).not.toContain('█');
  });

  test('narrow terminal (width<=60) with long model id + provider + active alert produces no line exceeding the width', () => {
    const WIDTH = 60;
    const result = buildShellFooter({
      width: WIDTH,
      promptText: 'hello',
      promptLineCount: 1,
      usage: { up: 0, down: 0 },
      showExitNotice: false,
      lastCopyTime: 0,
      model: 'claude-opus-4-5-20251101-thinking-extended',
      toolCount: 3,
      workingDir: '/home/user/some/very/long/working/directory/path',
      provider: 'anthropic',
      contextWindow: 200000,
      lastInputTokens: 5000,
      runningAgentCount: 1,
      runningProcessCount: 0,
      indicatorFocused: false,
      composerMode: 'shell',
      composerStatus: 'preflight',
      composerFlags: ['approval'],
      composerPendingRisk: 'approval-wait',
    });
    for (const line of result.lines) {
      expect(line.length).toBeLessThanOrEqual(WIDTH);
    }
  });

  test('dangerMode and powerNote render simultaneously — neither suppresses the other', () => {
    const result = buildShellFooter({
      width: 100,
      promptText: 'hello',
      promptLineCount: 1,
      usage: { up: 0, down: 0 },
      showExitNotice: false,
      lastCopyTime: 0,
      model: 'gpt-test',
      toolCount: 3,
      workingDir: '/tmp/demo',
      provider: 'openai',
      contextWindow: 0,
      runningAgentCount: 0,
      runningProcessCount: 0,
      indicatorFocused: false,
      dangerMode: true,
      powerNote: 'sleep disabled',
    });
    const text = result.lines.map(lineToString).join('\n');
    expect(text).toContain('auto-approve');
    expect(text).toContain('sleep disabled');
  });

  test('dangerMode alone still renders the auto-approve notice', () => {
    const result = buildShellFooter({
      width: 100,
      promptText: 'hello',
      promptLineCount: 1,
      usage: { up: 0, down: 0 },
      showExitNotice: false,
      lastCopyTime: 0,
      model: 'gpt-test',
      toolCount: 3,
      workingDir: '/tmp/demo',
      provider: 'openai',
      contextWindow: 0,
      runningAgentCount: 0,
      runningProcessCount: 0,
      indicatorFocused: false,
      dangerMode: true,
    });
    const text = result.lines.map(lineToString).join('\n');
    expect(text).toContain('auto-approve');
  });

  test('powerNote alone still renders the sleep/power notice', () => {
    const result = buildShellFooter({
      width: 100,
      promptText: 'hello',
      promptLineCount: 1,
      usage: { up: 0, down: 0 },
      showExitNotice: false,
      lastCopyTime: 0,
      model: 'gpt-test',
      toolCount: 3,
      workingDir: '/tmp/demo',
      provider: 'openai',
      contextWindow: 0,
      runningAgentCount: 0,
      runningProcessCount: 0,
      indicatorFocused: false,
      powerNote: 'sleep disabled',
    });
    const text = result.lines.map(lineToString).join('\n');
    expect(text).toContain('sleep disabled');
  });

  test('dangerMode and powerNote both active at a narrow width: no line exceeds width and both notices still appear', () => {
    const WIDTH = 44;
    const result = buildShellFooter({
      width: WIDTH,
      promptText: 'hello',
      promptLineCount: 1,
      usage: { up: 0, down: 0 },
      showExitNotice: false,
      lastCopyTime: 0,
      model: 'gpt-test',
      toolCount: 3,
      workingDir: '/tmp/demo',
      provider: 'openai',
      contextWindow: 0,
      runningAgentCount: 0,
      runningProcessCount: 0,
      indicatorFocused: false,
      dangerMode: true,
      powerNote: 'sleep disabled',
    });
    for (const line of result.lines) {
      expect(line.length).toBeLessThanOrEqual(WIDTH);
    }
    const text = result.lines.map(lineToString).join('\n');
    expect(text).toContain('⚠');
    expect(text).toContain('⚡');
  });

  test('the transient "copied" flash stays exclusive over dangerMode/powerNote', () => {
    const result = buildShellFooter({
      width: 100,
      promptText: 'hello',
      promptLineCount: 1,
      usage: { up: 0, down: 0 },
      showExitNotice: false,
      lastCopyTime: Date.now(),
      model: 'gpt-test',
      toolCount: 3,
      workingDir: '/tmp/demo',
      provider: 'openai',
      contextWindow: 0,
      runningAgentCount: 0,
      runningProcessCount: 0,
      indicatorFocused: false,
      dangerMode: true,
      powerNote: 'sleep disabled',
    });
    const text = result.lines.map(lineToString).join('\n');
    expect(text).toContain('copied');
  });

  test('prompt box borders match the inactive prompt fill when the indicator is focused', () => {
    const result = buildShellFooter({
      width: 80,
      promptText: 'hello',
      promptLineCount: 1,
      usage: { up: 0, down: 0 },
      showExitNotice: false,
      lastCopyTime: 0,
      model: 'gpt-test',
      toolCount: 3,
      workingDir: '/tmp/demo',
      provider: 'openai',
      contextWindow: 0,
      runningAgentCount: 1,
      runningProcessCount: 0,
      indicatorFocused: true,
    });
    const topBorderCells = result.lines[0]!.filter((cell) => cell.char === '▄');
    const bottomBorderCells = result.lines[2]!.filter((cell) => cell.char === '▀');

    expect(topBorderCells.length).toBeGreaterThan(0);
    expect(bottomBorderCells.length).toBeGreaterThan(0);
    expect(topBorderCells.map((cell) => cell.fg)).toEqual(Array(topBorderCells.length).fill('#1f2430'));
    expect(bottomBorderCells.map((cell) => cell.fg)).toEqual(Array(bottomBorderCells.length).fill('#1f2430'));
  });
});
