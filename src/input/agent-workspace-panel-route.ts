import type { AgentWorkspaceCategoryId } from './agent-workspace-types.ts';

const PANEL_CATEGORY_ROUTES = {
  knowledge: 'knowledge',
  memory: 'memory',
  'work-plan': 'work',
  'project-planning': 'work',
  plan: 'work',
  approval: 'work',
  tasks: 'work',
  'provider-health': 'setup',
  automation: 'automation',
  schedule: 'automation',
  providers: 'setup',
  accounts: 'setup',
  subscription: 'setup',
  cost: 'setup',
  tokens: 'setup',
  security: 'tools',
  policy: 'tools',
  tools: 'tools',
  'qr-code': 'channels',
  sessions: 'conversation',
  context: 'conversation',
  thinking: 'conversation',
  'system-messages': 'conversation',
  docs: 'home',
  'panel-list': 'home',
} as const satisfies Readonly<Record<string, AgentWorkspaceCategoryId>>;

type AgentWorkspacePanelRouteId = keyof typeof PANEL_CATEGORY_ROUTES;

function hasPanelCategoryRoute(panelId: string): panelId is AgentWorkspacePanelRouteId {
  return Object.prototype.hasOwnProperty.call(PANEL_CATEGORY_ROUTES, panelId);
}

export function agentWorkspaceCategoryForPanel(panelId: string): AgentWorkspaceCategoryId {
  return hasPanelCategoryRoute(panelId) ? PANEL_CATEGORY_ROUTES[panelId] : 'home';
}

export function agentWorkspaceCommandForPanel(panelId: string): string {
  return `/agent ${agentWorkspaceCategoryForPanel(panelId)}`;
}
