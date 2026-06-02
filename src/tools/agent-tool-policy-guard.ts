import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import {
  wrapAnalyzeToolForAgentPolicy,
  wrapRegistryToolForAgentPolicy,
} from './agent-analysis-registry-policy.ts';
import {
  wrapBlockedContextToolForAgentPolicy,
} from './agent-context-policy.ts';
import { wrapFindToolForAgentPolicy } from './agent-find-policy.ts';
import { wrapReadToolForAgentPolicy } from './agent-read-policy.ts';
import { wrapWebSearchToolForAgentPolicy } from './agent-web-search-policy.ts';

type AgentToolArgs = {
  readonly mode?: unknown;
  readonly [key: string]: unknown;
};

type ExecCommandArgs = {
  readonly cmd?: unknown;
  readonly background?: unknown;
  readonly until?: unknown;
  readonly [key: string]: unknown;
};

type ExecToolArgs = {
  readonly commands?: unknown;
  readonly parallel?: unknown;
  readonly file_ops?: unknown;
  readonly [key: string]: unknown;
};

type ModeToolArgs = {
  readonly mode?: unknown;
  readonly createIfMissing?: unknown;
  readonly [key: string]: unknown;
};

type FetchToolArgs = {
  readonly urls?: unknown;
  readonly parallel?: unknown;
  readonly sanitize_mode?: unknown;
  readonly trusted_hosts?: unknown;
  readonly [key: string]: unknown;
};

type StateToolArgs = {
  readonly mode?: unknown;
  readonly memoryAction?: unknown;
  readonly hookAction?: unknown;
  readonly modeAction?: unknown;
  readonly analyticsAction?: unknown;
  readonly values?: unknown;
  readonly clearKeys?: unknown;
  readonly memoryValue?: unknown;
  readonly hookDefinition?: unknown;
  readonly modeName?: unknown;
  readonly analyticsTool?: unknown;
  readonly analyticsArgs?: unknown;
  readonly analyticsResult?: unknown;
  readonly analyticsDuration?: unknown;
  readonly analyticsTokens?: unknown;
  readonly analyticsFormat?: unknown;
  readonly [key: string]: unknown;
};

type InspectToolArgs = {
  readonly mode?: unknown;
  readonly dryRun?: unknown;
  readonly [key: string]: unknown;
};

type AgentToolPolicyGuardOptions = {
  readonly getLastUserMessage?: () => string | null;
};

const BLOCKED_MAIN_CONVERSATION_TOOL_NAMES = ['write', 'edit', 'workflow', 'repl'] as const;
const AGENT_EXEC_BACKGROUND_COMMAND = /^\s*bg_(?:status|output|stop)\b/;

const READ_ONLY_AGENT_TOOL_MODES = [
  'status',
  'list',
  'templates',
  'get',
  'budget',
  'cohort-status',
  'cohort-report',
] as const;

const READ_ONLY_AGENT_TOOL_MODE_SET = new Set<string>(READ_ONLY_AGENT_TOOL_MODES);
const BLOCKED_MAIN_CONVERSATION_TOOL_NAME_SET = new Set<string>(BLOCKED_MAIN_CONVERSATION_TOOL_NAMES);

const READ_ONLY_REMOTE_TOOL_MODES = ['pools', 'contracts', 'artifacts', 'review'] as const;
const READ_ONLY_CHANNEL_TOOL_MODES = ['accounts', 'directory', 'resolve_target', 'capabilities', 'tools', 'agent_tools', 'actions'] as const;
const READ_ONLY_MCP_TOOL_MODES = ['servers', 'tools', 'schema', 'resources', 'security', 'auth'] as const;
const READ_ONLY_FETCH_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;
const READ_ONLY_STATE_TOOL_MODES = ['get', 'list', 'budget', 'context', 'memory', 'telemetry', 'hooks', 'mode', 'analytics'] as const;
const READ_ONLY_STATE_MEMORY_ACTIONS = ['list', 'get'] as const;
const READ_ONLY_STATE_HOOK_ACTIONS = ['list'] as const;
const READ_ONLY_STATE_MODE_ACTIONS = ['get', 'list'] as const;
const READ_ONLY_STATE_ANALYTICS_ACTIONS = ['summary', 'query', 'dashboard'] as const;
const READ_ONLY_TASK_TOOL_MODES = ['list', 'show', 'handoffs'] as const;
const READ_ONLY_TEAM_TOOL_MODES = ['list', 'show'] as const;
const READ_ONLY_WORKLIST_TOOL_MODES = ['list', 'show'] as const;
const READ_ONLY_PACKET_TOOL_MODES = ['list', 'show'] as const;
const READ_ONLY_QUERY_TOOL_MODES = ['list', 'show'] as const;
const READ_ONLY_CONTROL_TOOL_MODES = ['commands', 'panels', 'subscriptions'] as const;
const READ_ONLY_REMOTE_TOOL_MODE_SET = new Set<string>(READ_ONLY_REMOTE_TOOL_MODES);
const READ_ONLY_CHANNEL_TOOL_MODE_SET = new Set<string>(READ_ONLY_CHANNEL_TOOL_MODES);
const READ_ONLY_MCP_TOOL_MODE_SET = new Set<string>(READ_ONLY_MCP_TOOL_MODES);
const READ_ONLY_FETCH_METHOD_SET = new Set<string>(READ_ONLY_FETCH_METHODS);
const READ_ONLY_STATE_TOOL_MODE_SET = new Set<string>(READ_ONLY_STATE_TOOL_MODES);
const READ_ONLY_STATE_MEMORY_ACTION_SET = new Set<string>(READ_ONLY_STATE_MEMORY_ACTIONS);
const READ_ONLY_STATE_HOOK_ACTION_SET = new Set<string>(READ_ONLY_STATE_HOOK_ACTIONS);
const READ_ONLY_STATE_MODE_ACTION_SET = new Set<string>(READ_ONLY_STATE_MODE_ACTIONS);
const READ_ONLY_STATE_ANALYTICS_ACTION_SET = new Set<string>(READ_ONLY_STATE_ANALYTICS_ACTIONS);
const READ_ONLY_TASK_TOOL_MODE_SET = new Set<string>(READ_ONLY_TASK_TOOL_MODES);
const READ_ONLY_TEAM_TOOL_MODE_SET = new Set<string>(READ_ONLY_TEAM_TOOL_MODES);
const READ_ONLY_WORKLIST_TOOL_MODE_SET = new Set<string>(READ_ONLY_WORKLIST_TOOL_MODES);
const READ_ONLY_PACKET_TOOL_MODE_SET = new Set<string>(READ_ONLY_PACKET_TOOL_MODES);
const READ_ONLY_QUERY_TOOL_MODE_SET = new Set<string>(READ_ONLY_QUERY_TOOL_MODES);
const READ_ONLY_CONTROL_TOOL_MODE_SET = new Set<string>(READ_ONLY_CONTROL_TOOL_MODES);

