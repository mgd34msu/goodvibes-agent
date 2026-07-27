import { basename, dirname } from 'node:path';
import type {
  BrowserProvisionFailure,
  BrowserProvisionIo,
  BrowserProvisionReport,
  BrowserProvisionStep,
} from './browser-types.ts';

/**
 * Managed one-act browser provisioning.
 *
 * The acceptance bar is "first call works on a clean machine". That means every
 * failure mode is either handled here or reported as a plain-language problem
 * with a named fix — never a raw Playwright stack trace and never a silent
 * "browser not available".
 *
 * Handled without user action:
 *   - browser never installed        -> download it into the managed cache
 *   - partial or corrupt download    -> delete that revision and reinstall
 *   - cache unwritable / offline     -> use a browser already on the machine
 *   - missing system libraries       -> named, with the exact package to install
 */

const DEFAULT_INSTALL_TIMEOUT_MS = 900_000;
const VERSION_PROBE_TIMEOUT_MS = 30_000;

export interface EnsureBrowserOptions {
  /** Set false to report what is present without downloading anything. */
  readonly allowDownload?: boolean;
  readonly installTimeoutMs?: number;
  /** Reinstall even when the cached binary verifies. Used by explicit repair. */
  readonly forceReinstall?: boolean;
}

type VerificationFailure = 'missing' | 'not-executable' | 'missing-system-libraries' | 'corrupt';

interface VerificationResult {
  readonly ok: boolean;
  readonly failure: VerificationFailure | null;
  readonly detail: string;
}

class StepRecorder {
  private readonly steps: BrowserProvisionStep[] = [];

  constructor(private readonly io: BrowserProvisionIo) {}

  async record<T>(step: string, run: () => Promise<{ ok: boolean; detail: string; value: T }>): Promise<T> {
    const started = this.io.now();
    const outcome = await run();
    this.steps.push({ step, detail: outcome.detail, ok: outcome.ok, elapsedMs: Math.max(0, this.io.now() - started) });
    return outcome.value;
  }

  note(step: string, detail: string, ok: boolean): void {
    this.steps.push({ step, detail, ok, elapsedMs: 0 });
  }

  list(): readonly BrowserProvisionStep[] {
    return [...this.steps];
  }
}

function missingLibraryFrom(text: string): string | null {
  const match = /(?:error while loading shared libraries|cannot open shared object file)[^\n]*?(lib[\w.+-]*\.so[\w.]*)/i.exec(text)
    ?? /(lib[\w.+-]*\.so[\w.]*):[^\n]*cannot open shared object file/i.exec(text);
  return match?.[1] ?? null;
}

async function verifyExecutable(io: BrowserProvisionIo, executablePath: string): Promise<VerificationResult> {
  if (!io.pathExists(executablePath)) {
    return { ok: false, failure: 'missing', detail: `no file at ${executablePath}` };
  }
  if (!io.isExecutableFile(executablePath)) {
    return { ok: false, failure: 'not-executable', detail: `${executablePath} is not an executable file` };
  }
  const probe = await io.runCommand(executablePath, ['--version'], { timeoutMs: VERSION_PROBE_TIMEOUT_MS });
  if (probe.code === 0) {
    return { ok: true, failure: null, detail: probe.stdout.trim() || 'reported a version' };
  }
  const combined = `${probe.stdout}\n${probe.stderr}`;
  const missingLibrary = missingLibraryFrom(combined);
  if (missingLibrary) {
    return { ok: false, failure: 'missing-system-libraries', detail: missingLibrary };
  }
  const reason = probe.spawnError ?? (probe.timedOut ? 'version probe timed out' : combined.trim().split('\n')[0] ?? 'unknown error');
  return { ok: false, failure: 'corrupt', detail: reason };
}

/**
 * The managed cache entry for one browser build (…/ms-playwright/chromium-1234).
 * Removing this directory — and only this directory — is how a partial download
 * self-heals without disturbing other browser builds sharing the cache.
 */
