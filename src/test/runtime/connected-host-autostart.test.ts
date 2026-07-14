/**
 * Boot-time start of an installed-but-stopped connected host.
 *
 * Three layers, matching the module's seams:
 *   1. The pure decision engine (autostartInstalledConnectedHost) against spy
 *      control/probe doubles — every outcome branch, no I/O.
 *   2. The detector/starter (createConnectedHostServiceControl) over the real
 *      SDK PlatformServiceManager with a tempdir home and an injected
 *      actionRunner, so no test ever touches the host's real service manager.
 *   3. The bootstrap wiring (wireAgentExternalServices) with an injected
 *      discovery stub, proving the four boot behaviors end to end: started
 *      with a receipt, not-installed guidance unchanged, start-failure reason
 *      surfaced, and a running daemon left untouched.
 */
import { describe, expect, mock, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import type { HookDispatcher } from '@pellux/goodvibes-sdk/platform/hooks';
import type { RuntimeEventBus, DeferredStartupCoordinator, ExternalServicesHandle, HostServiceStatus } from '@/runtime/index.ts';
import {
  autostartInstalledConnectedHost,
  createConnectedHostServiceControl,
  LEGACY_CONNECTED_HOST_SERVICE_NAME,
  MANAGED_CONNECTED_HOST_SERVICE_NAME,
  type ConnectedHostServiceControl,
  type ConnectedHostServiceSnapshot,
} from '../../runtime/connected-host-autostart.ts';
import { wireAgentExternalServices } from '../../runtime/bootstrap-external-services.ts';
import { AgentDaemonReceiptFeed } from '../../runtime/daemon-receipts.ts';
import type { SystemMessageRouter } from '../../core/system-message-router.ts';
import type { RuntimeServices } from '../../runtime/services.ts';
import type { UiRuntimeServices } from '../../runtime/ui-services.ts';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

// ── Layer 1: the pure decision engine ──────────────────────────────────────

function snapshotOf(overrides: Partial<ConnectedHostServiceSnapshot> = {}): ConnectedHostServiceSnapshot {
  return {
    serviceName: 'goodvibes-daemon',
    platform: 'systemd',
    unitPath: '/home/user/.config/systemd/user/goodvibes-daemon.service',
    installed: true,
    running: false,
    startSupported: true,
    ...overrides,
  };
}

function spyControl(options: {
  snapshots: readonly ConnectedHostServiceSnapshot[];
  startResult?: { ok: boolean; error?: string };
}): ConnectedHostServiceControl & { readonly startCalls: string[]; readonly snapshotCalls: () => number } {
  const startCalls: string[] = [];
  let snapshotCount = 0;
  return {
    snapshot: () => {
      snapshotCount += 1;
      return options.snapshots;
    },
    start: (serviceName: string) => {
      startCalls.push(serviceName);
      return options.startResult ?? { ok: true };
    },
    startCalls,
    snapshotCalls: () => snapshotCount,
  };
}

/** A probe that yields the scripted sequence, then repeats its last value. */
function scriptedProbe(sequence: readonly ('online' | 'offline')[]): () => Promise<'online' | 'offline'> {
  let index = 0;
  return async () => {
    const value = sequence[Math.min(index, sequence.length - 1)]!;
    index += 1;
    return value;
  };
}

const NO_SLEEP = async (): Promise<void> => {};

describe('autostartInstalledConnectedHost (decision engine)', () => {
  test('a running daemon is never touched: adopted (external) mode skips before any detection', async () => {
    const control = spyControl({ snapshots: [snapshotOf()] });
    const outcome = await autostartInstalledConnectedHost({
      daemonStatus: { mode: 'external' },
      control,
      probeReachability: scriptedProbe(['online']),
      sleep: NO_SLEEP,
    });
    expect(outcome).toEqual({ action: 'none', reason: 'daemon-active' });
    expect(control.snapshotCalls()).toBe(0);
    expect(control.startCalls).toEqual([]);
  });

  test('an embedded daemon is treated as active too', async () => {
    const control = spyControl({ snapshots: [snapshotOf()] });
    const outcome = await autostartInstalledConnectedHost({
      daemonStatus: { mode: 'embedded' },
      control,
      probeReachability: scriptedProbe(['online']),
      sleep: NO_SLEEP,
    });
    expect(outcome).toEqual({ action: 'none', reason: 'daemon-active' });
    expect(control.startCalls).toEqual([]);
  });

  test('a held port (blocked or incompatible) is respected — another owner may be mid-update', async () => {
    for (const mode of ['blocked', 'incompatible'] as const) {
      const control = spyControl({ snapshots: [snapshotOf()] });
      const outcome = await autostartInstalledConnectedHost({
        daemonStatus: { mode },
        control,
        probeReachability: scriptedProbe(['offline']),
        sleep: NO_SLEEP,
      });
      expect(outcome).toEqual({ action: 'none', reason: 'port-held' });
      expect(control.startCalls).toEqual([]);
    }
  });

  test('a disabled daemon stays disabled', async () => {
    const control = spyControl({ snapshots: [snapshotOf()] });
    const outcome = await autostartInstalledConnectedHost({
      daemonStatus: { mode: 'disabled' },
      control,
      probeReachability: scriptedProbe(['offline']),
      sleep: NO_SLEEP,
    });
    expect(outcome).toEqual({ action: 'none', reason: 'daemon-disabled' });
    expect(control.startCalls).toEqual([]);
  });

  test('probe-fail + not installed: guidance path unchanged, no start attempted', async () => {
    const control = spyControl({ snapshots: [snapshotOf({ installed: false })] });
    const outcome = await autostartInstalledConnectedHost({
      daemonStatus: { mode: 'unavailable' },
      control,
      probeReachability: scriptedProbe(['offline']),
      sleep: NO_SLEEP,
    });
    expect(outcome).toEqual({ action: 'not-installed' });
    expect(control.startCalls).toEqual([]);
  });

  test('probe-fail + installed + start succeeds: started once the daemon answers', async () => {
    const control = spyControl({ snapshots: [snapshotOf()] });
    const outcome = await autostartInstalledConnectedHost({
      daemonStatus: { mode: 'unavailable' },
      control,
      // Answers on the third poll — inside the bounded wait.
      probeReachability: scriptedProbe(['offline', 'offline', 'online']),
      waitTimeoutMs: 2_000,
      pollIntervalMs: 100,
      sleep: NO_SLEEP,
    });
    expect(outcome).toEqual({ action: 'started', serviceName: 'goodvibes-daemon' });
    expect(control.startCalls).toEqual(['goodvibes-daemon']);
  });

  test('probe-fail + installed + start command fails: the failure reason is surfaced', async () => {
    const control = spyControl({
      snapshots: [snapshotOf()],
      startResult: { ok: false, error: 'Failed to connect to bus: No medium found' },
    });
    const probe = mock(scriptedProbe(['offline']));
    const outcome = await autostartInstalledConnectedHost({
      daemonStatus: { mode: 'unavailable' },
      control,
      probeReachability: probe,
      sleep: NO_SLEEP,
    });
    expect(outcome).toEqual({
      action: 'start-failed',
      serviceName: 'goodvibes-daemon',
      reason: 'Failed to connect to bus: No medium found',
    });
    // A failed start command reports immediately; there is nothing to wait for.
    expect(probe).not.toHaveBeenCalled();
  });

  test('start accepted but the daemon never answers: bounded wait ends with an honest reason', async () => {
    const control = spyControl({ snapshots: [snapshotOf()] });
    const probe = mock(scriptedProbe(['offline']));
    const outcome = await autostartInstalledConnectedHost({
      daemonStatus: { mode: 'unavailable' },
      control,
      probeReachability: probe,
      waitTimeoutMs: 1_000,
      pollIntervalMs: 250,
      sleep: NO_SLEEP,
    });
    expect(outcome).toEqual({
      action: 'start-failed',
      serviceName: 'goodvibes-daemon',
      reason: 'the service start command was accepted but the daemon did not answer within 1000ms',
    });
    // Attempt-counted wait: ceil(1000 / 250) = 4 polls, then stop.
    expect(probe).toHaveBeenCalledTimes(4);
  });

  test('a service unit that is already active gets a bounded wait, never a second start', async () => {
    const control = spyControl({ snapshots: [snapshotOf({ running: true })] });
    const outcome = await autostartInstalledConnectedHost({
      daemonStatus: { mode: 'unavailable' },
      control,
      probeReachability: scriptedProbe(['offline', 'online']),
      waitTimeoutMs: 1_000,
      pollIntervalMs: 250,
      sleep: NO_SLEEP,
    });
    expect(outcome).toEqual({ action: 'came-online', serviceName: 'goodvibes-daemon' });
    expect(control.startCalls).toEqual([]);
  });

  test('an active unit whose daemon never answers reports the reason without fighting it', async () => {
    const control = spyControl({ snapshots: [snapshotOf({ running: true })] });
    const outcome = await autostartInstalledConnectedHost({
      daemonStatus: { mode: 'unavailable' },
      control,
      probeReachability: scriptedProbe(['offline']),
      waitTimeoutMs: 1_000,
      pollIntervalMs: 500,
      sleep: NO_SLEEP,
    });
    expect(outcome).toEqual({
      action: 'start-failed',
      serviceName: 'goodvibes-daemon',
      reason: 'service "goodvibes-daemon" is active per the service manager but the daemon did not answer within 1000ms — check its logs',
    });
    expect(control.startCalls).toEqual([]);
  });

  test('an installed entry without a startable service manager (manual platform) reports honestly', async () => {
    const control = spyControl({
      snapshots: [snapshotOf({ platform: 'manual', startSupported: false })],
    });
    const outcome = await autostartInstalledConnectedHost({
      daemonStatus: { mode: 'unavailable' },
      control,
      probeReachability: scriptedProbe(['offline']),
      sleep: NO_SLEEP,
    });
    expect(outcome).toEqual({
      action: 'start-failed',
      serviceName: 'goodvibes-daemon',
      reason: 'service "goodvibes-daemon" is installed without a service-manager entry this Agent can start',
    });
    expect(control.startCalls).toEqual([]);
  });
});

// ── Layer 2: the detector/starter over the real PlatformServiceManager ─────

type ActionCall = { command: string; args: readonly string[] };

function systemdActionRunner(options: {
  activeServices?: readonly string[];
  startExit?: number;
  startStderr?: string;
}) {
  const calls: ActionCall[] = [];
  const runner = (command: string, args: readonly string[]) => {
    calls.push({ command, args });
    if (command === 'systemctl' && args[1] === 'is-active') {
      const unit = args[2] ?? '';
      const active = (options.activeServices ?? []).some((name) => unit === `${name}.service`);
      return active ? { status: 0, stdout: 'active\n' } : { status: 3, stdout: 'inactive\n' };
    }
    if (command === 'systemctl' && args[1] === 'enable') {
      return { status: options.startExit ?? 0, stderr: options.startStderr ?? '' };
    }
    return { status: 0, stdout: '' };
  };
  return { runner, calls };
}

function makeDetectorFixture(options: {
  installedUnits?: readonly string[];
  serviceNameConfig?: string;
} = {}) {
  const root = makeProjectTempDir('connected-host-autostart');
  const home = join(root, 'home');
  const unitDir = join(home, '.config', 'systemd', 'user');
  mkdirSync(unitDir, { recursive: true });
  for (const unit of options.installedUnits ?? []) {
    writeFileSync(join(unitDir, `${unit}.service`), '[Unit]\nDescription=test fixture unit\n', 'utf-8');
  }
  const configManager = new ConfigManager({
    surfaceRoot: 'agent',
    workingDir: join(root, 'project'),
    homeDir: home,
  });
  // Pin the platform so these tests are deterministic on any host OS.
  configManager.setDynamic('service.platform', 'systemd');
  if (options.serviceNameConfig) {
    configManager.setDynamic('service.serviceName', options.serviceNameConfig);
  }
  return { root, home, configManager };
}

describe('createConnectedHostServiceControl (detector over PlatformServiceManager)', () => {
  test('detects the older unit name as installed and the managed name as absent', () => {
    const fixture = makeDetectorFixture({ installedUnits: [LEGACY_CONNECTED_HOST_SERVICE_NAME] });
    const { runner } = systemdActionRunner({});
    const control = createConnectedHostServiceControl({
      configManager: fixture.configManager,
      workingDirectory: join(fixture.root, 'project'),
      homeDirectory: fixture.home,
      actionRunner: runner,
    });
    const snapshots = control.snapshot();
    expect(snapshots.map((snapshot) => snapshot.serviceName)).toEqual([
      MANAGED_CONNECTED_HOST_SERVICE_NAME,
      LEGACY_CONNECTED_HOST_SERVICE_NAME,
    ]);
    const legacy = snapshots.find((snapshot) => snapshot.serviceName === LEGACY_CONNECTED_HOST_SERVICE_NAME)!;
    expect(legacy.installed).toBe(true);
    expect(legacy.running).toBe(false);
    expect(legacy.startSupported).toBe(true);
    const managed = snapshots.find((snapshot) => snapshot.serviceName === MANAGED_CONNECTED_HOST_SERVICE_NAME)!;
    expect(managed.installed).toBe(false);
  });

  test('running comes from a live service-manager query, not a guess', () => {
    const fixture = makeDetectorFixture({ installedUnits: [MANAGED_CONNECTED_HOST_SERVICE_NAME] });
    const { runner } = systemdActionRunner({ activeServices: [MANAGED_CONNECTED_HOST_SERVICE_NAME] });
    const control = createConnectedHostServiceControl({
      configManager: fixture.configManager,
      workingDirectory: join(fixture.root, 'project'),
      homeDirectory: fixture.home,
      actionRunner: runner,
    });
    const managed = control.snapshot().find((snapshot) => snapshot.serviceName === MANAGED_CONNECTED_HOST_SERVICE_NAME)!;
    expect(managed.installed).toBe(true);
    expect(managed.running).toBe(true);
  });

  test('start goes through the service manager (systemctl --user enable --now <unit>)', () => {
    const fixture = makeDetectorFixture({ installedUnits: [LEGACY_CONNECTED_HOST_SERVICE_NAME] });
    const { runner, calls } = systemdActionRunner({});
    const control = createConnectedHostServiceControl({
      configManager: fixture.configManager,
      workingDirectory: join(fixture.root, 'project'),
      homeDirectory: fixture.home,
      actionRunner: runner,
    });
    const result = control.start(LEGACY_CONNECTED_HOST_SERVICE_NAME);
    expect(result.ok).toBe(true);
    const startCall = calls.find((call) => call.command === 'systemctl' && call.args[1] === 'enable');
    expect(startCall?.args).toEqual(['--user', 'enable', '--now', `${LEGACY_CONNECTED_HOST_SERVICE_NAME}.service`]);
  });

  test('a failing start command surfaces the service manager error text', () => {
    const fixture = makeDetectorFixture({ installedUnits: [LEGACY_CONNECTED_HOST_SERVICE_NAME] });
    const { runner } = systemdActionRunner({ startExit: 1, startStderr: 'Failed to connect to bus: No medium found' });
    const control = createConnectedHostServiceControl({
      configManager: fixture.configManager,
      workingDirectory: join(fixture.root, 'project'),
      homeDirectory: fixture.home,
      actionRunner: runner,
    });
    const result = control.start(LEGACY_CONNECTED_HOST_SERVICE_NAME);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Failed to connect to bus');
  });

  test('an unknown service name is refused without touching the service manager', () => {
    const fixture = makeDetectorFixture({});
    const { runner, calls } = systemdActionRunner({});
    const control = createConnectedHostServiceControl({
      configManager: fixture.configManager,
      workingDirectory: join(fixture.root, 'project'),
      homeDirectory: fixture.home,
      actionRunner: runner,
    });
    const result = control.start('some-other-unit');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('some-other-unit');
    expect(calls.filter((call) => call.args[1] === 'enable')).toEqual([]);
  });

  test('a configured service.serviceName collapses the candidates to that one name', () => {
    const fixture = makeDetectorFixture({ installedUnits: ['custom-host'], serviceNameConfig: 'custom-host' });
    const { runner } = systemdActionRunner({});
    const control = createConnectedHostServiceControl({
      configManager: fixture.configManager,
      workingDirectory: join(fixture.root, 'project'),
      homeDirectory: fixture.home,
      actionRunner: runner,
    });
    const snapshots = control.snapshot();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.serviceName).toBe('custom-host');
    expect(snapshots[0]!.installed).toBe(true);
  });
});

