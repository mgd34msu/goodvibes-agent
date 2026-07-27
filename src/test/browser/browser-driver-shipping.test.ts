import { afterAll, describe, expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { extractTarGzEntry, extractTarGzTree, readTarGzEntries } from '../../runtime/tar-archive.ts';
import { driverRemediation } from '../../browser/browser-driver-remediation.ts';
import {
  DRIVER_REQUIRED_FILES,
  driverSearchDirectories,
  findDriverDirectory,
  managedDriverRoot,
} from '../../browser/browser-provision-io.ts';
import {
  describeProvisionWork,
  ensureBrowserBinary,
  installRuntimeCandidates,
  installRuntimeCandidatesFor,
} from '../../browser/browser-provisioning.ts';
import { runCapabilityProbe, emptyProbeContext } from '../../capabilities/capability-probe-runner.ts';
import { browserControlDeclaration } from '../../capabilities/builtin-capabilities.ts';
import {
  BROWSER_DRIVER_ARCHIVE_NAME,
  BROWSER_DRIVER_DIR_NAME,
  BROWSER_DRIVER_REQUIRED_ENTRIES,
} from '../../runtime/release-artifacts.ts';
import type { BrowserProvisionIo, CommandOutcome } from '../../browser/browser-types.ts';

/**
 * The 1.18.1 browser failure, pinned so it cannot ship again.
 *
 * Three independent defects had to line up to produce it, and each is covered
 * here separately because fixing any one of them alone leaves the capability
 * broken:
 *
 *   1. the driver never reached the release asset, so a downloaded binary had
 *      none beside it;
 *   2. the capability probe resolved the driver as a MODULE, which can never
 *      succeed inside a compiled binary — so browser control reported
 *      needs-setup even with a driver correctly in place, and the model relayed
 *      that instead of calling the tool;
 *   3. the remediation told a binary user to install the npm package.
 */

const scratchDirs: string[] = [];
function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  scratchDirs.push(dir);
  return dir;
}

/** Builds a ustar tar.gz in memory, so no test shells out to `tar`. */
function buildTarGz(entries: readonly { path: string; data?: string; mode?: number; directory?: boolean }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    const body = Buffer.from(entry.data ?? '', 'utf-8');
    header.write(entry.path.slice(0, 100), 0, 'utf-8');
    header.write((entry.mode ?? 0o644).toString(8).padStart(7, '0') + '\0', 100, 'utf-8');
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write((entry.directory === true ? 0 : body.length).toString(8).padStart(11, '0') + '\0', 124, 'utf-8');
    header.write('00000000000\0', 136);
    header.write(entry.directory === true ? '5' : '0', 156, 'utf-8');
    header.write('ustar\0', 257, 'utf-8');
    header.write('00', 263, 'utf-8');
    // Checksum: sum of all header bytes with the checksum field read as spaces.
    header.write('        ', 148, 8, 'utf-8');
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf-8');
    blocks.push(header);
    if (entry.directory !== true && body.length > 0) {
      const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
      body.copy(padded);
      blocks.push(padded);
    }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.from(gzipSync(Buffer.concat(blocks)));
}

function driverArchive(): Buffer {
  return buildTarGz([
    { path: `${BROWSER_DRIVER_DIR_NAME}/`, directory: true },
    { path: `${BROWSER_DRIVER_DIR_NAME}/package.json`, data: JSON.stringify({ name: 'playwright-core', version: '1.62.0' }) },
    { path: `${BROWSER_DRIVER_DIR_NAME}/index.js`, data: 'module.exports = {};\n' },
    { path: `${BROWSER_DRIVER_DIR_NAME}/cli.js`, data: '#!/usr/bin/env node\n', mode: 0o755 },
    { path: `${BROWSER_DRIVER_DIR_NAME}/lib/xdg-open`, data: '#!/bin/sh\n', mode: 0o755 },
  ]);
}

