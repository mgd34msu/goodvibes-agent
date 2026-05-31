import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface PackageCliBinVerification {
  readonly command: 'goodvibes-agent';
  readonly target: string;
  readonly exists: boolean;
  readonly executable: boolean;
  readonly usesBunShebang: boolean;
  readonly hasSourceEntrypoint: boolean;
}

export interface PackageCliVerificationReport {
  readonly packageName: string;
  readonly version: string;
  readonly bins: readonly PackageCliBinVerification[];
  readonly tarball: {
    readonly entryCount: number;
    readonly unpackedSize: number;
    readonly requiredPathsPresent: readonly string[];
    readonly forbiddenPaths: readonly string[];
  };
  readonly packageFacingText: {
    readonly checkedPaths: readonly string[];
    readonly failures: readonly string[];
  };
  readonly issues: readonly string[];
}

const REQUIRED_BIN_COMMANDS = ['goodvibes-agent'] as const;
const REQUIRED_TARBALL_PATHS = [
  'README.md',
  'CHANGELOG.md',
  'package.json',
  'src/main.ts',
  'bin/goodvibes-agent.ts',
  'scripts/check-bun.sh',
  'tsconfig.json',
  '.goodvibes/GOODVIBES.md',
  'docs/README.md',
  'docs/getting-started.md',
  'docs/deployment-and-services.md',
  'docs/release-and-publishing.md',
] as const;
const FORBIDDEN_TARBALL_PREFIXES = ['.github/', 'src/test/', 'src/.test/', '.goodvibes/memory/', 'vendor/'] as const;
const FORBIDDEN_TARBALL_DOCS = [
  'docs/qemu-sandbox.md',
  'docs/cloudflare-batch.md',
  'docs/homeassistant-surface.md',
  'docs/wrfc/',
] as const;
const PACKAGE_FACING_TEXT_PATHS = [
  'README.md',
  'docs/README.md',
  'docs/getting-started.md',
  'docs/deployment-and-services.md',
  'docs/release-and-publishing.md',
  '.goodvibes/GOODVIBES.md',
  '.goodvibes/agents/reviewer.md',
  '.goodvibes/skills/add-provider/SKILL.md',
] as const;
const PACKAGE_FACING_FORBIDDEN_TEXT = [
  '/api/knowledge',
  '/api/homeassistant',
  'homeassistant.homeGraph',
  'includeAllSpaces',
  'knowledgeSpaceId',
  '@pellux/goodvibes-tui',
  '@pellux/goodvibes-daemon',
  'goodvibes-daemon',
  '~/.goodvibes/tui',
  'Every plan must have a multi-agent execution strategy',
  'NEVER skip WRFC',
  'ALWAYS work in parallel when implementing a plan',
  'PRIMARY GOAL: Fully complete and functional code',
  'You are a code reviewer for the WRFC',
  'ReviewerReport',
  '"wrfcId"',
] as const;
const PACKAGE_FACING_REQUIRED_TEXT: readonly {
  readonly path: typeof PACKAGE_FACING_TEXT_PATHS[number];
  readonly required: readonly string[];
}[] = [
  { path: 'README.md', required: ['/api/goodvibes-agent/knowledge'] },
  { path: 'docs/README.md', required: ['/api/goodvibes-agent/knowledge'] },
  { path: 'docs/getting-started.md', required: ['/api/goodvibes-agent/knowledge'] },
  { path: 'docs/release-and-publishing.md', required: ['/api/goodvibes-agent/knowledge'] },
];

function readPackageJson(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as Record<string, unknown>;
}

function hasExecutableBit(path: string): boolean {
  return existsSync(path) && (statSync(path).mode & 0o111) !== 0;
}

function verifyBin(root: string, command: typeof REQUIRED_BIN_COMMANDS[number], target: string | undefined): PackageCliBinVerification {
  const binPath = target ? join(root, target) : '';
  const source = target && existsSync(binPath) ? readFileSync(binPath, 'utf-8') : '';
  return {
    command,
    target: target ?? '',
    exists: Boolean(target) && existsSync(binPath),
    executable: Boolean(target) && hasExecutableBit(binPath),
    usesBunShebang: source.startsWith('#!/usr/bin/env bun'),
    hasSourceEntrypoint: source.includes('../src/main.ts'),
  };
}

