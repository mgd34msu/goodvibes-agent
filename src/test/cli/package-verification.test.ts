import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeProjectTempDir } from '../helpers/project-temp.ts';
import { packageFacingBoundaryLanguageIssues, verifyPackageCliInstall, verifyReleaseMetadata } from '../../cli/package-verification.ts';
import {
  releaseBlockingGitStatusLines,
  releaseEvidenceHygieneIssues,
  releaseEvidenceInputPaths,
  releaseMetadataPaths,
} from '../../../scripts/release.ts';
import { AGENT_HARNESS_MODES } from '../../tools/agent-harness-tool-schema.ts';

/**
 * Returns true when the release artifacts (dist/package runtime + bin) are present.
 * Tests gated on this are release-gate tests; the package:install-check script (run unconditionally
 * by `ci:gate`) provides the authoritative coverage when artifacts are absent locally.
 */
function releaseArtifactsPresent(): boolean {
  const root = resolve(import.meta.dir, '../../..');
  return existsSync(resolve(root, 'dist', 'package', 'main.js'))
    && existsSync(resolve(root, 'bin', 'goodvibes-agent.ts'));
}

type PackageJson = {
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
  { id: 'goodvibes-connected-host', kind: 'connected-host', evidence: 'reviewed' },
  { id: 'goodvibes-companion', kind: 'companion-app', evidence: 'reviewed' },
];

const releaseQuality = {
  capabilityCoverage: 'Covered by the release fixture.',
  userAccess: 'User can inspect this release fixture surface.',
  modelAccess: 'agent_harness exposes the matching fixture route to the model.',
  safetyBoundary: 'Fixture keeps product boundaries explicit.',
  releaseEvidence: 'Fixture carries release evidence.',
};

function allHarnessModesExcept(excludedMode?: string): string {
  return AGENT_HARNESS_MODES
    .filter((mode) => mode !== excludedMode)
    .map((mode) => `mode:"${mode}"`)
    .join(', ');
}