const LOCAL_AGENT_DENIAL = [
  'GoodVibes Agent does not spawn local Engineer/Reviewer/Tester/Verifier roots or run local WRFC chains.',
  'Keep ordinary assistant work serial in the main conversation.',
  'For explicit build/fix/review work, delegate one request to GoodVibes TUI through the public shared-session/build-delegation contract with the full original user ask.',
].join(' ');

const LOCAL_CODING_TOOL_DENIAL = [
  'GoodVibes Agent does not perform direct local file mutation, local WRFC workflow execution, or local execution-isolation work from the main conversation.',
  'For explicit build/fix/review/code execution work, delegate one request to GoodVibes TUI through the public shared-session/build-delegation contract with the full original user ask.',
  'For durable Agent memory, skills, personas, routines, and knowledge, use the Agent-owned commands and isolated Agent Knowledge routes.',
].join(' ');

const BACKGROUND_EXEC_DENIAL = [
  'GoodVibes Agent only runs foreground, serial command-line work from the main conversation.',
  'Background processes, parallel command batches, background process controls, and exec pre-command file operations are disabled here.',
  'For long-running build/fix/review work, delegate one request to GoodVibes TUI through the public shared-session/build-delegation contract.',
].join(' ');

const REMOTE_MUTATION_DENIAL = [
  'GoodVibes Agent only inspects remote runner pools, contracts, artifacts, and review summaries from the main conversation.',
  'Remote pool creation, assignment, unassignment, and artifact import are disabled here.',
  'Use explicit GoodVibes TUI delegation or a future Agent approval flow for remote execution changes.',
].join(' ');

const CHANNEL_ACTION_DENIAL = [
  'GoodVibes Agent only inspects channel accounts, directories, capabilities, tools, and actions from the main conversation.',
  'Channel account actions, tool runs, operator action runs, authorization, and target auto-creation are disabled here.',
  'External channel side effects require an explicit Agent approval flow before they can run.',
].join(' ');

const MCP_SECURITY_MUTATION_DENIAL = [
  'GoodVibes Agent only inspects MCP servers, tools, schemas, resources, security, and auth state from the main conversation.',
  'MCP quarantine approval, trust changes, and role changes are disabled here.',
  'MCP security mutations require an explicit Agent approval flow before they can run.',
].join(' ');

const FETCH_NETWORK_MUTATION_DENIAL = [
  'GoodVibes Agent only performs serial, unauthenticated, read-only HTTP fetches from the main conversation.',
  'Non-read methods, request bodies, custom auth/header/service credentials, trust overrides, raw unsanitized responses, and parallel fetch batches are disabled here.',
  'Network writes or credentialed external calls require an explicit Agent approval flow before they can run.',
].join(' ');

const STATE_MUTATION_DENIAL = [
  'GoodVibes Agent only inspects runtime-owned state from the main conversation.',
  'Arbitrary state set/clear, runtime-owned memory writes, hook mutation, output-mode mutation, and analytics writes are disabled here.',
  'Use Agent-owned memory, skills, personas, routines, and explicit CLI/slash commands for intentional local state changes.',
].join(' ');

const SETTINGS_MUTATION_DENIAL = [
  'GoodVibes Agent does not mutate configuration through model tools in the main conversation.',
  'Use explicit Agent CLI/slash settings commands for intentional config changes.',
  'Secrets, tokens, passwords, connected-host lifecycle settings, and connected-host exposure settings require explicit user action outside the model tool surface.',
].join(' ');

const INSPECT_WRITE_DENIAL = [
  'GoodVibes Agent only uses inspect scaffold mode for dry-run planning from the main conversation.',
  'File scaffolding and code creation are disabled in the Agent model tool surface.',
  'Delegate explicit build/implement/fix/review work to GoodVibes TUI instead.',
].join(' ');

