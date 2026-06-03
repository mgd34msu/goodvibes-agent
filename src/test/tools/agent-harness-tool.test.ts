import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { MemoryEmbeddingProviderRegistry, MemoryRegistry, MemoryStore } from '@pellux/goodvibes-sdk/platform/state';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { PanelManager } from '../../panels/panel-manager.ts';
import type { Panel, PanelCategory } from '../../panels/types.ts';
import { ConfigManager } from '../../config/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { SecretsManager } from '../../config/secrets.ts';
import { buildGoodVibesSecretKey, buildGoodVibesSecretRef } from '../../config/secret-config.ts';
import { createShellPathService } from '@/runtime/index.ts';
import { registerOperatorRuntimeCommands } from '../../input/commands/operator-runtime.ts';
import { AGENT_WORKSPACE_CATEGORIES } from '../../input/agent-workspace-categories.ts';
import { KeybindingsManager } from '../../input/keybindings.ts';
import { createAgentHarnessTool } from '../../tools/agent-harness-tool.ts';
import { createAgentLocalRegistryTool } from '../../tools/agent-local-registry-tool.ts';
import { AgentNoteRegistry } from '../../agent/note-registry.ts';
import { AgentSkillRegistry } from '../../agent/skill-registry.ts';
import { AgentRoutineRegistry } from '../../agent/routine-registry.ts';
import { SDK_VERSION } from '../../version.ts';

type ShellPaths = ReturnType<typeof createShellPathService>;

interface HarnessFixture {
  readonly root: string;
  readonly paths: ShellPaths;
  readonly commandRegistry: CommandRegistry;
  readonly configManager: ConfigManager;
  readonly secretsManager: SecretsManager | null;
  readonly panelManager: PanelManager;
  readonly keybindingsManager: KeybindingsManager;
  readonly toolRegistry: ToolRegistry;
  readonly tool: ReturnType<typeof createAgentHarnessTool>;
  readonly printed: string[];
  readonly routedPanels: Array<{ readonly panelId: string; readonly pane: 'top' | 'bottom' | undefined }>;
  readonly openedSurfaces: Array<{ readonly id: string; readonly detail?: string; readonly result?: boolean }>;
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

function createFakePanel(id: string, name: string, icon: string, category: PanelCategory): Panel {
  return {
    id,
    name,
    icon,
    category,
    isTransient: false,
    isPinned: false,
    needsRender: true,
    onActivate: () => {},
    onDeactivate: () => {},
    onDestroy: () => {},
    render: () => [],
    invalidate: () => {},
    markRendered: () => {},
  };
}

function registerHarnessFixturePanels(panelManager: PanelManager): void {
  panelManager.registerType({
    id: 'provider-health',
    name: 'Health',
    icon: 'N',
    category: 'monitoring',
    description: 'Provider health dashboard for current Agent provider posture',
    factory: () => createFakePanel('provider-health', 'Health', 'N', 'monitoring'),
  });
  panelManager.registerType({
    id: 'knowledge',
    name: 'Knowledge',
    icon: 'K',
    category: 'agent',
    description: 'Isolated Agent Knowledge and local memory review',
    factory: () => createFakePanel('knowledge', 'Knowledge', 'K', 'agent'),
  });
  panelManager.registerType({
    id: 'panel-list',
    name: 'Panel List',
    icon: 'L',
    category: 'session',
    description: 'Browse all registered panels grouped by category',
    factory: () => createFakePanel('panel-list', 'Panel List', 'L', 'session'),
  });
}

function makeFixture(options: { readonly secrets?: boolean } = {}): HarnessFixture {
  const { root, paths, cleanup } = makeShellPaths();
  const commandRegistry = new CommandRegistry();
  const configManager = makeConfig(paths);
  const secretsManager = options.secrets === false
    ? null
    : new SecretsManager({ projectRoot: root, globalHome: root, configManager });
  const panelManager = new PanelManager();
  const keybindingsManager = new KeybindingsManager({
    configPath: paths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'keybindings.json'),
  });
  registerHarnessFixturePanels(panelManager);
  const toolRegistry = new ToolRegistry();
  const printed: string[] = [];
  const routedPanels: Array<{ readonly panelId: string; readonly pane: 'top' | 'bottom' | undefined }> = [];
  const openedSurfaces: Array<{ readonly id: string; readonly detail?: string; readonly result?: boolean }> = [];

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
    showPanel: (panelId: string, pane?: 'top' | 'bottom') => {
      routedPanels.push({ panelId, pane });
    },
    openAgentWorkspace: (categoryId?: string) => {
      openedSurfaces.push({ id: 'agent-workspace', detail: categoryId });
    },
    openSettingsModal: (target?: string) => {
      openedSurfaces.push({ id: 'settings', detail: target });
    },
    openMcpWorkspace: () => {
      openedSurfaces.push({ id: 'mcp-workspace' });
    },
    openModelPicker: () => {
      openedSurfaces.push({ id: 'model-picker' });
    },
    openModelPickerWithTarget: (target) => {
      openedSurfaces.push({ id: 'model-picker', detail: target, result: true });
      return true;
    },
    openProviderPicker: () => {
      openedSurfaces.push({ id: 'provider-picker' });
    },
    openProviderModelPickerWithTarget: (target) => {
      openedSurfaces.push({ id: 'provider-picker', detail: target });
      return true;
    },
    openSessionPicker: () => {
      openedSurfaces.push({ id: 'session-picker' });
    },
    openProfilePicker: () => {
      openedSurfaces.push({ id: 'profile-picker' });
    },
    openBookmarkModal: () => {
      openedSurfaces.push({ id: 'bookmark-modal' });
    },
    openContextInspector: () => {
      openedSurfaces.push({ id: 'context-inspector' });
    },
    openHelpOverlay: () => {
      openedSurfaces.push({ id: 'help-overlay' });
    },
    openShortcutsOverlay: () => {
      openedSurfaces.push({ id: 'shortcuts-overlay' });
    },
    openOnboardingWizard: (modeOrOptions) => {
      openedSurfaces.push({ id: 'onboarding', detail: typeof modeOrOptions === 'string' ? modeOrOptions : modeOrOptions?.mode });
    },
    workspace: { shellPaths: paths, panelManager, keybindingsManager },
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
    panelManager,
    keybindingsManager,
    toolRegistry,
    tool,
    printed,
    routedPanels,
    openedSurfaces,
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

function readAuthorizationHeader(headers: HeadersInit | undefined): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get('authorization');
  if (Array.isArray(headers)) {
    const entry = headers.find(([key]) => key.toLowerCase() === 'authorization');
    return entry ? String(entry[1]) : null;
  }
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization')?.[1];
  return typeof value === 'string' ? value : null;
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

