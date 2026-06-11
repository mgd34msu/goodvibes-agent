import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_TEST_TMP_ROOT = join(process.cwd(), '.test-tmp');

// Tracks all dirs created by makeProjectTempDir in this process for exit-time cleanup.
const _createdDirs: string[] = [];
let _exitHandlerRegistered = false;

function ensureProjectTestTmpRoot(): string {
  if (!existsSync(PROJECT_TEST_TMP_ROOT)) {
    mkdirSync(PROJECT_TEST_TMP_ROOT, { recursive: true });
  }
  return PROJECT_TEST_TMP_ROOT;
}

function ensureExitHandler(): void {
  if (_exitHandlerRegistered) return;
  _exitHandlerRegistered = true;
  process.on('exit', () => {
    for (const dir of _createdDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    }
  });
}

export function makeProjectTempDir(prefix: string): string {
  ensureExitHandler();
  const dir = mkdtempSync(join(ensureProjectTestTmpRoot(), `${prefix}-`));
  _createdDirs.push(dir);
  return dir;
}
