import { networkInterfaces } from 'node:os';
import type { CommandContext } from '../input/command-registry.ts';
import { GOODVIBES_AGENT_PAIRING_SURFACE } from '../config/surface.ts';
import { resolveRuntimeEndpointBinding } from '../cli/endpoints.ts';
import { connectedHostOperatorTokenFingerprint, readConnectedHostOperatorToken } from '../runtime/connected-host-auth.ts';
import { requirePlatform, requireShellPaths } from '../input/commands/runtime-services.ts';
import { previewHarnessText } from './agent-harness-text.ts';

export interface AgentHarnessPairingArgs {
  readonly pairingRouteId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

type PairingResolution =
  | { readonly status: 'found'; readonly route: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

type PairingLookupSource = 'pairingRouteId' | 'target' | 'query';

interface PairingRoute {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly effect: 'read-only' | 'visible-navigation' | 'external-network' | 'confirmation-gated-secret-display' | 'confirmed-local-auth-provisioning';
  readonly command?: string;
  readonly harnessRoute?: string;
  readonly capabilityIds?: readonly string[];
  readonly requiresConfirmation?: boolean;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function localNetworkIp(): string {
  try {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const netInfo of nets[name] ?? []) {
        if (netInfo.family === 'IPv4' && !netInfo.internal) return netInfo.address;
      }
    }
  } catch {
    return '127.0.0.1';
  }
  return '127.0.0.1';
}

function urlHostForBindHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return localNetworkIp();
  return host || '127.0.0.1';
}

