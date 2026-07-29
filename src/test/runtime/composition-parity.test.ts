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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ConfigManager } from '../../config/index.ts';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import {
  createRuntimeServices,
  shouldRefreshModels,
  type ModelDiscoveryMode,
  type RuntimeServices,
} from '../../runtime/services.ts';
import { ProviderRegistry } from '@pellux/goodvibes-sdk/platform/providers';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

describe('composition parity: append-only sweep + live config watch', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function makeRoots(): { workingDir: string; homeDir: string; configDir: string } {
    root = makeProjectTempDir('goodvibes-agent-composition-parity');
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
      // Opt out: this process does not outlive the unawaited sweep.
      modelDiscovery: 'skip',
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

describe('composition parity: live model discovery refreshes by default, and callers may skip', () => {
  // The provider registry's live discovery sweep is fire-and-forget: nothing
  // awaits it, and on completion it writes
  // <persistenceRoot>/provider-models/<provider>.json. Measured here, that
  // write landed AFTER a test run had finished and RE-CREATED a temp workspace
  // whose cleanup had already removed it — the last surviving directory leak in
  // the suite. So the sweep is opt-in, and only the long-lived interactive
  // composition (still running when it resolves) opts in.
  const repoRoot = resolve(import.meta.dir, '../../..');
  const readSource = (rel: string): string => readFileSync(resolve(repoRoot, rel), 'utf8');

  let root = '';
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  /** Does this runtime's persistence root hold a live-discovery model cache? */
  function hasProviderModelsCache(configDir: string): boolean {
    return existsSync(join(configDir, 'provider-models'));
  }

  test('createRuntimeServices without the opt-in starts no discovery sweep', () => {
    root = makeProjectTempDir('goodvibes-agent-model-discovery');
    const workingDir = join(root, 'workspace');
    const homeDir = join(root, 'home');
    const configDir = join(homeDir, '.goodvibes', 'agent');
    mkdirSync(workingDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });

    createRuntimeServices({
      // Opt out: this process does not outlive the unawaited sweep.
      modelDiscovery: 'skip',
      runtimeBus: new RuntimeEventBus(),
      runtimeStore: createRuntimeStore(),
      configManager: new ConfigManager({ workingDir, homeDir, surfaceRoot: 'agent' }),
      workingDir,
      homeDirectory: homeDir,
    });

    expect(hasProviderModelsCache(configDir)).toBe(false);

    // NO-proof for the probe itself: the assertion above would read false just
    // as happily if it were watching a path nothing ever writes. Plant the
    // cache the sweep produces and confirm the same probe reports it.
    mkdirSync(join(configDir, 'provider-models'), { recursive: true });
    writeFileSync(join(configDir, 'provider-models', 'cerebras.json'), '{}', 'utf8');
    expect(hasProviderModelsCache(configDir)).toBe(true);
  });

  test('the shipped default refreshes; only an explicit skip does not', () => {
    // Driven, not read out of the source text. The previous version of this
    // test asserted that services.ts CONTAINED a particular line, which says
    // nothing about what the runtime does and passed just as happily when the
    // shipped default had been flipped.
    expect(shouldRefreshModels(undefined)).toBe(true);
    expect(shouldRefreshModels('refresh')).toBe(true);
    expect(shouldRefreshModels('skip')).toBe(false);
  });

  test('createRuntimeServices starts the sweep by default and not when told to skip', () => {
    const calls: string[] = [];
    const real = ProviderRegistry.prototype.initProviderModelDiscovery;
    ProviderRegistry.prototype.initProviderModelDiscovery = function patched(this: ProviderRegistry) {
      calls.push('called');
      // Deliberately does NOT call through: the real sweep reaches provider
      // endpoints and writes provider-models/*.json from an unawaited promise.
    } as typeof real;
    try {
      const build = (mode: ModelDiscoveryMode | undefined): void => {
        const homeDir = makeProjectTempDir('gv-discovery');
        const workingDir = join(homeDir, 'workspace');
        mkdirSync(workingDir, { recursive: true });
        createRuntimeServices({
          ...(mode === undefined ? {} : { modelDiscovery: mode }),
          runtimeBus: new RuntimeEventBus(),
          runtimeStore: createRuntimeStore(),
          configManager: new ConfigManager({ workingDir, homeDir, surfaceRoot: 'agent' }),
          workingDir,
          homeDirectory: homeDir,
        });
      };

      build('skip');
      expect(calls).toHaveLength(0);

      // The same construction with the shipped default DOES start it. Without
      // this half, the assertion above would pass on a runtime that had stopped
      // discovering models entirely.
      build(undefined);
      expect(calls).toHaveLength(1);
    } finally {
      ProviderRegistry.prototype.initProviderModelDiscovery = real;
    }
  });
});

describe('composition parity: the trigger family is composed, not just importable', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function build(): RuntimeServices {
    root = makeProjectTempDir('goodvibes-agent-triggers');
    const workingDir = join(root, 'workspace');
    const homeDir = join(root, 'home');
    mkdirSync(workingDir, { recursive: true });
    mkdirSync(join(homeDir, '.goodvibes', 'agent'), { recursive: true });
    return createRuntimeServices({
      // Opt out: this process does not outlive the unawaited sweep.
      modelDiscovery: 'skip',
      runtimeBus: new RuntimeEventBus(),
      runtimeStore: createRuntimeStore(),
      configManager: new ConfigManager({ workingDir, homeDir, surfaceRoot: 'agent' }),
      workingDir,
      homeDirectory: homeDir,
    });
  }

  // Regression: this repo hand-composes RuntimeServices, and the SDK facade
  // start()/shutdown()s services.triggerManager. When this repo did not produce
  // the field, every daemon shutdown threw
  //   TypeError: undefined is not an object (evaluating 'this.triggerManager.shutdown')
  // The SDK side is now optional-chained so absence degrades cleanly — but the
  // point of this test is stronger: the agent must actually GET the feature,
  // not merely stop crashing.
  test('createRuntimeServices returns a real TriggerManager', () => {
    const services = build();
    expect(services.triggerManager).toBeDefined();
    expect(typeof services.triggerManager.start).toBe('function');
    expect(typeof services.triggerManager.shutdown).toBe('function');
    expect(typeof services.triggerManager.list).toBe('function');
  });

  test('it honours the shipped-off default and refuses by name', async () => {
    const services = build();
    // watchers.triggers.enabled defaults false: the family exists but declines
    // to do anything, and says which key turns it on.
    await expect(services.triggerManager.create({
      id: 'x', label: 'x',
      spec: { kind: 'on-exit', command: '/bin/true' },
      action: { kind: 'agent-turn' },
      createdAt: Date.now(),
    })).rejects.toThrow(/watchers\.triggers\.enabled/);
    expect(services.triggerManager.list()).toEqual([]);
  });

  test('start() and shutdown() are safe to call on the composed manager', () => {
    const services = build();
    expect(() => {
      services.triggerManager.start();
      services.triggerManager.shutdown();
    }).not.toThrow();
  });
});
