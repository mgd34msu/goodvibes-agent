#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The dependency-free write primitives, on purpose: this
// package declares no runtime dependencies, so anything this shim imports must
// not statically reach @pellux/goodvibes-sdk. Both exits below write the reason
// straight to descriptor 2, because a stream write issued immediately before
// process.exit() can still be in flight when the process stops existing, and
// this shim's whole job is explaining a broken install out loud.
import { writeFatalLine } from '../src/utils/fatal-boot-write.ts';

const runtimeEntry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'package', 'main.js');

if (!existsSync(runtimeEntry)) {
  writeFatalLine([
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
  writeFatalLine([
    `goodvibes-agent failed to launch the packaged runtime: ${message}`,
    'Reinstall with Bun: bun add -g @pellux/goodvibes-agent',
    'Then run: goodvibes-agent',
  ].join('\n'));
  process.exit(1);
}
