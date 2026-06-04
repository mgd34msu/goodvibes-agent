import type { Tool } from '@pellux/goodvibes-sdk/platform/types';

const CONTEXT_TOOL_DENIAL = [
  'GoodVibes Agent does not expose non-Agent runtime context through model tools in the main conversation.',
  'The runtime context tool can describe assumptions that are outside the Agent product boundary.',
  'Use explicit Agent CLI/slash commands such as status, compat, setup, and isolated Agent Knowledge instead.',
].join(' ');

export function wrapBlockedContextToolForAgentPolicy(tool: Tool): void {
  tool.definition.description = 'Blocked in GoodVibes Agent: non-Agent runtime context.';
  tool.definition.sideEffects = [];
  tool.definition.parameters = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
  tool.execute = async () => ({ success: false, error: CONTEXT_TOOL_DENIAL });
}

export const AGENT_CONTEXT_TOOL_DENIAL_MESSAGE = CONTEXT_TOOL_DENIAL;
