import type { CommandContext } from '../input/command-registry.ts';
import { createAgentWorkspaceEditor } from '../input/agent-workspace-activation.ts';
import { AGENT_WORKSPACE_CATEGORIES } from '../input/agent-workspace-categories.ts';
import { searchAgentWorkspaceActions } from '../input/agent-workspace-search.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from '../input/agent-workspace-snapshot.ts';
import type { AgentWorkspaceAction, AgentWorkspaceCategory, AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor, AgentWorkspaceLocalLibraryItem, AgentWorkspaceRuntimeSnapshot } from '../input/agent-workspace-types.ts';
import { parseSlashCommand } from '../input/slash-command-parser.ts';
import { describeCommandPolicy } from './agent-harness-metadata.ts';
import { describeLocalWorkspaceModelExecution } from './agent-harness-local-operations.ts';
import { describeWorkspaceEditorModelExecution } from './agent-harness-workspace-editor-execution.ts';

export { AGENT_WORKSPACE_CATEGORIES };

export interface AgentHarnessWorkspaceActionArgs {
  readonly query?: unknown;
  readonly command?: unknown;
  readonly actionId?: unknown;
  readonly recordId?: unknown;
  readonly fields?: unknown;
  readonly target?: unknown;
  readonly category?: unknown;
  readonly categoryId?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

export interface WorkspaceEditorContext {
  readonly runtimeStarterTemplates: AgentWorkspaceRuntimeSnapshot['runtimeStarterTemplates'];
  readonly selectedRoutine: AgentWorkspaceLocalLibraryItem | null;
}

export interface WorkspaceActionLookup {
  readonly source: 'actionId' | 'command' | 'target' | 'query';
  readonly input: string;
  readonly resolvedBy: 'id' | 'case-insensitive-id' | 'label' | 'case-insensitive-label' | 'command' | 'search';
}

export type WorkspaceActionResolution =
  | {
    readonly status: 'found';
    readonly category: AgentWorkspaceCategory;
    readonly action: AgentWorkspaceAction;
    readonly lookup: WorkspaceActionLookup;
  }
  | {
    readonly status: 'ambiguous';
    readonly input: string;
    readonly candidates: readonly { readonly actionId: string; readonly categoryId: string; readonly label: string; readonly command?: string }[];
  };

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(1000, Math.trunc(parsed)));
}

function readFieldMap(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry === 'string' ? entry : String(entry)]));
}

export function allWorkspaceActions(): ReadonlyArray<{
  readonly category: AgentWorkspaceCategory;
  readonly action: AgentWorkspaceAction;
}> {
  return AGENT_WORKSPACE_CATEGORIES.flatMap((category) => category.actions.map((action) => ({ category, action })));
}

export function describeWorkspaceCategory(category: AgentWorkspaceCategory): Record<string, unknown> {
  return {
    id: category.id,
    group: category.group,
    label: category.label,
    summary: category.summary,
    detail: category.detail,
    actions: category.actions.length,
  };
}

export function describeWorkspaceEditor(editor: AgentWorkspaceLocalEditor): Record<string, unknown> {
  return {
    kind: editor.kind,
    mode: editor.mode,
    title: editor.title,
    message: editor.message,
    fields: editor.fields.map((field) => ({
      id: field.id,
      label: field.label,
      required: field.required,
      multiline: field.multiline,
      hint: field.hint,
      redact: field.redact === true,
      default: field.redact ? '<redacted>' : field.value,
    })),
  };
}