function revisionDirectory(browsersPath: string, executablePath: string): string | null {
  if (!executablePath.startsWith(browsersPath)) return null;
  let current = executablePath;
  while (current.length > browsersPath.length) {
    const parent = dirname(current);
    if (parent === browsersPath) return current;
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/** Runtimes able to execute the Playwright install CLI, most specific first. */
function installRuntimeCandidates(): readonly string[] {
  const candidates: string[] = [];
  const execName = basename(process.execPath).toLowerCase();
  if (execName === 'bun' || execName === 'node' || execName === 'bun.exe' || execName === 'node.exe') {
    candidates.push(process.execPath);
  }
  candidates.push('bun', 'node');
  return [...new Set(candidates)];
}

function isNetworkFailure(text: string): boolean {
  return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|getaddrinfo|network|certificate|unable to verify|proxy|timed? ?out/i.test(text);
}

async function runInstall(
  io: BrowserProvisionIo,
  cliPath: string,
  force: boolean,
  timeoutMs: number,
): Promise<{ readonly ok: boolean; readonly detail: string; readonly networkFailure: boolean }> {
  const args = [cliPath, 'install', 'chromium', '--no-shell', ...(force ? ['--force'] : [])];
  let lastDetail = 'no runtime available to execute the Playwright install step';
  for (const runtime of installRuntimeCandidates()) {
    const outcome = await io.runCommand(runtime, args, {
      timeoutMs,
      // Progress bars assume a TTY; without this the captured log is unreadable noise.
      env: { PLAYWRIGHT_SKIP_BROWSER_GC: '1' },
    });
    if (outcome.spawnError && /ENOENT/i.test(outcome.spawnError)) {
      lastDetail = `${runtime} is not available`;
      continue;
    }
    const combined = `${outcome.stdout}\n${outcome.stderr}`;
    if (outcome.code === 0) {
      return { ok: true, detail: summarizeInstallLog(combined), networkFailure: false };
    }
    return {
      ok: false,
      detail: outcome.timedOut
        ? `install exceeded ${Math.round(timeoutMs / 1000)}s`
        : summarizeInstallLog(combined) || `install exited with code ${String(outcome.code)}`,
      networkFailure: isNetworkFailure(combined),
    };
  }
  return { ok: false, detail: lastDetail, networkFailure: false };
}

function summarizeInstallLog(log: string): string {
  const lines = log.split('\n').map((line) => line.trim()).filter(Boolean);
  const meaningful = lines.filter((line) => !/^\|/.test(line) && !/^\d+%/.test(line));
  return meaningful.slice(-4).join(' | ').slice(0, 400);
}

function failureGuidance(failure: BrowserProvisionFailure, detail: string, driverFix: string): { problem: string; fix: string } {
  switch (failure) {
    case 'driver-missing':
      return {
        // Reaching this means provisioning was ATTEMPTED and could not finish,
        // so the problem statement says so: "missing" on its own would read as
        // though nothing had been tried.
        problem: `The browser driver is not present and could not be installed automatically (${detail}).`,
        fix: driverFix,
      };
    case 'download-blocked-offline':
      return {
        problem: `The browser download could not reach the Playwright CDN (${detail}).`,
        fix: 'Connect to a network and retry, or install Chrome/Chromium with the system package manager — the browser tool will use an installed browser when a download is not possible.',
      };
    case 'download-failed':
      return {
        problem: `The browser download failed (${detail}).`,
        fix: 'Retry the call — provisioning deletes the partial download and reinstalls. If it keeps failing, install Chrome/Chromium with the system package manager.',
      };
    case 'binary-missing-after-install':
      return {
        problem: 'The browser install reported success but no browser executable is present afterwards.',
        fix: 'Run the browser tool with action:"provision" and repair:true to force a clean reinstall.',
      };
    case 'binary-not-executable':
      return {
        problem: `The cached browser exists but cannot be executed (${detail}).`,
        fix: 'Check that the browser cache directory is not mounted noexec, then run the browser tool with action:"provision" and repair:true.',
      };
    case 'missing-system-libraries':
      return {
        problem: `The browser is installed but the system is missing a shared library it needs: ${detail}.`,
        fix: `Install the package providing ${detail} with the system package manager (Debian/Ubuntu: apt-get install libnss3 libatk-bridge2.0-0 libgtk-3-0 libasound2; Arch: pacman -S nss atk at-spi2-atk gtk3 alsa-lib).`,
      };
    case 'cache-directory-unwritable':
      return {
        problem: `The managed browser cache directory is not writable (${detail}).`,
        fix: 'Make the cache directory writable, or set PLAYWRIGHT_BROWSERS_PATH to a writable directory, or install Chrome/Chromium system-wide.',
      };
    default:
      return {
        problem: `Browser provisioning failed: ${detail}.`,
        fix: 'Run the browser tool with action:"provision" and repair:true, or install Chrome/Chromium with the system package manager.',
      };
  }
}

const DEFAULT_DRIVER_FIX =
  'Install the browser driver beside the agent, or install bun or npm so the agent can install it for itself.';

function report(
  recorder: StepRecorder,
  browsersPath: string,
  driverVersion: string | null,
  driverFix: string,
  outcome:
    | { readonly ok: true; readonly source: BrowserProvisionReport['source']; readonly executablePath: string }
    | { readonly ok: false; readonly failure: BrowserProvisionFailure; readonly detail: string },
): BrowserProvisionReport {
  if (outcome.ok) {
    return {
      ok: true,
      source: outcome.source,
      executablePath: outcome.executablePath,
      browsersPath,
      driverVersion,
      steps: recorder.list(),
      failure: null,
      problem: null,
      fix: null,
    };
  }
  const guidance = failureGuidance(outcome.failure, outcome.detail, driverFix);
  return {
    ok: false,
    source: null,
    executablePath: null,
    browsersPath,
    driverVersion,
    steps: recorder.list(),
    failure: outcome.failure,
    problem: guidance.problem,
    fix: guidance.fix,
  };
}

async function trySystemBrowser(
  io: BrowserProvisionIo,
  recorder: StepRecorder,
): Promise<string | null> {
  const candidates = io.systemBrowserCandidates();
  if (candidates.length === 0) {
    recorder.note('system-browser', 'no Chrome/Chromium/Edge install found on this machine', false);
    return null;
  }
  for (const candidate of candidates) {
    const verification = await recorder.record('system-browser', async () => {
      const result = await verifyExecutable(io, candidate);
      return { ok: result.ok, detail: `${candidate}: ${result.detail}`, value: result };
    });
    if (verification.ok) return candidate;
  }
  return null;
}

/**
 * One line naming the setup a provisioning act actually performed, or null when
 * everything was already in place.
 *
 * Provisioning that installs a driver or downloads a browser can take minutes.
 * A call that quietly did that and then returned as though nothing happened
 * reads as a slow browser rather than as one-act setup, so every result that
 * involved real work carries this receipt back to the caller.
 */
export function describeProvisionWork(report: BrowserProvisionReport | null): string | null {
  if (!report) return null;
  const performed = report.steps.filter((step) =>
    step.ok && (step.step === 'install-driver' || step.step === 'install-browser'));
  if (performed.length === 0) return null;
  const seconds = Math.max(1, Math.round(performed.reduce((total, step) => total + step.elapsedMs, 0) / 1000));
  const what = performed.map((step) => (step.step === 'install-driver' ? 'installed the browser driver' : 'downloaded the browser'));
  return `First browser call on this machine: ${what.join(' and ')} (${seconds}s). This happens once; later calls reuse it.`;
}

const inFlight = new Map<string, Promise<BrowserProvisionReport>>();

/**
 * Ensures a usable browser binary exists, installing it if needed.
 *
 * Concurrent callers share one provisioning act: a second browser call arriving
 * mid-download waits for the same install instead of starting a competing one.
 */
export function ensureBrowserBinary(
  io: BrowserProvisionIo,
  options: EnsureBrowserOptions = {},
): Promise<BrowserProvisionReport> {
  const key = `${io.browsersPath()}::${options.forceReinstall === true ? 'repair' : 'ensure'}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const run = provision(io, options).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, run);
  return run;
}

async function provision(io: BrowserProvisionIo, options: EnsureBrowserOptions): Promise<BrowserProvisionReport> {
  const recorder = new StepRecorder(io);
  const browsersPath = io.browsersPath();
  const driverFix = io.driverFix?.() ?? DEFAULT_DRIVER_FIX;
  const driver = io.resolveDriver();
  recorder.note(
    'driver',
    driver.available
      ? `the browser driver is present (${driver.version ?? 'unknown version'}) at ${driver.packageDirectory ?? 'an installed module path'}`
      : driver.error ?? 'not resolvable',
    driver.available,
  );
  let resolvedDriver = driver;
  let driverInstallFailure: string | null = null;
  if (!resolvedDriver.available && io.installDriver && io.managedDriverRoot) {
    // Nothing shipped a driver — a binary that was moved without its companion
    // files, or a release that predates shipping one. Provisioning it is the
    // agent's job, not the user's, so it happens here rather than being
    // reported as a missing prerequisite. Installing is attempted BEFORE any
    // failure is reported, which is the whole point: a build must never say
    // the driver is missing without having tried to get one.
    const target = io.managedDriverRoot();
    const installed = await recorder.record('install-driver', async () => {
      const outcome = await io.installDriver!(target);
      return {
        ok: outcome.code === 0,
        detail: outcome.code === 0
          ? outcome.stdout.trim() || `installed the browser driver into ${target}`
          : `could not install the browser driver into ${target} — ${(outcome.spawnError ?? (outcome.stderr.trim() || `install exited with code ${String(outcome.code)}`)).slice(0, 400)}`,
        value: outcome,
      };
    });
    if (installed.code === 0) {
      resolvedDriver = io.resolveDriver();
    } else {
      driverInstallFailure = (installed.spawnError ?? (installed.stderr.trim() || `install exited with code ${String(installed.code)}`)).slice(0, 400);
    }
  }
  if (!resolvedDriver.available || !resolvedDriver.cliPath) {
    const systemBrowser = await trySystemBrowser(io, recorder);
    if (systemBrowser) {
      // Without the driver package there is no automation API at all, so a
      // system browser cannot rescue this case. Report the real blocker.
      recorder.note('driver', 'a system browser exists but the automation driver is still required', false);
    }
    return report(recorder, browsersPath, resolvedDriver.version, driverFix, {
      ok: false,
      failure: 'driver-missing',
      // The install failure is the actionable detail when one happened; the
      // resolution error only says "not found", which is not why it is absent.
      detail: driverInstallFailure ?? resolvedDriver.error ?? 'the browser driver could not be resolved',
    });
  }
  const driverCliPath = resolvedDriver.cliPath;

  const expected = io.expectedExecutablePath();
  if (expected && options.forceReinstall !== true) {
    const verification = await recorder.record('cached-browser', async () => {
      const result = await verifyExecutable(io, expected);
      return { ok: result.ok, detail: result.detail, value: result };
    });
    if (verification.ok) {
      return report(recorder, browsersPath, resolvedDriver.version, driverFix, {
        ok: true,
        source: 'managed-cache',
        executablePath: expected,
      });
    }
    if (verification.failure === 'missing-system-libraries') {
      return report(recorder, browsersPath, resolvedDriver.version, driverFix, {
        ok: false,
        failure: 'missing-system-libraries',
        detail: verification.detail,
      });
    }
  }

  if (options.allowDownload === false) {
    const systemBrowser = await trySystemBrowser(io, recorder);
    if (systemBrowser) {
      return report(recorder, browsersPath, resolvedDriver.version, driverFix, {
        ok: true,
        source: 'system-browser',
        executablePath: systemBrowser,
      });
    }
    return report(recorder, browsersPath, resolvedDriver.version, driverFix, {
      ok: false,
      failure: 'binary-missing-after-install',
      detail: 'no managed browser is installed and downloading was not allowed for this call',
    });
  }

  if (!io.directoryWritable(browsersPath)) {
    const systemBrowser = await trySystemBrowser(io, recorder);
    if (systemBrowser) {
      return report(recorder, browsersPath, resolvedDriver.version, driverFix, {
        ok: true,
        source: 'system-browser',
        executablePath: systemBrowser,
      });
    }
    return report(recorder, browsersPath, resolvedDriver.version, driverFix, {
      ok: false,
      failure: 'cache-directory-unwritable',
      detail: browsersPath,
    });
  }

  // Self-heal: a stale or partial build directory is removed before reinstalling,
  // so a broken install never persists into the next attempt.
  const staleDirectory = expected ? revisionDirectory(browsersPath, expected) : null;
  const stalePresent = staleDirectory !== null && io.pathExists(staleDirectory);
  if (stalePresent && staleDirectory) {
    recorder.note('self-heal', `removing incomplete browser build at ${staleDirectory}`, true);
    try {
      io.removePath(staleDirectory);
    } catch (error) {
      recorder.note('self-heal', `could not remove ${staleDirectory}: ${error instanceof Error ? error.message : String(error)}`, false);
    }
  }

  const install = await recorder.record('install-browser', async () => {
    const result = await runInstall(io, driverCliPath, options.forceReinstall === true || stalePresent, options.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS);
    return { ok: result.ok, detail: result.detail, value: result };
  });

  if (install.ok) {
    const installedPath = io.expectedExecutablePath();
    if (installedPath) {
      const verification = await recorder.record('verify-install', async () => {
        const result = await verifyExecutable(io, installedPath);
        return { ok: result.ok, detail: result.detail, value: result };
      });
      if (verification.ok) {
        return report(recorder, browsersPath, resolvedDriver.version, driverFix, {
          ok: true,
          source: 'managed-download',
          executablePath: installedPath,
        });
      }
      if (verification.failure === 'missing-system-libraries') {
        return report(recorder, browsersPath, resolvedDriver.version, driverFix, {
          ok: false,
          failure: 'missing-system-libraries',
          detail: verification.detail,
        });
      }
    }
  }

  const systemBrowser = await trySystemBrowser(io, recorder);
  if (systemBrowser) {
    return report(recorder, browsersPath, resolvedDriver.version, driverFix, {
      ok: true,
      source: 'system-browser',
      executablePath: systemBrowser,
    });
  }

  if (!install.ok) {
    return report(recorder, browsersPath, resolvedDriver.version, driverFix, {
      ok: false,
      failure: install.networkFailure ? 'download-blocked-offline' : 'download-failed',
      detail: install.detail,
    });
  }
  return report(recorder, browsersPath, resolvedDriver.version, driverFix, {
    ok: false,
    failure: 'binary-missing-after-install',
    detail: 'install completed but the browser executable did not verify',
  });
}
