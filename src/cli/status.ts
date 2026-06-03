import type { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import type { OnboardingCheckMarkersState } from '../runtime/onboarding/index.ts';
import { resolveRuntimeEndpointBinding } from './endpoints.ts';
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
  readonly area: 'auth' | 'onboarding' | 'runtime' | 'security' | 'secrets';
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

export function buildCliDoctorFindings(options: CliStatusOptions): readonly CliDoctorFinding[] {
  const config = options.configManager;
  const permissionMode = config.get('permissions.mode');
  const secretPolicy = config.get('storage.secretPolicy');
  const marker = options.onboardingMarkers?.effective;

  const findings: CliDoctorFinding[] = [];

  if (options.externalRuntime) {
    if (!options.externalRuntime.reachable) {
      findings.push({
        id: 'external-runtime-unreachable',
        area: 'runtime',
        severity: 'warning',
        summary: 'Connected GoodVibes host is not reachable.',
        cause: `Agent could not reach ${options.externalRuntime.baseUrl}${options.externalRuntime.error ? `: ${options.externalRuntime.error}` : '.'}`,
        impact: 'Companion chat, isolated Agent Knowledge, approvals, automation status, and build delegation cannot work until the connected GoodVibes host is available.',
        action: 'Make the owning GoodVibes host available, then rerun goodvibes-agent status.',
      });
    } else if (!options.externalRuntime.compatible) {
      findings.push({
        id: 'external-runtime-version-mismatch',
        area: 'runtime',
        severity: 'warning',
        summary: 'Connected GoodVibes host SDK version does not match Agent.',
        cause: `Connected host reports SDK ${options.externalRuntime.version}; Agent expects ${options.externalRuntime.expectedVersion}.`,
        impact: 'Agent-only routes, especially isolated Agent Knowledge, may be missing or incompatible.',
        action: 'Update the owning GoodVibes host so /status matches this Agent package SDK pin.',
      });
    }

    if (!options.externalRuntime.operatorToken.present) {
      findings.push({
        id: 'external-runtime-token-missing',
        area: 'auth',
        severity: 'warning',
        summary: 'Connected-host operator token is missing.',
        cause: `No operator token was found at ${options.externalRuntime.operatorToken.path}.`,
        impact: 'Agent can inspect only unauthenticated routes and cannot use protected connected-host APIs.',
        action: 'Pair or provision access through the owning GoodVibes host, then rerun goodvibes-agent auth.',
      });
    }

    if (options.externalRuntime.reachable && options.externalRuntime.operatorToken.present && !options.externalRuntime.agentKnowledge.ready) {
      findings.push({
        id: 'agent-knowledge-route-not-ready',
        area: 'runtime',
        severity: 'warning',
        summary: 'Isolated Agent Knowledge route is not ready.',
        cause: `${options.externalRuntime.agentKnowledge.route} returned ${options.externalRuntime.agentKnowledge.kind}${options.externalRuntime.agentKnowledge.statusCode === null ? '' : ` (${options.externalRuntime.agentKnowledge.statusCode})`}.`,
        impact: 'Agent Knowledge ask/search will not use default or non-Agent knowledge fallback; it will fail closed until the Agent route is available.',
        action: 'Update the connected GoodVibes host to the Agent-compatible SDK and verify goodvibes-agent compat.',
      });
    }
  }

  if (options.service) {
    for (const issue of options.service.issues) {
      if (findings.some((finding) => finding.summary === issue)) continue;
      findings.push({
        id: `runtime-connection-${findings.length}`,
        area: 'runtime',
        severity: 'warning',
        summary: issue,
        cause: 'The connected-host inspection found a mismatch between configured endpoint state and observed host state.',
        impact: 'Companion chat, Agent Knowledge, approvals, automation status, or build delegation may be unavailable.',
        action: 'Use Agent status and doctor diagnostics here, then repair the connected GoodVibes host outside Agent.',
      });
    }
  }

  if (!marker?.exists) {
    findings.push({
      id: 'onboarding-incomplete',
      area: 'onboarding',
      severity: 'warning',
      summary: 'Agent setup has not been applied for this user.',
      cause: 'No global user setup completion marker was found.',
      impact: 'Provider/model, Agent Knowledge, local behavior, channel, and permission choices may still be implicit defaults.',
      action: 'Run /setup in GoodVibes Agent or goodvibes-agent setup status to review setup state.',
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
      ? `  local auth store: ${options.auth.userStorePresent ? 'present' : 'missing'} (${options.auth.userStorePath})`
      : '  local auth store: unknown',
    options.auth
      ? `  setup credential: ${options.auth.bootstrapCredentialPresent ? 'present' : 'missing'} (${options.auth.bootstrapCredentialPath})`
      : '  setup credential: unknown',
    options.auth
      ? `  connected-host token: ${options.auth.operatorTokenPresent ? 'present' : 'missing'} (${options.auth.operatorTokenPath})`
      : '  connected-host token: unknown',
    '',
    'Connected GoodVibes host:',
    ...(externalRuntime ? [
      `  baseUrl: ${externalRuntime.baseUrl}`,
      `  reachable: ${yesNo(externalRuntime.reachable)}${externalRuntime.statusCode === null ? '' : ` (HTTP ${externalRuntime.statusCode})`}`,
      `  sdk: ${externalRuntime.version} expected ${externalRuntime.expectedVersion}`,
      `  compatible: ${yesNo(externalRuntime.compatible)}`,
      `  access token: ${externalRuntime.operatorToken.present ? 'present' : 'missing'} (${externalRuntime.operatorToken.path})`,
      `  Agent Knowledge: ${externalRuntime.agentKnowledge.ready ? 'ready' : `not ready (${externalRuntime.agentKnowledge.kind})`}`,
      ...(externalRuntime.error ? [`  error: ${externalRuntime.error}`] : []),
    ] : [
      '  live check: unavailable',
    ]),
    '',
    'Agent role:',
    '  product: interactive operator TUI',
    '  host lifecycle: external',
    '  starts or exposes host: no',
    ...(options.service ? [
      `  host log signal: ${options.service.log.path ?? 'n/a'} (${options.service.log.exists ? 'present' : 'missing'})`,
    ] : []),
    'Onboarding:',
    `  checked: ${marker?.exists ? 'yes' : 'no'}`,
    `  scope: ${marker?.scope ?? 'none'}`,
    `  updatedAt: ${marker?.payload ? new Date(marker.payload.updatedAt).toISOString() : 'n/a'}`,
  ];

  if (options.doctor) {
    lines.push(
      '',
      'Readiness Checks:',
      '  companion chat route',
      '  isolated Agent Knowledge route',
      '  approvals and automation status routes',
      '  explicit build delegation route',
    );
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
