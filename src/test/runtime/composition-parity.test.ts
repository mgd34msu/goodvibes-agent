/**
 * composition-parity.test.ts
 *
 * Pins two pieces of fork-parity wiring that createRuntimeServices (this
 * repo's composition root) must mirror from the SDK's own
 * platform/runtime/services.ts composition root:
 *
 *  1. operations.runStartupAppendOnlySweep runs at composition time with the
 *     FULL roots object (workingDirectory, surfaceRoot, homeDirectory,
 *     logDir, telemetryDir) — not just workingDirectory + surfaceRoot, which
 *     would silently skip the registered activity-log and telemetry-ledger
 *     stores on every sweep (the exact defect the SDK's own round fixed at
 *     its call site). Proven behaviorally: seed a real, over-cap activity.md
 *     under this repo's ACTUAL on-disk log location
 *     (workingDirectory/.goodvibes/logs/activity.md, the same directory
 *     entrypoint.ts's configureActivityLogger writes into) and confirm the
 *     sweep reclaims it using the live atRest.* config caps.
 *
 *  2. configManager.watchConfigFiles() is started at composition time, so an
 *     external edit to the on-disk settings.json applies live through the
 *     same subscribe() pipeline an in-process set() uses, with no restart.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigManager } from '../../config/index.ts';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import { createRuntimeServices, type RuntimeServices } from '../../runtime/services.ts';

describe('composition parity: append-only sweep + live config watch', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function makeRoots(): { workingDir: string; homeDir: string; configDir: string } {
    root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-composition-parity-'));
    const workingDir = join(root, 'workspace');
    const homeDir = join(root, 'home');
    const configDir = join(homeDir, '.goodvibes', 'agent');
    mkdirSync(workingDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    return { workingDir, homeDir, configDir };
  }

  function makeServices(configManager: ConfigManager, workingDir: string, homeDir: string): RuntimeServices {
    return createRuntimeServices({
      runtimeBus: new RuntimeEventBus(),
      runtimeStore: createRuntimeStore(),
      configManager,
      workingDir,
      homeDirectory: homeDir,
    });
  }

  test('runStartupAppendOnlySweep runs at composition with full roots, reclaiming the real on-disk activity.md', () => {
    const { workingDir, homeDir, configDir } = makeRoots();
    const logDir = join(workingDir, '.goodvibes', 'logs');
    mkdirSync(logDir, { recursive: true });
    const activityLogPath = join(logDir, 'activity.md');
    // 2MB comfortably exceeds the schema's minimum valid cap (1MB, an
    // integer), forcing the sweep to reclaim it on the size cap alone.
    writeFileSync(activityLogPath, 'x'.repeat(2 * 1024 * 1024), 'utf-8');
    expect(existsSync(activityLogPath)).toBe(true);

    const configManager = new ConfigManager({ surfaceRoot: 'agent', workingDir, homeDir, configDir });
    configManager.set('atRest.retentionMaxTotalMb', 1);

    const services = makeServices(configManager, workingDir, homeDir);
    try {
      // The sweep is synchronous inside createRuntimeServices — no wait needed.
      expect(existsSync(activityLogPath)).toBe(false);
    } finally {
      services.providerRegistry.stopWatching();
      configManager.stopWatchingConfigFiles();
    }
  });

  test('runStartupAppendOnlySweep leaves a fresh, under-cap activity.md alone (the sweep is real retention, not a wipe)', () => {
    const { workingDir, homeDir, configDir } = makeRoots();
    const logDir = join(workingDir, '.goodvibes', 'logs');
    mkdirSync(logDir, { recursive: true });
    const activityLogPath = join(logDir, 'activity.md');
    writeFileSync(activityLogPath, 'small', 'utf-8');

    const configManager = new ConfigManager({ surfaceRoot: 'agent', workingDir, homeDir, configDir });
    // Default caps (30 days / 512MB): a few bytes, just written, survives.
    const services = makeServices(configManager, workingDir, homeDir);
    try {
      expect(existsSync(activityLogPath)).toBe(true);
      expect(readFileSync(activityLogPath, 'utf-8')).toBe('small');
    } finally {
      services.providerRegistry.stopWatching();
      configManager.stopWatchingConfigFiles();
    }
  });

  test('configManager.watchConfigFiles() is live at composition: an external settings.json edit applies without an explicit reload', async () => {
    const { workingDir, homeDir, configDir } = makeRoots();
    const configManager = new ConfigManager({ surfaceRoot: 'agent', workingDir, homeDir, configDir });
    const services = makeServices(configManager, workingDir, homeDir);
    try {
      expect(configManager.get('power.keepAwake')).toBe(false);

      const settingsPath = configManager.getConfigPath();
      const onDisk: Record<string, unknown> = existsSync(settingsPath)
        ? (JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>)
        : {};
      onDisk.power = { ...(onDisk.power as Record<string, unknown> | undefined), keepAwake: true };
      writeFileSync(settingsPath, JSON.stringify(onDisk, null, 2), 'utf-8');

      // watchConfigFiles polls (default 250ms); give it margin to fire.
      const deadline = Date.now() + 2000;
      let observed = configManager.get('power.keepAwake');
      while (observed !== true && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        observed = configManager.get('power.keepAwake');
      }
      expect(observed).toBe(true);
    } finally {
      services.providerRegistry.stopWatching();
      configManager.stopWatchingConfigFiles();
    }
  });
});

describe('composition parity: host power seam is opt-in (non-spawning default)', () => {
  // SDK 1.9.0's wireRuntimePower defaults an ABSENT seam to the real host seam
  // (createHostPowerSeam — which spawns systemd-inhibit inhibitors and a
  // dbus-monitor sleep-edge watcher). That host-level spawn must never fire on
  // a test-constructed runtime, so createRuntimeServices mirrors the SDK's own
  // composition root: default to the NON-spawning unavailable seam, and only
  // the real long-lived composition that owns the sleep edge opts in. These
  // source pins catch a regression in either half without constructing (and
  // therefore without spawning) a host seam.
  const repoRoot = resolve(import.meta.dir, '../../..');
  const readSource = (rel: string): string => readFileSync(resolve(repoRoot, rel), 'utf8');

  test('createRuntimeServices defaults an absent powerSeam to the non-spawning unavailable seam', () => {
    const services = readSource('src/runtime/services.ts');
    expect(services).toMatch(
      /seam:\s*options\.powerSeam\s*\?\?\s*createUnavailablePowerSeam\(/,
    );
    expect(services).toContain(
      "import { createUnavailablePowerSeam, wireRuntimePower } from '@pellux/goodvibes-sdk/platform/power'",
    );
  });

  test('the embedded interactive runtime opts into the real host power seam (it owns the sleep edge)', () => {
    const bootstrapCore = readSource('src/runtime/bootstrap-core.ts');
    expect(bootstrapCore).toContain('powerSeam: createHostPowerSeam()');
    expect(bootstrapCore).toContain(
      "import { createHostPowerSeam } from '@pellux/goodvibes-sdk/platform/power'",
    );
  });

  test('one-shot CLI subcommands do NOT opt into the host seam (no spawn for a short-lived command)', () => {
    // management.ts (withRuntimeServices) and bundle-command.ts
    // (buildProviderReadiness) build a runtime for a single query and dispose
    // it — neither owns the sleep edge, so neither passes a powerSeam.
    for (const rel of ['src/cli/management.ts', 'src/cli/bundle-command.ts']) {
      expect(readSource(rel)).not.toContain('powerSeam:');
    }
  });
});
