import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { MemoryEmbeddingProviderRegistry, MemoryRegistry, MemoryStore } from '@pellux/goodvibes-sdk/platform/state';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { ConfigManager } from '../../config/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { SecretsManager } from '../../config/secrets.ts';
import { buildGoodVibesSecretKey, buildGoodVibesSecretRef } from '../../config/secret-config.ts';
import { createShellPathService } from '@/runtime/index.ts';
import { registerOperatorRuntimeCommands } from '../../input/commands/operator-runtime.ts';
import { AGENT_WORKSPACE_CATEGORIES } from '../../input/agent-workspace-categories.ts';
import { createAgentHarnessTool } from '../../tools/agent-harness-tool.ts';
import { createAgentLocalRegistryTool } from '../../tools/agent-local-registry-tool.ts';
import { AgentNoteRegistry } from '../../agent/note-registry.ts';
import { AgentSkillRegistry } from '../../agent/skill-registry.ts';
import { AgentRoutineRegistry } from '../../agent/routine-registry.ts';

type ShellPaths = ReturnType<typeof createShellPathService>;

interface HarnessFixture {
  readonly root: string;
  readonly paths: ShellPaths;
  readonly commandRegistry: CommandRegistry;
  readonly configManager: ConfigManager;
  readonly secretsManager: SecretsManager | null;
  readonly toolRegistry: ToolRegistry;
  readonly tool: ReturnType<typeof createAgentHarnessTool>;
  readonly printed: string[];
  readonly cleanup: () => void;
}

