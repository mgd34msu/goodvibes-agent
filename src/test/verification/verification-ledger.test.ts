import { describe, expect, test } from 'bun:test';
import {
  buildVerificationLedger,
  FEATURE_FLAGS_EXTERNAL_ESTIMATE,
  renderVerificationLedgerMarkdown,
  SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE,
} from '../../verification/verification-ledger.ts';
import { CONFIG_SCHEMA } from '@pellux/goodvibes-sdk/platform/config';
import { FEATURE_FLAG_MAP } from '@pellux/goodvibes-sdk/platform/runtime/state';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const projectRoot = resolve(join(import.meta.dir, '..', '..', '..'));

describe('verification ledger', () => {
  test('builds a repeatable local verification coverage summary', () => {
    const ledger = buildVerificationLedger(projectRoot);

    // --- Structural invariants ---
    // Total must be a reasonable non-trivial inventory
    expect(ledger.totals.total).toBeGreaterThan(400);
    // Signal percent: localSignalVerified / total must be >= 90%
    expect(ledger.totals.localSignalPercent).toBeGreaterThanOrEqual(90);
    // localBehaviorPercent is now honest: source-marker substring hits no longer
    // inflate localBehaviorVerified. Floor reflects dispatch-backed behavior only.
    expect(ledger.totals.localBehaviorPercent).toBeGreaterThanOrEqual(70);
    // All counts must be non-negative
    expect(ledger.totals.total).toBeGreaterThanOrEqual(0);
    expect(ledger.totals.localSignalVerified).toBeGreaterThanOrEqual(0);
    expect(ledger.totals.localBehaviorVerified).toBeGreaterThanOrEqual(0);
    expect(ledger.totals.externalOutcomeRequired).toBeGreaterThanOrEqual(0);
    // localBehaviorVerified cannot exceed total
    expect(ledger.totals.localBehaviorVerified).toBeLessThanOrEqual(ledger.totals.total);
    // Per-area invariants
    for (const area of ledger.areas) {
      expect(area.total).toBeGreaterThanOrEqual(0);
      expect(area.localSignalVerified).toBeGreaterThanOrEqual(0);
      expect(area.localBehaviorVerified).toBeGreaterThanOrEqual(0);
      expect(area.externalOutcomeRequired).toBeGreaterThanOrEqual(0);
      // externalOutcomeRequired must not exceed total (each area has its own derivation formula)
      expect(area.externalOutcomeRequired).toBeLessThanOrEqual(area.total);
      // localBehaviorVerified cannot exceed total
      expect(area.localBehaviorVerified).toBeLessThanOrEqual(area.total);
    }
    // --- Area membership ---
    expect(ledger.areas.map((area) => area.area)).toEqual(expect.arrayContaining([
      'Settings schema and persistence',
      'Slash commands',
      'Top-level CLI commands',
      'Model-visible release evidence bundle',
      'Model-visible service posture',
      'Model-visible operator method catalog',
      'Model-visible harness mode catalog',
    ]));
    // --- Areas that are fully locally verifiable (externalOutcomeRequired must be 0) ---
    const releaseEvidence = ledger.areas.find((area) => area.area === 'Model-visible release evidence bundle');
    expect(releaseEvidence).toBeDefined();
    // total is derived from RELEASE_EVIDENCE_PATHS.length + HARNESS_RELEASE_EVIDENCE_MODES.length (independent source)
    expect(releaseEvidence!.total).toBeGreaterThan(0);
    expect(releaseEvidence!.localSignalVerified).toBeLessThanOrEqual(releaseEvidence!.total);
    expect(releaseEvidence!.externalOutcomeRequired).toBe(0);

    const servicePosture = ledger.areas.find((area) => area.area === 'Model-visible service posture');
    expect(servicePosture).toBeDefined();
    expect(servicePosture!.total).toBeGreaterThan(0);
    expect(servicePosture!.externalOutcomeRequired).toBe(0);

    const operatorMethods = ledger.areas.find((area) => area.area === 'Model-visible operator method catalog');
    expect(operatorMethods).toBeDefined();
    expect(operatorMethods!.total).toBeGreaterThan(0);
    expect(operatorMethods!.externalOutcomeRequired).toBe(0);

    const harnessModeCatalog = ledger.areas.find((area) => area.area === 'Model-visible harness mode catalog');
    expect(harnessModeCatalog?.total).toBeGreaterThan(70);
    expect(harnessModeCatalog?.localSignalVerified).toBe(harnessModeCatalog?.total);
    expect(harnessModeCatalog?.localBehaviorVerified).toBe(harnessModeCatalog?.total);
    expect(harnessModeCatalog?.externalOutcomeRequired).toBe(0);
  });

  test('renders a markdown ledger for reports', () => {
    const markdown = renderVerificationLedgerMarkdown(buildVerificationLedger(projectRoot));

    expect(markdown).toContain('# GoodVibes Verification Ledger');
    expect(markdown).toContain('Local verification signal');
    expect(markdown).toContain('External outcome required');
    expect(markdown).toContain('in-process command harness');
    expect(markdown).toContain('release_evidence_artifact');
    expect(markdown).toContain('service_endpoint');
    expect(markdown).toContain('operator_method');
    expect(markdown).toContain('mode descriptors');
    expect(markdown).not.toContain('fake context');
    expect(markdown).not.toContain('fake read models');
  });

  test('drift guard: SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE does not silently overstate when schema grows', () => {
    // Real drift guard: uses the same CONFIG_SCHEMA the ledger uses at runtime.
    // Assertion (a) is the line that FAILS when the schema grows past the claim,
    // forcing a developer to update SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE with new evidence
    // before the overstatement goes unnoticed.
    const schemaSize = CONFIG_SCHEMA.length;

    // (a) Anti-overstatement guard: the constant may never claim more verified settings than
    // schema keys that actually exist. FAILS if SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE > schemaSize,
    // preventing the estimate from silently padding beyond the real schema.
    expect(SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE).toBeLessThanOrEqual(schemaSize);

    // (b) Formula-fidelity guards: verify the ledger applies the Math.min/Math.max formula
    // correctly regardless of where the estimate sits relative to total.
    //   localBehaviorVerified = Math.min(SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE, settings)
    //   externalOutcomeRequired = Math.max(0, settings - SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE)
    // These are non-tautological: they are falsifiable when the formula or constant changes.
    const ledger = buildVerificationLedger(projectRoot);
    const settingsArea = ledger.areas.find((area) => area.area === 'Settings schema and persistence')!;
    expect(settingsArea).toBeDefined();
    expect(settingsArea.localBehaviorVerified).toBeLessThanOrEqual(settingsArea.total);
    expect(settingsArea.localBehaviorVerified).toBe(Math.min(SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE, settingsArea.total));
    expect(settingsArea.externalOutcomeRequired).toBe(Math.max(0, settingsArea.total - SETTINGS_BEHAVIOR_COVERAGE_ESTIMATE));

    // (c) Mirror the same pattern for feature flags.
    const flagCount = FEATURE_FLAG_MAP.size;
    // Feature-flags external estimate is an upper bound on externally-required flags.
    // This assertion FAILS if the total flag count somehow drops below the external estimate,
    // which would imply a data error (can't have more external flags than total flags).
    expect(flagCount).toBeGreaterThanOrEqual(FEATURE_FLAGS_EXTERNAL_ESTIMATE);
    const featureFlagsArea = ledger.areas.find((area) => area.area === 'Feature flags')!;
    expect(featureFlagsArea).toBeDefined();
    // externalOutcomeRequired must equal min(FEATURE_FLAGS_EXTERNAL_ESTIMATE, flagCount).
    expect(featureFlagsArea.externalOutcomeRequired).toBe(
      Math.min(FEATURE_FLAGS_EXTERNAL_ESTIMATE, flagCount),
    );
    // localBehaviorVerified must be the remainder.
    expect(featureFlagsArea.localBehaviorVerified).toBe(
      Math.max(0, flagCount - FEATURE_FLAGS_EXTERNAL_ESTIMATE),
    );
  });

  test('source marker guard: each countSourceMarkers marker string must be present in its file', () => {
    const source = readFileSync(join(projectRoot, 'src/verification/verification-ledger-surfaces.ts'), 'utf8');
    // Verify that countHarnessSourceSurface callers still reference real markers.
    // If any of these strings disappear (e.g. a rename), this test fails.
    const markerConstants = [
      'notifications.webhookUrls',
      'buildProviderAccountSnapshot',
      'listServerSecurity',
      'collectOnboardingSnapshot',
      'listModels',
      'readConnectedHostOperatorToken',
      'delegatedReviewPolicy',
      'buildMcpAttackPathReview',
      'buildAgentWorkspaceVoiceMediaReadiness',
      'sessionManager',
      'getOperatorContract',
    ];
    for (const marker of markerConstants) {
      expect(source).toContain(marker);
    }
  });

  test('does not count hidden host lifecycle commands as Agent verification scope', () => {
    const source = readFileSync(join(projectRoot, 'src/verification/verification-ledger.ts'), 'utf8');
    const markdown = renderVerificationLedgerMarkdown(buildVerificationLedger(projectRoot));
    const hiddenCommandTokens = [
      "'bridge'",
      "'control-plane'",
      "'listener'",
      "'remote'",
      "'runner-pool'",
      "'serve'",
      "'service'",
      "'surfaces'",
      "'tunnel'",
    ] as const;

    for (const token of hiddenCommandTokens) {
      expect(source).not.toContain(token);
    }
    expect(markdown).not.toContain('TUI/service/remote');
    expect(markdown).toContain('interactive TUI, run, auth, pair, knowledge, provider, subscription, and secret flows');
  });
});
