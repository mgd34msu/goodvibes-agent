import type {
  AgentWorkspaceActionResult,
  AgentWorkspaceActionSearchResult,
  AgentWorkspaceCategory,
  AgentWorkspaceFocusPane,
} from './agent-workspace-types.ts';

export interface AgentWorkspaceSearchHost {
  readonly categories: readonly AgentWorkspaceCategory[];
  readonly selectedCategory: AgentWorkspaceCategory;
  actionSearchActive: boolean;
  actionSearchQuery: string;
  focusPane: AgentWorkspaceFocusPane;
  selectedCategoryIndex: number;
  selectedActionIndex: number;
  status: string;
  lastActionResult: AgentWorkspaceActionResult | null;
  focusActions(): void;
  clampSelection(): void;
}

export function searchAgentWorkspaceActions(
  categories: readonly AgentWorkspaceCategory[],
  query: string,
): readonly AgentWorkspaceActionSearchResult[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const terms = normalized.split(/\s+/).filter(Boolean);
  const results: AgentWorkspaceActionSearchResult[] = [];
  categories.forEach((category, categoryIndex) => {
    category.actions.forEach((action, actionIndex) => {
      const haystack = [
        category.id,
        category.label,
        category.summary,
        category.detail,
        action.id,
        action.label,
        action.detail,
        action.command ?? '',
        action.editorKind ?? '',
        action.targetCategoryId ?? '',
        action.localOperation ?? '',
        action.safety,
      ].join(' ').toLowerCase();
      if (terms.every((term) => haystack.includes(term))) {
        results.push({ category, categoryIndex, action, actionIndex });
      }
    });
  });
  return results;
}

export function beginAgentWorkspaceActionSearch(host: AgentWorkspaceSearchHost): void {
  host.actionSearchActive = true;
  host.actionSearchQuery = '';
  host.focusPane = 'actions';
  host.selectedActionIndex = 0;
  host.status = 'Search Agent workspace actions.';
  host.lastActionResult = {
    kind: 'guidance',
    title: 'Action search',
    detail: 'Type to filter every Agent workspace action. Enter opens the selected result; Esc clears search.',
    safety: 'safe',
  };
}

export function appendAgentWorkspaceActionSearchText(host: AgentWorkspaceSearchHost, text: string): void {
  if (!host.actionSearchActive || text.length === 0) return;
  host.actionSearchQuery += text.replace(/[\r\n]+/g, ' ');
  host.selectedActionIndex = 0;
  host.status = actionSearchStatus(host);
  host.clampSelection();
}

export function backspaceAgentWorkspaceActionSearch(host: AgentWorkspaceSearchHost): void {
  if (!host.actionSearchActive || host.actionSearchQuery.length === 0) return;
  const chars = Array.from(host.actionSearchQuery);
  chars.pop();
  host.actionSearchQuery = chars.join('');
  host.selectedActionIndex = 0;
  host.status = host.actionSearchQuery.length === 0 ? 'Search Agent workspace actions.' : actionSearchStatus(host);
  host.clampSelection();
}

export function clearAgentWorkspaceActionSearch(host: AgentWorkspaceSearchHost): void {
  if (!host.actionSearchActive) return;
  host.actionSearchActive = false;
  host.actionSearchQuery = '';
  host.selectedActionIndex = Math.max(0, Math.min(host.selectedActionIndex, host.selectedCategory.actions.length - 1));
  host.status = 'Action search cleared.';
  host.clampSelection();
}

export function commitAgentWorkspaceActionSearchSelection(
  host: AgentWorkspaceSearchHost,
  result: AgentWorkspaceActionSearchResult | null,
): boolean {
  if (!host.actionSearchActive) return true;
  if (!result) {
    host.status = host.actionSearchQuery.trim().length === 0
      ? 'Type a search query before opening an action.'
      : `No Agent workspace actions match "${host.actionSearchQuery}".`;
    host.lastActionResult = {
      kind: 'guidance',
      title: 'No action selected',
      detail: 'Type a different search query or press Esc to return to normal workspace navigation.',
      safety: 'safe',
    };
    return false;
  }
  host.selectedCategoryIndex = result.categoryIndex;
  host.selectedActionIndex = result.actionIndex;
  host.actionSearchActive = false;
  host.actionSearchQuery = '';
  host.focusActions();
  host.clampSelection();
  return true;
}

function actionSearchStatus(host: AgentWorkspaceSearchHost): string {
  const count = searchAgentWorkspaceActions(host.categories, host.actionSearchQuery).length;
  return count === 0
    ? `No Agent workspace actions match "${host.actionSearchQuery}".`
    : `Found ${count} Agent workspace action(s) for "${host.actionSearchQuery}".`;
}
