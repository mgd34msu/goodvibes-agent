/**
 * Boot-time start of an installed-but-stopped connected GoodVibes host.
 *
 * When boot discovery finds nothing on the configured daemon host/port, a
 * machine that actually HAS the host installed should not hand the user
 * homework. This module checks whether the host's service entry is present
 * for the platform service manager and, when it is installed but stopped,
 * issues one start through that service manager, then waits a bounded time
 * for the daemon to answer before the session proceeds.
 *
 * Boundaries that stay exactly as strict as before:
 *   - A reachable daemon (adopted or embedded) is never restarted.
 *   - A held port ('blocked' by an unverified process, or 'incompatible'
 *     wire version) is respected and left alone — the closest states the
 *     probe has to "another owner is mid-update or mid-restart".
 *   - A service unit that the service manager already reports active gets a
 *     bounded wait only, never a second start command underneath it.
 *   - The Agent still never spawns or embeds a daemon of its own, and a host
 *     that is genuinely not installed keeps the existing honest guidance.
 *
 * Detection reuses the platform's one existing installed-daemon detector,
 * the SDK's PlatformServiceManager (`status().installed` = service entry
 * present, `status().running` = live service-manager query). It is checked
 * for the connected host's managed service name and for the older unit name
 * earlier installs used; a `service.serviceName` config value overrides both,
 * through the manager's own name resolution.
 */
import { PlatformServiceManager, type ManagedServiceActionResult, type ManagedServiceStatus } from '@pellux/goodvibes-sdk/platform/daemon';
import type { SpineReachability } from '@pellux/goodvibes-sdk/platform/runtime/session-spine';
import type { ConfigManager } from '../config/index.ts';

/** The connected host's managed service name (the goodvibes CLI's default). */
export const MANAGED_CONNECTED_HOST_SERVICE_NAME = 'goodvibes';
/** The unit name older connected-host installs registered. */
export const LEGACY_CONNECTED_HOST_SERVICE_NAME = 'goodvibes-daemon';

/**
 * The SDK service manager's action-runner result, imported rather than
 * re-declared. This was a structural mirror of the same three fields, kept
 * because the type was not on the barrel this file already imports from; it is
 * now, so the alias is the SDK's own type under this module's name.
 */
export type ConnectedHostServiceActionResult = ManagedServiceActionResult;

/** One candidate service entry, as the platform service manager sees it. */
export interface ConnectedHostServiceSnapshot {
  readonly serviceName: string;
  readonly platform: ManagedServiceStatus['platform'];
  readonly unitPath: string;
  readonly installed: boolean;
  readonly running: boolean;
  /**
   * False on the 'manual' platform: there the SDK manager would spawn its own
   * locally-resolved command, which the Agent cannot honestly resolve for a
   * host it does not own — those stay on the guidance path.
   */
  readonly startSupported: boolean;
}

export interface ConnectedHostServiceStartResult {
  readonly ok: boolean;
  readonly error?: string | undefined;
}

/** Narrow detector/starter seam over the SDK's PlatformServiceManager. */
export interface ConnectedHostServiceControl {
  snapshot(): readonly ConnectedHostServiceSnapshot[];
  start(serviceName: string): ConnectedHostServiceStartResult;
}

export interface ConnectedHostServiceControlOptions {
  readonly configManager: ConfigManager;
  readonly workingDirectory: string;
  readonly homeDirectory: string;
  /** Injectable systemctl/launchctl/schtasks runner so tests never touch the host. */
  readonly actionRunner?: ((command: string, args: readonly string[]) => ConnectedHostServiceActionResult) | undefined;
}

function summarizeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build the detector/starter over the SDK's PlatformServiceManager.
 *
 * When `service.serviceName` is configured, the manager's own resolution
 * collapses every candidate to that one name, so a single manager is built;
 * otherwise the managed and legacy default names are each checked.
 */
export function createConnectedHostServiceControl(
  options: ConnectedHostServiceControlOptions,
): ConnectedHostServiceControl {
  // The config schema ships `service.serviceName` with the managed default, so
  // get() never returns undefined here. A value that IS the managed default
  // (configured or defaulted — indistinguishable, and equivalent) also gets the
  // older unit name checked; any other value is an explicit operator choice and
  // is trusted exclusively.
  const primaryName = String(options.configManager.get('service.serviceName') ?? '').trim()
    || MANAGED_CONNECTED_HOST_SERVICE_NAME;
  const candidateNames = primaryName === MANAGED_CONNECTED_HOST_SERVICE_NAME
    ? [MANAGED_CONNECTED_HOST_SERVICE_NAME, LEGACY_CONNECTED_HOST_SERVICE_NAME]
    : [primaryName];
  // Pin each manager's view of `service.serviceName` to its candidate so the
  // SDK's own name resolution yields exactly that unit (the schema default
  // would otherwise shadow every `defaultServiceName`). Only `get` is consulted
  // by the manager, so the narrow delegate below is honest.
  const pinnedConfigView = (serviceName: string): ConfigManager => ({
    get: (key: string) => key === 'service.serviceName' ? serviceName : options.configManager.get(key as Parameters<ConfigManager['get']>[0]),
  }) as unknown as ConfigManager;
  const managers = candidateNames.map((resolvedName) => ({
    resolvedName,
    manager: new PlatformServiceManager(pinnedConfigView(resolvedName), {
      workingDirectory: options.workingDirectory,
      homeDirectory: options.homeDirectory,
      // Match the connected host's own service scope (log/pid file layout on the
      // manual platform); systemd/launchd/windows entries are home-scoped anyway.
      surfaceRoot: 'daemon',
      defaultServiceName: resolvedName,
      ...(options.actionRunner ? { actionRunner: options.actionRunner } : {}),
    }),
  }));

  const toSnapshot = (status: ManagedServiceStatus): ConnectedHostServiceSnapshot => ({
    serviceName: status.serviceName,
    platform: status.platform,
    unitPath: status.path,
    installed: status.installed,
    running: status.running,
    startSupported: status.platform !== 'manual',
  });

  return {
    snapshot(): readonly ConnectedHostServiceSnapshot[] {
      const seen = new Set<string>();
      const snapshots: ConnectedHostServiceSnapshot[] = [];
      for (const { resolvedName, manager } of managers) {
        if (seen.has(resolvedName)) continue;
        seen.add(resolvedName);
        snapshots.push(toSnapshot(manager.status()));
      }
      return snapshots;
    },
    start(serviceName: string): ConnectedHostServiceStartResult {
      const candidate = managers.find((entry) => entry.resolvedName === serviceName);
      if (!candidate) {
        return { ok: false, error: `no service entry named "${serviceName}" is tracked on this host` };
      }
      try {
        const result = candidate.manager.start();
        return result.actionError === undefined
          ? { ok: true }
          : { ok: false, error: result.actionError };
      } catch (error) {
        return { ok: false, error: summarizeThrown(error) };
      }
    },
  };
}