// ── Layer 3: the bootstrap wiring ───────────────────────────────────────────

function statusOf(mode: HostServiceStatus['mode'], reason?: string): HostServiceStatus {
  return {
    mode,
    host: '127.0.0.1',
    port: 3421,
    baseUrl: 'http://127.0.0.1:3421',
    ...(reason ? { reason } : {}),
  };
}

function handleOf(daemonStatus: HostServiceStatus): ExternalServicesHandle {
  return {
    daemonServer: null,
    httpListener: null,
    daemonStatus,
    httpListenerStatus: statusOf('disabled'),
    listRecentControlPlaneEvents: () => [],
    stop: async () => {},
  };
}

/** Coordinator that runs each scheduled task immediately (microtask), like boot does eventually. */
function immediateCoordinator(): DeferredStartupCoordinator {
  return {
    schedule: (task) => Promise.resolve()
      .then(() => task.run())
      .catch((error) => { task.onError?.(error); }),
    drain: async () => {},
  };
}

function spyRouter(): SystemMessageRouter & { readonly highs: string[]; readonly lows: string[] } {
  const highs: string[] = [];
  const lows: string[] = [];
  return {
    high: (message: string) => { highs.push(message); },
    low: (message: string) => { lows.push(message); },
    highs,
    lows,
  } as unknown as SystemMessageRouter & { highs: string[]; lows: string[] };
}

