import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { verifyPackageCliInstall } from '../../cli/package-verification.ts';

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
    expect(report.tarball.forbiddenPaths).toEqual([]);
  }, 30_000);
});
