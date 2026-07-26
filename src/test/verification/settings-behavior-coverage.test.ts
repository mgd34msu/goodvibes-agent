import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONFIG_SCHEMA } from '@pellux/goodvibes-sdk/platform/config';
import {
  SETTINGS_BEHAVIOR_COVERAGE_BASELINE,
  SETTINGS_BEHAVIOR_COVERAGE_COUNT,
  SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE,
} from '../../verification/settings-behavior-coverage.ts';

const projectRoot = resolve(join(import.meta.dir, '..', '..', '..'));

/**
 * These tests are what make the settings coverage numerator auditable rather
 * than assertable. The numerator can only be raised by adding an evidence row,
 * and a row only survives if the key is real and the test it names genuinely
 * mentions that key. Padding the number is therefore not a one-line edit — it
 * requires forging a test file, which is a thing a reviewer can see.
 */
describe('settings behaviour coverage evidence', () => {
  test('the inherited baseline may never grow — new claims must be itemised', () => {
    // 184 is the un-itemised count inherited from commit 0ea661ea. It has no
    // per-key list, so it can never be a place to hide new claims. Raising it
    // is the exact move this whole file exists to prevent; anything new goes
    // into SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE where it can be checked.
    expect(SETTINGS_BEHAVIOR_COVERAGE_BASELINE).toBeLessThanOrEqual(184);
  });

  test('the reported count is derived from the evidence list, not hand-written', () => {
    expect(SETTINGS_BEHAVIOR_COVERAGE_COUNT).toBe(
      SETTINGS_BEHAVIOR_COVERAGE_BASELINE + SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE.length,
    );
  });

  test('every evidence key is a real CONFIG_SCHEMA key', () => {
    // Set<string>, not Set<ConfigKey>: evidence rows carry plain strings so that a
    // key deleted from the schema still compiles here and fails as data instead of
    // failing to build.
    const schemaKeys = new Set<string>(CONFIG_SCHEMA.map((entry) => entry.key));
    const unknown = SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE
      .map((entry) => entry.key)
      .filter((key) => !schemaKeys.has(key));
    // A key that no longer exists must not keep inflating the numerator.
    expect(unknown).toEqual([]);
  });

  test('no key is counted twice', () => {
    const keys = SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE.map((entry) => entry.key);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    expect(duplicates).toEqual([]);
  });

  test('every evidence row names a test file that exists', () => {
    const missing = SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE
      .filter((entry) => !existsSync(join(projectRoot, entry.test)))
      .map((entry) => `${entry.key} -> ${entry.test}`);
    expect(missing).toEqual([]);
  });

  test('every evidence row points at a test that actually exercises its key', () => {
    // The cheap, robust proxy for "this test is about this setting": the test
    // file mentions the key by name. Every behaviour test written for these
    // settings puts the key in its test title precisely so this holds. It does
    // not prove the assertion is strong, but it does stop a row from pointing
    // at an unrelated file to buy a point.
    const contents = new Map<string, string>();
    const unsupported: string[] = [];
    for (const entry of SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE) {
      const path = join(projectRoot, entry.test);
      if (!existsSync(path)) continue; // reported by the previous test
      let text = contents.get(path);
      if (text === undefined) {
        text = readFileSync(path, 'utf8');
        contents.set(path, text);
      }
      if (!text.includes(entry.key)) unsupported.push(`${entry.key} -> ${entry.test}`);
    }
    expect(unsupported).toEqual([]);
  });

  test('every evidence row states what it asserts', () => {
    const undocumented = SETTINGS_BEHAVIOR_COVERAGE_EVIDENCE
      .filter((entry) => entry.asserts.trim().length < 12)
      .map((entry) => entry.key);
    expect(undocumented).toEqual([]);
  });

  test('the total claim never exceeds the schema it is drawn from', () => {
    expect(SETTINGS_BEHAVIOR_COVERAGE_COUNT).toBeLessThanOrEqual(CONFIG_SCHEMA.length);
  });
});
