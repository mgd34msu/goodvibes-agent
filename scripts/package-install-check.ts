#!/usr/bin/env bun
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyPackageCliInstall } from '../src/cli/package-verification.ts';

const report = verifyPackageCliInstall(process.cwd());
const BUN_GLOBAL_INSTALL_TIMEOUT_MS = 420_000;

if (report.issues.length > 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

function run(command: string, args: readonly string[], options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number } = {}): string {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with exit ${result.status ?? 'signal'}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function runExpectingExit(
  command: string,
  args: readonly string[],
  expectedExitCode: number,
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {},
): string {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== expectedExitCode) {
    throw new Error([
      `${command} ${args.join(' ')} exited ${result.status ?? 'signal'}, expected ${expectedExitCode}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function runAllowingExit(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number } = {},
): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function hasExecutableBit(path: string): boolean {
  return (statSync(path).mode & 0o111) !== 0;
}

function extractPackTarballPath(packOutput: string, packDir: string): string {
  const lines = packOutput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const filename = lines[lines.length - 1];
  if (!filename) {
    throw new Error('bun pm pack did not return a tarball filename');
  }
  return isAbsolute(filename) ? filename : join(packDir, filename);
}

function assertInstalledTuiLaunches(env: NodeJS.ProcessEnv, tempRoot: string): void {
  const transcriptPath = join(tempRoot, 'tui-launch.typescript');
  const command = 'timeout -s INT -k 1s 2s goodvibes-agent --no-alt-screen';
  const result = runAllowingExit('script', ['-qfec', command, transcriptPath], {
    env,
    timeoutMs: 5_000,
  });
  const transcript = existsSync(transcriptPath) ? readFileSync(transcriptPath, 'utf-8') : '';
  if (result.status !== 124 && result.status !== 137) {
    throw new Error([
      `installed Agent TUI launch exited ${result.status ?? 'without status'}, expected timeout after staying alive`,
      result.stdout.trim(),
      result.stderr.trim(),
      transcript.trim(),
    ].filter(Boolean).join('\n'));
  }
  if (transcript.includes('goodvibes-agent failed to launch')) {
    throw new Error(`installed Agent TUI launch failed during startup:\n${transcript}`);
  }
  const plainTranscript = transcript
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '')
    .replace(/\s+/g, ' ');
  if (!plainTranscript.includes('GoodVibes Agent') && !plainTranscript.includes('Onboarding Wizard')) {
    throw new Error(`installed Agent TUI launch transcript did not contain the Agent shell:\n${transcript}`);
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), 'goodvibes-agent-install-check-'));
try {
  const packDir = join(tempRoot, 'pack');
  const bunInstallDir = join(tempRoot, 'bun');
  const homeDir = join(tempRoot, 'home');
  const workspaceDir = join(tempRoot, 'workspace');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(bunInstallDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });

  const packOutput = run('bun', ['pm', 'pack', '--destination', packDir, '--quiet']);
  const tarballPath = extractPackTarballPath(packOutput, packDir);
  if (!existsSync(tarballPath)) {
    throw new Error(`bun pm pack did not create expected tarball: ${tarballPath}`);
  }

  run('bun', ['add', '-g', tarballPath, '--registry', 'https://registry.npmjs.org'], {
    cwd: tempRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      BUN_INSTALL: bunInstallDir,
    },
    timeoutMs: BUN_GLOBAL_INSTALL_TIMEOUT_MS,
  });

  const binPath = join(bunInstallDir, 'bin', 'goodvibes-agent');
  if (!existsSync(binPath)) {
    throw new Error(`installed bin is missing: ${binPath}`);
  }
  if (!hasExecutableBit(binPath)) {
    throw new Error(`installed bin is not executable: ${binPath}`);
  }

  const binStat = lstatSync(binPath);
  const resolvedBinPath = binStat.isSymbolicLink() ? realpathSync(binPath) : binPath;
  const binSource = readFileSync(resolvedBinPath, 'utf-8');
  if (!binSource.startsWith('#!/usr/bin/env bun')) {
    throw new Error(`installed bin does not use the Bun shebang: ${resolvedBinPath}`);
  }

  const smokeEnv = {
    ...process.env,
    HOME: homeDir,
    BUN_INSTALL: bunInstallDir,
    GOODVIBES_WORKING_DIR: workspaceDir,
    PATH: `${join(bunInstallDir, 'bin')}:${process.env.PATH ?? ''}`,
  };
  const help = run('goodvibes-agent', ['--help'], { env: smokeEnv });
  if (!help.includes('goodvibes-agent')) {
    throw new Error('installed --help output did not identify goodvibes-agent');
  }

  const version = run('goodvibes-agent', ['--version'], { env: smokeEnv }).trim();
  if (!version.includes(report.version)) {
    throw new Error(`installed --version output did not include ${report.version}: ${version}`);
  }

  const status = run('goodvibes-agent', ['status', '--json'], { env: smokeEnv });
  if (!status.includes('"title"') || !status.includes('GoodVibes Agent status')) {
    throw new Error('installed status --json did not report Agent surface state');
  }

  const serveBlock = runExpectingExit('goodvibes-agent', ['serve'], 2, { env: smokeEnv });
  if (serveBlock.trim().length > 0) {
    throw new Error('serve lifecycle block should write guidance to stderr, not stdout');
  }

  assertInstalledTuiLaunches(smokeEnv, tempRoot);

  console.log(`package install check passed (${report.bins.length} bins, ${report.tarball.entryCount} packed files, Bun global command + Agent TUI launch smoke ok)`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
