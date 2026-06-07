import type { CommandContext } from '../input/command-registry.ts';
import { resolveRuntimeEndpointBinding } from '../cli/endpoints.ts';
import { AGENT_WORKSPACE_CATEGORIES } from '../input/agent-workspace-categories.ts';
import { openTtsProviderPicker, openTtsVoicePicker } from '../input/tts-settings-actions.ts';
import { readOnboardingCompletionMarker } from '../runtime/onboarding/index.ts';
import { openExternalUrl } from '@pellux/goodvibes-sdk/platform/utils';

type UiSurfaceKind = 'overlay' | 'modal' | 'workspace' | 'picker';

function agentHarnessModes(...modes: readonly string[]): string {
  return `agent_harness ${modes.map((mode) => `mode:"${mode}"`).join(', ')}`;
}

export interface AgentHarnessUiSurfaceArgs {
  readonly query?: unknown;
  readonly surfaceId?: unknown;
  readonly categoryId?: unknown;
  readonly category?: unknown;
  readonly target?: unknown;
  readonly key?: unknown;
  readonly prefix?: unknown;
  readonly includeParameters?: unknown;
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

interface UiSurfaceLookup {
  readonly source: 'surfaceId' | 'target' | 'query';
  readonly input: string;
  readonly resolvedBy: 'id' | 'case-insensitive-id' | 'label' | 'case-insensitive-label' | 'search';
}

type UiSurfaceResolution =
  | {
    readonly status: 'found';
    readonly surface: UiSurfaceDefinition;
    readonly lookup: UiSurfaceLookup;
  }
  | {
    readonly status: 'ambiguous';
    readonly input: string;
    readonly candidates: readonly Record<string, unknown>[];
  };

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
    note: 'UI routing was handed to the current Agent operator surface.',
  };
}

function browserConnectHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1';
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]`;
  return host || '127.0.0.1';
}

const BROWSER_COCKPIT_EXPECTED_LANES = [
  {
    id: 'chat-and-sessions',
    label: 'Chat and sessions',
    categoryIds: ['home', 'conversation'],
    userOutcome: 'Continue normal assistant chat, session review, prompt history, bookmarks, and current work from the browser.',
  },
  {
    id: 'setup-and-settings',
    label: 'Setup and settings',
    categoryIds: ['setup', 'account-model', 'assistant-behavior', 'tools-permissions', 'onboarding-display', 'finish'],
    userOutcome: 'Finish first-run setup, choose models, adjust behavior, review permissions, and close onboarding without returning to terminal-only controls.',
  },
  {
    id: 'mobile-and-channels',
    label: 'Mobile and channels',
    categoryIds: ['onboarding-channels', 'onboarding-voice-media', 'channels', 'voice-media', 'personal-ops'],
    userOutcome: 'Configure mobile-friendly messaging, notification, voice, phone, and daily personal-operation routes from one cockpit.',
  },
  {
    id: 'knowledge-and-memory',
    label: 'Knowledge and memory',
    categoryIds: ['onboarding-context', 'knowledge', 'profiles', 'memory', 'notes', 'personas', 'skills', 'routines'],
    userOutcome: 'Review and curate user context, project knowledge, memories, notes, personas, skills, and routines with browser-native forms.',
  },
  {
    id: 'work-and-automation',
    label: 'Work and automation',
    categoryIds: ['work', 'automation', 'onboarding-automation', 'delegate'],
    userOutcome: 'Approve, supervise, recover, schedule, and delegate autonomous work with touch-friendly controls and receipts.',
  },
  {
    id: 'research-and-artifacts',
    label: 'Research and artifacts',
    categoryIds: ['research', 'documents', 'artifacts'],
    userOutcome: 'Run research, draft documents, review packets, browse artifacts, and export/share deliverables from the browser.',
  },
  {
    id: 'host-and-safety',
    label: 'Host and safety',
    categoryIds: ['tools', 'host'],
    userOutcome: 'Inspect tool trust, MCP posture, connected-host repair, service health, support bundles, and recovery routes.',
  },
] as const;

function confirmedCategoryRoute(categoryId: string, label: string): string {
  return `agent_harness mode:"open_ui_surface" surfaceId:"agent-workspace" categoryId:"${categoryId}" confirm:true explicitUserRequest:"Open the ${label} workspace."`;
}

function browserCockpitWorkspaceCoverage(enabled: boolean, includeDetails: boolean): Record<string, unknown> {
  const browserStatus = enabled ? 'terminal-first' : 'blocked-by-web-setup';
  const categories = AGENT_WORKSPACE_CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    group: category.group,
    actions: category.actions.length,
    browserStatus,
    browserRoute: null,
    agentRoute: confirmedCategoryRoute(category.id, category.label),
    neededContract: 'connected-host browser-native Agent workspace category route',
  }));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  return {
    status: enabled ? 'needs-browser-native-category-contracts' : 'web-setup-needed',
    summary: enabled
      ? 'The connected-host web URL is openable, but Agent has not received a published browser-native route contract for workspace categories yet.'
      : 'The connected-host web endpoint is disabled, so browser-native workspace categories cannot be reached yet.',
    categoryCount: categories.length,
    nativeCategoryRoutesPublished: false,
    terminalFallback: 'Every Agent workspace category remains reachable through the TUI Agent Workspace while browser-native category routes are being published.',
    laneCount: BROWSER_COCKPIT_EXPECTED_LANES.length,
    ...(includeDetails ? {
      lanes: BROWSER_COCKPIT_EXPECTED_LANES.map((lane) => ({
        id: lane.id,
        label: lane.label,
        categoryIds: lane.categoryIds,
        userOutcome: lane.userOutcome,
        browserStatus: enabled ? 'needs-browser-native-contract' : 'blocked-by-web-setup',
        agentRoutes: lane.categoryIds
          .map((categoryId) => categoryById.get(categoryId))
          .filter((category): category is NonNullable<typeof category> => Boolean(category))
          .map((category) => category.agentRoute),
      })),
      categories,
    } : {}),
    policy: 'Workspace coverage is a route contract map, not a claim that the connected-host browser already renders these Agent category controls.',
  };
}

function browserCockpitMobileAffordances(enabled: boolean, includeDetails: boolean): Record<string, unknown> {
  const controls = [
    {
      id: 'open-browser-cockpit',
      label: 'Open browser cockpit',
      status: enabled ? 'ready' : 'blocked-by-web-setup',
      modelRoute: 'agent_harness mode:"open_ui_surface" surfaceId:"connected-browser-cockpit" confirm:true explicitUserRequest:"..."',
    },
    {
      id: 'inspect-web-endpoint',
      label: 'Inspect web endpoint',
      status: 'ready',
      modelRoute: 'agent_harness mode:"service_endpoint" endpointId:"web" includeParameters:true',
    },
    {
      id: 'inspect-device-map',
      label: 'Inspect device capability map',
      status: 'ready',
      modelRoute: 'agent_harness mode:"pairing_route" pairingRouteId:"browser-cockpit-pwa"',
    },
    {
      id: 'review-web-settings',
      label: 'Review web settings',
      status: 'ready',
      modelRoute: 'agent_harness mode:"settings" query:"web" includeHidden:true',
    },
  ];
  return {
    status: enabled ? 'openable' : 'setup-needed',
    controlCount: controls.length,
    ...(includeDetails ? { controls } : {}),
    pwaInstall: {
      status: enabled ? 'browser-owned' : 'blocked-by-web-setup',
      note: 'Agent can open the configured URL; installing the PWA remains a browser/connected-host UI action.',
    },
    touchControls: {
      status: 'needs-browser-native-category-contracts',
      note: 'Agent has not received a connected-host contract proving mobile-native controls for chat, setup, approvals, memory, channels, or automation.',
    },
  };
}

function browserCockpitReceipts(context: CommandContext, enabled: boolean, includeDetails: boolean): Record<string, unknown> {
  const marker = (() => {
    try {
      const shellPaths = context.workspace?.shellPaths;
      if (!shellPaths) return { status: 'unavailable', exists: false, reason: 'Agent shell paths are unavailable in this runtime.' };
      const completion = readOnboardingCompletionMarker(shellPaths, 'user');
      return {
        status: completion.exists ? 'complete' : 'missing',
        exists: completion.exists,
        path: completion.path,
        updatedAt: completion.payload?.updatedAt ?? null,
        source: completion.payload?.source ?? null,
        mode: completion.payload?.mode ?? null,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        exists: false,
        reason: error instanceof Error ? error.message : 'Unable to read Agent onboarding completion marker.',
      };
    }
  })();
  return {
    status: marker.exists === true ? 'agent-complete-browser-receipt-missing' : 'needs-agent-closeout-and-browser-receipt',
    agentOnboardingStatus: marker.status,
    browserFirstRunStatus: 'not-published',
    ...(includeDetails ? {
      agentOnboardingCompletion: marker,
      browserFirstRunCompletion: {
        status: 'not-published',
        webEnabled: enabled,
        evidence: null,
        nextStep: 'Publish a connected-host browser/PWA completion receipt before using browser readiness as first-run closeout evidence.',
      },
    } : {}),
    setupCloseoutRoute: 'agent_harness mode:"setup_posture" includeParameters:true',
    policy: 'Agent reports its own user onboarding marker separately from the connected-host browser/PWA receipt contract so setup closeout does not overclaim browser readiness.',
  };
}

function connectedBrowserCockpitRoute(context: CommandContext, options: { readonly includeWorkspaceCoverage?: boolean } = {}): Record<string, unknown> {
  const configManager = context.platform?.configManager;
  let enabled = false;
  let binding = { hostMode: 'local', configuredHost: '127.0.0.1', host: '127.0.0.1', port: 3423 };
  let publicBaseUrl = '';
  if (configManager) {
    try {
      enabled = configManager.get('web.enabled') === true;
      binding = resolveRuntimeEndpointBinding(configManager, 'web');
      publicBaseUrl = String(configManager.get('web.publicBaseUrl') ?? '').trim();
    } catch {
      enabled = false;
    }
  }
  const url = publicBaseUrl || `http://${browserConnectHost(binding.host)}:${binding.port}`;
  return {
    enabled,
    readiness: enabled ? 'ready' : 'setup-needed',
    url,
    source: publicBaseUrl ? 'web.publicBaseUrl' : 'web endpoint binding',
    endpoint: {
      id: 'web',
      binding,
      settings: ['web.enabled', 'web.hostMode', 'web.host', 'web.port', 'web.publicBaseUrl'],
    },
    workspaceCoverage: browserCockpitWorkspaceCoverage(enabled, options.includeWorkspaceCoverage === true),
    mobile: browserCockpitMobileAffordances(enabled, options.includeWorkspaceCoverage === true),
    receipts: browserCockpitReceipts(context, enabled, options.includeWorkspaceCoverage === true),
    setupRoutes: {
      inspectEndpoint: 'agent_harness mode:"service_endpoint" endpointId:"web" includeParameters:true',
      servicePosture: 'agent_harness mode:"service_posture" includeParameters:true',
      connectedHostStatus: 'agent_harness mode:"connected_host_status" includeParameters:true',
      settings: 'agent_harness mode:"settings" query:"web" includeHidden:true',
    },
    policy: 'Opens the connected GoodVibes browser cockpit only after explicit user confirmation. Agent does not host a separate browser app or bypass connected-host setup.',
  };
}

