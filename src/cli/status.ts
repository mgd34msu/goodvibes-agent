import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import type { OnboardingCheckMarkersState } from '../runtime/onboarding/index.ts';
import { resolveRuntimeEndpointBinding } from './endpoints.ts';
import { isNetworkFacing } from './network-posture.ts';
import type { GoodVibesCliOutputFormat } from './types.ts';
import type { CliServicePosture } from './service-posture.ts';
import type { CliExternalRuntimeSnapshot } from './external-runtime.ts';
import { getProviderIdFromModel } from '../config/provider-model.ts';

export interface CliStatusOptions {
  readonly configManager: Pick<ConfigManager, 'get'>;
  readonly workingDirectory: string;
  readonly homeDirectory: string;
  readonly onboardingMarkers?: OnboardingCheckMarkersState;
  readonly auth?: CliAuthStatus;
  readonly service?: CliServicePosture;
  readonly externalRuntime?: CliExternalRuntimeSnapshot;
  readonly doctor?: boolean;
  readonly outputFormat?: GoodVibesCliOutputFormat;
}

export interface CliAuthStatus {
  readonly userStorePath: string;
  readonly userStorePresent: boolean;
  readonly bootstrapCredentialPath: string;
  readonly bootstrapCredentialPresent: boolean;
  readonly operatorTokenPath: string;
  readonly operatorTokenPresent: boolean;
}

export interface CliDoctorFinding {
  readonly id: string;
  readonly area: 'auth' | 'network' | 'onboarding' | 'runtime' | 'security' | 'secrets';
  readonly severity: 'warning' | 'risk';
  readonly summary: string;
  readonly cause: string;
  readonly impact: string;
  readonly action: string;
}

export interface CliStatusSnapshot {
  readonly title: 'GoodVibes Agent status' | 'GoodVibes Agent doctor';
  readonly workingDirectory: string;
  readonly homeDirectory: string;
  readonly provider: {
    readonly provider: string;
    readonly model: string;
    readonly reasoning: string;
  };
  readonly auth: {
    readonly permissionMode: unknown;
    readonly permissionLabel: string;
    readonly secretPolicy: unknown;
    readonly secretPolicyLabel: string;
    readonly runtimeAuthSignal: CliAuthStatus | null;
  };
  readonly runtimeConnection: {
    readonly enabled: unknown;
    readonly autostart: unknown;
    readonly restartOnFailure: unknown;
    readonly lifecycle?: CliServicePosture;
  };
  readonly externalRuntime: CliExternalRuntimeSnapshot | null;
  readonly runtimeEndpoints: {
    readonly controlPlane: ReturnType<typeof resolveRuntimeEndpointBinding> & { readonly enabled: unknown };
    readonly httpListener: ReturnType<typeof resolveRuntimeEndpointBinding> & { readonly enabled: unknown };
    readonly web: ReturnType<typeof resolveRuntimeEndpointBinding> & { readonly enabled: unknown };
  };
  readonly onboarding: {
    readonly checked: boolean;
    readonly scope: string;
    readonly updatedAt: number | null;
  };
  readonly findings: readonly CliDoctorFinding[];
}

function yesNo(value: unknown): string {
  return value === true ? 'yes' : 'no';
}

function permissionModeLabel(mode: unknown): string {
  if (mode === 'prompt') return 'Ask before powerful actions';
  if (mode === 'allow-all') return 'Allow everything';
  if (mode === 'custom') return 'Custom rules';
  return String(mode ?? 'unknown');
}

function secretPolicyLabel(policy: unknown): string {
  if (policy === 'preferred_secure') return 'Use secure storage when available';
  if (policy === 'require_secure') return 'Require secure storage';
  if (policy === 'plaintext_allowed') return 'Allow plaintext storage';
  return String(policy ?? 'unknown');
}

function bindLine(label: string, enabled: unknown, binding: { readonly hostMode: string; readonly host: string; readonly port: number }): string {
  return `  ${label}: ${yesNo(enabled)} (${binding.hostMode} ${binding.host}:${binding.port})`;
}