function npmPackDryRun(root: string): { readonly files: readonly string[]; readonly entryCount: number; readonly unpackedSize: number } {
  const raw = execSync('npm pack --json --dry-run', {
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const [packResult] = JSON.parse(raw) as Array<{ files?: Array<{ path?: string }>; entryCount?: number; unpackedSize?: number }>;
  return {
    files: Array.isArray(packResult?.files) ? packResult.files.map((entry) => String(entry.path ?? '')) : [],
    entryCount: Number(packResult?.entryCount ?? 0),
    unpackedSize: Number(packResult?.unpackedSize ?? 0),
  };
}

export function verifyPackageFacingText(root: string): { readonly checkedPaths: readonly string[]; readonly failures: readonly string[] } {
  const failures: string[] = [];
  for (const path of PACKAGE_FACING_TEXT_PATHS) {
    const absolutePath = join(root, path);
    if (!existsSync(absolutePath)) {
      failures.push(`package-facing text is missing: ${path}`);
      continue;
    }
    const content = readFileSync(absolutePath, 'utf-8');
    for (const forbidden of PACKAGE_FACING_FORBIDDEN_TEXT) {
      if (content.includes(forbidden)) {
        failures.push(`package-facing text ${path} contains forbidden default/TUI route or policy: ${forbidden}`);
      }
    }
    const requirement = PACKAGE_FACING_REQUIRED_TEXT.find((entry) => entry.path === path);
    if (requirement) {
      for (const required of requirement.required) {
        if (!content.includes(required)) {
          failures.push(`package-facing text ${path} is missing required Agent route/policy text: ${required}`);
        }
      }
    }
  }
  return {
    checkedPaths: PACKAGE_FACING_TEXT_PATHS,
    failures,
  };
}

export function verifyPackageCliInstall(root: string): PackageCliVerificationReport {
  const pkg = readPackageJson(root);
  const bin = pkg.bin && typeof pkg.bin === 'object' ? pkg.bin as Record<string, string | undefined> : {};
  const bins = REQUIRED_BIN_COMMANDS.map((command) => verifyBin(root, command, bin[command]));
  const pack = npmPackDryRun(root);
  const requiredPathsPresent = REQUIRED_TARBALL_PATHS.filter((path) => pack.files.includes(path));
  const forbiddenPaths = pack.files.filter((path) => {
    if (FORBIDDEN_TARBALL_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
    return FORBIDDEN_TARBALL_DOCS.some((docPath) => path === docPath || path.startsWith(docPath));
  });
  const issues: string[] = [];
  const packageFacingText = verifyPackageFacingText(root);

  for (const item of bins) {
    if (!item.target) issues.push(`package.json bin is missing ${item.command}.`);
    if (!item.exists) issues.push(`bin target does not exist: ${item.command} -> ${item.target}`);
    if (!item.executable) issues.push(`bin target is not executable: ${item.command} -> ${item.target}`);
    if (!item.usesBunShebang) issues.push(`bin target does not use Bun shebang: ${item.command} -> ${item.target}`);
    if (!item.hasSourceEntrypoint) issues.push(`bin target does not import the Agent source entrypoint: ${item.command}`);
  }
  for (const path of REQUIRED_TARBALL_PATHS) {
    if (!pack.files.includes(path)) issues.push(`npm tarball missing required path: ${path}`);
  }
  for (const path of forbiddenPaths) {
    issues.push(`npm tarball includes forbidden path: ${path}`);
  }
  for (const failure of packageFacingText.failures) {
    issues.push(failure);
  }

  return {
    packageName: String(pkg.name ?? ''),
    version: String(pkg.version ?? ''),
    bins,
    tarball: {
      entryCount: pack.entryCount,
      unpackedSize: pack.unpackedSize,
      requiredPathsPresent,
      forbiddenPaths,
    },
    packageFacingText,
    issues,
  };
}
