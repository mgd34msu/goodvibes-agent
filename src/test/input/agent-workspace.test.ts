import { describe, expect, test } from 'bun:test';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { AgentWorkspace, buildAgentWorkspaceRuntimeSnapshot, handleAgentWorkspaceToken } from '../../input/agent-workspace.ts';
import { registerAgentWorkspaceRuntimeCommands } from '../../input/commands/agent-workspace-runtime.ts';

function commandContext(calls: string[] = []): CommandContext {
  return {
    executeCommand: async (name: string, args: string[]) => {
      calls.push([name, ...args].join(' '));
      return true;
    },
    print: (text: string) => {
      calls.push(`print:${text}`);
    },
  } as unknown as CommandContext;
}

describe('AgentWorkspace', () => {
  test('opens as an operator workspace and keeps guidance actions local', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));

    expect(workspace.active).toBe(true);
    expect(workspace.selectedCategory.label).toBe('Home');
    expect(workspace.selectedAction?.label).toBe('Continue assistant chat');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.status).toContain('main conversation');
  });

  test('dispatches command actions through the shell-owned callback', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedActionIndex = 1;

    workspace.activateSelected();

    expect(dispatched).toEqual(['/model']);
    expect(workspace.status).toContain('/model');
  });

  test('dispatches local persona library through the command router', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/personas']);
    expect(workspace.status).toContain('/personas');
  });

  test('dispatches local skill library through the command router', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/agent-skills']);
    expect(workspace.status).toContain('/agent-skills');
  });

  test('dispatches local routine library through the command router', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/routines']);
    expect(workspace.status).toContain('/routines');
  });

  test('dispatches channel pairing through the command router', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'channels');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'pair');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/pair']);
    expect(workspace.status).toContain('/pair');
  });

  test('keeps channel delivery safety guidance local', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'channels');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'channel-safety');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.lastActionResult?.kind).toBe('guidance');
    expect(workspace.status).toContain('will not silently send');
  });

  test('summarizes channel readiness without exposing secret config values', () => {
    const configValues = new Map<string, unknown>([
      ['surfaces.slack.enabled', true],
      ['surfaces.slack.botToken', 'goodvibes://secrets/goodvibes/SLACK_BOT_TOKEN'],
      ['surfaces.slack.signingSecret', 'goodvibes://secrets/goodvibes/SLACK_SIGNING_SECRET'],
      ['surfaces.slack.defaultChannel', '#ops'],
      ['surfaces.discord.enabled', true],
      ['surfaces.discord.botToken', 'goodvibes://secrets/goodvibes/DISCORD_BOT_TOKEN'],
    ]);
    const snapshot = buildAgentWorkspaceRuntimeSnapshot({
      ...commandContext(),
      platform: {
        configManager: {
          get: (key: string) => configValues.get(key),
        },
      },
    } as unknown as CommandContext);

    const slack = snapshot.channels.find((channel) => channel.id === 'slack');
    const discord = snapshot.channels.find((channel) => channel.id === 'discord');

    expect(snapshot.channels).toHaveLength(13);
    expect(slack?.ready).toBe(true);
    expect(slack?.defaultTarget).toBe('configured');
    expect(slack?.delivery).toBe('default-ready');
    expect(discord?.ready).toBe(false);
    expect(discord?.missingConfigCount).toBe(2);
    expect(JSON.stringify(snapshot.channels)).not.toContain('SLACK_BOT_TOKEN');
    expect(JSON.stringify(snapshot.channels)).not.toContain('DISCORD_BOT_TOKEN');
  });

  test('exposes Agent Knowledge review queue without default wiki fallback', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-review-queue');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/knowledge queue']);
    expect(workspace.status).toContain('/knowledge queue');
    expect(workspace.selectedCategory.detail).toContain('/api/goodvibes-agent/knowledge');
    expect(workspace.selectedCategory.detail).toContain('Default regular wiki and HomeGraph are not');
  });

  test('does not dispatch Agent Knowledge ingest templates without real target values', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-ingest-url');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.lastActionResult?.kind).toBe('guidance');
    expect(workspace.status).toContain('Placeholder command not dispatched');
  });

  test('blocks copied TUI-only blocked commands inside the workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'remote-policy');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.status).toContain('Blocked here');
    expect(workspace.lastActionResult?.kind).toBe('blocked');
    expect(workspace.lastActionResult?.command).toBe('/remote dispatch');
  });

  test('does not dispatch template delegation commands from the workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'review-command');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.lastActionResult?.kind).toBe('guidance');
    expect(workspace.status).toContain('actual task text');
  });

  test('refresh key rereads the live runtime snapshot', () => {
    const workspace = new AgentWorkspace();
    const runtime = {
      model: 'openai:gpt-5.5',
      provider: 'openai-subscriber',
      sessionId: 'session-1',
      debugMode: false,
      systemPrompt: '',
      reasoningEffort: 'medium',
    };
    const ctx = {
      executeCommand: async () => true,
      print: () => undefined,
      session: {
        runtime,
        sessionMemoryStore: { list: () => [] },
      },
      provider: {
        providerRegistry: {
          getCurrentModel: () => ({
            id: 'gpt-5.5',
            provider: runtime.provider,
            displayName: runtime.model,
            registryKey: runtime.model,
            contextWindow: 256000,
          }),
        },
      },
    } as unknown as CommandContext;

    workspace.open(ctx, () => undefined);
    expect(workspace.runtimeSnapshot?.model).toBe('openai:gpt-5.5');

    runtime.model = 'anthropic:claude-sonnet-4.5';
    handleAgentWorkspaceToken(workspace, { type: 'text', value: 'r' }, () => undefined, () => undefined);

    expect(workspace.runtimeSnapshot?.model).toBe('anthropic:claude-sonnet-4.5');
    expect(workspace.status).toContain('refreshed');
    expect(workspace.lastActionResult?.kind).toBe('refreshed');
  });

  test('token routing supports pane focus and navigation', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined);

    handleAgentWorkspaceToken(workspace, { type: 'key', logicalName: 'left', ctrl: false, meta: false, shift: false, alt: false }, () => undefined, () => undefined);
    expect(workspace.focusPane).toBe('categories');

    handleAgentWorkspaceToken(workspace, { type: 'key', logicalName: 'down', ctrl: false, meta: false, shift: false, alt: false }, () => undefined, () => undefined);
    expect(workspace.selectedCategory.label).toBe('Setup');

    handleAgentWorkspaceToken(workspace, { type: 'key', logicalName: 'right', ctrl: false, meta: false, shift: false, alt: false }, () => undefined, () => undefined);
    expect(workspace.focusPane).toBe('actions');
  });

  test('registers /agent, /home, and /operator aliases', async () => {
    const registry = new CommandRegistry();
    registerAgentWorkspaceRuntimeCommands(registry);
    const opened: string[] = [];
    const ctx = {
      openAgentWorkspace: () => opened.push('agent'),
      print: (text: string) => opened.push(`print:${text}`),
    } as unknown as CommandContext;

    expect(await registry.execute('agent', [], ctx)).toBe(true);
    expect(await registry.execute('home', [], ctx)).toBe(true);
    expect(await registry.execute('operator', [], ctx)).toBe(true);
    expect(opened).toEqual(['agent', 'agent', 'agent']);
  });
});