function optionalModelTarget(args: AgentHarnessUiSurfaceArgs): 'main' | 'helper' | 'tool' | 'tts' | undefined {
  const target = readString(args.target);
  return target === 'main' || target === 'helper' || target === 'tool' || target === 'tts' ? target : undefined;
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
      route: 'panel-route',
    });
  }
  return routeUnavailable(surface);
}

function openSimpleContextSurface(context: CommandContext, surfaceId: string, openerKey: keyof CommandContext): Record<string, unknown> {
  const surface = findSurfaceById(surfaceId)!;
  const opener = context[openerKey] as unknown;
  if (typeof opener !== 'function') return routeUnavailable(surface);
  (opener as () => void)();
  return opened(surface);
}

const UI_SURFACES: readonly UiSurfaceDefinition[] = [
  {
    id: 'agent-workspace',
    label: 'Agent Workspace',
    kind: 'workspace',
    summary: 'Operator workspace for setup, knowledge, channels, and automation.',
    command: '/agent',
    preferredModelRoute: `Use ${agentHarnessModes('workspace_actions', 'workspace_action', 'run_workspace_action')} for model operation; use mode:"open_ui_surface" only to visibly navigate.`,
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
    id: 'connected-browser-cockpit',
    label: 'Connected Browser Cockpit',
    kind: 'workspace',
    summary: 'Connected-host browser cockpit/PWA route.',
    command: 'connected host web route',
    preferredModelRoute: `Use ${agentHarnessModes('service_endpoint', 'service_posture', 'connected_host_status', 'settings')} to inspect or repair web readiness; use mode:"open_ui_surface" only to visibly open the configured cockpit URL.`,
    available: (context) => {
      try {
        return context.platform?.configManager?.get?.('web.enabled') === true;
      } catch {
        return false;
      }
    },
    open: async (context) => {
      const surface = findSurfaceById('connected-browser-cockpit')!;
      const route = connectedBrowserCockpitRoute(context);
      if (route.enabled !== true) {
        return {
          status: 'setup_needed',
          surface: surface.id,
          kind: surface.kind,
          route,
          note: 'The connected-host web endpoint is disabled. Inspect service posture or web settings before opening a browser cockpit.',
        };
      }
      const url = typeof route.url === 'string' ? route.url : '';
      const browserOpened = url ? await openExternalUrl(url) : false;
      return browserOpened
        ? opened(surface, { url, route, browserOpened })
        : {
          status: 'open_failed',
          surface: surface.id,
          kind: surface.kind,
          url,
          route,
          browserOpened,
          note: 'The configured browser cockpit URL was resolved, but the external browser opener did not report success.',
        };
    },
  },
  {
    id: 'panel-picker',
    label: 'Panel Picker',
    kind: 'picker',
    summary: 'Operator panel route into Agent Workspace home.',
    command: 'Ctrl+P',
    preferredModelRoute: `Use ${agentHarnessModes('panels', 'panel', 'open_panel')} for panel catalog and routing, or mode:"workspace_actions" for concrete model operation.`,
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
    summary: 'Operator security review for tokens, MCP, policy, and plugin risk.',
    command: '/security',
    preferredModelRoute: `Use mode:"workspace_actions" for security review actions or ${agentHarnessModes('run_command')} for confirmed /security review output.`,
    parameters: ['pane'],
    available: (context) => typeof context.openAgentWorkspace === 'function' || typeof context.openSecurityPanel === 'function' || typeof context.showPanel === 'function',
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
    summary: 'Operator Knowledge surface for isolated status, search, and ingest.',
    command: '/knowledge',
    preferredModelRoute: `Use agent_knowledge, agent_knowledge_ingest, mode:"workspace_actions", or ${agentHarnessModes('run_command')} for confirmed /knowledge operation.`,
    parameters: ['pane'],
    available: (context) => typeof context.openAgentWorkspace === 'function' || typeof context.openKnowledgePanel === 'function' || typeof context.showPanel === 'function',
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
    summary: 'Operator subscription surface for provider review, auth, and bundles.',
    command: '/subscription',
    preferredModelRoute: `Use mode:"workspace_actions" or ${agentHarnessModes('run_command')} for confirmed /subscription mirrors.`,
    parameters: ['pane'],
    available: (context) => typeof context.openAgentWorkspace === 'function' || typeof context.openSubscriptionPanel === 'function' || typeof context.showPanel === 'function',
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
    summary: 'Fullscreen settings workspace for Agent config, secrets, MCP, and tools.',
    command: '/settings',
    preferredModelRoute: `Use ${agentHarnessModes('settings', 'get_setting', 'set_setting', 'reset_setting')} for model operation; use mode:"open_ui_surface" only to visibly navigate.`,
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
    preferredModelRoute: `Use ${agentHarnessModes('workspace_actions', 'tools', 'settings')} for model operation.`,
    available: (context) => typeof context.openMcpWorkspace === 'function',
    open: (context) => openSimpleContextSurface(context, 'mcp-workspace', 'openMcpWorkspace'),
  },
  {
    id: 'model-picker',
    label: 'Model Picker',
    kind: 'picker',
    summary: 'Interactive model picker for main, helper, tool, and TTS model routes.',
    command: '/model',
    preferredModelRoute: `Use ${agentHarnessModes('settings', 'get_setting', 'set_setting')} for direct provider.model changes, or mode:"run_command" with confirmation when a concrete model id is known.`,
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
    preferredModelRoute: `Use ${agentHarnessModes('settings', 'get_setting', 'set_setting')} for direct provider routing changes, or confirmed mode:"run_command" mirrors for concrete provider changes.`,
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
    summary: 'Reasoning-effort selector for models that expose effort levels.',
    command: '/effort',
    preferredModelRoute: `Use ${agentHarnessModes('settings', 'get_setting', 'set_setting')} for provider.reasoningEffort when a concrete level is known, or mode:"run_workspace_action" setup-reasoning-effort with confirmation.`,
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
    summary: 'Streaming TTS provider picker from Agent settings.',
    command: '/config tts.provider',
    preferredModelRoute: `Use ${agentHarnessModes('settings', 'get_setting', 'set_setting')} for tts.provider when a concrete provider id is known; use mode:"open_ui_surface" only to visibly navigate.`,
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
    summary: 'TTS voice picker for the selected or supplied provider.',
    command: '/config tts.voice',
    preferredModelRoute: `Use ${agentHarnessModes('settings', 'get_setting', 'set_setting', 'reset_setting')} for tts.voice when a concrete voice id is known; use mode:"open_ui_surface" only to visibly navigate.`,
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
    open: (context) => openSimpleContextSurface(context, 'session-picker', 'openSessionPicker'),
  },
  {
    id: 'profile-picker',
    label: 'Profile Picker',
    kind: 'picker',
    summary: 'Agent profile picker for local isolated profile selection.',
    command: '/agent-profile',
    preferredModelRoute: 'Use workspace profile actions or profile slash-command mirrors for concrete model operation.',
    available: (context) => typeof context.openProfilePicker === 'function',
    open: (context) => openSimpleContextSurface(context, 'profile-picker', 'openProfilePicker'),
  },
  {
    id: 'bookmark-modal',
    label: 'Bookmarks',
    kind: 'modal',
    summary: 'Transcript bookmark browser.',
    command: '/bookmarks',
    preferredModelRoute: 'Use slash-command mirrors for concrete bookmark inspection; opening is visible navigation only.',
    available: (context) => typeof context.openBookmarkModal === 'function',
    open: (context) => openSimpleContextSurface(context, 'bookmark-modal', 'openBookmarkModal'),
  },
  {
    id: 'context-inspector',
    label: 'Context Inspector',
    kind: 'modal',
    summary: 'Context-window usage and token breakdown inspector.',
    command: '/context',
    preferredModelRoute: 'Use slash-command mirrors for text output; opening is visible navigation only.',
    available: (context) => typeof context.openContextInspector === 'function',
    open: (context) => openSimpleContextSurface(context, 'context-inspector', 'openContextInspector'),
  },
  {
    id: 'process-monitor',
    label: 'Runtime Activity Monitor',
    kind: 'modal',
    summary: 'Visible running-process and live-output monitor.',
    command: 'F2',
    preferredModelRoute: 'Use this only for visible supervision of runtime activity; use first-class model tools or confirmed commands for actual operations.',
    available: (context) => typeof context.openProcessModal === 'function',
    open: (context) => openSimpleContextSurface(context, 'process-monitor', 'openProcessModal'),
  },
  {
    id: 'live-tail',
    label: 'Live Process Output',
    kind: 'modal',
    summary: 'Visible live-output tail for a running process.',
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
    summary: 'Visible transcript search overlay.',
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
    summary: 'Visible reverse prompt-history search.',
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
    summary: 'Slash-command autocomplete route for empty prompts.',
    command: '/',
    preferredModelRoute: `Use ${agentHarnessModes('commands', 'command')} for model-readable command discovery and mode:"run_command" for confirmed command execution.`,
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
    summary: 'Searchable slash-command browser opened by commands or help.',
    command: '/commands',
    preferredModelRoute: `Use ${agentHarnessModes('commands', 'command')} for model-readable slash-command discovery and mode:"run_command" for confirmed command execution.`,
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
    summary: 'Visible project file picker for file references and injection.',
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
    summary: 'Visible nearest-block action menu for transcript content.',
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
    preferredModelRoute: `Use ${agentHarnessModes('commands', 'command', 'shortcuts')} for model-readable discovery.`,
    available: (context) => typeof context.openHelpOverlay === 'function',
    open: (context) => openSimpleContextSurface(context, 'help-overlay', 'openHelpOverlay'),
  },
  {
    id: 'shortcuts-overlay',
    label: 'Shortcuts Overlay',
    kind: 'overlay',
    summary: 'Keyboard shortcut reference overlay.',
    command: '/shortcuts',
    preferredModelRoute: `Use ${agentHarnessModes('shortcuts', 'keybindings')} for model-readable discovery, mode:"run_keybinding" for supported shell-safe actions, and confirmed keybinding edits for binding changes.`,
    available: (context) => typeof context.openShortcutsOverlay === 'function',
    open: (context) => openSimpleContextSurface(context, 'shortcuts-overlay', 'openShortcutsOverlay'),
  },
  {
    id: 'onboarding',
    label: 'Agent Workspace',
    kind: 'workspace',
    summary: 'Agent workspace entry for first-run and setup review.',
    command: '/agent',
    preferredModelRoute: `Use ${agentHarnessModes('workspace', 'workspace_actions', 'settings')} for concrete setup operation.`,
    available: (context) => typeof context.openAgentWorkspace === 'function',
    open: (context) => {
      const surface = findSurfaceById('onboarding')!;
      if (!context.openAgentWorkspace) return routeUnavailable(surface);
      context.openAgentWorkspace();
      return opened(surface);
    },
  },
];