/** Subset of the discovery status the autostart decision needs. */
export interface ConnectedHostDaemonStatusView {
  readonly mode: 'disabled' | 'embedded' | 'external' | 'blocked' | 'incompatible' | 'unavailable';
}

export type ConnectedHostAutostartOutcome =
  /** Nothing to do: the daemon answers, the port is held, or the daemon is disabled by config. */
  | { readonly action: 'none'; readonly reason: 'daemon-active' | 'port-held' | 'daemon-disabled' }
  /** No service entry is installed on this host — the existing guidance path is unchanged. */
  | { readonly action: 'not-installed' }
  /** The Agent issued a start through the service manager and the daemon answered. */
  | { readonly action: 'started'; readonly serviceName: string }
  /** The service unit was already active (starting or restarting); the daemon answered within the bounded wait, with no start issued. */
  | { readonly action: 'came-online'; readonly serviceName: string }
  /** A start was attempted (or was impossible) and the daemon still does not answer; guidance applies, with this reason. */
  | { readonly action: 'start-failed'; readonly serviceName: string; readonly reason: string };

export interface ConnectedHostAutostartOptions {
  readonly daemonStatus: ConnectedHostDaemonStatusView;
  readonly control: ConnectedHostServiceControl;
  readonly probeReachability: () => Promise<SpineReachability>;
  /** Total bounded wait for the daemon to answer after a start (default 8000ms). */
  readonly waitTimeoutMs?: number | undefined;
  /** Poll interval within the bounded wait (default 400ms). */
  readonly pollIntervalMs?: number | undefined;
  /** Injectable so tests drive the wait loop deterministically. */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

const DEFAULT_WAIT_TIMEOUT_MS = 8_000;
const DEFAULT_POLL_INTERVAL_MS = 400;

/**
 * Decide and (when safe) perform the boot-time start of an installed-but-
 * stopped connected host. Pure over its seams: every effect goes through
 * `control` and `probeReachability`.
 */
export async function autostartInstalledConnectedHost(
  options: ConnectedHostAutostartOptions,
): Promise<ConnectedHostAutostartOutcome> {
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  }));
  // Attempt-counted (not wall-clock) so an injected no-op sleep still terminates.
  const attempts = Math.max(1, Math.ceil(waitTimeoutMs / pollIntervalMs));

  const waitForAnswer = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(pollIntervalMs);
      if ((await options.probeReachability()) === 'online') return true;
    }
    return false;
  };

  switch (options.daemonStatus.mode) {
    case 'embedded':
    case 'external':
      // A running daemon is never restarted.
      return { action: 'none', reason: 'daemon-active' };
    case 'blocked':
    case 'incompatible':
      // The port is held — by an unverified process or a daemon this build
      // refuses to adopt. Either way another owner may be mid-update or
      // mid-restart; never fight it.
      return { action: 'none', reason: 'port-held' };
    case 'disabled':
      return { action: 'none', reason: 'daemon-disabled' };
    case 'unavailable':
      break;
  }

  const installed = options.control.snapshot().find((snapshot) => snapshot.installed);
  if (!installed) return { action: 'not-installed' };

  if (installed.running) {
    // The service manager already reports the unit active — it may be mid-start
    // or mid-restart. Wait for it, but never issue another start underneath it.
    if (await waitForAnswer()) return { action: 'came-online', serviceName: installed.serviceName };
    return {
      action: 'start-failed',
      serviceName: installed.serviceName,
      reason: `service "${installed.serviceName}" is active per the service manager but the daemon did not answer within ${waitTimeoutMs}ms — check its logs`,
    };
  }

  if (!installed.startSupported) {
    return {
      action: 'start-failed',
      serviceName: installed.serviceName,
      reason: `service "${installed.serviceName}" is installed without a service-manager entry this Agent can start`,
    };
  }

  const startResult = options.control.start(installed.serviceName);
  if (!startResult.ok) {
    return {
      action: 'start-failed',
      serviceName: installed.serviceName,
      reason: startResult.error ?? 'the service start command failed',
    };
  }
  if (await waitForAnswer()) return { action: 'started', serviceName: installed.serviceName };
  return {
    action: 'start-failed',
    serviceName: installed.serviceName,
    reason: `the service start command was accepted but the daemon did not answer within ${waitTimeoutMs}ms`,
  };
}
