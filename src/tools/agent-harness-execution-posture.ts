import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { CommandContext } from '../input/command-registry.ts';
import { previewHarnessText } from './agent-harness-text.ts';

export interface AgentHarnessExecutionArgs {
  readonly executionRouteId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

type ExecutionResolution =
  | { readonly status: 'found'; readonly route: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

type ExecutionLookupSource = 'executionRouteId' | 'target' | 'query';
type ExecutionEffect = 'read-only' | 'local-effect' | 'external-read' | 'delegated-work' | 'setup-gap';
type ExecutionAvailability = 'ready' | 'setup-needed' | 'fallback-only';

interface ExecutionRoute {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly userOutcome: string;
  readonly effect: ExecutionEffect;
  readonly preferredWhen: string;
  readonly useInsteadWhen?: string;
  readonly toolNames?: readonly string[];
  readonly anyToolNames?: readonly string[];
  readonly browserMcp?: boolean;
  readonly modelRoute: string;
  readonly safety: string;
  readonly nextStep: string;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function lookupFromArgs(args: AgentHarnessExecutionArgs): { readonly source: ExecutionLookupSource; readonly input: string } | null {
  const executionRouteId = readString(args.executionRouteId);
  if (executionRouteId) return { source: 'executionRouteId', input: executionRouteId };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

function routeDefinitions(): readonly ExecutionRoute[] {
  return [
    {
      id: 'local-read-search-analyze',
      label: 'Local read, search, and analysis',
      detail: 'Use workspace read/search/inspect/analyze tools to understand files, diffs, logs, and project structure before taking action.',
      userOutcome: 'The user gets direct answers from the current workspace without delegation ceremony.',
      effect: 'read-only',
      preferredWhen: 'The task needs project context, code review, log triage, or file inspection and the current workspace is the target.',
      useInsteadWhen: 'Use delegation only when the user needs a remote workspace, parallel review, or isolated runner.',
      anyToolNames: ['read', 'find', 'inspect', 'analyze'],
      modelRoute: 'read/find/inspect/analyze',
      safety: 'Read-only tools must stay bounded to the current permitted workspace and avoid raw secret disclosure.',
      nextStep: 'Call the narrowest read/search/analyze tool that answers the user request.',
    },
    {
      id: 'local-edit-write',
      label: 'Local file edit and write',
      detail: 'Use local edit/write tools for explicit implementation, fix, patch, or document changes when this Agent workspace is the intended target.',
      userOutcome: 'The user gets the requested change in place without a handoff when local permissions are already sufficient.',
      effect: 'local-effect',
      preferredWhen: 'The user asks to implement, fix, patch, refactor, update docs, or edit files in the current workspace.',
      useInsteadWhen: 'Use delegation for isolated worktrees, remote machines, parallel workers, or work that needs a separate coding UI.',
      anyToolNames: ['edit', 'write'],
      modelRoute: 'edit/write',
      safety: 'Respect user-owned dirty worktree changes, keep edits scoped, and verify with tests or static checks when feasible.',
      nextStep: 'Use local edit/write tooling, then run targeted verification through the local shell route when appropriate.',
    },
    {
      id: 'local-shell-command',
      label: 'Local shell command',
      detail: 'Run bounded foreground shell commands for discovery, builds, tests, formatting, and verification when the user request and workspace allow it.',
      userOutcome: 'The user sees progress and results from the actual environment without extra routing decisions.',
      effect: 'local-effect',
      preferredWhen: 'The task needs command output, project tests, build checks, package inspection, or safe one-off automation in the current workspace.',
      useInsteadWhen: 'Use delegation or connected-host tasks for long-running unattended jobs, isolation, remote execution, or parallelism.',
      toolNames: ['exec'],
      modelRoute: 'exec',
      safety: 'Use foreground serial commands, avoid destructive operations unless explicitly requested, and report verification results clearly.',
      nextStep: 'Call exec with a bounded command and working directory tied to the current task.',
    },
    {
      id: 'web-fetch-research',
      label: 'Web and URL evidence',
      detail: 'Use registered web_search or fetch tools for current public information, source inspection, and evidence gathering.',
      userOutcome: 'The user gets sourced current information without pretending local knowledge is fresh.',
      effect: 'external-read',
      preferredWhen: 'The request depends on current, public, or third-party information.',
      useInsteadWhen: 'Use research run/source/report tools when the answer needs a durable research ledger or citation repair.',
      anyToolNames: ['web_search', 'fetch'],
      modelRoute: 'web_search/fetch',
      safety: 'Read-only browsing must use relevant sources, attribution, and source limits; authenticated or mutating web actions need explicit tools.',
      nextStep: 'Call web_search or fetch, then capture durable sources when a longer research workflow is useful.',
    },
    {
      id: 'browser-or-desktop-control',
      label: 'Browser or desktop control',
      detail: 'Use browser, desktop, or computer-control MCP/tooling only when a trusted server or first-class tool is configured.',
      userOutcome: 'The user can automate real UI flows when setup is present, and gets a clear setup gap when it is not.',
      effect: 'setup-gap',
      preferredWhen: 'The user asks for browser navigation, UI testing, screenshots, screen recording, or device/desktop actions.',
      useInsteadWhen: 'Use read-only web tools for research that does not require controlling a live browser or desktop.',
      browserMcp: true,
      modelRoute: 'mcp/browser tools',
      safety: 'Browser and desktop control must use trusted servers, constrained paths/hosts, and visible confirmation for external effects.',
      nextStep: 'Inspect MCP/browser setup, then use the configured browser tool or report the setup blocker.',
    },
    {
      id: 'delegation-isolation-parallel-remote',
      label: 'Delegation, isolation, parallelism, or remote work',
      detail: 'Use GoodVibes TUI/shared-session delegation when the user benefits from isolation, remote execution, separate worktrees, parallel workers, or delegated review.',
      userOutcome: 'The user gets heavier execution routed to the right supervised environment without blocking ordinary local work.',
      effect: 'delegated-work',
      preferredWhen: 'The task needs a remote host, isolated worktree, parallel agent, separate coding UI, or user-requested delegated review.',
      useInsteadWhen: 'Use local read/edit/exec when the current workspace and permissions are sufficient for a normal implementation or verification task.',
      modelRoute: 'agent_harness delegation_route',
      safety: 'Delegated work submission must preserve the full original ask and remain visible and confirmation-gated.',
      nextStep: 'Inspect delegation_posture or delegation_route before submitting a confirmed handoff.',
    },
  ];
}

function safeToolDefinitions(toolRegistry: ToolRegistry): readonly ReturnType<ToolRegistry['getToolDefinitions']>[number][] {
  try {
    return toolRegistry.getToolDefinitions();
  } catch {
    return [];
  }
}

function registeredToolNames(toolRegistry: ToolRegistry): ReadonlySet<string> {
  return new Set(safeToolDefinitions(toolRegistry).map((tool) => tool.name));
}

function browserToolReady(context: CommandContext, toolRegistry: ToolRegistry): boolean {
  const toolDefinitions = safeToolDefinitions(toolRegistry);
  if (toolDefinitions.some((tool) => {
    const haystack = `${tool.name}\n${tool.description}`.toLowerCase();
    return haystack.includes('browser') || haystack.includes('desktop') || haystack.includes('computer use') || haystack.includes('screenshot');
  })) {
    return true;
  }
  try {
    const servers = context.clients?.mcpApi?.listServerSecurity?.() ?? [];
    return servers.some((server) => {
      const role = typeof server.role === 'string' ? server.role.toLowerCase() : '';
      const name = typeof server.name === 'string' ? server.name.toLowerCase() : '';
      return server.connected === true && (role.includes('browser') || role.includes('desktop') || name.includes('browser'));
    });
  } catch {
    return false;
  }
}

function routeAvailability(route: ExecutionRoute, context: CommandContext, toolRegistry: ToolRegistry): ExecutionAvailability {
  if (route.id === 'delegation-isolation-parallel-remote') return 'ready';
  if (route.browserMcp) return browserToolReady(context, toolRegistry) ? 'ready' : 'setup-needed';
  const names = registeredToolNames(toolRegistry);
  if (route.toolNames?.every((name) => names.has(name))) return 'ready';
  if (route.anyToolNames?.some((name) => names.has(name))) return 'ready';
  return route.effect === 'read-only' ? 'fallback-only' : 'setup-needed';
}

function availableTools(route: ExecutionRoute, toolRegistry: ToolRegistry): readonly string[] {
  const names = registeredToolNames(toolRegistry);
  return [...(route.toolNames ?? []), ...(route.anyToolNames ?? [])].filter((name) => names.has(name));
}

function routeSearchText(route: ExecutionRoute): string {
  return [
    route.id,
    route.label,
    route.detail,
    route.userOutcome,
    route.effect,
    route.preferredWhen,
    route.useInsteadWhen ?? '',
    route.modelRoute,
    route.nextStep,
    ...(route.toolNames ?? []),
    ...(route.anyToolNames ?? []),
  ].join('\n').toLowerCase();
}

function describeCandidate(route: ExecutionRoute, context: CommandContext, toolRegistry: ToolRegistry): Record<string, unknown> {
  return {
    executionRouteId: route.id,
    label: route.label,
    effect: route.effect,
    availability: routeAvailability(route, context, toolRegistry),
    modelRoute: route.modelRoute,
  };
}

function describeRoute(
  route: ExecutionRoute,
  context: CommandContext,
  toolRegistry: ToolRegistry,
  options: { readonly includeParameters?: boolean; readonly lookup?: Record<string, unknown> } = {},
): Record<string, unknown> {
  const availability = routeAvailability(route, context, toolRegistry);
  const tools = availableTools(route, toolRegistry);
  return {
    executionRouteId: route.id,
    label: route.label,
    effect: route.effect,
    availability,
    ...(tools.length > 0 ? { availableTools: tools } : {}),
    modelRoute: route.modelRoute,
    preferredWhen: options.includeParameters ? route.preferredWhen : previewHarnessText(route.preferredWhen),
    nextStep: options.includeParameters ? route.nextStep : previewHarnessText(route.nextStep),
    ...(options.includeParameters
      ? {
        detail: route.detail,
        userOutcome: route.userOutcome,
        useInsteadWhen: route.useInsteadWhen ?? null,
        safety: route.safety,
        toolNames: route.toolNames ?? [],
        anyToolNames: route.anyToolNames ?? [],
        browserMcp: route.browserMcp === true,
        modelAccess: {
          inspectPosture: 'agent_harness mode:"execution_posture"',
          inspectRoute: `agent_harness mode:"execution_route" executionRouteId:"${route.id}"`,
          inspectTools: 'agent_harness mode:"tools"',
          inspectDelegation: 'agent_harness mode:"delegation_posture"',
        },
      }
      : {}),
    ...(options.lookup ? { lookup: options.lookup } : {}),
  };
}

function matchingRoutes(input: string): readonly ExecutionRoute[] {
  const normalized = input.toLowerCase().trim();
  const all = routeDefinitions();
  if (!normalized) return all;
  return all.filter((route) => routeSearchText(route).includes(normalized));
}

export function executionPostureCatalogStatus(context: CommandContext, toolRegistry: ToolRegistry): Record<string, unknown> {
  const routes = routeDefinitions();
  const statuses = routes.map((route) => routeAvailability(route, context, toolRegistry));
  return {
    modes: ['execution_posture', 'execution_route'],
    routes: routes.length,
    readyRoutes: statuses.filter((status) => status === 'ready').length,
    setupNeededRoutes: statuses.filter((status) => status === 'setup-needed').length,
    readOnly: true,
  };
}

export function executionPostureSummary(context: CommandContext, toolRegistry: ToolRegistry, args: AgentHarnessExecutionArgs): Record<string, unknown> {
  const query = readString(args.query).toLowerCase();
  const includeParameters = args.includeParameters === true;
  const routes = matchingRoutes(query).slice(0, readLimit(args.limit, 100));
  const all = routeDefinitions();
  return {
    status: 'available',
    summary: {
      localFirstPolicy: 'Use local read/edit/exec when the current workspace and permissions are sufficient.',
      delegationPolicy: 'Use delegation for isolation, parallelism, remote execution, separate worktrees, or user-requested delegated review.',
      browserControl: browserToolReady(context, toolRegistry) ? 'configured' : 'setup-needed',
      registeredExecutionTools: [...registeredToolNames(toolRegistry)].filter((name) => ['read', 'find', 'inspect', 'analyze', 'edit', 'write', 'exec', 'fetch', 'web_search'].includes(name)).sort(),
    },
    decisionRules: [
      'Do not delegate ordinary local implementation, fix, review, or verification work when local tools and permissions are sufficient.',
      'Do delegate when isolation, parallelism, remote execution, a separate worktree, or a requested delegated review improves the user outcome.',
      'Report setup gaps directly for browser/desktop control instead of pretending browser automation exists.',
    ],
    routes: routes.map((route) => describeRoute(route, context, toolRegistry, { includeParameters })),
    returned: routes.length,
    total: all.length,
    policy: 'Read-only execution posture. It selects routes and safety boundaries; actual tool calls remain governed by each first-class tool policy.',
  };
}

export function describeHarnessExecutionRoute(context: CommandContext, toolRegistry: ToolRegistry, args: AgentHarnessExecutionArgs): ExecutionResolution {
  const lookup = lookupFromArgs(args);
  if (!lookup) {
    return {
      status: 'missing_lookup',
      usage: 'execution_route requires executionRouteId, target, or query. Use mode:"execution_posture" to inspect execution route ids.',
    };
  }
  const all = routeDefinitions();
  const normalized = lookup.input.toLowerCase();
  const exact = all.find((route) => route.id === lookup.input);
  if (exact) return { status: 'found', route: describeRoute(exact, context, toolRegistry, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'id' } }) };
  const insensitive = all.find((route) => route.id.toLowerCase() === normalized);
  if (insensitive) return { status: 'found', route: describeRoute(insensitive, context, toolRegistry, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-id' } }) };
  const searched = matchingRoutes(normalized);
  if (searched.length === 1) return { status: 'found', route: describeRoute(searched[0]!, context, toolRegistry, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'search' } }) };
  if (searched.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: searched.slice(0, 8).map((route) => describeCandidate(route, context, toolRegistry)),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown execution route ${lookup.input}. Use mode:"execution_posture" to list route ids.`,
  };
}
