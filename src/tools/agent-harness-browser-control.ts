import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { CommandContext } from '../input/command-registry.ts';

type BrowserControlStatus = 'ready' | 'attention' | 'setup-needed';
type BrowserControlDecisionStatus = 'ready-to-inspect-tool' | 'review-connector-first' | 'setup-needed';

export interface BrowserControlRouteArgs {
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
}

interface BrowserControlMcpServer {
  readonly name: string;
  readonly connected: boolean;
  readonly role: string;
  readonly trustMode: string;
  readonly schemaFreshness: string;
  readonly readiness: 'ready' | 'attention';
  readonly modelRoute: string;
}

interface BrowserControlWorkflow {
  readonly id: string;
  readonly label: string;
  readonly status: BrowserControlStatus;
  readonly summary: string;
  readonly next: string;
  readonly inspectRoute: string;
  readonly setupRoute: string;
  readonly safety: string;
}

interface BrowserControlDecision {
  readonly id: string;
  readonly status: BrowserControlDecisionStatus;
  readonly modelRoute: string;
  readonly userRoute: string;
  readonly nextStep: string;
  readonly reason: string;
  readonly safety: string;
}

export interface BrowserControlPosture {
  readonly status: BrowserControlStatus;
  readonly configured: boolean;
  readonly needsReview: boolean;
  readonly toolMatches: readonly string[];
  readonly mcpServers: readonly BrowserControlMcpServer[];
  readonly workflows: readonly BrowserControlWorkflow[];
  readonly setupChecklist: readonly string[];
  readonly fallbackRoutes: readonly string[];
  readonly executionRoute: string;
  readonly setupRoute: string;
  readonly recommendedRoute: string;
  readonly policy: string;
}

type McpServerRecord = ReturnType<NonNullable<NonNullable<CommandContext['clients']>['mcpApi']>['listServerSecurity']>[number];

const BROWSER_CONTROL_TERMS = ['browser', 'desktop', 'computer use', 'screenshot', 'screen recording'];
const POSTURE_ONLY_TOOL_NAMES = new Set(['agent_harness', 'computer', 'device', 'execution', 'route', 'workspace']);

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function quoteRouteValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function includesBrowserControlTerm(value: string): boolean {
  const normalized = value.toLowerCase();
  return BROWSER_CONTROL_TERMS.some((term) => normalized.includes(term));
}

function safeToolDefinitions(toolRegistry: ToolRegistry | undefined): readonly ReturnType<ToolRegistry['getToolDefinitions']>[number][] {
  if (!toolRegistry) return [];
  try {
    return toolRegistry.getToolDefinitions();
  } catch {
    return [];
  }
}

function safeMcpServers(context: CommandContext): readonly McpServerRecord[] {
  try {
    const api = context.clients?.mcpApi ?? context.extensions?.mcpRegistry;
    return api?.listServerSecurity?.() ?? [];
  } catch {
    return [];
  }
}

function describeMcpServer(server: McpServerRecord): BrowserControlMcpServer {
  const ready = server.connected && server.schemaFreshness === 'fresh' && server.trustMode !== 'blocked';
  return {
    name: server.name,
    connected: server.connected,
    role: server.role,
    trustMode: server.trustMode,
    schemaFreshness: server.schemaFreshness,
    readiness: ready ? 'ready' : 'attention',
    modelRoute: `agent_harness mode:"mcp_server" mcpServerId:"${server.name}"`,
  };
}

function workflowStatus(configured: boolean, needsReview: boolean): BrowserControlStatus {
  if (configured) return 'ready';
  return needsReview ? 'attention' : 'setup-needed';
}

function browserControlWorkflows(
  configured: boolean,
  needsReview: boolean,
  recommendedRoute: string,
  setupRoute: string,
): readonly BrowserControlWorkflow[] {
  const status = workflowStatus(configured, needsReview);
  const inspectRoute = configured ? recommendedRoute : setupRoute;
  const next = configured
    ? 'Inspect the configured tool/server, then run the narrowest browser or desktop action needed for the user request.'
    : needsReview
      ? 'Review trust/schema freshness before treating this browser or desktop connector as usable.'
      : 'Configure a trusted browser/desktop MCP server or first-class tool before attempting live UI control.';
  return [
    {
      id: 'browser-navigation',
      label: 'Browser navigation',
      status,
      summary: 'Drive a real browser only when a trusted browser tool or MCP server is configured.',
      next,
      inspectRoute,
      setupRoute,
      safety: 'Use read-only web/fetch routes for research unless the user explicitly needs live browser state or authentication.',
    },
    {
      id: 'screenshot-observation',
      label: 'Screenshot or screen observation',
      status,
      summary: 'Capture or inspect the screen through configured screenshot/screen-recording tooling.',
      next,
      inspectRoute,
      setupRoute,
      safety: 'Screenshots can expose secrets or private data; inspect setup and ask before capturing sensitive surfaces.',
    },
    {
      id: 'desktop-control',
      label: 'Desktop control',
      status,
      summary: 'Use desktop/computer-control only after trust, host, and confirmation boundaries are clear.',
      next,
      inspectRoute,
      setupRoute,
      safety: 'Desktop actions are external effects; destructive or account-changing actions require explicit user confirmation.',
    },
  ];
}

