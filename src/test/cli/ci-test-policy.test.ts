import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type PackageJson = {
  readonly scripts?: Record<string, string>;
};

const ROOT = resolve(import.meta.dir, '../../..');

function readProjectFile(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf-8');
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
  test('release workflow runs the full test suite exactly once', () => {
    const releaseWorkflow = readProjectFile('.github/workflows/release.yml');

    expect(countOccurrences(releaseWorkflow, 'run: bun run test')).toBe(1);
    expect(releaseWorkflow).not.toContain('bun test ');
    expect(releaseWorkflow).not.toContain('bun run eval:gate');
    expect(releaseWorkflow).not.toContain('Eval gate');
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
});
