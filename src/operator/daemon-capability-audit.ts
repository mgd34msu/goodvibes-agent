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
export type DaemonCapabilityGapKind =
  | 'version_mismatch'
  | 'agent_route_missing'
  | 'required_method_missing'
  | 'route_risk_review'
  | 'agent_ux_gap';
export type DaemonCapabilityGapSeverity = 'blocker' | 'high' | 'medium' | 'low';

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
  readonly routeRisk: {
    readonly readOnlyMethodIds: readonly string[];
    readonly mutatingMethodIds: readonly string[];
    readonly authenticatedMethodIds: readonly string[];
    readonly readOnlyMethodCount: number;
    readonly mutatingMethodCount: number;
    readonly authenticatedMethodCount: number;
    readonly dangerousMethodIds: readonly string[];
  };
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

export interface DaemonCapabilityGap {
  readonly id: string;
  readonly kind: DaemonCapabilityGapKind;
  readonly severity: DaemonCapabilityGapSeverity;
  readonly areaId?: string;
  readonly title: string;
  readonly detail: string;
  readonly action: string;
}

export interface DaemonCapabilityGapReport {
  readonly ok: true;
  readonly kind: 'daemon.capabilities.gaps';
  readonly baseUrl: string;
  readonly daemonVersion: string;
  readonly expectedSdkVersion: string;
  readonly daemonCompatible: boolean;
  readonly methodCatalogRoute: typeof DAEMON_METHOD_CATALOG_ROUTE;
  readonly agentKnowledgeRoute: typeof AGENT_KNOWLEDGE_STATUS_ROUTE;
  readonly agentKnowledgeRouteReady: boolean;
  readonly defaultKnowledgeFallback: false;
  readonly homeGraphFallback: false;
  readonly gapCount: number;
  readonly gaps: readonly DaemonCapabilityGap[];
}

export interface DaemonCapabilityRouteRiskArea {
  readonly areaId: string;
  readonly title: string;
  readonly coverage: DaemonCapabilityCoverage;
  readonly readOnlyMethodIds: readonly string[];
  readonly mutatingMethodIds: readonly string[];
  readonly authenticatedMethodIds: readonly string[];
  readonly readOnlyMethodCount: number;
  readonly mutatingMethodCount: number;
  readonly authenticatedMethodCount: number;
  readonly dangerousMethodIds: readonly string[];
}

export interface DaemonCapabilityRouteRiskReport {
  readonly ok: true;
  readonly kind: 'daemon.capabilities.route_risk';
  readonly baseUrl: string;
  readonly daemonVersion: string;
  readonly expectedSdkVersion: string;
  readonly daemonCompatible: boolean;
  readonly methodCatalogRoute: typeof DAEMON_METHOD_CATALOG_ROUTE;
  readonly agentKnowledgeRoute: typeof AGENT_KNOWLEDGE_STATUS_ROUTE;
  readonly agentKnowledgeRouteReady: boolean;
  readonly defaultKnowledgeFallback: false;
  readonly homeGraphFallback: false;
  readonly totalReadOnlyMethodCount: number;
  readonly totalMutatingMethodCount: number;
  readonly totalAuthenticatedMethodCount: number;
  readonly totalDangerousMethodCount: number;
  readonly areas: readonly DaemonCapabilityRouteRiskArea[];
}

export interface DaemonCapabilityInventoryMethod {
  readonly id: string;
  readonly title?: string;
  readonly category: string;
  readonly access: string;
  readonly invokable: boolean | null;
  readonly dangerous: boolean;
  readonly httpMethod: string;
  readonly path?: string;
  readonly readOnly: boolean;
  readonly mutating: boolean;
}

export interface DaemonCapabilityInventoryGroup {
  readonly category: string;
  readonly methodCount: number;
  readonly readOnlyMethodCount: number;
  readonly mutatingMethodCount: number;
  readonly authenticatedMethodCount: number;
  readonly dangerousMethodCount: number;
  readonly methods: readonly DaemonCapabilityInventoryMethod[];
}

