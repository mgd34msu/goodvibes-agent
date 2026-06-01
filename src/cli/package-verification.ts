import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CommandRegistry } from '../input/command-registry.ts';
import { registerBuiltinCommands } from '../input/commands.ts';

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
  'LICENSE',
  'package.json',
  'src/main.ts',
  'bin/goodvibes-agent.ts',
  'tsconfig.json',
  'docs/README.md',
  'docs/getting-started.md',
  'docs/runtime-connection.md',
  'docs/release-and-publishing.md',
] as const;
const FORBIDDEN_TARBALL_PREFIXES = ['.github/', 'src/test/', 'src/.test/', '.goodvibes/', 'vendor/'] as const;
const FORBIDDEN_TARBALL_DOCS = [
  ['docs/cloud', 'flare-batch.md'].join(''),
  ['docs/home', 'assistant-surface.md'].join(''),
  'docs/wrfc/',
] as const;
const FORBIDDEN_TARBALL_FILES = new Set([
  'src/panels/agent-inspector-panel.ts',
  'src/panels/agent-inspector-shared.ts',
  'src/panels/agent-logs-panel.ts',
  'src/panels/agent-logs-shared.ts',
  'src/tools/wrfc-agent-guard.ts',
  'src/renderer/agent-detail-modal.ts',
  'src/renderer/process-summary.ts',
]);
const PACKAGE_FACING_TEXT_PATHS = [
  'README.md',
  'CHANGELOG.md',
  'docs/README.md',
  'docs/getting-started.md',
  'docs/runtime-connection.md',
  'docs/release-and-publishing.md',
] as const;
const PACKAGE_FACING_FORBIDDEN_TEXT = [
  ['/api/', 'knowledge'].join(''),
  ['/api/home', 'assistant'].join(''),
  ['home', 'assistant.home', 'Graph'].join(''),
  ['include', 'AllSpaces'].join(''),
  ['knowledge', 'SpaceId'].join(''),
  ['@pellux/goodvibes-', 'tui'].join(''),
  ['@pellux/goodvibes-', 'daemon'].join(''),
  ['goodvibes-', 'daemon'].join(''),
  ['~/.goodvibes/', 'tui'].join(''),
  ['Home', ' Assistant'].join(''),
  ['Home', 'Graph'].join(''),
  ['Cloud', 'flare'].join(''),
  ['Open', 'Claw'].join(''),
  ['Her', 'mes'].join(''),
  ['cap', 'abilities audit'].join(''),
  ['cap', 'abilities command'].join(''),
  ['near', '-fork'].join(''),
  ['Optional ', 'Browser Access'].join(''),
  ['Optional ', 'Other-Device Access'].join(''),
  ['Optional ', 'Incoming Events'].join(''),
  ['Service ', '& Network'].join(''),
  ['Surfaces ', '& Integrations'].join(''),
  ['runtime', '-isolation'].join(''),
  ['goodvibes-agent', 'serve'].join(' '),
  ['goodvibes-agent', 'service'].join(' '),
  ['goodvibes-agent', 'services'].join(' '),
  ['goodvibes-agent', 'surfaces'].join(' '),
  ['goodvibes-agent', 'surface'].join(' '),
  ['goodvibes-agent', 'listener'].join(' '),
  ['goodvibes-agent', 'control-plane'].join(' '),
  ['goodvibes-agent', 'remote'].join(' '),
  ['goodvibes-agent', 'bridge'].join(' '),
  ['goodvibes-agent', 'web'].join(' '),
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
  { path: 'README.md', required: ['/api/goodvibes-agent/knowledge', 'bun add -g --trust @pellux/goodvibes-agent', 'bun pm -g untrusted'] },
  { path: 'docs/README.md', required: ['/api/goodvibes-agent/knowledge'] },
  { path: 'docs/getting-started.md', required: ['/api/goodvibes-agent/knowledge', 'bun add -g --trust @pellux/goodvibes-agent', 'bun pm -g untrusted'] },
  { path: 'docs/runtime-connection.md', required: ['/api/goodvibes-agent/knowledge'] },
  { path: 'docs/release-and-publishing.md', required: ['/api/goodvibes-agent/knowledge', 'bun add -g --trust @pellux/goodvibes-agent', 'bun pm -g untrusted'] },
];
const NON_COMMAND_ROUTE_ROOTS = new Set(['api', 'status']);

function readPackageJson(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as Record<string, unknown>;
}

function buildRegisteredSlashCommandNames(): ReadonlySet<string> {
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry);
  const names = new Set<string>();
  for (const command of registry.list()) {
    names.add(command.name);
    for (const alias of command.aliases ?? []) names.add(alias);
  }
  return names;
}

function verifyPackageFacingSlashCommands(path: string, content: string, registeredCommands: ReadonlySet<string>): readonly string[] {
  const failures: string[] = [];
  const commandPattern = /(^|[\s`([])\/([a-z][a-z0-9_-]*)(?=$|[\s`.,;:)\]])/g;
  const lines = content.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    commandPattern.lastIndex = 0;
    for (let match = commandPattern.exec(line); match !== null; match = commandPattern.exec(line)) {
      const root = match[2] ?? '';
      if (NON_COMMAND_ROUTE_ROOTS.has(root)) continue;
      if (registeredCommands.has(root)) continue;
      failures.push(`package-facing text ${path}:${lineIndex + 1} references unknown Agent slash command: /${root}`);
    }
  }
  return failures;
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

function registryPackDryRun(root: string): { readonly files: readonly string[]; readonly entryCount: number; readonly unpackedSize: number } {
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
  const registeredCommands = buildRegisteredSlashCommandNames();
  for (const path of PACKAGE_FACING_TEXT_PATHS) {
    const absolutePath = join(root, path);
    if (!existsSync(absolutePath)) {
      failures.push(`package-facing text is missing: ${path}`);
      continue;
    }
    const content = readFileSync(absolutePath, 'utf-8');
    if (path !== 'CHANGELOG.md') {
      failures.push(...verifyPackageFacingSlashCommands(path, content, registeredCommands));
    }
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
  const pack = registryPackDryRun(root);
  const requiredPathsPresent = REQUIRED_TARBALL_PATHS.filter((path) => pack.files.includes(path));
  const forbiddenPaths = pack.files.filter((path) => {
    if (FORBIDDEN_TARBALL_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
    if (FORBIDDEN_TARBALL_FILES.has(path)) return true;
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
    if (!pack.files.includes(path)) issues.push(`registry tarball missing required path: ${path}`);
  }
  for (const path of forbiddenPaths) {
    issues.push(`registry tarball includes forbidden path: ${path}`);
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
