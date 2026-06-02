import type { AgentWorkspaceAction, AgentWorkspaceCategory, AgentWorkspaceFocusPane } from './agent-workspace-types.ts';

interface AgentWorkspaceNavigationHost {
  readonly categories: readonly AgentWorkspaceCategory[];
  readonly actions: readonly AgentWorkspaceAction[];
  focusPane: AgentWorkspaceFocusPane;
  selectedCategoryIndex: number;
  selectedActionIndex: number;
  clampSelection(): void;
}

export function moveAgentWorkspaceSelection(host: AgentWorkspaceNavigationHost, delta: -1 | 1): void {
  if (host.focusPane === 'categories') {
    host.selectedCategoryIndex = Math.max(0, Math.min(host.categories.length - 1, host.selectedCategoryIndex + delta));
    host.selectedActionIndex = 0;
  } else {
    host.selectedActionIndex = Math.max(0, Math.min(host.actions.length - 1, host.selectedActionIndex + delta));
  }
  host.clampSelection();
}

export function jumpAgentWorkspaceSelection(host: AgentWorkspaceNavigationHost, target: 'home' | 'end'): void {
  if (host.focusPane === 'categories') {
    host.selectedCategoryIndex = target === 'home' ? 0 : host.categories.length - 1;
  } else {
    host.selectedActionIndex = target === 'home' ? 0 : host.actions.length - 1;
  }
  host.clampSelection();
}

export function selectAgentWorkspaceCategory(host: AgentWorkspaceNavigationHost, categoryIdOrLabel: string): boolean {
  const normalized = categoryIdOrLabel.trim().toLowerCase();
  if (!normalized) return false;
  const categoryIndex = host.categories.findIndex((category) =>
    category.id.toLowerCase() === normalized
    || category.label.toLowerCase() === normalized
    || category.label.toLowerCase().replace(/[^a-z0-9]+/g, '-') === normalized
  );
  if (categoryIndex < 0) return false;
  host.selectedCategoryIndex = categoryIndex;
  host.selectedActionIndex = 0;
  host.focusPane = 'actions';
  host.clampSelection();
  return true;
}
