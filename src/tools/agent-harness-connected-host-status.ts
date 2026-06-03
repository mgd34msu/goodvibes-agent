import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { resolveRuntimeEndpointBinding } from '../cli/endpoints.ts';
import { inspectCliExternalRuntime, type CliExternalRuntimeSnapshot } from '../cli/external-runtime.ts';
import type { CommandContext } from '../input/command-registry.ts';
import { connectedHostOperatorTokenFingerprint, readConnectedHostOperatorToken } from '../runtime/connected-host-auth.ts';
import {
  blockedConnectedHostCapabilities,
  connectedHostCapabilityMap,
  connectedHostRouteFamilies,
} from './agent-harness-metadata.ts';

const CONNECTED_HOST_STATUS_TIMEOUT_MS = 1500;

function resolveHomeDirectory(context: CommandContext): string {
  return context.workspace.shellPaths?.homeDirectory
    ?? context.platform.configManager.getHomeDirectory()
    ?? '';
}

function resolveWorkingDirectory(context: CommandContext): string {
  return context.workspace.shellPaths?.workingDirectory
    ?? context.platform.configManager.getWorkingDirectory()
    ?? '';
}

function connectedHostFindings(
  runtime: CliExternalRuntimeSnapshot,
  tokenUsable: boolean,
): readonly Record<string, unknown>[] {
  const findings: Record<string, unknown>[] = [];

  if (!runtime.reachable) {
    findings.push({
      id: 'connected-host-unreachable',
      severity: 'warning',
      summary: 'Connected host is not reachable.',
      cause: runtime.error ?? `No response from ${runtime.baseUrl}.`,
      action: 'Start or repair the owning GoodVibes host outside Agent, then recheck connected-host status.',
    });
  } else if (!runtime.compatible) {
    findings.push({
      id: 'connected-host-version-mismatch',
      severity: 'warning',
      summary: 'Connected host SDK version does not match Agent.',
      cause: `Connected host reports SDK ${runtime.version}; Agent expects ${runtime.expectedVersion}.`,
      action: 'Update the owning GoodVibes host so its /status route reports the Agent SDK pin.',
    });
  }

  if (!tokenUsable) {
    findings.push({
      id: 'connected-host-token-missing',
      severity: 'warning',
      summary: 'Connected-host operator token is missing or unreadable.',
      cause: `No usable operator token was found at ${runtime.operatorToken.path}.`,
      action: 'Provision or repair connected-host access through the owning GoodVibes host.',
    });
  }

  if (runtime.reachable && tokenUsable && !runtime.agentKnowledge.ready) {
    findings.push({
      id: 'agent-knowledge-route-not-ready',
      severity: 'warning',
      summary: 'Isolated Agent Knowledge route is not ready.',
      cause: `${runtime.agentKnowledge.route} returned ${runtime.agentKnowledge.kind}${runtime.agentKnowledge.statusCode === null ? '' : ` (${runtime.agentKnowledge.statusCode})`}.`,
      action: 'Update or repair the connected host, then recheck Agent Knowledge compatibility.',
    });
  }

  return findings;
}

export async function connectedHostStatusSummary(
  context: CommandContext,
  toolRegistry: ToolRegistry,
): Promise<Record<string, unknown>> {
  const homeDirectory = resolveHomeDirectory(context);
  const workingDirectory = resolveWorkingDirectory(context);
  const token = readConnectedHostOperatorToken(homeDirectory);
  const runtime = await inspectCliExternalRuntime({
    configManager: context.platform.configManager,
    homeDirectory,
    timeoutMs: CONNECTED_HOST_STATUS_TIMEOUT_MS,
  });
  const tokenUsable = Boolean(token.token);

  return {
    ownership: 'external-connected-host',
    readOnly: true,
    timeoutMs: CONNECTED_HOST_STATUS_TIMEOUT_MS,
    lifecycle: 'GoodVibes Agent can inspect connected-host readiness and use public operator routes, but does not start, stop, restart, install, expose, or mutate the host listener.',
    paths: {
      workingDirectory,
      homeDirectory,
    },
    endpoints: {
      controlPlane: {
        enabled: context.platform.configManager.get('controlPlane.enabled'),
        ...resolveRuntimeEndpointBinding(context.platform.configManager, 'controlPlane'),
      },
      httpListener: {
        enabled: context.platform.configManager.get('danger.httpListener'),
        ...resolveRuntimeEndpointBinding(context.platform.configManager, 'httpListener'),
      },
      web: {
        enabled: context.platform.configManager.get('web.enabled'),
        ...resolveRuntimeEndpointBinding(context.platform.configManager, 'web'),
      },
    },
    operatorToken: {
      present: token.present,
      usable: tokenUsable,
      path: token.path,
      fingerprint: token.token ? `sha256:${connectedHostOperatorTokenFingerprint(token.token)}` : null,
      error: token.error ?? null,
    },
    liveStatus: runtime,
    routeReadiness: [
      {
        id: 'status',
        route: '/status',
        reachable: runtime.reachable,
        statusCode: runtime.statusCode,
        sdkVersion: runtime.version,
        expectedSdkVersion: runtime.expectedVersion,
        compatible: runtime.compatible,
      },
      {
        id: 'agent-knowledge',
        route: runtime.agentKnowledge.route,
        ready: runtime.agentKnowledge.ready,
        kind: runtime.agentKnowledge.kind,
        statusCode: runtime.agentKnowledge.statusCode,
      },
    ],
    findings: connectedHostFindings(runtime, tokenUsable),
    modelAccess: {
      diagnostics: 'Use mode:"connected_host_status" for live read-only host readiness. Use mode:"connected_host" for capability and boundary inventory.',
      cliMirrors: ['goodvibes-agent status --json', 'goodvibes-agent doctor', 'goodvibes-agent compat'],
      tuiMirrors: ['Agent Workspace -> Home -> Host compatibility', 'Agent Workspace -> Home -> Doctor diagnostics', 'Agent Workspace -> Home -> Review health'],
    },
    routeFamilies: connectedHostRouteFamilies(),
    capabilities: connectedHostCapabilityMap(toolRegistry),
    blockedCapabilities: blockedConnectedHostCapabilities(),
  };
}
