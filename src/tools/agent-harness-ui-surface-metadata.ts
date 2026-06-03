import type { CommandContext } from '../input/command-registry.ts';
import { openTtsProviderPicker, openTtsVoicePicker } from '../input/tts-settings-actions.ts';

type UiSurfaceKind = 'overlay' | 'modal' | 'workspace' | 'picker';

export interface AgentHarnessUiSurfaceArgs {
  readonly query?: unknown;
  readonly surfaceId?: unknown;
  readonly categoryId?: unknown;
  readonly category?: unknown;
  readonly target?: unknown;
  readonly key?: unknown;
  readonly prefix?: unknown;
  readonly limit?: unknown;
  readonly pane?: unknown;
}

interface UiSurfaceDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: UiSurfaceKind;
  readonly summary: string;
  readonly command: string;
  readonly preferredModelRoute: string;
  readonly parameters?: readonly string[];
  readonly available: (context: CommandContext) => boolean;
  readonly open: (context: CommandContext, args: AgentHarnessUiSurfaceArgs) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function routeUnavailable(surface: UiSurfaceDefinition): Record<string, unknown> {
  return {
    status: 'route_unavailable',
    surface: surface.id,
    note: 'The current runtime did not provide the shell opener for this UI surface.',
  };
}

function opened(surface: UiSurfaceDefinition, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'opened',
    surface: surface.id,
    kind: surface.kind,
    ...extra,
    note: 'UI routing was handed to the current Agent shell bridge.',
  };
}

function optionalModelTarget(args: AgentHarnessUiSurfaceArgs): 'main' | 'helper' | 'tool' | 'tts' | undefined {
  const target = readString(args.target);
  return target === 'main' || target === 'helper' || target === 'tool' || target === 'tts' ? target : undefined;
}

function optionalOnboardingMode(args: AgentHarnessUiSurfaceArgs): 'new' | 'edit' | 'reopen' | undefined {
  const target = readString(args.target);
  return target === 'new' || target === 'edit' || target === 'reopen' ? target : undefined;
}

function workspaceCategory(args: AgentHarnessUiSurfaceArgs): string | undefined {
  return readString(args.categoryId || args.category || args.target) || undefined;
}

function settingsTarget(args: AgentHarnessUiSurfaceArgs): string | undefined {
  return readString(args.target || args.key || args.prefix) || undefined;
}

function providerTarget(args: AgentHarnessUiSurfaceArgs): string | undefined {
  return readString(args.target || args.key || args.prefix) || undefined;
}

function optionalPane(args: AgentHarnessUiSurfaceArgs): 'top' | 'bottom' | undefined {
  const pane = readString(args.pane);
  return pane === 'top' || pane === 'bottom' ? pane : undefined;
}

function surfaceInputText(args: AgentHarnessUiSurfaceArgs): string | undefined {
  return readString(args.prefix || args.key || (args.surfaceId ? args.query : undefined) || args.target) || undefined;
}

function filePickerOptions(args: AgentHarnessUiSurfaceArgs): { injectMode: boolean; query?: string } {
  const target = readString(args.target).toLowerCase();
  const injectMode = target === 'inject' || target === 'inject-mode' || target === '!@';
  return {
    injectMode,
    query: readString(args.prefix || args.key || (args.surfaceId ? args.query : undefined)) || undefined,
  };
}

function openAgentWorkspaceCategory(
  context: CommandContext,
  surface: UiSurfaceDefinition,
  categoryId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  if (!context.openAgentWorkspace) return routeUnavailable(surface);
  context.openAgentWorkspace(categoryId);
  return opened(surface, { categoryId, ...extra });
}

function openPanelWorkspaceSurface(
  context: CommandContext,
  args: AgentHarnessUiSurfaceArgs,
  surface: UiSurfaceDefinition,
  options: {
    readonly panelId: string;
    readonly categoryId: string;
    readonly opener?: (() => void) | undefined;
  },
): Record<string, unknown> {
  if (context.openAgentWorkspace) {
    context.openAgentWorkspace(options.categoryId);
    return opened(surface, { categoryId: options.categoryId, panelId: options.panelId });
  }
  if (options.opener) {
    options.opener();
    return opened(surface, { categoryId: options.categoryId, panelId: options.panelId, route: 'named-opener' });
  }
  if (context.showPanel) {
    const pane = optionalPane(args);
    context.showPanel(options.panelId, pane);
    return opened(surface, {
      categoryId: options.categoryId,
      panelId: options.panelId,
      pane: pane ?? 'default',
      route: 'panel-bridge',
    });
  }
  return routeUnavailable(surface);
}

