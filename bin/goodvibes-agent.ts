#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtimeEntry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'package', 'main.js');

if (!existsSync(runtimeEntry)) {
  console.error([
    'goodvibes-agent packaged runtime is missing.',
    'Reinstall with Bun: bun add -g @pellux/goodvibes-agent',
    'If the command is not on PATH, add Bun global bin: export PATH="$HOME/.bun/bin:$PATH"',
  ].join('\n'));
  process.exit(1);
}

try {
  await import(pathToFileURL(runtimeEntry).href);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error([
    `goodvibes-agent failed to launch the packaged runtime: ${message}`,
    'Reinstall with Bun: bun add -g @pellux/goodvibes-agent',
    'Then run: goodvibes-agent',
  ].join('\n'));
  process.exit(1);
}
