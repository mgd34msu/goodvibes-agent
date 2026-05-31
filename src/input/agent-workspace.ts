import type { InputToken } from '@pellux/goodvibes-sdk/platform/core';
import type { ShellPathService } from '@/runtime/index.ts';
import type { CommandContext } from './command-registry.ts';
import { AgentPersonaRegistry } from '../agent/persona-registry.ts';
import { AgentRoutineRegistry } from '../agent/routine-registry.ts';
import { AgentSkillRegistry } from '../agent/skill-registry.ts';
import { AGENT_WORKSPACE_CATEGORIES } from './agent-workspace-categories.ts';
import { createDeleteEditor, createLocalEditor, createPersonaUpdateEditor, createRoutineUpdateEditor, createSkillUpdateEditor, editorCategoryId, isAffirmative, splitList } from './agent-workspace-editors.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from './agent-workspace-snapshot.ts';
import type { AgentWorkspaceAction, AgentWorkspaceActionResult, AgentWorkspaceCategory, AgentWorkspaceCommandDispatcher, AgentWorkspaceEditorField, AgentWorkspaceFocusPane, AgentWorkspaceLocalEditor, AgentWorkspaceLocalEditorKind, AgentWorkspaceLocalLibraryItem, AgentWorkspaceLocalOperation, AgentWorkspaceRuntimeSnapshot } from './agent-workspace-types.ts';

export type { AgentWorkspaceChannelRisk, AgentWorkspaceChannelStatus } from './agent-workspace-channels.ts';
export type {
  AgentWorkspaceAction,
  AgentWorkspaceActionResult,
  AgentWorkspaceCategory,
  AgentWorkspaceCommandDispatcher,
  AgentWorkspaceEditorField,
  AgentWorkspaceFocusPane,
  AgentWorkspaceLocalEditor,
  AgentWorkspaceLocalEditorKind,
  AgentWorkspaceLocalLibraryItem,
  AgentWorkspaceLocalOperation,
  AgentWorkspaceRuntimeSnapshot,
} from './agent-workspace-types.ts';
export { AGENT_WORKSPACE_MODAL_NAME } from './agent-workspace-types.ts';
export { buildAgentWorkspaceRuntimeSnapshot } from './agent-workspace-snapshot.ts';

