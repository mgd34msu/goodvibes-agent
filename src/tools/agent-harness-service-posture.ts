import type { CommandContext } from '../input/command-registry.ts';
import {
  buildCliServicePosture,
  type CliServiceEndpointPosture,
  type CliServicePosture,
} from '../cli/service-posture.ts';
import type { RuntimeEndpointId } from '../cli/endpoints.ts';

export interface AgentHarnessServicePostureArgs {
  readonly endpointId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
}

type ServiceEndpointLookupSource = 'endpointId' | 'target' | 'query';

type ServiceEndpointResolution =
  | { readonly status: 'found'; readonly endpoint: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

const SERVICE_ENDPOINT_IDS: readonly RuntimeEndpointId[] = ['controlPlane', 'httpListener', 'web'];

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

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

function servicePostureRuntime(context: CommandContext) {
  return {
    configManager: context.platform.configManager,
    workingDirectory: resolveWorkingDirectory(context),
    homeDirectory: resolveHomeDirectory(context),
  };
}

function servicePostureOptions(args: AgentHarnessServicePostureArgs) {
  const includeDetails = args.includeParameters === true;
  return {
    probe: includeDetails,
    logTailBytes: includeDetails ? 4096 : 0,
  };
}

function summarizeLog(posture: CliServicePosture, includeTail: boolean): Record<string, unknown> {
  return {
    path: posture.log.path,
    exists: posture.log.exists,
    size: posture.log.size,
    modifiedAt: posture.log.modifiedAt,
    readError: posture.log.readError ?? null,
    ...(includeTail && posture.log.tail !== undefined ? { tail: posture.log.tail } : {}),
  };
}

function describeEndpoint(endpoint: CliServiceEndpointPosture, lookup?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: endpoint.id,
    label: endpoint.label,
    enabled: endpoint.enabled,
    binding: endpoint.binding,
    bindPosture: endpoint.bindPosture,
    networkFacing: endpoint.networkFacing,
    ...(endpoint.reachable !== undefined ? { reachable: endpoint.reachable } : {}),
    ...(lookup ? { lookup } : {}),
    policy: {
      effect: 'read-only',
      modelOperation: 'Inspect endpoint binding, network-facing posture, and optional reachability only.',
      lifecycle: 'GoodVibes Agent does not start, stop, restart, install, expose, or mutate connected-host listeners.',
      settings: 'Use agent_harness settings/get_setting for read-only inspection of endpoint settings; connected-host lifecycle/listener settings stay locked in Agent.',
    },
  };
}

function describeEndpointCandidate(endpoint: CliServiceEndpointPosture): Record<string, unknown> {
  return {
    endpointId: endpoint.id,
    label: endpoint.label,
    enabled: endpoint.enabled,
    binding: endpoint.binding,
  };
}

function endpointLookupFromArgs(args: AgentHarnessServicePostureArgs): { readonly source: ServiceEndpointLookupSource; readonly input: string } | null {
  const endpointId = readString(args.endpointId);
  if (endpointId) return { source: 'endpointId', input: endpointId };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

function endpointSearchText(endpoint: CliServiceEndpointPosture): string {
  return [
    endpoint.id,
    endpoint.label,
    endpoint.binding.hostMode,
    endpoint.binding.configuredHost,
    endpoint.binding.host,
    String(endpoint.binding.port),
    endpoint.bindPosture.kind,
    endpoint.bindPosture.label,
  ].join('\n').toLowerCase();
}

function resolveEndpoint(
  posture: CliServicePosture,
  args: AgentHarnessServicePostureArgs,
): ServiceEndpointResolution {
  const lookup = endpointLookupFromArgs(args);
  if (!lookup) {
    return {
      status: 'missing_lookup',
      usage: 'service_endpoint requires endpointId, target, or query. Valid endpoint ids are controlPlane, httpListener, and web.',
    };
  }
  const endpoints = posture.endpoints;
  const normalized = lookup.input.toLowerCase();
  const exact = endpoints.find((endpoint) => endpoint.id === lookup.input);
  if (exact) {
    return { status: 'found', endpoint: describeEndpoint(exact, { ...lookup, resolvedBy: 'id' }) };
  }
  const insensitive = endpoints.find((endpoint) => endpoint.id.toLowerCase() === normalized);
  if (insensitive) {
    return { status: 'found', endpoint: describeEndpoint(insensitive, { ...lookup, resolvedBy: 'case-insensitive-id' }) };
  }
  const label = endpoints.find((endpoint) => endpoint.label.toLowerCase() === normalized);
  if (label) {
    return { status: 'found', endpoint: describeEndpoint(label, { ...lookup, resolvedBy: 'label' }) };
  }
  const searched = endpoints.filter((endpoint) => endpointSearchText(endpoint).includes(normalized));
  if (searched.length === 1) {
    return { status: 'found', endpoint: describeEndpoint(searched[0]!, { ...lookup, resolvedBy: 'search' }) };
  }
  if (searched.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: searched.map(describeEndpointCandidate),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown service endpoint ${lookup.input}. Valid endpoint ids are controlPlane, httpListener, and web.`,
  };
}

export function servicePostureCatalogStatus(): Record<string, unknown> {
  return {
    modes: ['service_posture', 'service_endpoint'],
    endpointIds: SERVICE_ENDPOINT_IDS,
    readOnly: true,
    lifecycle: 'Connected-host and listener lifecycle stay outside GoodVibes Agent.',
  };
}

export async function servicePostureSummary(
  context: CommandContext,
  args: AgentHarnessServicePostureArgs,
): Promise<Record<string, unknown>> {
  const includeDetails = args.includeParameters === true;
  const posture = await buildCliServicePosture(servicePostureRuntime(context), servicePostureOptions(args));
  return {
    ownership: 'external-connected-host',
    readOnly: true,
    lifecycle: 'GoodVibes Agent reports connected-host/service posture but does not start, stop, restart, install, expose, or mutate host listeners.',
    config: posture.config,
    managed: posture.managed,
    endpoints: posture.endpoints.map((endpoint) => describeEndpoint(endpoint)),
    log: summarizeLog(posture, includeDetails),
    issues: posture.issues,
    modelAccess: {
      endpointLookup: 'Use mode:"service_endpoint" with endpointId, target, or query to inspect one endpoint.',
      settings: 'Use mode:"settings" with includeHidden:true for endpoint setting descriptors. Host-owned listener settings remain read-only.',
      liveHostStatus: 'Use mode:"connected_host_status" for SDK compatibility, token posture, and Agent Knowledge route readiness.',
    },
  };
}

export async function describeHarnessServiceEndpoint(
  context: CommandContext,
  args: AgentHarnessServicePostureArgs,
): Promise<ServiceEndpointResolution> {
  const posture = await buildCliServicePosture(servicePostureRuntime(context), {
    ...servicePostureOptions(args),
    probe: true,
  });
  return resolveEndpoint(posture, args);
}
