import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';

export interface CommandExecutionPolicy {
  readonly effect: 'read-only' | 'local-state' | 'connected-host-state' | 'external-network' | 'ui-navigation' | 'session-lifecycle' | 'delegated-work' | 'mixed' | 'unknown';
  readonly confirmation: string;
  readonly preferredModelTool?: string;
  readonly boundary: string;
}

export function describeCommandPolicy(commandName: string): CommandExecutionPolicy {
  const root = commandName.replace(/^\//, '').trim().toLowerCase();
  const confirmation = 'agent_harness mode:"run_command" requires confirm:true and explicitUserRequest for every slash command invocation.';
  if (
    root === 'memory'
    || root === 'memories'
    || root === 'note'
    || root === 'notes'
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
  if (root === 'knowledge') {
    return {
      effect: 'mixed',
      confirmation,
      preferredModelTool: 'agent_knowledge or agent_knowledge_ingest',
      boundary: 'Agent Knowledge only. Do not use default knowledge or non-Agent knowledge spaces.',
    };
  }
  if (root === 'settings') {
    return {
      effect: 'mixed',
      confirmation,
      preferredModelTool: 'agent_harness settings/get_setting/set_setting/reset_setting',
      boundary: 'Model-writable settings can be changed through agent_harness. Connected-host lifecycle/listener settings remain read-only.',
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
      preferredModelTool: 'agent_reminder_schedule or agent_operator_action',
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
  if (root === 'media' || root === 'image') {
    return {
      effect: 'external-network',
      confirmation,
      preferredModelTool: 'agent_media_generate',
      boundary: 'Media generation uses configured Agent media providers and writes normal artifacts only.',
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
      boundary: 'Delegation is explicit user-directed work only; no hidden background review or separate Agent job should be created implicitly.',
    };
  }
  if (root === 'session' || root === 'conversation' || root === 'clear' || root === 'quit' || root === 'exit') {
    return {
      effect: 'session-lifecycle',
      confirmation,
      boundary: 'Session and conversation commands operate on the visible harness session lifecycle.',
    };
  }
  if (root === 'agent-workspace' || root === 'workspace' || root === 'help' || root === 'shortcuts') {
    return {
      effect: 'ui-navigation',
      confirmation,
      preferredModelTool: 'agent_harness workspace/workspace_actions/workspace_action',
      boundary: 'Navigation and discovery commands should be inspected through agent_harness when possible.',
    };
  }
  if (
    root === 'profile'
    || root === 'agent-profile'
    || root === 'provider'
    || root === 'providers'
    || root === 'auth'
    || root === 'secret'
    || root === 'secrets'
    || root === 'mcp'
    || root === 'voice'
    || root === 'subscription'
  ) {
    return {
      effect: 'mixed',
      confirmation,
      boundary: 'Harness-owned configuration, auth, provider, MCP, and profile commands are available through the command bridge with explicit confirmation.',
    };
  }
  return {
    effect: 'unknown',
    confirmation,
    boundary: 'Inspect the command description, usage, and workspace action metadata before invoking through run_command.',
  };
}

function toolIsAvailable(toolRegistry: ToolRegistry, toolName: string): boolean {
  return toolRegistry.getToolDefinitions().some((tool) => tool.name === toolName);
}

export function connectedHostCapabilityMap(toolRegistry: ToolRegistry): readonly Record<string, unknown>[] {
  const withAvailability = (capability: Record<string, unknown> & { readonly modelTools: readonly string[] }): Record<string, unknown> => ({
    ...capability,
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
        'schedules.run',
      ],
      purpose: 'Perform one explicit allowlisted approval, automation, run, or schedule action.',
    }),
    withAvailability({
      id: 'agent-knowledge-read',
      effect: 'read-only-network',
      modelTools: ['agent_knowledge'],
      workspaceCategories: ['knowledge', 'research'],
      slashCommandFamilies: ['knowledge'],
      allowedActions: ['status', 'ask', 'search'],
      purpose: 'Read only isolated Agent Knowledge through the Agent route family.',
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
      modelTools: ['agent_reminder_schedule'],
      workspaceCategories: ['automation', 'routines'],
      slashCommandFamilies: ['schedule', 'reminder'],
      scheduleKinds: ['at', 'every', 'cron'],
      purpose: 'Create one connected reminder schedule from a direct user request.',
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
      boundary: 'Read-only public operator briefing routes.',
    },
    {
      id: 'operator-actions',
      routes: ['public operator action methods for approvals, automation jobs, automation runs, and schedules'],
      modelTools: ['agent_operator_action'],
      boundary: 'Allowlisted confirmed mutations only; no arbitrary route invocation.',
    },
    {
      id: 'delivery',
      routes: ['configured channel, notification, and delivery targets'],
      modelTools: ['agent_channel_send', 'agent_notify'],
      boundary: 'Explicit user-approved delivery only; no route/account creation.',
    },
    {
      id: 'connected-schedules',
      routes: ['public schedule creation/run routes'],
      modelTools: ['agent_reminder_schedule', 'agent_operator_action'],
      boundary: 'Connected schedules only; no hidden local scheduler or separate Agent job.',
    },
  ];
}

export function blockedConnectedHostCapabilities(): readonly Record<string, unknown>[] {
  return [
    {
      id: 'connected-host-lifecycle',
      blocked: ['start', 'stop', 'restart', 'install', 'upgrade', 'expose-listener', 'mutate-listener'],
      reason: 'The connected host and listener are externally owned by GoodVibes; Agent can use public operator routes but not manage hosting.',
    },
    {
      id: 'non-agent-knowledge',
      blocked: ['default-knowledge', 'non-agent-knowledge-segments', 'fallback-knowledge'],
      reason: 'Agent model tools must stay inside the isolated Agent Knowledge route family.',
    },
    {
      id: 'hidden-background-work',
      blocked: ['separate-agent-jobs', 'implicit-delegated-review', 'local-schedulers'],
      reason: 'All model work is serial and visible unless the user explicitly requests delegation through an exposed surface.',
    },
    {
      id: 'arbitrary-connected-host-mutations',
      blocked: ['route-discovery-mutation', 'account-creation', 'automation-definition-creation'],
      reason: 'Only the documented allowlisted model tools and slash-command bridges are exposed.',
    },
  ];
}

export function settingsPolicySummary(): Record<string, unknown> {
  return {
    discovery: 'Use mode:"settings" for the setting catalog and mode:"get_setting" for one key. Hidden/scriptable settings require includeHidden:true.',
    mutation: 'Use mode:"set_setting" or mode:"reset_setting" with confirm:true and explicitUserRequest.',
    secretHandling: 'Raw secret values are persisted through the secret manager; config receives only a secret reference and tool output is redacted.',
    writablePolicy: 'Each setting descriptor includes writable, visibleInWorkspace, and lockReason when applicable.',
    readOnlyHostOwnedPrefixes: ['service.*', 'controlPlane.*', 'httpListener.*', 'web.*', 'danger.daemon.*', 'danger.httpListener.*'],
  };
}