function findSurfaceById(surfaceId: string): UiSurfaceDefinition | undefined {
  return UI_SURFACES.find((surface) => surface.id === surfaceId);
}

function surfaceMatches(surface: Record<string, unknown>, query: string): boolean {
  if (!query) return true;
  const haystack = [
    surface.id,
    surface.label,
    surface.kind,
    surface.summary,
    surface.command,
    surface.modelRoute,
    surface.preferredModelRoute,
  ].map((value) => String(value ?? '')).join('\n').toLowerCase();
  const normalized = query.toLowerCase().trim();
  if (haystack.includes(normalized)) return true;
  const tokens = normalized.split(/[^a-z0-9]+/).filter((token) => token.length > 0);
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}

function surfaceLookupFromArgs(args: AgentHarnessUiSurfaceArgs): { readonly source: UiSurfaceLookup['source']; readonly input: string } | null {
  const surfaceId = readString(args.surfaceId);
  if (surfaceId) return { source: 'surfaceId', input: surfaceId };
  const query = readString(args.query);
  if (query) return { source: 'query', input: query };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  return null;
}

function surfaceCandidate(surface: UiSurfaceDefinition): Record<string, unknown> {
  return {
    id: surface.id,
    label: surface.label,
    kind: surface.kind,
    summary: surface.summary,
    command: surface.command,
    modelRoute: uiSurfaceModelRoute(surface),
  };
}