export function buildCliDoctorFindings(options: CliStatusOptions): readonly CliDoctorFinding[] {
  const config = options.configManager;
  const serviceEnabled = config.get('service.enabled') === true;
  const serviceAutostart = config.get('service.autostart') === true;
  const restartOnFailure = config.get('service.restartOnFailure') === true;
  const daemonEnabled = config.get('danger.daemon') === true;
  const listenerEnabled = config.get('danger.httpListener') === true;
  const webEnabled = config.get('web.enabled') === true;
  const controlPlaneEnabled = config.get('controlPlane.enabled') === true;
  const controlPlaneBinding = resolveRuntimeEndpointBinding(config, 'controlPlane');
  const httpListenerBinding = resolveRuntimeEndpointBinding(config, 'httpListener');
  const webBinding = resolveRuntimeEndpointBinding(config, 'web');
  const permissionMode = config.get('permissions.mode');
  const secretPolicy = config.get('storage.secretPolicy');
  const marker = options.onboardingMarkers?.effective;
  const serverBackedEnabled = daemonEnabled || controlPlaneEnabled || listenerEnabled || webEnabled;
  const networkFacingSurfaces = [
    ['runtime API', controlPlaneEnabled, controlPlaneBinding],
    ['incoming webhook listener', listenerEnabled, httpListenerBinding],
    ['browser companion', webEnabled, webBinding],
  ].filter(([, enabled, binding]) => isNetworkFacing(enabled, binding as typeof controlPlaneBinding));

  const findings: CliDoctorFinding[] = [];

  if (options.externalRuntime) {
    if (!options.externalRuntime.reachable) {
      findings.push({
        id: 'external-runtime-unreachable',
        area: 'runtime',
        severity: 'warning',
        summary: 'External GoodVibes runtime is not reachable.',
        cause: `Agent could not reach ${options.externalRuntime.baseUrl}${options.externalRuntime.error ? `: ${options.externalRuntime.error}` : '.'}`,
        impact: 'Companion chat, isolated Agent Knowledge, approvals, automation status, and build delegation cannot work until the external runtime is available.',
        action: 'Start or repair the runtime-owning GoodVibes TUI/host, then rerun goodvibes-agent status.',
      });
    } else if (!options.externalRuntime.compatible) {
      findings.push({
        id: 'external-runtime-version-mismatch',
        area: 'runtime',
        severity: 'warning',
        summary: 'External GoodVibes runtime SDK version does not match Agent.',
        cause: `Runtime reports SDK ${options.externalRuntime.version}; Agent expects ${options.externalRuntime.expectedVersion}.`,
        impact: 'Agent-only routes, especially isolated Agent Knowledge, may be missing or incompatible.',
        action: 'Update/restart the runtime-owning GoodVibes TUI/host so /status matches this Agent package SDK pin.',
      });
    }

    if (!options.externalRuntime.operatorToken.present) {
      findings.push({
        id: 'external-runtime-token-missing',
        area: 'auth',
        severity: 'warning',
        summary: 'External runtime operator token is missing.',
        cause: `No operator token was found at ${options.externalRuntime.operatorToken.path}.`,
        impact: 'Agent can inspect only unauthenticated routes and cannot use protected runtime APIs.',
        action: 'Pair or provision access through the runtime-owning GoodVibes TUI/host, then rerun goodvibes-agent auth.',
      });
    }

    if (options.externalRuntime.reachable && options.externalRuntime.operatorToken.present && !options.externalRuntime.agentKnowledge.ready) {
      findings.push({
        id: 'agent-knowledge-route-not-ready',
        area: 'runtime',
        severity: 'warning',
        summary: 'Isolated Agent Knowledge route is not ready.',
        cause: `${options.externalRuntime.agentKnowledge.route} returned ${options.externalRuntime.agentKnowledge.kind}${options.externalRuntime.agentKnowledge.statusCode === null ? '' : ` (${options.externalRuntime.agentKnowledge.statusCode})`}.`,
        impact: 'Agent Knowledge ask/search will not use any fallback wiki or HomeGraph segment; it will fail closed until the Agent route is available.',
        action: 'Update/restart the external runtime to the Agent-compatible SDK and verify goodvibes-agent compat.',
      });
    }
  }

  if (serverBackedEnabled && !serviceEnabled) {
    findings.push({
      id: 'runtime-ownership-external',
      area: 'runtime',
      severity: 'warning',
      summary: 'External runtime endpoints are configured while Agent runtime ownership is disabled by design.',
      cause: 'One or more runtime API, listener, or web settings are enabled while service.enabled is false.',
      impact: 'The external GoodVibes runtime must own availability for those endpoints; Agent will not start or enable them.',
      action: 'Manage runtime availability from GoodVibes TUI or the owning host, then use Agent for read-only diagnostics.',
    });
  }

  if (serviceEnabled && !serviceAutostart) {
    findings.push({
      id: 'runtime-autostart-disabled',
      area: 'runtime',
      severity: 'warning',
      summary: 'External runtime host config has autostart off.',
      cause: 'service.enabled is true and service.autostart is false.',
      impact: 'The external GoodVibes runtime may not be available after login or reboot even though host-managed startup is selected.',
      action: 'Configure autostart from GoodVibes TUI or the owning host; Agent will not mutate this setting.',
    });
  }

  if (serviceEnabled && !restartOnFailure) {
    findings.push({
      id: 'runtime-restart-disabled',
      area: 'runtime',
      severity: 'warning',
      summary: 'External runtime host config has restart-on-failure off.',
      cause: 'service.enabled is true and service.restartOnFailure is false.',
      impact: 'A crashed runtime or listener may stay down until manually restarted.',
      action: 'Configure restart-on-failure from GoodVibes TUI or the owning host; Agent will not mutate this setting.',
    });
  }

  if (options.service) {
    for (const issue of options.service.issues) {
      if (findings.some((finding) => finding.summary === issue)) continue;
      findings.push({
        id: `runtime-connection-${findings.length}`,
        area: 'runtime',
        severity: 'warning',
        summary: issue,
        cause: 'The runtime connection inspection found a mismatch between configured endpoint state and observed host state.',
        impact: 'Runtime API, listener, or web availability may not match the configuration.',
        action: 'Use Agent status and doctor diagnostics here, then manage the runtime from GoodVibes TUI or your host tooling.',
      });
    }
  }

  if (!marker?.exists) {
    findings.push({
      id: 'onboarding-incomplete',
      area: 'onboarding',
      severity: 'warning',
      summary: 'Agent setup has not been shown for this user.',
      cause: 'No global user setup check marker was found.',
      impact: 'Important runtime, network, provider, auth, or permission choices may still be implicit defaults.',
      action: 'Run /setup in GoodVibes Agent or goodvibes-agent setup status to review setup state.',
    });
  }

  if (networkFacingSurfaces.length > 0 && options.auth?.userStorePresent !== true) {
    findings.push({
      id: 'network-endpoint-without-runtime-auth-signal',
      area: 'auth',
      severity: 'risk',
      summary: 'Network-facing runtime endpoints are enabled without a visible runtime auth signal.',
      cause: `${networkFacingSurfaces.map(([name]) => name).join(', ')} are LAN/custom-bound, but Agent cannot see runtime auth state from its local compatibility files.`,
      impact: 'Remote access paths may be unusable or unsafe unless the external runtime owner configured auth.',
      action: 'Review runtime auth from the owning GoodVibes TUI or host tooling; Agent will not create local runtime users.',
    });
  }

  if (networkFacingSurfaces.length > 0 && options.auth?.bootstrapCredentialPresent === true) {
    findings.push({
      id: 'network-endpoint-with-bootstrap-credential',
      area: 'auth',
      severity: 'risk',
      summary: 'A bootstrap credential is still present while network-facing surfaces are enabled.',
      cause: `${networkFacingSurfaces.map(([name]) => name).join(', ')} are LAN/custom-bound and auth-bootstrap.txt exists.`,
      impact: 'Bootstrap credentials should be treated as temporary setup material, not long-lived network access credentials.',
      action: 'Use the runtime-owning GoodVibes TUI or host tooling to replace bootstrap auth and retire the bootstrap credential.',
    });
  }

  if (permissionMode === 'allow-all') {
    findings.push({
      id: 'allow-all-permissions',
      area: 'security',
      severity: 'risk',
      summary: 'Allow everything permission mode is active.',
      cause: 'permissions.mode is allow-all.',
      impact: 'Powerful write, edit, network, and execution tools can run without a Human-in-the-Loop (HITL) approval prompt.',
      action: 'Use Ask before powerful actions or Custom rules unless this is an intentionally trusted environment.',
    });
  }

  if (secretPolicy === 'plaintext_allowed') {
    findings.push({
      id: 'plaintext-secrets-allowed',
      area: 'secrets',
      severity: 'risk',
      summary: 'Plaintext secret storage is allowed.',
      cause: 'storage.secretPolicy is plaintext_allowed.',
      impact: 'Provider keys and channel tokens may be stored without secure backend protection.',
      action: 'Use Require secure storage or Use secure storage when available for normal operation.',
    });
  }

  if (listenerEnabled && isNetworkFacing(listenerEnabled, httpListenerBinding)) {
    findings.push({
      id: 'network-http-listener-enabled',
      area: 'network',
      severity: 'warning',
      summary: 'The incoming webhook listener is reachable beyond loopback.',
      cause: `Incoming webhook listener is enabled on ${httpListenerBinding.host}:${httpListenerBinding.port} with ${httpListenerBinding.hostMode} binding.`,
      impact: 'External tools and devices may be able to reach incoming event endpoints.',
      action: 'Keep listener secrets/signature checks configured for every enabled webhook endpoint.',
    });
  }

  return findings;
}