const UI_SURFACES: readonly UiSurfaceDefinition[] = [
  {
    id: 'agent-workspace',
    label: 'Agent Workspace',
    kind: 'workspace',
    summary: 'Fullscreen operator workspace with setup, knowledge, local state, channels, automation, and delegation routes.',
    command: '/agent',
    preferredModelRoute: 'Use workspace_actions/workspace_action/run_workspace_action for model operation; use open_ui_surface only to visibly navigate.',
    parameters: ['categoryId'],
    available: (context) => typeof context.openAgentWorkspace === 'function',
    open: (context, args) => {
      const surface = findSurfaceById('agent-workspace')!;
      if (!context.openAgentWorkspace) return routeUnavailable(surface);
      const categoryId = workspaceCategory(args);
      context.openAgentWorkspace(categoryId);
      return opened(surface, { categoryId: categoryId ?? 'default' });
    },
  },
  {
    id: 'panel-picker',
    label: 'Panel Picker',
    kind: 'picker',
    summary: 'Keyboard-accessible operator panel route that now opens the Agent Workspace home surface.',
    command: 'Ctrl+P',
    preferredModelRoute: 'Use panels/panel/open_panel for panel catalog and routing, or workspace_actions for concrete model operation.',
    available: (context) => typeof context.openPanelPicker === 'function' || typeof context.openAgentWorkspace === 'function',
    open: (context) => {
      const surface = findSurfaceById('panel-picker')!;
      if (context.openPanelPicker) {
        context.openPanelPicker();
        return opened(surface, { categoryId: 'home', route: 'panel-picker' });
      }
      return openAgentWorkspaceCategory(context, surface, 'home');
    },
  },
  {
    id: 'security-panel',
    label: 'Security Panel',
    kind: 'workspace',
    summary: 'Security review operator surface for token posture, MCP attack paths, policy posture, and plugin risk.',
    command: '/security',
    preferredModelRoute: 'Use workspace_actions for security review actions or run_command /security review for compact read-only output.',
    parameters: ['pane'],
    available: (context) => (
      typeof context.openAgentWorkspace === 'function'
      || typeof context.openSecurityPanel === 'function'
      || typeof context.showPanel === 'function'
    ),
    open: (context, args) => {
      const surface = findSurfaceById('security-panel')!;
      return openPanelWorkspaceSurface(context, args, surface, {
        panelId: 'security',
        categoryId: 'tools',
        opener: context.openSecurityPanel,
      });
    },
  },
  {
    id: 'knowledge-panel',
    label: 'Knowledge Panel',
    kind: 'workspace',
    summary: 'Agent Knowledge operator surface for isolated status, source libraries, graph review, ask/search, and ingest forms.',
    command: '/knowledge',
    preferredModelRoute: 'Use agent_knowledge, agent_knowledge_ingest, workspace_actions, or run_command /knowledge for concrete model operation.',
    parameters: ['pane'],
    available: (context) => (
      typeof context.openAgentWorkspace === 'function'
      || typeof context.openKnowledgePanel === 'function'
      || typeof context.showPanel === 'function'
    ),
    open: (context, args) => {
      const surface = findSurfaceById('knowledge-panel')!;
      return openPanelWorkspaceSurface(context, args, surface, {
        panelId: 'knowledge',
        categoryId: 'knowledge',
        opener: context.openKnowledgePanel,
      });
    },
  },
  {
    id: 'subscription-panel',
    label: 'Subscription Panel',
    kind: 'workspace',
    summary: 'Provider subscription operator surface for subscription review, provider inspection, login, logout, and bundle flows.',
    command: '/subscription',
    preferredModelRoute: 'Use workspace_actions or confirmed run_command /subscription mirrors for concrete subscription operation.',
    parameters: ['pane'],
    available: (context) => (
      typeof context.openAgentWorkspace === 'function'
      || typeof context.openSubscriptionPanel === 'function'
      || typeof context.showPanel === 'function'
    ),
    open: (context, args) => {
      const surface = findSurfaceById('subscription-panel')!;
      return openPanelWorkspaceSurface(context, args, surface, {
        panelId: 'subscription',
        categoryId: 'setup',
        opener: context.openSubscriptionPanel,
      });
    },
  },
  {
    id: 'settings',
    label: 'Settings',
    kind: 'modal',
    summary: 'Fullscreen settings workspace for Agent-owned configuration, subscriptions, secrets, MCP, tools, and surface settings.',
    command: '/settings',
    preferredModelRoute: 'Use settings/get_setting/set_setting/reset_setting for model operation; use open_ui_surface only to visibly navigate.',
    parameters: ['target', 'key', 'prefix'],
    available: (context) => typeof context.openSettingsModal === 'function',
    open: (context, args) => {
      const surface = findSurfaceById('settings')!;
      if (!context.openSettingsModal) return routeUnavailable(surface);
      const target = settingsTarget(args);
      context.openSettingsModal(target);
      return opened(surface, { target: target ?? 'default' });
    },
  },
  {
    id: 'mcp-workspace',
    label: 'MCP Workspace',
    kind: 'workspace',
    summary: 'MCP server setup, trust posture, and tool inventory workspace.',
    command: '/mcp',
    preferredModelRoute: 'Use workspace_actions, tools, and settings modes for model operation.',
    available: (context) => typeof context.openMcpWorkspace === 'function',
    open: (context) => {
      const surface = findSurfaceById('mcp-workspace')!;
      if (!context.openMcpWorkspace) return routeUnavailable(surface);
      context.openMcpWorkspace();
      return opened(surface);
    },
  },
  {
    id: 'model-picker',
    label: 'Model Picker',
    kind: 'picker',
    summary: 'Interactive model picker for main, helper, tool, and TTS model routes.',
    command: '/model',
    preferredModelRoute: 'Use settings mode for direct provider.model changes, or run_command /model with confirmation when a concrete model id is known.',
    parameters: ['target'],
    available: (context) => typeof context.openModelPicker === 'function' || typeof context.openModelPickerWithTarget === 'function',
    open: (context, args) => {
      const surface = findSurfaceById('model-picker')!;
      const target = optionalModelTarget(args);
      if (target && context.openModelPickerWithTarget) {
        const openedForTarget = context.openModelPickerWithTarget(target);
        return opened(surface, { target, openedForTarget });
      }
      if (!context.openModelPicker) return routeUnavailable(surface);
      context.openModelPicker();
      return opened(surface, { target: 'main' });
    },
  },
  {
    id: 'provider-picker',
    label: 'Provider Picker',
    kind: 'picker',
    summary: 'Interactive provider picker for model route setup.',
    command: '/provider',
    preferredModelRoute: 'Use settings mode for direct provider routing changes, or run confirmed slash-command mirrors for concrete provider changes.',
    parameters: ['target'],
    available: (context) => typeof context.openProviderPicker === 'function' || typeof context.openProviderModelPickerWithTarget === 'function',
    open: (context, args) => {
      const surface = findSurfaceById('provider-picker')!;
      const target = optionalModelTarget(args);
      if (target && context.openProviderModelPickerWithTarget) {
        context.openProviderModelPickerWithTarget(target);
        return opened(surface, { target });
      }
      if (!context.openProviderPicker) return routeUnavailable(surface);
      context.openProviderPicker();
      return opened(surface, { target: 'main' });
    },
  },
  {
    id: 'reasoning-effort-picker',
    label: 'Reasoning Effort Picker',
    kind: 'picker',
    summary: 'Interactive reasoning-effort selector for the current main chat model when that model exposes effort levels.',
    command: '/effort',
    preferredModelRoute: 'Use settings/get_setting/set_setting for provider.reasoningEffort when a concrete level is known, or run_workspace_action setup-effort with confirmation.',
    available: (context) => typeof context.openReasoningEffortPicker === 'function',
    open: (context) => {
      const surface = findSurfaceById('reasoning-effort-picker')!;
      if (!context.openReasoningEffortPicker) return routeUnavailable(surface);
      const result = context.openReasoningEffortPicker();
      return result.opened
        ? opened(surface, {
          model: result.model,
          levels: result.levels ?? [],
        })
        : {
          status: 'not_opened',
          surface: surface.id,
          kind: surface.kind,
          model: result.model,
          levels: result.levels ?? [],
          reason: result.reason ?? 'unsupported',
          note: 'The current model does not expose configurable reasoning effort levels.',
        };
    },
  },
  {
    id: 'tts-provider-picker',
    label: 'TTS Provider Picker',
    kind: 'picker',
    summary: 'Interactive streaming TTS provider picker opened from the Agent settings flow.',
    command: '/config tts.provider',
    preferredModelRoute: 'Use settings/get_setting/set_setting for tts.provider when a concrete provider id is known; use open_ui_surface only to visibly navigate.',
    available: (context) => typeof context.openSelection === 'function' && Boolean(context.platform.voiceProviderRegistry),
    open: (context) => {
      const surface = findSurfaceById('tts-provider-picker')!;
      if (!context.openSelection || !context.platform.voiceProviderRegistry) return routeUnavailable(surface);
      const handled = openTtsProviderPicker(context);
      return handled ? opened(surface, { target: 'tts.provider' }) : routeUnavailable(surface);
    },
  },
  {
    id: 'tts-voice-picker',
    label: 'TTS Voice Picker',
    kind: 'picker',
    summary: 'Interactive TTS voice picker opened from the Agent settings flow for the selected or supplied provider.',
    command: '/config tts.voice',
    preferredModelRoute: 'Use settings/get_setting/set_setting/reset_setting for tts.voice when a concrete voice id is known; use open_ui_surface only to visibly navigate.',
    parameters: ['target'],
    available: (context) => typeof context.openSelection === 'function' && Boolean(context.platform.voiceService),
    open: async (context, args) => {
      const surface = findSurfaceById('tts-voice-picker')!;
      if (!context.openSelection || !context.platform.voiceService) return routeUnavailable(surface);
      const providerId = providerTarget(args);
      const handled = await openTtsVoicePicker(context, providerId);
      return handled
        ? opened(surface, { target: 'tts.voice', providerId: providerId ?? 'configured-default' })
        : routeUnavailable(surface);
    },
  },
  {
    id: 'session-picker',
    label: 'Session Picker',
    kind: 'picker',
    summary: 'Saved session browser and loader.',
    command: '/sessions',
    preferredModelRoute: 'Use session slash-command mirrors with confirmation for concrete save/load/export actions.',
    available: (context) => typeof context.openSessionPicker === 'function',
    open: (context) => {
      const surface = findSurfaceById('session-picker')!;
      if (!context.openSessionPicker) return routeUnavailable(surface);
      context.openSessionPicker();
      return opened(surface);
    },
  },
  {
    id: 'profile-picker',
    label: 'Profile Picker',
    kind: 'picker',
    summary: 'Agent profile picker for local isolated profile selection.',
    command: '/agent-profile',
    preferredModelRoute: 'Use workspace profile actions or profile slash-command mirrors for concrete model operation.',
    available: (context) => typeof context.openProfilePicker === 'function',
    open: (context) => {
      const surface = findSurfaceById('profile-picker')!;
      if (!context.openProfilePicker) return routeUnavailable(surface);
      context.openProfilePicker();
      return opened(surface);
    },
  },
  {
    id: 'bookmark-modal',
    label: 'Bookmarks',
    kind: 'modal',
    summary: 'Transcript bookmark browser.',
    command: '/bookmarks',
    preferredModelRoute: 'Use slash-command mirrors for concrete bookmark inspection; opening is visible navigation only.',
    available: (context) => typeof context.openBookmarkModal === 'function',
    open: (context) => {
      const surface = findSurfaceById('bookmark-modal')!;
      if (!context.openBookmarkModal) return routeUnavailable(surface);
      context.openBookmarkModal();
      return opened(surface);
    },
  },
  {
    id: 'context-inspector',
    label: 'Context Inspector',
    kind: 'modal',
    summary: 'Context-window usage and token breakdown inspector.',
    command: '/context',
    preferredModelRoute: 'Use slash-command mirrors for text output; opening is visible navigation only.',
    available: (context) => typeof context.openContextInspector === 'function',
    open: (context) => {
      const surface = findSurfaceById('context-inspector')!;
      if (!context.openContextInspector) return routeUnavailable(surface);
      context.openContextInspector();
      return opened(surface);
    },
  },
  {
    id: 'process-monitor',
    label: 'Runtime Activity Monitor',
    kind: 'modal',
    summary: 'Visible running-process and live-output monitor opened by the same shell route as F2.',
    command: 'F2',
    preferredModelRoute: 'Use this only for visible supervision of runtime activity; use first-class model tools or confirmed commands for actual operations.',
    available: (context) => typeof context.openProcessModal === 'function',
    open: (context) => {
      const surface = findSurfaceById('process-monitor')!;
      if (!context.openProcessModal) return routeUnavailable(surface);
      context.openProcessModal();
      return opened(surface);
    },
  },
  {
    id: 'live-tail',
    label: 'Live Process Output',
    kind: 'modal',
    summary: 'Visible live-output tail for a running process, opened by the same shell route as Enter from the runtime activity monitor.',
    command: 'F2, Enter',
    preferredModelRoute: 'Use this only for visible supervision of a running process output stream; use first-class model tools or confirmed commands for actual operations.',
    parameters: ['target', 'query', 'prefix', 'key'],
    available: (context) => typeof context.openLiveTail === 'function',
    open: (context, args) => {
      const surface = findSurfaceById('live-tail')!;
      if (!context.openLiveTail) return routeUnavailable(surface);
      const target = surfaceInputText(args);
      const result = context.openLiveTail(target);
      return result.opened
        ? opened(surface, {
          target: target ?? 'selected',
          processId: result.processId,
          label: result.label,
        })
        : {
          status: 'not_opened',
          surface: surface.id,
          kind: surface.kind,
          target: target ?? 'selected',
          reason: result.reason ?? 'not_found',
          note: result.reason === 'no_processes'
            ? 'There are no running shell processes to tail.'
            : 'No running shell process matched the requested target.',
        };
    },
  },
  {
    id: 'conversation-search',
    label: 'Conversation Search',
    kind: 'overlay',
    summary: 'Visible transcript search overlay opened by the same shell route as Ctrl+F.',
    command: 'Ctrl+F',
    preferredModelRoute: 'Use conversation/session/content modes for model-readable inspection; use this surface for visible transcript search navigation.',
    parameters: ['query', 'prefix', 'key'],
    available: (context) => typeof context.openConversationSearch === 'function',
    open: (context, args) => {
      const surface = findSurfaceById('conversation-search')!;
      if (!context.openConversationSearch) return routeUnavailable(surface);
      const query = surfaceInputText(args);
      context.openConversationSearch(query);
      return opened(surface, { query: query ?? '' });
    },
  },
  {
    id: 'prompt-history-search',
    label: 'Prompt History Search',
    kind: 'overlay',
    summary: 'Visible reverse prompt-history search opened by the same shell route as Ctrl+R.',
    command: 'Ctrl+R',
    preferredModelRoute: 'Use this only for visible prompt recall; accepting a result remains an explicit interactive shell action.',
    parameters: ['query', 'prefix', 'key'],
    available: (context) => typeof context.openPromptHistorySearch === 'function',
    open: (context, args) => {
      const surface = findSurfaceById('prompt-history-search')!;
      if (!context.openPromptHistorySearch) return routeUnavailable(surface);
      const query = surfaceInputText(args);
      context.openPromptHistorySearch(query);
      return opened(surface, { query: query ?? '' });
    },
  },
  {
    id: 'slash-command-mode',
    label: 'Slash Command Mode',
    kind: 'overlay',
    summary: 'Slash-command autocomplete route opened by the same shell path as typing / in an empty prompt.',
    command: '/',
    preferredModelRoute: 'Use commands/command for model-readable command discovery and run_command for confirmed command execution.',
    parameters: ['query', 'prefix', 'key'],
    available: (context) => typeof context.openSlashCommandMode === 'function',
    open: (context, args) => {
      const surface = findSurfaceById('slash-command-mode')!;
      if (!context.openSlashCommandMode) return routeUnavailable(surface);
      const query = surfaceInputText(args);
      const openedCommandMode = context.openSlashCommandMode(query);
      return openedCommandMode
        ? opened(surface, { query: query ?? '' })
        : {
          status: 'not_opened',
          surface: surface.id,
          kind: surface.kind,
          query: query ?? '',
          note: 'The current prompt contains a non-command draft, so the shell opener refused to replace it.',
        };
    },
  },
  {
    id: 'command-browser',
    label: 'Command Browser',
    kind: 'picker',
    summary: 'Registry-driven searchable slash-command browser opened by /commands and /help.',
    command: '/commands',
    preferredModelRoute: 'Use commands/command for model-readable slash-command discovery and run_command for confirmed command execution.',
    available: (context) => typeof context.executeCommand === 'function',
    open: async (context) => {
      const surface = findSurfaceById('command-browser')!;
      if (!context.executeCommand) return routeUnavailable(surface);
      const handled = await context.executeCommand('commands', []);
      return handled
        ? opened(surface, { command: '/commands' })
        : {
          status: 'not_opened',
          surface: surface.id,
          kind: surface.kind,
          note: 'The slash-command registry did not handle /commands in the current runtime.',
        };
    },
  },
  {
    id: 'file-picker',
    label: 'File Picker',
    kind: 'picker',
    summary: 'Visible project file picker opened by the same prompt route as @ and !@ references.',
    command: '@',
    preferredModelRoute: 'Use first-class file, workspace, or artifact tools for model operation; use this for visible file reference navigation.',
    parameters: ['target=reference|inject', 'query', 'prefix', 'key'],
    available: (context) => typeof context.openFilePicker === 'function',
    open: (context, args) => {
      const surface = findSurfaceById('file-picker')!;
      if (!context.openFilePicker) return routeUnavailable(surface);
      const options = filePickerOptions(args);
      const openedFilePicker = context.openFilePicker(options);
      return openedFilePicker
        ? opened(surface, { mode: options.injectMode ? 'inject' : 'reference', query: options.query ?? '' })
        : routeUnavailable(surface);
    },
  },
  {
    id: 'block-actions',
    label: 'Block Actions',
    kind: 'overlay',
    summary: 'Visible nearest-block action menu opened by the same shell route as pressing Enter on an empty prompt near transcript content.',
    command: 'Enter on empty prompt',
    preferredModelRoute: 'Use conversation/session/content modes or confirmed slash-command mirrors for concrete block operations; use this surface for visible block-action navigation.',
    available: (context) => typeof context.openBlockActions === 'function',
    open: (context) => {
      const surface = findSurfaceById('block-actions')!;
      if (!context.openBlockActions) return routeUnavailable(surface);
      const openedBlockActions = context.openBlockActions();
      return openedBlockActions
        ? opened(surface)
        : {
          status: 'not_opened',
          surface: surface.id,
          kind: surface.kind,
          note: 'The shell opener requires an empty prompt and a nearby rendered conversation block.',
        };
    },
  },
  {
    id: 'help-overlay',
    label: 'Help Overlay',
    kind: 'overlay',
    summary: 'Registry-driven command and shortcut help overlay.',
    command: '/help',
    preferredModelRoute: 'Use commands/command and shortcuts modes for model-readable discovery.',
    available: (context) => typeof context.openHelpOverlay === 'function',
    open: (context) => {
      const surface = findSurfaceById('help-overlay')!;
      if (!context.openHelpOverlay) return routeUnavailable(surface);
      context.openHelpOverlay();
      return opened(surface);
    },
  },
  {
    id: 'shortcuts-overlay',
    label: 'Shortcuts Overlay',
    kind: 'overlay',
    summary: 'Keyboard shortcut reference overlay.',
    command: '/shortcuts',
    preferredModelRoute: 'Use shortcuts/keybindings modes for model-readable discovery and confirmed keybinding edits.',
    available: (context) => typeof context.openShortcutsOverlay === 'function',
    open: (context) => {
      const surface = findSurfaceById('shortcuts-overlay')!;
      if (!context.openShortcutsOverlay) return routeUnavailable(surface);
      context.openShortcutsOverlay();
      return opened(surface);
    },
  },
  {
    id: 'onboarding',
    label: 'Onboarding Wizard',
    kind: 'modal',
    summary: 'First-run and setup review wizard for Agent readiness.',
    command: '/setup',
    preferredModelRoute: 'Use workspace setup actions and settings modes for concrete model operation.',
    parameters: ['target=new|edit|reopen'],
    available: (context) => typeof context.openOnboardingWizard === 'function',
    open: (context, args) => {
      const surface = findSurfaceById('onboarding')!;
      if (!context.openOnboardingWizard) return routeUnavailable(surface);
      const mode = optionalOnboardingMode(args);
      context.openOnboardingWizard(mode);
      return opened(surface, { mode: mode ?? 'default' });
    },
  },
];

