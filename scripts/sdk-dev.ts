#!/usr/bin/env bun
/**
 * sdk-dev — rapid local SDK development for the Agent TUI.
 *
 * `link`    Build the local SDK checkout (~/Projects/goodvibes-sdk) and overlay
 *           its packages/sdk/dist (and package.json) into this repo's
 *           node_modules/@pellux/goodvibes-sdk, so SDK changes are testable in
 *           the Agent immediately — no npm release round-trip.
 * `status`  Report whether the overlay is active and what it was built from.
 * `restore` Remove the overlay and reinstall the pinned npm version byte-exact.
 *
 * The overlay writes a marker file (.local-sdk-overlay.json) inside the
 * package directory. Release tooling (scripts/release.ts preflight and
 * scripts/publish-check.ts) hard-fails while the marker exists or while the
 * package.json dependency is anything but an exact semver — so the fast path
 * cannot leak into a release. CI is immune regardless: it fresh-installs from
 * the lockfile.
 *
 * The Agent pins the SDK as a devDependency (it is bundled into the compiled
 * binary at build time, not shipped as a runtime node_modules dependency), so
 * both the overlay/restore checks here and the release gates read the pin from
 * devDependencies.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const AGENT_ROOT = process.cwd();
const SDK_ROOT = process.env.GOODVIBES_SDK_PATH ?? resolve(homedir(), 'Projects/goodvibes-sdk');
const SDK_PKG_DIST = join(SDK_ROOT, 'packages/sdk/dist');
const SDK_PKG_JSON = join(SDK_ROOT, 'packages/sdk/package.json');
const INSTALLED_PKG = join(AGENT_ROOT, 'node_modules/@pellux/goodvibes-sdk');
const MARKER = join(INSTALLED_PKG, '.local-sdk-overlay.json');

/** Read the SDK pin from devDependencies (the Agent bundles the SDK). */
function pinnedSdkVersion(): string {
  const pin = readSdkPin(AGENT_ROOT);
  if (!pin) fail('package.json has no @pellux/goodvibes-sdk pin in dependencies or devDependencies');
  return pin;
}

// ── Pure, testable lifecycle helpers ───────────────────────────────────────

/** Read the SDK pin from devDependencies first (Agent bundles the SDK), then dependencies. */
export function readSdkPin(root: string): string | undefined {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return pkg.devDependencies?.['@pellux/goodvibes-sdk'] ?? pkg.dependencies?.['@pellux/goodvibes-sdk'];
}

export interface OverlayStatus {
  readonly active: boolean;
  readonly line: string;
  readonly exitCode: number;
}

/**
 * Decide the `status` output purely from inputs: the marker file contents (null
 * when absent) and the installed package version. Overlay active → exit 2;
 * clean npm state → exit 0. Extracted so the three lifecycle states are testable
 * without a real SDK build or node_modules mutation.
 */
export function overlayStatus(markerRaw: string | null, installedVersion: string | undefined): OverlayStatus {
  if (markerRaw !== null) {
    const m = JSON.parse(markerRaw) as { sdkGit?: string; overlaidAt?: string; sourcePath?: string };
    return {
      active: true,
      line: `sdk-dev: OVERLAY ACTIVE — ${m.sdkGit}, overlaid ${m.overlaidAt} from ${m.sourcePath}`,
      exitCode: 2,
    };
  }
  return {
    active: false,
    line: `sdk-dev: clean — npm @pellux/goodvibes-sdk@${installedVersion} installed.`,
    exitCode: 0,
  };
}

/** After a restore reinstall, the reinstalled version must equal the pin. Returns an issue string or null. */
export function restoreVersionIssue(restoredVersion: string | undefined, pinned: string): string | null {
  return restoredVersion !== pinned
    ? `restored version ${String(restoredVersion)} does not match pinned ${pinned}`
    : null;
}

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function fail(msg: string): never {
  console.error(`sdk-dev: ${msg}`);
  process.exit(1);
}

