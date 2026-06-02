#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtimeEntry = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'package', 'main.js');

if (!existsSync(runtimeEntry)) {
  console.error('goodvibes-agent packaged runtime is missing. Reinstall @pellux/goodvibes-agent with Bun.');
  process.exit(1);
}

await import(pathToFileURL(runtimeEntry).href);
