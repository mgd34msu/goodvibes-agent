import { describe, expect, test } from 'bun:test';
import {
  buildOperatorCapabilityBenchmarkReport,
  filterOperatorCapabilities,
  OPERATOR_CAPABILITY_BENCHMARKS,
  renderOperatorCapabilityBenchmark,
} from '../../operator/capability-benchmark.ts';

describe('operator capability benchmark', () => {
  test('covers OpenClaw and Hermes competitor capability categories', () => {
    const report = buildOperatorCapabilityBenchmarkReport(new Date('2026-05-30T12:00:00.000Z'));

    expect(report.packageName).toBe('@pellux/goodvibes-agent');
    expect(report.generatedAt).toBe('2026-05-30T12:00:00.000Z');
    expect(report.benchmarkSources.some((source) => source.includes('openclaw'))).toBe(true);
    expect(report.benchmarkSources.some((source) => source.includes('hermes-agent'))).toBe(true);
    expect(report.capabilities.length).toBeGreaterThanOrEqual(10);
    expect(report.capabilities.some((capability) => capability.id === 'isolated-knowledge-wiki')).toBe(true);
    expect(report.capabilities.some((capability) => capability.id === 'automation-schedules')).toBe(true);
    expect(report.capabilities.some((capability) => capability.id === 'voice-media-canvas')).toBe(true);
  });

  test('renders Agent Knowledge boundary without default wiki or HomeGraph fallback', () => {
    const rendered = renderOperatorCapabilityBenchmark(OPERATOR_CAPABILITY_BENCHMARKS);

    expect(rendered).toContain('/api/goodvibes-agent/knowledge/*');
    expect(rendered).toContain('never falls back to default Knowledge/Wiki, HomeGraph, or Home Assistant routes');
    expect(rendered).toContain('OpenClaw/Hermes');
    expect(rendered).toContain('Explicit build/fix/review/code work is delegated');
  });

  test('filters capabilities by competitor and topic', () => {
    const hermes = filterOperatorCapabilities(OPERATOR_CAPABILITY_BENCHMARKS, 'hermes');
    const knowledge = filterOperatorCapabilities(OPERATOR_CAPABILITY_BENCHMARKS, 'knowledge');

    expect(hermes.length).toBeGreaterThan(0);
    expect(hermes.every((capability) => capability.competitors.includes('hermes'))).toBe(true);
    expect(knowledge.some((capability) => capability.id === 'isolated-knowledge-wiki')).toBe(true);
  });
});
