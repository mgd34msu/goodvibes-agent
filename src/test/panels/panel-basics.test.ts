import { beforeEach, describe, expect, test } from 'bun:test';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { SessionMemoryStore } from '@pellux/goodvibes-sdk/platform/core';
import type { Orchestrator } from '../../core/orchestrator';
import { TokenBudgetPanel } from '../../panels/token-budget-panel.ts';
import type { Line } from '../../types/grid.ts';

function linesText(lines: Line[]): string {
  return lines
    .map((line) => line.map((cell) => cell.char ?? ' ').join(''))
    .join('\n');
}

interface TokenBudgetPanelOrchestratorMock {
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  lastInputTokens: number;
}

function asOrchestratorMock(mock: TokenBudgetPanelOrchestratorMock): Orchestrator {
  return mock as unknown as Orchestrator;
}

describe('TokenBudgetPanel', () => {
  let panel: TokenBudgetPanel;

  function makeOrchMock(overrides: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    lastInputTokens?: number;
  } = {}): TokenBudgetPanelOrchestratorMock {
    return {
      usage: {
        input: overrides.input ?? 0,
        output: overrides.output ?? 0,
        cacheRead: overrides.cacheRead ?? 0,
        cacheWrite: overrides.cacheWrite ?? 0,
      },
      lastInputTokens: overrides.lastInputTokens ?? 0,
    };
  }

  beforeEach(() => {
    panel = new TokenBudgetPanel(
      new SessionMemoryStore(),
      new ConfigManager({ surfaceRoot: 'agent', homeDir: '/tmp/goodvibes-agent-test', workingDir: '/tmp/goodvibes-agent-test' }),
    );
  });

  test('renders the Agent token budget workspace before wiring', () => {
    const lines = panel.render(80, 20);
    expect(lines).toHaveLength(20);
    expect(linesText(lines)).toContain('Token Budget');
    expect(linesText(lines)).toContain('No turns recorded');
  });

  test('renders wired usage totals and compact token formatting', () => {
    const orch = makeOrchMock({ input: 15_000, output: 800 });
    panel.wire(asOrchestratorMock(orch), () => 0);
    panel.onActivate();
    const text = linesText(panel.render(80, 25));
    expect(text).toContain('Session Totals');
    expect(text).toContain('15.0k');
  });

  test('renders context pressure when the context window is known', () => {
    const orch = makeOrchMock({ lastInputTokens: 92_000 });
    panel.wire(asOrchestratorMock(orch), () => 100_000);
    panel.onActivate();
    const text = linesText(panel.render(80, 30));
    expect(text).toContain('Context:');
    expect(text).toContain('CRITICAL');
  });
});
