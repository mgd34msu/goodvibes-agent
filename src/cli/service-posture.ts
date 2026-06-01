import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import net from 'node:net';
import { isAbsolute, join } from 'node:path';
import type { ConfigManager } from '../config/index.ts';
import { resolveRuntimeEndpointBinding } from './endpoints.ts';
import type { RuntimeEndpointBinding, RuntimeEndpointId } from './endpoints.ts';
import { classifyBindPosture, isNetworkFacing } from './network-posture.ts';
import { redactText } from './redaction.ts';

export interface CliServiceRuntime {
  readonly configManager: ConfigManager;
  readonly workingDirectory: string;
  readonly homeDirectory: string;
}

export interface CliServiceEndpointPosture {
  readonly id: RuntimeEndpointId;
  readonly label: string;
  readonly enabled: boolean;
  readonly binding: RuntimeEndpointBinding;
  readonly bindPosture: ReturnType<typeof classifyBindPosture>;
  readonly networkFacing: boolean;
  readonly reachable?: boolean;
}

export interface CliServiceLogPosture {
  readonly path: string | null;
  readonly exists: boolean;
  readonly size: number;
  readonly modifiedAt: number | null;
  readonly tail?: string;
  readonly readError?: string;
}

export interface CliExternalDaemonLifecyclePosture {
  readonly platform: 'manual';
  readonly path: string;
  readonly installed: false;
  readonly autostart: false;
  readonly running: false;
  readonly logPath?: string;
  readonly commandPreview: string;
  readonly suggestedCommands: readonly string[];
  readonly lastAction: 'status';
  readonly actionError?: string;
  readonly pidPath: string;
  readonly lastError: null;
}

export interface CliServicePosture {
  readonly config: {
    readonly enabled: boolean;
    readonly autostart: boolean;
    readonly restartOnFailure: boolean;
    readonly daemonEnabled: boolean;
  };
  readonly managed: CliExternalDaemonLifecyclePosture;
  readonly endpoints: readonly CliServiceEndpointPosture[];
  readonly log: CliServiceLogPosture;
  readonly issues: readonly string[];
}

const ENDPOINTS: readonly { readonly id: RuntimeEndpointId; readonly label: string; readonly enabledKey: string }[] = [
  { id: 'controlPlane', label: 'control plane', enabledKey: 'controlPlane.enabled' },
  { id: 'httpListener', label: 'HTTP listener', enabledKey: 'danger.httpListener' },
  { id: 'web', label: 'web surface', enabledKey: 'web.enabled' },
];

interface CliServicePostureOptions {
  readonly probe?: boolean;
  readonly logTailBytes?: number;
}

function connectHostForBindHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1';
  return host || '127.0.0.1';
}

