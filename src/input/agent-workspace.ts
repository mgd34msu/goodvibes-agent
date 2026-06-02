import type { MemoryApi } from '@pellux/goodvibes-sdk/platform/knowledge';
import type { MemoryRecord } from '@pellux/goodvibes-sdk/platform/state';
import type { ShellPathService } from '@/runtime/index.ts';
import type { CommandContext } from './command-registry.ts';
import { AgentPersonaRegistry } from '../agent/persona-registry.ts';
import { AgentRoutineRegistry } from '../agent/routine-registry.ts';
import { createAgentRuntimeProfile, type AgentRuntimeProfileInfo } from '../agent/runtime-profile.ts';
import { AgentSkillRegistry } from '../agent/skill-registry.ts';
import { activateAgentWorkspaceSelection } from './agent-workspace-activation.ts';
import { AGENT_WORKSPACE_CATEGORIES } from './agent-workspace-categories.ts';
import { buildAgentWorkspaceCommandEditorSubmission, isAgentWorkspaceCommandEditorKind } from './agent-workspace-command-editor.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';
import { createDeleteEditor, createMemoryUpdateEditor, createPersonaUpdateEditor, createRoutineUpdateEditor, createSkillUpdateEditor, editorCategoryId, isAffirmative, splitList } from './agent-workspace-editors.ts';
import { createAgentWorkspaceLearnedBehavior } from './agent-workspace-learned-behavior.ts';
import { clampAgentWorkspaceLocalLibrarySelection, moveAgentWorkspaceLocalLibraryItemSelection, selectedAgentWorkspaceLocalLibraryItem, type AgentWorkspaceLocalSelectionIndexes } from './agent-workspace-local-selection.ts';
import { deleteAgentWorkspaceMemoryEditor, submitAgentWorkspaceMemoryEditor } from './agent-workspace-memory-editor.ts';
import { jumpAgentWorkspaceSelection, moveAgentWorkspaceSelection, selectAgentWorkspaceCategory } from './agent-workspace-navigation.ts';
import { buildAgentWorkspaceRequirements } from './agent-workspace-requirements.ts';
import { appendAgentWorkspaceActionSearchText, backspaceAgentWorkspaceActionSearch, beginAgentWorkspaceActionSearch, clearAgentWorkspaceActionSearch, commitAgentWorkspaceActionSearchSelection, searchAgentWorkspaceActions } from './agent-workspace-search.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from './agent-workspace-snapshot.ts';
import type { AgentWorkspaceAction, AgentWorkspaceActionResult, AgentWorkspaceActionSearchResult, AgentWorkspaceCategory, AgentWorkspaceCommandDispatcher, AgentWorkspaceEditorField, AgentWorkspaceFocusPane, AgentWorkspaceLocalEditor, AgentWorkspaceLocalEditorKind, AgentWorkspaceLocalLibraryItem, AgentWorkspaceLocalOperation, AgentWorkspacePromptDispatcher, AgentWorkspaceRuntimeSnapshot } from './agent-workspace-types.ts';

export type { AgentWorkspaceChannelRisk, AgentWorkspaceChannelStatus } from './agent-workspace-channels.ts';
export type { AgentWorkspaceAction, AgentWorkspaceActionResult, AgentWorkspaceActionSearchResult, AgentWorkspaceCategory, AgentWorkspaceCommandDispatcher, AgentWorkspaceEditorField, AgentWorkspaceFocusPane, AgentWorkspaceLocalEditor, AgentWorkspaceLocalEditorKind, AgentWorkspaceLocalLibraryItem, AgentWorkspaceLocalOperation, AgentWorkspacePromptDispatcher, AgentWorkspaceRuntimeSnapshot } from './agent-workspace-types.ts';
export { AGENT_WORKSPACE_MODAL_NAME } from './agent-workspace-types.ts';
export { buildAgentWorkspaceRuntimeSnapshot } from './agent-workspace-snapshot.ts';
export { handleAgentWorkspaceToken } from './agent-workspace-token.ts';

