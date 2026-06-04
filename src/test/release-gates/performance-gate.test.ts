/**
 * Performance Gate — Release Gate 3
 *
 * Verifies that:
 * - SLO budget definitions exist for all key metrics
 * - Compaction quality scoring produces valid scores with auto-correction signals
 * - Budget enforcement config is present and correct
 * - SLO thresholds are within acceptable operational ranges
 * - Eval harness can run benchmark suites
 */

import { describe, test, expect } from 'bun:test';
import { DEFAULT_BUDGETS } from '@/runtime/index.ts';
import {
  computeQualityScore,
  escalateStrategy,
  LOW_QUALITY_THRESHOLD,
} from '@/runtime/index.ts';
import { SloCollector } from '@/runtime/index.ts';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { FEATURE_FLAGS } from '@/runtime/index.ts';
import { applyAgentPerfBudgetPolicy } from '../../../scripts/perf-check.ts';
import type { ProviderMessage } from '@pellux/goodvibes-sdk/platform/providers';
import type { PerfReport } from '@/runtime/index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findBudget(metric: string) {
  return DEFAULT_BUDGETS.find(b => b.metric === metric);
}

function requiredBudget(metric: string) {
  const budget = findBudget(metric);
  if (!budget) throw new Error(`missing release performance budget: ${metric}`);
  return budget;
}

function makeCompactionInput(messageCount: number, tokenCount: number) {
  const messages: ProviderMessage[] = [];
  for (let i = 0; i < messageCount; i++) {
    if (i % 2 === 0) {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: `Message ${i}: Some meaningful content about the task being performed.` }],
      });
    } else {
      messages.push({
        role: 'assistant',
        content: `Message ${i}: Some meaningful content about the task being performed.`,
      });
    }
  }
  return {
    sessionId: 'test-session',
    messages,
    tokensBefore: tokenCount,
    contextWindow: 128_000,
    strategy: 'collapse' as const,
  };
}

function makeCompactionOutput(messageCount: number, tokenCount: number, includeHandoff = true) {
  const messages: ProviderMessage[] = [];
  for (let i = 0; i < messageCount; i++) {
    if (i % 2 === 0) {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: includeHandoff && i === 0 ? '[Session compaction] Summary of prior work.' : `Msg ${i}` }],
      });
    } else {
      messages.push({
        role: 'assistant',
        content: includeHandoff && i === 0 ? '[Session compaction] Summary of prior work.' : `Msg ${i}`,
      });
    }
  }
  return {
    messages,
    tokensAfter: tokenCount,
    summary: includeHandoff ? 'Compacted with handoff summary.' : 'Compacted.',
    durationMs: 12,
    warnings: [],
    strategy: 'collapse' as const,
  };
}

// ---------------------------------------------------------------------------
// 1. Budget definitions: all required SLO gates exist
// ---------------------------------------------------------------------------

