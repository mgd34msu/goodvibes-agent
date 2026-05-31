import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyPackageCliInstall } from '../../cli/package-verification.ts';

type PackageJson = {
  readonly scripts?: Record<string, string>;
};

describe('package CLI install verification', () => {
  test('package exposes a runnable Agent bin and a safe npm tarball contract', () => {
    const report = verifyPackageCliInstall(resolve(import.meta.dir, '../../..'));

    expect(report.packageName).toBe('@pellux/goodvibes-agent');
    expect(report.issues).toEqual([]);
    expect(report.bins.map((bin) => bin.command)).toEqual(['goodvibes-agent']);
    expect(report.bins.every((bin) => bin.exists && bin.executable)).toBe(true);
    expect(report.bins.every((bin) => bin.usesBunShebang)).toBe(true);
    expect(report.bins.every((bin) => bin.hasSourceEntrypoint)).toBe(true);
    expect(report.tarball.requiredPathsPresent).toContain('bin/goodvibes-agent.ts');
    expect(report.tarball.requiredPathsPresent).toContain('scripts/check-bun.sh');
    expect(report.tarball.requiredPathsPresent).toContain('LICENSE');
    expect(report.tarball.forbiddenPaths).toEqual([]);
    expect(report.packageFacingText.failures).toEqual([]);
    expect(report.packageFacingText.checkedPaths).toContain('README.md');
    expect(report.packageFacingText.checkedPaths).toContain('docs/release-and-publishing.md');
  }, 30_000);

  test('package exposes stable typecheck aliases for release gates', () => {
    const packagePath = resolve(import.meta.dir, '../../..', 'package.json');
    const parsed = JSON.parse(readFileSync(packagePath, 'utf-8')) as PackageJson;
    expect(parsed.scripts?.['typecheck']).toBe('bunx tsc --noEmit');
    expect(parsed.scripts?.['check:types']).toBe('bun run typecheck');
  });
});