const DURABLE_WORKFLOW_MUTATION_DENIAL = [
  'GoodVibes Agent only inspects runtime-owned durable workflow tools from the main conversation.',
  'Task, team, worklist, packet, and query creation or lifecycle mutation is disabled here.',
  'Use explicit Agent CLI/slash commands or GoodVibes TUI delegation for intentional workflow changes.',
].join(' ');

const CONTROL_MUTATION_DENIAL = [
  'GoodVibes Agent only inspects runtime-owned product-control surfaces from the main conversation.',
  'Product-control mutation, connected-host lifecycle, and connected-host posture changes are disabled here.',
  'Use explicit Agent CLI/slash commands for Agent-owned changes, and keep connected-host lifecycle external.',
].join(' ');

export function installAgentToolPolicyGuard(registry: ToolRegistry, options: AgentToolPolicyGuardOptions = {}): void {
  const agentTool = registry.list().find((tool) => tool.definition.name === 'agent');
  if (!agentTool) throw new Error('Agent tool policy guard could not find the agent tool.');
  wrapAgentToolForAgentPolicy(agentTool, options);
  for (const tool of registry.list()) {
    if (tool.definition.name === 'exec') {
      wrapExecToolForAgentPolicy(tool);
    } else if (tool.definition.name === 'read') {
      wrapReadToolForAgentPolicy(tool);
    } else if (tool.definition.name === 'remote') {
      wrapModeRestrictedToolForAgentPolicy(tool, {
        allowedModes: READ_ONLY_REMOTE_TOOL_MODES,
        modeSet: READ_ONLY_REMOTE_TOOL_MODE_SET,
        description: [
          'Read-only remote runner inspection for GoodVibes Agent.',
          'Pool creation, runner assignment, unassignment, and artifact import are disabled in the main conversation.',
        ].join(' '),
        denial: REMOTE_MUTATION_DENIAL,
      });
    } else if (tool.definition.name === 'channel') {
      wrapChannelToolForAgentPolicy(tool);
    } else if (tool.definition.name === 'mcp') {
      wrapModeRestrictedToolForAgentPolicy(tool, {
        allowedModes: READ_ONLY_MCP_TOOL_MODES,
        modeSet: READ_ONLY_MCP_TOOL_MODE_SET,
        description: [
          'Read-only MCP inspection for GoodVibes Agent.',
          'Quarantine approval, trust mutation, and role mutation are disabled in the main conversation.',
        ].join(' '),
        denial: MCP_SECURITY_MUTATION_DENIAL,
      });
    } else if (tool.definition.name === 'fetch') {
      wrapFetchToolForAgentPolicy(tool);
    } else if (tool.definition.name === 'state') {
      wrapStateToolForAgentPolicy(tool);
    } else if (tool.definition.name === 'goodvibes_context') {
      wrapBlockedContextToolForAgentPolicy(tool);
    } else if (tool.definition.name === 'goodvibes_settings') {
      wrapBlockedSettingsToolForAgentPolicy(tool);
    } else if (tool.definition.name === 'inspect') {
      wrapInspectToolForAgentPolicy(tool);
    } else if (tool.definition.name === 'analyze') {
      wrapAnalyzeToolForAgentPolicy(tool);
    } else if (tool.definition.name === 'registry') {
      wrapRegistryToolForAgentPolicy(tool);
    } else if (tool.definition.name === 'find') {
      wrapFindToolForAgentPolicy(tool);
    } else if (tool.definition.name === 'web_search') {
      wrapWebSearchToolForAgentPolicy(tool);
    } else if (tool.definition.name === 'control') {
      wrapModeRestrictedToolForAgentPolicy(tool, {
        allowedModes: READ_ONLY_CONTROL_TOOL_MODES,
        modeSet: READ_ONLY_CONTROL_TOOL_MODE_SET,
        description: [
          'Read-only product-control inspection for GoodVibes Agent.',
          'Command, panel, and subscription catalogs can be inspected, but product-control mutation and connected-host lifecycle are external.',
        ].join(' '),
        denial: CONTROL_MUTATION_DENIAL,
      });
    } else if (tool.definition.name === 'task') {
      wrapModeRestrictedToolForAgentPolicy(tool, {
        allowedModes: READ_ONLY_TASK_TOOL_MODES,
        modeSet: READ_ONLY_TASK_TOOL_MODE_SET,
        description: 'Read-only task/workflow inspection for GoodVibes Agent. Task creation, status changes, dependencies, cancellation, and handoff mutation are disabled in the main conversation.',
        denial: DURABLE_WORKFLOW_MUTATION_DENIAL,
        removedProperties: ['title', 'label', 'status', 'dependsOnSessionId', 'dependsOnTaskId', 'reason', 'toSessionId'],
      });
    } else if (tool.definition.name === 'team') {
      wrapModeRestrictedToolForAgentPolicy(tool, {
        allowedModes: READ_ONLY_TEAM_TOOL_MODES,
        modeSet: READ_ONLY_TEAM_TOOL_MODE_SET,
        description: 'Read-only team inspection for GoodVibes Agent. Team creation, membership changes, lane changes, and deletion are disabled in the main conversation.',
        denial: DURABLE_WORKFLOW_MUTATION_DENIAL,
        removedProperties: ['name', 'summary', 'memberId', 'role', 'lanes'],
      });
    } else if (tool.definition.name === 'worklist') {
      wrapModeRestrictedToolForAgentPolicy(tool, {
        allowedModes: READ_ONLY_WORKLIST_TOOL_MODES,
        modeSet: READ_ONLY_WORKLIST_TOOL_MODE_SET,
        description: 'Read-only worklist inspection for GoodVibes Agent. Worklist creation and item lifecycle changes are disabled in the main conversation.',
        denial: DURABLE_WORKFLOW_MUTATION_DENIAL,
        removedProperties: ['title', 'itemId', 'text', 'owner', 'priority'],
      });
    } else if (tool.definition.name === 'packet') {
      wrapModeRestrictedToolForAgentPolicy(tool, {
        allowedModes: READ_ONLY_PACKET_TOOL_MODES,
        modeSet: READ_ONLY_PACKET_TOOL_MODE_SET,
        description: 'Read-only operator packet inspection for GoodVibes Agent. Packet creation, revision, and publishing are disabled in the main conversation.',
        denial: DURABLE_WORKFLOW_MUTATION_DENIAL,
        removedProperties: ['title', 'summary', 'goals', 'constraints', 'risks', 'audience'],
      });
    } else if (tool.definition.name === 'query') {
      wrapModeRestrictedToolForAgentPolicy(tool, {
        allowedModes: READ_ONLY_QUERY_TOOL_MODES,
        modeSet: READ_ONLY_QUERY_TOOL_MODE_SET,
        description: 'Read-only operator query inspection for GoodVibes Agent. Asking, answering, and closing runtime-owned workflow queries are disabled in the main conversation.',
        denial: DURABLE_WORKFLOW_MUTATION_DENIAL,
        removedProperties: ['prompt', 'askedBy', 'target', 'answer', 'resolution'],
      });
    } else if (BLOCKED_MAIN_CONVERSATION_TOOL_NAME_SET.has(tool.definition.name)) {
      wrapBlockedMainConversationToolForAgentPolicy(tool);
    }
  }
}