export function browserControlPosture(context: CommandContext, toolRegistry?: ToolRegistry): BrowserControlPosture {
  const registry = toolRegistry ?? context.extensions?.toolRegistry;
  const toolMatches = safeToolDefinitions(registry)
    .filter((tool) => !POSTURE_ONLY_TOOL_NAMES.has(tool.name))
    .filter((tool) => includesBrowserControlTerm(`${tool.name}\n${tool.description}`))
    .map((tool) => tool.name)
    .sort((left, right) => left.localeCompare(right));

  const mcpServers = safeMcpServers(context)
    .filter((server) => includesBrowserControlTerm(`${server.name}\n${server.role}`))
    .map(describeMcpServer)
    .sort((left, right) => left.name.localeCompare(right.name));

  const readyBrowserMcp = mcpServers.some((server) => server.readiness === 'ready');
  const needsReview = mcpServers.some((server) => server.readiness === 'attention');
  const configured = toolMatches.length > 0 || readyBrowserMcp;
  const recommendedRoute = configured
    ? 'execution action:"route" id:"browser-or-desktop-control"'
    : needsReview
      ? 'agent_harness mode:"mcp_servers" query:"browser desktop"'
      : 'agent_harness mode:"mcp_servers" query:"browser desktop"';
  const setupRoute = 'setup action:"item" setupItemId:"browser-desktop-control"';
  return {
    status: configured ? 'ready' : needsReview ? 'attention' : 'setup-needed',
    configured,
    needsReview,
    toolMatches,
    mcpServers,
    workflows: browserControlWorkflows(configured, needsReview, recommendedRoute, setupRoute),
    setupChecklist: [
      'Inspect browser/desktop MCP servers and first-class tools before attempting live UI control.',
      'Prefer constrained trust, fresh schemas, and explicit allowed hosts/paths.',
      'Use web_search or fetch instead when the task only needs public web information.',
      'Ask for confirmation before screenshots, authenticated browsing, account changes, purchases, sends, or destructive desktop actions.',
    ],
    fallbackRoutes: [
      'execution action:"route" id:"web-fetch-research"',
      'agent_harness mode:"mcp_servers" query:"browser desktop"',
    ],
    executionRoute: 'execution action:"route" id:"browser-or-desktop-control"',
    setupRoute,
    recommendedRoute,
    policy: 'Browser and desktop control stays explicit: no live UI control is assumed unless a trusted tool or fresh constrained MCP server is configured.',
  };
}

function workflowSearchText(workflow: BrowserControlWorkflow): string {
  return [
    workflow.id,
    workflow.label,
    workflow.summary,
    workflow.next,
    workflow.safety,
  ].join('\n').toLowerCase();
}

