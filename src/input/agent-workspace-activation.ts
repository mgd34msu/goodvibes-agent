import { createLocalEditor, createProfileEditor } from './agent-workspace-editors.ts';
import { createRoutineScheduleEditor } from './agent-workspace-routine-schedule-editor.ts';
import { parseSlashCommand } from './slash-command-parser.ts';
import type {
  AgentWorkspaceActionResult,
  AgentWorkspaceCategory,
  AgentWorkspaceCommandDispatcher,
  AgentWorkspaceFocusPane,
  AgentWorkspaceLocalEditor,
  AgentWorkspaceLocalEditorKind,
  AgentWorkspaceLocalLibraryItem,
  AgentWorkspaceLocalOperation,
  AgentWorkspaceRuntimeSnapshot,
} from './agent-workspace-types.ts';

interface AgentWorkspaceActivationHost {
  readonly categories: readonly AgentWorkspaceCategory[];
  readonly selectedCategory: AgentWorkspaceCategory;
  readonly selectedAction: AgentWorkspaceCategory['actions'][number] | null;
  readonly runtimeSnapshot: AgentWorkspaceRuntimeSnapshot | null;
  localEditor: AgentWorkspaceLocalEditor | null;
  focusPane: AgentWorkspaceFocusPane;
  selectedCategoryIndex: number;
  selectedActionIndex: number;
  status: string;
  lastActionResult: AgentWorkspaceActionResult | null;
  submitEditorFieldOrForm(requestRender?: () => void): void;
  focusActions(): void;
  clampSelection(): void;
  moveLocalLibraryItemSelection(kind: AgentWorkspaceLocalEditorKind, delta: number): void;
  selectedLocalLibraryItem(kind: AgentWorkspaceLocalEditorKind): AgentWorkspaceLocalLibraryItem | null;
  applyLocalLibraryOperation(operation: AgentWorkspaceLocalOperation): void;
  hasCommandDispatch(): boolean;
  dispatchWorkspaceCommand: AgentWorkspaceCommandDispatcher;
}

export function activateAgentWorkspaceSelection(
  workspace: AgentWorkspaceActivationHost,
  requestRender?: () => void,
): void {
  if (workspace.localEditor) {
    workspace.submitEditorFieldOrForm(requestRender);
    return;
  }
  if (workspace.focusPane === 'categories') {
    workspace.focusActions();
    return;
  }
  const action = workspace.selectedAction;
  if (!action) return;
  if (action.kind === 'editor' && action.editorKind) {
    workspace.localEditor = createWorkspaceEditor(workspace, action.editorKind);
    workspace.status = `Editing ${workspace.localEditor.title}.`;
    workspace.lastActionResult = {
      kind: 'guidance',
      title: workspace.localEditor.title,
      detail: workspace.localEditor.message,
      safety: action.safety,
    };
    return;
  }
  if (action.kind === 'local-selection' && action.localKind) {
    workspace.moveLocalLibraryItemSelection(action.localKind, action.selectionDelta ?? 0);
    return;
  }
  if (action.kind === 'local-operation' && action.localOperation) {
    workspace.applyLocalLibraryOperation(action.localOperation);
    return;
  }
  if (action.kind === 'guidance' || !action.command) {
    handleGuidanceOrWorkspaceAction(workspace, action);
    return;
  }
  if (action.safety === 'blocked') {
    workspace.status = `Blocked here: ${action.label}.`;
    workspace.lastActionResult = {
      kind: 'blocked',
      title: `${action.label} is blocked in Agent`,
      detail: action.detail,
      command: action.command,
      safety: action.safety,
    };
    return;
  }
  const parsed = parseSlashCommand(action.command);
  if (!parsed.name) {
    workspace.status = `No command is configured for ${action.label}.`;
    workspace.lastActionResult = {
      kind: 'error',
      title: 'Command unavailable',
      detail: `No command is configured for ${action.label}.`,
      safety: action.safety,
    };
    return;
  }
  if (/<[^>\s]+(?:\s+[^>]*)?>/.test(action.command)) {
    workspace.status = `Placeholder command not dispatched: ${action.command}.`;
    workspace.lastActionResult = {
      kind: 'guidance',
      title: `${action.label} needs details`,
      detail: 'This action is a command template. Close the workspace and run it with real task text instead of placeholder values.',
      command: action.command,
      safety: action.safety,
    };
    return;
  }
  if (!workspace.hasCommandDispatch()) {
    workspace.status = `Command dispatch is not available for ${action.command}.`;
    workspace.lastActionResult = {
      kind: 'error',
      title: 'Command dispatch unavailable',
      detail: `The command ${action.command} cannot be opened from this runtime.`,
      command: action.command,
      safety: action.safety,
    };
    return;
  }
  workspace.status = `Opening ${action.command}.`;
  workspace.lastActionResult = {
    kind: 'dispatched',
    title: `Opening ${action.label}`,
    detail: 'The workspace handed this safe or read-only command to the shell-owned command router.',
    command: action.command,
    safety: action.safety,
  };
  workspace.dispatchWorkspaceCommand(action.command);
}

function createWorkspaceEditor(
  workspace: AgentWorkspaceActivationHost,
  editorKind: AgentWorkspaceCategory['actions'][number]['editorKind'],
): AgentWorkspaceLocalEditor {
  if (editorKind === 'profile') return createProfileEditor(workspace.runtimeSnapshot?.runtimeStarterTemplates ?? []);
  if (editorKind === 'routine-schedule') return createRoutineScheduleEditor(workspace.selectedLocalLibraryItem('routine'));
  return createLocalEditor(editorKind ?? 'memory');
}

function handleGuidanceOrWorkspaceAction(
  workspace: AgentWorkspaceActivationHost,
  action: AgentWorkspaceCategory['actions'][number],
): void {
  if (action.kind === 'workspace' && action.targetCategoryId) {
    const targetIndex = workspace.categories.findIndex((category) => category.id === action.targetCategoryId);
    if (targetIndex >= 0) {
      workspace.selectedCategoryIndex = targetIndex;
      workspace.selectedActionIndex = 0;
      workspace.focusActions();
      workspace.status = `Opened ${workspace.selectedCategory.label}.`;
      workspace.lastActionResult = {
        kind: 'refreshed',
        title: `Opened ${workspace.selectedCategory.label}`,
        detail: action.detail,
        safety: action.safety,
      };
      workspace.clampSelection();
      return;
    }
    workspace.status = `Workspace area unavailable: ${action.targetCategoryId}.`;
    workspace.lastActionResult = {
      kind: 'error',
      title: 'Workspace area unavailable',
      detail: `No Agent workspace category exists for ${action.targetCategoryId}.`,
      safety: action.safety,
    };
    return;
  }
  workspace.status = action.detail;
  workspace.lastActionResult = {
    kind: 'guidance',
    title: action.label,
    detail: action.detail,
    safety: action.safety,
  };
}
