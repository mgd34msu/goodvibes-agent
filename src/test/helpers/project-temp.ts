import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_TEST_TMP_ROOT = join(process.cwd(), '.test-tmp');

// Directories created by makeProjectTempDir since the last sweep (see
// sweepCreatedProjectTempDirs below). Directories created via
// makeLongLivedProjectTempDir are deliberately NEVER pushed here — see that
// function's own doc comment for why.
const _createdDirs: string[] = [];
let _exitHandlerRegistered = false;

function ensureProjectTestTmpRoot(): string {
  if (!existsSync(PROJECT_TEST_TMP_ROOT)) {
    mkdirSync(PROJECT_TEST_TMP_ROOT, { recursive: true });
  }
  return PROJECT_TEST_TMP_ROOT;
}

function removeAll(dirs: readonly string[]): void {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

/**
 * Fallback only — confirmed empirically (2026-07-28) that Bun's test runner
 * never fires `process.on('exit', ...)` handlers, so under `bun test` this
 * has always been dead code: every directory created here was actually only
 * ever reclaimed by scripts/stale-tmp-sweep.ts's sweepProjectTestTmpRoot
 * (the unconditional wipe scripts/run-tests.ts runs before and after every
 * invocation), never by this handler. `sweepCreatedProjectTempDirs` below
 * (wired to a global `afterEach` from src/test/helpers/preload.ts) is the
 * real per-test cleanup mechanism now. This handler stays only as a backstop
 * for the (currently theoretical — nothing outside src/test imports this
 * module) case of a plain `bun run` script importing it directly, where
 * process.on('exit') DOES fire correctly (verified separately).
 */
function ensureExitHandler(): void {
  if (_exitHandlerRegistered) return;
  _exitHandlerRegistered = true;
  process.on('exit', () => {
    removeAll(_createdDirs.splice(0));
  });
}

/**
 * Creates a fresh scratch directory under this repo's `.test-tmp/` root and
 * registers it for cleanup after the CURRENTLY RUNNING test finishes (see
 * sweepCreatedProjectTempDirs). Use this for the common case: a directory
 * created fresh per test (or per file) that nothing else needs once that
 * test/file is done — which is true of nearly every call site in this repo.
 *
 * Do NOT use this for a directory meant to be created once and reused across
 * MANY tests or MANY files (a module-level memoized singleton, e.g. a
 * `let cached: string | null; if (cached) return cached;` pattern) — the
 * per-test sweep would delete it out from under every later test that still
 * needs it. Use makeLongLivedProjectTempDir for that instead.
 */
export function makeProjectTempDir(prefix: string): string {
  ensureExitHandler();
  const dir = mkdtempSync(join(ensureProjectTestTmpRoot(), `${prefix}-`));
  _createdDirs.push(dir);
  return dir;
}

/**
 * Same as makeProjectTempDir, but for a directory deliberately meant to
 * outlive any single test — a module-level singleton created once (guarded
 * by the caller's own `if (cached) return cached`) and reused across many
 * tests, possibly across many test files sharing this cached module (e.g.
 * src/test/helpers/runtime-services.ts's getTestRoots()).
 *
 * Never auto-swept by sweepCreatedProjectTempDirs — relies solely on
 * scripts/stale-tmp-sweep.ts's unconditional wipe of the whole `.test-tmp/`
 * root before and after each `bun run test` invocation, exactly like every
 * directory in this repo did before the per-test sweep existed. This is not
 * a regression for these call sites: nothing ever cleaned them up mid-run
 * before either (the process.on('exit') handler never fired under bun test,
 * confirmed empirically), so relying on the outer sweep is the same
 * behavior this repo has always actually had for them in practice.
 */
export function makeLongLivedProjectTempDir(prefix: string): string {
  ensureExitHandler();
  return mkdtempSync(join(ensureProjectTestTmpRoot(), `${prefix}-`));
}

/**
 * Removes every directory created by makeProjectTempDir since the last call
 * to this function, then clears the tracking list.
 *
 * Wired to a single global `afterEach`, registered ONCE at the top level of
 * src/test/helpers/preload.ts (which runs before any test file is
 * registered, at Bun's preload phase) — confirmed empirically that a hook
 * registered there fires after EVERY test in EVERY file, in this order:
 * a test file's own locally-registered afterEach hooks fire first
 * (inner-to-outer), and this global one fires last of all. That ordering is
 * exactly what makes this safe: by the time this runs for a given test, any
 * file-local cleanup logic that still needed the directory (writing a final
 * fixture, asserting on it, etc.) has already run.
 *
 * This is NOT registered lazily inside makeProjectTempDir itself — an
 * earlier version of this fix tried exactly that with `afterAll` and broke
 * a real test file (src/test/input/model-picker.test.ts, whose outer
 * describe's beforeEach calls makeProjectTempDir fresh for every one of its
 * ~115 tests): registering a lifecycle hook dynamically from deep inside an
 * already-executing beforeEach, many times over, across nested describes,
 * does not reliably scope to "this test" or "this file" the way registering
 * a single hook once, at module load time before any test runs, does.
 * Exporting one sweep function and calling it from exactly one place (this
 * module's preload-time afterEach) avoids that whole class of bug.
 */
export function sweepCreatedProjectTempDirs(): void {
  removeAll(_createdDirs.splice(0));
}