describe('the driver archive the release ships', () => {
  test('carries every entry the update path refuses to install without', () => {
    const archive = driverArchive();
    for (const required of BROWSER_DRIVER_REQUIRED_ENTRIES) {
      expect(extractTarGzEntry(archive, required), `${required} must be in the archive`).not.toBeNull();
    }
  });

  test('extracts to the exact directory the runtime searches, with the executable bit preserved', () => {
    const installDir = scratch('gv-extract');
    extractTarGzTree(driverArchive(), join(installDir, BROWSER_DRIVER_DIR_NAME), {});

    const driverDir = join(installDir, BROWSER_DRIVER_DIR_NAME, BROWSER_DRIVER_DIR_NAME);
    // stripComponents defaults to 0, so the archive's own prefix is kept here;
    // the update path and the installer both strip it. Assert the payload.
    expect(existsSync(join(driverDir, 'cli.js'))).toBe(true);
    // cli.js is executed to install a browser; a non-executable copy is useless.
    expect(statSync(join(driverDir, 'cli.js')).mode & 0o111).not.toBe(0);
    expect(statSync(join(driverDir, 'package.json')).mode & 0o111).toBe(0);
  });

  test('stripComponents lands the driver directly where the binary looks for it', () => {
    const installDir = scratch('gv-strip');
    const target = join(installDir, BROWSER_DRIVER_DIR_NAME);
    extractTarGzTree(driverArchive(), target, { stripComponents: 1 });

    expect(existsSync(join(target, 'cli.js'))).toBe(true);
    expect(existsSync(join(target, 'package.json'))).toBe(true);
    // And the FIRST place the runtime looks is that same directory name beside
    // the running executable — which is what the release asset, the installer,
    // and the update swap all extract into.
    expect(driverSearchDirectories(installDir)[0]).toBe(join(dirname(process.execPath), BROWSER_DRIVER_DIR_NAME));
  });

  test('an archive entry that would escape the destination is refused, not sanitised', () => {
    const hostile = buildTarGz([{ path: '../escaped.js', data: 'nope' }]);
    const target = scratch('gv-escape');
    expect(() => extractTarGzTree(hostile, join(target, 'inner'), {})).toThrow(/escapes the destination/);
    expect(existsSync(join(target, 'escaped.js'))).toBe(false);
  });

  test('an absolute archive entry is refused', () => {
    const hostile = buildTarGz([{ path: '/etc/goodvibes-escape', data: 'nope' }]);
    expect(() => extractTarGzTree(hostile, scratch('gv-abs'), {})).toThrow(/absolute path/);
  });

  test('a corrupt archive fails loudly rather than reading as empty', () => {
    expect(() => [...readTarGzEntries(Buffer.from('not a gzip stream'))]).toThrow();
  });
});

