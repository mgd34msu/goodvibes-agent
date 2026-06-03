export const AGENT_HARNESS_MODES = [
  'summary', 'cli_commands', 'cli_command', 'panels', 'panel', 'open_panel',
  'ui_surfaces', 'ui_surface', 'open_ui_surface',
  'shortcuts', 'keybindings', 'keybinding', 'set_keybinding', 'reset_keybinding',
  'commands', 'command', 'run_command', 'settings', 'get_setting', 'set_setting',
  'reset_setting', 'workspace', 'workspace_categories', 'workspace_actions',
  'workspace_action', 'run_workspace_action', 'tools', 'connected_host', 'connected_host_status',
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
    description: 'Search text for command, setting, tool, or UI surface catalogs.',
  },
  command: {
    type: 'string',
    description: 'Full slash command string for mode run_command, for example "/settings get provider.model". In cli_command mode this may also hold a top-level CLI string such as "goodvibes-agent status --json".',
  },
  cliCommand: {
    type: 'string',
    description: 'Top-level CLI command string for mode cli_command, for example "goodvibes-agent status --json" or "profiles list". This mode is read-only metadata/parse inspection.',
  },
  commandName: {
    type: 'string',
    description: 'Slash command root without the leading slash for mode command or run_command, or a top-level CLI command token for cli_command.',
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
    description: 'UI surface id for ui_surface or open_ui_surface modes.',
  },
  panelId: {
    type: 'string',
    description: 'Built-in panel id for panel or open_panel modes.',
  },
  actionId: {
    type: 'string',
    description: 'Agent workspace action id for workspace_action or run_workspace_action, or keybinding action id for keybinding/set_keybinding/reset_keybinding.',
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
    description: 'Agent setting key for get_setting, set_setting, or reset_setting.',
  },
  value: {
    anyOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
    ],
    description: 'Setting value for set_setting. Strings, booleans, numbers, and enum strings are accepted.',
  },
  target: {
    type: 'string',
    description: 'Optional UI target, such as a model-picker target or settings target key.',
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
    description: 'Required true for set_setting, reset_setting, run_command, open_panel, open_ui_surface, and mutating run_workspace_action calls after an explicit user request.',
  },
  explicitUserRequest: {
    type: 'string',
    description: 'Exact user request or faithful short summary authorizing a setting mutation or harness UI/command invocation.',
  },
} as const;