function selectBrowserControlWorkflow(posture: BrowserControlPosture, input: string): BrowserControlWorkflow {
  const normalized = input.toLowerCase();
  if (!normalized) return posture.workflows[0]!;
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const scored = posture.workflows
    .map((workflow, index) => {
      let score = 0;
      const text = workflowSearchText(workflow);
      if (workflow.id.includes(normalized) || workflow.label.toLowerCase().includes(normalized)) score += 1_000;
      for (const token of tokens) {
        if (workflow.id.includes(token)) score += 250;
        if (workflow.label.toLowerCase().includes(token)) score += 200;
        if (text.includes(token)) score += 40;
      }
      if (workflow.id === 'browser-navigation' && /browse|browser|navigate|url|page|click|form|login|web/.test(normalized)) score += 450;
      if (workflow.id === 'screenshot-observation' && /screenshot|screen|observe|record|capture|visual|see/.test(normalized)) score += 450;
      if (workflow.id === 'desktop-control' && /desktop|computer|app|window|keyboard|mouse|type|os/.test(normalized)) score += 450;
      return { workflow, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return scored[0]?.workflow ?? posture.workflows[0]!;
}

function toolCandidateRoutes(toolMatches: readonly string[]): readonly Record<string, unknown>[] {
  return toolMatches.slice(0, 8).map((toolName) => ({
    toolName,
    inspectRoute: `agent_harness mode:"tool" toolName:"${quoteRouteValue(toolName)}" includeParameters:true`,
    modelRoute: `${toolName} ...`,
    safety: 'Inspect the tool schema and policy before invoking a live browser, screenshot, or desktop-control action.',
  }));
}

function mcpCandidateRoutes(mcpServers: readonly BrowserControlMcpServer[]): readonly Record<string, unknown>[] {
  return mcpServers.slice(0, 8).map((server) => ({
    serverName: server.name,
    readiness: server.readiness,
    connected: server.connected,
    trustMode: server.trustMode,
    schemaFreshness: server.schemaFreshness,
    inspectRoute: server.modelRoute,
    safety: 'Review trust and schema freshness before using MCP browser or desktop-control tools.',
  }));
}

function browserControlDecision(
  posture: BrowserControlPosture,
  workflow: BrowserControlWorkflow,
  toolRoutes: readonly Record<string, unknown>[],
  mcpRoutes: readonly Record<string, unknown>[],
): BrowserControlDecision {
  const firstToolRoute = readString(toolRoutes[0]?.inspectRoute);
  const firstReadyMcpRoute = readString(mcpRoutes.find((route) => route.readiness === 'ready')?.inspectRoute);
  const firstReviewMcpRoute = readString(mcpRoutes[0]?.inspectRoute);
  if (posture.configured) {
    return {
      id: 'inspect-configured-browser-control',
      status: 'ready-to-inspect-tool',
      modelRoute: firstToolRoute || firstReadyMcpRoute || posture.executionRoute,
      userRoute: 'Agent Workspace -> Work & Approvals or Tools & MCP',
      nextStep: `Inspect the configured ${workflow.label.toLowerCase()} tool/server, then invoke the narrowest live-control tool only if the user request still needs it.`,
      reason: 'A browser/desktop control tool or fresh trusted MCP server is configured.',
      safety: workflow.safety,
    };
  }
  if (posture.needsReview) {
    return {
      id: 'review-browser-control-connector',
      status: 'review-connector-first',
      modelRoute: firstReviewMcpRoute || 'computer action:"mcp" query:"browser desktop" includeParameters:true',
      userRoute: 'Agent Workspace -> Tools & MCP',
      nextStep: 'Review connector trust, connectivity, and schema freshness before treating browser or desktop control as available.',
      reason: 'A browser/desktop connector exists but needs trust, connectivity, or schema review.',
      safety: 'Do not use stale or untrusted browser/desktop connectors for screenshots, authenticated pages, or desktop actions.',
    };
  }
  return {
    id: 'setup-browser-control',
    status: 'setup-needed',
    modelRoute: posture.setupRoute,
    userRoute: 'Agent Workspace -> Setup',
    nextStep: 'Configure a trusted browser/desktop tool or MCP server, or use the public web/fetch fallback when live UI state is not required.',
    reason: 'No trusted browser/desktop control tool or fresh MCP server is configured.',
    safety: 'This planner does not open, observe, or control the browser or desktop.',
  };
}

export function browserControlRouteSummary(
  context: CommandContext,
  toolRegistry: ToolRegistry,
  args: BrowserControlRouteArgs,
): Record<string, unknown> {
  const input = readString(args.query) || readString(args.target);
  const includeParameters = args.includeParameters === true;
  const posture = browserControlPosture(context, toolRegistry);
  const workflow = selectBrowserControlWorkflow(posture, input);
  const toolRoutes = toolCandidateRoutes(posture.toolMatches);
  const mcpRoutes = mcpCandidateRoutes(posture.mcpServers);
  const decision = browserControlDecision(posture, workflow, toolRoutes, mcpRoutes);
  return {
    mode: 'browser_control_route',
    request: input || null,
    status: posture.status,
    configured: posture.configured,
    needsReview: posture.needsReview,
    workflow,
    decision,
    toolCandidates: toolRoutes,
    mcpCandidates: mcpRoutes,
    fallbackRoutes: posture.fallbackRoutes,
    routes: {
      controlPosture: 'computer action:"control" includeParameters:true',
      setup: posture.setupRoute,
      mcpReview: 'computer action:"mcp" query:"browser desktop" includeParameters:true',
      publicWebFallback: posture.fallbackRoutes[0] ?? 'execution action:"route" id:"web-fetch-research"',
    },
    ...(includeParameters ? { posture } : {}),
    policy: {
      effect: 'read-only-route-plan',
      boundary: 'This route selects the safest browser/desktop control workflow only. It never opens a browser, captures a screenshot, controls the desktop, or invokes a browser/MCP tool by itself.',
      confirmation: 'Live browser, screenshot, authenticated browsing, account-changing, purchase, send, or destructive desktop actions require the selected tool-specific confirmation boundary and explicit user request.',
    },
  };
}
