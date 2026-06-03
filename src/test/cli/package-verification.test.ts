import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyPackageCliInstall, verifyReleaseMetadata } from '../../cli/package-verification.ts';
import { SDK_VERSION, VERSION } from '../../version.ts';

type PackageJson = {
  readonly version?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly engines?: Record<string, string>;
  readonly scripts?: Record<string, string>;
  readonly files?: readonly string[];
};

describe('package CLI install verification', () => {
  test('package exposes a runnable Agent bin and a safe registry tarball contract', () => {
    const report = verifyPackageCliInstall(resolve(import.meta.dir, '../../..'));

    expect(report.packageName).toBe('@pellux/goodvibes-agent');
    expect(report.issues).toEqual([]);
    expect(report.bins.map((bin) => bin.command)).toEqual(['goodvibes-agent']);
    expect(report.bins.every((bin) => bin.exists && bin.executable)).toBe(true);
    expect(report.bins.every((bin) => bin.usesBunShebang)).toBe(true);
    expect(report.bins.every((bin) => bin.hasSourceEntrypoint)).toBe(true);
    expect(report.tarball.requiredPathsPresent).toContain('bin/goodvibes-agent.ts');
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

  test('package metadata advertises Bun as the runtime, not Node', () => {
    const packagePath = resolve(import.meta.dir, '../../..', 'package.json');
    const parsed = JSON.parse(readFileSync(packagePath, 'utf-8')) as PackageJson;
    expect(parsed.engines?.bun).toBe('>=1.3.10');
    expect(parsed.engines?.node).toBeUndefined();
  });

  test('compiled metadata fallbacks match package identity and SDK pin', () => {
    const packagePath = resolve(import.meta.dir, '../../..', 'package.json');
    const parsed = JSON.parse(readFileSync(packagePath, 'utf-8')) as PackageJson;
    const sdkVersion = parsed.dependencies?.['@pellux/goodvibes-sdk'] ?? parsed.devDependencies?.['@pellux/goodvibes-sdk'];
    expect(VERSION).toBe(parsed.version);
    expect(SDK_VERSION).toBe(sdkVersion);
  });

  test('release metadata keeps package.json and changelog top entry in sync', () => {
    expect(verifyReleaseMetadata(resolve(import.meta.dir, '../../..'))).toEqual([]);
  });

  test('release metadata rejects a mismatched changelog top entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'goodvibes-agent-release-metadata-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 0.9.9 - 2026-06-03\n\n- Old notes.\n');

      expect(verifyReleaseMetadata(dir)).toEqual([
        'CHANGELOG.md top release 0.9.9 does not match package.json version 1.0.0.',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('package file exclusions do not carry stale concrete paths', () => {
    const root = resolve(import.meta.dir, '../../..');
    const packagePath = resolve(root, 'package.json');
    const parsed = JSON.parse(readFileSync(packagePath, 'utf-8')) as PackageJson;
    const staleConcreteExclusions = (parsed.files ?? [])
      .filter((entry) => entry.startsWith('!'))
      .map((entry) => entry.slice(1))
      .filter((entry) => !entry.includes('*') && !existsSync(resolve(root, entry)));

    expect(staleConcreteExclusions).toEqual([]);
  });

  test('package excludes internal release-verification source', () => {
    const packagePath = resolve(import.meta.dir, '../../..', 'package.json');
    const parsed = JSON.parse(readFileSync(packagePath, 'utf-8')) as PackageJson;

    expect(parsed.files).toContain('!src/cli/package-verification.ts');
  });

  test('release script requires product release notes instead of raw commit logs', () => {
    const releaseScriptPath = resolve(import.meta.dir, '../../..', 'scripts', 'release.ts');
    const source = readFileSync(releaseScriptPath, 'utf-8');

    expect(source).toContain('GOODVIBES_AGENT_RELEASE_NOTES');
    expect(source).toContain('--notes-file');
    expect(source).toContain('release notes must describe product changes');
    expect(source).not.toContain('git log --oneline');
  });

  test('command sources are product-owned instead of hidden behind package exclusions', () => {
    const packagePath = resolve(import.meta.dir, '../../..', 'package.json');
    const parsed = JSON.parse(readFileSync(packagePath, 'utf-8')) as PackageJson;
    const hiddenCommandSources = (parsed.files ?? [])
      .filter((entry) => entry.startsWith('!src/input/commands/') && entry.endsWith('.ts'));

    expect(hiddenCommandSources).toEqual([]);
  });

  test('panel sources are product-owned instead of hidden behind package exclusions', () => {
    const packagePath = resolve(import.meta.dir, '../../..', 'package.json');
    const parsed = JSON.parse(readFileSync(packagePath, 'utf-8')) as PackageJson;
    const hiddenPanelSources = (parsed.files ?? [])
      .filter((entry) => entry.startsWith('!src/panels/') && entry.endsWith('.ts'));

    expect(hiddenPanelSources).toEqual([]);
  });
});
