import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';

const AGENT_CONTEXT_TOOL_MODES = [
  'summary',
  'capabilities',
  'modes',
  'tools',
  'tool',
  'settings',
  'setting',
  'commands',
  'command',
  'workspace',
  'status',
] as const;

type AgentContextMode = typeof AGENT_CONTEXT_TOOL_MODES[number];

type AgentContextArgs = {
  readonly mode?: unknown;
  readonly query?: unknown;
  readonly target?: unknown;
  readonly toolName?: unknown;
  readonly command?: unknown;
  readonly commandName?: unknown;
  readonly key?: unknown;
  readonly category?: unknown;
  readonly prefix?: unknown;
  readonly includeHidden?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
};

const CONTEXT_TOOL_FALLBACK = {
  runtime: 'GoodVibes Agent',
  preferredTool: 'agent_harness',
  routes: {
    summary: 'agent_harness mode:"summary"',
    capabilities: 'agent_harness mode:"summary" includeParameters:true',
    tools: 'agent_harness mode:"tools"',
    tool: 'agent_harness mode:"tool"',
    settings: 'agent_harness mode:"settings"',
    commands: 'agent_harness mode:"commands"',
    workspace: 'agent_harness mode:"workspace"',
    status: 'agent_harness mode:"connected_host_status"',
  },
};

export function wrapAgentContextToolForAgentPolicy(tool: Tool, registry?: ToolRegistry): void {
  tool.definition.description = 'Inspect GoodVibes Agent harness capabilities.';
  tool.definition.sideEffects = [];
  tool.definition.parameters = {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: [...AGENT_CONTEXT_TOOL_MODES] },
      query: { type: 'string' },
      target: { type: 'string' },
      toolName: { type: 'string' },
      command: { type: 'string' },
      commandName: { type: 'string' },
      key: { type: 'string' },
      category: { type: 'string' },
      prefix: { type: 'string' },
      includeHidden: { type: 'boolean' },
      includeParameters: { type: 'boolean' },
      limit: { type: 'number' },
    },
    additionalProperties: false,
  };
  tool.execute = async (rawArgs) => {
    const args = rawArgs as AgentContextArgs;
    const mode = readAgentContextMode(args.mode);
    const harnessMode = agentContextModeToHarnessMode(mode);
    const harnessTool = registry?.list().find((entry) => entry.definition.name === 'agent_harness');
    if (!harnessTool) {
      return ok({
        ...CONTEXT_TOOL_FALLBACK,
        status: 'agent_harness_not_registered_yet',
        requestedMode: mode,
        route: `agent_harness mode:"${harnessMode}"`,
      });
    }

    const harnessArgs = {
      mode: harnessMode,
      query: args.query,
      target: args.target,
      toolName: args.toolName,
      command: args.command,
      commandName: args.commandName,
      key: args.key,
      category: args.category,
      prefix: args.prefix,
      includeHidden: args.includeHidden,
      includeParameters: mode === 'capabilities' ? true : args.includeParameters,
      limit: args.limit,
    };
    const result = await harnessTool.execute(dropUndefined(harnessArgs));
    if (!result.success) return result;
    return ok({
      source: 'agent_harness',
      requestedMode: mode,
      route: `agent_harness mode:"${harnessMode}"`,
      result: parseToolOutput(result.output),
    });
  };
}

export const AGENT_CONTEXT_TOOL_COMPATIBILITY_MODES = AGENT_CONTEXT_TOOL_MODES;

function readAgentContextMode(value: unknown): AgentContextMode {
  return typeof value === 'string' && AGENT_CONTEXT_TOOL_MODES.includes(value as AgentContextMode)
    ? value as AgentContextMode
    : 'summary';
}

function agentContextModeToHarnessMode(mode: AgentContextMode): string {
  if (mode === 'capabilities') return 'summary';
  if (mode === 'modes') return 'modes';
  if (mode === 'tools') return 'tools';
  if (mode === 'tool') return 'tool';
  if (mode === 'settings') return 'settings';
  if (mode === 'setting') return 'get_setting';
  if (mode === 'commands') return 'commands';
  if (mode === 'command') return 'command';
  if (mode === 'workspace') return 'workspace';
  if (mode === 'status') return 'connected_host_status';
  return 'summary';
}

function dropUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function parseToolOutput(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function ok(value: unknown): { readonly success: true; readonly output: string } {
  return { success: true, output: JSON.stringify(value, null, 2) };
}
