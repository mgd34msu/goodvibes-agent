import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';

type AgentToolArgs = {
  readonly mode?: unknown;
  readonly [key: string]: unknown;
};

type AgentToolPolicyGuardOptions = {
  readonly getLastUserMessage?: () => string | null;
};

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

const LOCAL_AGENT_DENIAL = [
  'GoodVibes Agent does not spawn local Engineer/Reviewer/Tester/Verifier roots or run local WRFC chains.',
  'Keep ordinary assistant work serial in the main conversation.',
  'For explicit build/fix/review work, delegate one request to GoodVibes TUI through the public shared-session/build-delegation contract with the full original user ask.',
].join(' ');

export function installAgentToolPolicyGuard(registry: ToolRegistry, options: AgentToolPolicyGuardOptions = {}): void {
  const agentTool = registry.list().find((tool) => tool.definition.name === 'agent');
  if (!agentTool) throw new Error('Agent tool policy guard could not find the agent tool.');
  wrapAgentToolForAgentPolicy(agentTool, options);
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

export const AGENT_LOCAL_SPAWN_DENIAL_MESSAGE = LOCAL_AGENT_DENIAL;
export const AGENT_READ_ONLY_TOOL_MODES = READ_ONLY_AGENT_TOOL_MODES;

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

// Compatibility exports for copied TUI tests/imports during the near-fork phase.
export const installWrfcAgentToolGuard = installAgentToolPolicyGuard;
export const wrapWrfcAgentTool = wrapAgentToolForAgentPolicy;
export const validateWrfcAgentToolInvocation = validateAgentToolInvocationForAgentPolicy;
export const normalizeWrfcAgentToolInvocation = normalizeAgentToolInvocationForAgentPolicy;