export class AgentWorkspace {
  public active = false;
  public focusPane: AgentWorkspaceFocusPane = 'actions';
  public selectedCategoryIndex = 0;
  public selectedActionIndex = 0;
  public status = 'Ready. Choose an operator flow; ordinary assistant work stays in the main conversation.';
  public runtimeSnapshot: AgentWorkspaceRuntimeSnapshot | null = null;
  public lastActionResult: AgentWorkspaceActionResult | null = null;
  public localEditor: AgentWorkspaceLocalEditor | null = null;
  public actionSearchActive = false;
  public actionSearchQuery = '';
  public readonly selectedLibraryItemIndexes: AgentWorkspaceLocalSelectionIndexes = {
    memory: 0,
    persona: 0,
    skill: 0,
    routine: 0,
    profile: 0,
  };
  private context: CommandContext | null = null;
  private dispatchCommand: AgentWorkspaceCommandDispatcher | null = null;
  private dispatchPrompt: AgentWorkspacePromptDispatcher | null = null;

  open(context: CommandContext, dispatchCommand: AgentWorkspaceCommandDispatcher, categoryId?: string, dispatchPrompt?: AgentWorkspacePromptDispatcher): void {
    this.context = context;
    this.dispatchCommand = dispatchCommand;
    this.dispatchPrompt = dispatchPrompt ?? null;
    this.runtimeSnapshot = buildAgentWorkspaceRuntimeSnapshot(context);
    this.active = true;
    this.focusPane = 'actions';
    this.status = 'Ready. Choose an operator flow; ordinary assistant work stays in the main conversation.';
    this.lastActionResult = null;
    this.localEditor = null;
    this.actionSearchActive = false;
    this.actionSearchQuery = '';
    if (categoryId && !this.selectCategory(categoryId)) {
      const normalized = categoryId.trim();
      this.status = `Unknown Agent workspace area: ${normalized}.`;
      this.lastActionResult = {
        kind: 'guidance',
        title: 'Unknown Agent workspace area',
        detail: `Use one of: ${this.categories.map((category) => category.id).join(', ')}.`,
        safety: 'safe',
      };
    }
    this.clampSelection();
  }

  reopen(): void {
    this.active = true;
    this.clampSelection();
  }

  close(): void {
    this.active = false;
    this.localEditor = null;
    this.actionSearchActive = false;
    this.actionSearchQuery = '';
  }

  get categories(): readonly AgentWorkspaceCategory[] {
    return AGENT_WORKSPACE_CATEGORIES;
  }

  get selectedCategory(): AgentWorkspaceCategory {
    return this.categories[this.selectedCategoryIndex] ?? this.categories[0]!;
  }

  get actions(): readonly AgentWorkspaceAction[] {
    if (this.actionSearchActive) return this.actionSearchResults.map((result) => result.action);
    return this.selectedCategory.actions;
  }

  get selectedAction(): AgentWorkspaceAction | null {
    return this.actions[this.selectedActionIndex] ?? null;
  }

  get selectedActionCategory(): AgentWorkspaceCategory {
    if (this.actionSearchActive) return this.selectedActionSearchResult?.category ?? this.selectedCategory;
    return this.selectedCategory;
  }

  get actionSearchResults(): readonly AgentWorkspaceActionSearchResult[] {
    return this.actionSearchActive ? searchAgentWorkspaceActions(this.categories, this.actionSearchQuery) : [];
  }

  get selectedActionSearchResult(): AgentWorkspaceActionSearchResult | null {
    if (!this.actionSearchActive) return null;
    return this.actionSearchResults[this.selectedActionIndex] ?? null;
  }

  selectCategory(categoryIdOrLabel: string): boolean {
    return selectAgentWorkspaceCategory(this, categoryIdOrLabel);
  }

  selectedLocalLibraryItem(kind: AgentWorkspaceLocalEditorKind): AgentWorkspaceLocalLibraryItem | null {
    return selectedAgentWorkspaceLocalLibraryItem(this.runtimeSnapshot, this.selectedLibraryItemIndexes, kind);
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
    moveAgentWorkspaceSelection(this, -1);
  }

  moveDown(): void {
    moveAgentWorkspaceSelection(this, 1);
  }

  jumpHome(): void {
    jumpAgentWorkspaceSelection(this, 'home');
  }

