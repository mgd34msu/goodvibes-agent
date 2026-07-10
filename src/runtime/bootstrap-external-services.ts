/**
 * Connected-host (daemon + HTTP listener) discovery for GoodVibes Agent.
 *
 * Split out of bootstrap.ts (which is near the 800-line architecture cap) to
 * keep this concern — and its "GoodVibes Agent never owns the daemon
 * lifecycle" framing — in one small, readable place.
 *
 * GoodVibes Agent never starts or restarts the connected daemon: every call
 * routes through the SDK-shared adopt-or-spawn policy
 * (decideDaemonAdoption/classifyDaemonProbe) with `adoptOnly: true`, so a
 * reachable, version-compatible daemon is adopted and anything else (absent,
 * blocked, or on an incompatible wire version) is reported honestly. This
 * replaces a local stub that hard-declared every daemon 'external' without
 * probing or version-checking it.
 */
import { startExternalServices } from '@/runtime/index.ts';
import type {
  DeferredStartupCoordinator,
  ExternalServicesHandle,
  HostServiceStatus,
  HostServicesConfig,
  RuntimeEventBus,
} from '@/runtime/index.ts';
import type { HookDispatcher } from '@pellux/goodvibes-sdk/platform/hooks';
import { logger, summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import type { SystemMessageRouter } from '../core/system-message-router.ts';
import type { RuntimeServices } from './services.ts';
import type { UiRuntimeServices } from './ui-services.ts';

function formatHostServiceBaseUrl(host: string, port: number): string {
  const normalized = host.trim().toLowerCase();
  const probeHost = normalized === '0.0.0.0'
    ? '127.0.0.1'
    : normalized === '::' || normalized === '[::]'
      ? '::1'
      : host;
  const urlHost = probeHost.includes(':') && !probeHost.startsWith('[') ? `[${probeHost}]` : probeHost;
  return `http://${urlHost}:${port}`;
}

// Pending status shown before the deferred probe completes — honest
// 'unavailable', never a guessed 'external'.
function createPendingServiceStatus(
  configManager: HostServicesConfig,
  service: 'daemon' | 'httpListener',
): HostServiceStatus {
  const host = String(configManager.get(service === 'daemon' ? 'controlPlane.host' : 'httpListener.host') ?? '127.0.0.1');
  const port = Number(configManager.get(service === 'daemon' ? 'controlPlane.port' : 'httpListener.port') ?? (service === 'daemon' ? 3421 : 3422));
  return {
    mode: 'unavailable',
    host,
    port,
    baseUrl: formatHostServiceBaseUrl(host, port),
    reason: 'Connected-host discovery has not completed yet',
  };
}

const hostServiceIsActive = (status: HostServiceStatus): boolean => status.mode === 'embedded' || status.mode === 'external';

// 'blocked' (occupied by an unverified process) and 'incompatible' (a
// GoodVibes daemon on a wire-version band this Agent build refuses to adopt)
// both mean the configured port is held and unusable by this instance.
const hostServiceIsBlocked = (status: HostServiceStatus): boolean => status.mode === 'blocked' || status.mode === 'incompatible';

export interface AgentExternalServicesController {
  /** The most recently resolved (or pending) connected-host status. */
  getStatus(): ExternalServicesHandle;
  stop(): Promise<void>;
}

export function wireAgentExternalServices(options: {
  readonly configManager: HostServicesConfig;
  readonly runtimeBus: RuntimeEventBus;
  readonly hookDispatcher: HookDispatcher;
  readonly services: RuntimeServices;
  readonly uiServices: UiRuntimeServices;
  readonly deferredStartup: DeferredStartupCoordinator;
  readonly systemMessageRouter: SystemMessageRouter;
  readonly requestRender: () => void;
}): AgentExternalServicesController {
  const { configManager, runtimeBus, hookDispatcher, services, uiServices, deferredStartup, systemMessageRouter, requestRender } = options;

  const inspectAgentDependencies = () => {
    const daemonStatus = externalServices.daemonStatus;
    const httpListenerStatus = externalServices.httpListenerStatus;
    return {
      connectedHostRunning: hostServiceIsActive(daemonStatus),
      connectedHostPortInUse: hostServiceIsBlocked(daemonStatus),
      httpListenerRunning: hostServiceIsActive(httpListenerStatus),
      httpListenerPortInUse: hostServiceIsBlocked(httpListenerStatus),
      connectedHostStatus: daemonStatus,
      httpListenerStatus,
    };
  };

  let externalServices: ExternalServicesHandle = {
    daemonServer: null,
    httpListener: null,
    daemonStatus: createPendingServiceStatus(configManager, 'daemon'),
    httpListenerStatus: createPendingServiceStatus(configManager, 'httpListener'),
    listRecentControlPlaneEvents: () => [],
    async stop(): Promise<void> {},
  };
  let externalServicesPromise: Promise<ExternalServicesHandle> | null = null;

  const startAgentExternalServices = (): Promise<ExternalServicesHandle> =>
    startExternalServices(configManager, runtimeBus, hookDispatcher, services, { adoptOnly: true });

  const platformExternalServices = uiServices.platform as typeof uiServices.platform & {
    externalServices: NonNullable<typeof uiServices.platform.externalServices>;
  };
  platformExternalServices.externalServices = {
    inspect: inspectAgentDependencies,
    restart: async () => {
      if (externalServicesPromise) {
        try {
          externalServices = await externalServicesPromise;
        } catch {
          // A failed previous startup should not prevent a re-probe attempt.
        }
      }
      await externalServices.stop();
      externalServicesPromise = startAgentExternalServices();
      externalServices = await externalServicesPromise;
      systemMessageRouter.high('[Startup] GoodVibes Agent does not start or restart the connected GoodVibes host — it adopted the current status from a fresh probe.');
      requestRender();
      return inspectAgentDependencies();
    },
  };

  // Connected-host discovery OFF the interactive path: probe the configured
  // host/port through the shared adopt-or-spawn policy (adoptOnly — Agent
  // never spawns or embeds) and replace the pending status with an honest
  // one (adopted, incompatible, blocked, or unavailable).
  deferredStartup.schedule({
    label: 'external-services',
    run: async () => {
      externalServicesPromise = startAgentExternalServices();
      externalServices = await externalServicesPromise;
      requestRender();
    },
    onError: (error) => {
      const message = summarizeError(error);
      logger.error('Deferred connected-host discovery failed', { error: message });
      systemMessageRouter.high(`[Startup] Connected-host discovery failed: ${message}`);
      requestRender();
    },
  });

  return {
    getStatus: () => externalServices,
    stop: async () => {
      await externalServices.stop();
    },
  };
}
