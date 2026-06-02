import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

/**
 * Release script — bumps version, updates CHANGELOG, creates git tag.
 *
 * Defaults to patch bumps. Minor/major require explicit flags.
 *
 * Usage:
 *   bun run scripts/release.ts              # patch bump (0.9.10 → 0.9.11)
 *   bun run scripts/release.ts --minor      # minor bump (0.9.10 → 0.10.0)
 *   bun run scripts/release.ts --major      # major bump (0.9.10 → 1.0.0)
 *   bun run scripts/release.ts --notes-file ./release-notes.md
 *   bun run scripts/release.ts --dry-run    # preview without writing
 *
 * What it does:
 *   1. Pre-release validation (typecheck + build)
 *   2. Bump patch version in package.json
 *   3. Update package.json on disk
 *   4. Update src/version.ts fallback via prebuild script
 *   5. Prepend new section to CHANGELOG.md
 *   6. Stage changes, commit, create annotated git tag
 */

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_VALIDATION = args.includes('--skip-validation');
const notesFileIndex = args.indexOf('--notes-file');
const bumpMode = args.includes('--major')
  ? 'major'
  : args.includes('--minor')
    ? 'minor'
    : 'patch';

if (args.includes('--major') && args.includes('--minor')) {
  console.error('Error: choose only one of --minor or --major.');
  process.exit(1);
}

const root = process.cwd();

function readReleaseNotesFromArgOrEnv(): readonly string[] {
  const notesFile = notesFileIndex >= 0 ? args[notesFileIndex + 1] : undefined;
  if (notesFileIndex >= 0 && (!notesFile || notesFile.startsWith('--'))) {
    console.error('Error: --notes-file requires a markdown file path.');
    process.exit(1);
  }

  const raw = notesFile
    ? readFileSync(join(root, notesFile), 'utf8')
    : process.env.GOODVIBES_AGENT_RELEASE_NOTES;
  if (!raw || raw.trim().length === 0) {
    if (DRY_RUN) {
      return [
        '- Product release notes required for real release. Pass --notes-file <path> or GOODVIBES_AGENT_RELEASE_NOTES.',
      ];
    }
    console.error('Error: product release notes are required. Pass --notes-file <path> or set GOODVIBES_AGENT_RELEASE_NOTES.');
    process.exit(1);
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.startsWith('- ') ? line : `- ${line}`);
  if (lines.some((line) => /^- [0-9a-f]{7,40}\s/i.test(line))) {
    console.error('Error: release notes must describe product changes, not raw commit hashes.');
    process.exit(1);
  }
  return lines;
}

function run(cmd: string, opts: { silent?: boolean } = {}): string {
  if (DRY_RUN && !opts.silent) {
    console.log(`[dry-run] ${cmd}`);
    return '';
  }
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit' });
  } catch (error: unknown) {
    console.error(`\nCommand failed: ${cmd}`);
    if (typeof error === 'object' && error !== null) {
      const commandError = error as { stdout?: string | Uint8Array; stderr?: string | Uint8Array };
      if (commandError.stdout) console.error(String(commandError.stdout));
      if (commandError.stderr) console.error(String(commandError.stderr));
    }
    process.exit(1);
  }
}

function runSilent(cmd: string): string {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  } catch {
    return '';
  }
}

// --- Pre-flight checks ---

// Ensure we are on a clean working tree (no uncommitted changes)
const gitStatus = runSilent('git status --porcelain');
if (gitStatus.trim()) {
  console.error('Error: working tree has uncommitted changes. Commit or stash before releasing.');
  console.error(gitStatus);
  process.exit(1);
}

// Ensure we are on main branch
const currentBranch = runSilent('git rev-parse --abbrev-ref HEAD').trim();
if (currentBranch !== 'main') {
  console.error(`Error: releases must be cut from main (current branch: ${currentBranch})`);
  process.exit(1);
}

// --- Read current version ---

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current: string = pkg.version;

// Parse semver
const parts = current.split('.').map(Number);
if (parts.length !== 3 || parts.some(isNaN)) {
  console.error(`Error: cannot parse version '${current}' as semver`);
  process.exit(1);
}

const [major, minor, patch] = parts;

const next = bumpMode === 'major'
  ? `${major + 1}.0.0`
  : bumpMode === 'minor'
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;

console.log(`\nRelease: ${current} → ${next}`);
if (DRY_RUN) console.log('(dry-run mode — no files will be written)\n');

// --- Pre-release validation ---

if (!SKIP_VALIDATION) {
  console.log('\n[1/6] Running typecheck...');
  run('bun run typecheck');

  console.log('\n[2/6] Running build...');
  run('bun run build');
} else {
  console.log('\n[1/6] Skipping validation (--skip-validation)');
  console.log('[2/6] Skipping build (--skip-validation)');
}

// --- Bump package.json ---

console.log(`\n[3/6] Updating package.json: ${current} → ${next}`);
if (!DRY_RUN) {
  pkg.version = next;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// --- Update src/version.ts via prebuild script ---

console.log('\n[4/6] Syncing src/version.ts via prebuild...');
run('bun run scripts/prebuild.ts');

// --- Update CHANGELOG.md ---

console.log('\n[5/6] Updating CHANGELOG.md...');

const changelogPath = join(root, 'CHANGELOG.md');
const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

const newSection = [
  `## ${next} - ${today}`,
  '',
  ...readReleaseNotesFromArgOrEnv(),
  '',
].join('\n');

if (!DRY_RUN) {
  let changelog = readFileSync(changelogPath, 'utf8');

  const firstReleaseHeading = changelog.search(/^## /m);
  if (firstReleaseHeading === -1) {
    changelog = `${changelog.trimEnd()}\n\n${newSection}\n`;
  } else {
    changelog = `${changelog.slice(0, firstReleaseHeading)}${newSection}\n${changelog.slice(firstReleaseHeading)}`;
  }

  writeFileSync(changelogPath, changelog);
  console.log(`CHANGELOG.md: prepended section for ${next}`);
} else {
  console.log('[dry-run] Would prepend to CHANGELOG.md:');
  console.log(newSection);
}

// --- Git commit + tag ---

console.log(`\n[6/6] Creating git commit and tag v${next}...`);

const tag = `v${next}`;
const commitMsg = `chore: release ${tag}`;

run('git add package.json src/version.ts README.md CHANGELOG.md');
run(`git commit -m "${commitMsg}"`);
run(`git tag -a ${tag} -m "Release ${tag}"`);

console.log(`\nRelease ${tag} complete.`);
console.log('Next step: git push && git push --tags');
