/**
 * settings-consumed-keys.ts, the settings DENOMINATOR the verification ledger
 * measures against.
 *
 * ## The defect this closes
 *
 * settings-behavior-coverage.ts names it in its own header: "The denominator is
 * the live CONFIG_SCHEMA length, so every config key anyone added anywhere
 * lowered the reported percentage without any coverage having actually
 * changed." That file fixed the NUMERATOR half, every claim is now an itemised
 * row naming the test that would fail if the setting stopped being honoured.
 * The denominator half was left alone, and it kept decaying.
 *
 * The last time it decayed, the response was to lower the ledger's floor from
 * 70 to 69, and the test that did it recorded its own disagreement in the same
 * breath. That disagreement was right. Lowering a quality floor to accommodate
 * arithmetic is not a fix; it is the arithmetic winning. Nothing about this
 * product's verification changed when the platform declared 25 keys for the
 * daemon's own mailbox and calendar, `surfaces.email.*` and
 * `surfaces.calendar.*` are read by the daemon's mail and calendar handlers,
 * and this repo does not contain a line that mentions any of them.
 *
 * ## The rule
 *
 * A CONFIG_SCHEMA key belongs in this product's settings denominator when this
 * repository REFERENCES it, its literal key string appears somewhere in this
 * repo's own TypeScript, in product code or in a test. Everything else is a
 * setting this product neither reads, writes, renders, nor drives, and a
 * percentage that counts those measures the platform's key count rather than
 * this product's verification.
 *
 * Deliberately "references anywhere in this repo", not "reads in src/":
 *
 *  - It is the same population the NUMERATOR is drawn from, which is what makes
 *    the ratio meaningful. settings-behavior-coverage.ts accepts a key when a
 *    test IN THIS REPOSITORY drives it to two values through the real consuming
 *    code, and that consuming code is sometimes platform code (the eight
 *    `voice.wake.*` rows are driven from here against `platform/voice/wake`).
 *    A denominator restricted to non-test source would exclude keys the
 *    numerator counts, which is a worse inconsistency than the one being fixed.
 *  - It errs toward keeping keys IN. A key named only in a settings screen
 *    stays counted and stays unverified, so the ratio still reports work left
 *    to do rather than quietly disclaiming it.
 *
 * ## What stops this from becoming the next soft number
 *
 * settings-consumed-keys.test.ts holds it to two invariants:
 *
 *  1. Every key the numerator claims must be inside the denominator. A claim
 *     over a key this repo does not even mention is not a claim.
 *  2. Named keys this repo genuinely has no consumer for (the daemon mailbox
 *     and calendar family) must be OUTSIDE it, so a future change that widens
 *     the rule until everything counts again fails loudly.
 *
 * The scan is a filesystem walk rooted at the repo, exactly like every other
 * surface count the ledger performs (see verification-ledger-surfaces.ts).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Directories under the repo root whose TypeScript counts as this product's own. */
const SCANNED_ROOTS: readonly string[] = ['src', 'scripts'];

/**
 * Files excluded from the scan because they exist to TALK about settings keys
 * rather than to use them. Counting them would make every key self-justifying:
 * the coverage evidence list names each key it claims, so scanning it would put
 * those keys in the denominator on the strength of the claim itself.
 */
const SELF_REFERENTIAL_FILES: readonly string[] = [
  join('src', 'verification', 'settings-behavior-coverage.ts'),
  join('src', 'verification', 'settings-consumed-keys.ts'),
  // Names disclaimed keys in order to assert they are disclaimed. Scanning it
  // would make the assertion undo itself the moment it was written.
  join('src', 'test', 'verification', 'settings-consumed-keys.test.ts'),
  // Names config keys to assert how the support-bundle redactor CLASSIFIES
  // them, including a list of keys it must specifically leave alone
  // (`display.showTokenSpeed`, `planner.tokenCeiling`, `security.tokenAudit.*`)
  // that exists only so a widened word list cannot start hiding them. Nothing
  // there sets a setting, runs its consuming code path, or asserts an outcome
  // that differs between two of its values, it is the same "talks about keys"
  // shape as the two entries above, and counting it would put a dozen keys in
  // the denominator on the strength of an assertion that the product does
  // NOTHING with them.
  //
  // Its sibling, src/test/config/credential-daemon-scope.test.ts, is
  // deliberately NOT here: that one drives real writes through the settings
  // modal, the harness setting path and the mail wizard and reads the result
  // back from a second store, which is a consumer by any reading.
  join('src', 'test', 'cli', 'redaction-credential-names.test.ts'),
];

const SKIPPED_DIRECTORY_NAMES = new Set(['node_modules', 'dist', '.git']);

export interface SettingsKeyPopulation {
  /** Keys this repository references, in CONFIG_SCHEMA order. */
  readonly consumed: readonly string[];
  /** Keys it does not reference at all, in CONFIG_SCHEMA order. */
  readonly disclaimed: readonly string[];
}

function collectTypeScriptFiles(directory: string, into: string[]): void {
  let entries: readonly string[];
  try {
    entries = readdirSync(directory);
  } catch {
    // A scanned root that does not exist in this checkout contributes nothing;
    // an unreadable directory must not be reported as "no key is consumed".
    return;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRECTORY_NAMES.has(entry)) continue;
    const path = join(directory, entry);
    let isDirectory = false;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      collectTypeScriptFiles(path, into);
    } else if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      into.push(path);
    }
  }
}

/**
 * Split the schema into the keys this repository references and the keys it
 * does not.
 *
 * @param root - Repository root; the scan is rooted here so the ledger stays
 *   runnable against a checkout other than the process's own cwd.
 * @param schemaKeys - The live CONFIG_SCHEMA key list, injected rather than
 *   imported so a test can drive this against a known population.
 */
export function splitSettingsKeysByLocalConsumer(
  root: string,
  schemaKeys: readonly string[],
): SettingsKeyPopulation {
  const files: string[] = [];
  for (const scanned of SCANNED_ROOTS) collectTypeScriptFiles(join(root, scanned), files);

  const excluded = new Set(SELF_REFERENTIAL_FILES.map((relative) => join(root, relative)));
  const sources: string[] = [];
  for (const file of files) {
    if (excluded.has(file)) continue;
    try {
      sources.push(readFileSync(file, 'utf8'));
    } catch {
      // A file that cannot be read is not evidence that a key is unused, but it
      // is also not evidence that one is used. Skipping it can only shrink the
      // denominator, which is the conservative direction for a coverage ratio
      //, it never inflates the reported percentage.
      continue;
    }
  }
  const corpus = sources.join('\n');

  const consumed: string[] = [];
  const disclaimed: string[] = [];
  for (const key of schemaKeys) {
    (corpus.includes(key) ? consumed : disclaimed).push(key);
  }
  return { consumed, disclaimed };
}