export interface DaemonCapabilityInventoryReport {
  readonly ok: true;
  readonly kind: 'daemon.capabilities.inventory';
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
  readonly readOnlyMethodCount: number;
  readonly mutatingMethodCount: number;
  readonly authenticatedMethodCount: number;
  readonly dangerousMethodCount: number;
  readonly accessCounts: readonly {
    readonly access: string;
    readonly count: number;
  }[];
  readonly groups: readonly DaemonCapabilityInventoryGroup[];
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

export interface DaemonMethodSummary {
  readonly id: string;
  readonly title?: string;
  readonly category?: string;
  readonly invokable?: boolean;
  readonly access?: string;
  readonly dangerous?: boolean;
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
      dangerous: typeof value.dangerous === 'boolean' ? value.dangerous : undefined,
      http: httpRecord
        ? {
            method: readString(httpRecord, 'method') ?? undefined,
            path: readString(httpRecord, 'path') ?? undefined,
          }
        : undefined,
    }];
  });
}

function normalizeMethodCategory(method: DaemonMethodSummary): string {
  const category = method.category?.trim();
  if (category) return category;
  const [prefix] = method.id.split('.');
  return prefix || 'uncategorized';
}

function normalizeAccess(method: DaemonMethodSummary): string {
  const access = method.access?.trim();
  return access || 'unknown';
}

function normalizeHttpMethod(method: DaemonMethodSummary): string {
  return method.http?.method?.trim().toUpperCase() || 'UNKNOWN';
}

function isReadOnlyHttpMethod(httpMethod: string): boolean {
  return httpMethod === 'GET' || httpMethod === 'HEAD';
}

function compareInventoryMethods(left: DaemonCapabilityInventoryMethod, right: DaemonCapabilityInventoryMethod): number {
  return left.id.localeCompare(right.id);
}

function compareInventoryGroups(left: DaemonCapabilityInventoryGroup, right: DaemonCapabilityInventoryGroup): number {
  const countDelta = right.methodCount - left.methodCount;
  if (countDelta !== 0) return countDelta;
  return left.category.localeCompare(right.category);
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
  methodSummaries: readonly DaemonMethodSummary[] = [],
): readonly DaemonCapabilityAuditArea[] {
  const methodsById = new Map(methodSummaries.map((method) => [method.id, method]));
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
    const areaMethodIds = [...requirement.requiredMethodIds, ...requirement.optionalMethodIds];
    const areaMethods = areaMethodIds.flatMap((methodId): DaemonMethodSummary[] => {
      const method = methodsById.get(methodId);
      return method ? [method] : [];
    });
    const readOnlyMethodIds = areaMethods.filter((method) => {
      const verb = method.http?.method?.toUpperCase();
      return verb === 'GET' || verb === 'HEAD';
    }).map((method) => method.id);
    const mutatingMethodIds = areaMethods.filter((method) => {
      const verb = method.http?.method?.toUpperCase();
      return Boolean(verb) && verb !== 'GET' && verb !== 'HEAD';
    }).map((method) => method.id);
    const authenticatedMethodIds = areaMethods
      .filter((method) => method.access === 'authenticated')
      .map((method) => method.id);
    const dangerousMethodIds = areaMethods
      .filter((method) => method.dangerous === true)
      .map((method) => method.id);
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
      routeRisk: {
        readOnlyMethodIds,
        mutatingMethodIds,
        authenticatedMethodIds,
        readOnlyMethodCount: readOnlyMethodIds.length,
        mutatingMethodCount: mutatingMethodIds.length,
        authenticatedMethodCount: authenticatedMethodIds.length,
        dangerousMethodIds,
      },
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
      areas: buildDaemonCapabilityAuditAreas(methodIds, agentKnowledge.ok, methodSummaries),
    };
  } catch (error) {
    return failureFromThrown(error, connection, daemonVersion === 'unknown' ? DAEMON_STATUS_ROUTE : DAEMON_METHOD_CATALOG_ROUTE);
  }
}

