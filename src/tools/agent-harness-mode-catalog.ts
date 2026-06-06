import { AGENT_HARNESS_MODES } from './agent-harness-tool-schema.ts';

export type AgentHarnessMode = typeof AGENT_HARNESS_MODES[number];

type HarnessModeKind = 'summary' | 'discover' | 'inspect' | 'effect' | 'alias';

interface HarnessModeDescriptor {
  readonly id: AgentHarnessMode;
  readonly kind: HarnessModeKind;
  readonly family: string;
  readonly summary: string;
  readonly next?: string;
  readonly requiresConfirmation?: boolean;
  readonly aliases?: readonly AgentHarnessMode[];
  readonly parameters?: readonly string[];
}

interface HarnessModeCatalogArgs {
  readonly query?: unknown;
  readonly target?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

export type HarnessModeResolution =
  | { readonly status: 'found'; readonly mode: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

export const HARNESS_MODE_DESCRIPTORS: readonly HarnessModeDescriptor[] = [
  { id: 'summary', kind: 'summary', family: 'start', summary: 'Compact harness map, counts, posture, and mode guide.', next: 'Use modes or a plural catalog mode to drill in.', parameters: ['includeParameters'] },
  { id: 'modes', kind: 'discover', family: 'start', summary: 'Search all agent_harness modes by task, family, effect, or id.', next: 'Use mode for one exact mode contract.', parameters: ['query', 'target', 'limit', 'includeParameters'] },
  { id: 'mode', kind: 'inspect', family: 'start', summary: 'Inspect one agent_harness mode contract and common next step.', next: 'Use target or query with a mode id or task phrase.', parameters: ['target', 'query'] },
  { id: 'cli_commands', kind: 'discover', family: 'cli', summary: 'List top-level package CLI mirrors for discovery only.', next: 'Use cli_command for one command.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'cli_command', kind: 'inspect', family: 'cli', summary: 'Inspect one CLI command parser result, policy, aliases, and model route.', parameters: ['cliCommand', 'command', 'commandName', 'target', 'query'] },
  { id: 'panels', kind: 'discover', family: 'ui', summary: 'List built-in panel catalog state and workspace routes.', next: 'Use panel or open_panel.', parameters: ['query', 'category', 'limit', 'includeParameters'] },
  { id: 'panel', kind: 'inspect', family: 'ui', summary: 'Inspect one built-in panel, open state, workspace route, and policy.', parameters: ['panelId', 'target', 'query'] },
  { id: 'open_panel', kind: 'effect', family: 'ui', summary: 'Route the visible shell to one built-in panel.', requiresConfirmation: true, parameters: ['panelId', 'target', 'query', 'pane', 'confirm', 'explicitUserRequest'] },
  { id: 'ui_surfaces', kind: 'discover', family: 'ui', summary: 'List modal, picker, and visible UI surfaces the model can request.', next: 'Use ui_surface or open_ui_surface.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'ui_surface', kind: 'inspect', family: 'ui', summary: 'Inspect one visible modal or picker surface and route contract.', parameters: ['surfaceId', 'target', 'query'] },
  { id: 'open_ui_surface', kind: 'effect', family: 'ui', summary: 'Open one visible modal, picker, or operator workspace route.', requiresConfirmation: true, parameters: ['surfaceId', 'target', 'query', 'confirm', 'explicitUserRequest'] },
  { id: 'shortcuts', kind: 'discover', family: 'keyboard', summary: 'List fixed shortcuts and keybinding overview.', next: 'Use keybindings or keybinding for configurable actions.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'keybindings', kind: 'discover', family: 'keyboard', summary: 'List configurable keybinding actions and current/default combos.', next: 'Use keybinding, run_keybinding, set_keybinding, or reset_keybinding.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'keybinding', kind: 'inspect', family: 'keyboard', summary: 'Inspect one keybinding action, current combos, defaults, and policy.', parameters: ['actionId', 'key', 'target', 'query'] },
  { id: 'run_keybinding', kind: 'effect', family: 'keyboard', summary: 'Run one supported keybinding action through the active UI route.', requiresConfirmation: true, parameters: ['actionId', 'key', 'target', 'query', 'confirm', 'explicitUserRequest'] },
  { id: 'set_keybinding', kind: 'effect', family: 'keyboard', summary: 'Set one configurable keybinding action.', requiresConfirmation: true, parameters: ['actionId', 'combo', 'combos', 'confirm', 'explicitUserRequest'] },
  { id: 'reset_keybinding', kind: 'effect', family: 'keyboard', summary: 'Reset one configurable keybinding action to defaults.', requiresConfirmation: true, parameters: ['actionId', 'confirm', 'explicitUserRequest'] },
  { id: 'commands', kind: 'discover', family: 'slash', summary: 'List registered slash commands and compact policies.', next: 'Use command or run_command.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'command', kind: 'inspect', family: 'slash', summary: 'Inspect slash command, parsed args, policy, aliases, and model route.', parameters: ['command', 'commandName', 'target', 'query'] },
  { id: 'run_command', kind: 'effect', family: 'slash', summary: 'Run one slash command through shared command dispatch.', requiresConfirmation: true, parameters: ['command', 'commandName', 'args', 'target', 'query', 'confirm', 'explicitUserRequest'] },
  { id: 'channels', kind: 'discover', family: 'delivery', summary: 'List channel readiness, accounts, delivery posture, and safe setup keys.', next: 'Use channel or agent_channel_send.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'channel', kind: 'inspect', family: 'delivery', summary: 'Inspect one channel readiness entry and delivery policy.', parameters: ['channelId', 'target', 'query'] },
  { id: 'notifications', kind: 'discover', family: 'delivery', summary: 'List notification target posture with webhook values redacted.', next: 'Use notification_target or agent_notify.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'notification_target', kind: 'inspect', family: 'delivery', summary: 'Inspect one notification target and safe routing policy.', parameters: ['notificationTargetId', 'target', 'query'] },
  { id: 'provider_accounts', kind: 'discover', family: 'providers', summary: 'List provider auth, subscription, usage-window, and repair posture.', next: 'Use provider_account.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'provider_account', kind: 'inspect', family: 'providers', summary: 'Inspect one provider account/auth posture without token leakage.', parameters: ['providerId', 'target', 'query'] },
  { id: 'mcp_servers', kind: 'discover', family: 'tools', summary: 'List MCP server/tool/security posture without exposing env or secrets.', next: 'Use mcp_server.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'mcp_server', kind: 'inspect', family: 'tools', summary: 'Inspect one MCP server, tools, schemas, auth, and trust posture.', parameters: ['mcpServerId', 'target', 'query'] },
  { id: 'setup_posture', kind: 'discover', family: 'setup', summary: 'Inspect first-run/always-on setup plan, posture, and flags.', next: 'Use setup_item.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'setup_item', kind: 'inspect', family: 'setup', summary: 'Inspect one first-run/always-on setup plan item.', parameters: ['setupItemId', 'target', 'query'] },
  { id: 'model_routing', kind: 'discover', family: 'providers', summary: 'List model routes, hardware-scored local cookbook, and pins.', next: 'Use model_route.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'model_route', kind: 'inspect', family: 'providers', summary: 'Inspect one model route, fit score, or visible selection path.', parameters: ['modelRouteId', 'target', 'query'] },
  { id: 'execution_posture', kind: 'discover', family: 'execution', summary: 'Pick local shell/edit execution vs delegation.', next: 'Use execution_route.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'execution_route', kind: 'inspect', family: 'execution', summary: 'Inspect one local, browser, web, or delegation route.', parameters: ['executionRouteId', 'target', 'query'] },
  { id: 'execution_history', kind: 'discover', family: 'execution', summary: 'List recent local tool/shell/edit execution records.', next: 'Use execution_history_item.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'execution_history_item', kind: 'inspect', family: 'execution', summary: 'Inspect one execution record with routes and recovery.', parameters: ['executionRecordId', 'recordId', 'target', 'query'] },
  { id: 'file_recovery', kind: 'discover', family: 'execution', summary: 'Inspect local file edit undo/redo recovery.', next: 'Use run_file_recovery with confirmation.', parameters: ['includeParameters'] },
  { id: 'run_file_recovery', kind: 'effect', family: 'execution', summary: 'Apply one local file undo or redo snapshot.', requiresConfirmation: true, parameters: ['recoveryAction', 'target', 'query', 'confirm', 'explicitUserRequest'] },
  { id: 'personal_ops', kind: 'discover', family: 'personal-ops', summary: 'Map email, calendar, tasks, reminders, notes, and live records.', next: 'Use personal_ops_lane for personal operations.', parameters: ['includeParameters'] },
  { id: 'personal_ops_lane', kind: 'inspect', family: 'personal-ops', summary: 'Inspect email, calendar, tasks, reminders lane records and routes.', parameters: ['laneId', 'target', 'query'] },
  { id: 'autonomy_intake', kind: 'discover', family: 'personal-ops', summary: 'Pick safest route for ongoing-work requests.', next: 'Use returned route or autonomy_queue.', parameters: ['query', 'target', 'includeParameters'] },
  { id: 'autonomy_queue', kind: 'discover', family: 'personal-ops', summary: 'List autonomy work with live records, tails, and controls.', next: 'Use autonomy_queue_item.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'autonomy_queue_item', kind: 'inspect', family: 'personal-ops', summary: 'Inspect one autonomy card, live records, tails, and routes.', parameters: ['queueItemId', 'target', 'query'] },
  { id: 'learning_curator', kind: 'discover', family: 'personal-ops', summary: 'Rank memory, notes, personas, skills, routines review/proposals.', next: 'Use learning_candidate.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'learning_candidate', kind: 'inspect', family: 'personal-ops', summary: 'Inspect one local-learning candidate and safe existing routes.', parameters: ['candidateId', 'target', 'query'] },
  { id: 'research_runs', kind: 'discover', family: 'research', summary: 'List deep-research runs, phase, log tails, and controls.', next: 'Use research_run for one run.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'research_run', kind: 'inspect', family: 'research', summary: 'Inspect one research run, log tail, checkpoints, and controls.', parameters: ['runId', 'target', 'query'] },
  { id: 'research_queue', kind: 'discover', family: 'research', summary: 'List research sources, credibility, bundle route, and next actions.', next: 'Use research_source for one source.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'research_source', kind: 'inspect', family: 'research', summary: 'Inspect one source, report line, bundle, review, or ingest routes.', parameters: ['sourceId', 'target', 'query'] },
  { id: 'document_ops', kind: 'discover', family: 'documents', summary: 'Map uploads, exports, artifacts, and blind model comparison.', next: 'Use document_ops_lane for docs, files, sources, artifacts, compare.', parameters: ['includeParameters'] },
  { id: 'document_ops_lane', kind: 'inspect', family: 'documents', summary: 'Inspect uploads, artifacts, sources, blind model compare/comparison.', parameters: ['laneId', 'target', 'query'] },
  { id: 'pairing_posture', kind: 'discover', family: 'companion', summary: 'List pairing routes, token posture, and safe handoff readiness.', next: 'Use pairing_route.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'pairing_route', kind: 'inspect', family: 'companion', summary: 'Inspect one companion pairing route and safe visible handoff.', parameters: ['pairingRouteId', 'target', 'query'] },
  { id: 'delegation_posture', kind: 'discover', family: 'delegation', summary: 'List explicit build/fix/review delegation routes and boundaries.', next: 'Use delegation_route.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'delegation_route', kind: 'inspect', family: 'delegation', summary: 'Inspect one delegation route and exact visible submission contract.', parameters: ['delegationRouteId', 'target', 'query'] },
  { id: 'security_posture', kind: 'discover', family: 'security', summary: 'List security posture findings without exposing secrets or raw config.', next: 'Use security_finding.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'security_finding', kind: 'inspect', family: 'security', summary: 'Inspect one security posture finding and safe remediation route.', parameters: ['findingId', 'target', 'query'] },
  { id: 'support_bundles', kind: 'discover', family: 'support', summary: 'List support bundle artifacts and redacted export/import posture.', next: 'Use support_bundle.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'support_bundle', kind: 'inspect', family: 'support', summary: 'Inspect one support bundle artifact and redaction posture.', parameters: ['bundlePath', 'target', 'query'] },
  { id: 'media_posture', kind: 'discover', family: 'media', summary: 'List media/voice readiness, browser posture, and artifact routes.', next: 'Use media_provider or agent_media_generate.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'media_provider', kind: 'inspect', family: 'media', summary: 'Inspect one voice or media provider readiness entry.', parameters: ['mediaProviderId', 'target', 'query'] },
  { id: 'sessions', kind: 'discover', family: 'sessions', summary: 'List saved sessions, bookmarks, exports, and pending approvals posture.', next: 'Use session.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'session', kind: 'inspect', family: 'sessions', summary: 'Inspect one saved session or bookmark entry.', parameters: ['sessionId', 'target', 'query'] },
  { id: 'settings', kind: 'discover', family: 'settings', summary: 'Search Agent settings compactly by category, prefix, or query.', next: 'Use get_setting, set_setting, or reset_setting.', parameters: ['category', 'prefix', 'query', 'includeHidden', 'limit', 'includeParameters'] },
  { id: 'get_setting', kind: 'inspect', family: 'settings', summary: 'Inspect one Agent setting descriptor, value, default, and policy.', parameters: ['key', 'target', 'query'] },
  { id: 'set_setting', kind: 'effect', family: 'settings', summary: 'Set one Agent-owned setting through config/secret managers.', requiresConfirmation: true, parameters: ['key', 'target', 'query', 'value', 'confirm', 'explicitUserRequest'] },
  { id: 'reset_setting', kind: 'effect', family: 'settings', summary: 'Reset one Agent-owned setting and delete secret refs when needed.', requiresConfirmation: true, parameters: ['key', 'target', 'query', 'confirm', 'explicitUserRequest'] },
  { id: 'workspace', kind: 'discover', family: 'workspace', summary: 'List Agent workspace categories and action counts.', next: 'Use workspace_actions or workspace_action.' },
  { id: 'workspace_categories', kind: 'discover', family: 'workspace', summary: 'Alias of workspace for category discovery.', next: 'Use workspace_actions or workspace_action.', aliases: ['workspace'] },
  { id: 'workspace_actions', kind: 'discover', family: 'workspace', summary: 'Search all user-facing Agent workspace actions and compact model routes.', next: 'Use workspace_action or run_workspace_action.', parameters: ['categoryId', 'query', 'limit', 'includeParameters'] },
  { id: 'workspace_action', kind: 'inspect', family: 'workspace', summary: 'Inspect one workspace action, editor schema, route, and safety policy.', parameters: ['actionId', 'command', 'target', 'query', 'recordId'] },
  { id: 'run_workspace_action', kind: 'effect', family: 'workspace', summary: 'Run a workspace action or return its model execution handoff.', requiresConfirmation: true, parameters: ['actionId', 'command', 'target', 'query', 'recordId', 'fields', 'confirm', 'explicitUserRequest'] },
  { id: 'tools', kind: 'discover', family: 'tools', summary: 'List first-class model tool definitions compactly.', next: 'Use tool for full schema.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'tool', kind: 'inspect', family: 'tools', summary: 'Inspect one first-class model tool definition and JSON schema.', parameters: ['toolName', 'target', 'query'] },
  { id: 'release_evidence', kind: 'discover', family: 'operator-audit', summary: 'List packaged operator/audit release artifacts compactly.', next: 'Use release_evidence_artifact.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'release_evidence_artifact', kind: 'inspect', family: 'operator-audit', summary: 'Inspect one operator/audit release artifact and optional content.', parameters: ['artifactId', 'target', 'query'] },
  { id: 'release_readiness', kind: 'discover', family: 'operator-audit', summary: 'Search the operator/audit release-quality inventory.', next: 'Use release_readiness_item.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'release_readiness_item', kind: 'inspect', family: 'operator-audit', summary: 'Inspect one operator/audit readiness inventory item.', parameters: ['itemId', 'target', 'query'] },
  { id: 'operator_methods', kind: 'discover', family: 'operator', summary: 'List GoodVibes daemon operator methods from the live SDK contract.', next: 'Use operator_method or agent_operator_method.', parameters: ['query', 'limit', 'includeParameters'] },
  { id: 'operator_method', kind: 'inspect', family: 'operator', summary: 'Inspect one daemon method, route, effect, and confirmation policy.', parameters: ['methodId', 'target', 'query'] },
  { id: 'service_posture', kind: 'discover', family: 'connected-host', summary: 'Inspect service endpoint posture, binding, issues, and probes.', next: 'Use service_endpoint.', parameters: ['includeParameters'] },
  { id: 'service_endpoint', kind: 'inspect', family: 'connected-host', summary: 'Inspect one service endpoint binding and lifecycle boundary.', parameters: ['endpointId', 'target', 'query'] },
  { id: 'connected_host', kind: 'discover', family: 'connected-host', summary: 'Map connected-host capabilities, boundaries, and tool availability.', next: 'Use connected_host_capability or connected_host_status.', parameters: ['includeParameters'] },
  { id: 'connected_host_status', kind: 'inspect', family: 'connected-host', summary: 'Run live read-only connected-host readiness checks.', parameters: ['includeParameters'] },
  { id: 'connected_host_capability', kind: 'inspect', family: 'connected-host', summary: 'Inspect one connected-host capability and blocked surfaces.', parameters: ['capabilityId', 'target', 'query'] },
  { id: 'daemon', kind: 'alias', family: 'connected-host', summary: 'GoodVibes daemon -> connected_host; mutations use confirmed methods.', next: 'Use connected_host for canonical naming.', aliases: ['connected_host'], parameters: ['includeParameters'] },
  { id: 'daemon_status', kind: 'alias', family: 'connected-host', summary: 'GoodVibes daemon status -> connected_host_status.', next: 'Use connected_host_status for canonical naming.', aliases: ['connected_host_status'], parameters: ['includeParameters'] },
] as const;

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function describeHarnessModeDescriptor(
  descriptor: HarnessModeDescriptor,
  options: { readonly includeParameters?: boolean; readonly lookup?: Record<string, unknown> } = {},
): Record<string, unknown> {
  return {
    id: descriptor.id,
    kind: descriptor.kind,
    family: descriptor.family,
    summary: descriptor.summary,
    modelRoute: `agent_harness mode:"${descriptor.id}"`,
    ...(descriptor.next ? { next: descriptor.next } : {}),
    ...(descriptor.requiresConfirmation ? { requiresConfirmation: true } : {}),
    ...(descriptor.aliases ? { aliases: descriptor.aliases } : {}),
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(options.includeParameters ? {
      parameters: descriptor.parameters ?? [],
      route: `agent_harness mode:"${descriptor.id}"`,
    } : {}),
  };
}

function harnessModeSearchText(descriptor: HarnessModeDescriptor): string {
  return [
    descriptor.id,
    descriptor.id.replace(/_/g, ' '),
    descriptor.kind,
    descriptor.family,
    descriptor.summary,
    descriptor.next,
    ...(descriptor.aliases ?? []),
    ...(descriptor.parameters ?? []),
  ].filter(Boolean).join('\n').toLowerCase();
}

function searchTokens(input: string): readonly string[] {
  return input.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0);
}

function harnessModeMatchesSearch(descriptor: HarnessModeDescriptor, input: string): boolean {
  const text = harnessModeSearchText(descriptor);
  const normalized = input.toLowerCase().trim();
  if (normalized.length === 0) return true;
  if (text.includes(normalized)) return true;
  const tokens = searchTokens(normalized);
  return tokens.length > 0 && tokens.every((token) => text.includes(token));
}

function tokenScore(tokens: readonly string[], value: string | undefined, weight: number): number {
  if (!value) return 0;
  const text = value.toLowerCase();
  return tokens.reduce((score, token) => score + (text.includes(token) ? weight : 0), 0);
}

const ACTION_VERBS = new Set(['run', 'set', 'reset', 'open', 'create', 'send', 'schedule']);

function harnessModeRelevance(descriptor: HarnessModeDescriptor, input: string): number {
  const normalized = input.toLowerCase().trim();
  if (!normalized) return 0;

  const tokens = searchTokens(normalized);
  const id = descriptor.id.toLowerCase();
  const idPhrase = id.replace(/_/g, ' ');
  const idLookup = normalized.replace(/\s+/g, '_');
  let score = 0;

  if (id === normalized || idPhrase === normalized) score += 10_000;
  if (id.startsWith(idLookup) || idPhrase.startsWith(normalized)) score += 5_000;
  if (id.includes(idLookup) || idPhrase.includes(normalized)) score += 2_500;

  score += tokenScore(tokens, [id, idPhrase, ...(descriptor.aliases ?? [])].join('\n'), 1_000);
  score += tokenScore(tokens, descriptor.family, 500);
  score += tokenScore(tokens, descriptor.kind, 500);
  score += tokenScore(tokens, (descriptor.parameters ?? []).join('\n'), 350);
  score += tokenScore(tokens, descriptor.summary, 200);
  score += tokenScore(tokens, descriptor.next, 100);

  const actionVerb = tokens.find((token) => ACTION_VERBS.has(token));
  if (actionVerb) {
    const idTokens = searchTokens(id);
    if (idTokens[0] === actionVerb) score += 2_000;
    if (descriptor.kind === 'effect' && idTokens.includes(actionVerb)) score += 1_000;
  }

  return score;
}

function matchingHarnessModes(input: string): readonly HarnessModeDescriptor[] {
  const matches = HARNESS_MODE_DESCRIPTORS
    .map((descriptor, index) => ({ descriptor, index, score: harnessModeRelevance(descriptor, input) }))
    .filter(({ descriptor }) => harnessModeMatchesSearch(descriptor, input));
  if (!input) return matches.map(({ descriptor }) => descriptor);
  return matches
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ descriptor }) => descriptor);
}

function modeLookupInput(args: HarnessModeCatalogArgs): { readonly source: 'target' | 'query'; readonly input: string } | null {
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

export function listHarnessModes(args: HarnessModeCatalogArgs): Record<string, unknown> {
  const lookup = modeLookupInput(args);
  const limit = readLimit(args.limit, 120);
  const normalized = lookup?.input.toLowerCase() ?? '';
  const modes = matchingHarnessModes(normalized)
    .map((descriptor) => describeHarnessModeDescriptor(descriptor, { includeParameters: args.includeParameters === true }))
    .slice(0, limit);
  return {
    modes,
    returned: modes.length,
    total: HARNESS_MODE_DESCRIPTORS.length,
    families: Array.from(new Set(HARNESS_MODE_DESCRIPTORS.map((descriptor) => descriptor.family))).sort(),
    policy: 'Mode discovery is read-only. Effect modes still require confirm:true and explicitUserRequest.',
  };
}

export function describeHarnessMode(args: HarnessModeCatalogArgs): HarnessModeResolution {
  const lookup = modeLookupInput(args);
  if (!lookup) {
    return {
      status: 'missing_lookup',
      usage: 'mode inspection requires target or query. Use mode:"modes" to search available harness modes.',
    };
  }
  const normalized = lookup.input.toLowerCase();
  const exact = HARNESS_MODE_DESCRIPTORS.find((descriptor) => descriptor.id === lookup.input);
  if (exact) return { status: 'found', mode: describeHarnessModeDescriptor(exact, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'id' } }) };
  const insensitive = HARNESS_MODE_DESCRIPTORS.find((descriptor) => descriptor.id.toLowerCase() === normalized);
  if (insensitive) return { status: 'found', mode: describeHarnessModeDescriptor(insensitive, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-id' } }) };
  const searched = matchingHarnessModes(normalized);
  if (searched.length === 1) {
    return { status: 'found', mode: describeHarnessModeDescriptor(searched[0]!, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'search' } }) };
  }
  if (searched.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: searched.slice(0, 12).map((descriptor) => describeHarnessModeDescriptor(descriptor)),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown harness mode ${lookup.input}. Use mode:"modes" to inspect available modes.`,
  };
}