export function wrapAgentToolForAgentPolicy(tool: Tool, _options: AgentToolPolicyGuardOptions = {}): void {
  narrowAgentToolDefinitionForAgentPolicy(tool);
  const originalExecute = tool.execute.bind(tool);
  tool.execute = async (args) => {
    const denial = validateAgentToolInvocationForAgentPolicy(args as AgentToolArgs);
    if (denial) return { success: false, error: denial };
    return originalExecute(normalizeAgentToolInvocationForAgentPolicy(args as AgentToolArgs) as Parameters<Tool['execute']>[0]);
  };
}

export function validateAgentToolInvocationForAgentPolicy(args: AgentToolArgs): string | null {
  if (typeof args.mode === 'string' && !READ_ONLY_AGENT_TOOL_MODE_SET.has(args.mode)) return LOCAL_AGENT_DENIAL;
  return null;
}

export function normalizeAgentToolInvocationForAgentPolicy(args: AgentToolArgs): AgentToolArgs {
  return args;
}

export function wrapBlockedMainConversationToolForAgentPolicy(tool: Tool): void {
  tool.definition.description = [
    `Blocked in GoodVibes Agent main conversation: ${tool.definition.name}.`,
    'Use explicit GoodVibes TUI build delegation for build/fix/review/code execution work.',
    'Use Agent-owned local registries and isolated Agent Knowledge routes for Agent memory and knowledge work.',
  ].join(' ');
  tool.definition.sideEffects = [];
  tool.execute = async () => ({ success: false, error: LOCAL_CODING_TOOL_DENIAL });
}

export function wrapExecToolForAgentPolicy(tool: Tool): void {
  narrowExecToolDefinitionForAgentPolicy(tool);
  const originalExecute = tool.execute.bind(tool);
  tool.execute = async (args) => {
    const denial = validateExecToolInvocationForAgentPolicy(args as ExecToolArgs);
    if (denial) return { success: false, error: denial };
    return originalExecute(args);
  };
}

export function wrapFetchToolForAgentPolicy(tool: Tool): void {
  narrowFetchToolDefinitionForAgentPolicy(tool);
  const originalExecute = tool.execute.bind(tool);
  tool.execute = async (args) => {
    const denial = validateFetchToolInvocationForAgentPolicy(args as FetchToolArgs);
    if (denial) return { success: false, error: denial };
    return originalExecute(normalizeFetchToolInvocationForAgentPolicy(args as FetchToolArgs) as Parameters<Tool['execute']>[0]);
  };
}

export function wrapStateToolForAgentPolicy(tool: Tool): void {
  narrowStateToolDefinitionForAgentPolicy(tool);
  const originalExecute = tool.execute.bind(tool);
  tool.execute = async (args) => {
    const denial = validateStateToolInvocationForAgentPolicy(args as StateToolArgs);
    if (denial) return { success: false, error: denial };
    return originalExecute(args);
  };
}

export function wrapBlockedSettingsToolForAgentPolicy(tool: Tool): void {
  tool.definition.description = [
    'Blocked in GoodVibes Agent main conversation: configuration mutation.',
    'Use explicit Agent CLI/slash settings commands for intentional config changes.',
    'Connected-host lifecycle and service exposure remain externally managed outside GoodVibes Agent.',
  ].join(' ');
  tool.definition.sideEffects = [];
  tool.definition.parameters = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
  tool.execute = async () => ({ success: false, error: SETTINGS_MUTATION_DENIAL });
}

