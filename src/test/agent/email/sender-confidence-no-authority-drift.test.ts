/**
 * PERMANENT REGRESSION GUARD — do not weaken.
 *
 * Sender confidence must stay a display concern. This walks the real source
 * tree and fails if it starts being read anywhere that could turn it into
 * permission.
 *
 * The check is deliberately a narrow allowlist rather than a clever heuristic:
 * a new file reading `displayedConfidence` has to be added here by hand, which
 * puts a human in front of the question "is this display, or is this becoming
 * authority?" — the exact question that gets skipped otherwise.
 *
 * The IMAP/SMTP service and the `Authentication-Results` parser moved to
 * `@pellux/goodvibes-sdk/platform/email`, which carries its own copy of this
 * guard over its own tree. That one cannot see this tree and this one cannot
 * see that one, so both are needed: the SDK's covers the parser and the
 * service, and this one covers the agent's describer and every agent surface
 * that could start branching on what it returns.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_ROOT = join(import.meta.dir, '..', '..', '..');

/**
 * Files permitted to read sender confidence, each because it renders it.
 *
 * Adding an entry is a review decision, not a formality: the question to
 * answer is whether the new reader DISPLAYS the value or BRANCHES on it.
 */
const CONFIDENCE_READERS = new Set([
  // Defines the type and computes it.
  'agent/untrusted-content.ts',
  // Renders it in the inbox listing.
  'input/commands/email-runtime.ts',
]);

/** Tokens that would indicate confidence being turned into a decision. */
const AUTHORITY_TOKENS = [
  'commandAuthority =',
  'canConfirm',
  'allowed: true',
  'surfaceAuthority(',
  'effectPermittedForProvenance',
];

function walkSourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    // The test tree is allowed to read confidence freely; it asserts on it.
    if (entry === 'test' || entry === 'node_modules') continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      walkSourceFiles(full, found);
    } else if (entry.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

describe('sender confidence never drifts into an authority decision', () => {
  const files = walkSourceFiles(SOURCE_ROOT);

  test('the source tree was actually walked, so a passing result means something', () => {
    // Guards against the walk silently finding nothing and the suite reporting
    // success for an empty set.
    expect(files.length).toBeGreaterThan(200);
  });

  test('only files that render sender confidence read it', () => {
    const readers: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      if (!text.includes('displayedConfidence')) continue;
      readers.push(file.slice(SOURCE_ROOT.length + 1));
    }

    const unexpected = readers.filter((relative) => !CONFIDENCE_READERS.has(relative));
    expect(
      unexpected,
      `these files read sender confidence but are not declared display sites. ` +
      `If the new reader DISPLAYS it, add it to CONFIDENCE_READERS. If it BRANCHES on it, ` +
      `that is the boundary failing and the change should not land: ${unexpected.join(', ')}`,
    ).toEqual([]);
  });

  test('no declared display site turns confidence into a permission', () => {
    for (const relative of CONFIDENCE_READERS) {
      const text = readFileSync(join(SOURCE_ROOT, relative), 'utf-8');
      for (const line of text.split('\n')) {
        if (!line.includes('displayedConfidence')) continue;
        // A line mentioning confidence must not also be deciding something.
        for (const token of AUTHORITY_TOKENS) {
          expect(
            line.includes(token),
            `${relative} reads sender confidence on the same line as "${token}", ` +
            `which is what turning display into authority looks like: ${line.trim()}`,
          ).toBe(false);
        }
      }
    }
  });

  test('commandAuthority is only ever assigned the literal none', () => {
    // The type already pins this; the assertion catches a widening of the type
    // itself, which would otherwise pass typecheck and quietly open the door.
    const source = readFileSync(join(SOURCE_ROOT, 'agent', 'untrusted-content.ts'), 'utf-8');
    expect(source).toContain("readonly commandAuthority: 'none'");
    const assignments = source.match(/commandAuthority:\s*'[a-z-]+'/g) ?? [];
    expect(assignments.length).toBeGreaterThan(0);
    for (const assignment of assignments) {
      expect(assignment).toBe("commandAuthority: 'none'");
    }
  });
});
