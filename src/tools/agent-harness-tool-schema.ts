export const AGENT_HARNESS_MODES = [
  'summary', 'modes', 'mode', 'cli_commands', 'cli_command', 'panels', 'panel', 'open_panel',
  'ui_surfaces', 'ui_surface', 'open_ui_surface',
  'shortcuts', 'keybindings', 'keybinding', 'run_keybinding', 'set_keybinding', 'reset_keybinding',
  'commands', 'command', 'run_command', 'channels', 'channel', 'notifications', 'notification_target',
  'provider_accounts', 'provider_account', 'mcp_servers', 'mcp_server',
  'setup_posture', 'setup_item',
  'model_routing', 'model_route',
  'execution_posture', 'execution_route',
  'personal_ops', 'personal_ops_lane',
  'autonomy_intake', 'autonomy_queue', 'autonomy_queue_item',
  'learning_curator', 'learning_candidate',
  'research_runs', 'research_run',
  'research_queue', 'research_source',
  'document_ops', 'document_ops_lane',
  'pairing_posture', 'pairing_route',
  'delegation_posture', 'delegation_route',
  'security_posture', 'security_finding', 'support_bundles', 'support_bundle',
  'media_posture', 'media_provider',
  'sessions', 'session',
  'settings', 'get_setting', 'set_setting',
  'reset_setting', 'workspace', 'workspace_categories', 'workspace_actions',
  'workspace_action', 'run_workspace_action', 'tools', 'tool', 'release_evidence', 'release_evidence_artifact',
  'release_readiness', 'release_readiness_item',
  'operator_methods', 'operator_method',
  'service_posture', 'service_endpoint',
  'connected_host', 'connected_host_status', 'connected_host_capability',
  'daemon', 'daemon_status',
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
    description: 'Harness operation. Start with summary or a plural catalog mode.',
  },
  query: {
    type: 'string',
    description: 'Catalog search text or single-item lookup text.',
  },
  command: {
    type: 'string',
    description: 'Slash command string, or CLI command string in cli_command mode.',
  },
  cliCommand: {
    type: 'string',
    description: 'Top-level CLI command string for cli_command inspection.',
  },
  commandName: {
    type: 'string',
    description: 'Slash command root or top-level CLI command token.',
  },
  args: {
    type: 'array',
    items: { type: 'string' },
    description: 'Arguments for run_command when commandName is used.',
  },
  channelId: {
    type: 'string',
    description: 'Channel id for channel mode.',
  },
  notificationTargetId: {
    type: 'string',
    description: 'Notification target id for notification_target mode.',
  },
  providerId: {
    type: 'string',
    description: 'Provider id for provider_account mode.',
  },
  mcpServerId: {
    type: 'string',
    description: 'MCP server id for mcp_server mode.',
  },
  setupItemId: {
    type: 'string',
    description: 'Setup item id for setup_item mode.',
  },
  modelRouteId: {
    type: 'string',
    description: 'Model route id or model key for model_route mode.',
  },
  executionRouteId: {
    type: 'string',
    description: 'Execution route id for execution_route mode.',
  },
  laneId: {
    type: 'string',
    description: 'Lane id for personal_ops_lane or document_ops_lane mode.',
  },
  queueItemId: {
    type: 'string',
    description: 'Queue item id for autonomy_queue_item mode.',
  },
  candidateId: {
    type: 'string',
    description: 'Candidate id for learning_candidate mode.',
  },
  sourceId: {
    type: 'string',
    description: 'Research source id for research_source mode.',
  },
  runId: {
    type: 'string',
    description: 'Research run id for research_run mode.',
  },
  pairingRouteId: {
    type: 'string',
    description: 'Pairing route id for pairing_route mode.',
  },
  delegationRouteId: {
    type: 'string',
    description: 'Delegation route id for delegation_route mode.',
  },
  findingId: {
    type: 'string',
    description: 'Security finding id for security_finding mode.',
  },
  bundlePath: {
    type: 'string',
    description: 'Workspace-relative bundle JSON path for support_bundle mode.',
  },
  mediaProviderId: {
    type: 'string',
    description: 'Voice or media provider id for media_provider mode.',
  },
  sessionId: {
    type: 'string',
    description: 'Saved session id for session mode.',
  },
  categoryId: {
    type: 'string',
    description: 'Workspace category id.',
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
    description: 'Workspace action id or keybinding action id.',
  },
  fields: {
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Editor field values for run_workspace_action.',
  },
  combo: {
    ...KEY_COMBO_PARAMETER_SCHEMA,
    description: 'Single key combo for set_keybinding.',
  },
  combos: {
    type: 'array',
    items: KEY_COMBO_PARAMETER_SCHEMA,
    description: 'Multiple key combos for set_keybinding.',
  },
  recordId: {
    type: 'string',
    description: 'Selected Agent-local record id.',
  },
  key: {
    type: 'string',
    description: 'Agent setting key.',
  },
  value: {
    anyOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
    ],
    description: 'Setting value, or visible search text for shortcut routes.',
  },
  target: {
    type: 'string',
    description: 'Generic lookup target for single-item modes.',
  },
  methodId: {
    type: 'string',
    description: 'Public operator or Agent Knowledge method id.',
  },
  endpointId: {
    type: 'string',
    description: 'Connected service endpoint id.',
  },
  artifactId: {
    type: 'string',
    description: 'Release evidence artifact id.',
  },
  itemId: {
    type: 'string',
    description: 'Release readiness item id for mode release_readiness_item.',
  },
  capabilityId: {
    type: 'string',
    description: 'Connected-host capability id.',
  },
  toolName: {
    type: 'string',
    description: 'First-class model tool name.',
  },
  category: {
    type: 'string',
    description: 'Setting category filter.',
  },
  prefix: {
    type: 'string',
    description: 'Setting key prefix filter such as surfaces.slack.',
  },
  includeHidden: {
    type: 'boolean',
    description: 'Include hidden settings in settings mode.',
  },
  includeParameters: {
    type: 'boolean',
    description: 'Include optional detail for discovery modes.',
  },
  limit: {
    type: 'number',
    description: 'Maximum catalog entries to return.',
  },
  pane: {
    type: 'string',
    enum: ['top', 'bottom'],
    description: 'Preferred pane for open_panel.',
  },
  confirm: {
    type: 'boolean',
    description: 'Required true for confirmed harness effects.',
  },
  explicitUserRequest: {
    type: 'string',
    description: 'User request authorizing a confirmed harness effect.',
  },
} as const;
