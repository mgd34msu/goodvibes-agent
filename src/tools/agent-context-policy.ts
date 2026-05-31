import type { Tool } from '@pellux/goodvibes-sdk/platform/types';

const CONTEXT_TOOL_DENIAL = [
  'GoodVibes Agent does not expose copied GoodVibes runtime context through model tools in the main conversation.',
  'The copied context tool can describe TUI/default runtime assumptions that are not the Agent product boundary.',
  'Use explicit Agent CLI/slash commands such as status, compat, setup, and isolated Agent Knowledge instead.',
].join(' ');

export function wrapBlockedContextToolForAgentPolicy(tool: Tool): void {
  tool.definition.description = [
    'Blocked in GoodVibes Agent main conversation: copied runtime context.',
    'Use explicit Agent CLI/slash status, compat, setup, and Agent Knowledge commands for product-scoped context.',
    'Default Knowledge/Wiki, non-Agent knowledge segments, and copied TUI runtime assumptions are not Agent fallbacks.',
  ].join(' ');
  tool.definition.sideEffects = [];
  tool.definition.parameters = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
  tool.execute = async () => ({ success: false, error: CONTEXT_TOOL_DENIAL });
}

export const AGENT_CONTEXT_TOOL_DENIAL_MESSAGE = CONTEXT_TOOL_DENIAL;