describe('the capability probe that made this unrecoverable', () => {
  const label = 'The browser driver';

  test('a driver beside the executable satisfies the probe even though it is not a resolvable module', () => {
    const installDir = scratch('gv-probe');
    const driverDir = join(installDir, BROWSER_DRIVER_DIR_NAME);
    mkdirSync(driverDir, { recursive: true });
    writeFileSync(join(driverDir, 'package.json'), '{"name":"playwright-core"}');
    writeFileSync(join(driverDir, 'index.js'), 'module.exports = {};');

    const result = runCapabilityProbe(
      // A specifier that is deliberately not installed anywhere, so the only
      // way this can pass is the on-disk search — the case a compiled binary is
      // always in.
      { kind: 'module-resolvable', specifier: 'playwright-core-not-a-real-package', label, searchDirectories: [driverDir] },
      emptyProbeContext(),
    );

    expect(result.satisfied).toBe(true);
    expect(result.detail).toContain(driverDir);
  });

  test('with no driver anywhere the probe names the places it looked', () => {
    const missing = join(scratch('gv-probe-miss'), BROWSER_DRIVER_DIR_NAME);
    const result = runCapabilityProbe(
      { kind: 'module-resolvable', specifier: 'playwright-core-not-a-real-package', label, searchDirectories: [missing] },
      emptyProbeContext(),
    );

    expect(result.satisfied).toBe(false);
    expect(result.detail).toContain(missing);
  });

  test('a partial driver beside the binary does not shadow a good one elsewhere', () => {
    // The search stops at the first match, so an incomplete candidate that
    // still counted as a driver made the good one unreachable — and no amount
    // of self-provisioning could recover, because the broken one kept winning.
    const installDir = scratch('gv-shadow');
    const partial = join(installDir, 'partial', BROWSER_DRIVER_DIR_NAME);
    const complete = join(installDir, 'complete', BROWSER_DRIVER_DIR_NAME);
    mkdirSync(partial, { recursive: true });
    writeFileSync(join(partial, 'package.json'), '{"name":"playwright-core"}');
    writeFileSync(join(partial, 'index.js'), 'module.exports = {};');
    extractTarGzTree(driverArchive(), complete, { stripComponents: 1 });

    const resolved = findDriverDirectory(undefined, [partial, complete]);
    expect(resolved).toBe(complete);
  });

  test('a directory holding only a manifest is not a driver', () => {
    const half = join(scratch('gv-probe-half'), BROWSER_DRIVER_DIR_NAME);
    mkdirSync(half, { recursive: true });
    writeFileSync(join(half, 'package.json'), '{"name":"playwright-core"}');

    const result = runCapabilityProbe(
      { kind: 'module-resolvable', specifier: 'playwright-core-not-a-real-package', label, searchDirectories: [half] },
      emptyProbeContext(),
    );
    expect(result.satisfied).toBe(false);
  });

  test('the probe and the runtime resolver agree about a driver missing its CLI', () => {
    // The resolver skips a directory without cli.js, because cli.js is what the
    // browser install step executes. The probe used a weaker rule, so it
    // reported "the browser driver is present at X" for a directory the tool
    // then refused — the index disagreeing with the tool a moment later is
    // precisely what this probe exists to prevent.
    const noCli = join(scratch('gv-probe-nocli'), BROWSER_DRIVER_DIR_NAME);
    mkdirSync(noCli, { recursive: true });
    writeFileSync(join(noCli, 'package.json'), '{"name":"playwright-core","version":"1.62.0"}');
    writeFileSync(join(noCli, 'index.js'), 'module.exports = {};');

    expect(findDriverDirectory(undefined, [noCli]), 'the resolver rejects it').toBeNull();

    const result = runCapabilityProbe(
      {
        kind: 'module-resolvable',
        specifier: 'playwright-core-not-a-real-package',
        label,
        searchDirectories: [noCli],
        requiredFiles: DRIVER_REQUIRED_FILES,
      },
      emptyProbeContext(),
    );
    expect(result.satisfied, 'the probe must reject it too').toBe(false);
  });

  test('the browser capability declares the resolver rule, not a weaker one', () => {
    // Declaring the directories without the completeness rule is what let the
    // two drift apart, so the declaration itself is pinned.
    const declaration = browserControlDeclaration({ homeDirectory: '/home/someone', workingDirectory: '/tmp' });
    const prerequisite = declaration.prerequisites?.find((entry) => entry.id === 'playwright-driver');
    expect(prerequisite).toBeDefined();
    const probe = prerequisite?.probe;
    expect(probe?.kind).toBe('module-resolvable');
    expect(probe?.kind === 'module-resolvable' ? probe.requiredFiles : undefined).toEqual(DRIVER_REQUIRED_FILES);
    expect(probe?.kind === 'module-resolvable' ? probe.searchDirectories : undefined)
      .toEqual(driverSearchDirectories('/home/someone'));
  });
});

describe('the browser install step on a machine with no interpreter', () => {
  test('the running executable is always a candidate, so an install never needs bun or node on PATH', () => {
    const candidates = installRuntimeCandidates();
    expect(candidates[0]?.command).toBe(process.execPath);
    // Under `bun test` the running executable IS an interpreter, so it needs no
    // marker; a compiled binary needs BUN_BE_BUN to act as one. Either way the
    // artifact's own executable is tried before anything on PATH.
    expect(candidates.map((candidate) => candidate.command)).toContain('bun');
    expect(candidates.map((candidate) => candidate.command)).toContain('node');
  });

  test('a compiled binary runs the install CLI through its own embedded runtime', () => {
    // Pinned as a value rather than only observed at runtime: the compiled
    // agent binary has no `bun` and no `node` beside it, and without this the
    // managed browser download is unreachable on a binary-only machine.
    const compiled = installRuntimeCandidatesFor('/home/someone/.local/bin/goodvibes-agent');
    expect(compiled[0]).toEqual({ command: '/home/someone/.local/bin/goodvibes-agent', env: { BUN_BE_BUN: '1' } });

    const interpreter = installRuntimeCandidatesFor('/usr/local/bin/bun');
    expect(interpreter[0]).toEqual({ command: '/usr/local/bin/bun', env: {} });
  });

  test('a missing interpreter is recognized as missing, and the next candidate is tried', async () => {
    // Bun reports a missing program as `Executable not found in $PATH: "bun"`,
    // never as ENOENT. Matching ENOENT alone stopped the loop on the first
    // candidate and reported "install exited with code null", which names
    // nothing the owner can act on.
    const tried: string[] = [];
    const io = stubIo({
      resolveDriver: () => ({
        available: true,
        packageDirectory: '/drv',
        cliPath: '/drv/cli.js',
        version: '1.62.0',
        error: null,
      }),
      expectedExecutablePath: () => '/cache/chromium-1234/chrome-linux64/chrome',
      pathExists: () => false,
      directoryWritable: () => true,
      systemBrowserCandidates: () => [],
      runCommand: async (command) => {
        tried.push(command);
        return {
          code: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          spawnError: `Executable not found in $PATH: "${command}"`,
        };
      },
    });

    const report = await ensureBrowserBinary(io, {});

    expect(tried.length, 'every candidate must be tried, not just the first').toBeGreaterThan(1);
    expect(report.ok).toBe(false);
    expect(report.problem).not.toContain('exited with code null');
    expect(report.problem).toContain('is not available');
  });
});

