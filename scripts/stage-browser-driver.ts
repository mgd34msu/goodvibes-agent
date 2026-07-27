#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Puts the browser driver next to the compiled binaries.
 *
 * A `bun build --compile` executable carries no node_modules, so
 * `require('playwright-core')` finds nothing inside it. The driver also cannot
 * be bundled — it reads its own files by path at runtime. Shipping it beside
 * the executable is what makes browser control exist in the released artifact
 * rather than only in a source checkout; the runtime looks here first (see
 * driverSearchDirectories in src/browser/browser-provision-io.ts).
 */

const root = process.cwd();
const source = join(root, 'node_modules', 'playwright-core');
const destination = join(root, 'dist', 'playwright-core');

if (!existsSync(source)) {
  throw new Error(`browser driver not found at ${source}; run bun install first`);
}

mkdirSync(join(root, 'dist'), { recursive: true });
rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true, dereference: true });

if (!existsSync(join(destination, 'index.js')) || !existsSync(join(destination, 'cli.js'))) {
  throw new Error(`browser driver staged incompletely at ${destination}`);
}
console.log(`browser driver staged beside the binaries at ${destination}`);
