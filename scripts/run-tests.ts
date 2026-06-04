import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SEARCH_ROOT = join(ROOT, 'src');
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx)$/;
const TEST_TMP_ROOT = join(ROOT, '.test-tmp', 'suite');

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
process.exit(result.exitCode ?? 1);
