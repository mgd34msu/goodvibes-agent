import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { CommandContext } from '../input/command-registry.ts';

type BrowserControlStatus = 'ready' | 'setup-needed';

interface BrowserControlMcpServer {
  readonly name: string;
  readonly connected: boolean;
  readonly role: string;
  readonly trustMode: string;
  readonly schemaFreshness: string;
}

export interface BrowserControlPosture {
  readonly status: BrowserControlStatus;
  readonly configured: boolean;
  readonly toolMatches: readonly string[];
  readonly mcpServers: readonly BrowserControlMcpServer[];
  readonly executionRoute: string;
  readonly setupRoute: string;
  readonly recommendedRoute: string;
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
  return {
    name: server.name,
    connected: server.connected,
    role: server.role,
    trustMode: server.trustMode,
    schemaFreshness: server.schemaFreshness,
  };
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

  const connectedBrowserMcp = mcpServers.some((server) => server.connected === true);
  const configured = toolMatches.length > 0 || connectedBrowserMcp;
  return {
    status: configured ? 'ready' : 'setup-needed',
    configured,
    toolMatches,
    mcpServers,
    executionRoute: 'agent_harness mode:"execution_route" executionRouteId:"browser-or-desktop-control"',
    setupRoute: 'agent_harness mode:"setup_item" setupItemId:"browser-desktop-control"',
    recommendedRoute: configured
      ? 'agent_harness mode:"execution_route" executionRouteId:"browser-or-desktop-control"'
      : 'agent_harness mode:"mcp_servers" query:"browser desktop"',
  };
}
