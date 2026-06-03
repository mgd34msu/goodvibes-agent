export function agentWorkspaceCategoryForPanel(panelId: string): string {
  if (panelId === 'knowledge') return 'knowledge';
  if (panelId === 'memory') return 'memory';
  if (panelId === 'work-plan' || panelId === 'project-planning' || panelId === 'tasks' || panelId === 'approval') return 'work';
  if (panelId === 'automation' || panelId === 'schedule') return 'automation';
  if (panelId === 'provider-health' || panelId === 'providers' || panelId === 'accounts' || panelId === 'subscription' || panelId === 'cost' || panelId === 'tokens') return 'setup';
  if (panelId === 'security' || panelId === 'policy' || panelId === 'tools') return 'tools';
  if (panelId === 'qr-code') return 'channels';
  if (panelId === 'sessions' || panelId === 'context' || panelId === 'thinking' || panelId === 'system-messages') return 'conversation';
  return 'home';
}

export function agentWorkspaceCommandForPanel(panelId: string): string {
  return `/agent ${agentWorkspaceCategoryForPanel(panelId)}`;
}
