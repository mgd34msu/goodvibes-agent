import { describe, expect, test } from 'bun:test';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { CommandContext, CommandRegistry } from '../../input/command-registry.ts';
import { createAgentWorkspaceTool, registerAgentWorkspaceTool } from '../../tools/agent-workspace-tool.ts';

function fakeTool(calls: Record<string, unknown>[]): Tool {
  return {
    definition: {
      name: 'agent_harness',
      description: 'Fake harness',
      parameters: { type: 'object', additionalProperties: true },
    },
    execute: async (args: Record<string, unknown>) => {
      calls.push(args);
      return { success: true, output: JSON.stringify({ args }) };
    },
  };
}

function makeTool(calls: Record<string, unknown>[] = []): Tool {
  return createAgentWorkspaceTool({
    commandRegistry: {} as CommandRegistry,
    commandContext: { workspace: {}, platform: {}, session: { runtime: {} } } as CommandContext,
    toolRegistry: new ToolRegistry(),
    harnessTool: fakeTool(calls),
  });
}

describe('workspace adapter', () => {
  test('routes workspace categories, actions, and confirmed action runs', async () => {
    const calls: Record<string, unknown>[] = [];
    const tool = makeTool(calls);

    await tool.execute({});
    await tool.execute({ action: 'actions', categoryId: 'documents', query: 'review', limit: 4 });
    await tool.execute({ actionId: 'document-create-draft', includeParameters: true });
    await tool.execute({ action: 'run', workspaceActionId: 'document-create-draft', fields: { title: 'Draft' }, confirm: true, explicitUserRequest: 'Create the draft.' });

    expect(calls).toEqual([
      { mode: 'workspace' },
      { mode: 'workspace_actions', categoryId: 'documents', query: 'review', limit: 4 },
      { mode: 'workspace_action', actionId: 'document-create-draft', includeParameters: true },
      { mode: 'run_workspace_action', actionId: 'document-create-draft', fields: { title: 'Draft' }, confirm: true, explicitUserRequest: 'Create the draft.' },
    ]);
  });

  test('routes visible UI, panels, shortcuts, and keybinding effects', async () => {
    const calls: Record<string, unknown>[] = [];
    const tool = makeTool(calls);

    await tool.execute({ action: 'surfaces', query: 'workspace' });
    await tool.execute({ surfaceId: 'agent-workspace', includeParameters: true });
    await tool.execute({ action: 'open', surfaceId: 'agent-workspace', target: 'documents', confirm: true, explicitUserRequest: 'Open Documents.' });
    await tool.execute({ action: 'panels' });
    await tool.execute({ action: 'open_panel', panelId: 'tools', pane: 'bottom', confirm: true, explicitUserRequest: 'Open tools panel.' });
    await tool.execute({ action: 'shortcuts' });
    await tool.execute({ action: 'keybinding', actionId: 'screen-clear' });
    await tool.execute({ action: 'set_keybinding', actionId: 'screen-clear', value: 'Ctrl+L', confirm: true, explicitUserRequest: 'Bind clear screen.' });

    expect(calls).toEqual([
      { mode: 'ui_surfaces', query: 'workspace' },
      { mode: 'ui_surface', surfaceId: 'agent-workspace', includeParameters: true },
      { mode: 'open_ui_surface', surfaceId: 'agent-workspace', target: 'documents', confirm: true, explicitUserRequest: 'Open Documents.' },
      { mode: 'panels' },
      { mode: 'open_panel', panelId: 'tools', pane: 'bottom', confirm: true, explicitUserRequest: 'Open tools panel.' },
      { mode: 'shortcuts' },
      { mode: 'keybinding', actionId: 'screen-clear' },
      { mode: 'set_keybinding', actionId: 'screen-clear', value: 'Ctrl+L', confirm: true, explicitUserRequest: 'Bind clear screen.' },
    ]);
  });

  test('routes slash and CLI command discovery separately from confirmed command execution', async () => {
    const calls: Record<string, unknown>[] = [];
    const tool = makeTool(calls);

    await tool.execute({ action: 'commands', query: 'settings' });
    await tool.execute({ commandName: 'settings', includeParameters: true });
    await tool.execute({ action: 'run_command', commandName: 'settings', args: ['show'], confirm: true, explicitUserRequest: 'Run /settings show.' });
    await tool.execute({ action: 'cli_commands', query: 'status' });
    await tool.execute({ action: 'cli_command', command: 'status' });

    expect(calls).toEqual([
      { mode: 'commands', query: 'settings' },
      { mode: 'command', commandName: 'settings', includeParameters: true },
      { mode: 'run_command', commandName: 'settings', args: ['show'], confirm: true, explicitUserRequest: 'Run /settings show.' },
      { mode: 'cli_commands', query: 'status' },
      { mode: 'cli_command', command: 'status' },
    ]);
  });

  test('registers the direct workspace adapter once', () => {
    const registry = new ToolRegistry();

    registerAgentWorkspaceTool(registry, {} as CommandRegistry, { workspace: {}, platform: {}, session: { runtime: {} } } as CommandContext);
    registerAgentWorkspaceTool(registry, {} as CommandRegistry, { workspace: {}, platform: {}, session: { runtime: {} } } as CommandContext);

    expect(registry.has('workspace')).toBe(true);
    expect(registry.getToolDefinitions().filter((definition) => definition.name === 'workspace')).toHaveLength(1);
  });
});
