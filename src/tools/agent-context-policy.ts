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
    capabilities: 'goodvibes_context mode:"capabilities"',
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
    if (mode === 'capabilities') return ok(buildAgentCapabilitiesContract(registry));

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
      includeParameters: args.includeParameters,
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

function buildAgentCapabilitiesContract(registry?: ToolRegistry): Record<string, unknown> {
  const availableTools = new Set(safeToolNames(registry));
  const has = (name: string) => availableTools.has(name);
  const optionalTool = (name: string) => has(name) ? name : `${name} (not registered)`;

  return {
    runtime: 'GoodVibes Agent',
    answerStyle: 'Answer user capability questions from this contract. Do not dump inventory counts.',
    currentContract: {
      autonomy: 'User-directed operator agent. It can inspect, plan, edit, run tools, and perform confirmed effects; it is not an unrestricted background account-creation or self-expansion agent.',
      confirmations: 'External sends, reminders, media generation, settings writes, slash-command execution, workspace actions, and operator actions require an explicit user request plus confirm:true where the tool requires it.',
      secrets: 'Do not reveal raw secrets. Use configured secret refs, provider accounts, and channel readiness routes.',
    },
    canDoNow: [
      {
        area: 'Project and computer work',
        can: 'Read, search, analyze, edit, and write workspace files; run bounded shell commands; inspect diffs and project structure.',
        tools: ['read', 'find', 'analyze', 'inspect', 'edit', 'write', 'exec'].filter(has),
      },
      {
        area: 'Web research',
        can: has('web_search')
          ? 'Search the web with bounded read-only evidence, inspect URLs, and summarize sourced findings in the main conversation.'
          : 'Web research is not available until the web_search tool is registered.',
        tools: [optionalTool('web_search'), optionalTool('fetch')],
        inspect: 'agent_harness mode:"tool" toolName:"web_search"',
      },
      {
        area: 'Harness operation',
        can: 'Discover and use harness modes, slash commands, workspace actions, settings, panels, UI surfaces, keybindings, and model tools.',
        tools: [optionalTool('agent_harness'), 'goodvibes_context'],
        inspect: 'agent_harness mode:"modes" query:"capability"',
      },
      {
        area: 'Memory and knowledge',
        can: 'Use Agent-local memory, notes, personas, skills, routines, work plans, and isolated Agent Knowledge ask/search/ingest routes.',
        tools: [optionalTool('agent_local_registry'), optionalTool('agent_work_plan'), optionalTool('agent_knowledge'), optionalTool('agent_knowledge_ingest')],
      },
      {
        area: 'Personal operations',
        can: 'Inspect one user-facing operations map for inbox/calendar connector gaps, notes, work plans, tasks, reminders, routines, schedules, and delivery readiness without inventing missing connectors.',
        tools: [optionalTool('agent_harness'), optionalTool('agent_local_registry'), optionalTool('agent_work_plan'), optionalTool('agent_reminder_schedule'), optionalTool('agent_channel_send')],
        inspect: 'agent_harness mode:"personal_ops"',
      },
      {
        area: 'Documents and artifacts',
        can: 'Create, revise, version, review, comment on, suggest changes to, attach or insert saved artifacts into, and export Agent document drafts; browse saved artifacts; promote reviewed artifacts into isolated Agent Knowledge; handle uploads, source checks, generated media artifacts, and run confirmed blind model comparisons from prompts or saved text artifacts with durable review, judgment, and route-update actions.',
        tools: [optionalTool('agent_harness'), optionalTool('agent_documents'), optionalTool('agent_artifacts'), optionalTool('agent_knowledge'), optionalTool('agent_knowledge_ingest'), optionalTool('agent_media_generate'), optionalTool('agent_model_compare')],
        inspect: 'agent_harness mode:"document_ops"',
      },
      {
        area: 'Configured services and messages',
        can: 'Inspect configured channel readiness and send one confirmed message/notification/reminder/media request through configured targets.',
        tools: [optionalTool('agent_channel_send'), optionalTool('agent_notify'), optionalTool('agent_reminder_schedule'), optionalTool('agent_media_generate')],
        inspect: 'agent_harness mode:"channels" or mode:"notifications"',
      },
      {
        area: 'Provider and setup work',
        can: 'Inspect provider accounts, subscriptions, model routing, setup posture, service posture, and connected-host status; apply supported settings changes when explicitly requested.',
        tools: [optionalTool('agent_harness')],
        inspect: 'agent_harness mode:"provider_accounts", mode:"model_routing", mode:"setup_posture", or mode:"settings"',
      },
    ],
    needsSetupOrIntegration: [
      'Email inbox triage and replies are not a built-in advertised Agent tool in this package; they require a configured plugin, MCP server, or channel/service connector that exposes inbox and send/reply actions.',
      'New third-party service signup/account creation is not a built-in autonomous flow. The Agent can help fill instructions and run explicit tools, but it should not use local personal information to create accounts without a user-owned integration and confirmation path.',
      'Long-running autonomous operation requires an explicit schedule, routine, automation, or connected-host route. The main conversation does not silently create hidden background jobs.',
      'New capabilities can come from installed plugins, MCP servers, configured services, or code changes; the Agent should inspect what is installed before claiming a capability exists.',
    ],
    commonRoutes: {
      findCapability: 'agent_harness mode:"modes" query:"<task>"',
      personalOps: 'agent_harness mode:"personal_ops"; inspect one lane with mode:"personal_ops_lane"',
      documentOps: 'agent_harness mode:"document_ops"; inspect one lane with mode:"document_ops_lane"',
      documents: 'agent_documents mode:"list"; show with documentId; confirmed create/update/review/comment/resolveComment/suggest/acceptSuggestion/rejectSuggestion/attachArtifact/insertArtifact/export with confirm:true',
      artifacts: 'agent_artifacts mode:"list"; inspect with mode:"show"; export one with mode:"export"; package selected ids with mode:"package"; promote reviewed artifact ids with agent_knowledge_ingest sourceKind:"artifact"',
      listTools: 'agent_harness mode:"tools" query:"<task>"',
      inspectTool: 'agent_harness mode:"tool" toolName:"<tool>"',
      listCommands: 'agent_harness mode:"commands" query:"<task>"',
      runCommand: 'agent_harness mode:"run_command" command:"/<command> ..." confirm:true explicitUserRequest:"..."',
      listWorkspaceActions: 'agent_harness mode:"workspace_actions" query:"<task>"',
      runWorkspaceAction: 'agent_harness mode:"run_workspace_action" actionId:"<id>" confirm:true explicitUserRequest:"..."',
      inspectSettings: 'agent_harness mode:"settings" query:"<setting>"',
      setSetting: 'agent_harness mode:"set_setting" key:"<key>" value:<value> confirm:true explicitUserRequest:"..."',
      webResearch: has('web_search') ? 'web_search query:"<research request>" verbosity:"evidence" maxResults:10 evidenceTopN:3' : 'not registered',
      channels: 'agent_harness mode:"channels"; send with agent_channel_send only after explicit user request',
    },
    registeredModelTools: safeToolNames(registry),
  };
}

function safeToolNames(registry?: ToolRegistry): readonly string[] {
  try {
    return registry?.getToolDefinitions().map((tool) => tool.name).sort((a, b) => a.localeCompare(b)) ?? [];
  } catch {
    return [];
  }
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