function previewText(value: string, maxLength = 56): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function commandRouteHint(command: string): string {
  const parsed = parseSlashCommand(command);
  const commandName = parsed.name || command.replace(/^\//, '').trim().split(/\s+/)[0] || command;
  return describeCommandPolicy(commandName).preferredModelTool ?? 'agent_harness mode:"run_command"';
}

function editorRouteHint(editorKind: AgentWorkspaceEditorKind): string {
  if (
    editorKind === 'memory'
    || editorKind === 'note'
    || editorKind === 'persona'
    || editorKind === 'skill'
    || editorKind === 'routine'
  ) return 'agent_local_registry';
  if (
    editorKind === 'knowledge-url'
    || editorKind === 'knowledge-urls'
    || editorKind === 'knowledge-file'
    || editorKind === 'knowledge-bookmarks'
    || editorKind === 'knowledge-browser-history'
    || editorKind === 'knowledge-connector-ingest'
  ) return 'agent_knowledge_ingest';
  if (
    editorKind === 'knowledge-reindex'
    || editorKind === 'knowledge-review-issue'
    || editorKind === 'knowledge-consolidate'
  ) return 'agent_harness mode:"run_workspace_action"';
  if (editorKind.startsWith('knowledge-')) return 'agent_knowledge';
  if (editorKind === 'web-research' || editorKind === 'web-fetch') return 'main conversation prompt';
  if (editorKind === 'media-generate') return 'agent_media_generate';
  if (
    editorKind === 'model-compare'
    || editorKind === 'model-compare-review'
    || editorKind === 'model-compare-judge'
    || editorKind === 'model-compare-apply'
    || editorKind === 'model-compare-export'
    || editorKind === 'model-compare-analytics'
  ) return 'agent_model_compare';
  if (editorKind === 'channel-send') return 'agent_channel_send';
  if (editorKind === 'notify-send' || editorKind === 'notify-webhook-test') return 'agent_notify';
  if (editorKind === 'reminder-schedule') return 'agent_reminder_schedule';
  if (
    editorKind.startsWith('approval-')
    || editorKind.startsWith('automation-')
    || editorKind === 'schedule-run'
  ) return 'agent_operator_action';
  if (editorKind.startsWith('workplan-') || editorKind.startsWith('plan-') || editorKind.startsWith('task-')) return 'agent_work_plan';
  return 'agent_harness mode:"run_workspace_action"';
}

function localActionRouteHint(action: AgentWorkspaceAction): string {
  const modelExecution = describeLocalWorkspaceModelExecution(action);
  const tool = modelExecution && typeof modelExecution.tool === 'string' ? modelExecution.tool : '';
  return tool || 'agent_local_registry';
}

function workspaceActionRouteHint(action: AgentWorkspaceAction): string {
  if (action.command) return commandRouteHint(action.command);
  if (action.editorKind) return editorRouteHint(action.editorKind);
  if (action.kind === 'local-selection' || action.kind === 'local-operation') return localActionRouteHint(action);
  if (action.targetCategoryId || action.kind === 'workspace') return 'agent_harness mode:"open_ui_surface"';
  if (action.kind === 'guidance') return action.safety === 'blocked' ? 'main conversation policy' : 'main conversation';
  return 'agent_harness mode:"workspace_action"';
}

function selectedRoutineFromArgs(
  snapshot: AgentWorkspaceRuntimeSnapshot,
  args: AgentHarnessWorkspaceActionArgs,
): AgentWorkspaceLocalLibraryItem | null {
  const fields = readFieldMap(args.fields);
  const routineId = readString(args.recordId) || readString(fields.routineId) || readString(fields.id);
  if (!routineId) return null;
  return snapshot.localRoutines.find((routine) => routine.id === routineId || routine.name.toLowerCase() === routineId.toLowerCase()) ?? null;
}

export function buildWorkspaceEditorContext(context: CommandContext, args: AgentHarnessWorkspaceActionArgs): WorkspaceEditorContext {
  try {
    const snapshot = buildAgentWorkspaceRuntimeSnapshot(context);
    return {
      runtimeStarterTemplates: snapshot.runtimeStarterTemplates,
      selectedRoutine: selectedRoutineFromArgs(snapshot, args),
    };
  } catch {
    return {
      runtimeStarterTemplates: [],
      selectedRoutine: null,
    };
  }
}

export function createWorkspaceEditor(
  editorKind: AgentWorkspaceEditorKind,
  editorContext: WorkspaceEditorContext | null,
): AgentWorkspaceLocalEditor | null {
  return createAgentWorkspaceEditor(editorKind, {
    runtimeStarterTemplates: editorContext?.runtimeStarterTemplates ?? [],
    selectedRoutine: editorKind === 'routine-schedule' ? editorContext?.selectedRoutine ?? null : null,
  });
}

export function describeWorkspaceAction(
  category: AgentWorkspaceCategory,
  action: AgentWorkspaceAction,
  options: { readonly includeEditor?: boolean; readonly editorContext?: WorkspaceEditorContext | null; readonly lookup?: WorkspaceActionLookup } = {},
): Record<string, unknown> {
  const editor = options.includeEditor && action.editorKind ? createWorkspaceEditor(action.editorKind, options.editorContext ?? null) : null;
  return {
    id: action.id,
    categoryId: category.id,
    category: category.label,
    group: category.group,
    label: action.label,
    detail: action.detail,
    kind: action.kind,
    safety: action.safety,
    modelRoute: previewText(workspaceActionRouteHint(action)),
    ...(action.command ? { command: action.command } : {}),
    ...(action.targetCategoryId ? { targetCategoryId: action.targetCategoryId } : {}),
    ...(action.editorKind ? { editorKind: action.editorKind } : {}),
    ...(action.localKind ? { localKind: action.localKind } : {}),
    ...(action.localOperation ? { localOperation: action.localOperation } : {}),
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(editor ? { editor: describeWorkspaceEditor(editor) } : {}),
    ...(action.kind === 'local-selection' || action.kind === 'local-operation' ? {
      modelExecution: describeLocalWorkspaceModelExecution(action),
    } : {}),
    ...(action.kind === 'editor' && action.editorKind ? {
      modelExecution: describeWorkspaceEditorModelExecution(action.editorKind),
    } : {}),
  };
}

function describeWorkspaceActionSummary(
  category: AgentWorkspaceCategory,
  action: AgentWorkspaceAction,
): Record<string, unknown> {
  return {
    id: action.id,
    categoryId: category.id,
    category: category.label,
    group: category.group,
    label: action.label,
    summary: previewText(action.detail),
    kind: action.kind,
    safety: action.safety,
    modelRoute: previewText(workspaceActionRouteHint(action)),
    ...(action.command ? { command: action.command } : {}),
    ...(action.targetCategoryId ? { targetCategoryId: action.targetCategoryId } : {}),
    ...(action.editorKind ? { editorKind: action.editorKind } : {}),
    ...(action.localKind ? { localKind: action.localKind } : {}),
    ...(action.localOperation ? { localOperation: action.localOperation } : {}),
  };
}

export function listWorkspaceActions(
  context: CommandContext,
  args: AgentHarnessWorkspaceActionArgs,
): readonly Record<string, unknown>[] {
  const query = readString(args.query);
  const categoryId = readString(args.categoryId || args.category);
  const limit = readLimit(args.limit, 1000);
  const includeEditor = args.includeParameters === true;
  const editorContext = includeEditor ? buildWorkspaceEditorContext(context, args) : null;
  const source = query
    ? searchAgentWorkspaceActions(AGENT_WORKSPACE_CATEGORIES, query).map((result) => ({ category: result.category, action: result.action }))
    : allWorkspaceActions();
  return source
    .filter((entry) => !categoryId || entry.category.id === categoryId)
    .slice(0, limit)
    .map((entry) => includeEditor
      ? describeWorkspaceAction(entry.category, entry.action, { includeEditor, editorContext })
      : describeWorkspaceActionSummary(entry.category, entry.action));
}

function workspaceActionLookupFromArgs(args: AgentHarnessWorkspaceActionArgs): { readonly source: WorkspaceActionLookup['source']; readonly input: string } | null {
  const actionId = readString(args.actionId);
  if (actionId) return { source: 'actionId', input: actionId };
  const command = readString(args.command);
  if (command) return { source: 'command', input: command };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

function describeWorkspaceActionCandidates(
  entries: readonly { readonly category: AgentWorkspaceCategory; readonly action: AgentWorkspaceAction }[],
): readonly { readonly actionId: string; readonly categoryId: string; readonly label: string; readonly command?: string }[] {
  return entries.slice(0, 8).map((entry) => ({
    actionId: entry.action.id,
    categoryId: entry.category.id,
    label: entry.action.label,
    ...(entry.action.command ? { command: entry.action.command } : {}),
  }));
}

export function resolveWorkspaceActionDetail(args: AgentHarnessWorkspaceActionArgs): WorkspaceActionResolution | null {
  const lookup = workspaceActionLookupFromArgs(args);
  const categoryId = readString(args.categoryId || args.category);
  if (!lookup) return null;
  const entries = allWorkspaceActions().filter((entry) => !categoryId || entry.category.id === categoryId);
  const normalized = lookup.input.toLowerCase();
  const commandInput = lookup.source === 'command' ? lookup.input.trim() : '';

  const exactId = entries.find((entry) => entry.action.id === lookup.input);
  if (exactId) return { status: 'found', ...exactId, lookup: { ...lookup, resolvedBy: 'id' } };
  const exactLabel = entries.find((entry) => entry.action.label === lookup.input);
  if (exactLabel) return { status: 'found', ...exactLabel, lookup: { ...lookup, resolvedBy: 'label' } };
  const exactCommand = commandInput ? entries.find((entry) => entry.action.command === commandInput) : null;
  if (exactCommand) return { status: 'found', ...exactCommand, lookup: { ...lookup, resolvedBy: 'command' } };

  const insensitiveId = entries.find((entry) => entry.action.id.toLowerCase() === normalized);
  if (insensitiveId) return { status: 'found', ...insensitiveId, lookup: { ...lookup, resolvedBy: 'case-insensitive-id' } };
  const insensitiveLabel = entries.find((entry) => entry.action.label.toLowerCase() === normalized);
  if (insensitiveLabel) return { status: 'found', ...insensitiveLabel, lookup: { ...lookup, resolvedBy: 'case-insensitive-label' } };

  const searched = searchAgentWorkspaceActions(AGENT_WORKSPACE_CATEGORIES, lookup.input)
    .map((result) => ({ category: result.category, action: result.action }))
    .filter((entry) => !categoryId || entry.category.id === categoryId);
  if (searched.length === 1) return { status: 'found', ...searched[0]!, lookup: { ...lookup, resolvedBy: 'search' } };
  if (searched.length > 1) return { status: 'ambiguous', input: lookup.input, candidates: describeWorkspaceActionCandidates(searched) };
  return null;
}