export function wrapInspectToolForAgentPolicy(tool: Tool): void {
  narrowInspectToolDefinitionForAgentPolicy(tool);
  const originalExecute = tool.execute.bind(tool);
  tool.execute = async (args) => {
    const inspectArgs = args as InspectToolArgs;
    const denial = validateInspectToolInvocationForAgentPolicy(inspectArgs);
    if (denial) return { success: false, error: denial };
    return originalExecute(normalizeInspectToolInvocationForAgentPolicy(inspectArgs) as Parameters<Tool['execute']>[0]);
  };
}

export function validateExecToolInvocationForAgentPolicy(args: ExecToolArgs): string | null {
  if (args.parallel === true) return BACKGROUND_EXEC_DENIAL;
  if (Array.isArray(args.file_ops) && args.file_ops.length > 0) return BACKGROUND_EXEC_DENIAL;
  if (args.file_ops !== undefined && !Array.isArray(args.file_ops)) return BACKGROUND_EXEC_DENIAL;
  if (!Array.isArray(args.commands)) return null;

  for (const command of args.commands) {
    if (!isRecord(command)) continue;
    const commandArgs = command as ExecCommandArgs;
    if (commandArgs.background === true) return BACKGROUND_EXEC_DENIAL;
    if (typeof commandArgs.cmd === 'string' && AGENT_EXEC_BACKGROUND_COMMAND.test(commandArgs.cmd)) {
      return BACKGROUND_EXEC_DENIAL;
    }
    if (isRecord(commandArgs.until)) {
      const killAfter = commandArgs.until.kill_after;
      if (killAfter !== true) return BACKGROUND_EXEC_DENIAL;
    }
  }

  return null;
}

export function validateFetchToolInvocationForAgentPolicy(args: FetchToolArgs): string | null {
  if (args.parallel === true) return FETCH_NETWORK_MUTATION_DENIAL;
  if (args.sanitize_mode === 'none') return FETCH_NETWORK_MUTATION_DENIAL;
  if (isPresent(args.trusted_hosts)) return FETCH_NETWORK_MUTATION_DENIAL;
  if (!Array.isArray(args.urls)) return null;

  for (const urlArgs of args.urls) {
    if (!isRecord(urlArgs)) continue;
    const method = typeof urlArgs.method === 'string' ? urlArgs.method.toUpperCase() : 'GET';
    if (!READ_ONLY_FETCH_METHOD_SET.has(method)) return FETCH_NETWORK_MUTATION_DENIAL;
    if (isPresent(urlArgs.body) || isPresent(urlArgs.body_base64) || isPresent(urlArgs.body_type) || isPresent(urlArgs.body_data)) {
      return FETCH_NETWORK_MUTATION_DENIAL;
    }
    if (isPresent(urlArgs.headers) || isPresent(urlArgs.auth) || isPresent(urlArgs.service) || isPresent(urlArgs.retry_on_auth)) {
      return FETCH_NETWORK_MUTATION_DENIAL;
    }
  }

  return null;
}

export function normalizeFetchToolInvocationForAgentPolicy(args: FetchToolArgs): FetchToolArgs {
  return { ...args, parallel: false };
}

export function validateStateToolInvocationForAgentPolicy(args: StateToolArgs): string | null {
  if (isPresent(args.values) || isPresent(args.clearKeys)) return STATE_MUTATION_DENIAL;
  if (typeof args.mode === 'string' && !READ_ONLY_STATE_TOOL_MODE_SET.has(args.mode)) return STATE_MUTATION_DENIAL;

  if (args.mode === 'memory') {
    const action = typeof args.memoryAction === 'string' ? args.memoryAction : 'list';
    if (!READ_ONLY_STATE_MEMORY_ACTION_SET.has(action) || isPresent(args.memoryValue)) return STATE_MUTATION_DENIAL;
  }

  if (args.mode === 'hooks') {
    const action = typeof args.hookAction === 'string' ? args.hookAction : 'list';
    if (!READ_ONLY_STATE_HOOK_ACTION_SET.has(action) || isPresent(args.hookDefinition)) return STATE_MUTATION_DENIAL;
  }

  if (args.mode === 'mode') {
    const action = typeof args.modeAction === 'string' ? args.modeAction : 'get';
    if (!READ_ONLY_STATE_MODE_ACTION_SET.has(action) || isPresent(args.modeName)) return STATE_MUTATION_DENIAL;
  }

  if (args.mode === 'analytics') {
    const action = typeof args.analyticsAction === 'string' ? args.analyticsAction : 'summary';
    if (!READ_ONLY_STATE_ANALYTICS_ACTION_SET.has(action)) return STATE_MUTATION_DENIAL;
    if (
      isPresent(args.analyticsTool)
      || isPresent(args.analyticsArgs)
      || isPresent(args.analyticsResult)
      || isPresent(args.analyticsDuration)
      || isPresent(args.analyticsTokens)
      || isPresent(args.analyticsFormat)
    ) {
      return STATE_MUTATION_DENIAL;
    }
  }

  return null;
}

export function validateInspectToolInvocationForAgentPolicy(args: InspectToolArgs): string | null {
  if (args.mode === 'scaffold' && args.dryRun === false) return INSPECT_WRITE_DENIAL;
  return null;
}

