#!/usr/bin/env bun
/**
 * coverage-gate.ts — aggregate coverage enforcement (ratchet).
 *
 * Ported from the TUI's scripts/coverage-gate.ts. Runs the whole suite in a
 * single process with `bun test --coverage src`, parses bun's text coverage
 * reporter, and fails when functions/lines coverage drops below the recorded
 * floors.
 *
 * Floors are a RATCHET: set just below the measured baseline, raised as coverage
 * improves, and never lowered without an explicit decision. They exist to catch
 * regressions, not to chase a percentage target.
 *
 * The Agent's `bun run test` (scripts/run-tests.ts) already runs the whole suite
 * in one process, so — unlike the TUI's per-file runner — there is no aggregation
 * gap; this script still runs its own coverage pass so the gate output is
 * self-contained and independent of the correctness run.
 *
 * NOTE (bun 1.3.x): bunfig.toml must not set `coverage = false` — that key
 * overrides the CLI --coverage flag, the run emits no coverage table, and the
 * gate fails unconditionally. The Agent's bunfig sets no coverage key.
 */
import { join } from 'node:path';

// Measured baseline 2026-07-04 (whole-suite, bun test --coverage src, SDK
// pinned at npm 0.38.0): Funcs 85.86%, Lines 83.83%. Floors set just below.
export const FUNCS_FLOOR = 84;
export const LINES_FLOOR = 82;

export interface CoverageSummary {
  funcsPct: number;
  linesPct: number;
}

/**
 * Parse the bun text coverage reporter output. The table ends with a row:
 *   All files          |   73.14 |   76.80 |
 * Column order is File | % Funcs | % Lines per the bun text reporter.
 */
export function parseCoverageSummary(output: string): CoverageSummary | null {
  // The nested bun process colorizes the table when FORCE_COLOR is present in
  // the environment (even empty), which breaks a plain startsWith match. Parse
  // color-blind so the gate does not depend on the caller's shell.
  const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
  for (const line of plain.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('All files')) continue;
    const cells = trimmed.split('|').map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const funcsPct = Number.parseFloat(cells[1] ?? '');
    const linesPct = Number.parseFloat(cells[2] ?? '');
    if (Number.isFinite(funcsPct) && Number.isFinite(linesPct)) {
      return { funcsPct, linesPct };
    }
  }
  return null;
}

/** Extract "N fail" from the bun run summary; null when absent. */
export function parseFailCount(output: string): number | null {
  const match = output.match(/^\s*(\d+)\s+fail\s*$/m);
  if (!match) return null;
  return Number.parseInt(match[1] ?? '', 10);
}

export interface GateResult {
  pass: boolean;
  lines: string[];
}

export function evaluateGate(output: string): GateResult {
  const lines: string[] = [];
  const summary = parseCoverageSummary(output);
  if (!summary) {
    return {
      pass: false,
      lines: ['coverage-gate: FAIL — no coverage table found in output (did the run crash before reporting?)'],
    };
  }
  const funcsOk = summary.funcsPct >= FUNCS_FLOOR;
  const linesOk = summary.linesPct >= LINES_FLOOR;
  lines.push(
    'coverage-gate: functions ' + summary.funcsPct.toFixed(2) + '% (floor ' + FUNCS_FLOOR + '%) — ' + (funcsOk ? 'OK' : 'BELOW FLOOR'),
    'coverage-gate: lines     ' + summary.linesPct.toFixed(2) + '% (floor ' + LINES_FLOOR + '%) — ' + (linesOk ? 'OK' : 'BELOW FLOOR'),
  );
  const failCount = parseFailCount(output);
  if (failCount !== null && failCount > 0) {
    lines.push(
      'coverage-gate: note — ' + failCount + ' test(s) failed in whole-suite (single-process) coverage mode.',
      'coverage-gate: correctness is gated by bun run test; single-process failures here indicate',
      'coverage-gate: cross-file interference debt, tracked separately.',
    );
  }
  const pass = funcsOk && linesOk;
  lines.push(pass ? 'coverage-gate: PASS' : 'coverage-gate: FAIL');
  return { pass, lines };
}

export interface RunGateOptions {
  /** Command to spawn; defaults to the whole-suite coverage run. */
  cmd?: string[];
  /** Working directory; defaults to process.cwd(). */
  cwd?: string;
}

/**
 * Spawn the coverage run, combine stdout+stderr, and evaluate the gate.
 * Exported (with an injectable command) so the spawn path itself is testable.
 */
export async function runCoverageGate(options: RunGateOptions = {}): Promise<GateResult> {
  const cwd = options.cwd ?? process.cwd();
  const cmd = options.cmd ?? ['bun', 'test', '--coverage', join(cwd, 'src')];
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  const result = evaluateGate(stdout + '\n' + stderr);
  if (!result.pass && parseCoverageSummary(stdout + '\n' + stderr) === null) {
    result.lines.push('coverage-gate: child exit code ' + exitCode);
  }
  return result;
}

async function main(): Promise<void> {
  const result = await runCoverageGate();
  for (const line of result.lines) {
    console.log(line);
  }
  process.exit(result.pass ? 0 : 1);
}

if (import.meta.main) {
  await main();
}
