import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyPackageCliInstall, verifyReleaseMetadata } from '../../cli/package-verification.ts';
import { SDK_VERSION, VERSION } from '../../version.ts';
import {
  releaseBlockingGitStatusLines,
  releaseEvidenceHygieneIssues,
  releaseEvidenceInputPaths,
  releaseMetadataPaths,
} from '../../../scripts/release.ts';

type PackageJson = {
  readonly version?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly engines?: Record<string, string>;
  readonly scripts?: Record<string, string>;
  readonly files?: readonly string[];
};

const releaseReadinessPolicy = {
  blockerStatuses: ['unknown', 'gap'],
  sourceNaming: 'Use neutral evidence aliases only.',
  qualityGate: 'Require release-quality capability coverage.',
  requiredQualityDimensions: ['capabilityCoverage', 'userAccess', 'modelAccess', 'safetyBoundary', 'releaseEvidence'],
};

const releaseReadinessSources = [
  { id: 'release-surface-review', kind: 'release-surface-review', evidence: 'reviewed' },
  { id: 'runtime-contract-review', kind: 'runtime-contract-review', evidence: 'reviewed' },
  { id: 'goodvibes-agent', kind: 'agent-package', evidence: 'reviewed' },
  { id: 'goodvibes-connected-host', kind: 'connected-host-sdk', evidence: 'reviewed' },
  { id: 'goodvibes-companion', kind: 'companion-app', evidence: 'reviewed' },
];