function uiSurfaceModelRoute(surface: UiSurfaceDefinition): string {
  switch (surface.id) {
    case 'connected-browser-cockpit':
      return 'agent_harness mode:"service_endpoint" or mode:"open_ui_surface"';
    case 'agent-workspace':
    case 'panel-picker':
    case 'security-panel':
    case 'subscription-panel':
    case 'mcp-workspace':
    case 'onboarding':
      return 'agent_harness mode:"workspace_actions" or mode:"open_ui_surface"';
    case 'knowledge-panel':
      return 'agent_knowledge, agent_knowledge_ingest, or workspace_actions';
    case 'settings':
    case 'tts-provider-picker':
    case 'tts-voice-picker':
    case 'reasoning-effort-picker':
      return 'agent_harness mode:"settings" or mode:"open_ui_surface"';
    case 'model-picker':
    case 'provider-picker':
      return 'agent_harness mode:"settings" or mode:"run_command"';
    case 'session-picker':
    case 'bookmark-modal':
    case 'context-inspector':
    case 'slash-command-mode':
    case 'command-browser':
    case 'block-actions':
      return 'agent_harness mode:"commands" or mode:"run_command"';
    case 'process-monitor':
    case 'live-tail':
    case 'file-picker':
      return 'first-class tools or agent_harness mode:"open_ui_surface"';
    case 'conversation-search':
    case 'prompt-history-search':
      return 'agent_harness mode:"open_ui_surface"';
    case 'help-overlay':
      return 'agent_harness mode:"commands" or mode:"shortcuts"';
    case 'shortcuts-overlay':
      return 'agent_harness mode:"shortcuts" or mode:"keybindings"';
    default:
      return 'agent_harness mode:"open_ui_surface"';
  }
}