export function buildCliStatusSnapshot(options: CliStatusOptions): CliStatusSnapshot {
  const config = options.configManager;
  const controlPlaneBinding = resolveRuntimeEndpointBinding(config, 'controlPlane');
  const httpListenerBinding = resolveRuntimeEndpointBinding(config, 'httpListener');
  const webBinding = resolveRuntimeEndpointBinding(config, 'web');
  const marker = options.onboardingMarkers?.effective;
  const findings = buildCliDoctorFindings(options);
  return {
    title: options.doctor ? 'GoodVibes Agent doctor' : 'GoodVibes Agent status',
    workingDirectory: options.workingDirectory,
    homeDirectory: options.homeDirectory,
    provider: {
      provider: getProviderIdFromModel(config.get('provider.model')),
      model: String(config.get('provider.model')),
      reasoning: String(config.get('provider.reasoningEffort')),
    },
    auth: {
      permissionMode: config.get('permissions.mode'),
      permissionLabel: permissionModeLabel(config.get('permissions.mode')),
      secretPolicy: config.get('storage.secretPolicy'),
      secretPolicyLabel: secretPolicyLabel(config.get('storage.secretPolicy')),
      runtimeAuthSignal: options.auth ?? null,
    },
    runtimeConnection: {
      enabled: config.get('service.enabled'),
      autostart: config.get('service.autostart'),
      restartOnFailure: config.get('service.restartOnFailure'),
      ...(options.service ? { lifecycle: options.service } : {}),
    },
    externalRuntime: options.externalRuntime ?? null,
    runtimeEndpoints: {
      controlPlane: { enabled: config.get('controlPlane.enabled'), ...controlPlaneBinding },
      httpListener: { enabled: config.get('danger.httpListener'), ...httpListenerBinding },
      web: { enabled: config.get('web.enabled'), ...webBinding },
    },
    onboarding: {
      checked: Boolean(marker?.exists),
      scope: marker?.scope ?? 'none',
      updatedAt: marker?.payload?.updatedAt ?? null,
    },
    findings,
  };
}

