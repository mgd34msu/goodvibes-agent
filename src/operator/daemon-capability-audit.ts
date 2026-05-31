import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { SDK_VERSION } from '../version.ts';
import type { AgentDaemonConnection } from '../agent/routine-schedule-promotion.ts';

export const DAEMON_METHOD_CATALOG_ROUTE = '/api/control-plane/methods';
export const AGENT_KNOWLEDGE_STATUS_ROUTE = '/api/goodvibes-agent/knowledge/status';
export const DAEMON_STATUS_ROUTE = '/status';

export type DaemonCapabilityAuditFailureKind =
  | 'auth_required'
  | 'daemon_unavailable'
  | 'version_mismatch'
  | 'daemon_route_unavailable'
  | 'daemon_error';

export type DaemonCapabilityCoverage = 'ready' | 'partial' | 'missing';
export type DaemonCapabilityRouteCoverage = 'ready' | 'missing' | 'not_checked';

export interface DaemonCapabilityRequirement {
  readonly id: string;
  readonly title: string;
  readonly competitorBaseline: string;
  readonly agentUse: string;
  readonly requiredMethodIds: readonly string[];
  readonly optionalMethodIds: readonly string[];
  readonly requiredAgentRoutes: readonly string[];
  readonly next: readonly string[];
}

export interface DaemonCapabilityAuditArea {
  readonly id: string;
  readonly title: string;
  readonly coverage: DaemonCapabilityCoverage;
  readonly competitorBaseline: string;
  readonly agentUse: string;
  readonly presentRequiredMethodIds: readonly string[];
  readonly missingRequiredMethodIds: readonly string[];
  readonly presentOptionalMethodIds: readonly string[];
  readonly missingOptionalMethodIds: readonly string[];
  readonly agentRoutes: readonly {
    readonly route: string;
    readonly coverage: DaemonCapabilityRouteCoverage;
  }[];
  readonly next: readonly string[];
}

export interface DaemonCapabilityAuditSuccess {
  readonly ok: true;
  readonly kind: 'daemon.capabilities.audit';
  readonly baseUrl: string;
  readonly daemonVersion: string;
  readonly expectedSdkVersion: string;
  readonly daemonCompatible: boolean;
  readonly methodCatalogRoute: typeof DAEMON_METHOD_CATALOG_ROUTE;
  readonly methodCount: number;
  readonly agentKnowledgeRoute: typeof AGENT_KNOWLEDGE_STATUS_ROUTE;
  readonly agentKnowledgeRouteReady: boolean;
  readonly defaultKnowledgeFallback: false;
  readonly homeGraphFallback: false;
  readonly warnings: readonly string[];
  readonly areas: readonly DaemonCapabilityAuditArea[];
}

export interface DaemonCapabilityAuditFailure {
  readonly ok: false;
  readonly kind: DaemonCapabilityAuditFailureKind;
  readonly error: string;
  readonly baseUrl: string;
  readonly route: string;
  readonly daemonVersion?: string;
  readonly expectedSdkVersion?: string;
}

export type DaemonCapabilityAuditResult =
  | DaemonCapabilityAuditSuccess
  | DaemonCapabilityAuditFailure;

interface DaemonMethodSummary {
  readonly id: string;
  readonly title?: string;
  readonly category?: string;
  readonly invokable?: boolean;
  readonly access?: string;
  readonly http?: {
    readonly method?: string;
    readonly path?: string;
  };
}

interface FetchJsonResult {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;
}

