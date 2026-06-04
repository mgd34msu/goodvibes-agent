import type { CommandContext } from '../input/command-registry.ts';
import { agentWorkspaceCategoryForPanel, agentWorkspaceCommandForPanel } from '../input/agent-workspace-panel-route.ts';
import type { PanelRegistration } from '../panels/types.ts';

export interface AgentHarnessPanelArgs {
  readonly query?: unknown;
  readonly panelId?: unknown;
  readonly target?: unknown;
  readonly category?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
  readonly pane?: unknown;
}

interface PanelLookup {
  readonly source: 'panelId' | 'target' | 'query';
  readonly input: string;
  readonly resolvedBy: 'id' | 'case-insensitive-id' | 'name' | 'case-insensitive-name' | 'search';
}

type PanelResolution =
  | {
    readonly status: 'found';
    readonly registration: PanelRegistration;
    readonly lookup: PanelLookup;
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

function previewText(value: string, maxLength = 56): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function panelManager(context: CommandContext) {
  return context.workspace.panelManager ?? null;
}

function panelMatches(panel: Record<string, unknown>, query: string): boolean {
  if (!query) return true;
  return [
    panel.id,
    panel.name,
    panel.category,
    panel.description,
    panel.summary,
    panel.workspaceRoute,
  ].map((value) => typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')).join('\n').toLowerCase().includes(query.toLowerCase());
}

function panelLookupFromArgs(args: AgentHarnessPanelArgs): { readonly source: PanelLookup['source']; readonly input: string } | null {
  const panelId = readString(args.panelId);
  if (panelId) return { source: 'panelId', input: panelId };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  if (query) return { source: 'query', input: query };
  return null;
}

function panelCandidate(registration: PanelRegistration): Record<string, unknown> {
  return {
    id: registration.id,
    name: registration.name,
    category: registration.category,
    summary: previewText(registration.description),
    modelRoute: panelModelRoute(),
    workspaceRoute: {
      categoryId: agentWorkspaceCategoryForPanel(registration.id),
      command: agentWorkspaceCommandForPanel(registration.id),
    },
  };
}

function panelModelRoute(): string {
  return 'agent_harness mode:"open_panel" or mode:"workspace_actions"';
}

function resolveHarnessPanel(context: CommandContext, args: AgentHarnessPanelArgs): PanelResolution | null {
  const manager = panelManager(context);
  const lookup = panelLookupFromArgs(args);
  if (!manager || !lookup) return null;
  const registrations = manager.getRegisteredTypes();
  const exactId = registrations.find((panel) => panel.id === lookup.input);
  if (exactId) return { status: 'found', registration: exactId, lookup: { ...lookup, resolvedBy: 'id' } };
  const inputLower = lookup.input.toLowerCase();
  const exactName = registrations.find((panel) => panel.name === lookup.input);
  if (exactName) return { status: 'found', registration: exactName, lookup: { ...lookup, resolvedBy: 'name' } };
  const ciId = registrations.filter((panel) => panel.id.toLowerCase() === inputLower);
  if (ciId.length === 1) return { status: 'found', registration: ciId[0]!, lookup: { ...lookup, resolvedBy: 'case-insensitive-id' } };
  if (ciId.length > 1) return { status: 'ambiguous', input: lookup.input, candidates: ciId.map(panelCandidate).slice(0, 8) };
  const ciName = registrations.filter((panel) => panel.name.toLowerCase() === inputLower);
  if (ciName.length === 1) return { status: 'found', registration: ciName[0]!, lookup: { ...lookup, resolvedBy: 'case-insensitive-name' } };
  if (ciName.length > 1) return { status: 'ambiguous', input: lookup.input, candidates: ciName.map(panelCandidate).slice(0, 8) };
  const category = readString(args.category);
  const search = registrations.filter((registration) => {
    if (category && registration.category !== category) return false;
    return panelMatches(panelCandidate(registration), lookup.input);
  });
  if (search.length === 1) return { status: 'found', registration: search[0]!, lookup: { ...lookup, resolvedBy: 'search' } };
  if (search.length > 1) return { status: 'ambiguous', input: lookup.input, candidates: search.map(panelCandidate).slice(0, 8) };
  return null;
}

function describePanelRegistration(
  context: CommandContext,
  registration: PanelRegistration,
  options: { readonly includeParameters?: boolean; readonly lookup?: PanelLookup } = {},
): Record<string, unknown> {
  const manager = panelManager(context);
  const openPanel = manager?.getPanel(registration.id) ?? null;
  const pane = manager?.getPaneOf(registration.id) ?? null;
  const activePanel = manager?.getActivePanel() ?? null;
  return {
    id: registration.id,
    name: registration.name,
    icon: registration.icon,
    category: registration.category,
    ...(options.includeParameters ? { description: registration.description } : { summary: previewText(registration.description) }),
    ...(options.lookup ? { lookup: options.lookup } : {}),
    preload: registration.preload === true,
    open: openPanel !== null,
    pane,
    active: activePanel?.id === registration.id,
    focused: activePanel?.id === registration.id,
    modelRoute: panelModelRoute(),
    workspaceRoute: {
      categoryId: agentWorkspaceCategoryForPanel(registration.id),
      command: agentWorkspaceCommandForPanel(registration.id),
    },
    ...(options.includeParameters ? {
      policy: {
        effect: 'ui-navigation',
        confirmation: 'agent_harness mode:"open_panel" requires confirm:true and explicitUserRequest.',
        boundary: 'Panels are Agent/TUI operator views. The model can inspect panel catalog/open state; panel routing uses the existing Agent workspace route and does not mutate connected-host lifecycle.',
      },
    } : {}),
  };
}

export function totalHarnessPanels(context: CommandContext): number {
  return panelManager(context)?.getRegisteredTypes().length ?? 0;
}

export function listHarnessPanels(context: CommandContext, args: AgentHarnessPanelArgs): readonly Record<string, unknown>[] {
  const manager = panelManager(context);
  if (!manager) return [];
  const query = readString(args.query);
  const category = readString(args.category);
  const limit = readLimit(args.limit, 200);
  const includeParameters = args.includeParameters === true;
  return manager.getRegisteredTypes()
    .map((registration) => describePanelRegistration(context, registration, { includeParameters }))
    .filter((panel) => !category || panel.category === category)
    .filter((panel) => panelMatches(panel, query))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .slice(0, limit);
}

export function describeHarnessPanel(context: CommandContext, args: AgentHarnessPanelArgs): Record<string, unknown> | null {
  const resolved = resolveHarnessPanel(context, args);
  if (resolved?.status === 'found') return describePanelRegistration(context, resolved.registration, { includeParameters: true, lookup: resolved.lookup });
  if (resolved?.status === 'ambiguous') {
    return { status: 'ambiguous', input: resolved.input, candidates: resolved.candidates };
  }
  return null;
}

export function openHarnessPanel(context: CommandContext, args: AgentHarnessPanelArgs): Record<string, unknown> {
  const resolved = resolveHarnessPanel(context, args);
  if (resolved?.status === 'ambiguous') {
    return { status: 'ambiguous_panel', input: resolved.input, candidates: resolved.candidates };
  }
  if (!resolved) {
    return {
      status: 'unknown_panel',
      panelId: readString(args.panelId || args.target || args.query) || '<missing>',
      availablePanels: listHarnessPanels(context, { limit: 50 }).map((entry) => entry.id),
    };
  }
  const panel = describePanelRegistration(context, resolved.registration, { includeParameters: true, lookup: resolved.lookup });
  const requestedPane = readString(args.pane);
  const pane = requestedPane === 'bottom' || requestedPane === 'top' ? requestedPane : undefined;
  if (!context.showPanel) {
    return {
      status: 'route_unavailable',
      panel,
      note: 'The current runtime did not provide showPanel. Use the returned workspaceRoute from the TUI.',
    };
  }
  context.showPanel(String(panel.id), pane);
  return {
    status: 'routed',
    panel,
    pane: pane ?? 'default',
    note: 'Panel routing was handed to the current Agent operator surface.',
  };
}
