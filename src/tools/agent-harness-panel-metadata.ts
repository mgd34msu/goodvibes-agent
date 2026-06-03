import type { CommandContext } from '../input/command-registry.ts';
import { agentWorkspaceCategoryForPanel, agentWorkspaceCommandForPanel } from '../input/agent-workspace-panel-route.ts';
import type { PanelRegistration } from '../panels/types.ts';

export interface AgentHarnessPanelArgs {
  readonly query?: unknown;
  readonly panelId?: unknown;
  readonly category?: unknown;
  readonly limit?: unknown;
  readonly pane?: unknown;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
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
    panel.workspaceRoute,
  ].map((value) => String(value ?? '')).join('\n').toLowerCase().includes(query.toLowerCase());
}

function describePanelRegistration(context: CommandContext, registration: PanelRegistration): Record<string, unknown> {
  const manager = panelManager(context);
  const openPanel = manager?.getPanel(registration.id) ?? null;
  const pane = manager?.getPaneOf(registration.id) ?? null;
  const activePanel = manager?.getActivePanel() ?? null;
  return {
    id: registration.id,
    name: registration.name,
    icon: registration.icon,
    category: registration.category,
    description: registration.description,
    preload: registration.preload === true,
    open: openPanel !== null,
    pane,
    active: activePanel?.id === registration.id,
    focused: activePanel?.id === registration.id,
    workspaceRoute: {
      categoryId: agentWorkspaceCategoryForPanel(registration.id),
      command: agentWorkspaceCommandForPanel(registration.id),
    },
    policy: {
      effect: 'ui-navigation',
      confirmation: 'agent_harness mode:"open_panel" requires confirm:true and explicitUserRequest.',
      boundary: 'Panels are Agent/TUI operator views. The model can inspect panel catalog/open state; panel routing uses the existing Agent workspace bridge and does not mutate connected-host lifecycle.',
    },
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
  return manager.getRegisteredTypes()
    .map((registration) => describePanelRegistration(context, registration))
    .filter((panel) => !category || panel.category === category)
    .filter((panel) => panelMatches(panel, query))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .slice(0, limit);
}

export function describeHarnessPanel(context: CommandContext, args: AgentHarnessPanelArgs): Record<string, unknown> | null {
  const manager = panelManager(context);
  if (!manager) return null;
  const panelId = readString(args.panelId || args.query);
  if (!panelId) return null;
  const registration = manager.getRegisteredTypes().find((panel) => (
    panel.id === panelId
    || panel.name.toLowerCase() === panelId.toLowerCase()
  ));
  return registration ? describePanelRegistration(context, registration) : null;
}

export function openHarnessPanel(context: CommandContext, args: AgentHarnessPanelArgs): Record<string, unknown> {
  const panel = describeHarnessPanel(context, args);
  if (!panel) {
    return {
      status: 'unknown_panel',
      panelId: readString(args.panelId || args.query) || '<missing>',
      availablePanels: listHarnessPanels(context, { limit: 50 }).map((entry) => entry.id),
    };
  }
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
    note: 'Panel routing was handed to the current Agent shell bridge.',
  };
}