function wireFixture(options: {
  discoverySequence: readonly HostServiceStatus[];
  control: ConnectedHostServiceControl;
  probeSequence?: readonly ('online' | 'offline')[];
}) {
  const router = spyRouter();
  const discoveryCalls: number[] = [];
  let call = 0;
  const startServices = (async () => {
    discoveryCalls.push(call);
    const status = options.discoverySequence[Math.min(call, options.discoverySequence.length - 1)]!;
    call += 1;
    return handleOf(status);
  }) as unknown as typeof import('@/runtime/index.ts').startExternalServices;
  const uiServices = { platform: {} } as unknown as UiRuntimeServices;
  const controller = wireAgentExternalServices({
    configManager: { get: () => undefined },
    runtimeBus: {} as RuntimeEventBus,
    hookDispatcher: {} as HookDispatcher,
    // The injected control + probe below keep the wiring off every real
    // services field except the two receipt feeds (both attached
    // unconditionally at wire time), so a pair of feeds plus a bare object is
    // an honest stand-in here.
    services: {
      daemonReceiptFeed: new AgentDaemonReceiptFeed(),
      memoryConsolidationReceiptFeed: new AgentDaemonReceiptFeed(),
    } as RuntimeServices,
    uiServices,
    deferredStartup: immediateCoordinator(),
    systemMessageRouter: router,
    requestRender: () => {},
    startServices,
    connectedHostAutostart: {
      control: options.control,
      probeReachability: scriptedProbe(options.probeSequence ?? ['online']),
      waitTimeoutMs: 400,
      pollIntervalMs: 100,
      sleep: NO_SLEEP,
    },
  });
  return { controller, router, discoveryCalls: () => discoveryCalls.length };
}

