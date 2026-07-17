// ---------------------------------------------------------------------------
// workflow-shape.test.ts
//
// Local proof (CI cannot run without pushing) that the hand-authored workflow
// YAML is well-formed after the shared CI/CD adoption: SHA-pinned action refs,
// no continue-on-error on any job/step, timeouts on executing jobs, and the
// by-reference release wiring onto the shared reusable workflows. Ports the
// workflow-shape approach from the SDK repo.
// ---------------------------------------------------------------------------

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const WF_DIR = resolve(ROOT, '.github/workflows');

type Job = Record<string, unknown> & {
  needs?: string | string[];
  'runs-on'?: string;
  'timeout-minutes'?: number;
  uses?: string;
  steps?: Array<Record<string, unknown>>;
  concurrency?: Record<string, unknown>;
};
type Workflow = { on?: unknown; jobs?: Record<string, Job>; concurrency?: Record<string, unknown> };

function load(name: string): Workflow {
  return Bun.YAML.parse(readFileSync(resolve(WF_DIR, name), 'utf8')) as Workflow;
}
function jobs(wf: Workflow): [string, Job][] {
  return Object.entries(wf.jobs ?? {});
}
function needsOf(job: Job): string[] {
  return Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];
}
function steps(job: Job): Array<Record<string, unknown>> {
  return job.steps ?? [];
}

describe('all workflows: baseline hygiene', () => {
  const files = readdirSync(WF_DIR).filter((f) => f.endsWith('.yml'));

  test('no job or step uses continue-on-error: true', () => {
    for (const f of files) {
      const wf = load(f);
      for (const [, job] of jobs(wf)) {
        expect(job['continue-on-error']).not.toBe(true);
        for (const step of steps(job)) {
          expect(step['continue-on-error']).not.toBe(true);
        }
      }
    }
  });

  test('every executing job (not a reusable-workflow call) declares a timeout', () => {
    for (const f of files) {
      const wf = load(f);
      for (const [name, job] of jobs(wf)) {
        if (job.uses) continue; // a reusable-workflow call has no runs-on/timeout of its own
        expect(job['timeout-minutes'], `${f}:${name} needs timeout-minutes`).toBeGreaterThan(0);
      }
    }
  });

  test('all uses: references are SHA-pinned, @main reusables, or local paths', () => {
    for (const f of files) {
      const wf = load(f);
      for (const [, job] of jobs(wf)) {
        const refs: string[] = [];
        if (typeof job.uses === 'string') refs.push(job.uses);
        for (const step of steps(job)) if (typeof step.uses === 'string') refs.push(step.uses);
        for (const ref of refs) {
          const ok = ref.startsWith('./') || /@[0-9a-f]{40}$/.test(ref) || /@(main|v\d)/.test(ref);
          expect(ok, `unpinned action ref: ${ref} in ${f}`).toBe(true);
        }
      }
    }
  });
});

describe('ci.yml: single-job gate on the shared setup', () => {
  const ci = load('ci.yml');

  test('has the single test gate job and uses the composite setup action', () => {
    const names = jobs(ci).map(([n]) => n);
    expect(names).toContain('test');
    const setup = steps(ci.jobs!['test']!).some((s) => String(s.uses ?? '') === './.github/actions/setup');
    expect(setup).toBe(true);
  });

  test('cancel-in-progress is PR-only (a push run on main is never auto-cancelled)', () => {
    expect(String(ci.concurrency?.['cancel-in-progress'])).toContain("github.event_name == 'pull_request'");
  });
});

