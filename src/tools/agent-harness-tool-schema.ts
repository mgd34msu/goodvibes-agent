export const AGENT_HARNESS_MODES = [
  'summary', 'cli_commands', 'cli_command', 'panels', 'panel', 'open_panel',
  'ui_surfaces', 'ui_surface', 'open_ui_surface',
  'shortcuts', 'keybindings', 'keybinding', 'run_keybinding', 'set_keybinding', 'reset_keybinding',
  'commands', 'command', 'run_command', 'settings', 'get_setting', 'set_setting',
  'reset_setting', 'workspace', 'workspace_categories', 'workspace_actions',
  'workspace_action', 'run_workspace_action', 'tools', 'tool', 'connected_host', 'connected_host_status',
  'connected_host_capability',
] as const;

const KEY_COMBO_PARAMETER_SCHEMA = {
  type: 'object',
  properties: { key: { type: 'string' }, ctrl: { type: 'boolean' }, shift: { type: 'boolean' }, alt: { type: 'boolean' } },
  required: ['key'],
  additionalProperties: false,
} as const;

export const AGENT_HARNESS_PARAMETER_PROPERTIES = {
  mode: {
    type: 'string',
    enum: AGENT_HARNESS_MODES,
    description: 'Harness operation to perform.',
  },
  query: {
    type: 'string',
    description: 'Search text for slash-command, CLI mirror, panel, UI surface, keybinding, workspace action, model tool, setting, or connected-host capability catalogs; also lookup text for the matching single-item modes.',
  },
  command: {
    type: 'string',
    description: 'Full slash command string for mode command, workspace_action/run_workspace_action lookup, or run_command, for example "/settings get provider.model". In cli_command mode this may also hold a top-level CLI string such as "goodvibes-agent status --json".',
  },
  cliCommand: {
    type: 'string',
    description: 'Top-level CLI command string for mode cli_command, for example "goodvibes-agent status --json" or "profiles list". target or query can also look up one CLI mirror when the exact command token is not known. This mode is read-only metadata/parse inspection.',
  },
  commandName: {
    type: 'string',
    description: 'Slash command root without the leading slash for mode command or run_command, or a top-level CLI command token for cli_command. run_command can also resolve one slash command by target or query when the lookup is unique.',
  },
  args: {
    type: 'array',
    items: { type: 'string' },
    description: 'Slash command argument tokens for mode run_command when commandName is used.',
  },
  categoryId: {
    type: 'string',
    description: 'Agent workspace category id for workspace action filtering or ui surface routing.',
  },
  surfaceId: {
    type: 'string',
    description: 'UI surface id for ui_surface or open_ui_surface modes. target or query can also look up one UI surface when the exact id is not known.',
  },
  panelId: {
    type: 'string',
    description: 'Built-in panel id for panel or open_panel modes. target or query can also look up one panel when the exact id is not known.',
  },
  actionId: {
    type: 'string',
    description: 'Agent workspace action id for workspace_action or run_workspace_action, or keybinding action id for keybinding/run_keybinding/set_keybinding/reset_keybinding. command, target, or query can also look up one workspace action; target or query can also look up one keybinding action.',
  },
  fields: {
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Field values for run_workspace_action when the workspace action opens an editor form.',
  },
  combo: {
    ...KEY_COMBO_PARAMETER_SCHEMA,
    description: 'Single key combo for set_keybinding, for example { "key": "g", "ctrl": true }.',
  },
  combos: {
    type: 'array',
    items: KEY_COMBO_PARAMETER_SCHEMA,
    description: 'Multiple key combos for set_keybinding.',
  },
  recordId: {
    type: 'string',
    description: 'Selected Agent-local record id for selection-based local workspace operations.',
  },
  key: {
    type: 'string',
    description: 'Agent setting key for get_setting, set_setting, or reset_setting. target or query can also look up one setting when the exact key is not known.',
  },
  value: {
    anyOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
    ],
    description: 'Setting value for set_setting. Strings, booleans, numbers, and enum strings are accepted. In run_keybinding, value can provide visible search text for search/history-search shortcut routes.',
  },
  target: {
    type: 'string',
    description: 'Optional lookup target, such as a model-picker target, top-level CLI mirror/search text, panel id/search text, UI surface id/search text, workspace action id/search text, slash command root or invocation, setting key/search text, keybinding action/search text, model tool name/search text, or connected-host capability id/search text.',
  },
  capabilityId: {
    type: 'string',
    description: 'Connected-host allowed or blocked capability id for mode connected_host_capability, such as agent-knowledge-read or connected-host-lifecycle.',
  },
  toolName: {
    type: 'string',
    description: 'First-class model tool name for mode tool, such as agent_harness or agent_local_registry.',
  },
  category: {
    type: 'string',
    description: 'Setting category filter such as provider, behavior, tools, ui, tts, permissions, automation, or surfaces.',
  },
  prefix: {
    type: 'string',
    description: 'Setting key prefix filter such as surfaces.slack.',
  },
  includeHidden: {
    type: 'boolean',
    description: 'Include settings hidden from the Agent workspace because they are host-owned or non-Agent lifecycle settings.',
  },
  includeParameters: {
    type: 'boolean',
    description: 'Include model tool JSON schemas in tools mode, or workspace editor field schemas in workspace_actions mode.',
  },
  limit: {
    type: 'number',
    description: 'Maximum catalog entries to return.',
  },
  pane: {
    type: 'string',
    enum: ['top', 'bottom'],
    description: 'Preferred panel pane for open_panel when the current shell supports panel routing.',
  },
  confirm: {
    type: 'boolean',
    description: 'Required true for set_setting, reset_setting, run_keybinding, run_command, open_panel, open_ui_surface, and executable or mutating run_workspace_action calls after an explicit user request.',
  },
  explicitUserRequest: {
    type: 'string',
    description: 'Exact user request or faithful short summary authorizing a setting mutation, keybinding change/action, harness UI routing, slash-command invocation, or workspace-action invocation.',
  },
} as const;