function writeReleaseReadinessFixture(dir: string, modelAccess: string): void {
  mkdirSync(join(dir, 'release'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@pellux/goodvibes-agent', version: '1.0.0' }));
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0 - 2026-06-03\n\n- Notes.\n');
  writeFileSync(join(dir, 'release', 'release-readiness.json'), JSON.stringify({
    schemaVersion: 1,
    gate: 'goodvibes-agent-release-readiness',
    checkedAt: '2026-06-03',
    policy: releaseReadinessPolicy,
    sources: releaseReadinessSources,
    items: [{
      id: 'release-readiness-inventory-gate',
      capability: 'Release readiness evidence.',
      owner: 'release',
      status: 'covered',
      evidence: 'release/release-readiness.json',
      action: 'Keep release readiness evidence current.',
      quality: { ...releaseQuality, modelAccess },
    }],
  }));
}

function writeReleaseMetadataBasics(dir: string): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@pellux/goodvibes-agent', version: '1.0.0' }));
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0 - 2026-06-03\n\n- Notes.\n');
}

function writeHarnessModeCatalogFixture(dir: string, modes: readonly string[]): void {
  mkdirSync(join(dir, 'src', 'tools'), { recursive: true });
  writeFileSync(join(dir, 'src', 'tools', 'agent-harness-mode-catalog.ts'), [
    'export const HARNESS_MODE_DESCRIPTORS = [',
    ...modes.map((mode) => `  { id: '${mode}', kind: 'inspect', family: 'fixture', summary: 'Compact.' },`),
    '] as const;',
    '',
  ].join('\n'));
}

function writeHarnessDispatcherFixture(dir: string, modes: readonly string[]): void {
  mkdirSync(join(dir, 'src', 'tools'), { recursive: true });
  writeFileSync(join(dir, 'src', 'tools', 'agent-harness-tool.ts'), [
    'export function createAgentHarnessTool() {',
    '  return { execute: async (rawArgs: Record<string, unknown>) => {',
    '    const args = rawArgs as { readonly mode?: string };',
    ...modes.map((mode) => `    if (args.mode === '${mode}') return { success: true, output: '${mode}' };`),
    '    return { success: false, error: `Unhandled agent_harness mode: ${args.mode}` };',
    '  } };',
    '}',
    '',
  ].join('\n'));
}

describe('package CLI install verification', () => {
  // Skipped when build artifacts (dist/package/main.js) are absent.
  // package:install-check (run unconditionally by `ci:gate`) provides authoritative coverage.
  test.skipIf(!releaseArtifactsPresent())('package exposes a runnable Agent bin and a safe registry tarball contract', () => {
    const report = verifyPackageCliInstall(resolve(import.meta.dir, '../../..'));

    expect(report.packageName).toBe('@pellux/goodvibes-agent');
    expect(report.issues).toEqual([]);
    expect(report.bins).toEqual([
      expect.objectContaining({
        command: 'goodvibes-agent',
        exists: true,
        executable: true,
        usesBunShebang: true,
        hasSourceEntrypoint: true,
      }),
    ]);
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

  // This is a release-gate check (live repo state: version == CHANGELOG top entry).
  // publish:check (run unconditionally by `ci:gate`) provides authoritative coverage.
  // The fixture-driven test below verifies the sync-checking function in isolation.
  test.skipIf(!releaseArtifactsPresent())('release metadata keeps package.json and changelog top entry in sync', () => {
    expect(verifyReleaseMetadata(resolve(import.meta.dir, '../../..'))).toEqual([]);
  });

  test('release metadata rejects a mismatched changelog top entry', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 0.9.9 - 2026-06-03\n\n- Old notes.\n');

      expect(verifyReleaseMetadata(dir)).toContain('CHANGELOG.md top release 0.9.9 does not match package.json version 1.0.0.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects over-budget performance snapshot metrics', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
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

  test('release metadata rejects over-budget harness mode catalog text', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      mkdirSync(join(dir, 'src', 'tools'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@pellux/goodvibes-agent', version: '1.0.0' }));
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0 - 2026-06-03\n\n- Notes.\n');
      writeFileSync(join(dir, 'src', 'tools', 'agent-harness-mode-catalog.ts'), [
        "export const HARNESS_MODE_DESCRIPTORS = [{",
        "  id: 'too_verbose',",
        "  summary: 'Inspect one extremely verbose model-facing harness catalog entry that should be compacted before release.',",
        "}];",
        '',
      ].join('\n'));
      writeFileSync(join(dir, 'src', 'tools', 'agent-harness-command-catalog.ts'), [
        'function previewText(value: string, maxLength = 88): string {',
        '  return value.slice(0, maxLength);',
        '}',
        '',
      ].join('\n'));
      mkdirSync(join(dir, 'src', 'input'), { recursive: true });
      writeFileSync(join(dir, 'src', 'input', 'agent-workspace-categories.ts'), [
        "export const AGENT_WORKSPACE_CATEGORIES = [{",
        "  id: 'host',",
        "  summary: 'Connected-host health, tasks, sessions, channels, automation, and control-plane posture.',",
        "}];",
        '',
      ].join('\n'));

      const issues = verifyReleaseMetadata(dir);

      expect(issues).toContain('harness mode catalog src/tools/agent-harness-mode-catalog.ts:3 summary is 105 characters; keep it at or below 72.');
      expect(issues).toContain('harness catalog src/tools/agent-harness-command-catalog.ts:1 previewText default is 88; keep it at or below 72.');
      expect(issues).toContain('harness mode catalog src/input/agent-workspace-categories.ts:3 summary is 88 characters; keep it at or below 72.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects over-budget model tool schema descriptions', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      writeReleaseMetadataBasics(dir);
      mkdirSync(join(dir, 'src', 'tools'), { recursive: true });
      writeFileSync(join(dir, 'src', 'tools', 'agent-example-tool.ts'), [
        'export const tool = {',
        '  definition: {',
        "    description: 'Compact registered description.',",
        '    parameters: {',
        '      type: "object",',
        '      properties: {',
        "        target: { type: 'string', description: 'This schema description is intentionally much too long for the model-facing release gate.' },",
        '      },',
        '    },',
        '  },',
        '};',
        '',
      ].join('\n'));

      expect(verifyReleaseMetadata(dir)).toContain('model tool src/tools/agent-example-tool.ts:7 schema description is 89 characters; keep it at or below 72.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('package-facing text rejects release evidence as a user-facing surface', () => {
    expect(packageFacingBoundaryLanguageIssues(
      'README.md',
      'Completed direct model access to user-facing harness operations: workspace actions, release evidence, and connected-host diagnostics.',
    )).toEqual([
      'package-facing text README.md:1 classifies release evidence as a user-facing surface; describe it as operator/audit material.',
    ]);
    expect(packageFacingBoundaryLanguageIssues(
      'README.md',
      'Operator/audit inspection exposes release evidence for packaged release artifacts.',
    )).toEqual([]);
  });

  test('release metadata rejects missing harness mode catalog descriptors', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      writeReleaseMetadataBasics(dir);
      writeHarnessModeCatalogFixture(dir, AGENT_HARNESS_MODES.filter((mode) => mode !== 'tool'));

      expect(verifyReleaseMetadata(dir)).toContain('release harness mode catalog must describe agent_harness mode:"tool".');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects unknown harness mode catalog descriptors', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      writeReleaseMetadataBasics(dir);
      writeHarnessModeCatalogFixture(dir, [...AGENT_HARNESS_MODES, 'not_a_harness_mode']);

      expect(verifyReleaseMetadata(dir)).toContain('release harness mode catalog references unknown agent_harness mode:"not_a_harness_mode".');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects duplicate harness mode catalog descriptors', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      writeReleaseMetadataBasics(dir);
      writeHarnessModeCatalogFixture(dir, [...AGENT_HARNESS_MODES, 'tool']);

      expect(verifyReleaseMetadata(dir)).toContain('release harness mode catalog duplicates agent_harness mode:"tool".');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects missing agent_harness dispatcher branches', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      writeReleaseMetadataBasics(dir);
      writeHarnessDispatcherFixture(dir, AGENT_HARNESS_MODES.filter((mode) => mode !== 'tool'));

      expect(verifyReleaseMetadata(dir)).toContain('release agent_harness dispatcher must handle mode:"tool".');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects unknown agent_harness dispatcher branches', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      writeReleaseMetadataBasics(dir);
      writeHarnessDispatcherFixture(dir, [...AGENT_HARNESS_MODES, 'not_a_harness_mode']);

      expect(verifyReleaseMetadata(dir)).toContain('release agent_harness dispatcher references unknown mode:"not_a_harness_mode".');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects duplicate agent_harness dispatcher branches', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      writeReleaseMetadataBasics(dir);
      writeHarnessDispatcherFixture(dir, [...AGENT_HARNESS_MODES, 'tool']);

      expect(verifyReleaseMetadata(dir)).toContain('release agent_harness dispatcher duplicates mode:"tool".');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects unknown agent_harness route references in model-facing catalogs', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      writeReleaseMetadataBasics(dir);
      mkdirSync(join(dir, 'src', 'tools'), { recursive: true });
      writeFileSync(join(dir, 'src', 'tools', 'agent-harness-route-fixture.ts'), [
        'const staticRoute = \'agent_harness mode:"not_a_harness_mode"\';',
        "const helperRoute = agentHarnessModes('also_not_a_harness_mode');",
        '',
      ].join('\n'));

      const issues = verifyReleaseMetadata(dir);

      expect(issues).toContain('harness catalog src/tools/agent-harness-route-fixture.ts:1 references unknown agent_harness mode:"not_a_harness_mode".');
      expect(issues).toContain('harness catalog src/tools/agent-harness-route-fixture.ts:2 references unknown agent_harness mode:"also_not_a_harness_mode".');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects local sibling evidence in the release readiness inventory', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
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
            evidence: '../connected-host/docs/channel-surfaces.md',
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

  test('release metadata rejects missing model-visible harness mode coverage in readiness evidence', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      writeReleaseReadinessFixture(dir, allHarnessModesExcept('tool'));

      expect(verifyReleaseMetadata(dir)).toContain('release readiness inventory model access must cover agent_harness mode:"tool".');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects unknown model-visible harness modes in readiness evidence', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      writeReleaseReadinessFixture(dir, `${allHarnessModesExcept()} mode:"not_a_harness_mode"`);

      expect(verifyReleaseMetadata(dir)).toContain('release readiness inventory release-readiness-inventory-gate quality.modelAccess references unknown agent_harness mode:"not_a_harness_mode".');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects stale live verification evidence', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      mkdirSync(join(dir, 'release', 'live-verification'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: '@pellux/goodvibes-agent',
        version: '1.0.0',
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
          { id: 'connected-host-status', status: 'pass', summary: '/status returned 200.' },
          { id: 'cli-compat-json', status: 'pass', detail: '{"compatible": true}' },
        ],
      }));

      const issues = verifyReleaseMetadata(dir);

      expect(issues).toContain('release live verification report must not predate readiness inventory checkedAt 2026-06-03.');
      expect(issues.join('\n')).toContain('release live verification report is stale: generatedAt is ');
      expect(issues.join('\n')).toContain('rerun strict live verification');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('release metadata rejects mismatched live verification Markdown evidence', () => {
    const dir = makeProjectTempDir('goodvibes-agent-release-metadata');
    try {
      mkdirSync(join(dir, 'release', 'live-verification'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: '@pellux/goodvibes-agent',
        version: '1.0.0',
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
          { id: 'connected-host-status', status: 'pass', summary: '/status returned 200.' },
          { id: 'cli-compat-json', status: 'pass', detail: '{"compatible": true}' },
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
    const dir = makeProjectTempDir('goodvibes-agent-release-evidence');
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
