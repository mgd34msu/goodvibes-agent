import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';

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
  'wrfc-chains',
  'wrfc-history',
  'cohort-status',
  'cohort-report',
] as const;

const READ_ONLY_AGENT_TOOL_MODE_SET = new Set<string>(READ_ONLY_AGENT_TOOL_MODES);
const BLOCKED_MAIN_CONVERSATION_TOOL_NAME_SET = new Set<string>(BLOCKED_MAIN_CONVERSATION_TOOL_NAMES);

const READ_ONLY_REMOTE_TOOL_MODES = ['pools', 'contracts', 'artifacts', 'review'] as const;
const READ_ONLY_CHANNEL_TOOL_MODES = ['accounts', 'directory', 'resolve_target', 'capabilities', 'tools', 'agent_tools', 'actions'] as const;
const READ_ONLY_REMOTE_TOOL_MODE_SET = new Set<string>(READ_ONLY_REMOTE_TOOL_MODES);
const READ_ONLY_CHANNEL_TOOL_MODE_SET = new Set<string>(READ_ONLY_CHANNEL_TOOL_MODES);

const LOCAL_AGENT_DENIAL = [
  'GoodVibes Agent does not spawn local Engineer/Reviewer/Tester/Verifier roots or run local WRFC chains.',
  'Keep ordinary assistant work serial in the main conversation.',
  'For explicit build/fix/review work, delegate one request to GoodVibes TUI through the public shared-session/build-delegation contract with the full original user ask.',
].join(' ');

const LOCAL_CODING_TOOL_DENIAL = [
  'GoodVibes Agent does not perform direct local file mutation, local WRFC workflow execution, or local sandbox/REPL execution from the main conversation.',
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

export function installAgentToolPolicyGuard(registry: ToolRegistry, options: AgentToolPolicyGuardOptions = {}): void {
  const agentTool = registry.list().find((tool) => tool.definition.name === 'agent');
  if (!agentTool) throw new Error('Agent tool policy guard could not find the agent tool.');
  wrapAgentToolForAgentPolicy(agentTool, options);
  for (const tool of registry.list()) {
    if (tool.definition.name === 'exec') {
      wrapExecToolForAgentPolicy(tool);
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

type ModeRestrictedToolPolicy = {
  readonly allowedModes: readonly string[];
  readonly modeSet: ReadonlySet<string>;
  readonly description: string;
  readonly denial: string;
};

export function wrapModeRestrictedToolForAgentPolicy(tool: Tool, policy: ModeRestrictedToolPolicy): void {
  narrowModeToolDefinitionForAgentPolicy(tool, policy.allowedModes, policy.description);
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
export const AGENT_REMOTE_MUTATION_DENIAL_MESSAGE = REMOTE_MUTATION_DENIAL;
export const AGENT_CHANNEL_ACTION_DENIAL_MESSAGE = CHANNEL_ACTION_DENIAL;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function narrowModeToolDefinitionForAgentPolicy(tool: Tool, allowedModes: readonly string[], description: string): void {
  tool.definition.description = description;

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

// Compatibility exports for copied TUI tests/imports during the near-fork phase.
export const installWrfcAgentToolGuard = installAgentToolPolicyGuard;
export const wrapWrfcAgentTool = wrapAgentToolForAgentPolicy;
export const validateWrfcAgentToolInvocation = validateAgentToolInvocationForAgentPolicy;
export const normalizeWrfcAgentToolInvocation = normalizeAgentToolInvocationForAgentPolicy;
