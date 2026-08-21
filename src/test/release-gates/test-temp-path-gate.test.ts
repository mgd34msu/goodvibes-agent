/**
 * test-temp-path-gate, no test source may hardcode a product-namespaced path
 * under the real `/tmp`.
 *
 * The suite redirects the OS temp directory into a per-process sandbox that is
 * removed when the run ends (see src/test/helpers/preload.ts), so anything
 * built from tmpdir() is cleaned up for free. A quoted absolute path under the
 * real /tmp with a gv- or goodvibes- prefix bypasses that entirely and writes
 * into the developer's actual /tmp. That is not hypothetical: measured by
 * diffing /tmp across a full green run, scheduler.test.ts's hardcoded store
 * paths left 12 gv-scheduler-test-*.json files behind every single run.
 *
 * The rule covers inert-looking literals too. Whether a path string is only
 * compared or actually written is a property of the code under test, not of the
 * test, so a literal that is inert today starts leaking the day the callee
 * begins persisting, and nothing reports it.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const SRC_ROOT = join(REPO_ROOT, 'src');

/**
 * Files allowed to hardcode a `/tmp` path, each with the reason. A test that
 * needs a directory which is genuinely NOT inside this git checkout cannot use
 * tmpdir(): the suite runner points it inside the repo.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'src/test/scripts/internal-identifier-gate.test.ts':
    'needs a root that is provably not inside any git repo; removes it in a finally block',
};

/** Product-namespaced absolute paths under the real /tmp, in any quote style. */
const HARDCODED_TMP = /['"`]\/tmp\/(gv[-/]|goodvibes)/;

function collectTestSources(dir: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestSources(full, acc);
      continue;
    }
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const rel = relative(REPO_ROOT, full);
    if (/\.(test|spec)\.tsx?$/.test(entry.name) || rel.startsWith('src/test/')) acc.push(rel);
  }
  return acc;
}

/** Every test source that hardcodes a product-namespaced /tmp path. */
function offenders(files: readonly string[]): readonly string[] {
  return files.filter((rel) => HARDCODED_TMP.test(readFileSync(join(REPO_ROOT, rel), 'utf8')));
}

describe('test sources do not hardcode paths under the real /tmp', () => {
  const files = collectTestSources(SRC_ROOT, []);

  test('the scan actually finds the test corpus', () => {
    // Guard against a green result produced by scanning nothing.
    expect(files.length).toBeGreaterThan(600);
    expect(files).toContain('src/test/scheduler/scheduler.test.ts');
    expect(files).toContain('src/test/helpers/preload.ts');
  });

  test('no test source outside the allowlist hardcodes a /tmp path', () => {
    expect(offenders(files).filter((rel) => ALLOWED[rel] === undefined)).toEqual([]);
  });

  test('every allowlist entry still names a real file that still needs it', () => {
    // An allowlist that outlives its reason silently widens the rule.
    for (const rel of Object.keys(ALLOWED)) {
      expect(files).toContain(rel);
      expect(offenders([rel])).toEqual([rel]);
    }
  });

  test('the detector reports a file that hardcodes such a path', () => {
    // NO-proof: the allowlisted file DOES match the pattern, so the matcher is
    // live rather than one that can never fire.
    expect(offenders(Object.keys(ALLOWED))).toEqual(Object.keys(ALLOWED));
    // And the pattern distinguishes the two forms it must tell apart. Built by
    // concatenation so this file does not trip its own rule.
    const tmpRoot = '/tmp' + '/';
    expect(HARDCODED_TMP.test(`const p = '${tmpRoot}gv-scheduler-test-abc.json';`)).toBe(true);
    expect(HARDCODED_TMP.test(`const p = "${tmpRoot}goodvibes-agent-home";`)).toBe(true);
    expect(HARDCODED_TMP.test("const p = join(tmpdir(), 'gv-scheduler-test');")).toBe(false);
  });
});
