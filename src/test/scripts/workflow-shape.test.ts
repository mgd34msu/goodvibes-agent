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
function stepText(job: Job): string {
  return steps(job)
    .map((s) => `${String(s.name ?? '')}\n${String(s.run ?? '')}`)
    .join('\n');
}

describe('all workflows: baseline hygiene', () => {
  const files = readdirSync(WF_DIR).filter((f) => f.endsWith('.yml'));

  test('composite action metadata never references the vars context', () => {
    // GitHub template-evaluates the ENTIRE action manifest, including input
    // descriptions, and the vars context does not exist in composite actions.
    // A literal vars expression anywhere in the file fails every consuming job
    // at load time (this took down the TUI's v1.19.2 CI run).
    const raw = readFileSync(resolve(WF_DIR, '../actions/setup/action.yml'), 'utf8');
    expect(raw).not.toMatch(/\$\{\{\s*vars\./);
  });

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

describe('ci.yml: zero-touch auto-release', () => {
  const ci = load('ci.yml');

  test('auto-release needs EVERY other ci.yml job (only runs when all are green)', () => {
    const auto = ci.jobs!['auto-release']!;
    const needs = needsOf(auto);
    // The agent's CI is a single `test` gate; auto-release must need it so it is
    // scheduled last and only on a fully green run.
    expect(needs).toContain('test');
    // And its needs set is exactly the other jobs, no gate omitted, no self-need.
    const otherJobs = jobs(ci).map(([n]) => n).filter((n) => n !== 'auto-release');
    expect([...needs].sort()).toEqual([...otherJobs].sort());
  });

  test('auto-release is gated to pushes on main', () => {
    const cond = String(ci.jobs!['auto-release']!.if);
    expect(cond).toContain("github.ref == 'refs/heads/main'");
    expect(cond).toContain("github.event_name == 'push'");
  });

  test('auto-release grants contents:write and actions:write', () => {
    const perms = (ci.jobs!['auto-release']! as Job & { permissions?: Record<string, string> }).permissions ?? {};
    expect(perms.contents).toBe('write');
    expect(perms.actions).toBe('write');
  });

  test('auto-release checks tag existence BEFORE creating the tag (idempotent)', () => {
    const text = stepText(ci.jobs!['auto-release']!);
    const existenceCheck = text.indexOf('git ls-remote --tags origin');
    const tagCreate = text.indexOf('git tag -a');
    expect(existenceCheck).toBeGreaterThanOrEqual(0);
    expect(tagCreate).toBeGreaterThanOrEqual(0);
    // The idempotent existence check must precede tag creation.
    expect(existenceCheck).toBeLessThan(tagCreate);
  });

  test('auto-release dispatches release.yml with mode=release at the tag ref, not a bare tag push', () => {
    const text = stepText(ci.jobs!['auto-release']!);
    expect(text).toContain('gh workflow run release.yml');
    expect(text).toContain('mode=release');
    // The dispatch uses the tag ref so github.ref/github.sha point at the tag.
    expect(text).toContain('--ref');
    expect(text).toContain('refs/tags/');
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
    // The Agent is a consumer of the SDK's toolchain, it bunx-es the published
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
      ['github-release', 'assets-glob', 10],
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

  test('the exact release asset set is preserved (4 binaries + 4 addon archives + browser driver + npm tgz)', () => {
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
    // The browser driver archive rides both sinks too. 1.18.1 shipped without
    // it and every downloaded binary reported browser control as unavailable.
    expect(raw.split('browser-driver.tar.gz').length - 1).toBeGreaterThanOrEqual(2);
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

describe('release.yml: zero-touch release mode + runtime-bundled tarball publish lane', () => {
  const rel = load('release.yml');

  test('workflow_dispatch exposes a mode input defaulting to dry-run', () => {
    const inputs = (rel.on as { workflow_dispatch?: { inputs?: Record<string, { default?: string; type?: string; options?: string[] }> } })
      .workflow_dispatch?.inputs ?? {};
    expect(inputs.mode).toBeTruthy();
    expect(inputs.mode?.default).toBe('dry-run');
    expect(inputs.mode?.type).toBe('choice');
    expect(inputs.mode?.options).toEqual(expect.arrayContaining(['dry-run', 'release']));
  });

  test('every release job gates on a plain push AND accepts a release-mode dispatch', () => {
    // The tag-push path is preserved unchanged (pushing a v* tag by hand releases
    // exactly as before); the release-mode dispatch is the zero-touch path the
    // auto-release job drives. Both must satisfy each job's condition.
    for (const name of [
      'verify-tag-version',
      'release-verify',
      'pack',
      'binaries',
      'assemble-release-assets',
      'github-release',
      'publish-npm',
      'registry-install-smoke',
    ]) {
      const cond = String(rel.jobs![name]!.if);
      expect(cond, `${name} must still gate on a plain push`).toContain("github.event_name == 'push'");
      expect(cond, `${name} must also accept a release-mode dispatch`).toContain("inputs.mode == 'release'");
    }
  });

  test('the tag-ref-guarded jobs keep the refs/tags/v guard in both trigger paths', () => {
    // A release-mode dispatch runs at refs/tags/v<version>, so the existing
    // startsWith(github.ref, 'refs/tags/v') guard holds for the dispatch too.
    for (const name of ['github-release', 'publish-npm', 'registry-install-smoke']) {
      expect(String(rel.jobs![name]!.if)).toContain("startsWith(github.ref, 'refs/tags/v')");
    }
  });

  test('publish-npm publishes the STAGED pack tarball (tarball-artifact + --tarball command)', () => {
    const pub = rel.jobs!['publish-npm']! as Job & { with?: Record<string, unknown> };
    expect(pub.with?.['tarball-artifact']).toBe('npm-tarball');
    const cmd = String(pub.with?.['publish-command'] ?? '');
    expect(cmd).toContain('goodvibes-publish-package');
    expect(cmd).toContain('--tarball');
    expect(cmd).toContain('release-tarball/');
  });

  test('the tarball-artifact name matches exactly what the pack job uploads', () => {
    const upload = steps(rel.jobs!['pack']!).find((s) => String(s.uses ?? '').includes('upload-artifact'));
    expect((upload!.with as { name?: string })?.name).toBe('npm-tarball');
    expect((rel.jobs!['publish-npm']! as Job & { with?: Record<string, unknown> }).with?.['tarball-artifact']).toBe('npm-tarball');
  });

  test('the pack job asserts the bundled runtime is inside the tarball before staging', () => {
    // 1.12.2 shipped a runtime-less tarball; the pack job now hard-fails if the
    // packaged runtime entrypoint is not present in the packed .tgz.
    const packText = stepText(rel.jobs!['pack']!);
    expect(packText).toContain('tar -tzf');
    expect(packText).toContain('package/dist/package/main.js');
    // registry-install-smoke, the gate that caught the defect, is untouched.
    expect(needsOf(rel.jobs!['registry-install-smoke']!)).toContain('publish-npm');
  });

  test('the workflow performs no npm deprecation anywhere (owner policy: never deprecate)', () => {
    const raw = readFileSync(resolve(WF_DIR, 'release.yml'), 'utf8');
    expect(raw).not.toContain('npm deprecate');
    expect(rel.jobs!['deprecate-broken']).toBeUndefined();
  });
});
