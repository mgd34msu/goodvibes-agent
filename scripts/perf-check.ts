/**
 * perf-check.ts, CI performance budget gate.
 *
 * Runs the performance monitor against a committed release snapshot.
 * Outputs a formatted budget report and exits non-zero if any budget is
 * violated beyond its tolerance.
 *
 * Usage:
 *   bun run scripts/perf-check.ts
 *
 * Exit codes:
 *   0, all budgets passed
 *   1, one or more budgets exceeded tolerance
 */

import { DEFAULT_BUDGETS, PerfMonitor } from '@/runtime/index.ts';
import { formatReport, exitCode } from '@/runtime/index.ts';
import { createInitialSurfacePerfState } from '@/runtime/index.ts';
import type { PerfReport, PerfSnapshot } from '@/runtime/index.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RECORDED_PERF_SNAPSHOT_RELATIVE_PATH = 'release/performance-snapshot.json';
const REQUIRED_EXTRA_METRIC_NAMES = [
  'event.queue.depth',
  'tool.executor.overhead.p95',
  'compaction.latency.p95',
  'slo.turn_start.p95',
  'slo.cancel.p95',
  'slo.reconnect_recovery.p95',
  'slo.permission_decision.p95',
  'slo.integration.delivery_success_rate',
  'slo.integration.dlq_depth',
] as const;
const LOWER_BOUND_METRIC_NAMES = new Set<string>([
  'slo.integration.delivery_success_rate',
]);
const REPORT_COLUMNS = {
  metric: 40,
  actual: 16,
  budget: 16,
  status: 10,
} as const;

type RecordValue = Record<string, unknown>;
type SurfacePerfSnapshot = PerfSnapshot['surfacePerf'];
type RenderCycleSnapshot = SurfacePerfSnapshot['recentCycles'][number];
type InputLatencySnapshot = SurfacePerfSnapshot['recentInputLatency'][number];

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failSnapshot(message: string): never {
  throw new Error(`Invalid performance snapshot fixture ${RECORDED_PERF_SNAPSHOT_RELATIVE_PATH}: ${message}`);
}

function readRecord(value: unknown, label: string): RecordValue {
  if (!isRecord(value)) failSnapshot(`${label} must be an object.`);
  return value;
}

function readFiniteNumber(record: RecordValue, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    failSnapshot(`${label}.${key} must be a finite number.`);
  }
  return value;
}

function readOptionalFiniteNumber(record: RecordValue, key: string, label: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    failSnapshot(`${label}.${key} must be a finite number when present.`);
  }
  return value;
}

function readString(record: RecordValue, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    failSnapshot(`${label}.${key} must be a non-empty string.`);
  }
  return value;
}

function readBoolean(record: RecordValue, key: string, label: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') failSnapshot(`${label}.${key} must be a boolean.`);
  return value;
}

function readBudgetStatus(record: RecordValue): SurfacePerfSnapshot['budgetStatus'] {
  const value = readString(record, 'budgetStatus', 'surfacePerf');
  if (value !== 'ok' && value !== 'warning' && value !== 'critical') {
    failSnapshot('surfacePerf.budgetStatus must be ok, warning, or critical.');
  }
  return value;
}

function parseRenderCycles(value: unknown): RenderCycleSnapshot[] {
  if (!Array.isArray(value)) failSnapshot('surfacePerf.recentCycles must be an array.');
  if (value.length < 10) failSnapshot('surfacePerf.recentCycles must include at least 10 render samples.');
  return value.map((entry, index) => {
    const record = readRecord(entry, `surfacePerf.recentCycles[${index}]`);
    const label = `surfacePerf.recentCycles[${index}]`;
    return {
      cycleId: readFiniteNumber(record, 'cycleId', label),
      requestedAt: readFiniteNumber(record, 'requestedAt', label),
      completedAt: readFiniteNumber(record, 'completedAt', label),
      durationMs: readFiniteNumber(record, 'durationMs', label),
      overBudget: readBoolean(record, 'overBudget', label),
    };
  });
}