const releaseQuality = {
  capabilityCoverage: 'Covered by the release fixture.',
  userAccess: 'User can inspect this release fixture surface.',
  modelAccess: 'agent_harness exposes the matching fixture route to the model.',
  safetyBoundary: 'Fixture keeps product boundaries explicit.',
  releaseEvidence: 'Fixture carries release evidence.',
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
    expect(report.tarball.requiredPathsPresent).toContain('release/release-notes.md');
    expect(report.tarball.requiredPathsPresent).toContain('release/performance-snapshot.json');
    expect(report.tarball.requiredPathsPresent).toContain('release/release-readiness.json');
    expect(report.tarball.requiredPathsPresent).toContain('release/live-verification/live-verification.json');
    expect(report.tarball.requiredPathsPresent).toContain('release/live-verification/live-verification.md');
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

      expect(verifyReleaseMetadata(dir)).toContain('CHANGELOG.md top release 0.9.9 does not match package.json version 1.0.0.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects over-budget performance snapshot metrics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'goodvibes-agent-release-metadata-'));
    try {
      const recentCycles = Array.from({ length: 10 }, (_, index) => ({
        cycleId: index + 1,
        requestedAt: 1780491600000 + index * 20,
        completedAt: 1780491600008 + index * 20,
        durationMs: 8,
        overBudget: false,
      }));
      mkdirSync(join(dir, 'release'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@pellux/goodvibes-agent', version: '1.0.0' }));
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0 - 2026-06-03\n\n- Notes.\n');
      writeFileSync(join(dir, 'release', 'performance-snapshot.json'), JSON.stringify({
        surfacePerf: {
          targetBudgetMs: 16,
          budgetStatus: 'ok',
          overBudgetCount: 0,
          recentCycles,
        },
        extraMetrics: {
          'event.queue.depth': 12,
          'tool.executor.overhead.p95': 2.1,
          'compaction.latency.p95': 84,
          'slo.turn_start.p95': 2500,
          'slo.cancel.p95': 96,
          'slo.reconnect_recovery.p95': 1230,
          'slo.permission_decision.p95': 19,
          'slo.integration.delivery_success_rate': 95,
          'slo.integration.dlq_depth': 0,
        },
      }));

      expect(verifyReleaseMetadata(dir)).toContain('release performance snapshot metric slo.turn_start.p95 2500 exceeds release budget 2000.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects local sibling evidence in the release readiness inventory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'goodvibes-agent-release-metadata-'));
    try {
      mkdirSync(join(dir, 'release'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@pellux/goodvibes-agent', version: '1.0.0' }));
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0 - 2026-06-03\n\n- Notes.\n');
      writeFileSync(join(dir, 'release', 'release-readiness.json'), JSON.stringify({
        schemaVersion: 1,
        gate: 'goodvibes-agent-release-readiness',
        checkedAt: '2026-06-03',
        policy: releaseReadinessPolicy,
        sources: releaseReadinessSources,
        items: [
          {
            id: 'connected-host-channel-core',
            capability: 'Connected host channels.',
            owner: 'connected-host',
            status: 'covered',
            evidence: '../goodvibes-sdk/docs/channel-surfaces.md',
            action: 'Keep Agent boundaries.',
            quality: releaseQuality,
          },
          {
            id: 'mobile-device-command-depth',
            capability: 'Companion command depth.',
            owner: 'companion',
            status: 'covered',
            evidence: 'runtime-contract-review reviewed companion command depth',
            action: 'Keep companion boundaries.',
            quality: releaseQuality,
          },
        ],
      }));

      const issues = verifyReleaseMetadata(dir);

      expect(issues).toContain('release readiness inventory evidence must not depend on local sibling checkout path: ../.');
      expect(issues).toContain('release readiness inventory connected-host-channel-core must cite the goodvibes-connected-host source alias.');
      expect(issues).toContain('release readiness inventory mobile-device-command-depth must cite the goodvibes-companion source alias.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects stale live verification evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'goodvibes-agent-release-metadata-'));
    try {
      mkdirSync(join(dir, 'release', 'live-verification'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: '@pellux/goodvibes-agent',
        version: '1.0.0',
        dependencies: { '@pellux/goodvibes-sdk': '0.33.36' },
      }));
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0 - 2026-06-03\n\n- Notes.\n');
      writeFileSync(join(dir, 'release', 'release-readiness.json'), JSON.stringify({
        schemaVersion: 1,
        gate: 'goodvibes-agent-release-readiness',
        checkedAt: '2026-06-03',
        policy: releaseReadinessPolicy,
        sources: releaseReadinessSources,
        items: [{
          id: 'live-outcome-certification',
          capability: 'Fresh live evidence.',
          owner: 'release',
          status: 'covered',
          evidence: 'release/live-verification/live-verification.json',
          action: 'Rerun strict live verification.',
          quality: releaseQuality,
        }],
      }));
      writeFileSync(join(dir, 'release', 'live-verification', 'live-verification.md'), '# GoodVibes Agent Live Verification\n\nResult: PASS\n');
      writeFileSync(join(dir, 'release', 'live-verification', 'live-verification.json'), JSON.stringify({
        generatedAt: '2026-01-01T00:00:00.000Z',
        strict: true,
        ok: true,
        counts: { pass: 14, warn: 0, fail: 0, skip: 0 },
        checks: [
          { id: 'connected-host-status', status: 'pass', summary: '/status returned 200, version 0.33.36.' },
          { id: 'cli-compat-json', status: 'pass', detail: '{"sdkPin": "0.33.36", "version": "0.33.36", "compatible": true}' },
        ],
      }));

      const issues = verifyReleaseMetadata(dir);

      expect(issues).toContain('release live verification report must not predate readiness inventory checkedAt 2026-06-03.');
      expect(issues.some((issue) => issue.startsWith('release live verification report is stale: generatedAt is '))).toBe(true);
      expect(issues.some((issue) => issue.includes('rerun strict live verification'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects mismatched live verification Markdown evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'goodvibes-agent-release-metadata-'));
    try {
      mkdirSync(join(dir, 'release', 'live-verification'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: '@pellux/goodvibes-agent',
        version: '1.0.0',
        dependencies: { '@pellux/goodvibes-sdk': '0.33.36' },
      }));
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0 - 2026-06-03\n\n- Notes.\n');
      writeFileSync(join(dir, 'release', 'release-readiness.json'), JSON.stringify({
        schemaVersion: 1,
        gate: 'goodvibes-agent-release-readiness',
        checkedAt: '2026-06-03',
        policy: releaseReadinessPolicy,
        sources: releaseReadinessSources,
        items: [{
          id: 'live-outcome-certification',
          capability: 'Fresh live evidence.',
          owner: 'release',
          status: 'covered',
          evidence: 'release/live-verification/live-verification.json',
          action: 'Rerun strict live verification.',
          quality: releaseQuality,
        }],
      }));
      writeFileSync(join(dir, 'release', 'live-verification', 'live-verification.md'), [
        '# GoodVibes Agent Live Verification',
        '',
        'Generated: 2026-06-03T00:00:00.000Z',
        '',
        '| Status | Count |',
        '|---|---:|',
        '| pass | 13 |',
        '| warn | 0 |',
        '| fail | 0 |',
        '| skip | 0 |',
        '',
        'Result: PASS',
        '',
      ].join('\n'));
      writeFileSync(join(dir, 'release', 'live-verification', 'live-verification.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        strict: true,
        ok: true,
        counts: { pass: 14, warn: 0, fail: 0, skip: 0 },
        checks: [
          { id: 'connected-host-status', status: 'pass', summary: '/status returned 200, version 0.33.36.' },
          { id: 'cli-compat-json', status: 'pass', detail: '{"sdkPin": "0.33.36", "version": "0.33.36", "compatible": true}' },
        ],
      }));

      const issues = verifyReleaseMetadata(dir);

      expect(issues).toContain('release live verification Markdown report generated timestamp must match JSON generatedAt.');
      expect(issues).toContain('release live verification Markdown report pass count must match JSON counts.pass.');
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
    expect(source).toContain('bun run architecture:check');
    expect(source).toContain('bun run perf:check');
    expect(source).toContain('bun run publish:check');
    expect(source).toContain('bun run package:install-check');
    expect(source).toContain('bun run verification:ledger');
    expect(source).toContain('bun pm pack --dry-run');
    expect(source).toContain('git diff --check');
    expect(source).toContain("assertReleaseEvidenceHygiene('release evidence text hygiene', root)");
    expect(source).toContain("assertReleaseEvidenceHygiene('post-release evidence text hygiene', root)");
    expect(source).not.toContain("if (!options.dryRun) {\n      assertReleaseEvidenceHygiene('release evidence text hygiene', root);");
    expect(source).toContain('Dry-run release preview for ${tag} complete.');
    expect(source).toContain('No files, commits, or tags were written.');
    expect(source).toContain('rerun without --dry-run from a clean main worktree');
    expect(source).not.toContain('git log --oneline');
  });

  test('publish package script keeps source release policy out of staged package policy', () => {
    const publishScriptPath = resolve(import.meta.dir, '../../..', 'scripts', 'publish-package.ts');
    const source = readFileSync(publishScriptPath, 'utf-8');

    expect(source).toContain('function assertSourcePackagePolicy');
    expect(source).toContain('...verifyReleaseMetadata(validationRoot)');
    expect(source).toContain('function assertStagedPackagePolicy');
    expect(source).toContain('const failures = verifyPackageFacingText(validationRoot).failures;');
    expect(source).toContain('assertSourcePackagePolicy(root)');
    expect(source).toContain('assertStagedPackagePolicy(stageDir)');
    expect(source).not.toContain("assertPackagePolicy(stageDir, 'staged package')");
  });

  test('release workflow can smoke test a just-published Bun registry version', () => {
    const releaseWorkflowPath = resolve(import.meta.dir, '../../..', '.github', 'workflows', 'release.yml');
    const source = readFileSync(releaseWorkflowPath, 'utf-8');

    expect(source).toContain('Bun registry install smoke');
    expect(source).toContain('bun add -g "@pellux/goodvibes-agent@${VERSION}" --registry https://registry.npmjs.org --minimum-release-age 0');
  });

  test('release script stages the release evidence bundle', () => {
    const paths = releaseMetadataPaths(resolve(import.meta.dir, '../../..'));

    expect(paths).toContain('release/release-notes.md');
    expect(paths).toContain('release/performance-snapshot.json');
    expect(paths).toContain('release/release-readiness.json');
    expect(paths).toContain('release/live-verification/live-verification.json');
    expect(paths).toContain('release/live-verification/live-verification.md');
    expect(paths).toContain('README.md');
    expect(paths).toContain('docs/release-and-publishing.md');
  });

  test('release preflight allows only declared release evidence changes before a real release', () => {
    const allowedEvidenceStatus = [
      '?? release/release-notes.md',
      ' M release/performance-snapshot.json',
      'A  release/live-verification/live-verification.json',
    ].join('\n');
    const mixedStatus = [
      allowedEvidenceStatus,
      ' M src/main.ts',
      ' M README.md',
      '?? scratch.txt',
      ' D release/release-readiness.json',
    ].join('\n');

    expect(releaseEvidenceInputPaths()).toContain('release/release-readiness.json');
    expect(releaseBlockingGitStatusLines(allowedEvidenceStatus)).toEqual([]);
    expect(releaseBlockingGitStatusLines(mixedStatus)).toEqual([
      ' M src/main.ts',
      ' M README.md',
      '?? scratch.txt',
      ' D release/release-readiness.json',
    ]);
  });

  test('release evidence hygiene checks untracked release files before commit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'goodvibes-agent-release-evidence-'));
    try {
      mkdirSync(join(dir, 'release'), { recursive: true });
      writeFileSync(join(dir, 'release', 'ok.md'), '- release note\n');
      writeFileSync(join(dir, 'release', 'bad.md'), '- release note  \nnext line');

      expect(releaseEvidenceHygieneIssues(dir, ['release/ok.md'])).toEqual([]);
      expect(releaseEvidenceHygieneIssues(dir, ['release/bad.md', 'release/missing.md'])).toEqual([
        'release/bad.md: missing final newline.',
        'release/bad.md:1: trailing whitespace.',
        'release/missing.md: required release evidence file is missing.',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