export function buildDaemonCapabilityInventoryReport(
  connection: AgentDaemonConnection,
  daemonVersion: string,
  agentKnowledgeRouteReady: boolean,
  methodSummaries: readonly DaemonMethodSummary[],
): DaemonCapabilityInventoryReport {
  const methods = methodSummaries.map((method): DaemonCapabilityInventoryMethod => {
    const httpMethod = normalizeHttpMethod(method);
    const readOnly = isReadOnlyHttpMethod(httpMethod);
    return {
      id: method.id,
      title: method.title,
      category: normalizeMethodCategory(method),
      access: normalizeAccess(method),
      invokable: typeof method.invokable === 'boolean' ? method.invokable : null,
      dangerous: method.dangerous === true,
      httpMethod,
      path: method.http?.path,
      readOnly,
      mutating: httpMethod !== 'UNKNOWN' && !readOnly,
    };
  }).sort(compareInventoryMethods);

  const groupsByCategory = new Map<string, DaemonCapabilityInventoryMethod[]>();
  for (const method of methods) {
    const existing = groupsByCategory.get(method.category) ?? [];
    existing.push(method);
    groupsByCategory.set(method.category, existing);
  }

  const groups = [...groupsByCategory.entries()].map(([category, categoryMethods]): DaemonCapabilityInventoryGroup => ({
    category,
    methodCount: categoryMethods.length,
    readOnlyMethodCount: categoryMethods.filter((method) => method.readOnly).length,
    mutatingMethodCount: categoryMethods.filter((method) => method.mutating).length,
    authenticatedMethodCount: categoryMethods.filter((method) => method.access === 'authenticated').length,
    dangerousMethodCount: categoryMethods.filter((method) => method.dangerous).length,
    methods: categoryMethods,
  })).sort(compareInventoryGroups);

  const accessEntries = new Map<string, number>();
  for (const method of methods) {
    accessEntries.set(method.access, (accessEntries.get(method.access) ?? 0) + 1);
  }
  const accessCounts = [...accessEntries.entries()]
    .map(([access, count]) => ({ access, count }))
    .sort((left, right) => {
      const countDelta = right.count - left.count;
      if (countDelta !== 0) return countDelta;
      return left.access.localeCompare(right.access);
    });

  return {
    ok: true,
    kind: 'daemon.capabilities.inventory',
    baseUrl: connection.baseUrl,
    daemonVersion,
    expectedSdkVersion: SDK_VERSION,
    daemonCompatible: daemonVersion === SDK_VERSION,
    methodCatalogRoute: DAEMON_METHOD_CATALOG_ROUTE,
    methodCount: methods.length,
    agentKnowledgeRoute: AGENT_KNOWLEDGE_STATUS_ROUTE,
    agentKnowledgeRouteReady,
    defaultKnowledgeFallback: false,
    homeGraphFallback: false,
    readOnlyMethodCount: methods.filter((method) => method.readOnly).length,
    mutatingMethodCount: methods.filter((method) => method.mutating).length,
    authenticatedMethodCount: methods.filter((method) => method.access === 'authenticated').length,
    dangerousMethodCount: methods.filter((method) => method.dangerous).length,
    accessCounts,
    groups,
  };
}

export type DaemonCapabilityInventoryResult =
  | DaemonCapabilityInventoryReport
  | DaemonCapabilityAuditFailure;

export async function fetchLiveDaemonCapabilityInventory(
  connection: AgentDaemonConnection,
): Promise<DaemonCapabilityInventoryResult> {
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

    const agentKnowledge = await fetchJson(connection, AGENT_KNOWLEDGE_STATUS_ROUTE);
    if (!agentKnowledge.ok) {
      const failure = failureFromResponse(agentKnowledge, connection, AGENT_KNOWLEDGE_STATUS_ROUTE, daemonVersion);
      if (failure.kind === 'auth_required') return failure;
    }

    return buildDaemonCapabilityInventoryReport(
      connection,
      daemonVersion,
      agentKnowledge.ok,
      readMethodSummaries(methods.body),
    );
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

function gapToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'gap';
}

function gapSeverityRank(severity: DaemonCapabilityGapSeverity): number {
  if (severity === 'blocker') return 0;
  if (severity === 'high') return 1;
  if (severity === 'medium') return 2;
  return 3;
}

function sortCapabilityGaps(gaps: readonly DaemonCapabilityGap[]): readonly DaemonCapabilityGap[] {
  return [...gaps].sort((left, right) => {
    const severityDelta = gapSeverityRank(left.severity) - gapSeverityRank(right.severity);
    if (severityDelta !== 0) return severityDelta;
    return left.id.localeCompare(right.id);
  });
}

