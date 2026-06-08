import type { CommandContext } from '../input/command-registry.ts';
import { resolveRuntimeEndpointBinding } from '../cli/endpoints.ts';
import { AGENT_WORKSPACE_CATEGORIES } from '../input/agent-workspace-categories.ts';
import { readOnboardingCompletionMarker } from '../runtime/onboarding/index.ts';

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
      modelRoute: 'host action:"service" endpointId:"web" includeParameters:true',
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
      modelRoute: 'settings action:"list" query:"web" includeHidden:true',
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
    setupCloseoutRoute: 'setup action:"status" includeParameters:true',
    policy: 'Agent reports its own user onboarding marker separately from the connected-host browser/PWA receipt contract so setup closeout does not overclaim browser readiness.',
  };
}

export function connectedBrowserCockpitRoute(context: CommandContext, options: { readonly includeWorkspaceCoverage?: boolean } = {}): Record<string, unknown> {
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
      inspectEndpoint: 'host action:"service" endpointId:"web" includeParameters:true',
      servicePosture: 'host action:"services" includeParameters:true',
      connectedHostStatus: 'host action:"status" includeParameters:true',
      settings: 'settings action:"list" query:"web" includeHidden:true',
    },
    policy: 'Opens the connected GoodVibes browser cockpit only after explicit user confirmation. Agent does not host a separate browser app or bypass connected-host setup.',
  };
}