function findSurfaceById(surfaceId: string): UiSurfaceDefinition | undefined {
  return UI_SURFACES.find((surface) => surface.id === surfaceId);
}

function surfaceMatches(surface: Record<string, unknown>, query: string): boolean {
  if (!query) return true;
  return [
    surface.id,
    surface.label,
    surface.kind,
    surface.summary,
    surface.command,
    surface.preferredModelRoute,
  ].map((value) => String(value ?? '')).join('\n').toLowerCase().includes(query.toLowerCase());
}

function describeSurface(context: CommandContext, surface: UiSurfaceDefinition): Record<string, unknown> {
  return {
    id: surface.id,
    label: surface.label,
    kind: surface.kind,
    summary: surface.summary,
    command: surface.command,
    preferredModelRoute: surface.preferredModelRoute,
    parameters: surface.parameters ?? [],
    available: surface.available(context),
    policy: {
      effect: 'visible-ui-navigation',
      confirmation: 'agent_harness mode:"open_ui_surface" requires confirm:true and explicitUserRequest.',
      boundary: 'UI surface routing opens the same visible Agent shell surface the user can open. Use first-class model tools, settings modes, workspace actions, or confirmed slash-command mirrors for actual operations.',
    },
  };
}

export function totalHarnessUiSurfaces(): number {
  return UI_SURFACES.length;
}