describe('remediation matches how the agent was actually installed', () => {
  test('a binary install is told to get the driver that ships with the release, never to install the npm package', () => {
    const message = driverRemediation({ execPath: '/home/someone/.local/bin/goodvibes-agent' });
    expect(message).toContain(BROWSER_DRIVER_ARCHIVE_NAME);
    expect(message).toContain('/home/someone/.local/bin/playwright-core');
    // The exact instruction the owner was given, which silently switched a
    // binary install to a package install.
    expect(message).not.toContain('bun add -g @pellux/goodvibes-agent');
  });

  test('a package install is told to reinstall the package', () => {
    const message = driverRemediation({ execPath: '/home/someone/.bun/install/global/node_modules/@pellux/goodvibes-agent/bin/goodvibes-agent' });
    expect(message).toContain('bun add -g @pellux/goodvibes-agent');
  });

  test('a source checkout is told to install dependencies', () => {
    const message = driverRemediation({ execPath: '/usr/local/bin/bun' });
    expect(message).toContain('bun install');
    expect(message).not.toContain('bun add -g');
  });
});

/** Minimal IO that never touches the network, the filesystem, or a process. */
function stubIo(overrides: Partial<BrowserProvisionIo> = {}): BrowserProvisionIo {
  const ok: CommandOutcome = { code: 0, stdout: '', stderr: '', timedOut: false, spawnError: null };
  return {
    resolveDriver: () => ({ available: false, packageDirectory: null, cliPath: null, version: null, error: 'no driver' }),
    expectedExecutablePath: () => null,
    browsersPath: () => join(tmpdir(), `gv-browsers-${Math.random().toString(36).slice(2)}`),
    pathExists: () => false,
    isExecutableFile: () => false,
    directoryWritable: () => true,
    removePath: () => undefined,
    runCommand: async () => ok,
    systemBrowserCandidates: () => [],
    now: () => 0,
    ...overrides,
  };
}

