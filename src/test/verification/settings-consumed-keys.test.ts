/**
 * settings-consumed-keys.test.ts
 *
 * The denominator fix is only worth having if it cannot itself become the next
 * soft number. Correcting what a ratio measures is a legitimate move exactly
 * once per real defect; widening the rule until the inconvenient keys fall out
 * is the same act as lowering a floor, wearing different clothes.
 *
 * These are the invariants that tell the two apart.
 */

import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { CONFIG_SCHEMA } from '@pellux/goodvibes-sdk/platform/config';
import { splitSettingsKeysByLocalConsumer } from '../../verification/settings-consumed-keys.ts';
import {
  SETTINGS_BEHAVIOR_COVERAGE_BASELINE,
  SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE,
} from '../../verification/settings-behavior-coverage.ts';
import { buildVerificationLedger } from '../../verification/verification-ledger.ts';

const projectRoot = resolve(join(import.meta.dir, '..', '..', '..'));
const schemaKeys = CONFIG_SCHEMA.map((entry) => entry.key);

/** The keys this round proved this repo has no consumer for. */
const DAEMON_MAILBOX_AND_CALENDAR_PREFIXES = ['surfaces.email.', 'surfaces.calendar.'] as const;

describe('the settings denominator counts this product, not the platform', () => {
  test('every key the numerator claims is inside the denominator', () => {
    // A claim over a key this repo does not even mention is not a claim. This
    // is the consistency the old formula lacked: the numerator was drawn from
    // itemised local evidence while the denominator was the platform's whole
    // key count, so the two were never populations of the same thing.
    const { consumed } = splitSettingsKeysByLocalConsumer(projectRoot, schemaKeys);
    const counted = new Set(consumed);
    const claimedWithoutMention = SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE
      .map((entry) => entry.key)
      .filter((key) => !counted.has(key));
    expect(claimedWithoutMention).toEqual([]);
  });

  test('the numerator can never exceed the denominator it is reported over', () => {
    const { consumed } = splitSettingsKeysByLocalConsumer(projectRoot, schemaKeys);
    const numerator = SETTINGS_BEHAVIOR_COVERAGE_BASELINE + SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE.length;
    expect(numerator).toBeLessThanOrEqual(consumed.length);
  });

  test('the daemon mailbox and calendar keys are outside it, and stay outside', () => {
    // The 25 keys that triggered the floor being lowered. They are read by the
    // daemon's mail and calendar handlers; this repo contains no line that
    // names any of them. If a future change starts counting them again without
    // a consumer arriving, this fails rather than the floor sagging.
    const { consumed, disclaimed } = splitSettingsKeysByLocalConsumer(projectRoot, schemaKeys);
    const matches = (key: string): boolean =>
      DAEMON_MAILBOX_AND_CALENDAR_PREFIXES.some((prefix) => key.startsWith(prefix));

    const inSchema = schemaKeys.filter(matches);
    expect(inSchema.length).toBeGreaterThanOrEqual(25);
    expect(consumed.filter(matches)).toEqual([]);
    expect(disclaimed.filter(matches)).toEqual(inSchema);
  });

  test('the rule is a real filter, not one that keeps everything or drops everything', () => {
    // Guards the two degenerate ways this could be "fixed": a rule that counts
    // every key (the defect, restored) and a rule that counts almost none (the
    // denominator quietly shrunk until any numerator looks good).
    const { consumed, disclaimed } = splitSettingsKeysByLocalConsumer(projectRoot, schemaKeys);
    expect(consumed.length + disclaimed.length).toBe(schemaKeys.length);
    expect(consumed.length).toBeLessThan(schemaKeys.length);
    // At least half the schema must still be counted against this product. A
    // rule that disclaims more than that is not describing a product's
    // responsibility any more.
    expect(consumed.length).toBeGreaterThan(schemaKeys.length / 2);
  });

  test('a key nothing references is disclaimed, and a referenced one is not', () => {
    // Drives the rule itself against a known population rather than trusting
    // the live schema to contain both cases.
    const population = splitSettingsKeysByLocalConsumer(projectRoot, [
      'surfaces.email.imapHost',
      'settings-consumed-keys-fixture-key-that-appears-nowhere',
      'theme',
    ]);
    expect(population.disclaimed).toContain('surfaces.email.imapHost');
    expect(population.disclaimed).toContain('settings-consumed-keys-fixture-key-that-appears-nowhere');
    expect(population.consumed).toContain('theme');
  });

  test('the ledger reports the derived denominator, not the raw schema length', () => {
    const ledger = buildVerificationLedger(projectRoot);
    const settingsArea = ledger.areas.find((area) => area.area === 'Settings schema and persistence');
    const { consumed } = splitSettingsKeysByLocalConsumer(projectRoot, schemaKeys);
    expect(settingsArea?.total).toBe(consumed.length);
    expect(settingsArea?.total).toBeLessThan(CONFIG_SCHEMA.length);
    // And the area says so in words, so a reader of the rendered ledger is not
    // left to infer why the number differs from the platform's key count.
    expect(settingsArea?.notes).toContain('this repository references');
  });
});
