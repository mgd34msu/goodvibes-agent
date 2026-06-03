import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { wireShellUiOpeners } from '../../shell/ui-openers.ts';
import { createTestManagers } from '../helpers/test-managers.ts';

describe('wireShellUiOpeners', () => {
  let commandContext: Record<string, unknown>;
  let input: Record<string, unknown>;
  let panelManager: Record<string, unknown>;
  let conversation: Record<string, unknown>;
  let render: ReturnType<typeof mock>;
  let testManagers = createTestManagers();

  beforeEach(() => {
    testManagers = createTestManagers();
    commandContext = {};
    input = {
      panelFocused: false,
      modelPicker: {},
      modalOpened: mock(() => {}),
      openAgentWorkspace: mock(() => {}),
    };
    panelManager = {
      isVisible: mock(() => false),
      getAllOpen: mock(() => []),
      open: mock(() => ({})),
      show: mock(() => {}),
      hide: mock(() => {}),
    };
    conversation = {
      log: mock(() => {}),
      setSplashSuppressed: mock(() => {}),
      rebuildHistory: mock(() => {}),
    };
    render = mock(() => {});

    wireShellUiOpeners({
      commandContext: commandContext as never,
      input: input as never,
      panelManager: panelManager as never,
      conversation: conversation as never,
      configManager: testManagers.configManager,
      providerRegistry: {} as never,
      runtime: {} as never,
      featureFlags: {} as never,
      mcpRegistry: {} as never,
      subscriptionManager: testManagers.subscriptionManager,
      serviceRegistry: testManagers.serviceRegistry,
      getConfiguredProviderIds: () => [],
      getPinned: async () => [],
      render,
    });
  });

  test('openPanelPicker redirects to the Agent operator workspace', () => {
    (commandContext.openPanelPicker as () => void)();
    expect(panelManager.open).not.toHaveBeenCalled();
    expect(panelManager.hide).toHaveBeenCalled();
    expect(input.panelFocused).toBe(false);
    expect(input.openAgentWorkspace).toHaveBeenCalledWith(commandContext, 'home');
    expect(conversation.setSplashSuppressed).toHaveBeenCalledWith(false);
    expect(conversation.log).toHaveBeenCalledWith(
      'Panel picker is handled through Agent Workspace. Use /agent for current operator controls.',
      { fg: '214' },
    );
  });

  test('openPanelPicker does not focus already-visible copied panel workspace', () => {
    (panelManager.isVisible as ReturnType<typeof mock>).mockReturnValue(true);
    (panelManager.getAllOpen as ReturnType<typeof mock>).mockReturnValue([{ id: 'system-messages' }]);
    (commandContext.openPanelPicker as () => void)();
    expect(panelManager.show).not.toHaveBeenCalled();
    expect(panelManager.hide).toHaveBeenCalled();
    expect(input.panelFocused).toBe(false);
    expect(input.openAgentWorkspace).toHaveBeenCalledWith(commandContext, 'home');
  });

  test('focusPanels redirects to the Agent workspace instead of copied panels', () => {
    (panelManager.isVisible as ReturnType<typeof mock>).mockReturnValue(true);
    (panelManager.getAllOpen as ReturnType<typeof mock>).mockReturnValue([{ id: 'docs' }]);
    input.panelFocused = true;
    (commandContext.focusPanels as () => void)();
    expect(input.panelFocused).toBe(false);
    expect(input.openAgentWorkspace).toHaveBeenCalledWith(commandContext, 'home');
  });

  test('showPanel redirects known panel ids to matching Agent workspace categories', () => {
    (commandContext.showPanel as (panelId: string) => void)('tasks');
    expect(panelManager.open).not.toHaveBeenCalled();
    expect(panelManager.hide).toHaveBeenCalled();
    expect(input.panelFocused).toBe(false);
    expect(input.openAgentWorkspace).toHaveBeenCalledWith(commandContext, 'work');
    expect(conversation.setSplashSuppressed).toHaveBeenCalledWith(false);
    expect(conversation.log).toHaveBeenCalledWith(
      'Panel route "tasks" is handled through Agent Workspace. Opening the matching operator area.',
      { fg: '214' },
    );
  });

  test('openOnboardingWizard delegates through the shared opener seam', () => {
    input.openOnboardingWizard = mock(() => {});
    (commandContext.openOnboardingWizard as (mode?: 'new' | 'edit') => void)('new');
    expect(input.openOnboardingWizard).toHaveBeenCalledWith('new');
    expect(render).not.toHaveBeenCalled();
  });
});