function resolveHarnessUiSurface(args: AgentHarnessUiSurfaceArgs): UiSurfaceResolution | null {
  const lookup = surfaceLookupFromArgs(args);
  if (!lookup) return null;
  const exactId = UI_SURFACES.find((surface) => surface.id === lookup.input);
  if (exactId) return { status: 'found', surface: exactId, lookup: { ...lookup, resolvedBy: 'id' } };
  const exactLabel = UI_SURFACES.find((surface) => surface.label === lookup.input);
  if (exactLabel) return { status: 'found', surface: exactLabel, lookup: { ...lookup, resolvedBy: 'label' } };
  const inputLower = lookup.input.toLowerCase();
  const ciId = UI_SURFACES.filter((surface) => surface.id.toLowerCase() === inputLower);
  if (ciId.length === 1) return { status: 'found', surface: ciId[0]!, lookup: { ...lookup, resolvedBy: 'case-insensitive-id' } };
  if (ciId.length > 1) return { status: 'ambiguous', input: lookup.input, candidates: ciId.map(surfaceCandidate).slice(0, 8) };
  const ciLabel = UI_SURFACES.filter((surface) => surface.label.toLowerCase() === inputLower);
  if (ciLabel.length === 1) return { status: 'found', surface: ciLabel[0]!, lookup: { ...lookup, resolvedBy: 'case-insensitive-label' } };
  if (ciLabel.length > 1) return { status: 'ambiguous', input: lookup.input, candidates: ciLabel.map(surfaceCandidate).slice(0, 8) };
  const search = UI_SURFACES.filter((surface) => surfaceMatches(surfaceCandidate(surface), lookup.input));
  if (search.length === 1) return { status: 'found', surface: search[0]!, lookup: { ...lookup, resolvedBy: 'search' } };
  if (search.length > 1) return { status: 'ambiguous', input: lookup.input, candidates: search.map(surfaceCandidate).slice(0, 8) };
  return null;
}