describe('performance gate: budget definitions', () => {
  test('all budget entries have required fields', () => {
    for (const budget of DEFAULT_BUDGETS) {
      expect(typeof budget.name).toBe('string');
      expect(typeof budget.metric).toBe('string');
      expect(typeof budget.threshold).toBe('number');
      expect(typeof budget.unit).toBe('string');
      expect(typeof budget.tolerance).toBe('number');
      expect(budget.threshold).toBeGreaterThan(0);
      expect(budget.tolerance).toBeGreaterThan(0);
    }
  });

  test('frame render latency budget exists (p95 ≤ 16ms)', () => {
    const budget = requiredBudget('frame.render.p95');
    expect(budget.threshold).toBeLessThanOrEqual(16);
    expect(budget.unit).toBe('ms');
  });

  test('tool executor overhead budget exists (p95 ≤ 5ms)', () => {
    const budget = requiredBudget('tool.executor.overhead.p95');
    expect(budget.threshold).toBeLessThanOrEqual(5);
  });

  test('compaction latency budget exists (p95 ≤ 500ms)', () => {
    const budget = requiredBudget('compaction.latency.p95');
    expect(budget.threshold).toBeLessThanOrEqual(500);
  });

  test('SLO: turn start latency budget exists (p95 ≤ 2000ms)', () => {
    const budget = requiredBudget('slo.turn_start.p95');
    expect(budget.threshold).toBeLessThanOrEqual(2000);
  });

  test('SLO: cancel latency budget exists (p95 ≤ 500ms)', () => {
    const budget = requiredBudget('slo.cancel.p95');
    expect(budget.threshold).toBeLessThanOrEqual(500);
  });

  test('SLO: reconnect recovery budget exists (p95 ≤ 10000ms)', () => {
    const budget = requiredBudget('slo.reconnect_recovery.p95');
    expect(budget.threshold).toBeLessThanOrEqual(10000);
  });

  test('SLO: permission decision budget exists (p95 ≤ 100ms)', () => {
    const budget = requiredBudget('slo.permission_decision.p95');
    expect(budget.threshold).toBeLessThanOrEqual(100);
  });

  test('memory growth budget exists', () => {
    const budget = requiredBudget('memory.growth.bytes_per_hour');
    expect(budget.unit).toBe('bytes');
  });

  test('Agent perf gate treats integration delivery success rate as a lower-bound budget', () => {
    const report: PerfReport = {
      timestamp: 1780491600000,
      metrics: [{
        name: 'slo.integration.delivery_success_rate',
        value: 94,
        unit: 'percent',
        timestamp: 1780491600000,
      }],
      violations: [],
      passed: true,
    };

    const enforced = applyAgentPerfBudgetPolicy(report);

    expect(enforced.passed).toBe(false);
    expect(enforced.violations).toHaveLength(1);
    expect(enforced.violations[0]?.budget.metric).toBe('slo.integration.delivery_success_rate');
    expect(enforced.violations[0]?.actual).toBe(94);
    expect(enforced.violations[0]?.exceededBy).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Compaction quality scoring: auto-corrects on low quality
// ---------------------------------------------------------------------------

describe('performance gate: compaction quality scoring', () => {
  test('computeQualityScore returns valid score structure', () => {
    const input = makeCompactionInput(20, 4000);
    const output = makeCompactionOutput(5, 800);
    const score = computeQualityScore(input, output);

    expect(typeof score.score).toBe('number');
    expect(typeof score.grade).toBe('string');
    expect(typeof score.isLowQuality).toBe('boolean');
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(1);
  });

  test('score grade is one of A/B/C/D/F', () => {
    const input = makeCompactionInput(10, 2000);
    const output = makeCompactionOutput(3, 600);
    const score = computeQualityScore(input, output);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(score.grade);
  });

  test('isLowQuality flags scores below LOW_QUALITY_THRESHOLD', () => {
    expect(LOW_QUALITY_THRESHOLD).toBe(0.4);
    // Pathological: output larger than input = no compression, low quality
    const input = makeCompactionInput(3, 100);
    const output = makeCompactionOutput(10, 500, false); // no handoff, more tokens
    const score = computeQualityScore(input, output);
    // Score with no compression and no signals should be low
    expect(score.score).toBeLessThan(LOW_QUALITY_THRESHOLD);
    expect(score.isLowQuality).toBe(true);
  });

  test('escalateStrategy returns a valid compaction strategy', () => {
    const escalated = escalateStrategy('collapse');
    expect(typeof escalated).toBe('string');
    expect(escalated.length).toBeGreaterThan(0);
  });

  test('escalateStrategy from microcompact escalates', () => {
    const escalated = escalateStrategy('microcompact');
    expect(escalated).toBe('autocompact');
  });

  test('score has compression and retention sub-scores', () => {
    const input = makeCompactionInput(20, 4000);
    const output = makeCompactionOutput(5, 800);
    const score = computeQualityScore(input, output);
    expect(typeof score.compressionScore).toBe('number');
    expect(typeof score.retentionScore).toBe('number');
    expect(typeof score.compressionRatio).toBe('number');
    expect(score.compressionScore).toBeGreaterThanOrEqual(0);
    expect(score.retentionScore).toBeGreaterThanOrEqual(0);
  });

  test('score has semantic retention signals', () => {
    const input = makeCompactionInput(10, 2000);
    const output = makeCompactionOutput(3, 600);
    const score = computeQualityScore(input, output);
    expect(typeof score.signals.hasHandoff).toBe('boolean');
    expect(typeof score.signals.hasNonTrivialContent).toBe('boolean');
    expect(typeof score.signals.messageCountSane).toBe('boolean');
    expect(typeof score.signals.positiveTokenCount).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// 3. SLO Collector: metric collection infrastructure
// ---------------------------------------------------------------------------

describe('performance gate: SLO collector', () => {
  test('getMetrics returns the release SLO metric set before samples are recorded', () => {
    const bus = new RuntimeEventBus();
    const collector = new SloCollector(bus);
    const metrics = collector.getMetrics();
    expect(metrics.map((metric) => metric.name).sort()).toEqual([
      'slo.cancel.p95',
      'slo.permission_decision.p95',
      'slo.reconnect_recovery.p95',
      'slo.turn_start.p95',
    ]);
    expect(metrics.map((metric) => ({
      name: metric.name,
      value: metric.value,
      unit: metric.unit,
    })).sort((left, right) => left.name.localeCompare(right.name))).toEqual([
      { name: 'slo.cancel.p95', value: 0, unit: 'ms' },
      { name: 'slo.permission_decision.p95', value: 0, unit: 'ms' },
      { name: 'slo.reconnect_recovery.p95', value: 0, unit: 'ms' },
      { name: 'slo.turn_start.p95', value: 0, unit: 'ms' },
    ]);
    collector.dispose();
  });

  test('getSampleCounts returns zero-count release SLO buckets before samples are recorded', () => {
    const bus = new RuntimeEventBus();
    const collector = new SloCollector(bus);
    const counts = collector.getSampleCounts();
    expect(counts).toEqual({
      'slo.turn_start.p95': 0,
      'slo.cancel.p95': 0,
      'slo.reconnect_recovery.p95': 0,
      'slo.permission_decision.p95': 0,
    });
    collector.dispose();
  });

  test('dispose does not throw', () => {
    const bus = new RuntimeEventBus();
    const collector = new SloCollector(bus);
    expect(() => collector.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. Budget enforcement feature flag exists
// ---------------------------------------------------------------------------

describe('performance gate: budget enforcement flag', () => {
  test('runtime-tools-budget-enforcement feature flag is declared', () => {
    const flag = FEATURE_FLAGS.find(f => f.id === 'runtime-tools-budget-enforcement');
    expect(flag).toMatchObject({
      defaultState: 'disabled',
      runtimeToggleable: true,
      tier: 8,
    });
  });

  test('compaction feature flags are declared', () => {
    const compactionFlag = FEATURE_FLAGS.find(f => f.id === 'session-compaction');
    expect(compactionFlag).toMatchObject({
      defaultState: 'disabled',
      runtimeToggleable: true,
      tier: 6,
    });
  });
});
