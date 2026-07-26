import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { platform } from 'node:os';
import { join } from 'node:path';
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

const requireFromEngine = createRequire(import.meta.url);

interface DriverModule {
  readonly chromium: { readonly executablePath: () => string };
}

export function loadDriverModule(): DriverModule | null {
  try {
    return requireFromEngine(DRIVER_PACKAGE) as DriverModule;
  } catch {
    return null;
  }
}

export function resolveDriver(): BrowserDriverResolution {
  try {
    const manifestPath = requireFromEngine.resolve(`${DRIVER_PACKAGE}/package.json`);
    const packageDirectory = manifestPath.slice(0, manifestPath.length - '/package.json'.length);
    const manifest = requireFromEngine(manifestPath) as { readonly version?: unknown };
    const cliPath = join(packageDirectory, 'cli.js');
    return {
      available: existsSync(cliPath),
      packageDirectory,
      cliPath: existsSync(cliPath) ? cliPath : null,
      version: typeof manifest.version === 'string' ? manifest.version : null,
      error: existsSync(cliPath) ? null : `${DRIVER_PACKAGE} is installed but its cli.js is missing`,
    };
  } catch (error) {
    return {
      available: false,
      packageDirectory: null,
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

function expectedExecutablePath(): string | null {
  const driver = loadDriverModule();
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
  options: { readonly timeoutMs: number; readonly env?: Readonly<Record<string, string>> },
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(command, [...args], {
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
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

export function createBrowserProvisionIo(options: BrowserProvisionIoOptions): BrowserProvisionIo {
  return {
    resolveDriver,
    expectedExecutablePath,
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
