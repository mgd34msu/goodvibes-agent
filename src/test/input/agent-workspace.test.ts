import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { AgentWorkspace, buildAgentWorkspaceRuntimeSnapshot, handleAgentWorkspaceToken } from '../../input/agent-workspace.ts';
import { registerAgentWorkspaceRuntimeCommands } from '../../input/commands/agent-workspace-runtime.ts';
import { registerAgentRuntimeProfileRuntimeCommands } from '../../input/commands/agent-runtime-profile-runtime.ts';
import { createAgentRuntimeProfile } from '../../agent/runtime-profile.ts';
import { createShellPathService } from '@/runtime/index.ts';

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

  test('dispatches live daemon capability audit from the workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'capabilities');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'capabilities-daemon');

    workspace.activateSelected();

    expect(workspace.selectedCategory.detail).toContain('/api/goodvibes-agent/knowledge');
    expect(workspace.selectedAction?.detail).toContain('Does not query default Knowledge/Wiki or HomeGraph');
    expect(dispatched).toEqual(['/capabilities daemon']);
    expect(workspace.status).toContain('/capabilities daemon');
  });

  test('dispatches filtered daemon capability audit from the workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'capabilities');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'capabilities-daemon-knowledge');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/capabilities daemon knowledge']);
    expect(workspace.status).toContain('/capabilities daemon knowledge');
  });

  test('dispatches daemon capability gap plan from the workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'capabilities');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'capabilities-daemon-gaps');

    workspace.activateSelected();

    expect(workspace.selectedAction?.detail).toContain('platform gaps');
    expect(dispatched).toEqual(['/capabilities daemon gaps']);
    expect(workspace.status).toContain('/capabilities daemon gaps');
  });

  test('dispatches full daemon method inventory from the workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'capabilities');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'capabilities-daemon-inventory');

    workspace.activateSelected();

    expect(workspace.selectedAction?.detail).toContain('every public daemon method');
    expect(dispatched).toEqual(['/capabilities daemon inventory']);
    expect(workspace.status).toContain('/capabilities daemon inventory');
  });

  test('dispatches approval route risk review from the workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'work');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'approval-risk');

    workspace.activateSelected();

    expect(workspace.selectedAction?.detail).toContain('without approving');
    expect(dispatched).toEqual(['/approval risk']);
    expect(workspace.status).toContain('/approval risk');
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

  test('summarizes voice and media provider coverage in the runtime snapshot', () => {
    const snapshot = buildAgentWorkspaceRuntimeSnapshot({
      ...commandContext(),
      platform: {
        configManager: {
          get: (key: string) => new Map<string, unknown>([
            ['tts.provider', 'elevenlabs'],
            ['tts.voice', 'voice-operator'],
            ['tts.llmProvider', 'openai-subscriber'],
            ['tts.llmModel', 'gpt-5.5'],
            ['ui.voiceEnabled', true],
            ['web.enabled', true],
            ['web.publicBaseUrl', 'https://agent.example.test'],
          ]).get(key),
        },
        voiceProviderRegistry: {
          list: () => [
            { id: 'elevenlabs', label: 'ElevenLabs', capabilities: ['tts-stream', 'stt', 'realtime'] },
            { id: 'deepgram', label: 'Deepgram', capabilities: ['stt'] },
          ],
        },
        mediaProviderRegistry: {
          list: () => [
            { id: 'builtin:image-understanding', label: 'Image Understanding', capabilities: ['understand'] },
            { id: 'fal', label: 'Fal', capabilities: ['generate'] },
          ],
        },
      },
    } as unknown as CommandContext);

    expect(snapshot.voiceProviderCount).toBe(2);
    expect(snapshot.voiceStreamingProviderCount).toBe(1);
    expect(snapshot.voiceSttProviderCount).toBe(2);
    expect(snapshot.voiceRealtimeProviderCount).toBe(1);
    expect(snapshot.ttsProvider).toBe('elevenlabs');
    expect(snapshot.ttsVoice).toBe('voice-operator');
    expect(snapshot.ttsResponseModel).toBe('openai-subscriber/gpt-5.5');
    expect(snapshot.voiceSurfaceEnabled).toBe(true);
    expect(snapshot.mediaProviderCount).toBe(2);
    expect(snapshot.mediaUnderstandingProviderCount).toBe(1);
    expect(snapshot.mediaGenerationProviderCount).toBe(1);
    expect(snapshot.browserSurfaceEnabled).toBe(true);
    expect(snapshot.browserSurfacePublicBaseUrl).toBe('https://agent.example.test');
  });

  test('does not dispatch voice media command templates without real target values', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'voice-media');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'tts-speak');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.lastActionResult?.kind).toBe('guidance');
    expect(workspace.status).toContain('Placeholder command not dispatched');
  });

  test('summarizes runtime and config profile posture', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-profiles-'));
    createAgentRuntimeProfile(root, 'household');
    const snapshot = buildAgentWorkspaceRuntimeSnapshot({
      ...commandContext(),
      workspace: {
        shellPaths: {
          workingDirectory: root,
          homeDirectory: root,
        },
        profileManager: {
          list: () => [
            { name: 'operator', timestamp: Date.now() },
            { name: 'travel', timestamp: Date.now() - 1000 },
          ],
        },
      },
      platform: {
        configManager: {
          get: () => undefined,
        },
      },
    } as unknown as CommandContext);

    expect(snapshot.activeRuntimeProfile).toBe('(default home)');
    expect(snapshot.runtimeProfileCount).toBe(1);
    expect(snapshot.runtimeProfileRoot).toContain('profile-homes');
    expect(snapshot.runtimeStarterTemplateCount).toBeGreaterThan(4);
    expect(snapshot.localStarterTemplateCount).toBe(0);
    expect(snapshot.configProfileCount).toBe(2);
  });

  test('agent profile command guides starter authoring and imports local starters', async () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-starter-author-'));
    const starterPath = join(root, 'starter.json');
    const calls: string[] = [];
    const registry = new CommandRegistry();
    registerAgentRuntimeProfileRuntimeCommands(registry);
    const ctx = {
      ...commandContext(),
      print: (text: string) => calls.push(text),
      workspace: {
        shellPaths: createShellPathService({ workingDirectory: root, homeDirectory: root }),
      },
    } as unknown as CommandContext;

    expect(await registry.execute('agent-profile', ['guide'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('Agent Starter Authoring Guide');
    expect(calls.at(-1)).toContain('/agent-profile template export research');

    expect(await registry.execute('agent-profile', ['template', 'export', 'research', './starter.json', '--yes'], ctx)).toBe(true);
    const exported = JSON.parse(readFileSync(starterPath, 'utf-8')) as {
      template: {
        id: string;
        name: string;
        description: string;
      };
    };
    exported.template.id = 'lab-operator';
    exported.template.name = 'Lab Operator';
    exported.template.description = 'Custom lab operator profile starter.';
    writeFileSync(starterPath, `${JSON.stringify(exported, null, 2)}\n`, 'utf-8');

    expect(await registry.execute('agent-profile', ['template', 'import', './starter.json', '--yes'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('Agent starter template imported: lab-operator');
    expect(await registry.execute('agent-profile', ['templates'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('lab-operator');
    expect(calls.at(-1)).toContain('[local');

    expect(await registry.execute('agent-profile', ['create', 'lab', '--template', 'lab-operator', '--yes'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('Agent runtime profile created: lab');
    expect(calls.at(-1)).toContain('starter: lab-operator');
    expect(await registry.execute('agent-profile', ['list'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('starter=lab-operator');
  });

  test('does not dispatch profile export templates without real target values', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'profile-sync-export');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.lastActionResult?.kind).toBe('guidance');
    expect(workspace.status).toContain('Placeholder command not dispatched');
  });

  test('dispatches starter authoring guide from the workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-guide');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/agent-profile guide']);
    expect(workspace.status).toContain('/agent-profile guide');
  });

  test('automation workspace dispatches routine promotion receipt review', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'automation');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'schedule-receipts');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/schedule receipts']);
    expect(workspace.status).toContain('/schedule receipts');
  });

  test('automation workspace dispatches routine schedule reconciliation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'automation');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'schedule-reconcile');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/schedule reconcile']);
    expect(workspace.status).toContain('/schedule reconcile');
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
