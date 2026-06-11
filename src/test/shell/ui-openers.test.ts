import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { wireShellUiOpeners } from '../../shell/ui-openers.ts';
import { createTestManagers } from '../helpers/test-managers.ts';

describe('wireShellUiOpeners', () => {
  let commandContext: Record<string, unknown>;
  let input: Record<string, unknown>;
  let conversation: Record<string, unknown>;
  let render: ReturnType<typeof mock>;
  let testManagers = createTestManagers();

  beforeEach(() => {
    testManagers = createTestManagers();
    commandContext = {};
    input = {
      indicatorFocused: false,
      modelPicker: {},
      modalOpened: mock(() => {}),
      openAgentWorkspace: mock(() => {}),
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
      workingDirectory: process.cwd(),
      homeDirectory: process.env['HOME'] ?? process.cwd(),
      render,
    });
  });

  test('openWorkspacePicker opens the Agent workspace home', () => {
    (commandContext.openWorkspacePicker as () => void)();
    expect(input.openAgentWorkspace).toHaveBeenCalledWith(commandContext, 'home');
    expect(conversation.setSplashSuppressed).toHaveBeenCalledWith(false);
    expect(conversation.rebuildHistory).toHaveBeenCalled();
    expect(render).toHaveBeenCalled();
  });

  test('focusPrompt clears indicator focus and rerenders', () => {
    input.indicatorFocused = true;
    (commandContext.focusPrompt as () => void)();
    expect(input.indicatorFocused).toBe(false);
    expect(render).toHaveBeenCalled();
  });

  test('openAgentWorkspace delegates through the shared opener route', () => {
    (commandContext.openAgentWorkspace as () => void)();
    expect(input.openAgentWorkspace).toHaveBeenCalledWith(commandContext, undefined);
    expect(render).toHaveBeenCalled();
  });
});
