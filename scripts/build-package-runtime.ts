#!/usr/bin/env bun
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const outDir = join(root, 'dist', 'package');
const entry = join(outDir, 'main.js');

rmSync(outDir, { recursive: true, force: true });

execFileSync('bun', ['build', 'src/main.ts', '--target=bun', '--outdir', outDir], {
  cwd: root,
  stdio: 'inherit',
});

if (!existsSync(entry)) {
  throw new Error(`package runtime build did not create ${entry}`);
}

const size = statSync(entry).size;
if (size <= 0) {
  throw new Error(`package runtime build created an empty entrypoint: ${entry}`);
}

console.log(`package runtime built (${Math.round(size / 1024 / 1024)} MiB entrypoint)`);
