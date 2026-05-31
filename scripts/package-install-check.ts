#!/usr/bin/env bun
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyPackageCliInstall } from '../src/cli/package-verification.ts';

const report = verifyPackageCliInstall(process.cwd());

if (report.issues.length > 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

type PackFile = {
  readonly filename?: string;
};

function run(command: string, args: readonly string[], options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {}): string {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

function hasExecutableBit(path: string): boolean {
  return (statSync(path).mode & 0o111) !== 0;
}

const tempRoot = mkdtempSync(join(tmpdir(), 'goodvibes-agent-install-check-'));
try {
  const packDir = join(tempRoot, 'pack');
  const prefixDir = join(tempRoot, 'prefix');
  const homeDir = join(tempRoot, 'home');
  const workspaceDir = join(tempRoot, 'workspace');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(prefixDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });

  const packOutput = run('npm', ['pack', '--json', '--pack-destination', packDir]);
  const [packFile] = JSON.parse(packOutput) as readonly PackFile[];
  if (!packFile?.filename) {
    throw new Error('npm pack did not return a tarball filename');
  }

  const tarballPath = join(packDir, packFile.filename);
  if (!existsSync(tarballPath)) {
    throw new Error(`npm pack did not create expected tarball: ${tarballPath}`);
  }

  run('npm', ['install', '-g', '--prefix', prefixDir, tarballPath], {
    env: {
      ...process.env,
      HOME: homeDir,
    },
  });

  const binPath = join(prefixDir, 'bin', 'goodvibes-agent');
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
    GOODVIBES_WORKING_DIR: workspaceDir,
    PATH: `${join(prefixDir, 'bin')}:${process.env.PATH ?? ''}`,
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

  console.log(`package install check passed (${report.bins.length} bins, ${report.tarball.entryCount} packed files, installed command smoke ok)`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