describe('wireAgentExternalServices (boot wiring)', () => {
  test('probe-fail + installed + start succeeds: the session proceeds with one honest receipt', async () => {
    const control = spyControl({ snapshots: [snapshotOf()] });
    const fixture = wireFixture({
      discoverySequence: [statusOf('unavailable'), statusOf('external')],
      control,
      probeSequence: ['online'],
    });
    await fixture.controller.whenDiscovered();
    expect(control.startCalls).toEqual(['goodvibes-daemon']);
    // Discovery ran twice: the initial probe, then the re-probe that adopted.
    expect(fixture.discoveryCalls()).toBe(2);
    expect(fixture.controller.getStatus().daemonStatus.mode).toBe('external');
    expect(fixture.router.lows).toHaveLength(1);
    expect(fixture.router.lows[0]).toContain('Connected host was installed but stopped; started it');
    expect(fixture.router.highs).toEqual([]);
  });

  test('probe-fail + not installed: guidance path unchanged (no start, no re-probe, no receipt)', async () => {
    const control = spyControl({ snapshots: [snapshotOf({ installed: false })] });
    const fixture = wireFixture({
      discoverySequence: [statusOf('unavailable')],
      control,
      probeSequence: ['offline'],
    });
    await fixture.controller.whenDiscovered();
    expect(control.startCalls).toEqual([]);
    expect(fixture.discoveryCalls()).toBe(1);
    expect(fixture.controller.getStatus().daemonStatus.mode).toBe('unavailable');
    expect(fixture.router.lows).toEqual([]);
    expect(fixture.router.highs).toEqual([]);
  });

  test('probe-fail + start fails: the guidance includes the failure reason', async () => {
    const control = spyControl({
      snapshots: [snapshotOf()],
      startResult: { ok: false, error: 'unit goodvibes-daemon.service failed to start' },
    });
    const fixture = wireFixture({
      discoverySequence: [statusOf('unavailable')],
      control,
      probeSequence: ['offline'],
    });
    await fixture.controller.whenDiscovered();
    expect(fixture.discoveryCalls()).toBe(1);
    expect(fixture.router.highs).toHaveLength(1);
    expect(fixture.router.highs[0]).toContain('unit goodvibes-daemon.service failed to start');
    expect(fixture.router.highs[0]).toContain('goodvibes service start');
    expect(fixture.controller.getStatus().daemonStatus.mode).toBe('unavailable');
  });

  test('a running daemon is untouched: adoption skips detection and start entirely', async () => {
    const control = spyControl({ snapshots: [snapshotOf()] });
    const fixture = wireFixture({
      discoverySequence: [statusOf('external')],
      control,
      probeSequence: ['online'],
    });
    await fixture.controller.whenDiscovered();
    expect(control.snapshotCalls()).toBe(0);
    expect(control.startCalls).toEqual([]);
    expect(fixture.discoveryCalls()).toBe(1);
    expect(fixture.router.lows).toEqual([]);
    expect(fixture.router.highs).toEqual([]);
  });

  test('a held port is respected: no start, no messages', async () => {
    const control = spyControl({ snapshots: [snapshotOf()] });
    const fixture = wireFixture({
      discoverySequence: [statusOf('blocked', 'Configured daemon port is occupied by an unverified process')],
      control,
      probeSequence: ['offline'],
    });
    await fixture.controller.whenDiscovered();
    expect(control.startCalls).toEqual([]);
    expect(fixture.discoveryCalls()).toBe(1);
    expect(fixture.controller.getStatus().daemonStatus.mode).toBe('blocked');
  });

  test('an already-starting unit is adopted once it answers, with a receipt and no second start', async () => {
    const control = spyControl({ snapshots: [snapshotOf({ running: true })] });
    const fixture = wireFixture({
      discoverySequence: [statusOf('unavailable'), statusOf('external')],
      control,
      probeSequence: ['offline', 'online'],
    });
    await fixture.controller.whenDiscovered();
    expect(control.startCalls).toEqual([]);
    expect(fixture.discoveryCalls()).toBe(2);
    expect(fixture.router.lows).toHaveLength(1);
    expect(fixture.router.lows[0]).toContain('was already starting; connected once it answered');
  });
});