export function normalizeInspectToolInvocationForAgentPolicy(args: InspectToolArgs): InspectToolArgs {
  if (args.mode !== 'scaffold') return args;
  return { ...args, dryRun: true };
}

type ModeRestrictedToolPolicy = {
  readonly allowedModes: readonly string[];
  readonly modeSet: ReadonlySet<string>;
  readonly description: string;
  readonly denial: string;
  readonly removedProperties?: readonly string[];
};

export function wrapModeRestrictedToolForAgentPolicy(tool: Tool, policy: ModeRestrictedToolPolicy): void {
  narrowModeToolDefinitionForAgentPolicy(tool, policy.allowedModes, policy.description);
  if (policy.removedProperties) removeToolDefinitionProperties(tool, policy.removedProperties);
  const originalExecute = tool.execute.bind(tool);
  tool.execute = async (args) => {
    const denial = validateModeRestrictedToolInvocationForAgentPolicy(args as ModeToolArgs, policy.modeSet, policy.denial);
    if (denial) return { success: false, error: denial };
    return originalExecute(args);
  };
}

export function wrapChannelToolForAgentPolicy(tool: Tool): void {
  narrowModeToolDefinitionForAgentPolicy(tool, READ_ONLY_CHANNEL_TOOL_MODES, [
    'Read-only channel inspection for GoodVibes Agent.',
    'Running channel tools/actions, account lifecycle actions, authorization, and target creation are disabled in the main conversation.',
  ].join(' '));
  const originalExecute = tool.execute.bind(tool);
  tool.execute = async (args) => {
    const denial = validateModeRestrictedToolInvocationForAgentPolicy(args as ModeToolArgs, READ_ONLY_CHANNEL_TOOL_MODE_SET, CHANNEL_ACTION_DENIAL)
      ?? validateChannelToolInvocationForAgentPolicy(args as ModeToolArgs);
    if (denial) return { success: false, error: denial };
    return originalExecute(args);
  };
}

export function validateModeRestrictedToolInvocationForAgentPolicy(
  args: ModeToolArgs,
  modeSet: ReadonlySet<string>,
  denial: string,
): string | null {
  if (typeof args.mode === 'string' && !modeSet.has(args.mode)) return denial;
  return null;
}

export function validateChannelToolInvocationForAgentPolicy(args: ModeToolArgs): string | null {
  if (args.mode === 'resolve_target' && args.createIfMissing === true) return CHANNEL_ACTION_DENIAL;
  return null;
}

export const AGENT_LOCAL_SPAWN_DENIAL_MESSAGE = LOCAL_AGENT_DENIAL;
export const AGENT_READ_ONLY_TOOL_MODES = READ_ONLY_AGENT_TOOL_MODES;
export const AGENT_BLOCKED_MAIN_CONVERSATION_TOOL_NAMES = BLOCKED_MAIN_CONVERSATION_TOOL_NAMES;
export const AGENT_MAIN_CONVERSATION_TOOL_DENIAL_MESSAGE = LOCAL_CODING_TOOL_DENIAL;
export const AGENT_EXEC_BACKGROUND_DENIAL_MESSAGE = BACKGROUND_EXEC_DENIAL;
export const AGENT_READ_ONLY_REMOTE_TOOL_MODES = READ_ONLY_REMOTE_TOOL_MODES;
export const AGENT_READ_ONLY_CHANNEL_TOOL_MODES = READ_ONLY_CHANNEL_TOOL_MODES;
export const AGENT_READ_ONLY_MCP_TOOL_MODES = READ_ONLY_MCP_TOOL_MODES;
export const AGENT_READ_ONLY_FETCH_METHODS = READ_ONLY_FETCH_METHODS;
export const AGENT_READ_ONLY_STATE_TOOL_MODES = READ_ONLY_STATE_TOOL_MODES;
export const AGENT_READ_ONLY_STATE_MEMORY_ACTIONS = READ_ONLY_STATE_MEMORY_ACTIONS;
export const AGENT_READ_ONLY_STATE_HOOK_ACTIONS = READ_ONLY_STATE_HOOK_ACTIONS;
export const AGENT_READ_ONLY_STATE_MODE_ACTIONS = READ_ONLY_STATE_MODE_ACTIONS;
export const AGENT_READ_ONLY_STATE_ANALYTICS_ACTIONS = READ_ONLY_STATE_ANALYTICS_ACTIONS;
export const AGENT_READ_ONLY_TASK_TOOL_MODES = READ_ONLY_TASK_TOOL_MODES;
export const AGENT_READ_ONLY_TEAM_TOOL_MODES = READ_ONLY_TEAM_TOOL_MODES;
export const AGENT_READ_ONLY_WORKLIST_TOOL_MODES = READ_ONLY_WORKLIST_TOOL_MODES;
export const AGENT_READ_ONLY_PACKET_TOOL_MODES = READ_ONLY_PACKET_TOOL_MODES;
export const AGENT_READ_ONLY_QUERY_TOOL_MODES = READ_ONLY_QUERY_TOOL_MODES;
export const AGENT_READ_ONLY_CONTROL_TOOL_MODES = READ_ONLY_CONTROL_TOOL_MODES;
export const AGENT_REMOTE_MUTATION_DENIAL_MESSAGE = REMOTE_MUTATION_DENIAL;
export const AGENT_CHANNEL_ACTION_DENIAL_MESSAGE = CHANNEL_ACTION_DENIAL;
export const AGENT_MCP_SECURITY_MUTATION_DENIAL_MESSAGE = MCP_SECURITY_MUTATION_DENIAL;
export const AGENT_FETCH_NETWORK_MUTATION_DENIAL_MESSAGE = FETCH_NETWORK_MUTATION_DENIAL;
export const AGENT_STATE_MUTATION_DENIAL_MESSAGE = STATE_MUTATION_DENIAL;
export const AGENT_SETTINGS_MUTATION_DENIAL_MESSAGE = SETTINGS_MUTATION_DENIAL;
export const AGENT_INSPECT_WRITE_DENIAL_MESSAGE = INSPECT_WRITE_DENIAL;
export const AGENT_DURABLE_WORKFLOW_MUTATION_DENIAL_MESSAGE = DURABLE_WORKFLOW_MUTATION_DENIAL;
export const AGENT_CONTROL_MUTATION_DENIAL_MESSAGE = CONTROL_MUTATION_DENIAL;