export function buildDaemonCapabilityGapReport(
  audit: DaemonCapabilityAuditSuccess,
  areas: readonly DaemonCapabilityAuditArea[] = audit.areas,
): DaemonCapabilityGapReport {
  const gaps: DaemonCapabilityGap[] = [];

  if (!audit.daemonCompatible) {
    gaps.push({
      id: 'daemon-version-mismatch',
      kind: 'version_mismatch',
      severity: audit.agentKnowledgeRouteReady ? 'high' : 'blocker',
      title: 'Daemon SDK version does not match Agent SDK pin',
      detail: `Agent expects ${audit.expectedSdkVersion}; daemon reports ${audit.daemonVersion}.`,
      action: 'Update/restart the externally owned GoodVibes daemon before release validation; Agent will not start it.',
    });
  }

  for (const area of areas) {
    if (area.missingRequiredMethodIds.length > 0) {
      gaps.push({
        id: `${area.id}-missing-required-methods`,
        kind: 'required_method_missing',
        severity: 'high',
        areaId: area.id,
        title: `${area.title} missing required daemon methods`,
        detail: area.missingRequiredMethodIds.join(', '),
        action: 'Keep the Agent surface read-only or blocked for this area until the public daemon route contract is present.',
      });
    }

    for (const route of area.agentRoutes) {
      if (route.coverage !== 'missing') continue;
      gaps.push({
        id: `${area.id}-missing-${gapToken(route.route)}`,
        kind: 'agent_route_missing',
        severity: route.route === AGENT_KNOWLEDGE_STATUS_ROUTE ? 'blocker' : 'high',
        areaId: area.id,
        title: `${area.title} missing Agent route`,
        detail: route.route,
        action: 'Fail closed for this product segment. Do not query default Knowledge/Wiki, HomeGraph, or Home Assistant routes.',
      });
    }

    if (area.routeRisk.dangerousMethodIds.length > 0) {
      gaps.push({
        id: `${area.id}-dangerous-route-review`,
        kind: 'route_risk_review',
        severity: 'medium',
        areaId: area.id,
        title: `${area.title} has dangerous daemon routes`,
        detail: area.routeRisk.dangerousMethodIds.join(', '),
        action: 'Keep these routes behind exact commands, confirmation, and concise approval UX; never trigger them from ordinary chat.',
      });
    }

    for (const next of area.next) {
      gaps.push({
        id: `${area.id}-agent-ux-${gapToken(next)}`,
        kind: 'agent_ux_gap',
        severity: area.coverage === 'ready' ? 'medium' : 'low',
        areaId: area.id,
        title: `${area.title} Agent UX gap`,
        detail: next,
        action: 'Build a first-class Agent workspace, command, or setup flow on top of the existing daemon capability.',
      });
    }
  }

  const sortedGaps = sortCapabilityGaps(gaps);
  return {
    ok: true,
    kind: 'daemon.capabilities.gaps',
    baseUrl: audit.baseUrl,
    daemonVersion: audit.daemonVersion,
    expectedSdkVersion: audit.expectedSdkVersion,
    daemonCompatible: audit.daemonCompatible,
    methodCatalogRoute: audit.methodCatalogRoute,
    agentKnowledgeRoute: audit.agentKnowledgeRoute,
    agentKnowledgeRouteReady: audit.agentKnowledgeRouteReady,
    defaultKnowledgeFallback: false,
    homeGraphFallback: false,
    gapCount: sortedGaps.length,
    gaps: sortedGaps,
  };
}

export function filterDaemonCapabilityGaps(
  gaps: readonly DaemonCapabilityGap[],
  query: string | undefined,
): readonly DaemonCapabilityGap[] {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return gaps;
  return gaps.filter((gap) => {
    return gap.id.includes(normalized)
      || gap.kind.includes(normalized)
      || gap.severity.includes(normalized)
      || gap.title.toLowerCase().includes(normalized)
      || gap.detail.toLowerCase().includes(normalized)
      || gap.action.toLowerCase().includes(normalized)
      || Boolean(gap.areaId?.includes(normalized));
  });
}