describe('the self-provision fallback', () => {
  test('is attempted before the driver is ever reported missing', async () => {
    let attempted = false;
    const io = stubIo({
      installDriver: async () => {
        attempted = true;
        return { code: 1, stdout: '', stderr: 'registry unreachable', timedOut: false, spawnError: null };
      },
      managedDriverRoot: () => '/tmp/gv-managed',
    });

    const report = await ensureBrowserBinary(io, {});

    expect(attempted, 'provisioning must be tried before reporting the driver missing').toBe(true);
    expect(report.ok).toBe(false);
    expect(report.failure).toBe('driver-missing');
    // The report says it tried and what stopped it, not merely "missing".
    expect(report.problem).toContain('could not be installed automatically');
    expect(report.problem).toContain('registry unreachable');
    expect(report.steps.some((step) => step.step === 'install-driver')).toBe(true);
  });

  test('reports the install-kind-aware fix when provisioning genuinely cannot work', async () => {
    const io = stubIo({
      installDriver: async () => ({ code: 1, stdout: '', stderr: 'offline', timedOut: false, spawnError: null }),
      managedDriverRoot: () => '/tmp/gv-managed',
      driverFix: () => driverRemediation({ execPath: '/home/someone/.local/bin/goodvibes-agent' }),
    });

    const report = await ensureBrowserBinary(io, {});

    expect(report.fix).toContain(BROWSER_DRIVER_ARCHIVE_NAME);
    expect(report.fix).not.toContain('bun add -g @pellux/goodvibes-agent');
  });

  test('a driver installed by the fallback is then used, not re-reported as missing', async () => {
    let installed = false;
    const io = stubIo({
      installDriver: async () => {
        installed = true;
        return { code: 0, stdout: 'downloaded playwright-core@1.62.0 from the npm registry', stderr: '', timedOut: false, spawnError: null };
      },
      managedDriverRoot: () => '/tmp/gv-managed',
      resolveDriver: () => installed
        ? { available: true, packageDirectory: '/tmp/gv-managed', cliPath: '/tmp/gv-managed/cli.js', version: '1.62.0', error: null }
        : { available: false, packageDirectory: null, cliPath: null, version: null, error: 'no driver' },
      // A system browser is present, so provisioning can complete without a download.
      systemBrowserCandidates: () => ['/usr/bin/chromium'],
      isExecutableFile: () => true,
      pathExists: () => true,
      runCommand: async () => ({ code: 0, stdout: 'Chromium 148', stderr: '', timedOut: false, spawnError: null }),
    });

    const report = await ensureBrowserBinary(io, {});

    expect(installed).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.driverVersion).toBe('1.62.0');
  });

  test('a reporting call installs no driver, and says that is why none is there', async () => {
    // `status` is a read-only action everywhere it is gated, and the CLI help
    // says it installs nothing. It reached this policy with allowDownload:false
    // and the driver install ran anyway, fetching a package from the registry
    // and writing it into the owner's home on what the owner was told was a
    // look-only call.
    let installAttempted = false;
    const io = stubIo({
      installDriver: async () => {
        installAttempted = true;
        return { code: 0, stdout: 'downloaded', stderr: '', timedOut: false, spawnError: null };
      },
      managedDriverRoot: () => '/tmp/gv-managed',
      resolveDriver: () => ({ available: false, packageDirectory: null, cliPath: null, version: null, error: 'no driver' }),
    });

    const report = await ensureBrowserBinary(io, { allowDownload: false });

    expect(installAttempted, 'a reporting call must not install a driver').toBe(false);
    expect(report.ok).toBe(false);
    expect(report.failure).toBe('driver-not-installed-yet');
    // And it must not claim installing was tried and failed.
    expect(report.problem).not.toContain('could not be installed');
    expect(report.problem).toContain('installs nothing');
    expect(report.steps.some((step) => step.step === 'install-driver')).toBe(false);
    expect(report.steps.some((step) => step.step === 'install-driver-skipped')).toBe(true);
  });

  test('a skipped driver install never reads as setup that ran', async () => {
    // describeProvisionWork turns ok install steps into a "first browser call
    // installed the driver" receipt for the model. A skip is not an install.
    const io = stubIo({
      installDriver: async () => ({ code: 0, stdout: 'downloaded', stderr: '', timedOut: false, spawnError: null }),
      managedDriverRoot: () => '/tmp/gv-managed',
      resolveDriver: () => ({ available: false, packageDirectory: null, cliPath: null, version: null, error: 'no driver' }),
    });

    const report = await ensureBrowserBinary(io, { allowDownload: false });

    expect(describeProvisionWork(report)).toBe(null);
  });

  test('setup that actually ran is reported back to the caller', () => {
    const receipt = describeProvisionWork({
      ok: true,
      source: 'managed-download',
      executablePath: '/x',
      browsersPath: '/y',
      driverVersion: '1.62.0',
      steps: [
        { step: 'install-driver', detail: 'installed', ok: true, elapsedMs: 1200 },
        { step: 'install-browser', detail: 'downloaded', ok: true, elapsedMs: 7000 },
      ],
      failure: null,
      problem: null,
      fix: null,
    });
    expect(receipt).toContain('installed the browser driver');
    expect(receipt).toContain('downloaded the browser');
  });

  test('a call that had nothing to do reports no setup', () => {
    const receipt = describeProvisionWork({
      ok: true,
      source: 'managed-cache',
      executablePath: '/x',
      browsersPath: '/y',
      driverVersion: '1.62.0',
      steps: [{ step: 'cached-browser', detail: 'ok', ok: true, elapsedMs: 10 }],
      failure: null,
      problem: null,
      fix: null,
    });
    expect(receipt).toBeNull();
  });
});

describe('the managed driver location', () => {
  test('is inside the agent-owned storage for the home it was given', () => {
    const root = managedDriverRoot('/home/someone');
    expect(root).toBe(join('/home/someone', '.goodvibes', 'agent', 'browser', 'driver'));
    expect(driverSearchDirectories('/home/someone')).toContain(join(root, 'node_modules', BROWSER_DRIVER_DIR_NAME));
  });
});

// Scratch cleanup is deliberate rather than left to the OS: these tests create
// real directories, and the repo's own stale-tmp gate exists because they add up.
afterAll(() => {
  for (const dir of scratchDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});
