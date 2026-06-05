import { describe, expect, test } from 'bun:test';
import { AgentWorkspace } from '../../input/agent-workspace.ts';
import type { CommandContext } from '../../input/command-registry.ts';
import { createAgentWorkspaceFullscreenComposite } from '../../shell/agent-workspace-fullscreen.ts';

function commandContext(): CommandContext {
  return {
    executeCommand: async () => true,
    print: () => undefined,
    session: {},
    provider: {},
    workspace: {},
    platform: {},
    ops: {},
    extensions: {},
  } as unknown as CommandContext;
}

describe('createAgentWorkspaceFullscreenComposite', () => {
  test('uses the whole terminal frame without shell chrome or panel layout', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined);

    const width = 132;
    const height = 37;
    const composite = createAgentWorkspaceFullscreenComposite(workspace, width, height);

    expect(composite.width).toBe(width);
    expect(composite.height).toBe(height);
    expect(composite.header).toEqual([]);
    expect(composite.footer).toEqual([]);
    expect(composite.panel).toBeUndefined();
    expect(composite.panelWidth).toBe(0);
    expect(composite.selection).toBeUndefined();
    expect(composite.search).toBeUndefined();
    expect(composite.forceFullRedraw).toBe(true);
    expect(composite.viewport).toHaveLength(height);
    expect(composite.viewport.every((line) => line.length === width)).toBe(true);
  });
});
