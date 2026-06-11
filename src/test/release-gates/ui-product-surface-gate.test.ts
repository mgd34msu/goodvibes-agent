import { describe, expect, test } from 'bun:test';
import { listHarnessSettings } from '../../agent/harness-control.ts';
import { DEFAULT_CONFIG } from '../../config/index.ts';
import { ConversationManager } from '../../core/conversation';
import type { CommandContext } from '../../input/command-registry.ts';
import { GLYPHS } from '../../renderer/ui-primitives.ts';
import { getOverlayWidthClass } from '../../renderer/overlay-viewport.ts';
import { wireShellUiOpeners } from '../../shell/ui-openers.ts';
import { createTestManagers } from '../helpers/test-managers.ts';
import { listHarnessKeybindings } from '../../tools/agent-harness-keybinding-metadata.ts';
import {
  listHarnessUiSurfaces,
  totalHarnessUiSurfaces,
} from '../../tools/agent-harness-ui-surface-metadata.ts';

function modelCatalogContext(): CommandContext {
  const noop = () => {};
  return {
    renderRequest: noop,
    print: noop,
    exit: noop,
    executeCommand: async () => true,
    openModelPicker: noop,
    openModelPickerWithTarget: () => true,
    openProviderModelPickerWithTarget: () => true,
    openProviderPicker: noop,
    openReasoningEffortPicker: () => ({ opened: true, model: 'test', levels: ['low', 'medium', 'high'] }),
    openContextInspector: noop,
    openBookmarkModal: noop,
    openProcessModal: noop,
    openConversationSearch: noop,
    openPromptHistorySearch: noop,
    openSlashCommandMode: () => true,
    openFilePicker: () => true,
    openBlockActions: () => true,
    openLiveTail: () => ({ opened: true, processId: 'proc-1', label: 'test process' }),
    openHelpOverlay: noop,
    openSelection: noop,
    openSettingsModal: noop,
    openSessionPicker: noop,
    openProfilePicker: noop,
    openShortcutsOverlay: noop,
    openWorkspacePicker: noop,
    showPanel: noop,
    openMcpWorkspace: noop,
    openAgentWorkspace: noop,
    openSecurityPanel: noop,
    openKnowledgePanel: noop,
    openSubscriptionPanel: noop,
    workspace: {},
    platform: {},
    session: {},
    provider: {},
    ops: {},
    extensions: {},
  } as unknown as CommandContext;
}

function expectNonempty(value: unknown): asserts value is string {
  expect(typeof value).toBe('string');
  expect(String(value).trim()).not.toBe('');
}