export function listHarnessUiSurfaces(context: CommandContext, args: AgentHarnessUiSurfaceArgs): readonly Record<string, unknown>[] {
  const query = readString(args.query);
  const limit = readLimit(args.limit, 200);
  return UI_SURFACES
    .map((surface) => describeSurface(context, surface))
    .filter((surface) => surfaceMatches(surface, query))
    .slice(0, limit);
}

export function describeHarnessUiSurface(context: CommandContext, args: AgentHarnessUiSurfaceArgs): Record<string, unknown> | null {
  const surfaceId = readString(args.surfaceId || args.query);
  if (!surfaceId) return null;
  const surface = UI_SURFACES.find((entry) => entry.id === surfaceId || entry.label.toLowerCase() === surfaceId.toLowerCase());
  return surface ? describeSurface(context, surface) : null;
}

export async function openHarnessUiSurface(context: CommandContext, args: AgentHarnessUiSurfaceArgs): Promise<Record<string, unknown>> {
  const surfaceId = readString(args.surfaceId || args.query);
  const surface = UI_SURFACES.find((entry) => entry.id === surfaceId || entry.label.toLowerCase() === surfaceId.toLowerCase());
  if (!surface) {
    return {
      status: 'unknown_ui_surface',
      surfaceId: surfaceId || '<missing>',
      availableSurfaces: UI_SURFACES.map((entry) => entry.id),
    };
  }
  const routed = await surface.open(context, args);
  return {
    ...routed,
    descriptor: describeSurface(context, surface),
  };
}
