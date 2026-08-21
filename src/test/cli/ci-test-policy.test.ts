import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type PackageJson = {
  readonly scripts?: Record<string, string>;
};

const ROOT = resolve(import.meta.dir, '../../..');

function readProjectFile(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf-8');
}

/**
 * Gate names the `ci:gate` aggregate runs that branch CI is allowed to skip,
 * each mapped to the concrete reason. Empty means CI must run every one.
 */
const CI_GATE_EXEMPTIONS: Readonly<Record<string, string>> = {};

/** The script names a `&&`-chained aggregate script invokes via `bun run`. */
function gatesInAggregateScript(script: string): readonly string[] {
  return script
    .split('&&')
    .map((segment) => segment.trim())
    .flatMap((segment) => {
      const match = /^bun run ([\w:.-]+)$/.exec(segment);
      return match ? [match[1] as string] : [];
    });
}

/**
 * Whether a workflow actually invokes `bun run <gate>`. The trailing guard is
 * load-bearing: without it `bun run typecheck:test` would satisfy a search for
 * the `typecheck` gate, and the detector could never report that one missing.
 */
function workflowRunsGate(workflow: string, gate: string): boolean {
  const escaped = gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`bun run ${escaped}(?![\\w:.-])`).test(workflow);
}

/** Gates the aggregate script runs that the workflow does not, minus exemptions. */
function gatesMissingFromWorkflow(aggregateScript: string, workflow: string): readonly string[] {
  return gatesInAggregateScript(aggregateScript).filter(
    (gate) => CI_GATE_EXEMPTIONS[gate] === undefined && !workflowRunsGate(workflow, gate),
  );
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

describe('CI test execution policy', () => {
  test('release workflow does not rerun the full test suite', () => {
    const releaseWorkflow = readProjectFile('.github/workflows/release.yml');

    expect(countOccurrences(releaseWorkflow, 'run: bun run test')).toBe(0);
    expect(releaseWorkflow).not.toContain('bun test ');
    expect(releaseWorkflow).not.toContain('bun run eval:gate');
    expect(releaseWorkflow).not.toContain('Eval gate');
  });

  test('release validation is by-reference (reusable-release-verify), not a re-run', () => {
    const releaseWorkflow = readProjectFile('.github/workflows/release.yml');

    // The old hand-rolled 30-minute CI poll is gone; validation is verified by
    // reference against the push-CI run via the shared reusable workflow.
    expect(releaseWorkflow).not.toContain('Verify branch CI passed for release SHA');
    expect(releaseWorkflow).toContain('reusable-release-verify.yml');
    expect(releaseWorkflow).toContain('workflow: ci.yml');
    expect(releaseWorkflow).toContain('toolchain-source: registry');
  });

  test('branch CI does not add a second targeted test job', () => {
    const ciWorkflow = readProjectFile('.github/workflows/ci.yml');

    expect(countOccurrences(ciWorkflow, 'run: bun run test')).toBe(1);
    expect(ciWorkflow).not.toContain('eval-gate');
    expect(ciWorkflow).not.toContain('bun run eval:gate');
    expect(ciWorkflow).not.toContain('Run eval gate');
  });

  test('local aggregate CI gate does not repeat tests through eval gate', () => {
    const packageJson = JSON.parse(readProjectFile('package.json')) as PackageJson;
    const ciGate = packageJson.scripts?.['ci:gate'] ?? '';

    expect(countOccurrences(ciGate, 'bun run test')).toBe(1);
    expect(ciGate).not.toContain('bun run eval:gate');
  });

  test('repo does not keep a separate release test runner', () => {
    expect(existsSync(resolve(ROOT, 'scripts/release-gate.ts'))).toBe(false);
  });
});

describe('every gate in ci:gate is actually run by branch CI', () => {
  const packageJson = JSON.parse(readProjectFile('package.json')) as PackageJson;
  const ciGate = packageJson.scripts?.['ci:gate'] ?? '';
  const ciWorkflow = readProjectFile('.github/workflows/ci.yml');

  test('the aggregate script parses into a non-trivial gate list', () => {
    // Guard against the detector passing because it found nothing to check.
    const gates = gatesInAggregateScript(ciGate);
    expect(gates.length).toBeGreaterThanOrEqual(10);
    expect(gates).toContain('typecheck');
    expect(gates).toContain('typecheck:test');
    expect(gates).toContain('typecheck:tools');
    expect(gates).toContain('test');
  });

  test('ci.yml runs every ci:gate gate', () => {
    expect(gatesMissingFromWorkflow(ciGate, ciWorkflow)).toEqual([]);
  });

  test('the detector reports a gate the workflow omits', () => {
    // NO-proof: a workflow that skips typecheck:test, the exact hole this
    // repo shipped, where CI type-checked src only and never the test sources.
    const workflowMissingTestTypecheck = ciWorkflow.replace('run: bun run typecheck:test\n', '');
    expect(workflowMissingTestTypecheck).not.toBe(ciWorkflow);
    expect(gatesMissingFromWorkflow(ciGate, workflowMissingTestTypecheck)).toEqual(['typecheck:test']);
  });

  test('a prefix gate is not satisfied by a longer sibling gate name', () => {
    // NO-proof: `bun run typecheck:test` must NOT count as running `typecheck`.
    expect(workflowRunsGate('run: bun run typecheck:test', 'typecheck')).toBe(false);
    expect(workflowRunsGate('run: bun run typecheck:test', 'typecheck:test')).toBe(true);
    expect(workflowRunsGate('run: bun run typecheck\n', 'typecheck')).toBe(true);
    expect(
      gatesMissingFromWorkflow('bun run typecheck && bun run test', 'run: bun run typecheck:test'),
    ).toEqual(['typecheck', 'test']);
  });

  test('an empty workflow reports every gate missing', () => {
    // NO-proof: the detector is not silently short-circuiting to "all present".
    const gates = gatesInAggregateScript(ciGate);
    expect(gatesMissingFromWorkflow(ciGate, '')).toEqual([...gates]);
  });
});