  test('exposes top-level CLI mirror metadata without enabling hidden CLI execution', async () => {
    const fixture = makeFixture();
    try {
      const summary = await fixture.tool.execute({ mode: 'summary' });
      expect(summary.success).toBe(true);
      expect(summary.output).toContain('"cliCommands"');
      const summaryJson = JSON.parse(summary.output ?? '{}') as { readonly modelAccess?: { readonly cliCommands?: string } };
      expect(summaryJson.modelAccess?.cliCommands).toContain('mode:"cli_commands"');

      const catalog = await fixture.tool.execute({ mode: 'cli_commands', query: 'knowledge' });
      expect(catalog.success).toBe(true);
      expect(catalog.output).toContain('"name": "knowledge"');
      expect(catalog.output).toContain('agent_knowledge or agent_knowledge_ingest');
      expect(catalog.output).toContain('"blockedTokens"');
      expect(catalog.output).toContain('"daemon"');
      expect(catalog.output).toContain('CLI modes are read-only discovery');

      const parsed = await fixture.tool.execute({
        mode: 'cli_command',
        cliCommand: 'goodvibes-agent status --json --config surfaces.slack.botToken=xoxb-secret-value',
      });
      expect(parsed.success).toBe(true);
      expect(parsed.output).toContain('"name": "status"');
      expect(parsed.output).toContain('"outputFormat": "json"');
      expect(parsed.output).toContain('surfaces.slack.botToken=<redacted>');
      expect(parsed.output).not.toContain('xoxb-secret-value');

      const blocked = await fixture.tool.execute({ mode: 'cli_command', cliCommand: 'daemon start' });
      expect(blocked.success).toBe(true);
      expect(blocked.output).toContain('"supported": false');
      expect(blocked.output).toContain('Unsupported command: daemon');
      expect(blocked.output).toContain('connected-host');
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes built-in panel catalog state and confirmation-gated routing', async () => {
    const fixture = makeFixture();
    try {
      fixture.panelManager.open('provider-health');

      const summary = await fixture.tool.execute({ mode: 'summary' });
      expect(summary.success).toBe(true);
      expect(summary.output).toContain('"panels": 3');
      const summaryJson = JSON.parse(summary.output ?? '{}') as { readonly modelAccess?: { readonly panels?: string } };
      expect(summaryJson.modelAccess?.panels).toContain('mode:"panels"');

      const panels = await fixture.tool.execute({ mode: 'panels', category: 'monitoring' });
      expect(panels.success).toBe(true);
      expect(panels.output).toContain('"id": "provider-health"');
      expect(panels.output).toContain('"open": true');
      expect(panels.output).toContain('"command": "/agent setup"');

      const panel = await fixture.tool.execute({ mode: 'panel', panelId: 'knowledge' });
      expect(panel.success).toBe(true);
      expect(panel.output).toContain('"categoryId": "knowledge"');
      expect(panel.output).toContain('"command": "/agent knowledge"');

      const denied = await fixture.tool.execute({
        mode: 'open_panel',
        panelId: 'knowledge',
        explicitUserRequest: 'Show the knowledge panel.',
      });
      expect(denied.success).toBe(false);
      expect(denied.error).toContain('confirm:true');
      expect(fixture.routedPanels).toEqual([]);

      const routed = await fixture.tool.execute({
        mode: 'open_panel',
        panelId: 'knowledge',
        pane: 'bottom',
        confirm: true,
        explicitUserRequest: 'Show the knowledge panel.',
      });
      expect(routed.success).toBe(true);
      expect(routed.output).toContain('"status": "routed"');
      expect(fixture.routedPanels).toEqual([{ panelId: 'knowledge', pane: 'bottom' }]);
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes modal and picker UI surfaces with confirmation-gated visible routing', async () => {
    const fixture = makeFixture();
    try {
      const summary = await fixture.tool.execute({ mode: 'summary' });
      expect(summary.success).toBe(true);
      expect(summary.output).toContain('"uiSurfaces"');
      const summaryJson = JSON.parse(summary.output ?? '{}') as { readonly modelAccess?: { readonly uiSurfaces?: string } };
      expect(summaryJson.modelAccess?.uiSurfaces).toContain('mode:"ui_surfaces"');

      const catalog = await fixture.tool.execute({ mode: 'ui_surfaces', query: 'picker' });
      expect(catalog.success).toBe(true);
      expect(catalog.output).toContain('"id": "model-picker"');
      expect(catalog.output).toContain('"id": "provider-picker"');
      expect(catalog.output).toContain('preferredModelRoute');

      const settings = await fixture.tool.execute({ mode: 'ui_surface', surfaceId: 'settings' });
      expect(settings.success).toBe(true);
      expect(settings.output).toContain('"id": "settings"');
      expect(settings.output).toContain('settings/get_setting/set_setting/reset_setting');

      const denied = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'settings',
        target: 'provider.model',
        explicitUserRequest: 'Open settings for the model setting.',
      });
      expect(denied.success).toBe(false);
      expect(denied.error).toContain('confirm:true');
      expect(fixture.openedSurfaces).toEqual([]);

      const openedSettings = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'settings',
        target: 'provider.model',
        confirm: true,
        explicitUserRequest: 'Open settings for the model setting.',
      });
      expect(openedSettings.success).toBe(true);
      expect(openedSettings.output).toContain('"status": "opened"');
      expect(fixture.openedSurfaces).toEqual([{ id: 'settings', detail: 'provider.model' }]);

      const openedWorkspace = await fixture.tool.execute({
        mode: 'open_ui_surface',
        surfaceId: 'agent-workspace',
        categoryId: 'knowledge',
        confirm: true,
        explicitUserRequest: 'Open the Knowledge workspace.',
      });
      expect(openedWorkspace.success).toBe(true);
      expect(fixture.openedSurfaces.at(-1)).toEqual({ id: 'agent-workspace', detail: 'knowledge' });
    } finally {
      fixture.cleanup();
    }
  });

  test('exposes shortcuts and confirmation-gated keybinding edits', async () => {
    const fixture = makeFixture();
    try {
      const summary = await fixture.tool.execute({ mode: 'summary' });
      expect(summary.success).toBe(true);
      expect(summary.output).toContain('"shortcuts"');
      const summaryJson = JSON.parse(summary.output ?? '{}') as { readonly modelAccess?: { readonly shortcuts?: string } };
      expect(summaryJson.modelAccess?.shortcuts).toContain('mode:"shortcuts"');

      const shortcuts = await fixture.tool.execute({ mode: 'shortcuts', query: 'help' });
      expect(shortcuts.success).toBe(true);
      expect(shortcuts.output).toContain('"fixedShortcuts"');
      expect(shortcuts.output).toContain('? / F1');
      expect(shortcuts.output).toContain('"configurableKeybindings"');

      const keybinding = await fixture.tool.execute({ mode: 'keybinding', actionId: 'search' });
      expect(keybinding.success).toBe(true);
      expect(keybinding.output).toContain('"action": "search"');
      expect(keybinding.output).toContain('Ctrl+F');
      expect(keybinding.output).toContain('"customized": false');

      const denied = await fixture.tool.execute({
        mode: 'set_keybinding',
        actionId: 'search',
        combo: { key: 'g', ctrl: true },
        explicitUserRequest: 'Change search to Ctrl+G.',
      });
      expect(denied.success).toBe(false);
      expect(denied.error).toContain('confirm:true');
      expect(fixture.keybindingsManager.matches('search', { logicalName: 'f', ctrl: true })).toBe(true);

      const updated = await fixture.tool.execute({
        mode: 'set_keybinding',
        actionId: 'search',
        combo: { key: 'g', ctrl: true },
        confirm: true,
        explicitUserRequest: 'Change search to Ctrl+G.',
      });
      expect(updated.success).toBe(true);
      expect(updated.output).toContain('"status": "updated"');
      expect(updated.output).toContain('Ctrl+G');
      expect(updated.output).toContain('"customized": true');
      expect(fixture.keybindingsManager.matches('search', { logicalName: 'g', ctrl: true })).toBe(true);
      expect(fixture.keybindingsManager.matches('search', { logicalName: 'f', ctrl: true })).toBe(false);

      const reset = await fixture.tool.execute({
        mode: 'reset_keybinding',
        actionId: 'search',
        confirm: true,
        explicitUserRequest: 'Reset search keybinding.',
      });
      expect(reset.success).toBe(true);
      expect(reset.output).toContain('"status": "reset"');
      expect(reset.output).toContain('Ctrl+F');
      expect(reset.output).toContain('"customized": false');
      expect(fixture.keybindingsManager.matches('search', { logicalName: 'f', ctrl: true })).toBe(true);
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

  test('reports live connected-host status without exposing the operator token', async () => {
    const fixture = makeFixture();
    const originalFetch = globalThis.fetch;
    const token = 'gvop-test-token-value';
    const requests: Array<{ readonly url: string; readonly authorization: string | null }> = [];
    try {
      writeFileSync(join(fixture.root, '.goodvibes', 'daemon', 'operator-tokens.json'), JSON.stringify({ token }));
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, authorization: readAuthorizationHeader(init?.headers) });
        if (url.endsWith('/status')) {
          return new Response(JSON.stringify({ version: SDK_VERSION }), { status: 200 });
        }
        if (url.endsWith('/api/goodvibes-agent/knowledge/status')) {
          return new Response(JSON.stringify({ ready: true }), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }) as typeof globalThis.fetch;

      const result = await fixture.tool.execute({ mode: 'connected_host_status' });
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error);
      const payload = JSON.parse(result.output) as {
        readonly liveStatus: {
          readonly reachable: boolean;
          readonly compatible: boolean;
          readonly agentKnowledge: { readonly ready: boolean };
        };
        readonly operatorToken: {
          readonly usable: boolean;
          readonly fingerprint: string | null;
        };
      };
      expect(payload.liveStatus.reachable).toBe(true);
      expect(payload.liveStatus.compatible).toBe(true);
      expect(payload.liveStatus.agentKnowledge.ready).toBe(true);
      expect(payload.operatorToken.usable).toBe(true);
      expect(payload.operatorToken.fingerprint?.startsWith('sha256:')).toBe(true);
      expect(result.output).not.toContain(token);
      expect(requests.map((request) => request.url)).toEqual([
        'http://127.0.0.1:3421/status',
        'http://127.0.0.1:3421/api/goodvibes-agent/knowledge/status',
      ]);
      expect(requests.every((request) => request.authorization === `Bearer ${token}`)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
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