async function probeTcp(host: string, port: number, timeoutMs = 750): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: connectHostForBindHost(host), port });
    const finish = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function readLogPosture(path: string | undefined, tailBytes: number): CliServiceLogPosture {
  if (!path) return { path: null, exists: false, size: 0, modifiedAt: null };
  if (!existsSync(path)) return { path, exists: false, size: 0, modifiedAt: null };
  try {
    const stat = statSync(path);
    const length = Math.min(stat.size, Math.max(0, tailBytes));
    if (length === 0) {
      return { path, exists: true, size: stat.size, modifiedAt: stat.mtimeMs, tail: '' };
    }
    const raw = Buffer.alloc(length);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, raw, 0, length, Math.max(0, stat.size - length));
    } finally {
      closeSync(fd);
    }
    return {
      path,
      exists: true,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      tail: redactText(raw.toString('utf-8')),
    };
  } catch (error) {
    return {
      path,
      exists: true,
      size: 0,
      modifiedAt: null,
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

function endpointsConflict(a: CliServiceEndpointPosture, b: CliServiceEndpointPosture): boolean {
  if (a.binding.port !== b.binding.port) return false;
  const hostA = a.binding.host;
  const hostB = b.binding.host;
  return hostA === hostB || hostA === '0.0.0.0' || hostB === '0.0.0.0' || hostA === '::' || hostB === '::';
}

function resolveConfiguredLogPath(runtime: CliServiceRuntime): string | undefined {
  const value = runtime.configManager.get('service.logPath');
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return isAbsolute(trimmed) ? trimmed : join(runtime.homeDirectory, trimmed);
}

function createExternalDaemonLifecycle(logPath: string | undefined): CliExternalDaemonLifecyclePosture {
  return {
    platform: 'manual',
    path: 'external GoodVibes runtime host',
    installed: false,
    autostart: false,
    running: false,
    ...(logPath ? { logPath } : {}),
    commandPreview: 'managed outside goodvibes-agent',
    suggestedCommands: [],
    lastAction: 'status',
    pidPath: 'external GoodVibes runtime host',
    lastError: null,
  };
}

export async function buildCliServicePosture(
  runtime: CliServiceRuntime,
  options: CliServicePostureOptions = {},
): Promise<CliServicePosture> {
  const endpoints = await Promise.all(ENDPOINTS.map(async (endpoint): Promise<CliServiceEndpointPosture> => {
    const enabled = runtime.configManager.get(endpoint.enabledKey as never) === true;
    const binding = resolveRuntimeEndpointBinding(runtime.configManager, endpoint.id);
    return {
      id: endpoint.id,
      label: endpoint.label,
      enabled,
      binding,
      bindPosture: classifyBindPosture(binding),
      networkFacing: isNetworkFacing(enabled, binding),
      ...(options.probe && enabled ? { reachable: await probeTcp(binding.host, binding.port) } : {}),
    };
  }));

  const config = {
    enabled: runtime.configManager.get('service.enabled') === true,
    autostart: runtime.configManager.get('service.autostart') === true,
    restartOnFailure: runtime.configManager.get('service.restartOnFailure') === true,
    daemonEnabled: runtime.configManager.get('danger.daemon') === true,
  };
  const serverBackedEnabled = config.daemonEnabled || endpoints.some((endpoint) => endpoint.enabled);
  const issues: string[] = [];

  if (serverBackedEnabled && !config.enabled) {
    issues.push('Host-owned surfaces are configured, but Agent service ownership is disabled.');
  }
  if (config.enabled && !config.autostart) {
    issues.push('External runtime service config has autostart off.');
  }
  if (config.enabled && !config.restartOnFailure) {
    issues.push('External runtime service config has restart-on-failure off.');
  }
  for (const endpoint of endpoints) {
    if (endpoint.enabled && options.probe && endpoint.reachable === false) {
      issues.push(`${endpoint.label} is enabled but not reachable on ${endpoint.binding.host}:${endpoint.binding.port}.`);
    }
  }
  const enabledEndpoints = endpoints.filter((endpoint) => endpoint.enabled);
  for (let outer = 0; outer < enabledEndpoints.length; outer += 1) {
    for (let inner = outer + 1; inner < enabledEndpoints.length; inner += 1) {
      const left = enabledEndpoints[outer]!;
      const right = enabledEndpoints[inner]!;
      if (endpointsConflict(left, right)) {
        issues.push(`${left.label} and ${right.label} are configured to bind the same host/port envelope (${left.binding.host}:${left.binding.port}, ${right.binding.host}:${right.binding.port}).`);
      }
    }
  }
  const configuredLogPath = resolveConfiguredLogPath(runtime);
  const log = readLogPosture(configuredLogPath, options.logTailBytes ?? 4096);
  if (log.readError) {
    issues.push(`Service log exists but could not be read: ${log.readError}`);
  }

  return {
    config,
    managed: createExternalDaemonLifecycle(configuredLogPath),
    endpoints,
    log,
    issues,
  };
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

export function formatCliServicePosture(posture: CliServicePosture, json = false): string {
  if (json) return JSON.stringify(posture, null, 2);
  return [
    'GoodVibes external runtime diagnostics',
    '  lifecycle: managed outside goodvibes-agent',
    `  service config enabled: ${yesNo(posture.config.enabled)}`,
    `  autostart config: ${yesNo(posture.config.autostart)}`,
    `  restartOnFailure config: ${yesNo(posture.config.restartOnFailure)}`,
    `  runtime host flag: ${yesNo(posture.config.daemonEnabled)}`,
    `  log: ${posture.log.path ?? 'n/a'} (${posture.log.exists ? 'present' : 'missing'})`,
    ...(posture.log.readError ? [`  log read error: ${posture.log.readError}`] : []),
    '',
    'Endpoints:',
    ...posture.endpoints.map((endpoint) =>
      `  ${endpoint.label}: enabled=${yesNo(endpoint.enabled)} ${endpoint.binding.hostMode} ${endpoint.binding.host}:${endpoint.binding.port} posture=${endpoint.bindPosture.label}${endpoint.reachable === undefined ? '' : ` reachable=${yesNo(endpoint.reachable)}`}`,
    ),
    '',
    posture.issues.length === 0 ? 'Readiness: ready' : 'Readiness: needs attention',
    ...posture.issues.map((issue) => `  - ${issue}`),
  ].join('\n');
}