function parseInputLatency(value: unknown): InputLatencySnapshot[] {
  if (!Array.isArray(value)) failSnapshot('surfacePerf.recentInputLatency must be an array.');
  return value.map((entry, index) => {
    const record = readRecord(entry, `surfacePerf.recentInputLatency[${index}]`);
    const label = `surfacePerf.recentInputLatency[${index}]`;
    return {
      keyEventAt: readFiniteNumber(record, 'keyEventAt', label),
      respondedAt: readFiniteNumber(record, 'respondedAt', label),
      latencyMs: readFiniteNumber(record, 'latencyMs', label),
    };
  });
}

function parseExtraMetrics(value: unknown): Record<string, number> {
  const record = readRecord(value, 'extraMetrics');
  const extraMetrics: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      failSnapshot(`extraMetrics.${key} must be a finite number.`);
    }
    extraMetrics[key] = entry;
  }
  for (const metricName of REQUIRED_EXTRA_METRIC_NAMES) {
    if (!(metricName in extraMetrics)) {
      failSnapshot(`extraMetrics.${metricName} is required.`);
    }
  }
  return extraMetrics;
}

function parseSurfacePerf(value: unknown): SurfacePerfSnapshot {
  const record = readRecord(value, 'surfacePerf');
  const base = createInitialSurfacePerfState();
  const heapUsedBytes = readFiniteNumber(record, 'heapUsedBytes', 'surfacePerf');
  const rssBytes = readFiniteNumber(record, 'rssBytes', 'surfacePerf');
  if (heapUsedBytes <= 0) {
    failSnapshot('surfacePerf.heapUsedBytes must be a positive number (use realistic fixture values, not 0).');
  }
  if (rssBytes <= 0) {
    failSnapshot('surfacePerf.rssBytes must be a positive number (use realistic fixture values, not 0).');
  }
  return {
    ...base,
    revision: readFiniteNumber(record, 'revision', 'surfacePerf'),
    lastUpdatedAt: readFiniteNumber(record, 'lastUpdatedAt', 'surfacePerf'),
    source: readString(record, 'source', 'surfacePerf'),
    totalRenderCycles: readFiniteNumber(record, 'totalRenderCycles', 'surfacePerf'),
    avgRenderMs: readFiniteNumber(record, 'avgRenderMs', 'surfacePerf'),
    maxRenderMs: readFiniteNumber(record, 'maxRenderMs', 'surfacePerf'),
    overBudgetCount: readFiniteNumber(record, 'overBudgetCount', 'surfacePerf'),
    budgetStatus: readBudgetStatus(record),
    targetBudgetMs: readFiniteNumber(record, 'targetBudgetMs', 'surfacePerf'),
    recentCycles: parseRenderCycles(record.recentCycles),
    maxCycleBuffer: readFiniteNumber(record, 'maxCycleBuffer', 'surfacePerf'),
    avgInputLatencyMs: readFiniteNumber(record, 'avgInputLatencyMs', 'surfacePerf'),
    maxInputLatencyMs: readFiniteNumber(record, 'maxInputLatencyMs', 'surfacePerf'),
    recentInputLatency: parseInputLatency(record.recentInputLatency),
    heapUsedBytes,
    rssBytes,
    lastMemorySampleAt: readOptionalFiniteNumber(record, 'lastMemorySampleAt', 'surfacePerf'),
  };
}

