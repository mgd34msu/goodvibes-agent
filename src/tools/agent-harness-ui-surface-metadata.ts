import type { CommandContext } from '../input/command-registry.ts';

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
  readonly open: (context: CommandContext, args: AgentHarnessUiSurfaceArgs) => Record<string, unknown>;
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

export function openHarnessUiSurface(context: CommandContext, args: AgentHarnessUiSurfaceArgs): Record<string, unknown> {
  const surfaceId = readString(args.surfaceId || args.query);
  const surface = UI_SURFACES.find((entry) => entry.id === surfaceId || entry.label.toLowerCase() === surfaceId.toLowerCase());
  if (!surface) {
    return {
      status: 'unknown_ui_surface',
      surfaceId: surfaceId || '<missing>',
      availableSurfaces: UI_SURFACES.map((entry) => entry.id),
    };
  }
  return {
    ...surface.open(context, args),
    descriptor: describeSurface(context, surface),
  };
}