function lookupFromArgs(args: AgentHarnessPairingArgs): { readonly source: PairingLookupSource; readonly input: string } | null {
  const pairingRouteId = readString(args.pairingRouteId);
  if (pairingRouteId) return { source: 'pairingRouteId', input: pairingRouteId };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

function pairingRoutes(): readonly PairingRoute[] {
  return [
    {
      id: 'qr-pairing',
      label: 'QR pairing',
      detail: 'Visible companion pairing route that prints QR setup details in the Agent TUI without printing the raw token.',
      effect: 'external-network',
      command: '/pair',
      harnessRoute: 'agent_harness mode:"run_command" command:"/pair" confirm:true explicitUserRequest:"..."',
      requiresConfirmation: true,
    },
    {
      id: 'manual-token-display',
      label: 'Manual token display',
      detail: 'Explicitly confirmed fallback route that prints the raw companion token only when the user asks for manual setup.',
      effect: 'confirmation-gated-secret-display',
      command: '/pair --show-token --yes',
      harnessRoute: 'agent_harness mode:"run_command" command:"/pair --show-token --yes" confirm:true explicitUserRequest:"..."',
      requiresConfirmation: true,
    },
    {
      id: 'pairing-ui',
      label: 'Pairing workspace route',
      detail: 'Visible Agent workspace route for companion pairing and channel setup.',
      effect: 'visible-navigation',
      command: '/agent channels',
      harnessRoute: 'agent_harness mode:"workspace_action" target:"pair"',
      capabilityIds: ['companion-pairing', 'mobile-command-routing'],
    },
    {
      id: 'connected-host-token-provisioning',
      label: 'Connected-host token provisioning',
      detail: 'Confirmed SDK-backed route that creates or repairs the local canonical connected-host token file without printing the raw token.',
      effect: 'confirmed-local-auth-provisioning',
      harnessRoute: 'agent_harness mode:"provision_connected_host_token" setupItemId:"connected-host-auth" confirm:true explicitUserRequest:"..."',
      capabilityIds: ['connected-host-status', 'companion-pairing'],
      requiresConfirmation: true,
    },
    {
      id: 'connected-host-status',
      label: 'Connected host live posture',
      detail: 'Read-only reachability, token posture, and route readiness used before companion setup.',
      effect: 'read-only',
      harnessRoute: 'agent_harness mode:"connected_host_status"',
      capabilityIds: ['connected-host-status'],
    },
    {
      id: 'companion-capabilities',
      label: 'Companion capability map',
      detail: 'Allowed and blocked companion route families for pairing, shared sessions, tasks, approvals, provider/model changes, attachments, and mobile command surfaces.',
      effect: 'read-only',
      harnessRoute: 'agent_harness mode:"connected_host"',
      capabilityIds: [
        'companion-pairing',
        'shared-session',
        'task-management',
        'approval-actions',
        'provider-model-routing',
        'attachment-upload',
        'mobile-command-routing',
      ],
    },
    {
      id: 'channels-readiness',
      label: 'Channel readiness',
      detail: 'Read-only channel setup and delivery posture used after pairing when messages or reminders need an explicit delivery target.',
      effect: 'read-only',
      command: '/channels',
      harnessRoute: 'agent_harness mode:"channels"',
      capabilityIds: ['channels', 'notifications'],
    },
  ];
}

function routeSearchText(route: PairingRoute): string {
  return [
    route.id,
    route.label,
    route.detail,
    route.effect,
    route.command ?? '',
    route.harnessRoute ?? '',
    ...(route.capabilityIds ?? []),
  ].join('\n').toLowerCase();
}

function describeCandidate(route: PairingRoute): Record<string, unknown> {
  return {
    pairingRouteId: route.id,
    label: route.label,
    effect: route.effect,
    requiresConfirmation: route.requiresConfirmation === true,
    modelRoute: pairingRouteModelRoute(route),
  };
}

function describeRoute(route: PairingRoute, options: { readonly includeParameters?: boolean; readonly lookup?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    pairingRouteId: route.id,
    label: route.label,
    ...(options.includeParameters ? { detail: route.detail } : { summary: previewHarnessText(route.detail) }),
    effect: route.effect,
    requiresConfirmation: route.requiresConfirmation === true,
    modelRoute: pairingRouteModelRoute(route),
    ...(options.includeParameters ? {
      ...(route.command ? { command: route.command } : {}),
      ...(route.harnessRoute ? { harnessRoute: route.harnessRoute } : {}),
      ...(route.capabilityIds ? { capabilityIds: route.capabilityIds } : {}),
    } : {}),
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(options.includeParameters ? {
      policy: {
        effect: route.effect,
        values: 'Pairing posture returns endpoint binding and token fingerprint only; raw companion tokens and QR payloads are never returned by this read-only mode.',
        mutation: 'Pairing display, manual token display, companion connection, channel sends, provider/model changes, approval actions, and attachment flows stay explicit visible user flows.',
      },
      modelAccess: {
        inspectPairing: 'agent_harness mode:"pairing_posture"',
        inspectRoute: 'agent_harness mode:"pairing_route"',
        connectedHostStatus: 'agent_harness mode:"connected_host_status"',
        connectedHostCapabilities: 'agent_harness mode:"connected_host"',
        channels: 'agent_harness mode:"channels"',
      },
    } : {}),
  };
}

function pairingRouteModelRoute(route: PairingRoute): string {
  if (route.command === '/pair') return 'agent_harness mode:"run_command" command:"/pair"';
  if (route.command === '/pair --show-token --yes') return 'agent_harness mode:"run_command" command:"/pair --show-token --yes"';
  if (route.id === 'pairing-ui') return 'agent_harness mode:"workspace_action" target:"pair"';
  return previewHarnessText(route.harnessRoute ?? 'agent_harness mode:"pairing_route"');
}

function pairingState(context: CommandContext): Record<string, unknown> {
  const shellPaths = requireShellPaths(context);
  const configManager = requirePlatform(context).configManager;
  const tokenRecord = readConnectedHostOperatorToken(shellPaths.homeDirectory);
  const binding = resolveRuntimeEndpointBinding(configManager, 'controlPlane');
  const host = urlHostForBindHost(binding.host);
  return {
    surface: GOODVIBES_AGENT_PAIRING_SURFACE,
    endpoint: {
      endpointId: 'controlPlane',
      bindHost: binding.host,
      advertisedHost: host,
      port: binding.port,
      url: `http://${host}:${binding.port}`,
    },
    token: {
      present: Boolean(tokenRecord.token),
      path: tokenRecord.path,
      fingerprint: tokenRecord.token ? `sha256:${connectedHostOperatorTokenFingerprint(tokenRecord.token)}` : null,
      rawValueReturned: false,
    },
    companionPayloadReturned: false,
  };
}

export function pairingPostureCatalogStatus(context: CommandContext): Record<string, unknown> {
  const state = pairingState(context);
  return {
    modes: ['pairing_posture', 'pairing_route'],
    routes: pairingRoutes().length,
    tokenPresent: (state.token as { readonly present?: boolean }).present === true,
    readOnly: true,
  };
}

export function pairingPostureSummary(context: CommandContext, args: AgentHarnessPairingArgs): Record<string, unknown> {
  const query = readString(args.query).toLowerCase();
  const includeParameters = args.includeParameters === true;
  const routes = pairingRoutes();
  const filtered = routes
    .filter((route) => !query || routeSearchText(route).includes(query))
    .slice(0, readLimit(args.limit, 100));
  return {
    status: 'available',
    pairing: pairingState(context),
    routes: filtered.map((route) => describeRoute(route, { includeParameters })),
    returned: filtered.length,
    total: routes.length,
    policy: 'Read-only pairing posture. QR display, manual token display, companion connection, channel delivery, task, approval, provider/model, and attachment actions remain explicit visible user flows.',
  };
}

export function describeHarnessPairingRoute(_context: CommandContext, args: AgentHarnessPairingArgs): PairingResolution {
  const lookup = lookupFromArgs(args);
  if (!lookup) {
    return {
      status: 'missing_lookup',
      usage: 'pairing_route requires pairingRouteId, target, or query. Use mode:"pairing_posture" to inspect pairing route ids.',
    };
  }
  const routes = pairingRoutes();
  const normalized = lookup.input.toLowerCase();
  const exact = routes.find((route) => route.id === lookup.input);
  if (exact) return { status: 'found', route: describeRoute(exact, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'id' } }) };
  const insensitive = routes.find((route) => route.id.toLowerCase() === normalized);
  if (insensitive) return { status: 'found', route: describeRoute(insensitive, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-id' } }) };
  const searched = routes.filter((route) => routeSearchText(route).includes(normalized));
  if (searched.length === 1) return { status: 'found', route: describeRoute(searched[0]!, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'search' } }) };
  if (searched.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: searched.slice(0, 8).map(describeCandidate),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown pairing route ${lookup.input}. Use mode:"pairing_posture" to inspect pairing route ids.`,
  };
}
