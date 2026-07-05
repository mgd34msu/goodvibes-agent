#!/usr/bin/env bun
import { execSync } from 'node:child_process';
import { isForbiddenPackageTarballPath, requiredTarballPaths, verifyPackageFacingText, verifyReleaseMetadata } from '../src/cli/package-verification.ts';
import { sdkReleaseGateIssues } from './sdk-release-gates.ts';

const root = process.cwd();

// SDK release gates: overlay-marker hard-fail, exact-pin, pin/lock/installed
// agreement, and npm-only import sweep. Keeps scripts/sdk-dev.ts's local-SDK
// overlay from ever leaking into a published @pellux/goodvibes-agent.
for (const issue of sdkReleaseGateIssues(root)) {
  throw new Error(issue);
}

for (const issue of verifyReleaseMetadata(root)) {
  throw new Error(issue);
}

const packageFacingText = verifyPackageFacingText(root);
for (const failure of packageFacingText.failures) {
  throw new Error(failure);
}

execSync('bun run build:package-runtime', {
  cwd: root,
  stdio: 'inherit',
});

const packRaw = execSync('npm pack --json --dry-run', {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

const [packResult] = JSON.parse(packRaw);
const filePaths = Array.isArray(packResult.files) ? packResult.files.map((entry) => entry.path) : [];
for (const filePath of filePaths) {
  if (isForbiddenPackageTarballPath(filePath)) {
    throw new Error(`published tarball includes forbidden path: ${filePath}`);
  }
}

for (const requiredPath of requiredTarballPaths(root)) {
  if (!filePaths.includes(requiredPath)) {
    throw new Error(`published tarball is missing required path: ${requiredPath}`);
  }
}

if (typeof packResult.size === 'number' && packResult.size > 50 * 1024 * 1024) {
  throw new Error(`published tarball is too large: ${packResult.size} bytes`);
}

console.log(`publish check passed (${packResult.entryCount} files, ${packResult.unpackedSize} bytes unpacked)`);
