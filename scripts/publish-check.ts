#!/usr/bin/env bun
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { verifyPackageFacingText } from '../src/cli/package-verification.ts';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

for (const field of ['name', 'version', 'description', 'license', 'homepage']) {
  if (typeof pkg[field] !== 'string' || pkg[field].trim().length === 0) {
    throw new Error(`package.json missing required publish field: ${field}`);
  }
}

if (!pkg.repository || typeof pkg.repository.url !== 'string') {
  throw new Error('package.json missing repository metadata');
}

if (!pkg.bin || typeof pkg.bin['goodvibes-agent'] !== 'string') {
  throw new Error('package.json must expose the goodvibes-agent bin entry');
}

for (const binTarget of [pkg.bin['goodvibes-agent']]) {
  const binPath = join(root, binTarget);
  if (!existsSync(binPath)) {
    throw new Error(`missing publish bin target: ${binTarget}`);
  }

  const binMode = statSync(binPath).mode;
  if ((binMode & 0o111) === 0) {
    throw new Error(`publish bin is not executable: ${binTarget}`);
  }
}

const packRaw = execSync('npm pack --json --dry-run', {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

const [packResult] = JSON.parse(packRaw);
const filePaths = Array.isArray(packResult.files) ? packResult.files.map((entry) => entry.path) : [];
const forbiddenPrefixes = ['.github/', 'src/test/', 'src/.test/', '.goodvibes/memory/', '.goodvibes/agents/', 'src/daemon/'];
const forbiddenDocs = ['docs/qemu-sandbox.md', 'docs/cloudflare-batch.md', 'docs/homeassistant-surface.md', 'docs/wrfc/'];
const forbiddenSourceFiles = new Set([
  'src/panels/diff-panel.ts',
  'src/panels/file-explorer-panel.ts',
  'src/panels/file-preview-panel.ts',
  'src/panels/git-panel.ts',
  'src/panels/sandbox-panel.ts',
  'src/panels/symbol-outline-panel.ts',
  'src/panels/worktree-panel.ts',
  'src/panels/wrfc-panel.ts',
]);
for (const filePath of filePaths) {
  if (forbiddenPrefixes.some((prefix) => filePath.startsWith(prefix))) {
    throw new Error(`published tarball includes forbidden path: ${filePath}`);
  }
  if (forbiddenSourceFiles.has(filePath)) {
    throw new Error(`published tarball includes copied TUI-only source file: ${filePath}`);
  }
  if (forbiddenDocs.some((docPath) => filePath === docPath || filePath.startsWith(docPath))) {
    throw new Error(`published tarball includes copied TUI-only doc path: ${filePath}`);
  }
  if (filePath.startsWith('vendor/')) {
    throw new Error(`published tarball should not include vendored release binaries: ${filePath}`);
  }
}

for (const requiredPath of [
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'src/main.ts',
  'bin/goodvibes-agent.ts',
  'scripts/check-bun.sh',
  'tsconfig.json',
  '.goodvibes/GOODVIBES.md',
  'docs/README.md',
  'docs/getting-started.md',
  'docs/deployment-and-services.md',
  'docs/release-and-publishing.md',
]) {
  if (!filePaths.includes(requiredPath)) {
    throw new Error(`published tarball is missing required path: ${requiredPath}`);
  }
}

const packagedGuidanceChecks: readonly {
  readonly path: string;
  readonly forbidden: readonly string[];
}[] = [
  {
    path: '.goodvibes/GOODVIBES.md',
    forbidden: [
      'Every plan must have a multi-agent execution strategy',
      'NEVER skip WRFC',
      'ALWAYS work in parallel when implementing a plan',
      'PRIMARY GOAL: Fully complete and functional code',
    ],
  },
  {
    path: '.goodvibes/skills/add-provider/SKILL.md',
    forbidden: [
      'goodvibes-tui',
      '~/.goodvibes/tui/providers',
      '~/.goodvibes/daemon/providers',
    ],
  },
];

for (const check of packagedGuidanceChecks) {
  const content = readFileSync(join(root, check.path), 'utf8');
  for (const forbidden of check.forbidden) {
    if (content.includes(forbidden)) {
      throw new Error(`package-facing guidance ${check.path} contains forbidden copied TUI policy: ${forbidden}`);
    }
  }
}

const packageFacingText = verifyPackageFacingText(root);
for (const failure of packageFacingText.failures) {
  throw new Error(failure);
}

if (typeof packResult.size === 'number' && packResult.size > 50 * 1024 * 1024) {
  throw new Error(`published tarball is too large: ${packResult.size} bytes`);
}

console.log(`publish check passed (${packResult.entryCount} files, ${packResult.unpackedSize} bytes unpacked)`);
