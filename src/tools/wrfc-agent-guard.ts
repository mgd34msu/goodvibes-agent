import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';

type AgentToolArgs = {
  readonly mode?: unknown;
  readonly [key: string]: unknown;
};

type AgentToolPolicyGuardOptions = {
  readonly getLastUserMessage?: () => string | null;
};

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
  const originalExecute = tool.execute.bind(tool);
  tool.execute = async (args) => {
    const denial = validateAgentToolInvocationForAgentPolicy(args as AgentToolArgs);
    if (denial) return { success: false, error: denial };
    return originalExecute(normalizeAgentToolInvocationForAgentPolicy(args as AgentToolArgs) as Parameters<Tool['execute']>[0]);
  };
}

export function validateAgentToolInvocationForAgentPolicy(args: AgentToolArgs): string | null {
  if (args.mode === 'spawn' || args.mode === 'batch-spawn') return LOCAL_AGENT_DENIAL;
  return null;
}

export function normalizeAgentToolInvocationForAgentPolicy(args: AgentToolArgs): AgentToolArgs {
  return args;
}

export const AGENT_LOCAL_SPAWN_DENIAL_MESSAGE = LOCAL_AGENT_DENIAL;

// Compatibility exports for copied TUI tests/imports during the near-fork phase.
export const installWrfcAgentToolGuard = installAgentToolPolicyGuard;
export const wrapWrfcAgentTool = wrapAgentToolForAgentPolicy;
export const validateWrfcAgentToolInvocation = validateAgentToolInvocationForAgentPolicy;
export const normalizeWrfcAgentToolInvocation = normalizeAgentToolInvocationForAgentPolicy;