function link(): void {
  if (!existsSync(SDK_ROOT)) fail(`local SDK checkout not found at ${SDK_ROOT} (set GOODVIBES_SDK_PATH to override)`);
  if (!existsSync(INSTALLED_PKG)) fail('node_modules/@pellux/goodvibes-sdk missing — run bun install first');

  const sha = sh('git rev-parse --short HEAD', SDK_ROOT);
  const branch = sh('git rev-parse --abbrev-ref HEAD', SDK_ROOT);
  const dirty = sh('git status --porcelain', SDK_ROOT) ? 'dirty' : 'clean';

  console.log(`sdk-dev: building local SDK (${branch}@${sha}, ${dirty} tree)...`);
  execSync('bun run build && bun run prepare:sdk', { cwd: SDK_ROOT, stdio: 'inherit' });
  if (!existsSync(SDK_PKG_DIST)) fail(`SDK build produced no dist at ${SDK_PKG_DIST}`);

  console.log('sdk-dev: overlaying dist into node_modules/@pellux/goodvibes-sdk...');
  // CACHE-SAFETY (critical): bun hardlinks node_modules package content to its
  // global cache (~/.bun/install/cache/@pellux/goodvibes-sdk@<version>@@@1).
  // cpSync onto an EXISTING file writes through the hardlink (same inode,
  // O_TRUNC) and silently replaces the GLOBAL cache entry for the pinned npm
  // version — machine-wide poisoning that survives `restore` (the next
  // `bun install` re-hardlinks the poisoned content back). ALWAYS unlink the
  // destination first so cpSync creates a NEW inode and the cache stays intact.
  // The dist dir is removed wholesale (below); package.json must be unlinked
  // explicitly (it is a single file copied in place). Ported with the fix from
  // goodvibes-webui's sdk-dev.ts — do NOT restore the in-place-copy pattern.
  rmSync(join(INSTALLED_PKG, 'dist'), { recursive: true, force: true });
  cpSync(SDK_PKG_DIST, join(INSTALLED_PKG, 'dist'), { recursive: true });
  // package.json too, so new subpath exports added in the local SDK resolve.
  rmSync(join(INSTALLED_PKG, 'package.json'), { force: true });
  cpSync(SDK_PKG_JSON, join(INSTALLED_PKG, 'package.json'));

  writeFileSync(MARKER, JSON.stringify({
    sourcePath: SDK_ROOT,
    sdkGit: `${branch}@${sha} (${dirty})`,
    overlaidAt: new Date().toISOString(),
    note: 'Local SDK overlay active. Run `bun scripts/sdk-dev.ts restore` before releasing; release gates fail while this file exists.',
  }, null, 2));

  console.log(`sdk-dev: LINKED — Agent now runs the local SDK (${branch}@${sha}, ${dirty}).`);
  console.log('sdk-dev: run `bun scripts/sdk-dev.ts restore` to return to the pinned npm version.');
}

function status(): void {
  const markerRaw = existsSync(MARKER) ? readFileSync(MARKER, 'utf8') : null;
  const installedVersion = existsSync(join(INSTALLED_PKG, 'package.json'))
    ? (JSON.parse(readFileSync(join(INSTALLED_PKG, 'package.json'), 'utf8')) as { version?: string }).version
    : undefined;
  const result = overlayStatus(markerRaw, installedVersion);
  console.log(result.line);
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

function restore(): void {
  if (!existsSync(MARKER)) {
    console.log('sdk-dev: no overlay active; nothing to restore.');
    return;
  }
  console.log('sdk-dev: removing overlay and reinstalling from lockfile...');
  rmSync(INSTALLED_PKG, { recursive: true, force: true });
  execSync('bun install', { cwd: AGENT_ROOT, stdio: 'inherit' });
  if (existsSync(MARKER)) fail('marker still present after reinstall — restore failed');
  const pkg = JSON.parse(readFileSync(join(INSTALLED_PKG, 'package.json'), 'utf8')) as { version?: string };
  const issue = restoreVersionIssue(pkg.version, pinnedSdkVersion());
  if (issue) fail(issue);
  console.log(`sdk-dev: RESTORED — npm @pellux/goodvibes-sdk@${pkg.version}.`);
}

if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === 'link') link();
  else if (cmd === 'status') status();
  else if (cmd === 'restore') restore();
  else {
    console.log('usage: bun scripts/sdk-dev.ts <link|status|restore>');
    process.exit(cmd ? 1 : 0);
  }
}