  jumpEnd(): void {
    jumpAgentWorkspaceSelection(this, 'end');
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
      detail: 'Provider, model, session, local memory, runtime endpoint, and Agent knowledge route posture were re-read from the live command context.',
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

  beginActionSearch(): void {
    beginAgentWorkspaceActionSearch(this);
  }

  appendActionSearchText(text: string): void {
    appendAgentWorkspaceActionSearchText(this, text);
  }

  actionSearchBackspace(): void {
    backspaceAgentWorkspaceActionSearch(this);
  }

  clearActionSearch(): void {
    clearAgentWorkspaceActionSearch(this);
  }

  commitActionSearchSelection(): boolean {
    return commitAgentWorkspaceActionSearchSelection(this, this.selectedActionSearchResult);
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
    this.replaceEditorField(editor.selectedFieldIndex, `${field.value}${field.multiline ? text.replace(/\r\n?/g, '\n') : text.replace(/[\r\n]+/g, ' ')}`, editor.message);
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

  submitEditorFieldOrForm(requestRender?: () => void): void {
    const editor = this.localEditor;
    if (!editor) return;
    if (editor.selectedFieldIndex < editor.fields.length - 1) {
      this.moveEditorField(1);
      return;
    }
    this.submitLocalEditor(requestRender);
  }

  activateSelected(requestRender?: () => void): void {
    activateAgentWorkspaceSelection(this, requestRender);
  }

  hasCommandDispatch(): boolean {
    return Boolean(this.context?.executeCommand && this.dispatchCommand);
  }

  hasPromptDispatch(): boolean {
    return Boolean(this.context?.submitInput && this.dispatchPrompt);
  }

  dispatchWorkspaceCommand(command: string): void {
    this.dispatchCommand?.(command);
  }

  dispatchWorkspacePrompt(prompt: string): void {
    this.dispatchPrompt?.(prompt);
  }

  clampSelection(): void {
    this.selectedCategoryIndex = Math.max(0, Math.min(this.selectedCategoryIndex, this.categories.length - 1));
    this.selectedActionIndex = Math.max(0, Math.min(this.selectedActionIndex, this.actions.length - 1));
    clampAgentWorkspaceLocalLibrarySelection(this.runtimeSnapshot, this.selectedLibraryItemIndexes, 'memory');
    clampAgentWorkspaceLocalLibrarySelection(this.runtimeSnapshot, this.selectedLibraryItemIndexes, 'persona');
    clampAgentWorkspaceLocalLibrarySelection(this.runtimeSnapshot, this.selectedLibraryItemIndexes, 'skill');
    clampAgentWorkspaceLocalLibrarySelection(this.runtimeSnapshot, this.selectedLibraryItemIndexes, 'routine');
  }

  moveLocalLibraryItemSelection(kind: AgentWorkspaceLocalEditorKind, delta: number): void {
    moveAgentWorkspaceLocalLibraryItemSelection(this, kind, delta);
  }

  applyLocalLibraryOperation(operation: AgentWorkspaceLocalOperation): void {
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
        this.finishLocalOperation('persona', 'Cleared active persona', 'The default Agent policy will apply to later turns.');
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
      if (operation === 'memory-edit') {
        const memory = this.memoryApi();
        const record = memory.get(selected.id);
        if (!record) throw new Error(`Unknown Agent memory: ${selected.id}`);
        this.localEditor = createMemoryUpdateEditor(record);
        this.status = `Editing memory: ${record.id}.`;
        this.lastActionResult = {
          kind: 'guidance',
          title: this.localEditor.title,
          detail: this.localEditor.message,
          safety: 'safe',
        };
      } else if (operation === 'memory-review') {
        const record = this.memoryApi().review(selected.id, { state: 'reviewed', confidence: selected.confidence ?? 100, reviewedBy: 'operator' });
        if (!record) throw new Error(`Unknown Agent memory: ${selected.id}`);
        this.finishLocalOperation('memory', `Reviewed memory ${record.id}`, `${record.summary} is marked reviewed.`);
      } else if (operation === 'memory-stale') {
        const record = this.memoryApi().review(selected.id, { state: 'stale', staleReason: 'Marked stale from Agent workspace', reviewedBy: 'operator' });
        if (!record) throw new Error(`Unknown Agent memory: ${selected.id}`);
        this.finishLocalOperation('memory', `Marked memory stale ${record.id}`, `${record.summary} needs review before reuse.`);
      } else if (operation === 'memory-delete') {
        this.openDeleteEditor('memory', selected);
      } else if (operation === 'persona-edit') {
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
        this.finishLocalOperation('persona', `Using persona ${selected.name}`, `${selected.name} will shape later main-conversation turns.`);
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
        if (this.hasCommandDispatch()) {
          const command = `/routines start ${quoteSlashCommandArg(selected.id)}`;
          this.dispatchWorkspaceCommand(command);
          this.status = `Opening routine: ${selected.name}.`;
          this.lastActionResult = {
            kind: 'dispatched',
            title: `Opening routine ${selected.name}`,
            detail: `${selected.name} will print its workflow steps in the main conversation. No hidden job was created.`,
            command,
            safety: 'safe',
          };
          return;
        }
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
    if (operation.startsWith('memory-')) return this.selectedLocalLibraryItem('memory');
    if (operation.startsWith('persona-')) return this.selectedLocalLibraryItem('persona');
    if (operation.startsWith('skill-')) return this.selectedLocalLibraryItem('skill');
    return this.selectedLocalLibraryItem('routine');
  }

  private memoryApi(): MemoryApi {
    const memory = this.context?.clients?.agentKnowledgeApi?.memory;
    if (!memory) throw new Error('Agent Memory API is unavailable; refusing default Knowledge/Wiki or non-Agent fallback.');
    return memory;
  }

  private learnedBehaviorTarget(): Exclude<AgentWorkspaceLocalEditorKind, 'memory' | 'profile'> {
    const target = this.editorField('target').trim().toLowerCase();
    if (target === 'persona' || target === 'skill' || target === 'routine') return target;
    throw new Error('Behavior type must be skill, routine, or persona.');
  }

  private finishLocalOperation(kind: AgentWorkspaceLocalEditorKind, title: string, detail: string): void {
    this.runtimeSnapshot = this.context ? buildAgentWorkspaceRuntimeSnapshot(this.context) : this.runtimeSnapshot;
    clampAgentWorkspaceLocalLibrarySelection(this.runtimeSnapshot, this.selectedLibraryItemIndexes, kind);
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

  private submitLocalEditor(requestRender?: () => void): void {
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
    if (isAgentWorkspaceCommandEditorKind(editor.kind)) {
      this.submitCommandEditor(editor);
      requestRender?.();
      return;
    }
    if (editor.kind === 'memory') {
      if (editor.mode === 'delete') {
        try {
          this.submitMemoryDeleteEditor(editor);
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
        requestRender?.();
        return;
      }
      void this.submitMemoryEditor(editor).finally(() => requestRender?.());
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
      if (editor.kind === 'learned-behavior') {
        const created = createAgentWorkspaceLearnedBehavior(shellPaths, {
          target: this.learnedBehaviorTarget(),
          name: this.editorField('name'),
          description: this.editorField('description'),
          notes: this.editorField('notes'),
          tags: splitList(this.editorField('tags')),
          triggers: splitList(this.editorField('triggers')),
          enable: isAffirmative(this.editorField('enable')),
        });
        this.finishLocalEditor(created.kind, created.id, created.name, 'Created');
      } else if (editor.kind === 'profile') {
        const template = this.editorField('template');
        const templateId = template && template.toLowerCase() !== 'none' ? template : undefined;
        const profile = createAgentRuntimeProfile(shellPaths.homeDirectory, this.editorField('name'), {
          ...(templateId ? { templateId } : {}),
        });
        this.finishProfileEditor(profile);
      } else if (editor.kind === 'persona') {
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
            requirements: buildAgentWorkspaceRequirements((id) => this.editorField(id)),
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
          requirements: buildAgentWorkspaceRequirements((id) => this.editorField(id)),
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
            requirements: buildAgentWorkspaceRequirements((id) => this.editorField(id)),
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
          requirements: buildAgentWorkspaceRequirements((id) => this.editorField(id)),
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

  private submitCommandEditor(editor: AgentWorkspaceLocalEditor): void {
    const result = buildAgentWorkspaceCommandEditorSubmission(editor, (fieldId) => this.editorField(fieldId), this.hasCommandDispatch(), this.hasPromptDispatch());
    if (result.kind === 'editor') {
      this.localEditor = result.editor;
      this.status = result.status;
      if (result.actionResult) this.lastActionResult = result.actionResult;
      return;
    }

    this.localEditor = null;
    this.status = result.status;
    this.lastActionResult = result.actionResult;
    if (result.kind === 'prompt') {
      this.dispatchWorkspacePrompt(result.prompt);
      return;
    }
    this.dispatchWorkspaceCommand(result.command);
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
    if (editor.kind === 'memory') {
      const removed = this.memoryApi().delete(expectedId);
      if (!removed) throw new Error(`Unknown Agent memory: ${expectedId}`);
      this.finishLocalDelete(editor.kind, expectedId, expectedId);
    } else if (editor.kind === 'persona') {
      const removed = AgentPersonaRegistry.fromShellPaths(shellPaths).deletePersona(expectedId);
      this.finishLocalDelete(editor.kind, removed.id, removed.name);
    } else if (editor.kind === 'skill') {
      const removed = AgentSkillRegistry.fromShellPaths(shellPaths).deleteSkill(expectedId);
      this.finishLocalDelete(editor.kind, removed.id, removed.name);
    } else if (editor.kind === 'routine') {
      const removed = AgentRoutineRegistry.fromShellPaths(shellPaths).deleteRoutine(expectedId);
      this.finishLocalDelete(editor.kind, removed.id, removed.name);
    } else {
      throw new Error(`Unsupported delete editor kind: ${editor.kind}`);
    }
  }

  private submitMemoryDeleteEditor(editor: AgentWorkspaceLocalEditor): void {
    const expectedId = editor.recordId ?? '';
    const confirmedId = this.editorField('confirm');
    const removed = deleteAgentWorkspaceMemoryEditor(editor, confirmedId, this.memoryApi());
    if (!removed) {
      this.localEditor = {
        ...editor,
        message: `Deletion not confirmed. Type ${expectedId} exactly, then press Enter.`,
      };
      this.status = 'Deletion not confirmed.';
      return;
    }
    this.finishLocalDelete('memory', removed.id, removed.name);
  }

  private async submitMemoryEditor(editor: AgentWorkspaceLocalEditor): Promise<void> {
    try {
      this.status = 'Saving Agent memory...';
      const result = await submitAgentWorkspaceMemoryEditor(editor, this.memoryApi(), (id) => this.editorField(id));
      this.finishMemoryEditor(result.record, result.verb);
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

  private finishMemoryEditor(record: MemoryRecord, verb: 'Created' | 'Updated'): void {
    this.localEditor = null;
    this.runtimeSnapshot = this.context ? buildAgentWorkspaceRuntimeSnapshot(this.context) : this.runtimeSnapshot;
    const categoryIndex = this.categories.findIndex((category) => category.id === 'memory');
    if (categoryIndex >= 0) {
      this.selectedCategoryIndex = categoryIndex;
      this.selectedActionIndex = 0;
    }
    this.status = `${verb} memory: ${record.summary}.`;
    this.lastActionResult = {
      kind: 'refreshed',
      title: `${verb} memory`,
      detail: `${record.summary} (${record.id}) was saved to Agent-owned memory only.`,
      safety: 'safe',
    };
    this.clampSelection();
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

  private finishProfileEditor(profile: AgentRuntimeProfileInfo): void {
    this.localEditor = null;
    const categoryIndex = this.categories.findIndex((category) => category.id === 'profiles');
    if (categoryIndex >= 0) {
      this.selectedCategoryIndex = categoryIndex;
      this.selectedActionIndex = this.categories[categoryIndex]?.actions.findIndex((action) => action.id === 'runtime-profile-create') ?? 0;
      if (this.selectedActionIndex < 0) this.selectedActionIndex = 0;
    }
    this.runtimeSnapshot = this.context ? buildAgentWorkspaceRuntimeSnapshot(this.context) : this.runtimeSnapshot;
    const starter = profile.starterTemplateId ? ` from ${profile.starterTemplateId}` : '';
    this.status = `Created Agent profile: ${profile.id}.`;
    this.lastActionResult = {
      kind: 'refreshed',
      title: 'Created Agent profile',
      detail: `Created isolated Agent profile ${profile.id}${starter}. Launch it with goodvibes-agent --agent-profile ${profile.id}. The current Agent session was not switched.`,
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