function readCiPerfSnapshot(root: string): PerfSnapshot {
  const fixturePath = join(root, RECORDED_PERF_SNAPSHOT_RELATIVE_PATH);
  if (!existsSync(fixturePath)) {
    failSnapshot('file is missing.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(fixturePath, 'utf-8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failSnapshot(`JSON parse failed: ${message}`);
  }
  const record = readRecord(parsed, 'root');
  const surfacePerf = parseSurfacePerf(record.surfacePerf);
  const extraMetrics = parseExtraMetrics(record.extraMetrics);
  return { surfacePerf, extraMetrics };
}

/**
 * Builds a PerfSnapshot for use in CI from release evidence.
 */
function buildCiSnapshot(root = process.cwd()): PerfSnapshot {
  return readCiPerfSnapshot(root);
}

function padColumn(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + ' '.repeat(width - value.length);
}

function formatMetricValue(value: number, unit: string): string {
  if (unit === 'bytes') return `${(value / (1024 * 1024)).toFixed(1)} MiB/hr`;
  if (unit === 'ms') return `${value.toFixed(2)} ms`;
  if (unit === 'percent') return `${value.toFixed(1)}%`;
  return `${value}`;
}

function formatAgentPerfReport(report: PerfReport): string {
  const sdkReport = formatReport(report);
  if (!sdkReport.includes('Infinity')) return sdkReport;

  const budgetsByMetric = new Map(DEFAULT_BUDGETS.map((budget) => [budget.metric, budget]));
  const violatedMetrics = new Set(report.violations.map((violation) => violation.budget.metric));
  const horizontalRule = '-'.repeat(REPORT_COLUMNS.metric + REPORT_COLUMNS.actual + REPORT_COLUMNS.budget + REPORT_COLUMNS.status + 9);
  const lines = [
    '',
    'Performance Budget Evaluation (Committed Fixture)',
    new Date(report.timestamp).toISOString(),
    horizontalRule,
    [
      padColumn('Metric', REPORT_COLUMNS.metric),
      padColumn('Actual', REPORT_COLUMNS.actual),
      padColumn('Budget', REPORT_COLUMNS.budget),
      padColumn('Status', REPORT_COLUMNS.status),
    ].join(' | '),
    horizontalRule,
  ];

  for (const metric of report.metrics) {
    const budget = budgetsByMetric.get(metric.name);
    const unit = budget?.unit ?? metric.unit;
    lines.push([
      padColumn(metric.name, REPORT_COLUMNS.metric),
      padColumn(formatMetricValue(metric.value, unit), REPORT_COLUMNS.actual),
      padColumn(budget ? formatMetricValue(budget.threshold, unit) : 'missing', REPORT_COLUMNS.budget),
      padColumn(violatedMetrics.has(metric.name) ? 'FAIL' : 'ok', REPORT_COLUMNS.status),
    ].join(' | '));
  }

  lines.push(horizontalRule);
  lines.push(report.passed
    ? 'Result: PASSED - all budgets within tolerance'
    : `Result: FAILED - ${report.violations.length} budget(s) exceeded tolerance`);
  lines.push('');
  return lines.join('\n');
}

export function applyAgentPerfBudgetPolicy(report: PerfReport): PerfReport {
  const budgetsByMetric = new Map(DEFAULT_BUDGETS.map((budget) => [budget.metric, budget]));
  const existingViolationMetrics = new Set(report.violations.map((violation) => violation.budget.metric));
  const directionalViolations = report.metrics
    .filter((metric) => LOWER_BOUND_METRIC_NAMES.has(metric.name))
    .flatMap((metric) => {
      if (existingViolationMetrics.has(metric.name)) return [];
      const budget = budgetsByMetric.get(metric.name);
      if (!budget || metric.value >= budget.threshold) return [];
      return [{
        budget,
        actual: metric.value,
        exceededBy: budget.threshold - metric.value,
        consecutiveViolations: budget.tolerance,
      }];
    });

  if (directionalViolations.length === 0) return report;
  return {
    ...report,
    violations: [...report.violations, ...directionalViolations],
    passed: false,
  };
}

/**
 * Main entry point.
 */
function main(): void {
  const monitor = new PerfMonitor();
  const snapshot = buildCiSnapshot();

  const report = monitor.evaluate(snapshot);
  const agentReport = applyAgentPerfBudgetPolicy(report);

  process.stdout.write(formatAgentPerfReport(agentReport));

  process.exit(exitCode(agentReport));
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