describe('UI product surface gate', () => {
  test('locks the canonical Unicode primitive set', () => {
    expect(GLYPHS.frame.vertical).toBe('│');
    expect(GLYPHS.surface.top).toBe('▄');
    expect(GLYPHS.surface.bottom).toBe('▀');
    expect(GLYPHS.surface.cursor).toBe('█');
    expect(GLYPHS.navigation.collapsed).toBe('▸');
    expect(GLYPHS.navigation.expanded).toBe('▾');
    expect(GLYPHS.status.success).toBe('✓');
    expect(GLYPHS.status.pending).toBe('•');
  });

  test('keeps non-conversational routing defaults out of the main transcript', () => {
    expect(DEFAULT_CONFIG.ui.systemMessages).toBe('panel');
    expect(DEFAULT_CONFIG.ui.operationalMessages).toBe('panel');
    expect(DEFAULT_CONFIG.ui.wrfcMessages).toBe('both');
  });

  test('supports line-accurate conversation navigation by transcript event family', () => {
    const conversation = new ConversationManager(() => 100);
    conversation.addUserMessage('review the file');
    conversation.addAssistantMessage('Running checks.', {
      toolCalls: [{ id: 'call-1', name: 'exec', arguments: { command: 'git diff --stat' } }],
      model: 'gpt-5.4',
      provider: 'openai',
    });
    conversation.addToolResults([{ callId: 'call-1', success: true, output: '1 file changed' }]);
    conversation.addSystemMessage('[Approval] Waiting for operator input');

    const toolLine = conversation.nextTranscriptEventLine(0, 'tool_result');
    expect(toolLine).toBeGreaterThanOrEqual(0);
    expect(conversation.prevTranscriptEventLine(999, 'tool_result')).toBe(toolLine);
  });

  test('routes panel openers through the Agent workspace path', () => {
    const testManagers = createTestManagers();
    let openedWorkspaceCategory: string | null = null;
    const input = {
      panelFocused: false,
      modalOpened: () => {},
      modelPicker: {} as never,
      openAgentWorkspace: (_ctx: CommandContext, category: string) => { openedWorkspaceCategory = category; },
      openSelection: () => {},
      contextInspectorModal: { open: () => {} },
      bookmarkModal: { open: () => {} },
      helpOverlayActive: false,
      helpScrollOffset: 0,
      shortcutsOverlayActive: false,
      shortcutsScrollOffset: 0,
      profilePickerModal: { open: () => {} },
      settingsModal: { open: () => {} },
      sessionPickerModal: { open: () => {} },
    } as unknown as Parameters<typeof wireShellUiOpeners>[0]['input'];
    const conversation = {
      log: () => {},
      setSplashSuppressed: () => {},
      rebuildHistory: () => {},
    } as never;
    const commandContext = {} as CommandContext;

    wireShellUiOpeners({
      commandContext,
      input,
      conversation,
      configManager: testManagers.configManager,
      providerRegistry: { getSelectableModels: () => [], listModels: () => [] } as never,
      runtime: { model: 'gpt-5.4', provider: 'openai' } as never,
      featureFlags: {} as never,
      mcpRegistry: {} as never,
      subscriptionManager: testManagers.subscriptionManager,
      serviceRegistry: testManagers.serviceRegistry,
      getConfiguredProviderIds: () => [],
      getPinned: async () => [],
      workingDirectory: process.cwd(),
      homeDirectory: process.env['HOME'] ?? process.cwd(),
      render: () => {},
    });

    (commandContext as { openWorkspacePicker?: () => void }).openWorkspacePicker?.();
    expect(openedWorkspaceCategory!).toBe('home');
  });

  test('keeps overlays on shared width bands for narrow, medium, and wide terminals', () => {
    expect(getOverlayWidthClass(70)).toBe('narrow');
    expect(getOverlayWidthClass(100)).toBe('medium');
    expect(getOverlayWidthClass(140)).toBe('wide');
  });

  test('model-facing catalogs cover current user-facing settings, surfaces, and keybindings', () => {
    const context = modelCatalogContext();
    const managers = createTestManagers();

    const surfaces = listHarnessUiSurfaces(context, { includeParameters: true, limit: 500 }) as readonly {
      readonly id?: string;
      readonly summary?: string;
      readonly modelRoute?: string;
      readonly preferredModelRoute?: string;
      readonly policy?: { readonly effect?: string; readonly confirmation?: string; readonly boundary?: string };
    }[];
    expect(surfaces).toHaveLength(totalHarnessUiSurfaces());
    for (const surface of surfaces) {
      expectNonempty(surface.id);
      expectNonempty(surface.summary);
      expect(surface.summary.length).toBeLessThanOrEqual(72);
      expectNonempty(surface.modelRoute);
      expect(surface.modelRoute.length).toBeLessThanOrEqual(72);
      expectNonempty(surface.preferredModelRoute);
      expectNonempty(surface.policy?.effect);
      expect(surface.policy?.confirmation).toContain('confirm:true');
      expectNonempty(surface.policy?.boundary);
    }

    const keybindings = listHarnessKeybindings(context, { limit: 500 }) as {
      readonly keybindings: readonly {
        readonly action?: string;
        readonly description?: string;
        readonly modelOperation?: {
          readonly effect?: string;
          readonly confirmation?: string;
          readonly note?: string;
          readonly preferredMode?: string;
        };
      }[];
      readonly returned: number;
      readonly total: number;
    };
    expect(keybindings.returned).toBe(keybindings.total);
    for (const keybinding of keybindings.keybindings) {
      expectNonempty(keybinding.action);
      expectNonempty(keybinding.description);
      expectNonempty(keybinding.modelOperation?.effect);
      expectNonempty(keybinding.modelOperation?.confirmation);
      expectNonempty(keybinding.modelOperation?.note);
      if (keybinding.modelOperation?.preferredMode) {
        expect([
          'run_keybinding',
          'open_ui_surface',
          'run_command',
          'direct-user-interaction',
        ]).toContain(keybinding.modelOperation.preferredMode);
      }
    }

    const settings = listHarnessSettings(managers.configManager, { limit: 500 }) as readonly {
      readonly key?: string;
      readonly category?: string;
      readonly summary?: string;
      readonly modelRoute?: string;
      readonly visibleInWorkspace?: boolean;
      readonly writable?: boolean;
    }[];
    expect(settings.length).toBeGreaterThan(0);
    expect(settings.length).toBeLessThanOrEqual(500);
    for (const setting of settings) {
      expectNonempty(setting.key);
      expectNonempty(setting.category);
      expectNonempty(setting.summary);
      expect(setting.summary.length).toBeLessThanOrEqual(72);
      expectNonempty(setting.modelRoute);
      expect(setting.modelRoute.length).toBeLessThanOrEqual(72);
      expect(typeof setting.visibleInWorkspace).toBe('boolean');
      expect(typeof setting.writable).toBe('boolean');
    }
  });
});
