#!/usr/bin/env bun
/**
 * coverage-gate.ts — aggregate coverage enforcement (ratchet).
 *
 * The coverage-table parsing and floor decision now live in the shared
 * @pellux/goodvibes-toolchain `coverage-gate` (one implementation across
 * tui/agent). This file is a thin adapter: it loads the Agent's floors + coverage
 * command from toolchain.config.json, spawns the whole-suite coverage pass, and
 * delegates parsing/evaluation to the toolchain, formatting the Agent's existing
 * {pass, lines} output surface.
 *
 * Floors are a RATCHET (toolchain.config.json coverage.funcsFloor / linesFloor):
 * set just below the measured baseline, raised as coverage improves, never
 * lowered without an explicit decision. They catch regressions, not a percentage.
 *
 * NOTE (bun 1.3.x): bunfig.toml must not set `coverage = false` — that key
 * overrides the CLI --coverage flag, the run emits no coverage table, and the
 * gate fails unconditionally. The Agent's bunfig sets no coverage key.
 */
import {
  evaluateCoverageGate,
  loadToolchainConfig,
  parseCoverageSummary as parseToolchainCoverageSummary,
  type CoverageConfig,
  type CoverageSummary as ToolchainCoverageSummary,
} from '@pellux/goodvibes-toolchain';
import { sweepStaleRealTmpDirs } from './stale-tmp-sweep.ts';

function coverageConfig(cwd: string = process.cwd()): CoverageConfig {
  const coverage = loadToolchainConfig(cwd).coverage;
  if (!coverage) throw new Error('toolchain.config.json is missing a `coverage` section');
  return coverage;
}

const COVERAGE = coverageConfig();

export const FUNCS_FLOOR = COVERAGE.funcsFloor;
export const LINES_FLOOR = COVERAGE.linesFloor;

export type CoverageSummary = ToolchainCoverageSummary;

/** Parse the bun text coverage reporter output (delegated to the toolchain). */
export const parseCoverageSummary = parseToolchainCoverageSummary;

/** Extract "N fail" from the bun run summary; null when absent. */
export function parseFailCount(output: string): number | null {
  const match = output.replace(/\x1b\[[0-9;]*m/g, '').match(/^\s*(\d+)\s+fail\s*$/m);
  if (!match) return null;
  return Number.parseInt(match[1] ?? '', 10);
}

export interface GateResult {
  pass: boolean;
  lines: string[];
}

export function evaluateGate(output: string): GateResult {
  const result = evaluateCoverageGate(output, COVERAGE);
  if (!result.summary) {
    return {
      pass: false,
      lines: ['coverage-gate: FAIL — no coverage table found in output (did the run crash before reporting?)'],
    };
  }
  const funcsOk = result.summary.funcsPct >= FUNCS_FLOOR;
  const linesOk = result.summary.linesPct >= LINES_FLOOR;
  const lines: string[] = [
    'coverage-gate: functions ' + result.summary.funcsPct.toFixed(2) + '% (floor ' + FUNCS_FLOOR + '%) — ' + (funcsOk ? 'OK' : 'BELOW FLOOR'),
    'coverage-gate: lines     ' + result.summary.linesPct.toFixed(2) + '% (floor ' + LINES_FLOOR + '%) — ' + (linesOk ? 'OK' : 'BELOW FLOOR'),
  ];
  if (result.failCount > 0) {
    lines.push(
      'coverage-gate: note — ' + result.failCount + ' test(s) failed in whole-suite (single-process) coverage mode.',
      'coverage-gate: correctness is gated by bun run test; single-process failures here indicate',
      'coverage-gate: cross-file interference debt, tracked separately.',
    );
  }
  lines.push(result.ok ? 'coverage-gate: PASS' : 'coverage-gate: FAIL');
  return { pass: result.ok, lines };
}

export interface RunGateOptions {
  /** Command to spawn; defaults to the Agent's configured whole-suite coverage run. */
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
  const cmd = options.cmd ?? [...COVERAGE.command];
  // `bun run test` (scripts/run-tests.ts) sweeps this project's own stale
  // real-os.tmpdir() entries before and after every run. This gate spawns a
  // second, separate whole-suite `bun test --coverage` process directly and
  // is invoked on its own (`bun run coverage:gate`, and from ci:gate), so a
  // stale-entry sweep here is not optional — it's the only sweep this entry
  // point gets. See scripts/stale-tmp-sweep.ts for the prefix list and the
  // one-hour age gate that makes this safe to run unconditionally, even
  // alongside another repo's own test run sharing the same real /tmp.
  const swept = sweepStaleRealTmpDirs();
  if (swept.swept.length > 0) {
    console.log(`coverage-gate: tmp-sweep removed ${swept.swept.length} stale director${swept.swept.length === 1 ? 'y' : 'ies'} from os.tmpdir() (scanned ${swept.scanned} entries).`);
  }
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  // Sweep again after this run too (mirrors run-tests.ts's before-and-after
  // pattern) — this coverage pass doesn't redirect TMPDIR the way
  // run-tests.ts does, so the two tests that legitimately still write under
  // real os.tmpdir() (see KNOWN_TMPDIR_PREFIXES) create their entries there
  // during THIS run; no need to wait for the next invocation to reclaim them.
  const sweptAfter = sweepStaleRealTmpDirs();
  if (sweptAfter.swept.length > 0) {
    console.log(`coverage-gate: tmp-sweep removed ${sweptAfter.swept.length} stale director${sweptAfter.swept.length === 1 ? 'y' : 'ies'} from os.tmpdir() (scanned ${sweptAfter.scanned} entries).`);
  }
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