function describeSurface(
  context: CommandContext,
  surface: UiSurfaceDefinition,
  options: { readonly includeParameters?: boolean; readonly lookup?: UiSurfaceLookup } = {},
): Record<string, unknown> {
  return {
    id: surface.id,
    label: surface.label,
    kind: surface.kind,
    summary: surface.summary,
    command: surface.command,
    ...(options.lookup ? { lookup: options.lookup } : {}),
    modelRoute: uiSurfaceModelRoute(surface),
    available: surface.available(context),
    ...(surface.id === 'connected-browser-cockpit' ? { cockpit: connectedBrowserCockpitRoute(context, { includeWorkspaceCoverage: options.includeParameters === true }) } : {}),
    ...(options.includeParameters ? {
      preferredModelRoute: surface.preferredModelRoute,
      parameters: surface.parameters ?? [],
      policy: {
        effect: 'visible-ui-navigation',
        confirmation: 'agent_harness mode:"open_ui_surface" requires confirm:true and explicitUserRequest.',
        boundary: 'UI surface routing opens the same visible Agent shell surface the user can open. Use first-class model tools, settings modes, workspace actions, or confirmed slash-command mirrors for actual operations.',
      },
    } : {}),
  };
}

export function totalHarnessUiSurfaces(): number {
  return UI_SURFACES.length;
}

export function listHarnessUiSurfaces(context: CommandContext, args: AgentHarnessUiSurfaceArgs): readonly Record<string, unknown>[] {
  const query = readString(args.query);
  const limit = readLimit(args.limit, 200);
  const includeParameters = args.includeParameters === true;
  return UI_SURFACES
    .map((surface) => describeSurface(context, surface, { includeParameters }))
    .filter((surface) => surfaceMatches(surface, query))
    .slice(0, limit);
}

export function describeHarnessUiSurface(context: CommandContext, args: AgentHarnessUiSurfaceArgs): Record<string, unknown> | null {
  const resolved = resolveHarnessUiSurface(args);
  if (resolved?.status === 'found') return describeSurface(context, resolved.surface, { includeParameters: true, lookup: resolved.lookup });
  if (resolved?.status === 'ambiguous') {
    return { status: 'ambiguous', input: resolved.input, candidates: resolved.candidates };
  }
  return null;
}

export async function openHarnessUiSurface(context: CommandContext, args: AgentHarnessUiSurfaceArgs): Promise<Record<string, unknown>> {
  const resolved = resolveHarnessUiSurface(args);
  if (resolved?.status === 'ambiguous') {
    return { status: 'ambiguous_ui_surface', input: resolved.input, candidates: resolved.candidates };
  }
  if (!resolved) {
    return {
      status: 'unknown_ui_surface',
      surfaceId: readString(args.surfaceId || args.query || args.target) || '<missing>',
      availableSurfaces: UI_SURFACES.map((entry) => entry.id),
    };
  }
  const routed = await resolved.surface.open(context, args);
  return {
    ...routed,
    descriptor: describeSurface(context, resolved.surface, { includeParameters: true, lookup: resolved.lookup }),
  };
}
