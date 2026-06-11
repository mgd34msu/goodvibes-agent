import { describe, expect, test } from 'bun:test';
import {
  buildVerificationLedger,
  renderVerificationLedgerMarkdown,
} from '../../verification/verification-ledger.ts';
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
    expect(ledger.totals.localBehaviorPercent).toBeGreaterThan(70);
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