function parseCommand(command: string): { readonly name: string; readonly args: readonly string[] } {
  const trimmed = command.trim().replace(/^\//, '');
  if (!trimmed) return { name: '', args: [] };
  const parts = trimmed.split(/\s+/);
  return { name: parts[0] ?? '', args: parts.slice(1) };
}

export class AgentWorkspace {
  public active = false;
  public focusPane: AgentWorkspaceFocusPane = 'actions';
  public selectedCategoryIndex = 0;
  public selectedActionIndex = 0;
  public status = 'Ready. Choose an operator flow; ordinary assistant work stays in the main conversation.';
  public runtimeSnapshot: AgentWorkspaceRuntimeSnapshot | null = null;
  public lastActionResult: AgentWorkspaceActionResult | null = null;
  public localEditor: AgentWorkspaceLocalEditor | null = null;
  private readonly selectedLibraryItemIndexes: Record<AgentWorkspaceLocalEditorKind, number> = {
    persona: 0,
    skill: 0,
    routine: 0,
  };
  private context: CommandContext | null = null;
  private dispatchCommand: AgentWorkspaceCommandDispatcher | null = null;

  open(context: CommandContext, dispatchCommand: AgentWorkspaceCommandDispatcher): void {
    this.context = context;
    this.dispatchCommand = dispatchCommand;
    this.runtimeSnapshot = buildAgentWorkspaceRuntimeSnapshot(context);
    this.active = true;
    this.focusPane = 'actions';
    this.status = 'Ready. Choose an operator flow; ordinary assistant work stays in the main conversation.';
    this.lastActionResult = null;
    this.localEditor = null;
    this.clampSelection();
  }

  reopen(): void {
    this.active = true;
    this.clampSelection();
  }

  close(): void {
    this.active = false;
    this.localEditor = null;
  }

  get categories(): readonly AgentWorkspaceCategory[] {
    return AGENT_WORKSPACE_CATEGORIES;
  }

  get selectedCategory(): AgentWorkspaceCategory {
    return this.categories[this.selectedCategoryIndex] ?? this.categories[0]!;
  }

  get actions(): readonly AgentWorkspaceAction[] {
    return this.selectedCategory.actions;
  }

  get selectedAction(): AgentWorkspaceAction | null {
    return this.actions[this.selectedActionIndex] ?? null;
  }

  selectedLocalLibraryItem(kind: AgentWorkspaceLocalEditorKind): AgentWorkspaceLocalLibraryItem | null {
    const items = this.localLibraryItems(kind);
    if (items.length === 0) return null;
    const index = Math.max(0, Math.min(this.selectedLibraryItemIndexes[kind], items.length - 1));
    return items[index] ?? null;
  }

  focusCategories(): void {
    this.focusPane = 'categories';
  }

  focusActions(): void {
    this.focusPane = 'actions';
  }

  toggleFocusPane(): void {
    this.focusPane = this.focusPane === 'categories' ? 'actions' : 'categories';
  }

  moveUp(): void {
    if (this.focusPane === 'categories') {
      this.selectedCategoryIndex = Math.max(0, this.selectedCategoryIndex - 1);
      this.selectedActionIndex = 0;
    } else {
      this.selectedActionIndex = Math.max(0, this.selectedActionIndex - 1);
    }
    this.clampSelection();
  }

  moveDown(): void {
    if (this.focusPane === 'categories') {
      this.selectedCategoryIndex = Math.min(this.categories.length - 1, this.selectedCategoryIndex + 1);
      this.selectedActionIndex = 0;
    } else {
      this.selectedActionIndex = Math.min(this.actions.length - 1, this.selectedActionIndex + 1);
    }
    this.clampSelection();
  }

  jumpHome(): void {
    if (this.focusPane === 'categories') this.selectedCategoryIndex = 0;
    else this.selectedActionIndex = 0;
    this.clampSelection();
  }

  jumpEnd(): void {
    if (this.focusPane === 'categories') this.selectedCategoryIndex = this.categories.length - 1;
    else this.selectedActionIndex = this.actions.length - 1;
    this.clampSelection();
  }

  refreshRuntimeSnapshot(): void {
    if (!this.context) {
      this.status = 'Runtime context is unavailable.';
      this.lastActionResult = {
        kind: 'error',
        title: 'Context refresh failed',
        detail: 'The Agent workspace has no command context to inspect.',
      };
      return;
    }
    this.runtimeSnapshot = buildAgentWorkspaceRuntimeSnapshot(this.context);
    this.status = 'Runtime context refreshed.';
    this.lastActionResult = {
      kind: 'refreshed',
      title: 'Runtime context refreshed',
      detail: 'Provider, model, session, local memory, daemon URL, and Agent knowledge route posture were re-read from the live command context.',
    };
  }

  cancelLocalEditor(): void {
    if (!this.localEditor) return;
    const title = this.localEditor.title;
    this.localEditor = null;
    this.status = `${title} cancelled.`;
    this.lastActionResult = {
      kind: 'guidance',
      title: `${title} cancelled`,
      detail: 'No local Agent registry changes were written.',
    };
  }

  moveEditorField(delta: number): void {
    const editor = this.localEditor;
    if (!editor) return;
    const nextIndex = Math.max(0, Math.min(editor.fields.length - 1, editor.selectedFieldIndex + delta));
    this.localEditor = { ...editor, selectedFieldIndex: nextIndex };
  }

  appendEditorText(text: string): void {
    const editor = this.localEditor;
    if (!editor || text.length === 0) return;
    const field = editor.fields[editor.selectedFieldIndex];
    if (!field) return;
    this.replaceEditorField(editor.selectedFieldIndex, `${field.value}${text}`, editor.message);
  }

  appendEditorNewline(): void {
    const editor = this.localEditor;
    if (!editor) return;
    const field = editor.fields[editor.selectedFieldIndex];
    if (!field || !field.multiline) {
      this.moveEditorField(1);
      return;
    }
    this.replaceEditorField(editor.selectedFieldIndex, `${field.value}\n`, editor.message);
  }

  editorBackspace(): void {
    const editor = this.localEditor;
    if (!editor) return;
    const field = editor.fields[editor.selectedFieldIndex];
    if (!field || field.value.length === 0) return;
    const characters = Array.from(field.value);
    characters.pop();
    this.replaceEditorField(editor.selectedFieldIndex, characters.join(''), editor.message);
  }

  submitEditorFieldOrForm(): void {
    const editor = this.localEditor;
    if (!editor) return;
    if (editor.selectedFieldIndex < editor.fields.length - 1) {
      this.moveEditorField(1);
      return;
    }
    this.submitLocalEditor();
  }

  activateSelected(): void {
    if (this.localEditor) {
      this.submitEditorFieldOrForm();
      return;
    }
    if (this.focusPane === 'categories') {
      this.focusActions();
      return;
    }
    const action = this.selectedAction;
    if (!action) return;
    if (action.kind === 'editor' && action.editorKind) {
      this.localEditor = createLocalEditor(action.editorKind);
      this.status = `Editing ${this.localEditor.title}.`;
      this.lastActionResult = {
        kind: 'guidance',
        title: this.localEditor.title,
        detail: this.localEditor.message,
        safety: action.safety,
      };
      return;
    }
    if (action.kind === 'local-selection' && action.localKind) {
      this.moveLocalLibraryItemSelection(action.localKind, action.selectionDelta ?? 0);
      return;
    }
    if (action.kind === 'local-operation' && action.localOperation) {
      this.applyLocalLibraryOperation(action.localOperation);
      return;
    }
    if (action.kind === 'guidance' || !action.command) {
      if (action.kind === 'workspace' && action.targetCategoryId) {
        const targetIndex = this.categories.findIndex((category) => category.id === action.targetCategoryId);
        if (targetIndex >= 0) {
          this.selectedCategoryIndex = targetIndex;
          this.selectedActionIndex = 0;
          this.focusActions();
          this.status = `Opened ${this.selectedCategory.label}.`;
          this.lastActionResult = {
            kind: 'refreshed',
            title: `Opened ${this.selectedCategory.label}`,
            detail: action.detail,
            safety: action.safety,
          };
          this.clampSelection();
          return;
        }
        this.status = `Workspace area unavailable: ${action.targetCategoryId}.`;
        this.lastActionResult = {
          kind: 'error',
          title: 'Workspace area unavailable',
          detail: `No Agent workspace category exists for ${action.targetCategoryId}.`,
          safety: action.safety,
        };
        return;
      }
      this.status = action.detail;
      this.lastActionResult = {
        kind: 'guidance',
        title: action.label,
        detail: action.detail,
        safety: action.safety,
      };
      return;
    }
    if (action.safety === 'blocked') {
      this.status = `Blocked here: ${action.label}.`;
      this.lastActionResult = {
        kind: 'blocked',
        title: `${action.label} is blocked in Agent`,
        detail: action.detail,
        command: action.command,
        safety: action.safety,
      };
      return;
    }
    const parsed = parseCommand(action.command);
    if (!parsed.name) {
      this.status = `No command is configured for ${action.label}.`;
      this.lastActionResult = {
        kind: 'error',
        title: 'Command unavailable',
        detail: `No command is configured for ${action.label}.`,
        safety: action.safety,
      };
      return;
    }
    if (/<[^>\s]+(?:\s+[^>]*)?>/.test(action.command)) {
      this.status = `Placeholder command not dispatched: ${action.command}.`;
      this.lastActionResult = {
        kind: 'guidance',
        title: `${action.label} needs details`,
        detail: 'This action is a command template. Close the workspace and run it with real task text instead of placeholder values.',
        command: action.command,
        safety: action.safety,
      };
      return;
    }
    if (!this.context?.executeCommand || !this.dispatchCommand) {
      this.status = `Command dispatch is not available for ${action.command}.`;
      this.lastActionResult = {
        kind: 'error',
        title: 'Command dispatch unavailable',
        detail: `The command ${action.command} cannot be opened from this runtime.`,
        command: action.command,
        safety: action.safety,
      };
      return;
    }
    this.status = `Opening ${action.command}.`;
    this.lastActionResult = {
      kind: 'dispatched',
      title: `Opening ${action.label}`,
      detail: 'The workspace handed this safe or read-only command to the shell-owned command router.',
      command: action.command,
      safety: action.safety,
    };
    this.dispatchCommand(action.command);
  }

  private clampSelection(): void {
    this.selectedCategoryIndex = Math.max(0, Math.min(this.selectedCategoryIndex, this.categories.length - 1));
    this.selectedActionIndex = Math.max(0, Math.min(this.selectedActionIndex, this.actions.length - 1));
    this.clampLocalLibrarySelection('persona');
    this.clampLocalLibrarySelection('skill');
    this.clampLocalLibrarySelection('routine');
  }

  private localLibraryItems(kind: AgentWorkspaceLocalEditorKind): readonly AgentWorkspaceLocalLibraryItem[] {
    if (kind === 'persona') return this.runtimeSnapshot?.localPersonas ?? [];
    if (kind === 'skill') return this.runtimeSnapshot?.localSkills ?? [];
    return this.runtimeSnapshot?.localRoutines ?? [];
  }

  private clampLocalLibrarySelection(kind: AgentWorkspaceLocalEditorKind): void {
    const length = this.localLibraryItems(kind).length;
    this.selectedLibraryItemIndexes[kind] = length === 0
      ? 0
      : Math.max(0, Math.min(this.selectedLibraryItemIndexes[kind], length - 1));
  }

  private moveLocalLibraryItemSelection(kind: AgentWorkspaceLocalEditorKind, delta: number): void {
    const items = this.localLibraryItems(kind);
    if (items.length === 0) {
      this.status = `No local ${kind} records to select.`;
      this.lastActionResult = {
        kind: 'guidance',
        title: `No ${kind} records`,
        detail: `Create a local ${kind} before using selection actions.`,
        safety: 'safe',
      };
      return;
    }
    this.selectedLibraryItemIndexes[kind] = Math.max(0, Math.min(items.length - 1, this.selectedLibraryItemIndexes[kind] + delta));
    const selected = this.selectedLocalLibraryItem(kind);
    this.status = selected ? `Selected ${kind}: ${selected.name}.` : `Selected ${kind} updated.`;
    this.lastActionResult = {
      kind: 'guidance',
      title: selected ? `Selected ${selected.name}` : `Selected ${kind}`,
      detail: selected ? `${selected.name} (${selected.id}) is now the selected local ${kind}.` : `Selection changed for ${kind}.`,
      safety: 'safe',
    };
  }

  private applyLocalLibraryOperation(operation: AgentWorkspaceLocalOperation): void {
    const shellPaths = this.context?.workspace?.shellPaths;
    if (!shellPaths) {
      this.status = 'Local Agent registry files are unavailable.';
      this.lastActionResult = {
        kind: 'error',
        title: 'Local registry unavailable',
        detail: 'The Agent workspace cannot locate the Agent-local registry files for this runtime.',
      };
      return;
    }
    try {
      if (operation === 'persona-clear') {
        AgentPersonaRegistry.fromShellPaths(shellPaths).clearActive();
        this.finishLocalOperation('persona', 'Cleared active persona', 'The default Agent policy will apply to future turns.');
        return;
      }
      const selected = this.selectedItemForOperation(operation);
      if (!selected) {
        this.status = 'No selected local registry item.';
        this.lastActionResult = {
          kind: 'guidance',
          title: 'Nothing selected',
          detail: 'Create or select a local library item before running this action.',
          safety: 'safe',
        };
        return;
      }
      if (operation === 'persona-edit') {
        const registry = AgentPersonaRegistry.fromShellPaths(shellPaths);
        const persona = registry.get(selected.id);
        if (!persona) throw new Error(`Unknown persona: ${selected.id}`);
        this.localEditor = createPersonaUpdateEditor(persona, registry.snapshot().activePersonaId === persona.id);
        this.status = `Editing persona: ${persona.name}.`;
        this.lastActionResult = {
          kind: 'guidance',
          title: this.localEditor.title,
          detail: this.localEditor.message,
          safety: 'safe',
        };
      } else if (operation === 'persona-use') {
        AgentPersonaRegistry.fromShellPaths(shellPaths).setActive(selected.id);
        this.finishLocalOperation('persona', `Using persona ${selected.name}`, `${selected.name} will shape future main-conversation turns.`);
      } else if (operation === 'persona-review') {
        AgentPersonaRegistry.fromShellPaths(shellPaths).markReviewed(selected.id);
        this.finishLocalOperation('persona', `Reviewed persona ${selected.name}`, `${selected.name} is marked reviewed.`);
      } else if (operation === 'persona-delete') {
        this.openDeleteEditor('persona', selected);
      } else if (operation === 'skill-edit') {
        const skill = AgentSkillRegistry.fromShellPaths(shellPaths).get(selected.id);
        if (!skill) throw new Error(`Unknown skill: ${selected.id}`);
        this.localEditor = createSkillUpdateEditor(skill);
        this.status = `Editing skill: ${skill.name}.`;
        this.lastActionResult = {
          kind: 'guidance',
          title: this.localEditor.title,
          detail: this.localEditor.message,
          safety: 'safe',
        };
      } else if (operation === 'skill-enable') {
        AgentSkillRegistry.fromShellPaths(shellPaths).setEnabled(selected.id, true);
        this.finishLocalOperation('skill', `Enabled skill ${selected.name}`, `${selected.name} can now inform main-conversation turns.`);
      } else if (operation === 'skill-disable') {
        AgentSkillRegistry.fromShellPaths(shellPaths).setEnabled(selected.id, false);
        this.finishLocalOperation('skill', `Disabled skill ${selected.name}`, `${selected.name} remains saved but is no longer injected into guidance.`);
      } else if (operation === 'skill-review') {
        AgentSkillRegistry.fromShellPaths(shellPaths).markReviewed(selected.id);
        this.finishLocalOperation('skill', `Reviewed skill ${selected.name}`, `${selected.name} is marked reviewed.`);
      } else if (operation === 'skill-delete') {
        this.openDeleteEditor('skill', selected);
      } else if (operation === 'routine-edit') {
        const routine = AgentRoutineRegistry.fromShellPaths(shellPaths).get(selected.id);
        if (!routine) throw new Error(`Unknown routine: ${selected.id}`);
        this.localEditor = createRoutineUpdateEditor(routine);
        this.status = `Editing routine: ${routine.name}.`;
        this.lastActionResult = {
          kind: 'guidance',
          title: this.localEditor.title,
          detail: this.localEditor.message,
          safety: 'safe',
        };
      } else if (operation === 'routine-start') {
        AgentRoutineRegistry.fromShellPaths(shellPaths).markStarted(selected.id);
        this.finishLocalOperation('routine', `Started routine ${selected.name}`, `${selected.name} was marked started for this main-conversation workflow. No hidden job was created.`);
      } else if (operation === 'routine-enable') {
        AgentRoutineRegistry.fromShellPaths(shellPaths).setEnabled(selected.id, true);
        this.finishLocalOperation('routine', `Enabled routine ${selected.name}`, `${selected.name} can now inform main-conversation turns.`);
      } else if (operation === 'routine-disable') {
        AgentRoutineRegistry.fromShellPaths(shellPaths).setEnabled(selected.id, false);
        this.finishLocalOperation('routine', `Disabled routine ${selected.name}`, `${selected.name} remains saved but is no longer injected into guidance.`);
      } else if (operation === 'routine-review') {
        AgentRoutineRegistry.fromShellPaths(shellPaths).markReviewed(selected.id);
        this.finishLocalOperation('routine', `Reviewed routine ${selected.name}`, `${selected.name} is marked reviewed.`);
      } else {
        this.openDeleteEditor('routine', selected);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.status = detail;
      this.lastActionResult = {
        kind: 'error',
        title: 'Local registry action failed',
        detail,
      };
    }
  }

  private selectedItemForOperation(operation: AgentWorkspaceLocalOperation): AgentWorkspaceLocalLibraryItem | null {
    if (operation.startsWith('persona-')) return this.selectedLocalLibraryItem('persona');
    if (operation.startsWith('skill-')) return this.selectedLocalLibraryItem('skill');
    return this.selectedLocalLibraryItem('routine');
  }

  private finishLocalOperation(kind: AgentWorkspaceLocalEditorKind, title: string, detail: string): void {
    this.runtimeSnapshot = this.context ? buildAgentWorkspaceRuntimeSnapshot(this.context) : this.runtimeSnapshot;
    this.clampLocalLibrarySelection(kind);
    this.status = title;
    this.lastActionResult = {
      kind: 'refreshed',
      title,
      detail,
      safety: 'safe',
    };
  }

  private openDeleteEditor(kind: AgentWorkspaceLocalEditorKind, selected: AgentWorkspaceLocalLibraryItem): void {
    this.localEditor = createDeleteEditor(kind, selected);
    this.status = `Confirm deletion for ${selected.name}.`;
    this.lastActionResult = {
      kind: 'guidance',
      title: this.localEditor.title,
      detail: this.localEditor.message,
      safety: 'safe',
    };
  }

  private replaceEditorField(index: number, value: string, message: string): void {
    const editor = this.localEditor;
    if (!editor) return;
    const fields = editor.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, value } : field);
    this.localEditor = { ...editor, fields, message };
  }

  private editorField(id: string): string {
    const editor = this.localEditor;
    return editor?.fields.find((field) => field.id === id)?.value.trim() ?? '';
  }

  private missingEditorField(): AgentWorkspaceEditorField | null {
    const editor = this.localEditor;
    if (!editor) return null;
    return editor.fields.find((field) => field.required && field.value.trim().length === 0) ?? null;
  }

  private submitLocalEditor(): void {
    const editor = this.localEditor;
    if (!editor) return;
    const missing = this.missingEditorField();
    if (missing) {
      const missingIndex = editor.fields.findIndex((field) => field.id === missing.id);
      this.localEditor = {
        ...editor,
        selectedFieldIndex: Math.max(0, missingIndex),
        message: `${missing.label} is required before saving.`,
      };
      this.status = `${missing.label} is required.`;
      return;
    }
    const shellPaths = this.context?.workspace?.shellPaths;
    if (!shellPaths) {
      this.localEditor = { ...editor, message: 'Cannot save because Agent shell paths are unavailable.' };
      this.status = 'Cannot save local Agent registry item without shell paths.';
      this.lastActionResult = {
        kind: 'error',
        title: 'Local registry unavailable',
        detail: 'The Agent workspace cannot locate the Agent-local registry files for this runtime.',
      };
      return;
    }
    try {
      if (editor.mode === 'delete') {
        this.submitLocalDeleteEditor(shellPaths, editor);
        return;
      }
      if (editor.kind === 'persona') {
        const registry = AgentPersonaRegistry.fromShellPaths(shellPaths);
        if (editor.mode === 'update' && editor.recordId) {
          const wasActive = registry.snapshot().activePersonaId === editor.recordId;
          const updated = registry.update(editor.recordId, {
            name: this.editorField('name'),
            description: this.editorField('description'),
            body: this.editorField('body'),
            tags: splitList(this.editorField('tags')),
            triggers: splitList(this.editorField('triggers')),
            provenance: 'agent-workspace',
          });
          if (isAffirmative(this.editorField('activate'))) registry.setActive(updated.id);
          else if (wasActive) registry.clearActive();
          this.finishLocalEditor(editor.kind, updated.id, updated.name, 'Updated');
          return;
        }
        const created = registry.create({
          name: this.editorField('name'),
          description: this.editorField('description'),
          body: this.editorField('body'),
          tags: splitList(this.editorField('tags')),
          triggers: splitList(this.editorField('triggers')),
          source: 'user',
          provenance: 'agent-workspace',
        });
        if (isAffirmative(this.editorField('activate'))) registry.setActive(created.id);
        this.finishLocalEditor(editor.kind, created.id, created.name, 'Created');
      } else if (editor.kind === 'skill') {
        const registry = AgentSkillRegistry.fromShellPaths(shellPaths);
        if (editor.mode === 'update' && editor.recordId) {
          const updated = registry.update(editor.recordId, {
            name: this.editorField('name'),
            description: this.editorField('description'),
            procedure: this.editorField('procedure'),
            triggers: splitList(this.editorField('triggers')),
            tags: splitList(this.editorField('tags')),
            provenance: 'agent-workspace',
          });
          registry.setEnabled(updated.id, isAffirmative(this.editorField('enabled')));
          this.finishLocalEditor(editor.kind, updated.id, updated.name, 'Updated');
          return;
        }
        const created = registry.create({
          name: this.editorField('name'),
          description: this.editorField('description'),
          procedure: this.editorField('procedure'),
          triggers: splitList(this.editorField('triggers')),
          tags: splitList(this.editorField('tags')),
          enabled: isAffirmative(this.editorField('enabled')),
          source: 'user',
          provenance: 'agent-workspace',
        });
        this.finishLocalEditor(editor.kind, created.id, created.name, 'Created');
      } else {
        const registry = AgentRoutineRegistry.fromShellPaths(shellPaths);
        if (editor.mode === 'update' && editor.recordId) {
          const updated = registry.update(editor.recordId, {
            name: this.editorField('name'),
            description: this.editorField('description'),
            steps: this.editorField('steps'),
            triggers: splitList(this.editorField('triggers')),
            tags: splitList(this.editorField('tags')),
            provenance: 'agent-workspace',
          });
          registry.setEnabled(updated.id, isAffirmative(this.editorField('enabled')));
          this.finishLocalEditor(editor.kind, updated.id, updated.name, 'Updated');
          return;
        }
        const created = registry.create({
          name: this.editorField('name'),
          description: this.editorField('description'),
          steps: this.editorField('steps'),
          triggers: splitList(this.editorField('triggers')),
          tags: splitList(this.editorField('tags')),
          enabled: isAffirmative(this.editorField('enabled')),
          source: 'user',
          provenance: 'agent-workspace',
        });
        this.finishLocalEditor(editor.kind, created.id, created.name, 'Created');
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.localEditor = { ...editor, message: detail };
      this.status = detail;
      this.lastActionResult = {
        kind: 'error',
        title: `${editor.title} failed`,
        detail,
      };
    }
  }

  private submitLocalDeleteEditor(shellPaths: ShellPathService, editor: AgentWorkspaceLocalEditor): void {
    const expectedId = editor.recordId ?? '';
    const confirmedId = this.editorField('confirm');
    if (!expectedId || confirmedId !== expectedId) {
      this.localEditor = {
        ...editor,
        message: `Deletion not confirmed. Type ${expectedId} exactly, then press Enter.`,
      };
      this.status = 'Deletion not confirmed.';
      return;
    }
    if (editor.kind === 'persona') {
      const removed = AgentPersonaRegistry.fromShellPaths(shellPaths).deletePersona(expectedId);
      this.finishLocalDelete(editor.kind, removed.id, removed.name);
    } else if (editor.kind === 'skill') {
      const removed = AgentSkillRegistry.fromShellPaths(shellPaths).deleteSkill(expectedId);
      this.finishLocalDelete(editor.kind, removed.id, removed.name);
    } else {
      const removed = AgentRoutineRegistry.fromShellPaths(shellPaths).deleteRoutine(expectedId);
      this.finishLocalDelete(editor.kind, removed.id, removed.name);
    }
  }

  private finishLocalEditor(kind: AgentWorkspaceLocalEditorKind, id: string, name: string, verb: 'Created' | 'Updated'): void {
    this.localEditor = null;
    const categoryId = editorCategoryId(kind);
    const categoryIndex = this.categories.findIndex((category) => category.id === categoryId);
    if (categoryIndex >= 0) {
      this.selectedCategoryIndex = categoryIndex;
      this.selectedActionIndex = 0;
    }
    this.runtimeSnapshot = this.context ? buildAgentWorkspaceRuntimeSnapshot(this.context) : this.runtimeSnapshot;
    this.status = `${verb} ${kind}: ${name}.`;
    this.lastActionResult = {
      kind: 'refreshed',
      title: `${verb} ${kind}`,
      detail: `${name} (${id}) was saved to the Agent-local ${categoryId} registry.`,
      safety: 'safe',
    };
    this.clampSelection();
  }

  private finishLocalDelete(kind: AgentWorkspaceLocalEditorKind, id: string, name: string): void {
    this.localEditor = null;
    const categoryId = editorCategoryId(kind);
    const categoryIndex = this.categories.findIndex((category) => category.id === categoryId);
    if (categoryIndex >= 0) {
      this.selectedCategoryIndex = categoryIndex;
      this.selectedActionIndex = 0;
    }
    this.runtimeSnapshot = this.context ? buildAgentWorkspaceRuntimeSnapshot(this.context) : this.runtimeSnapshot;
    this.status = `Deleted ${kind}: ${name}.`;
    this.lastActionResult = {
      kind: 'refreshed',
      title: `Deleted ${kind}`,
      detail: `${name} (${id}) was removed from the Agent-local ${categoryId} registry.`,
      safety: 'safe',
    };
    this.clampSelection();
  }
}

export function handleAgentWorkspaceToken(
  workspace: AgentWorkspace,
  token: InputToken,
  handleEscape: () => void,
  requestRender: () => void,
): boolean {
  if (!workspace.active) return false;

  if (workspace.localEditor) {
    if (token.type === 'text') {
      workspace.appendEditorText(token.value);
    } else if (token.type === 'key') {
      if (token.logicalName === 'escape') workspace.cancelLocalEditor();
      else if (token.logicalName === 'enter') workspace.submitEditorFieldOrForm();
      else if (token.logicalName === 'tab' || token.logicalName === 'down') workspace.moveEditorField(1);
      else if (token.logicalName === 'up') workspace.moveEditorField(-1);
      else if (token.logicalName === 'backspace' || token.logicalName === 'delete') workspace.editorBackspace();
      else if (token.logicalName === 'j' && token.ctrl === true) workspace.appendEditorNewline();
    }
    requestRender();
    return true;
  }

  if (token.type === 'key') {
    if (token.logicalName === 'escape') {
      handleEscape();
      return true;
    }
    if (token.logicalName === 'enter' || token.logicalName === 'space') workspace.activateSelected();
    else if (token.logicalName === 'left') workspace.focusCategories();
    else if (token.logicalName === 'right') workspace.focusActions();
    else if (token.logicalName === 'up') workspace.moveUp();
    else if (token.logicalName === 'down') workspace.moveDown();
    else if (token.logicalName === 'tab') workspace.toggleFocusPane();
    else if (token.logicalName === 'home') workspace.jumpHome();
    else if (token.logicalName === 'end') workspace.jumpEnd();
  } else if (token.type === 'text') {
    if (token.value === 'h') workspace.focusCategories();
    else if (token.value === 'l') workspace.focusActions();
    else if (token.value === 'j') workspace.moveDown();
    else if (token.value === 'k') workspace.moveUp();
    else if (token.value === 'r' || token.value === 'R') workspace.refreshRuntimeSnapshot();
    else if (token.value === ' ') workspace.activateSelected();
  }

  requestRender();
  return true;
}
