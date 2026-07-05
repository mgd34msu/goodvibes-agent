#!/usr/bin/env bun
/**
 * sdk-release-gates — publish-blocking checks that keep the local-SDK dev fast
 * path (scripts/sdk-dev.ts) from ever leaking into a published @pellux/goodvibes-agent.
 *
 * Ported from the TUI's scripts/publish-check.ts (the reference implementation),
 * adapted for the Agent: the SDK is pinned as a devDependency here (it is bundled
 * into the compiled binary at build time, not shipped as a runtime node_modules
 * dependency), so the pin is read from devDependencies first.
 *
 * Three gates, each a pure function so tests can drive them against fixtures:
 *   1. sdkPinAgreementIssues  — overlay marker absent, pin is exact semver, and
 *      the pin / bun.lock resolution / installed package.json version all agree.
 *      A pin bump whose lockfile never moved ships the OLD SDK silently.
 *   2. nonNpmSdkImportOffenders — no source file imports the SDK by anything but
 *      the npm specifier (relative / absolute / file: local-path imports must
 *      never ship). scripts/sdk-dev.ts is the sole sanctioned local-path holder
 *      and lives outside the swept src tree.
 *   3. sdkReleaseGateIssues   — the two above combined, for one call site.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const SDK_PACKAGE = '@pellux/goodvibes-sdk';
export const OVERLAY_MARKER_REL = 'node_modules/@pellux/goodvibes-sdk/.local-sdk-overlay.json';

/** Read the SDK pin from devDependencies (Agent bundles the SDK), then dependencies. */
export function readSdkPin(root: string): string | undefined {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return pkg.devDependencies?.[SDK_PACKAGE] ?? pkg.dependencies?.[SDK_PACKAGE];
}

/**
 * Overlay-marker + exact-pin + pin/lock/installed agreement. Returns a list of
 * human-readable issue strings; empty means the gate passes.
 */
export function sdkPinAgreementIssues(root: string): string[] {
  const issues: string[] = [];

  // The local-SDK overlay (scripts/sdk-dev.ts link) is a development-only state.
  if (existsSync(join(root, OVERLAY_MARKER_REL))) {
    issues.push('local SDK overlay is active — run `bun scripts/sdk-dev.ts restore` before publishing');
  }

  const pin = readSdkPin(root);
  if (typeof pin !== 'string' || !/^\d+\.\d+\.\d+$/.test(pin)) {
    issues.push(`${SDK_PACKAGE} dependency must be an exact semver to publish (found: ${String(pin)})`);
    return issues; // agreement is meaningless without a valid pin
  }

  // The pin, the lockfile resolution, and the installed package must all agree —
  // a pin bump whose lockfile never moved ships the OLD SDK silently (bun can
  // serve a cached older resolution; caught live on the TUI's 0.37.2 bump).
  const installedPkgPath = join(root, 'node_modules/@pellux/goodvibes-sdk/package.json');
  const installed = existsSync(installedPkgPath)
    ? (JSON.parse(readFileSync(installedPkgPath, 'utf8')) as { version?: string }).version
    : undefined;
  if (installed !== pin) {
    issues.push(
      `installed ${SDK_PACKAGE} (${String(installed)}) does not match the pin (${pin}) — run bun update ${SDK_PACKAGE} and commit the lockfile`,
    );
  }

  const lockPath = join(root, 'bun.lock');
  const lock = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : '';
  if (!lock.includes(`${SDK_PACKAGE}@${pin}`)) {
    issues.push(`bun.lock does not resolve ${SDK_PACKAGE}@${pin} — the lockfile lagged the pin bump`);
  }

  return issues;
}

/**
 * Sweep a source tree for goodvibes-sdk imports that are not the npm specifier.
 * Returns "relativePath: specifier" strings for every offender; empty passes.
 */
export function nonNpmSdkImportOffenders(root: string, srcDir = 'src'): string[] {
  const offenders: string[] = [];
  const importOfSdk = /(?:from\s+|require\(|import\()\s*['"]([^'"]*goodvibes-sdk[^'"]*)['"]/g;
  const srcRoot = join(root, srcDir);
  if (!existsSync(srcRoot)) return offenders;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.ts')) {
        const text = readFileSync(join(root, rel), 'utf8');
        for (const m of text.matchAll(importOfSdk)) {
          if (!m[1].startsWith(SDK_PACKAGE)) offenders.push(`${rel}: ${m[1]}`);
        }
      }
    }
  };
  walk(srcDir);
  return offenders;
}

/** Every SDK release-gate issue combined, for a single publish-check call site. */
export function sdkReleaseGateIssues(root: string, srcDir = 'src'): string[] {
  return [
    ...sdkPinAgreementIssues(root),
    ...nonNpmSdkImportOffenders(root, srcDir).map((o) => `non-npm goodvibes-sdk import found in source: ${o}`),
  ];
}

if (import.meta.main) {
  const root = process.cwd();
  const issues = sdkReleaseGateIssues(root);
  if (issues.length > 0) {
    for (const issue of issues) console.error(`sdk-release-gate: ${issue}`);
    process.exit(1);
  }
  console.log('sdk-release-gate: pin/lock/installed agree, overlay absent, all SDK imports are npm-specifier.');
}