export function renderDaemonCapabilityGaps(
  report: DaemonCapabilityGapReport,
  gaps: readonly DaemonCapabilityGap[] = report.gaps,
): string {
  const lines: string[] = [
    'GoodVibes daemon capability gaps',
    `  daemon: ${report.baseUrl}`,
    `  SDK: Agent expects ${report.expectedSdkVersion}; daemon reports ${report.daemonVersion}`,
    `  compatibility: ${report.daemonCompatible ? 'matched' : 'mismatch'}`,
    `  Agent Knowledge: ${report.agentKnowledgeRouteReady ? 'ready' : 'missing'} ${report.agentKnowledgeRoute}`,
    '  isolation: default Knowledge/Wiki fallback no; HomeGraph fallback no',
    `  gaps: ${gaps.length}/${report.gapCount}`,
    '',
  ];

  if (gaps.length === 0) {
    lines.push('No daemon capability gaps matched this query.');
    return lines.join('\n');
  }

  for (const gap of gaps) {
    lines.push(`${gap.title} [${gap.severity}; ${gap.kind}]`);
    if (gap.areaId) lines.push(`  area: ${gap.areaId}`);
    lines.push(`  detail: ${gap.detail}`);
    lines.push(`  action: ${gap.action}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function buildDaemonCapabilityRouteRiskReport(
  audit: DaemonCapabilityAuditSuccess,
  areas: readonly DaemonCapabilityAuditArea[] = audit.areas,
): DaemonCapabilityRouteRiskReport {
  const riskAreas = areas.map((area): DaemonCapabilityRouteRiskArea => ({
    areaId: area.id,
    title: area.title,
    coverage: area.coverage,
    readOnlyMethodIds: area.routeRisk.readOnlyMethodIds,
    mutatingMethodIds: area.routeRisk.mutatingMethodIds,
    authenticatedMethodIds: area.routeRisk.authenticatedMethodIds,
    readOnlyMethodCount: area.routeRisk.readOnlyMethodCount,
    mutatingMethodCount: area.routeRisk.mutatingMethodCount,
    authenticatedMethodCount: area.routeRisk.authenticatedMethodCount,
    dangerousMethodIds: area.routeRisk.dangerousMethodIds,
  }));
  const readOnlyMethodIds = new Set(riskAreas.flatMap((area) => area.readOnlyMethodIds));
  const mutatingMethodIds = new Set(riskAreas.flatMap((area) => area.mutatingMethodIds));
  const authenticatedMethodIds = new Set(riskAreas.flatMap((area) => area.authenticatedMethodIds));
  const dangerousMethodIds = new Set(riskAreas.flatMap((area) => area.dangerousMethodIds));

  return {
    ok: true,
    kind: 'daemon.capabilities.route_risk',
    baseUrl: audit.baseUrl,
    daemonVersion: audit.daemonVersion,
    expectedSdkVersion: audit.expectedSdkVersion,
    daemonCompatible: audit.daemonCompatible,
    methodCatalogRoute: audit.methodCatalogRoute,
    agentKnowledgeRoute: audit.agentKnowledgeRoute,
    agentKnowledgeRouteReady: audit.agentKnowledgeRouteReady,
    defaultKnowledgeFallback: false,
    homeGraphFallback: false,
    totalReadOnlyMethodCount: readOnlyMethodIds.size,
    totalMutatingMethodCount: mutatingMethodIds.size,
    totalAuthenticatedMethodCount: authenticatedMethodIds.size,
    totalDangerousMethodCount: dangerousMethodIds.size,
    areas: riskAreas,
  };
}

export function filterDaemonCapabilityRouteRiskAreas(
  areas: readonly DaemonCapabilityRouteRiskArea[],
  query: string | undefined,
): readonly DaemonCapabilityRouteRiskArea[] {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return areas;
  return areas.filter((area) => {
    return area.areaId.includes(normalized)
      || area.title.toLowerCase().includes(normalized)
      || area.coverage.includes(normalized)
      || area.dangerousMethodIds.some((methodId) => methodId.includes(normalized));
  });
}

export function renderDaemonCapabilityRouteRisk(
  report: DaemonCapabilityRouteRiskReport,
  areas: readonly DaemonCapabilityRouteRiskArea[] = report.areas,
): string {
  const lines: string[] = [
    'GoodVibes daemon route risk review',
    `  daemon: ${report.baseUrl}`,
    `  SDK: Agent expects ${report.expectedSdkVersion}; daemon reports ${report.daemonVersion}`,
    `  compatibility: ${report.daemonCompatible ? 'matched' : 'mismatch'}`,
    `  method catalog: ${report.methodCatalogRoute}`,
    `  Agent Knowledge: ${report.agentKnowledgeRouteReady ? 'ready' : 'missing'} ${report.agentKnowledgeRoute}`,
    '  isolation: default Knowledge/Wiki fallback no; HomeGraph fallback no',
    `  totals: ${report.totalReadOnlyMethodCount} read-only; ${report.totalMutatingMethodCount} mutating; ${report.totalDangerousMethodCount} dangerous; ${report.totalAuthenticatedMethodCount} authenticated`,
    '  policy: exact command plus confirmation for side effects; ordinary chat never triggers mutating routes',
    '',
  ];

  const visibleAreas = areas.filter((area) => {
    return area.readOnlyMethodCount > 0
      || area.mutatingMethodCount > 0
      || area.authenticatedMethodCount > 0
      || area.dangerousMethodIds.length > 0;
  });
  if (visibleAreas.length === 0) {
    lines.push('No route risk metadata matched this query.');
    return lines.join('\n');
  }

  for (const area of visibleAreas) {
    lines.push(`${area.title} [${area.coverage}]`);
    lines.push(`  methods: ${area.readOnlyMethodCount} read-only; ${area.mutatingMethodCount} mutating; ${area.dangerousMethodIds.length} dangerous; ${area.authenticatedMethodCount} authenticated`);
    if (area.dangerousMethodIds.length > 0) {
      lines.push(`  dangerous methods: ${area.dangerousMethodIds.join(', ')}`);
    }
    lines.push('  approval posture: read-only by default; exact command and confirmation required for side effects.');
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function filterDaemonCapabilityInventoryGroups(
  groups: readonly DaemonCapabilityInventoryGroup[],
  query: string | undefined,
): readonly DaemonCapabilityInventoryGroup[] {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return groups;
  return groups.flatMap((group): DaemonCapabilityInventoryGroup[] => {
    const categoryMatches = group.category.toLowerCase().includes(normalized);
    const methods = categoryMatches
      ? group.methods
      : group.methods.filter((method) => {
          return method.id.toLowerCase().includes(normalized)
            || method.title?.toLowerCase().includes(normalized) === true
            || method.access.toLowerCase().includes(normalized)
            || method.httpMethod.toLowerCase().includes(normalized)
            || method.path?.toLowerCase().includes(normalized) === true;
        });
    if (methods.length === 0) return [];
    return [{
      category: group.category,
      methodCount: methods.length,
      readOnlyMethodCount: methods.filter((method) => method.readOnly).length,
      mutatingMethodCount: methods.filter((method) => method.mutating).length,
      authenticatedMethodCount: methods.filter((method) => method.access === 'authenticated').length,
      dangerousMethodCount: methods.filter((method) => method.dangerous).length,
      methods,
    }];
  });
}

function renderInventoryMethod(method: DaemonCapabilityInventoryMethod): string {
  const risk = method.dangerous
    ? ' dangerous'
    : method.mutating
      ? ' mutating'
      : ' read-only';
  const route = method.path ? ` ${method.httpMethod} ${method.path}` : ` ${method.httpMethod}`;
  return `    ${method.id} [${method.access};${risk}]${route}`;
}

export function renderDaemonCapabilityInventory(
  report: DaemonCapabilityInventoryReport,
  groups: readonly DaemonCapabilityInventoryGroup[] = report.groups,
): string {
  const lines: string[] = [
    'GoodVibes daemon method inventory',
    `  daemon: ${report.baseUrl}`,
    `  SDK: Agent expects ${report.expectedSdkVersion}; daemon reports ${report.daemonVersion}`,
    `  compatibility: ${report.daemonCompatible ? 'matched' : 'mismatch'}`,
    `  method catalog: ${report.methodCount} methods from ${report.methodCatalogRoute}`,
    `  Agent Knowledge: ${report.agentKnowledgeRouteReady ? 'ready' : 'missing'} ${report.agentKnowledgeRoute}`,
    '  isolation: default Knowledge/Wiki fallback no; HomeGraph fallback no',
    `  totals: ${report.readOnlyMethodCount} read-only; ${report.mutatingMethodCount} mutating; ${report.dangerousMethodCount} dangerous; ${report.authenticatedMethodCount} authenticated`,
    `  access: ${report.accessCounts.map((entry) => `${entry.access} ${entry.count}`).join('; ') || 'none'}`,
    '',
  ];

  if (groups.length === 0) {
    lines.push('No daemon methods matched this query.');
    return lines.join('\n');
  }

  for (const group of groups) {
    lines.push(`${group.category} (${group.methodCount})`);
    lines.push(`  ${group.readOnlyMethodCount} read-only; ${group.mutatingMethodCount} mutating; ${group.dangerousMethodCount} dangerous; ${group.authenticatedMethodCount} authenticated`);
    const visibleMethods = group.methods.slice(0, 12);
    for (const method of visibleMethods) lines.push(renderInventoryMethod(method));
    if (group.methods.length > visibleMethods.length) {
      lines.push(`    ... ${group.methods.length - visibleMethods.length} more; use --json or a narrower query for the full list.`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
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
    lines.push(`  route risk: ${area.routeRisk.readOnlyMethodCount} read-only; ${area.routeRisk.mutatingMethodCount} mutating; ${area.routeRisk.dangerousMethodIds.length} dangerous; ${area.routeRisk.authenticatedMethodCount} authenticated`);
    if (area.routeRisk.dangerousMethodIds.length > 0) {
      lines.push(`  dangerous methods: ${area.routeRisk.dangerousMethodIds.join(', ')}`);
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
