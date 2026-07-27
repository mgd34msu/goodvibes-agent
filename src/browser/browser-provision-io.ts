import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { platform } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserDriverResolution, BrowserProvisionIo, CommandOutcome } from './browser-types.ts';

/**
 * The Playwright driver is resolved at RUNTIME through a specifier the bundler
 * cannot see. `bun build` inlines every statically-named import into
 * dist/package/main.js, and playwright-core cannot survive that: it reads
 * browsers.json and its own driver files relative to its package directory, so
 * a bundled copy would look for files that no longer exist. Splitting the
 * specifier keeps playwright-core an ordinary installed dependency that is
 * required from node_modules exactly the way its own code expects.
 */
const DRIVER_PACKAGE = ['playwright', 'core'].join('-');

/**
 * The driver version this build expects. Kept in step with the dependency in
 * package.json by a test, because a compiled binary has no package.json to read
 * and would otherwise install whatever npm happened to consider latest.
 */
export const DRIVER_VERSION = '1.62.0';

const requireFromEngine = createRequire(import.meta.url);

interface DriverModule {
  readonly chromium: { readonly executablePath: () => string };
}

/**
 * Where the driver lives when this build is a compiled binary.
 *
 * A single-file executable has no node_modules, so `require('playwright-core')`
 * finds nothing and browser control would silently not exist in the shipped
 * artifact. These are the places a driver can be instead: shipped beside the
 * executable, provisioned into the agent's own storage, or pointed at
 * explicitly. Resolution tries the ordinary module path first, so an npm
 * install behaves exactly as before.
 */
export function driverSearchDirectories(homeDirectory?: string): readonly string[] {
  const executableDirectory = dirname(process.execPath);
  const override = process.env.GOODVIBES_PLAYWRIGHT_CORE?.trim();
  const home = homeDirectory ?? process.env.HOME ?? '';
  return [
    ...(override ? [override] : []),
    join(executableDirectory, DRIVER_PACKAGE),
    join(executableDirectory, 'vendor', DRIVER_PACKAGE),
    join(executableDirectory, 'node_modules', DRIVER_PACKAGE),
    ...(home ? [join(managedDriverRoot(home), 'node_modules', DRIVER_PACKAGE)] : []),
  ];
}

/** Where the agent installs a driver for itself when nothing ships one. */
export function managedDriverRoot(homeDirectory: string): string {
  return join(homeDirectory, '.goodvibes', 'agent', 'browser', 'driver');
}

function driverDirectoryFrom(candidate: string): string | null {
  const manifest = join(candidate, 'package.json');
  return existsSync(manifest) && existsSync(join(candidate, 'index.js')) ? candidate : null;
}

/** The driver package directory, wherever it turns out to be. */
export function findDriverDirectory(homeDirectory?: string): string | null {
  try {
    const manifestPath = requireFromEngine.resolve(`${DRIVER_PACKAGE}/package.json`);
    return manifestPath.slice(0, manifestPath.length - '/package.json'.length);
  } catch {
    // Not resolvable as a module — expected inside a compiled binary.
  }
  for (const candidate of driverSearchDirectories(homeDirectory)) {
    const found = driverDirectoryFrom(candidate);
    if (found) return found;
  }
  return null;
}

export function loadDriverModule(homeDirectory?: string): DriverModule | null {
  try {
    return requireFromEngine(DRIVER_PACKAGE) as DriverModule;
  } catch {
    // Fall through to the on-disk locations.
  }
  const directory = findDriverDirectory(homeDirectory);
  if (!directory) return null;
  try {
    const requireFromDriver = createRequire(pathToFileURL(join(directory, 'package.json')).href);
    return requireFromDriver(directory) as DriverModule;
  } catch {
    return null;
  }
}

