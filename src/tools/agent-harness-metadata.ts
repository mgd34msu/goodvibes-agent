import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { CommandContext } from '../input/command-registry.ts';
import { resolveAgentConnectedHostConnection } from '../agent/routine-schedule-promotion.ts';
import { previewHarnessText } from './agent-harness-text.ts';

export interface CommandExecutionPolicy {
  readonly effect: 'read-only' | 'local-state' | 'connected-host-state' | 'external-network' | 'ui-navigation' | 'session-lifecycle' | 'delegated-work' | 'mixed' | 'unknown';
  readonly confirmation: string;
  readonly preferredModelTool?: string;
  readonly boundary: string;
}

export type ConnectedHostCapabilityResolution =
  | { readonly status: 'found'; readonly detail: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] };

function agentHarnessModes(...modes: readonly string[]): string {
  return `agent_harness ${modes.map((mode) => `mode:"${mode}"`).join(', ')}`;
}

function settingsActions(...actions: readonly string[]): string {
  return `settings ${actions.map((action) => `action:"${action}"`).join('|')}`;
}

export function describeCommandPolicy(commandName: string): CommandExecutionPolicy {
  const root = commandName.replace(/^\//, '').trim().toLowerCase();
  const confirmation = 'agent_harness mode:"run_command" requires confirm:true and explicitUserRequest for every slash command invocation.';
  if (root === 'agent' || root === 'agent-workspace' || root === 'workspace') {
    return {
      effect: 'ui-navigation',
      confirmation,
      preferredModelTool: agentHarnessModes('workspace', 'workspace_categories', 'workspace_actions', 'workspace_action', 'run_workspace_action'),
      boundary: 'Agent workspace navigation is visible shell routing. Use workspace action modes for concrete model-readable operation.',
    };
  }
  if (root === 'setup' || root === 'welcome') {
    return {
      effect: 'ui-navigation',
      confirmation,
      preferredModelTool: agentHarnessModes('workspace_actions', 'workspace_action', 'open_ui_surface'),
      boundary: 'Setup opens the visible Agent workspace. Model-side changes should use settings or workspace actions.',
    };
  }
  if (root === 'commands' || root === 'help' || root === 'shortcuts') {
    return {
      effect: 'ui-navigation',
      confirmation,
      preferredModelTool: root === 'shortcuts' ? agentHarnessModes('shortcuts', 'keybindings', 'keybinding') : agentHarnessModes('commands', 'command'),
      boundary: 'Discovery commands open visible help surfaces. The model should inspect the matching harness catalog directly before invoking commands.',
    };
  }
  if (root === 'keybindings') {
    return {
      effect: 'read-only',
      confirmation,
      preferredModelTool: agentHarnessModes('shortcuts', 'keybindings', 'keybinding', 'run_keybinding', 'set_keybinding', 'reset_keybinding'),
      boundary: 'Keybinding inspection is read-only. Keybinding execution or edits require explicit confirmation through agent_harness keybinding modes.',
    };
  }
  if (root === 'settings' || root === 'config') {
    return {
      effect: 'mixed',
      confirmation,
      preferredModelTool: settingsActions('list', 'get', 'set', 'reset', 'import'),
      boundary: 'Model-writable settings can be changed through the first-class settings adapter. Connected-host lifecycle/listener settings remain read-only.',
    };
  }
  if (root === 'model' || root === 'effort') {
    return {
      effect: 'mixed',
      confirmation,
      preferredModelTool: `${settingsActions('get', 'set')} or ${agentHarnessModes('open_ui_surface')}`,
      boundary: 'Model and reasoning-effort changes affect the current Agent chat route. Prefer settings for concrete values and UI surface routing for visible pickers.',
    };
  }
  if (root === 'provider' || root === 'providers') {
    return {
      effect: 'mixed',
      confirmation,
      preferredModelTool: `${settingsActions('get', 'set')} or ${agentHarnessModes('open_ui_surface')}`,
      boundary: 'Provider selection and custom provider files belong to Agent provider configuration. Adding, removing, or switching providers requires explicit user intent.',
    };
  }
  if (root === 'refresh-models') {
    return {
      effect: 'external-network',
      confirmation,
      preferredModelTool: `${settingsActions('list', 'get')} or ${agentHarnessModes('tools')}`,
      boundary: 'Model catalog refresh may call provider discovery routes and update local provider metadata. Do not run it without explicit user request.',
    };
  }
  if (root === 'pin' || root === 'unpin') {
    return {
      effect: 'local-state',
      confirmation,
      preferredModelTool: agentHarnessModes('run_command'),
      boundary: 'Pinned model changes mutate local Agent provider preferences only and require an explicit model id.',
    };
  }
  if (root === 'mode') {
    return {
      effect: 'local-state',
      confirmation,
      preferredModelTool: settingsActions('get', 'set'),
      boundary: 'Interaction-mode changes affect the current Agent operator notification posture and should be explicit.',
    };
  }
  if (root === 'vibe' || root === 'vibes') {
    return {
      effect: 'local-state',
      confirmation,
      preferredModelTool: 'vibe or agent_local_registry',
      boundary: 'VIBE.md status/show are read-only; init writes a local personality file and import-persona writes an Agent-local persona after explicit confirmation.',
    };
  }
  if (root === 'brief') {
    return {
      effect: 'read-only',
      confirmation,
      preferredModelTool: 'agent_operator_briefing',
      boundary: 'Briefing reads current Agent operator posture and next actions without mutating connected-host state.',
    };
  }
  if (root === 'health' || root === 'compat' || root === 'context' || root === 'accounts' || root === 'security') {
    return {
      effect: 'read-only',
      confirmation,
      preferredModelTool: root === 'compat'
        ? agentHarnessModes('service_posture', 'service_endpoint', 'connected_host_status')
        : `${agentHarnessModes('service_posture', 'service_endpoint', 'connected_host_status')} or ${settingsActions('list', 'get')} or ${agentHarnessModes('tools', 'open_ui_surface')}`,
      boundary: 'Diagnostics and review commands inspect Agent, provider, MCP, security, and connected-host readiness without taking lifecycle ownership.',
    };
  }
  if (root === 'trust' || root === 'auth' || root === 'bundle') {
    return {
      effect: 'mixed',
      confirmation,
      preferredModelTool: agentHarnessModes('run_command'),
      boundary: 'Review subcommands are read-only; bundle export/import or auth/trust bundle export writes local files and requires explicit confirmation.',
    };
  }
  if (root === 'mcp' || root === 'voice' || root === 'subscription' || root === 'secrets' || root === 'secret') {
    return {
      effect: 'mixed',
      confirmation,
      preferredModelTool: root === 'secrets' || root === 'secret'
        ? settingsActions('list', 'get', 'set', 'reset')
        : `${agentHarnessModes('workspace_actions', 'open_ui_surface')} or ${settingsActions('list', 'get', 'set')}`,
      boundary: 'Harness-owned configuration, secret, voice, subscription, and MCP commands can expose credentials or external account state. Mutations require explicit user intent and should prefer secret refs over raw values.',
    };
  }
  if (
    root === 'memory'
    || root === 'memories'
    || root === 'note'
    || root === 'persona'
    || root === 'personas'
    || root === 'skill'
    || root === 'skills'
    || root === 'routine'
    || root === 'routines'
  ) {
    return {
      effect: 'local-state',
      confirmation,
      preferredModelTool: 'agent_local_registry',
      boundary: 'Agent-local library records only unless the invoked command explicitly promotes to a connected schedule or Agent Knowledge source.',
    };
  }
  if (root === 'notes') {
    return {
      effect: 'ui-navigation',
      confirmation,
      preferredModelTool: `${agentHarnessModes('workspace_actions', 'workspace_action', 'run_workspace_action')} or agent_local_registry`,
      boundary: 'Notes workspace routing is visible navigation; note record mutations should use Agent-local registry or workspace action modes.',
    };
  }
  if (root === 'knowledge') {
    return {
      effect: 'mixed',
      confirmation,
      preferredModelTool: 'agent_knowledge or agent_knowledge_ingest',
      boundary: 'Agent Knowledge only. Do not use default knowledge or non-Agent knowledge spaces.',
    };
  }
  if (root === 'approval' || root === 'approvals' || root === 'automation') {
    return {
      effect: 'connected-host-state',
      confirmation,
      preferredModelTool: 'agent_operator_action',
      boundary: 'Only explicit allowlisted approval and automation operator actions should be performed from the model.',
    };
  }
  if (root === 'schedule' || root === 'remind' || root === 'reminder') {
    return {
      effect: 'connected-host-state',
      confirmation,
      preferredModelTool: 'schedule',
      boundary: 'Connected schedules require an explicit user request and do not create hidden Agent jobs or local schedulers.',
    };
  }
  if (root === 'channels' || root === 'channel' || root === 'notify') {
    return {
      effect: 'external-network',
      confirmation,
      preferredModelTool: root === 'notify' ? 'agent_notify' : 'agent_channel_send',
      boundary: 'External delivery requires an explicit target and direct user authorization.',
    };
  }
  if (root === 'media') {
    return {
      effect: 'external-network',
      confirmation,
      preferredModelTool: 'agent_media_generate',
      boundary: 'Media generation uses configured Agent media providers and writes normal artifacts only.',
    };
  }
  if (root === 'image') {
    return {
      effect: 'external-network',
      confirmation,
      preferredModelTool: agentHarnessModes('open_ui_surface'),
      boundary: 'Image attachment reads a local image and submits a model turn with image content. Use only for explicit user-supplied files.',
    };
  }
  if (root === 'tts') {
    return {
      effect: 'external-network',
      confirmation,
      preferredModelTool: `${settingsActions('get', 'set')} or ${agentHarnessModes('open_ui_surface')}`,
      boundary: 'Live TTS submits a normal prompt and may call model and speech providers; stopping playback is local runtime control.',
    };
  }
  if (root === 'workplan' || root === 'plan' || root === 'task' || root === 'tasks') {
    return {
      effect: 'local-state',
      confirmation,
      preferredModelTool: 'agent_work_plan',
      boundary: 'Work planning stays in the current Agent/project planning surfaces unless the command explicitly calls connected-host operator routes.',
    };
  }
  if (root === 'delegate') {
    return {
      effect: 'delegated-work',
      confirmation,
      preferredModelTool: agentHarnessModes('workspace_actions', 'workspace_action', 'run_workspace_action'),
      boundary: 'Delegation is explicit user-directed work only; no hidden background review or separate Agent job should be created implicitly.',
    };
  }
  if (
    root === 'session'
    || root === 'conversation'
    || root === 'clear'
    || root === 'reset'
    || root === 'compact'
    || root === 'quit'
    || root === 'exit'
    || root === 'save'
    || root === 'load'
    || root === 'sessions'
    || root === 'title'
    || root === 'undo'
    || root === 'redo'
    || root === 'retry'
  ) {
    return {
      effect: 'session-lifecycle',
      confirmation,
      preferredModelTool: agentHarnessModes('commands', 'command', 'run_command'),
      boundary: 'Session and conversation commands operate on the visible harness session lifecycle.',
    };
  }
  if (root === 'export') {
    return {
      effect: 'local-state',
      confirmation,
      preferredModelTool: `${agentHarnessModes('workspace_actions', 'workspace_action', 'run_workspace_action')} or ${agentHarnessModes('run_command')}`,
      boundary: 'Conversation export writes a local workspace file and requires an explicit output intent.',
    };
  }
  if (root === 'bookmarks' || root === 'expand' || root === 'collapse' || root === 'next-error' || root === 'prev-error') {
    return {
      effect: 'ui-navigation',
      confirmation,
      preferredModelTool: root === 'bookmarks' ? `${agentHarnessModes('open_ui_surface')} or ${agentHarnessModes('run_command')}` : agentHarnessModes('run_command'),
      boundary: 'Conversation display navigation mutates only the visible transcript view or scroll position.',
    };
  }
  if (root === 'paste') {
    return {
      effect: 'local-state',
      confirmation,
      preferredModelTool: agentHarnessModes('run_keybinding'),
      boundary: 'Paste reads the local clipboard and mutates the visible prompt or image attachment state.',
    };
  }
  if (root === 'profile' || root === 'agent-profile') {
    return {
      effect: 'mixed',
      confirmation,
      preferredModelTool: agentHarnessModes('workspace_actions', 'workspace_action', 'run_workspace_action'),
      boundary: 'Agent profile commands manage isolated Agent runtime profiles and starter templates. Mutations require explicit confirmation.',
    };
  }
  if (root === 'qrcode') {
    return {
      effect: 'read-only',
      confirmation,
      preferredModelTool: agentHarnessModes('run_command'),
      boundary: 'Pairing details are displayed for explicit operator use; the Agent does not manage connected-host listener lifecycle.',
    };
  }
  return {
    effect: 'unknown',
    confirmation,
    boundary: 'Inspect the command description, usage, and workspace action metadata before invoking through run_command.',
  };
}

export function describeCliCommandPolicy(commandName: string): CommandExecutionPolicy {
  const root = commandName.trim().toLowerCase();
  const confirmation = 'agent_harness CLI command modes are discovery-only. Use first-class model tools, workspace actions, slash-command mirrors, or an explicit external shell request to execute equivalent CLI workflows.';
  if ([
    'app',
    'bridge',
    'control-plane',
    'controlplane',
    'cp',
    'daemon',
    'http-listener',
    'launch',
    'listener',
    'remote',
    'serve',
    'server',
    'service',
    'services',
    'start',
    'surface',
    'surfaces',
    'web',
    'webhook',
  ].includes(root)) {
    return {
      effect: 'unknown',
      confirmation,
      boundary: 'Blocked package CLI token. Agent can launch its own TUI and use public connected-host routes, but it does not manage connected-host lifecycle, listeners, servers, route relays, remotes, web surfaces, or webhook listeners.',
    };
  }
  if (root === 'tui' || root === 'onboarding' || root === 'help' || root === 'version' || root === 'completion') {
    return {
      effect: root === 'tui' || root === 'onboarding' ? 'ui-navigation' : 'read-only',
      confirmation,
      preferredModelTool: root === 'onboarding' || root === 'tui'
        ? agentHarnessModes('workspace', 'workspace_actions', 'workspace_action', 'run_workspace_action')
        : agentHarnessModes('cli_commands', 'cli_command'),
      boundary: 'Top-level CLI launch, setup, help, version, and completion commands are package entrypoint surfaces; use in-process workspace and slash-command routes from the model when operating inside the TUI.',
    };
  }
  if (root === 'run') {
    return {
      effect: 'mixed',
      confirmation,
      preferredModelTool: 'current Agent conversation response; do not invoke hidden nested CLI run',
      boundary: 'The CLI run command starts a non-interactive Agent turn from a process entrypoint. Do not create hidden nested turns from agent_harness; answer the user directly in the current conversation.',
    };
  }
  if (root === 'status' || root === 'doctor' || root === 'auth' || root === 'compat' || root === 'models' || root === 'providers' || root === 'tasks') {
    return {
      effect: 'read-only',
      confirmation,
      preferredModelTool: root === 'tasks' ? 'agent_operator_briefing' : agentHarnessModes('service_posture', 'service_endpoint', 'connected_host_status', 'connected_host', 'settings', 'tools'),
      boundary: 'Diagnostics and posture commands are readable from Agent-owned settings, provider, model, and connected-host capability surfaces without taking connected-host lifecycle ownership.',
    };
  }
  if (root === 'profiles' || root === 'personas' || root === 'skills' || root === 'memory' || root === 'routines' || root === 'sessions' || root === 'bundle') {
    return {
      effect: 'local-state',
      confirmation,
      preferredModelTool: root === 'profiles' ? agentHarnessModes('workspace_actions', 'workspace_action', 'run_workspace_action') : 'agent_local_registry',
      boundary: 'Local library/profile/session/bundle CLI commands operate on Agent-local data. Mutations require explicit user intent and should use first-class Agent-local tools where available.',
    };
  }
  if (root === 'knowledge' || root === 'ask' || root === 'search') {
    return {
      effect: 'mixed',
      confirmation,
      preferredModelTool: root === 'knowledge' ? 'agent_knowledge or agent_knowledge_ingest' : 'agent_knowledge',
      boundary: 'Agent Knowledge CLI commands must stay on isolated Agent Knowledge routes and never fall back to default or non-Agent knowledge spaces.',
    };
  }
  if (root === 'delegate') {
    return {
      effect: 'delegated-work',
      confirmation,
      preferredModelTool: agentHarnessModes('workspace_actions', 'workspace_action', 'run_workspace_action'),
      boundary: 'Delegation is explicit user-directed work only; no hidden background review or separate Agent job should be created implicitly.',
    };
  }
  if (root === 'subscription' || root === 'secrets' || root === 'pair') {
    return {
      effect: root === 'pair' ? 'external-network' : 'mixed',
      confirmation,
      preferredModelTool: root === 'pair'
        ? agentHarnessModes('workspace_actions', 'workspace_action', 'run_workspace_action')
        : `${settingsActions('list', 'get', 'set', 'reset')} or ${agentHarnessModes('workspace_actions')}`,
      boundary: 'Provider subscription, secret, and pairing flows can expose credentials or external account state. Use only explicit user-directed flows and prefer secret refs over raw values.',
    };
  }
  return {
    effect: 'unknown',
    confirmation,
    boundary: 'Inspect the CLI help, parser result, and preferred model routes before using an equivalent command path.',
  };
}

function toolIsAvailable(toolRegistry: ToolRegistry, toolName: string): boolean {
  return toolRegistry.getToolDefinitions().some((tool) => tool.name === toolName);
}

function connectedHostCapabilityModelRoute(capability: Record<string, unknown>): string {
  const modelTools = Array.isArray(capability.modelTools)
    ? capability.modelTools.filter((tool): tool is string => typeof tool === 'string')
    : [];
  if (modelTools.length > 0) return previewHarnessText(modelTools.join(' or '));
  return 'agent_harness mode:"connected_host_capability"';
}

function blockedConnectedHostModelRoute(): string {
  return 'agent_harness mode:"service_posture" or mode:"connected_host_status"';
}

export function connectedHostCapabilityMap(toolRegistry: ToolRegistry): readonly Record<string, unknown>[] {
  const withAvailability = (capability: Record<string, unknown> & { readonly modelTools: readonly string[] }): Record<string, unknown> => ({
    ...capability,
    modelRoute: connectedHostCapabilityModelRoute(capability),
    harnessRoute: 'agent_harness mode:"connected_host_capability"',
    modelAccess: {
      inspectCapability: 'agent_harness mode:"connected_host_capability"',
      liveStatus: 'agent_harness mode:"connected_host_status"',
      endpointPosture: 'agent_harness mode:"service_posture"',
      routeFamilies: 'agent_harness mode:"connected_host" includeParameters:true',
      operate: connectedHostCapabilityModelRoute(capability),
    },
    available: capability.modelTools.every((toolName) => toolIsAvailable(toolRegistry, toolName)),
  });
  return [
    withAvailability({
      id: 'operator-briefing',
      effect: 'read-only-network',
      modelTools: ['agent_operator_briefing'],
      workspaceCategories: ['home', 'work', 'host', 'automation'],
      slashCommandFamilies: ['approval', 'automation', 'schedule'],
      purpose: 'Read pending work, approvals, automation, schedules, and scheduler capacity from public operator routes.',
    }),
    withAvailability({
      id: 'operator-actions',
      effect: 'confirmed-connected-host-state',
      modelTools: ['agent_operator_action'],
      workspaceCategories: ['automation', 'host'],
      allowedActions: [
        'approvals.approve',
        'approvals.deny',
        'approvals.cancel',
        'automation.jobs.run',
        'automation.jobs.pause',
        'automation.jobs.resume',
        'automation.runs.cancel',
        'automation.runs.retry',
        'schedules.delete',
        'schedules.disable',
        'schedules.enable',
        'schedules.run',
      ],
      purpose: 'Perform one explicit allowlisted approval, automation, run, or schedule action.',
    }),
    withAvailability({
      id: 'schedule-edit',
      effect: 'confirmed-connected-host-state',
      modelTools: ['schedule', 'agent_schedule_edit'],
      workspaceCategories: ['automation', 'personal-ops'],
      slashCommandFamilies: ['schedule'],
      methodIds: ['automation.jobs.patch'],
      purpose: 'Edit one explicit connected schedule name, cadence, or prompt.',
    }),
    withAvailability({
      id: 'agent-knowledge-read',
      effect: 'read-only-network',
      modelTools: ['agent_knowledge'],
      workspaceCategories: ['knowledge', 'research'],
      slashCommandFamilies: ['knowledge'],
      allowedActions: [
        'status',
        'ask',
        'search',
        'sources',
        'nodes',
        'issues',
        'item',
        'map',
        'connectors',
        'connector',
        'connector_doctor',
      ],
      purpose: 'Read isolated Agent Knowledge status, answers, search results, source/node/issue lists, items, map summaries, and connector diagnostics through the Agent route family.',
    }),
    withAvailability({
      id: 'agent-knowledge-ingest',
      effect: 'confirmed-agent-knowledge-write',
      modelTools: ['agent_knowledge_ingest'],
      workspaceCategories: ['knowledge', 'research'],
      slashCommandFamilies: ['knowledge'],
      sourceKinds: ['url', 'file', 'urls_file', 'bookmarks_file', 'browser_history', 'connector'],
      purpose: 'Ingest explicit user-approved sources into isolated Agent Knowledge.',
    }),
    withAvailability({
      id: 'channels',
      effect: 'confirmed-external-delivery',
      modelTools: ['agent_channel_send'],
      workspaceCategories: ['channels'],
      slashCommandFamilies: ['channels', 'channel'],
      targetKinds: ['channel', 'route', 'webhook', 'link'],
      purpose: 'Send one explicit message through a configured Agent delivery target.',
    }),
    withAvailability({
      id: 'notifications',
      effect: 'confirmed-external-delivery',
      modelTools: ['agent_notify'],
      workspaceCategories: ['channels'],
      slashCommandFamilies: ['notify'],
      purpose: 'Send one explicit notification using configured notification routes.',
    }),
    withAvailability({
      id: 'reminders-and-schedules',
      effect: 'confirmed-connected-host-state',
      modelTools: ['schedule', 'agent_autonomy_schedule', 'agent_reminder_schedule'],
      workspaceCategories: ['automation', 'routines'],
      slashCommandFamilies: ['schedule', 'reminder'],
      scheduleKinds: ['at', 'every', 'cron'],
      purpose: 'Create one connected reminder or autonomous Agent schedule from a direct user request.',
    }),
    withAvailability({
      id: 'voice-media',
      effect: 'provider-network-and-artifacts',
      modelTools: ['agent_media_generate'],
      workspaceCategories: ['voice-media', 'artifacts'],
      slashCommandFamilies: ['media', 'image'],
      purpose: 'Generate media through configured Agent media providers and normal artifact storage.',
    }),
  ];
}

export function connectedHostRouteFamilies(): readonly Record<string, unknown>[] {
  return [
    {
      id: 'agent-knowledge',
      prefixes: ['/api/goodvibes-agent/knowledge/*'],
      modelTools: ['agent_knowledge', 'agent_knowledge_ingest'],
      modelRoute: 'agent_knowledge or agent_knowledge_ingest',
      boundary: 'Agent-owned knowledge segment only; no fallback to default or non-Agent knowledge.',
    },
    {
      id: 'operator-read',
      routes: [
        '/api/projects/planning/work-plan',
        '/api/approvals',
        '/api/automation',
        '/api/automation/schedules',
        '/api/runtime/scheduler',
      ],
      modelTools: ['agent_operator_briefing'],
      modelRoute: 'agent_operator_briefing',
      boundary: 'Read-only public operator briefing routes.',
    },
    {
      id: 'operator-actions',
      routes: ['public operator action methods for approvals, automation jobs, automation runs, and schedules'],
      modelTools: ['agent_operator_action'],
      modelRoute: 'agent_operator_action',
      boundary: 'Allowlisted confirmed mutations only; no arbitrary route invocation.',
    },
    {
      id: 'delivery',
      routes: ['configured channel, notification, and delivery targets'],
      modelTools: ['agent_channel_send', 'agent_notify'],
      modelRoute: 'agent_channel_send or agent_notify',
      boundary: 'Explicit user-approved delivery only; no route/account creation.',
    },
    {
      id: 'connected-schedules',
      routes: ['public schedule creation, patch, run, toggle, and delete routes'],
      modelTools: ['schedule', 'agent_autonomy_schedule', 'agent_reminder_schedule', 'agent_schedule_edit', 'agent_operator_action'],
      modelRoute: 'schedule action:"list|create|remind|edit|run|pause|resume|delete"',
      boundary: 'Connected schedules only; no hidden local scheduler or separate Agent job.',
    },
  ];
}

function normalizeCapabilityQuery(value: string): string {
  return value.trim().toLowerCase();
}

function recordTextMatches(record: Record<string, unknown>, query: string): boolean {
  if (!query) return false;
  const values = Object.values(record).flatMap((value) => Array.isArray(value) ? value : [value]);
  return values
    .filter((value): value is string | number | boolean => (
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ))
    .map((value) => String(value).toLowerCase())
    .some((value) => value === query || value.includes(query));
}

function relatedConnectedHostRouteFamilies(capability: Record<string, unknown>): readonly Record<string, unknown>[] {
  const modelTools = Array.isArray(capability.modelTools)
    ? capability.modelTools.filter((tool): tool is string => typeof tool === 'string')
    : [];
  const capabilityId = typeof capability.id === 'string' ? capability.id : '';
  return connectedHostRouteFamilies().filter((family) => {
    const familyTools = Array.isArray(family.modelTools)
      ? family.modelTools.filter((tool): tool is string => typeof tool === 'string')
      : [];
    if (familyTools.some((tool) => modelTools.includes(tool))) return true;
    return capabilityId.length > 0 && recordTextMatches(family, capabilityId);
  });
}

function describeConnectedHostCapabilityCandidates(
  entries: readonly { readonly status: 'allowed' | 'blocked'; readonly capability: Record<string, unknown> }[],
): readonly Record<string, unknown>[] {
  return entries.slice(0, 8).map((entry) => ({
    status: entry.status,
    capabilityId: typeof entry.capability.id === 'string' ? entry.capability.id : '',
    purpose: typeof entry.capability.purpose === 'string' ? entry.capability.purpose : undefined,
    reason: typeof entry.capability.reason === 'string' ? entry.capability.reason : undefined,
    modelRoute: entry.status === 'allowed'
      ? connectedHostCapabilityModelRoute(entry.capability)
      : blockedConnectedHostModelRoute(),
  }));
}

function connectedHostCapabilityDetail(entry: { readonly status: 'allowed' | 'blocked'; readonly capability: Record<string, unknown> }): Record<string, unknown> {
  if (entry.status === 'allowed') {
    return {
      status: 'allowed',
      capability: entry.capability,
      modelRoute: connectedHostCapabilityModelRoute(entry.capability),
      harnessRoute: 'agent_harness mode:"connected_host_capability"',
      relatedRouteFamilies: relatedConnectedHostRouteFamilies(entry.capability),
      modelAccess: {
        inspectCapability: 'agent_harness mode:"connected_host_capability"',
        connectedHostInventory: 'agent_harness mode:"connected_host" includeParameters:true',
        liveStatus: 'agent_harness mode:"connected_host_status"',
        endpointPosture: 'agent_harness mode:"service_posture"',
        operate: connectedHostCapabilityModelRoute(entry.capability),
      },
      operatorMethodMode: 'Use agent_harness mode:"operator_methods" for the public operator and Agent Knowledge method catalog. Use mode:"operator_method" for one method.',
      servicePostureMode: 'Use agent_harness mode:"service_posture" for endpoint binding, network-facing posture, issue, and redacted-log diagnostics. Use mode:"service_endpoint" for one endpoint.',
      statusMode: 'Use agent_harness mode:"connected_host_status" for live read-only reachability, token posture, and Agent Knowledge route readiness.',
      boundary: 'Use only the listed first-class model tools, slash-command families, and workspace categories. Mutations still require explicit confirmation through those tools or command routes.',
    };
  }
  return {
    status: 'blocked',
    capability: entry.capability,
    modelRoute: blockedConnectedHostModelRoute(),
    harnessRoute: 'agent_harness mode:"connected_host_capability"',
    allowed: false,
    available: false,
    modelAccess: {
      inspectCapability: 'agent_harness mode:"connected_host_capability"',
      connectedHostInventory: 'agent_harness mode:"connected_host" includeParameters:true',
      liveStatus: 'agent_harness mode:"connected_host_status"',
      endpointPosture: 'agent_harness mode:"service_posture"',
      operate: 'not exposed',
    },
    boundary: 'This connected-host surface is intentionally not exposed to the model as an Agent operation.',
    servicePostureMode: 'Use agent_harness mode:"service_posture" or mode:"service_endpoint" only for read-only endpoint diagnostics.',
    statusMode: 'Use agent_harness mode:"connected_host_status" only for read-only readiness diagnostics.',
  };
}

export function describeConnectedHostCapability(
  toolRegistry: ToolRegistry,
  rawQuery: string,
): ConnectedHostCapabilityResolution | null {
  const query = normalizeCapabilityQuery(rawQuery);
  if (!query) return null;

  const entries = [
    ...connectedHostCapabilityMap(toolRegistry).map((capability) => ({ status: 'allowed' as const, capability })),
    ...blockedConnectedHostCapabilities().map((capability) => ({ status: 'blocked' as const, capability })),
  ];
  const exact = entries.find((entry) => entry.capability.id === rawQuery);
  if (exact) return { status: 'found', detail: connectedHostCapabilityDetail(exact) };
  const insensitive = entries.find((entry) => typeof entry.capability.id === 'string' && entry.capability.id.toLowerCase() === query);
  if (insensitive) return { status: 'found', detail: connectedHostCapabilityDetail(insensitive) };
  const searched = entries.filter((entry) => recordTextMatches(entry.capability, query));
  if (searched.length === 1) return { status: 'found', detail: connectedHostCapabilityDetail(searched[0]!) };
  if (searched.length > 1) return { status: 'ambiguous', input: rawQuery, candidates: describeConnectedHostCapabilityCandidates(searched) };

  return null;
}

export function connectedHostSummary(
  context: CommandContext,
  toolRegistry: ToolRegistry,
  options: { readonly includeParameters?: boolean } = {},
): Record<string, unknown> {
  const shellPaths = context.workspace.shellPaths;
  const homeDirectory = shellPaths?.homeDirectory ?? context.platform.configManager.getHomeDirectory() ?? '';
  const connection = resolveAgentConnectedHostConnection(context.platform.configManager, homeDirectory);
  const routeFamilies = connectedHostRouteFamilies();
  const capabilities = connectedHostCapabilityMap(toolRegistry);
  const blockedCapabilities = blockedConnectedHostCapabilities();
  return {
    baseUrl: connection.baseUrl,
    operatorToken: connection.token ? 'configured' : 'missing',
    tokenPath: connection.tokenPath,
    ownership: 'goodvibes-daemon',
    lifecycle: 'GoodVibes Agent can inspect daemon posture and use confirmed operator methods for supported service lifecycle/listener changes.',
    modes: {
      servicePosture: agentHarnessModes('service_posture', 'service_endpoint'),
      operatorMethods: agentHarnessModes('operator_methods', 'operator_method'),
      liveStatus: agentHarnessModes('connected_host_status'),
      capabilityDetail: agentHarnessModes('connected_host_capability'),
      daemonAliases: agentHarnessModes('daemon', 'daemon_status'),
    },
    modelRoute: 'agent_harness mode:"connected_host" or mode:"connected_host_capability"',
    modelAccess: {
      inventory: 'agent_harness mode:"connected_host" includeParameters:true',
      liveStatus: 'agent_harness mode:"connected_host_status"',
      capabilityDetail: 'agent_harness mode:"connected_host_capability" capabilityId:"..."',
      servicePosture: 'agent_harness mode:"service_posture"',
      daemonAliases: 'agent_harness mode:"daemon" or mode:"daemon_status"',
      daemonStatusAlias: 'agent_harness mode:"daemon_status"',
      lifecycle: 'use setup or agent_operator_method with confirm:true and explicitUserRequest for supported daemon service methods.',
    },
    counts: {
      routeFamilies: routeFamilies.length,
      allowedCapabilities: capabilities.length,
      availableCapabilities: capabilities.filter((capability) => capability.available === true).length,
      blockedCapabilities: blockedCapabilities.length,
    },
    ...(options.includeParameters === true ? {
      routeFamilies,
      capabilities,
      blockedCapabilities,
    } : {}),
  };
}

export function blockedConnectedHostCapabilities(): readonly Record<string, unknown>[] {
  return [
    {
      id: 'connected-host-lifecycle',
      confirmationGated: ['start', 'stop', 'restart', 'install', 'upgrade', 'expose-listener', 'mutate-listener'],
      modelRoute: 'agent_operator_method',
      harnessRoute: 'agent_harness mode:"connected_host_capability"',
      modelAccess: {
        inspectCapability: 'agent_harness mode:"connected_host_capability"',
        liveStatus: 'agent_harness mode:"connected_host_status"',
        endpointPosture: 'agent_harness mode:"service_posture"',
        operate: 'agent_operator_method with confirm:true and explicitUserRequest when the daemon contract exposes the method',
      },
      reason: 'Lifecycle changes are powerful daemon operations. They are available only through explicit setup or confirmed operator methods, never as ambient background side effects.',
    },
    {
      id: 'non-agent-knowledge',
      blocked: ['default-knowledge', 'non-agent-knowledge-segments', 'fallback-knowledge'],
      modelRoute: blockedConnectedHostModelRoute(),
      harnessRoute: 'agent_harness mode:"connected_host_capability"',
      modelAccess: {
        inspectCapability: 'agent_harness mode:"connected_host_capability"',
        allowedAgentKnowledge: 'agent_knowledge or agent_knowledge_ingest',
        liveStatus: 'agent_harness mode:"connected_host_status"',
        operate: 'not exposed',
      },
      reason: 'Agent model tools must stay inside the isolated Agent Knowledge route family.',
    },
    {
      id: 'hidden-background-work',
      blocked: ['hidden-agent-jobs', 'implicit-delegated-review', 'untracked-local-schedulers'],
      modelRoute: blockedConnectedHostModelRoute(),
      harnessRoute: 'agent_harness mode:"connected_host_capability"',
      modelAccess: {
        inspectCapability: 'agent_harness mode:"connected_host_capability"',
        allowedAutonomy: 'agent tool spawn/batch-spawn, schedules, automation jobs, or confirmed delegation with visible status/cancel routes',
        liveStatus: 'agent_harness mode:"connected_host_status"',
        operate: 'use a visible autonomy route',
      },
      reason: 'Autonomy is allowed when it is visible, statused, and cancellable. Hidden jobs are blocked.',
    },
    {
      id: 'arbitrary-connected-host-mutations',
      confirmationGated: ['route-discovery-mutation', 'account-creation', 'automation-definition-creation'],
      modelRoute: 'agent_operator_method',
      harnessRoute: 'agent_harness mode:"connected_host_capability"',
      modelAccess: {
        inspectCapability: 'agent_harness mode:"connected_host_capability"',
        allowedActions: 'agent_operator_action for simple allowlisted mutations or agent_operator_method for exact confirmed daemon contract methods',
        liveStatus: 'agent_harness mode:"connected_host_status"',
        operate: 'agent_operator_method with confirm:true and explicitUserRequest',
      },
      reason: 'Daemon mutations must resolve to a documented SDK operator method and carry explicit user authorization.',
    },
  ];
}

export function settingsPolicySummary(): Record<string, unknown> {
  return {
    discovery: 'Use settings action:"list" for the setting catalog and action:"get" with key, target, or query for one setting. Hidden/scriptable settings require includeHidden:true unless the exact key is supplied.',
    mutation: 'Use settings action:"set" or action:"reset" with key, target, or query plus confirm:true and explicitUserRequest; ambiguous setting lookups are refused.',
    secretHandling: 'Raw secret values are persisted through the secret manager; config receives only a secret reference and tool output is redacted.',
    writablePolicy: 'Each setting descriptor includes writable, visibleInWorkspace, and lockReason when applicable.',
    protectedRawDangerKeys: ['danger.daemon', 'danger.httpListener'],
  };
}