describe('release.yml: by-reference release on the shared reusables', () => {
  const rel = load('release.yml');
  const raw = readFileSync(resolve(WF_DIR, 'release.yml'), 'utf8');

  test('the hand-rolled validate-release poll is gone', () => {
    expect(Object.keys(rel.jobs ?? {})).not.toContain('validate-release');
    expect(raw).not.toContain('Verify branch CI passed for release SHA');
  });

  test('release-verify calls the reusable by-reference workflow after the tag/version check', () => {
    const rv = rel.jobs!['release-verify']!;
    expect(rv.uses).toContain('reusable-release-verify.yml');
    expect(needsOf(rv)).toContain('verify-tag-version');
    const withBlock = (rv as Job & { with?: Record<string, unknown> }).with ?? {};
    expect(withBlock['workflow']).toBe('ci.yml');
    // The Agent is a consumer of the SDK's toolchain — it bunx-es the published
    // package (registry), never the workspace self-host mode.
    expect(withBlock['toolchain-source']).toBe('registry');
  });

  test('caller jobs grant the permissions the called reusable workflows request', () => {
    // GitHub validates this at workflow startup: a called workflow's job may
    // only use permissions the caller job grants; an under-granting caller is
    // rejected with startup_failure and jobs: [] before anything runs (this
    // killed the SDK's v1.11.0 release run). The reusables' requested
    // permissions are their documented contract: release-verify reads run/job
    // conclusions (actions+checks read), gh-release creates the release
    // (contents write), npm-publish mints provenance (id-token write).
    const contract: Record<string, Record<string, string>> = {
      'release-verify': { actions: 'read', checks: 'read' },
      'github-release': { contents: 'write' },
      'publish-npm': { 'id-token': 'write' },
    };
    for (const [jobName, required] of Object.entries(contract)) {
      const job = rel.jobs![jobName]! as Job & { permissions?: Record<string, string> };
      for (const [scope, level] of Object.entries(required)) {
        expect(job.permissions?.[scope], `${jobName} must grant ${scope}: ${level}`).toBe(level);
      }
    }
  });

  test('consumes every shared reusable workflow (one implementation per concern)', () => {
    for (const reusable of [
      'reusable-release-verify.yml',
      'reusable-binary-matrix.yml',
      'reusable-gh-release.yml',
      'reusable-npm-publish.yml',
    ]) {
      expect(raw).toContain(reusable);
    }
  });

  test('binaries + github-release + publish-npm are reusable-workflow calls that gate on release-verify', () => {
    expect(rel.jobs!['binaries']!.uses).toContain('reusable-binary-matrix.yml');
    expect(needsOf(rel.jobs!['binaries']!)).toContain('release-verify');
    expect(rel.jobs!['github-release']!.uses).toContain('reusable-gh-release.yml');
    expect(rel.jobs!['publish-npm']!.uses).toContain('reusable-npm-publish.yml');
  });

  test('multi-path glob inputs are NEWLINE-separated (their sinks never split on spaces)', () => {
    // actions/upload-artifact `path:` (artifact-glob sink) and
    // softprops/action-gh-release `files:` (assets-glob sink) both split their
    // pattern input on newlines ONLY. A space-separated single line arrives as
    // one literal glob with embedded spaces, matches nothing, and the
    // if-no-files-found/fail_on_unmatched_files errors block the release.
    const globInputs: readonly [job: string, input: string, minPaths: number][] = [
      ['binaries', 'artifact-glob', 5],
      ['github-release', 'assets-glob', 9],
    ];
    for (const [jobName, inputName, minPaths] of globInputs) {
      const job = rel.jobs![jobName]! as Job & { with?: Record<string, unknown> };
      const glob = String(job.with?.[inputName] ?? '');
      expect(glob.length, `${jobName}.with.${inputName} must be set`).toBeGreaterThan(0);
      const lines = glob.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
      expect(lines.length, `${jobName}.with.${inputName} must carry one glob per line`).toBeGreaterThanOrEqual(minPaths);
      for (const line of lines) {
        expect(line, `${jobName}.with.${inputName} line "${line}" must be a single path (no internal whitespace)`).not.toMatch(/\s/);
      }
    }
  });

  test('every smoke leg names its own built artifact as the smoke binary', () => {
    const binaries = rel.jobs!['binaries']! as Job & { with?: Record<string, unknown> };
    const targets = JSON.parse(String(binaries.with?.['targets'] ?? '[]')) as Array<{
      key: string;
      smoke: boolean;
      binary?: string;
    }>;
    expect(targets.length).toBe(4);
    for (const target of targets) {
      if (!target.smoke) continue;
      // The matrix builds only dist/goodvibes-agent-<key-mapped> per leg; a
      // smoke leg without its own artifact path falls back to binaryDefault,
      // which is the linux-x64 artifact and does not exist on other runners.
      expect(target.binary, `smoke leg ${target.key} must carry its own binary`).toBeTruthy();
      expect(String(target.binary)).toStartWith('dist/goodvibes-agent-');
    }
    const darwinSmoke = targets.find((t) => t.key === 'darwin-arm64');
    expect(darwinSmoke?.binary).toBe('dist/goodvibes-agent-macos-arm64');
  });

  test('the exact release asset set is preserved (4 binaries + 4 addon archives + npm tgz)', () => {
    for (const binary of [
      'goodvibes-agent-linux-x64',
      'goodvibes-agent-linux-arm64',
      'goodvibes-agent-macos-x64',
      'goodvibes-agent-macos-arm64',
    ]) {
      // assembled upload + github-release glob
      expect(raw.split(binary).length - 1).toBeGreaterThanOrEqual(2);
    }
    for (const archive of [
      'sqlite-vec-linux-x64.tar.gz',
      'sqlite-vec-linux-arm64.tar.gz',
      'sqlite-vec-darwin-x64.tar.gz',
      'sqlite-vec-darwin-arm64.tar.gz',
    ]) {
      expect(raw.split(archive).length - 1).toBeGreaterThanOrEqual(2);
    }
    // The npm tarball rides the same assembled artifact + release glob.
    expect(raw).toContain('dist/*.tgz');
  });

  test('the registry install smoke against the published package is preserved', () => {
    const smoke = rel.jobs!['registry-install-smoke']!;
    expect(needsOf(smoke)).toContain('publish-npm');
    const text = JSON.stringify(steps(smoke));
    expect(text).toContain('bun add -g');
    expect(text).toContain('@pellux/goodvibes-agent@');
  });

  test('concurrency never cancels an in-progress release', () => {
    expect(rel.concurrency?.['cancel-in-progress']).toBe(false);
  });
});