export function resolveDriver(homeDirectory?: string): BrowserDriverResolution {
  const packageDirectory = findDriverDirectory(homeDirectory);
  if (!packageDirectory) {
    return {
      available: false,
      packageDirectory: null,
      cliPath: null,
      version: null,
      error: `${DRIVER_PACKAGE} was not found next to the executable, in the agent's driver directory, or as an installed module`,
    };
  }
  try {
    const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')) as { readonly version?: unknown };
    const cliPath = join(packageDirectory, 'cli.js');
    return {
      available: existsSync(cliPath),
      packageDirectory,
      cliPath: existsSync(cliPath) ? cliPath : null,
      version: typeof manifest.version === 'string' ? manifest.version : null,
      error: existsSync(cliPath) ? null : `${DRIVER_PACKAGE} is present but its cli.js is missing`,
    };
  } catch (error) {
    return {
      available: false,
      packageDirectory,
      cliPath: null,
      version: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Playwright's own browser cache location, honoring the standard override.
 * The home directory is passed in rather than discovered, so the cache a build
 * uses is always something its composition root chose.
 */
export function defaultBrowsersPath(homeDirectory: string): string {
  const override = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (override && override.trim() && override.trim() !== '0') return override.trim();
  if (platform() === 'darwin') return join(homeDirectory, 'Library', 'Caches', 'ms-playwright');
  if (platform() === 'win32') return join(homeDirectory, 'AppData', 'Local', 'ms-playwright');
  return join(homeDirectory, '.cache', 'ms-playwright');
}

function expectedExecutablePath(homeDirectory?: string): string | null {
  const driver = loadDriverModule(homeDirectory);
  if (!driver) return null;
  try {
    return driver.chromium.executablePath();
  } catch {
    return null;
  }
}

/**
 * Browsers already installed on the machine, used when a managed download is
 * impossible (offline, blocked registry). Order is deliberate: Chromium and
 * Chrome first because the automation surface targets Chromium's CDP.
 */
const SYSTEM_BROWSER_PATHS: readonly string[] = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/brave-browser',
  '/usr/bin/microsoft-edge',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function directoryWritable(path: string): boolean {
  try {
    mkdirSync(path, { recursive: true });
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs one command and waits for it.
 *
 * The timeout signals THIS child and nothing else: no process-group signal, no
 * name matching, no sweep of other processes. A provisioning timeout can never
 * reach a browser — the failure mode that killed a live logged-in browser
 * session before this capability existed.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  options: { readonly timeoutMs: number; readonly env?: Readonly<Record<string, string>>; readonly cwd?: string },
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(command, [...args], {
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);
    const settle = (outcome: CommandOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      settle({ code: null, stdout, stderr, timedOut, spawnError: error.message });
    });
    child.on('close', (code) => {
      settle({ code, stdout, stderr, timedOut, spawnError: null });
    });
  });
}

export interface BrowserProvisionIoOptions {
  /** Home directory owning the managed browser cache. */
  readonly homeDirectory: string;
}

/**
 * Installs the driver into a directory the agent owns.
 *
 * Used when nothing shipped one — a compiled binary running from a machine that
 * has never seen this agent before. It needs a package manager present; when
 * there is none, the caller reports that plainly rather than failing silently.
 */
async function installDriverPackage(targetRoot: string): Promise<CommandOutcome> {
  mkdirSync(targetRoot, { recursive: true });
  const specifier = `${DRIVER_PACKAGE}@${DRIVER_VERSION}`;
  const attempts: readonly (readonly [string, readonly string[]])[] = [
    ['bun', ['add', '--no-save', specifier]],
    ['npm', ['install', '--no-save', '--prefix', targetRoot, specifier]],
  ];
  let last: CommandOutcome = { code: null, stdout: '', stderr: '', timedOut: false, spawnError: 'no package manager available' };
  for (const [command, args] of attempts) {
    const outcome = await runCommand(command, args, { timeoutMs: 300_000, cwd: targetRoot });
    if (outcome.code === 0) return outcome;
    if (outcome.spawnError && /ENOENT/i.test(outcome.spawnError)) continue;
    last = outcome;
  }
  return last;
}

export function createBrowserProvisionIo(options: BrowserProvisionIoOptions): BrowserProvisionIo {
  return {
    installDriver: (targetRoot) => installDriverPackage(targetRoot),
    managedDriverRoot: () => managedDriverRoot(options.homeDirectory),
    resolveDriver: () => resolveDriver(options.homeDirectory),
    expectedExecutablePath: () => expectedExecutablePath(options.homeDirectory),
    browsersPath: () => defaultBrowsersPath(options.homeDirectory),
    pathExists: (path) => existsSync(path),
    isExecutableFile,
    directoryWritable,
    removePath: (path) => {
      rmSync(path, { recursive: true, force: true });
    },
    runCommand,
    systemBrowserCandidates: () => SYSTEM_BROWSER_PATHS.filter(isExecutableFile),
    now: () => Date.now(),
  };
}
