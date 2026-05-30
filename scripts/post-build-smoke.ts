#!/usr/bin/env bun
/**
 * Post-build smoke test for the GoodVibes Agent binary.
 *
 * This script never starts or owns a daemon. It only verifies that the compiled
 * Agent executable launches, reports its version, and does not emit packaged
 * module-resolution errors.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const binaryIndex = args.indexOf('--binary');
const binary = binaryIndex !== -1 && args[binaryIndex + 1]
  ? args[binaryIndex + 1]
  : join(root, 'dist', 'goodvibes-agent');

function fail(message: string): never {
  console.error(`[agent-smoke] FAIL: ${message}`);
  process.exit(1);
}

if (!existsSync(binary)) {
  fail(`Binary not found: ${binary}`);
}

const cwd = join(tmpdir(), `goodvibes-agent-smoke-${process.pid}`);
rmSync(cwd, { recursive: true, force: true });
mkdirSync(cwd, { recursive: true });

try {
  const result = spawnSync(binary, ['--version'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    fail(`${binary} --version failed with status ${result.status}`);
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (output.includes('sqlite-vec') || output.includes('$bunfs/root')) {
    console.error(output);
    fail('compiled Agent emitted a sqlite-vec or $bunfs module-resolution error');
  }

  if (!result.stdout.trim().startsWith('goodvibes-agent ')) {
    console.error(result.stdout);
    console.error(result.stderr);
    fail('unexpected --version output');
  }

  console.log(`[agent-smoke] PASS: ${result.stdout.trim()}`);
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