export function renderCliStatus(options: CliStatusOptions): string {
  const config = options.configManager;
  const snapshot = buildCliStatusSnapshot(options);
  const serviceEnabled = snapshot.runtimeConnection.enabled;
  const serviceAutostart = snapshot.runtimeConnection.autostart;
  const restartOnFailure = snapshot.runtimeConnection.restartOnFailure;
  const controlPlaneEnabled = snapshot.runtimeEndpoints.controlPlane.enabled;
  const listenerEnabled = snapshot.runtimeEndpoints.httpListener.enabled;
  const webEnabled = snapshot.runtimeEndpoints.web.enabled;
  const controlPlaneBinding = snapshot.runtimeEndpoints.controlPlane;
  const httpListenerBinding = snapshot.runtimeEndpoints.httpListener;
  const webBinding = snapshot.runtimeEndpoints.web;
  const marker = options.onboardingMarkers?.effective;
  const findings = snapshot.findings;
  const externalRuntime = snapshot.externalRuntime;

  if (options.outputFormat === 'json') return JSON.stringify(snapshot, null, 2);

  const lines = [
    snapshot.title,
    `  workingDir: ${options.workingDirectory}`,
    `  homeDir: ${options.homeDirectory}`,
    '',
    'Provider:',
    `  provider: ${getProviderIdFromModel(config.get('provider.model'))}`,
    `  model: ${String(config.get('provider.model'))}`,
    `  reasoning: ${String(config.get('provider.reasoningEffort'))}`,
    '',
    'Auth:',
    `  permissions: ${permissionModeLabel(config.get('permissions.mode'))} (${String(config.get('permissions.mode'))})`,
    `  secretPolicy: ${secretPolicyLabel(config.get('storage.secretPolicy'))} (${String(config.get('storage.secretPolicy'))})`,
    options.auth
      ? `  runtimeAuthSignal: ${options.auth.userStorePresent ? 'present' : 'missing'} (${options.auth.userStorePath})`
      : '  runtimeAuthSignal: unknown',
    options.auth
      ? `  bootstrapCredential: ${options.auth.bootstrapCredentialPresent ? 'present' : 'missing'} (${options.auth.bootstrapCredentialPath})`
      : '  bootstrapCredential: unknown',
    options.auth
      ? `  operatorTokens: ${options.auth.operatorTokenPresent ? 'present' : 'missing'} (${options.auth.operatorTokenPath})`
      : '  operatorTokens: unknown',
    '',
    'External Runtime:',
    ...(externalRuntime ? [
      `  baseUrl: ${externalRuntime.baseUrl}`,
      `  reachable: ${yesNo(externalRuntime.reachable)}${externalRuntime.statusCode === null ? '' : ` (HTTP ${externalRuntime.statusCode})`}`,
      `  sdk: ${externalRuntime.version} expected ${externalRuntime.expectedVersion}`,
      `  compatible: ${yesNo(externalRuntime.compatible)}`,
      `  operatorToken: ${externalRuntime.operatorToken.present ? 'present' : 'missing'} (${externalRuntime.operatorToken.path})`,
      `  Agent Knowledge: ${externalRuntime.agentKnowledge.ready ? 'ready' : `not ready (${externalRuntime.agentKnowledge.kind})`}`,
      ...(externalRuntime.error ? [`  error: ${externalRuntime.error}`] : []),
    ] : [
      '  live check: unavailable',
    ]),
    '',
    'Runtime Ownership:',
    '  Agent hosting: external only',
    `  Agent starts runtime: no`,
    `  legacy host config present: ${yesNo(serviceEnabled)}`,
    `  legacy host autostart: ${yesNo(serviceAutostart)}`,
    `  legacy host restart policy: ${yesNo(restartOnFailure)}`,
    ...(options.service ? [
      `  platform: ${options.service.managed.platform}`,
      `  installed: ${yesNo(options.service.managed.installed)}`,
      `  running: ${yesNo(options.service.managed.running)}`,
      `  definition: ${options.service.managed.path}`,
      `  log: ${options.service.log.path ?? 'n/a'} (${options.service.log.exists ? 'present' : 'missing'})`,
    ] : []),
    '',
    'Runtime Endpoint Diagnostics:',
    bindLine('runtimeApi', controlPlaneEnabled, controlPlaneBinding),
    bindLine('incomingWebhook', listenerEnabled, httpListenerBinding),
    bindLine('browserCompanion', webEnabled, webBinding),
    '',
    'Onboarding:',
    `  checked: ${marker?.exists ? 'yes' : 'no'}`,
    `  scope: ${marker?.scope ?? 'none'}`,
    `  updatedAt: ${marker?.payload ? new Date(marker.payload.updatedAt).toISOString() : 'n/a'}`,
  ];

  if (options.doctor) {
    lines.push('', 'Warnings:');
    if (findings.length === 0) {
      lines.push('  none');
    } else {
      for (const finding of findings) {
        lines.push(
          `  - [${finding.severity}:${finding.area}:${finding.id}] ${finding.summary}`,
          `    cause: ${finding.cause}`,
          `    impact: ${finding.impact}`,
          `    action: ${finding.action}`,
        );
      }
    }
  }

  return lines.join('\n');
}

export function renderOnboardingCliStatus(options: CliStatusOptions): string {
  const marker = options.onboardingMarkers?.effective;
  return [
    'GoodVibes Agent setup status',
    `  checked: ${marker?.exists ? 'yes' : 'no'}`,
    `  scope: ${marker?.scope ?? 'none'}`,
    `  source: ${marker?.payload?.source ?? 'n/a'}`,
    `  mode: ${marker?.payload?.mode ?? 'n/a'}`,
    `  updatedAt: ${marker?.payload ? new Date(marker.payload.updatedAt).toISOString() : 'n/a'}`,
    `  workingDir: ${options.workingDirectory}`,
  ].join('\n');
}
