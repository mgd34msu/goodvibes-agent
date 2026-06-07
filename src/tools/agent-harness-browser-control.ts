import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { CommandContext } from '../input/command-registry.ts';

type BrowserControlStatus = 'ready' | 'attention' | 'setup-needed';

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
    ? 'agent_harness mode:"execution_route" executionRouteId:"browser-or-desktop-control"'
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
      'agent_harness mode:"execution_route" executionRouteId:"web-fetch-research"',
      'agent_harness mode:"mcp_servers" query:"browser desktop"',
    ],
    executionRoute: 'agent_harness mode:"execution_route" executionRouteId:"browser-or-desktop-control"',
    setupRoute,
    recommendedRoute,
    policy: 'Browser and desktop control stays explicit: no live UI control is assumed unless a trusted tool or fresh constrained MCP server is configured.',
  };
}