export {
  AGENT_CONTEXT_TOOL_DENIAL_MESSAGE,
  wrapBlockedContextToolForAgentPolicy,
} from './agent-context-policy.ts';

export {
  AGENT_ANALYZE_NETWORK_DENIAL_MESSAGE,
  AGENT_READ_ONLY_ANALYZE_TOOL_MODES,
  AGENT_READ_ONLY_REGISTRY_TOOL_MODES,
  AGENT_REGISTRY_CONTENT_DENIAL_MESSAGE,
  validateAnalyzeToolInvocationForAgentPolicy,
  validateRegistryToolInvocationForAgentPolicy,
  wrapAnalyzeToolForAgentPolicy,
  wrapRegistryToolForAgentPolicy,
} from './agent-analysis-registry-policy.ts';

export {
  AGENT_MAX_READ_FILES,
  AGENT_MAX_READ_IMAGE_SIZE_BYTES,
  AGENT_READ_IMAGE_MODES,
  AGENT_READ_POLICY_DENIAL_MESSAGE,
  isBlockedReadPath,
  validateReadToolInvocationForAgentPolicy,
  wrapReadToolForAgentPolicy,
} from './agent-read-policy.ts';

export {
  AGENT_FIND_POLICY_DENIAL_MESSAGE,
  AGENT_READ_ONLY_FIND_OUTPUT_FORMATS,
  normalizeFindToolInvocationForAgentPolicy,
  validateFindToolInvocationForAgentPolicy,
  wrapFindToolForAgentPolicy,
} from './agent-find-policy.ts';

export {
  AGENT_MAX_WEB_SEARCH_EVIDENCE_TOP_N,
  AGENT_MAX_WEB_SEARCH_RESULTS,
  AGENT_READ_ONLY_WEB_SEARCH_EVIDENCE_EXTRACTS,
  AGENT_READ_ONLY_WEB_SEARCH_VERBOSITIES,
  AGENT_WEB_SEARCH_POLICY_DENIAL_MESSAGE,
  normalizeWebSearchToolInvocationForAgentPolicy,
  validateWebSearchToolInvocationForAgentPolicy,
  wrapWebSearchToolForAgentPolicy,
} from './agent-web-search-policy.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function narrowAgentToolDefinitionForAgentPolicy(tool: Tool): void {
  tool.definition.description = [
    'Read-only local Agent inspection for GoodVibes Agent.',
    'This product does not spawn local worker agents or run local WRFC chains.',
    'For build/fix/review work, delegate to GoodVibes TUI through the explicit build-delegation path instead.',
  ].join(' ');
  tool.definition.sideEffects = [];

  const properties = tool.definition.parameters.properties;
  if (!isRecord(properties)) return;
  const modeProperty = properties.mode;
  if (!isRecord(modeProperty)) return;
  modeProperty.enum = [...READ_ONLY_AGENT_TOOL_MODES];
  modeProperty.description = 'Read-only Agent inspection mode. Local spawn, batch-spawn, cancel, message, wait, and plan modes are disabled in GoodVibes Agent.';
}

function narrowExecToolDefinitionForAgentPolicy(tool: Tool): void {
  tool.definition.description = [
    'Execute foreground shell commands serially for GoodVibes Agent main-conversation work.',
    'Background processes, parallel batches, background process controls, and exec file_ops are disabled by Agent policy.',
    'Delegate long-running build/fix/review execution to GoodVibes TUI instead.',
  ].join(' ');

  const properties = tool.definition.parameters.properties;
  if (!isRecord(properties)) return;
  delete properties.parallel;
  delete properties.file_ops;

  const commandsProperty = properties.commands;
  if (!isRecord(commandsProperty)) return;
  const itemSchema = commandsProperty.items;
  if (!isRecord(itemSchema)) return;
  const commandProperties = itemSchema.properties;
  if (!isRecord(commandProperties)) return;

  delete commandProperties.background;
  const untilProperty = commandProperties.until;
  if (isRecord(untilProperty)) {
    untilProperty.description = [
      'Pattern-based early termination.',
      'GoodVibes Agent requires kill_after:true so until-mode does not promote the process to background.',
    ].join(' ');
  }
}

