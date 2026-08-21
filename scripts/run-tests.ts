import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sweepProjectTestTmpRoot, sweepStaleRealTmpDirs } from './stale-tmp-sweep.ts';

const ROOT = process.cwd();
const SEARCH_ROOT = join(ROOT, 'src');
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx)$/;
const TEST_TMP_ROOT = join(ROOT, '.test-suite-tmp');

function collectTests(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTests(fullPath, acc);
      continue;
    }
    if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
      acc.push(fullPath);
    }
  }
}

const testFiles: string[] = [];
collectTests(SEARCH_ROOT, testFiles);
testFiles.sort((a, b) => a.localeCompare(b));

rmSync(TEST_TMP_ROOT, { recursive: true, force: true });
mkdirSync(TEST_TMP_ROOT, { recursive: true });

// Sweep stale entries in .test-tmp (created by makeProjectTempDir in test
// helpers) and this project's own known-prefixed scratch directories in the
// real os.tmpdir() (a handful of tests still need a location that is
// guaranteed outside any git repo, see scripts/stale-tmp-sweep.ts). Both run
// before and after the suite to prevent accumulation from a killed process.
function sweepAll(): void {
  sweepProjectTestTmpRoot();
  const { swept, scanned } = sweepStaleRealTmpDirs();
  if (swept.length > 0) {
    console.log(`tmp-sweep: removed ${swept.length} stale director${swept.length === 1 ? 'y' : 'ies'} from os.tmpdir() (scanned ${scanned} entries).`);
  }
}

sweepAll();

if (testFiles.length === 0) {
  console.error('No test files found under src/');
  process.exit(1);
}

console.log(`Test files: ${testFiles.length}`);
const result = Bun.spawnSync(['bun', 'test', '--max-concurrency=1', ...testFiles], {
  cwd: ROOT,
  env: {
    ...process.env,
    TMPDIR: TEST_TMP_ROOT,
    TMP: TEST_TMP_ROOT,
    TEMP: TEST_TMP_ROOT,
  },
  stdio: ['inherit', 'inherit', 'inherit'],
});

rmSync(TEST_TMP_ROOT, { recursive: true, force: true });
sweepAll();
process.exit(result.exitCode ?? 1);
