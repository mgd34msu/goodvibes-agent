#!/usr/bin/env bun
/**
 * check-workflows.ts — structural validation gate for the GitHub Actions
 * workflow YAML under .github/workflows/.
 *
 * The repo has no actionlint/yaml-lint gate, so a broken workflow edit would
 * only surface at release time. This check runs in the ordinary gate battery and
 * validates the structure statically (it never executes a publish):
 *   - every workflow file parses as YAML;
 *   - every workflow declares `name`, `on`, and a non-empty `jobs` map;
 *   - every job declares `runs-on` and either `steps` or `uses` (reusable call);
 *   - no job carries `continue-on-error: true` (banned across the ecosystem —
 *     a run that reports success over a failing job is a false green);
 *   - the release workflow carries the full binary release lane: the npm pack
 *     job, the per-platform binary build matrix, a compiled-binary smoke, the
 *     GitHub Release job, and the npm publish job;
 *   - the release lane covers all four platform binaries in the SHA256SUMS
 *     manifest and attaches them (plus SHA256SUMS.txt and the npm tarball) to
 *     the GitHub Release, matching the naming the curl installer parses;
 *   - the release lane also covers all four per-platform sqlite-vec native
 *     addon archives (sqlite-vec-<os>-<arch>.tar.gz) in the SHA256SUMS manifest
 *     and attaches them, so a directly-downloaded binary can co-locate the addon
 *     and restore the semantic vector index (missing-entry-fatal, same as the
 *     binaries).
 *
 * Exit code 0 = green (0 problems), non-zero = the count of structural problems.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const workflowsDir = join(root, '.github', 'workflows');

type Json = Record<string, unknown>;

const problems: string[] = [];
function fail(file: string, message: string): void {
  problems.push(`${file}: ${message}`);
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
if (files.length === 0) {
  console.error('check-workflows: no workflow files found under .github/workflows');
  process.exit(1);
}

/** Jobs the release workflow must define to ship both the npm channel and binaries. */
const RELEASE_REQUIRED_JOBS: ReadonlyArray<string> = [
  'validate-release',
  'pack',
  'build',
  'smoke-macos',
  'release',
  'publish-npm',
];

/** The four compiled binaries the curl installer resolves by platform. */
const PLATFORM_BINARIES: ReadonlyArray<string> = [
  'goodvibes-agent-linux-x64',
  'goodvibes-agent-linux-arm64',
  'goodvibes-agent-macos-x64',
  'goodvibes-agent-macos-arm64',
];

/**
 * The four per-platform sqlite-vec native addon archives. Each is checksummed in
 * SHA256SUMS.txt and attached to the release; an installer downloads the one that
 * matches the binary's platform and extracts it in place next to the binary
 * (interior layout: lib/sqlite-vec-<os>-<arch>/vec0.<suffix>).
 */
const PLATFORM_ADDON_ARCHIVES: ReadonlyArray<string> = [
  'sqlite-vec-linux-x64.tar.gz',
  'sqlite-vec-linux-arm64.tar.gz',
  'sqlite-vec-darwin-x64.tar.gz',
  'sqlite-vec-darwin-arm64.tar.gz',
];

function stepsContinueOnError(job: Json): boolean {
  // A step-level continue-on-error is an informational annotation and never
  // reds a check-run — only a JOB-level true is banned. This helper flags the
  // job-level form.
  return job['continue-on-error'] === true;
}

for (const file of files) {
  const raw = readFileSync(join(workflowsDir, file), 'utf8');
  let doc: unknown;
  try {
    doc = Bun.YAML.parse(raw);
  } catch (err) {
    fail(file, `does not parse as YAML: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  if (!isObject(doc)) {
    fail(file, 'top-level document is not a mapping');
    continue;
  }
  if (typeof doc.name !== 'string' || doc.name.trim().length === 0) {
    fail(file, 'missing a non-empty `name`');
  }
  // YAML parses the `on:` key as the boolean true, so accept either spelling.
  if (!('on' in doc) && !(true in (doc as Record<string | number, unknown>))) {
    fail(file, 'missing an `on` trigger block');
  }
  const jobs = doc.jobs;
  if (!isObject(jobs) || Object.keys(jobs).length === 0) {
    fail(file, 'missing a non-empty `jobs` map');
    continue;
  }

  for (const [jobName, job] of Object.entries(jobs)) {
    if (!isObject(job)) {
      fail(file, `job "${jobName}" is not a mapping`);
      continue;
    }
    const isReusableCall = typeof job.uses === 'string';
    if (!isReusableCall) {
      if (!('runs-on' in job)) fail(file, `job "${jobName}" is missing runs-on`);
      if (!Array.isArray(job.steps) || job.steps.length === 0) {
        fail(file, `job "${jobName}" has no steps`);
      }
    }
    if (stepsContinueOnError(job)) {
      fail(file, `job "${jobName}" declares job-level continue-on-error: true (banned — it hides a failing job behind a green run)`);
    }
  }

  if (file === 'release.yml') {
    for (const job of RELEASE_REQUIRED_JOBS) {
      if (!isObject((jobs as Json)[job])) {
        fail(file, `release workflow is missing the "${job}" job`);
      }
    }

    // The build matrix must cover all four platform binaries, the checksum
    // manifest must sum them, and the release must attach them. Assert on the
    // raw text so a dropped platform cannot slip through a structural pass.
    for (const binary of PLATFORM_BINARIES) {
      const occurrences = raw.split(binary).length - 1;
      if (occurrences < 2) {
        fail(
          file,
          `binary "${binary}" must appear in both the checksum manifest and the release upload (found ${occurrences} reference(s))`,
        );
      }
    }
    // Every per-platform sqlite-vec addon archive must appear in both the
    // checksum manifest and the release upload — a directly-downloaded binary
    // depends on the matching addon to restore the semantic vector index, so a
    // dropped archive is missing-entry-fatal, exactly like a dropped binary.
    for (const archive of PLATFORM_ADDON_ARCHIVES) {
      const occurrences = raw.split(archive).length - 1;
      if (occurrences < 2) {
        fail(
          file,
          `sqlite-vec addon archive "${archive}" must appear in both the checksum manifest and the release upload (found ${occurrences} reference(s))`,
        );
      }
    }
    if (!raw.includes('SHA256SUMS.txt')) {
      fail(file, 'release workflow does not generate or attach SHA256SUMS.txt');
    }
    if (!raw.includes('post-build-smoke.ts')) {
      fail(file, 'release workflow does not run the compiled-binary smoke (post-build-smoke.ts)');
    }
  }
}

if (problems.length > 0) {
  console.error(`check-workflows: ${problems.length} structural problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`check-workflows: OK — ${files.length} workflow file(s) validated, 0 problems.`);