function narrowFetchToolDefinitionForAgentPolicy(tool: Tool): void {
  tool.definition.description = [
    'Fetch public URLs for GoodVibes Agent with serial, read-only HTTP requests.',
    'Only GET, HEAD, and OPTIONS are available in the main conversation.',
    'Credentialed requests, request bodies, trust overrides, raw unsanitized responses, and parallel batches are disabled by Agent policy.',
  ].join(' ');

  const properties = tool.definition.parameters.properties;
  if (!isRecord(properties)) return;
  delete properties.parallel;
  delete properties.trusted_hosts;

  const sanitizeModeProperty = properties.sanitize_mode;
  if (isRecord(sanitizeModeProperty)) {
    sanitizeModeProperty.enum = ['safe-text', 'strict'];
    sanitizeModeProperty.description = 'Response sanitization mode. Raw unsanitized responses are disabled in GoodVibes Agent.';
  }

  const urlsProperty = properties.urls;
  if (!isRecord(urlsProperty)) return;
  const itemSchema = urlsProperty.items;
  if (!isRecord(itemSchema)) return;
  const urlProperties = itemSchema.properties;
  if (!isRecord(urlProperties)) return;

  const methodProperty = urlProperties.method;
  if (isRecord(methodProperty)) {
    methodProperty.enum = [...READ_ONLY_FETCH_METHODS];
    methodProperty.description = 'Read-only HTTP method. GoodVibes Agent disables POST, PUT, PATCH, and DELETE in the main conversation.';
  }

  delete urlProperties.headers;
  delete urlProperties.body;
  delete urlProperties.body_base64;
  delete urlProperties.body_type;
  delete urlProperties.body_data;
  delete urlProperties.retry_on_auth;
  delete urlProperties.service;
  delete urlProperties.auth;
}

function narrowStateToolDefinitionForAgentPolicy(tool: Tool): void {
  tool.definition.description = [
    'Inspect runtime-owned state for GoodVibes Agent.',
    'State mutation, runtime-owned memory writes, hook changes, output-mode changes, and analytics writes are disabled in the main conversation.',
    'Use Agent-owned commands for intentional memory, skill, persona, and routine changes.',
  ].join(' ');

  const properties = tool.definition.parameters.properties;
  if (!isRecord(properties)) return;
  const modeProperty = properties.mode;
  if (isRecord(modeProperty)) {
    modeProperty.enum = [...READ_ONLY_STATE_TOOL_MODES];
    modeProperty.description = 'Read-only runtime-owned state mode. set and clear are disabled in GoodVibes Agent.';
  }

  delete properties.values;
  delete properties.clearKeys;
  delete properties.memoryValue;
  delete properties.hookDefinition;
  delete properties.hookName;
  delete properties.modeName;
  delete properties.analyticsTool;
  delete properties.analyticsArgs;
  delete properties.analyticsResult;
  delete properties.analyticsDuration;
  delete properties.analyticsTokens;
  delete properties.analyticsFormat;

  narrowStringEnumProperty(properties, 'memoryAction', READ_ONLY_STATE_MEMORY_ACTIONS, 'Read-only runtime-owned memory actions allowed by GoodVibes Agent.');
  narrowStringEnumProperty(properties, 'hookAction', READ_ONLY_STATE_HOOK_ACTIONS, 'Read-only hook action allowed by GoodVibes Agent.');
  narrowStringEnumProperty(properties, 'modeAction', READ_ONLY_STATE_MODE_ACTIONS, 'Read-only mode actions allowed by GoodVibes Agent.');
  narrowStringEnumProperty(properties, 'analyticsAction', READ_ONLY_STATE_ANALYTICS_ACTIONS, 'Read-only analytics actions allowed by GoodVibes Agent.');
}

function narrowInspectToolDefinitionForAgentPolicy(tool: Tool): void {
  tool.definition.description = [
    'Inspect and analyze project structure for GoodVibes Agent.',
    'Scaffold mode is dry-run-only in the main conversation; code creation must be delegated to GoodVibes TUI.',
  ].join(' ');

  const properties = tool.definition.parameters.properties;
  if (!isRecord(properties)) return;
  delete properties.dryRun;
}

function narrowModeToolDefinitionForAgentPolicy(tool: Tool, allowedModes: readonly string[], description: string): void {
  tool.definition.description = description;
  tool.definition.sideEffects = [];

  const properties = tool.definition.parameters.properties;
  if (!isRecord(properties)) return;
  const modeProperty = properties.mode;
  if (isRecord(modeProperty)) {
    modeProperty.enum = [...allowedModes];
    modeProperty.description = 'Read-only modes allowed by GoodVibes Agent main-conversation policy.';
  }

  if (tool.definition.name === 'channel') {
    delete properties.accountAction;
    delete properties.toolId;
    delete properties.actionId;
    delete properties.actorId;
    delete properties.createIfMissing;
  }
}

function removeToolDefinitionProperties(tool: Tool, keys: readonly string[]): void {
  const properties = tool.definition.parameters.properties;
  if (!isRecord(properties)) return;
  for (const key of keys) delete properties[key];
}

function narrowStringEnumProperty(
  properties: Record<string, unknown>,
  key: string,
  values: readonly string[],
  description: string,
): void {
  const property = properties[key];
  if (!isRecord(property)) return;
  property.enum = [...values];
  property.description = description;
}