function makeShellPaths(): { readonly root: string; readonly paths: ShellPaths; readonly cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-harness-tool-'));
  mkdirSync(join(root, '.goodvibes', 'daemon'), { recursive: true });
  return {
    root,
    paths: createShellPathService({ workingDirectory: root, homeDirectory: root }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function makeConfig(paths: ShellPaths): ConfigManager {
  return new ConfigManager({
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    configDir: paths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT),
    workingDir: paths.workingDirectory,
    homeDir: paths.homeDirectory,
  });
}

function makeFixture(options: { readonly secrets?: boolean } = {}): HarnessFixture {
  const { root, paths, cleanup } = makeShellPaths();
  const commandRegistry = new CommandRegistry();
  const configManager = makeConfig(paths);
  const secretsManager = options.secrets === false
    ? null
    : new SecretsManager({ projectRoot: root, globalHome: root, configManager });
  const toolRegistry = new ToolRegistry();
  const printed: string[] = [];

  commandRegistry.register({
    name: 'brief',
    description: 'Test briefing command',
    handler: (_args, ctx) => {
      ctx.print('briefing output');
    },
  });

  const context = {
    print: (text: string) => printed.push(text),
    renderRequest: () => {},
    workspace: { shellPaths: paths },
    platform: { configManager, ...(secretsManager ? { secretsManager } : {}) },
    session: {},
    provider: {},
    ops: {},
    extensions: { toolRegistry },
  } as unknown as CommandContext;

  const tool = createAgentHarnessTool({
    commandRegistry,
    commandContext: context,
    toolRegistry,
  });
  toolRegistry.register(tool);

  return {
    root,
    paths,
    commandRegistry,
    configManager,
    secretsManager,
    toolRegistry,
    tool,
    printed,
    cleanup,
  };
}

async function createMemoryRegistry(paths: ShellPaths, configManager: ConfigManager): Promise<MemoryRegistry> {
  const embeddingRegistry = new MemoryEmbeddingProviderRegistry({ configManager });
  const store = new MemoryStore(paths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'memory.sqlite'), { embeddingRegistry });
  await store.init();
  return new MemoryRegistry(store);
}

function registerStubTool(toolRegistry: ToolRegistry, name: string): void {
  const tool: Tool = {
    definition: {
      name,
      description: `${name} test tool`,
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    execute: async () => ({ success: true, output: `${name} executed` }),
  };
  toolRegistry.register(tool);
}

describe('agent_harness tool', () => {
  test('exposes Agent workspace actions and editor schemas to the model', async () => {
    const fixture = makeFixture();
    try {
      const listed = await fixture.tool.execute({ mode: 'workspace_actions', query: 'memory create' });
      expect(listed.success).toBe(true);
      expect(listed.output).toContain('memory-create');
      expect(listed.output).toContain('Create memory');

      const listedWithEditors = await fixture.tool.execute({ mode: 'workspace_actions', query: 'memory create', includeParameters: true });
      expect(listedWithEditors.success).toBe(true);
      expect(listedWithEditors.output).toContain('"editor"');
      expect(listedWithEditors.output).toContain('"summary"');

      const action = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'memory-create' });
      expect(action.success).toBe(true);
      expect(action.output).toContain('"editorKind": "memory"');
      expect(action.output).toContain('agent_local_registry');
      expect(action.output).toContain('"summary"');
    } finally {
      fixture.cleanup();
    }
  });

  test('uses runtime context for model-visible profile and routine schedule editor schemas', async () => {
    const fixture = makeFixture();
    try {
      const routine = AgentRoutineRegistry.fromShellPaths(fixture.paths).create({
        name: 'Morning Review',
        description: 'Review current operator state.',
        steps: 'Check work plan, approvals, schedules, and Agent Knowledge status.',
        enabled: true,
      });

      const profileAction = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'runtime-profile-create' });
      expect(profileAction.success).toBe(true);
      expect(profileAction.output).toContain('Starter template');

      const routineAction = await fixture.tool.execute({
        mode: 'workspace_action',
        actionId: 'schedule-promote-routine',
        recordId: routine.id,
      });
      expect(routineAction.success).toBe(true);
      expect(routineAction.output).toContain(`Selected: ${routine.id} (${routine.name})`);
      expect(routineAction.output).toContain(`"default": "${routine.id}"`);
      expect(routineAction.output).toContain(`"default": "${routine.name}"`);
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes command policy metadata for slash-command parity', async () => {
    const fixture = makeFixture();
    try {
      registerOperatorRuntimeCommands(fixture.commandRegistry);

      const settings = await fixture.tool.execute({ mode: 'command', commandName: 'settings' });
      expect(settings.success).toBe(true);
      expect(settings.output).toContain('"policy"');
      expect(settings.output).toContain('"effect": "mixed"');
      expect(settings.output).toContain('agent_harness settings/get_setting/set_setting/reset_setting');
      expect(settings.output).toContain('Connected-host lifecycle/listener settings remain read-only');
    } finally {
      fixture.cleanup();
    }
  });

  test('reports connected-host capabilities, boundaries, and model tool availability', async () => {
    const fixture = makeFixture();
    try {
      for (const name of [
        'agent_operator_briefing',
        'agent_operator_action',
        'agent_knowledge',
        'agent_knowledge_ingest',
        'agent_channel_send',
        'agent_notify',
        'agent_reminder_schedule',
        'agent_media_generate',
      ]) {
        registerStubTool(fixture.toolRegistry, name);
      }

      const result = await fixture.tool.execute({ mode: 'connected_host' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('"routeFamilies"');
      expect(result.output).toContain('/api/goodvibes-agent/knowledge/*');
      expect(result.output).toContain('"capabilities"');
      expect(result.output).toContain('"agent_operator_action"');
      expect(result.output).toContain('"available": true');
      expect(result.output).toContain('"blockedCapabilities"');
      expect(result.output).toContain('connected-host-lifecycle');
      expect(result.output).toContain('arbitrary-connected-host-mutations');
    } finally {
      fixture.cleanup();
    }
  });

  test('uses the canonical TUI editor schema for learned behavior actions', async () => {
    const fixture = makeFixture();
    try {
      const action = await fixture.tool.execute({ mode: 'workspace_action', actionId: 'learned-behavior' });

      expect(action.success).toBe(true);
      expect(action.output).toContain('"editorKind": "learned-behavior"');
      expect(action.output).toContain('Ctrl-J inserts a new line.');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes a model-visible editor schema for every user-facing workspace editor action', async () => {
    const fixture = makeFixture();
    try {
      const editorActions = AGENT_WORKSPACE_CATEGORIES.flatMap((category) => (
        category.actions
          .filter((action) => action.kind === 'editor' && action.editorKind)
          .map((action) => ({ category, action }))
      ));

      expect(editorActions.length).toBeGreaterThan(0);
      for (const { action } of editorActions) {
        const result = await fixture.tool.execute({ mode: 'workspace_action', actionId: action.id });
        expect(result.success, action.id).toBe(true);
        expect(result.output, action.id).toContain('"editor"');
        expect(result.output, action.id).toContain('"fields"');
      }
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes model execution metadata for every local workspace action', async () => {
    const fixture = makeFixture();
    try {
      const localActions = AGENT_WORKSPACE_CATEGORIES.flatMap((category) => (
        category.actions
          .filter((action) => action.kind === 'local-selection' || action.kind === 'local-operation')
          .map((action) => ({ category, action }))
      ));

      expect(localActions.length).toBeGreaterThan(0);
      for (const { action } of localActions) {
        const result = await fixture.tool.execute({ mode: 'workspace_action', actionId: action.id });
        expect(result.success, action.id).toBe(true);
        expect(result.output, action.id).toContain('"modelExecution"');
        expect(result.output.includes('agent_local_registry') || result.output.includes('agent_knowledge_ingest'), action.id).toBe(true);
      }
    } finally {
      fixture.cleanup();
    }
  });

  test('requires confirmation before invoking slash commands through the harness', async () => {
    const fixture = makeFixture();
    try {
      const preview = await fixture.tool.execute({
        mode: 'run_command',
        command: '/brief',
        explicitUserRequest: 'Show the briefing.',
      });
      expect(preview.success).toBe(false);
      expect(preview.error).toContain('confirm:true');
      expect(fixture.printed).toEqual([]);

      const executed = await fixture.tool.execute({
        mode: 'run_command',
        command: '/brief',
        confirm: true,
        explicitUserRequest: 'Show the briefing.',
      });
      expect(executed.success).toBe(true);
      expect(executed.output).toContain('Command /brief completed.');
      expect(executed.output).toContain('briefing output');
    } finally {
      fixture.cleanup();
    }
  });

  test('runs command-backed workspace actions through the same command registry', async () => {
    const fixture = makeFixture();
    try {
      const result = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'brief',
        confirm: true,
        explicitUserRequest: 'Open the operator briefing.',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Command /brief completed.');
      expect(result.output).toContain('briefing output');
    } finally {
      fixture.cleanup();
    }
  });

  test('bridges selection-based local workspace actions through model tools', async () => {
    const fixture = makeFixture();
    try {
      const memoryRegistry = await createMemoryRegistry(fixture.paths, fixture.configManager);
      fixture.toolRegistry.register(createAgentLocalRegistryTool(fixture.paths, memoryRegistry));
      const note = AgentNoteRegistry.fromShellPaths(fixture.paths).create({
        title: 'Daily triage',
        body: 'Read the queue, sort urgent items first, and summarize blocked work.',
        tags: ['workflow'],
        source: 'agent',
        provenance: 'test',
      });

      const preview = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'notes-to-skill',
        recordId: note.id,
      });
      expect(preview.success).toBe(true);
      expect(preview.output).toContain('"status": "editor"');
      expect(preview.output).toContain('Create Skill From Note');
      expect(preview.output).toContain('Read the queue');

      const promoted = await fixture.tool.execute({
        mode: 'run_workspace_action',
        actionId: 'notes-to-skill',
        recordId: note.id,
        fields: { enabled: 'yes' },
        confirm: true,
        explicitUserRequest: 'Promote the triage note into a skill.',
      });
      expect(promoted.success).toBe(true);
      expect(promoted.output).toContain('executed_model_tool');
      const skill = AgentSkillRegistry.fromShellPaths(fixture.paths).get('daily-triage');
      expect(skill?.procedure).toContain('Read the queue');
      expect(skill?.enabled).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  test('gates setting mutations and keeps connected-host-owned settings read-only', async () => {
    const fixture = makeFixture();
    try {
      const missingConfirmation = await fixture.tool.execute({
        mode: 'set_setting',
        key: 'provider.model',
        value: 'openai:gpt-4.1',
        explicitUserRequest: 'Use this model.',
      });
      expect(missingConfirmation.success).toBe(false);
      expect(missingConfirmation.error).toContain('confirm:true');

      const set = await fixture.tool.execute({
        mode: 'set_setting',
        key: 'provider.model',
        value: 'openai:gpt-4.1',
        confirm: true,
        explicitUserRequest: 'Use this model.',
      });
      expect(set.success).toBe(true);
      expect(fixture.configManager.get('provider.model')).toBe('openai:gpt-4.1');

      const hostOwned = await fixture.tool.execute({
        mode: 'set_setting',
        key: 'service.enabled',
        value: true,
        confirm: true,
        explicitUserRequest: 'Turn on the host service.',
      });
      expect(hostOwned.success).toBe(false);
      expect(hostOwned.error).toContain('connected GoodVibes host');
    } finally {
      fixture.cleanup();
    }
  });

  test('persists secret-backed setting values through the secret manager and redacts output', async () => {
    const fixture = makeFixture();
    try {
      const result = await fixture.tool.execute({
        mode: 'set_setting',
        key: 'surfaces.slack.botToken',
        value: 'xoxb-secret-value',
        confirm: true,
        explicitUserRequest: 'Set the Slack bot token.',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('<secret-ref>');
      expect(result.output).not.toContain('xoxb-secret-value');
      expect(fixture.configManager.get('surfaces.slack.botToken')).toContain('goodvibes://secrets/');
      expect(await fixture.secretsManager?.get(buildGoodVibesSecretKey('surfaces.slack.botToken'))).toBe('xoxb-secret-value');
    } finally {
      fixture.cleanup();
    }
  });

  test('rejects raw secret-backed setting values when secret storage is unavailable', async () => {
    const fixture = makeFixture({ secrets: false });
    try {
      const result = await fixture.tool.execute({
        mode: 'set_setting',
        key: 'surfaces.slack.botToken',
        value: 'xoxb-secret-value',
        confirm: true,
        explicitUserRequest: 'Set the Slack bot token.',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('secrets manager is unavailable');
      expect(fixture.configManager.get('surfaces.slack.botToken')).toBe('');
    } finally {
      fixture.cleanup();
    }
  });

  test('resets secret-backed settings only when stored secret deletion can run', async () => {
    const fixture = makeFixture();
    try {
      const key = buildGoodVibesSecretKey('surfaces.slack.botToken');
      await fixture.secretsManager?.set(key, 'xoxb-secret-value', { scope: 'user' });
      fixture.configManager.setDynamic('surfaces.slack.botToken', buildGoodVibesSecretRef(key));

      const result = await fixture.tool.execute({
        mode: 'reset_setting',
        key: 'surfaces.slack.botToken',
        confirm: true,
        explicitUserRequest: 'Reset the Slack bot token.',
      });

      expect(result.success).toBe(true);
      expect(fixture.configManager.get('surfaces.slack.botToken')).toBe('');
      expect(await fixture.secretsManager?.get(key)).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  test('rejects reset of secret-backed refs when secret deletion is unavailable', async () => {
    const fixture = makeFixture({ secrets: false });
    try {
      const key = buildGoodVibesSecretKey('surfaces.slack.botToken');
      const ref = buildGoodVibesSecretRef(key);
      fixture.configManager.setDynamic('surfaces.slack.botToken', ref);

      const result = await fixture.tool.execute({
        mode: 'reset_setting',
        key: 'surfaces.slack.botToken',
        confirm: true,
        explicitUserRequest: 'Reset the Slack bot token.',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('secrets manager is unavailable');
      expect(fixture.configManager.get('surfaces.slack.botToken')).toBe(ref);
    } finally {
      fixture.cleanup();
    }
  });

  test('does not echo raw secret values when invoking settings through run_command', async () => {
    const fixture = makeFixture();
    try {
      registerOperatorRuntimeCommands(fixture.commandRegistry);

      const result = await fixture.tool.execute({
        mode: 'run_command',
        command: '/settings set surfaces.slack.botToken xoxb-secret-value --yes',
        confirm: true,
        explicitUserRequest: 'Set the Slack bot token.',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Command /settings completed.');
      expect(result.output).toContain('<secret-ref>');
      expect(result.output).not.toContain('xoxb-secret-value');
      expect(await fixture.secretsManager?.get(buildGoodVibesSecretKey('surfaces.slack.botToken'))).toBe('xoxb-secret-value');
    } finally {
      fixture.cleanup();
    }
  });
});
