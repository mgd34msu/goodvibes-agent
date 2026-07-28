import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { trackTempDir } from './temp-registry.ts';

const PROJECT_TEST_TMP_ROOT = join(process.cwd(), '.test-tmp');

function ensureProjectTestTmpRoot(): string {
  if (!existsSync(PROJECT_TEST_TMP_ROOT)) {
    mkdirSync(PROJECT_TEST_TMP_ROOT, { recursive: true });
  }
  return PROJECT_TEST_TMP_ROOT;
}

/**
 * A temp directory under `<repo>/.test-tmp` rather than the OS temp dir, for
 * tests whose workspace must sit inside this git checkout.
 *
 * Removal is registered with the shared temp registry, which the test preload
 * sweeps from a top-level `afterAll`. This was previously a
 * `process.on('exit', …)` handler, which `bun test` never runs — so nothing was
 * ever removed and a fully green run left every directory behind.
 */
export function makeProjectTempDir(prefix: string): string {
  return trackTempDir(mkdtempSync(join(ensureProjectTestTmpRoot(), `${prefix}-`)));
}