export const DAEMON_CAPABILITY_REQUIREMENTS: readonly DaemonCapabilityRequirement[] = [
  {
    id: 'gateway-control',
    title: 'Gateway Control Plane',
    competitorBaseline: 'OpenClaw/Hermes expose an always-on gateway with health, auth, method discovery, and events.',
    agentUse: 'Agent connects to the existing GoodVibes daemon, inspects posture, and never starts or owns daemon lifecycle.',
    requiredMethodIds: [
      'control.status',
      'control.auth.current',
      'control.methods.list',
      'control.contract',
      'control.snapshot',
    ],
    optionalMethodIds: ['control.clients.list', 'control.events.catalog', 'control.events.stream', 'control.web'],
    requiredAgentRoutes: [],
    next: ['Add richer first-run guidance when auth or route contract checks fail.'],
  },
  {
    id: 'chat-sessions',
    title: 'Companion Chat And Shared Sessions',
    competitorBaseline: 'Personal agents keep persistent chat and can route larger work through task/session surfaces.',
    agentUse: 'Agent uses companion.chat for normal turns and shared sessions only for explicit TUI build/fix/review delegation.',
    requiredMethodIds: [
      'companion.chat.sessions.create',
      'companion.chat.sessions.get',
      'companion.chat.sessions.list',
      'companion.chat.messages.create',
      'companion.chat.messages.list',
      'sessions.create',
      'sessions.messages.create',
      'sessions.list',
    ],
    optionalMethodIds: ['companion.chat.events.stream', 'sessions.followUp', 'sessions.steer', 'sessions.integration.snapshot'],
    requiredAgentRoutes: [],
    next: ['Expose delegated session artifacts and status in the operator workspace without making WRFC default.'],
  },
  {
    id: 'channels',
    title: 'Channels And Delivery Gateway',
    competitorBaseline: 'Gateway products receive and send across Slack, Discord, webhooks, mobile, and companion surfaces.',
    agentUse: 'Agent inspects channel readiness and uses explicit delivery targets for scheduled routine promotion.',
    requiredMethodIds: [
      'channels.status',
      'channels.capabilities.list',
      'channels.accounts.list',
      'channels.setup.get',
      'channels.doctor.get',
      'channels.actions.list',
      'channels.tools.list',
      'channels.targets.resolve',
      'channels.policies.list',
    ],
    optionalMethodIds: [
      'channels.directory.query',
      'channels.allowlist.resolve',
      'channels.policies.audit',
      'channels.agent_tools.list',
      'channels.authorize',
    ],
    requiredAgentRoutes: [],
    next: ['Surface live per-account delivery errors and setup repairs in the Agent workspace.'],
  },
  {
    id: 'agent-knowledge',
    title: 'Isolated Agent Knowledge',
    competitorBaseline: 'Persistent knowledge and memory are core personal-operator features.',
    agentUse: 'Agent Knowledge is a separate product segment under /api/goodvibes-agent/knowledge/* with no default wiki or HomeGraph fallback.',
    requiredMethodIds: [],
    optionalMethodIds: [],
    requiredAgentRoutes: [AGENT_KNOWLEDGE_STATUS_ROUTE],
    next: ['Add artifact and multimodal ingestion UX only against the isolated Agent Knowledge route family.'],
  },
  {
    id: 'automation-schedules',
    title: 'Automation, Schedules, Runs, And Capacity',
    competitorBaseline: 'Hermes/OpenClaw-style operators can schedule, run, pause, resume, and inspect recurring work.',
    agentUse: 'Agent observes automation and promotes local routines to daemon schedules only through explicit confirmed commands.',
    requiredMethodIds: [
      'automation.integration.snapshot',
      'automation.jobs.list',
      'automation.runs.list',
      'automation.heartbeat.list',
      'schedules.list',
      'schedules.create',
      'scheduler.capacity',
    ],
    optionalMethodIds: [
      'automation.jobs.run',
      'automation.jobs.pause',
      'automation.jobs.resume',
      'automation.runs.cancel',
      'automation.runs.retry',
      'schedules.run',
      'schedules.enable',
      'schedules.disable',
      'schedules.delete',
    ],
    requiredAgentRoutes: [],
    next: ['Add live delivery/run history and failed delivery diagnostics for promoted Agent routines.'],
  },
  {
    id: 'approvals-security',
    title: 'Approvals, Policy, And Channel Safety',
    competitorBaseline: 'Exposed agents need approval gates, pairing, allowlists, and policy inspection.',
    agentUse: 'Agent keeps destructive or external effects behind exact commands plus confirmation and uses daemon approvals.',
    requiredMethodIds: [
      'approvals.list',
      'approvals.approve',
      'approvals.deny',
      'approvals.cancel',
      'channels.policies.list',
      'channels.policies.audit',
    ],
    optionalMethodIds: ['approvals.claim', 'channels.allowlist.edit', 'channels.allowlist.resolve'],
    requiredAgentRoutes: [],
    next: ['Build a route-risk-aware approval center in the fullscreen Agent workspace.'],
  },
  {
    id: 'mcp-tools-artifacts',
    title: 'MCP, Tools, Artifacts, And Web Search',
    competitorBaseline: 'Modern personal operators expose managed tools, MCP servers, artifacts, and web/research tools.',
    agentUse: 'Agent uses GoodVibes daemon tool surfaces through public SDK contracts and policy-gated model visibility.',
    requiredMethodIds: [
      'mcp.config.get',
      'mcp.servers.list',
      'mcp.tools.list',
      'artifacts.create',
      'artifacts.get',
      'artifacts.list',
      'web_search.providers.list',
      'web_search.query',
    ],
    optionalMethodIds: ['artifacts.content.get', 'mcp.config.reload'],
    requiredAgentRoutes: [],
    next: ['Add per-turn tool-palette narrowing so broad tool capability does not create noisy model schemas.'],
  },
  {
    id: 'voice-media-nodes',
    title: 'Voice, Media, Multimodal, And Remote Nodes',
    competitorBaseline: 'OpenClaw/Hermes expose voice, media, mobile/node, and multimodal surfaces.',
    agentUse: 'Agent inspects daemon voice/media/remote readiness and keeps execution explicit or read-only until user-selected.',
    requiredMethodIds: [
      'voice.status',
      'voice.providers.list',
      'voice.voices.list',
      'voice.tts',
      'voice.stt',
      'media.providers.list',
      'media.analyze',
      'multimodal.providers.list',
      'remote.snapshot',
      'remote.peers.list',
      'remote.work.list',
      'remote.node_host.contract',
    ],
    optionalMethodIds: [
      'voice.realtime.session',
      'voice.tts.stream',
      'media.generate',
      'media.transform',
      'multimodal.analyze',
      'remote.peers.invoke',
    ],
    requiredAgentRoutes: [],
    next: ['Turn daemon readiness into Agent setup cards for voice, media, browser, and node workflows.'],
  },
  {
    id: 'providers-models',
    title: 'Providers, Models, And Usage',
    competitorBaseline: 'Personal operators need configurable providers, model routing, and usage posture.',
    agentUse: 'Agent reads daemon provider/model state, keeps provider+model routing explicit, and avoids per-message routing hacks.',
    requiredMethodIds: ['providers.list', 'providers.get', 'providers.usage.get'],
    optionalMethodIds: ['accounts.snapshot'],
    requiredAgentRoutes: [],
    next: ['Add provider/model readiness remediation directly into onboarding/config workspaces.'],
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function readMethodSummaries(body: unknown): readonly DaemonMethodSummary[] {
  const methods = isRecord(body) && Array.isArray(body.methods) ? body.methods : [];
  return methods.flatMap((value): DaemonMethodSummary[] => {
    if (!isRecord(value)) return [];
    const id = readString(value, 'id');
    if (!id) return [];
    const httpRecord = isRecord(value.http) ? value.http : null;
    return [{
      id,
      title: readString(value, 'title') ?? undefined,
      category: readString(value, 'category') ?? undefined,
      access: readString(value, 'access') ?? undefined,
      invokable: typeof value.invokable === 'boolean' ? value.invokable : undefined,
      http: httpRecord
        ? {
            method: readString(httpRecord, 'method') ?? undefined,
            path: readString(httpRecord, 'path') ?? undefined,
          }
        : undefined,
    }];
  });
}

function daemonVersionFromStatus(body: unknown): string {
  if (!isRecord(body)) return 'unknown';
  return readString(body, 'version')
    ?? readString(body, 'sdkVersion')
    ?? 'unknown';
}

function buildHeaders(connection: AgentDaemonConnection): Headers {
  const headers = new Headers({ accept: 'application/json' });
  if (connection.token) headers.set('authorization', `Bearer ${connection.token}`);
  return headers;
}

async function fetchJson(connection: AgentDaemonConnection, route: string): Promise<FetchJsonResult> {
  const response = await fetch(`${connection.baseUrl}${route}`, {
    method: 'GET',
    headers: buildHeaders(connection),
  });
  const text = await response.text();
  let body: unknown = text;
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body,
  };
}

function failureFromResponse(
  response: FetchJsonResult,
  connection: AgentDaemonConnection,
  route: string,
  daemonVersion: string,
): DaemonCapabilityAuditFailure {
  const detail = isRecord(response.body) && typeof response.body.error === 'string'
    ? response.body.error
    : typeof response.body === 'string'
      ? response.body
      : response.statusText;
  const error = `HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
  if (response.status === 401 || response.status === 403) {
    return { ok: false, kind: 'auth_required', error, baseUrl: connection.baseUrl, route };
  }
  if (response.status === 404 && daemonVersion !== 'unknown' && daemonVersion !== SDK_VERSION) {
    return {
      ok: false,
      kind: 'version_mismatch',
      error: `External daemon SDK version ${daemonVersion} does not match Agent SDK pin ${SDK_VERSION}; ${route} is unavailable.`,
      baseUrl: connection.baseUrl,
      route,
      daemonVersion,
      expectedSdkVersion: SDK_VERSION,
    };
  }
  if (response.status === 404) {
    return { ok: false, kind: 'daemon_route_unavailable', error, baseUrl: connection.baseUrl, route };
  }
  return { ok: false, kind: 'daemon_error', error, baseUrl: connection.baseUrl, route };
}

function failureFromThrown(error: unknown, connection: AgentDaemonConnection, route: string): DaemonCapabilityAuditFailure {
  const message = summarizeError(error);
  const lower = message.toLowerCase();
  if (lower.includes('unauthorized') || lower.includes('401') || lower.includes('403')) {
    return { ok: false, kind: 'auth_required', error: message, baseUrl: connection.baseUrl, route };
  }
  if (lower.includes('fetch') || lower.includes('connect') || lower.includes('econnrefused')) {
    return { ok: false, kind: 'daemon_unavailable', error: message, baseUrl: connection.baseUrl, route };
  }
  if (lower.includes('404') || lower.includes('not found')) {
    return { ok: false, kind: 'daemon_route_unavailable', error: message, baseUrl: connection.baseUrl, route };
  }
  return { ok: false, kind: 'daemon_error', error: message, baseUrl: connection.baseUrl, route };
}

export function buildDaemonCapabilityAuditAreas(
  methodIds: ReadonlySet<string>,
  agentKnowledgeRouteReady: boolean | null,
): readonly DaemonCapabilityAuditArea[] {
  return DAEMON_CAPABILITY_REQUIREMENTS.map((requirement) => {
    const presentRequiredMethodIds = requirement.requiredMethodIds.filter((methodId) => methodIds.has(methodId));
    const missingRequiredMethodIds = requirement.requiredMethodIds.filter((methodId) => !methodIds.has(methodId));
    const presentOptionalMethodIds = requirement.optionalMethodIds.filter((methodId) => methodIds.has(methodId));
    const missingOptionalMethodIds = requirement.optionalMethodIds.filter((methodId) => !methodIds.has(methodId));
    const agentRoutes = requirement.requiredAgentRoutes.map((route) => ({
      route,
      coverage: agentKnowledgeRouteReady === null
        ? 'not_checked'
        : agentKnowledgeRouteReady
          ? 'ready'
          : 'missing',
    } satisfies DaemonCapabilityAuditArea['agentRoutes'][number]));
    const missingAgentRoutes = agentRoutes.filter((route) => route.coverage === 'missing');
    const requiredCount = requirement.requiredMethodIds.length + requirement.requiredAgentRoutes.length;
    const presentRequiredCount = presentRequiredMethodIds.length
      + agentRoutes.filter((route) => route.coverage === 'ready').length;
    const coverage: DaemonCapabilityCoverage = requiredCount === presentRequiredCount
      ? 'ready'
      : presentRequiredCount > 0 && missingRequiredMethodIds.length + missingAgentRoutes.length < requiredCount
        ? 'partial'
        : 'missing';
    return {
      id: requirement.id,
      title: requirement.title,
      coverage,
      competitorBaseline: requirement.competitorBaseline,
      agentUse: requirement.agentUse,
      presentRequiredMethodIds,
      missingRequiredMethodIds,
      presentOptionalMethodIds,
      missingOptionalMethodIds,
      agentRoutes,
      next: requirement.next,
    };
  });
}

export async function fetchLiveDaemonCapabilityAudit(
  connection: AgentDaemonConnection,
): Promise<DaemonCapabilityAuditResult> {
  let daemonVersion = 'unknown';
  try {
    const status = await fetchJson(connection, DAEMON_STATUS_ROUTE);
    if (status.ok) {
      daemonVersion = daemonVersionFromStatus(status.body);
    } else if (status.status === 401 || status.status === 403) {
      return failureFromResponse(status, connection, DAEMON_STATUS_ROUTE, daemonVersion);
    }

    const methods = await fetchJson(connection, DAEMON_METHOD_CATALOG_ROUTE);
    if (!methods.ok) return failureFromResponse(methods, connection, DAEMON_METHOD_CATALOG_ROUTE, daemonVersion);

    const methodSummaries = readMethodSummaries(methods.body);
    const methodIds = new Set(methodSummaries.map((method) => method.id));
    const warnings: string[] = [];
    const daemonCompatible = daemonVersion === SDK_VERSION;
    if (daemonVersion !== 'unknown' && !daemonCompatible) {
      warnings.push(`External daemon SDK version ${daemonVersion} does not match Agent SDK pin ${SDK_VERSION}.`);
    }

    const agentKnowledge = await fetchJson(connection, AGENT_KNOWLEDGE_STATUS_ROUTE);
    if (!agentKnowledge.ok) {
      const failure = failureFromResponse(agentKnowledge, connection, AGENT_KNOWLEDGE_STATUS_ROUTE, daemonVersion);
      if (failure.kind === 'auth_required') return failure;
      warnings.push(`${AGENT_KNOWLEDGE_STATUS_ROUTE} is not ready: ${failure.error}`);
    }

    return {
      ok: true,
      kind: 'daemon.capabilities.audit',
      baseUrl: connection.baseUrl,
      daemonVersion,
      expectedSdkVersion: SDK_VERSION,
      daemonCompatible,
      methodCatalogRoute: DAEMON_METHOD_CATALOG_ROUTE,
      methodCount: methodSummaries.length,
      agentKnowledgeRoute: AGENT_KNOWLEDGE_STATUS_ROUTE,
      agentKnowledgeRouteReady: agentKnowledge.ok,
      defaultKnowledgeFallback: false,
      homeGraphFallback: false,
      warnings,
      areas: buildDaemonCapabilityAuditAreas(methodIds, agentKnowledge.ok),
    };
  } catch (error) {
    return failureFromThrown(error, connection, daemonVersion === 'unknown' ? DAEMON_STATUS_ROUTE : DAEMON_METHOD_CATALOG_ROUTE);
  }
}

export function filterDaemonCapabilityAuditAreas(
  areas: readonly DaemonCapabilityAuditArea[],
  query: string | undefined,
): readonly DaemonCapabilityAuditArea[] {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return areas;
  return areas.filter((area) => {
    if (area.id.includes(normalized)) return true;
    if (area.title.toLowerCase().includes(normalized)) return true;
    if (area.coverage.includes(normalized)) return true;
    if (area.agentUse.toLowerCase().includes(normalized)) return true;
    return area.presentRequiredMethodIds.some((methodId) => methodId.includes(normalized))
      || area.missingRequiredMethodIds.some((methodId) => methodId.includes(normalized))
      || area.presentOptionalMethodIds.some((methodId) => methodId.includes(normalized))
      || area.missingOptionalMethodIds.some((methodId) => methodId.includes(normalized))
      || area.agentRoutes.some((route) => route.route.toLowerCase().includes(normalized));
  });
}

export function renderDaemonCapabilityAudit(
  audit: DaemonCapabilityAuditSuccess,
  areas: readonly DaemonCapabilityAuditArea[] = audit.areas,
): string {
  const lines: string[] = [
    'GoodVibes daemon capability audit',
    `  daemon: ${audit.baseUrl}`,
    `  SDK: Agent expects ${audit.expectedSdkVersion}; daemon reports ${audit.daemonVersion}`,
    `  compatibility: ${audit.daemonCompatible ? 'matched' : 'mismatch'}`,
    `  method catalog: ${audit.methodCount} methods from ${audit.methodCatalogRoute}`,
    `  Agent Knowledge: ${audit.agentKnowledgeRouteReady ? 'ready' : 'missing'} ${audit.agentKnowledgeRoute}`,
    '  isolation: default Knowledge/Wiki fallback no; HomeGraph fallback no',
    '',
  ];

  for (const warning of audit.warnings) lines.push(`  warning: ${warning}`);
  if (audit.warnings.length > 0) lines.push('');

  for (const area of areas) {
    const requiredTotal = area.presentRequiredMethodIds.length + area.missingRequiredMethodIds.length;
    const optionalTotal = area.presentOptionalMethodIds.length + area.missingOptionalMethodIds.length;
    lines.push(`${area.title} [${area.coverage}]`);
    lines.push(`  baseline: ${area.competitorBaseline}`);
    lines.push(`  Agent use: ${area.agentUse}`);
    lines.push(`  required methods: ${area.presentRequiredMethodIds.length}/${requiredTotal}`);
    if (area.missingRequiredMethodIds.length > 0) lines.push(`  missing required: ${area.missingRequiredMethodIds.join(', ')}`);
    if (optionalTotal > 0) {
      lines.push(`  optional methods: ${area.presentOptionalMethodIds.length}/${optionalTotal}`);
      if (area.missingOptionalMethodIds.length > 0) lines.push(`  missing optional: ${area.missingOptionalMethodIds.join(', ')}`);
    }
    for (const route of area.agentRoutes) lines.push(`  route: ${route.route} [${route.coverage}]`);
    lines.push(`  next: ${area.next.join(' | ')}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function renderDaemonCapabilityFailure(failure: DaemonCapabilityAuditFailure): string {
  const details = [
    `GoodVibes daemon capability audit failed [${failure.kind}]`,
    `  daemon: ${failure.baseUrl}`,
    `  route: ${failure.route}`,
    `  error: ${failure.error}`,
  ];
  if (failure.daemonVersion || failure.expectedSdkVersion) {
    details.push(`  SDK: Agent expects ${failure.expectedSdkVersion ?? SDK_VERSION}; daemon reports ${failure.daemonVersion ?? 'unknown'}`);
  }
  if (failure.kind === 'auth_required') details.push('  next: authenticate the Agent against the existing GoodVibes daemon; no token value was printed.');
  if (failure.kind === 'daemon_unavailable') details.push('  next: start or reconnect the external GoodVibes daemon; Agent will not start it.');
  if (failure.kind === 'version_mismatch') details.push('  next: update/restart the externally owned daemon to match the Agent SDK pin.');
  if (failure.kind === 'daemon_route_unavailable') details.push('  next: verify the external daemon exposes the published SDK/operator routes.');
  return details.join('\n');
}
