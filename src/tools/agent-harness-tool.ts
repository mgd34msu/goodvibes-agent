import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { CommandContext, CommandRegistry } from '../input/command-registry.ts';
import { buildAgentWorkspaceCommandEditorSubmission, isAgentWorkspaceCommandEditorKind } from '../input/agent-workspace-command-editor.ts';
import { createAgentWorkspaceEditor } from '../input/agent-workspace-activation.ts';
import { AGENT_WORKSPACE_CATEGORIES } from '../input/agent-workspace-categories.ts';
import { isAffirmative, splitList } from '../input/agent-workspace-editors.ts';
import { createAgentWorkspaceLearnedBehavior } from '../input/agent-workspace-learned-behavior.ts';
import { searchAgentWorkspaceActions } from '../input/agent-workspace-search.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from '../input/agent-workspace-snapshot.ts';
import type {
  AgentWorkspaceAction,
  AgentWorkspaceCategory,
  AgentWorkspaceEditorKind,
  AgentWorkspaceLocalEditor,
  AgentWorkspaceLocalLibraryItem,
  AgentWorkspaceRuntimeSnapshot,
} from '../input/agent-workspace-types.ts';
import { parseSlashCommand } from '../input/slash-command-parser.ts';
import { blockedHarnessCliCommandTokens, describeHarnessCliCommand, listHarnessCliCommands, totalHarnessCliCommands } from './agent-harness-cli-metadata.ts';
import { describeHarnessCommand, listHarnessCommands } from './agent-harness-command-catalog.ts';
import { describeHarnessKeybinding, listHarnessKeybindings, listHarnessShortcuts, resetHarnessKeybinding, setHarnessKeybinding, totalHarnessKeybindings, totalHarnessShortcuts } from './agent-harness-keybinding-metadata.ts';
import { describeHarnessPanel, listHarnessPanels, openHarnessPanel, totalHarnessPanels } from './agent-harness-panel-metadata.ts';
import { connectedHostStatusSummary } from './agent-harness-connected-host-status.ts';
import { describeLocalWorkspaceModelExecution, runLocalWorkspaceAction, runLocalWorkspaceEditorAction } from './agent-harness-local-operations.ts';
import { describeHarnessModelTool, listHarnessModelTools } from './agent-harness-model-tool-catalog.ts';
import { AGENT_HARNESS_MODES, AGENT_HARNESS_PARAMETER_PROPERTIES } from './agent-harness-tool-schema.ts';
import { describeHarnessUiSurface, listHarnessUiSurfaces, openHarnessUiSurface, totalHarnessUiSurfaces } from './agent-harness-ui-surface-metadata.ts';
import {
  connectedHostSummary,
  describeConnectedHostCapability,
  settingsPolicySummary,
} from './agent-harness-metadata.ts';
import {
  formatHarnessError,
  getHarnessSetting,
  listHarnessSettings,
  resetHarnessSetting,
  setHarnessSetting,
} from '../agent/harness-control.ts';

type AgentHarnessMode = typeof AGENT_HARNESS_MODES[number];

interface AgentHarnessToolArgs {
  readonly mode?: unknown;
  readonly query?: unknown;
  readonly command?: unknown;
  readonly cliCommand?: unknown;
  readonly commandName?: unknown;
  readonly args?: unknown;
  readonly categoryId?: unknown;
  readonly panelId?: unknown;
  readonly actionId?: unknown;
  readonly recordId?: unknown;
  readonly fields?: unknown;
  readonly combo?: unknown;
  readonly combos?: unknown;
  readonly surfaceId?: unknown;
  readonly key?: unknown;
  readonly value?: unknown;
  readonly target?: unknown;
  readonly capabilityId?: unknown;
  readonly toolName?: unknown;
  readonly category?: unknown;
  readonly prefix?: unknown;
  readonly includeHidden?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
  readonly pane?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

interface AgentHarnessToolDeps {
  readonly commandRegistry: CommandRegistry;
  readonly commandContext: CommandContext;
  readonly toolRegistry: ToolRegistry;
}

interface WorkspaceEditorContext {
  readonly runtimeStarterTemplates: AgentWorkspaceRuntimeSnapshot['runtimeStarterTemplates'];
  readonly selectedRoutine: AgentWorkspaceLocalLibraryItem | null;
}

function isMode(value: unknown): value is AgentHarnessMode {
  return typeof value === 'string' && AGENT_HARNESS_MODES.includes(value as AgentHarnessMode);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => typeof entry === 'string' ? entry : String(entry));
}

function readFieldMap(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry === 'string' ? entry : String(entry)]));
}

function output(value: unknown): { readonly success: true; readonly output: string } {
  return {
    success: true,
    output: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  };
}

function error(message: string): { readonly success: false; readonly error: string } { return { success: false, error: message }; }

function allWorkspaceActions(): ReadonlyArray<{
  readonly category: AgentWorkspaceCategory;
  readonly action: AgentWorkspaceAction;
}> {
  return AGENT_WORKSPACE_CATEGORIES.flatMap((category) => category.actions.map((action) => ({ category, action })));
}

function describeWorkspaceCategory(category: AgentWorkspaceCategory): Record<string, unknown> {
  return {
    id: category.id,
    group: category.group,
    label: category.label,
    summary: category.summary,
    detail: category.detail,
    actions: category.actions.length,
  };
}

function describeWorkspaceEditor(editor: AgentWorkspaceLocalEditor): Record<string, unknown> {
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

function selectedRoutineFromArgs(
  snapshot: AgentWorkspaceRuntimeSnapshot,
  args: AgentHarnessToolArgs,
): AgentWorkspaceLocalLibraryItem | null {
  const fields = readFieldMap(args.fields);
  const routineId = readString(args.recordId) || readString(fields.routineId) || readString(fields.id);
  if (!routineId) return null;
  return snapshot.localRoutines.find((routine) => routine.id === routineId || routine.name.toLowerCase() === routineId.toLowerCase()) ?? null;
}

function buildWorkspaceEditorContext(context: CommandContext, args: AgentHarnessToolArgs): WorkspaceEditorContext {
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

function createWorkspaceEditor(
  editorKind: AgentWorkspaceEditorKind,
  editorContext: WorkspaceEditorContext | null,
): AgentWorkspaceLocalEditor | null {
  return createAgentWorkspaceEditor(editorKind, {
    runtimeStarterTemplates: editorContext?.runtimeStarterTemplates ?? [],
    selectedRoutine: editorKind === 'routine-schedule' ? editorContext?.selectedRoutine ?? null : null,
  });
}

function describeWorkspaceAction(
  category: AgentWorkspaceCategory,
  action: AgentWorkspaceAction,
  options: { readonly includeEditor?: boolean; readonly editorContext?: WorkspaceEditorContext | null } = {},
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
    ...(action.command ? { command: action.command } : {}),
    ...(action.targetCategoryId ? { targetCategoryId: action.targetCategoryId } : {}),
    ...(action.editorKind ? { editorKind: action.editorKind } : {}),
    ...(action.localKind ? { localKind: action.localKind } : {}),
    ...(action.localOperation ? { localOperation: action.localOperation } : {}),
    ...(editor ? { editor: describeWorkspaceEditor(editor) } : {}),
    ...(action.kind === 'local-selection' || action.kind === 'local-operation' ? {
      modelExecution: describeLocalWorkspaceModelExecution(action),
    } : {}),
    ...(action.kind === 'editor' && action.editorKind && !isAgentWorkspaceCommandEditorKind(action.editorKind) ? {
      modelExecution: localEditorModelExecution(action.editorKind),
    } : {}),
  };
}

function localEditorModelExecution(editorKind: AgentWorkspaceEditorKind): string {
  if (editorKind === 'memory') return 'run_workspace_action can execute this editor from fields through agent_local_registry domain:"memory"; agent_local_registry also supports list/search/get/review/stale/delete.';
  if (editorKind === 'note') return 'run_workspace_action can execute this editor from fields through agent_local_registry domain:"note"; agent_local_registry also supports list/search/get/review/stale/delete.';
  if (editorKind === 'persona') return 'run_workspace_action can execute this editor from fields through agent_local_registry domain:"persona"; agent_local_registry also supports list/search/get/use/clear_active/review/stale/delete.';
  if (editorKind === 'skill') return 'run_workspace_action can execute this editor from fields through agent_local_registry domain:"skill"; agent_local_registry also supports list/search/get/enable/disable/review/stale/delete.';
  if (editorKind === 'routine') return 'run_workspace_action can execute this editor from fields through agent_local_registry domain:"routine"; agent_local_registry also supports list/search/get/enable/disable/start/review/stale/delete.';
  if (editorKind === 'learned-behavior') return 'run_workspace_action can create the learned behavior from fields.';
  if (editorKind === 'profile') return 'run_workspace_action dispatches the matching /agent-profile create command.';
  return 'Use the command field, editor schema, or a first-class Agent model tool when available.';
}

function listWorkspaceActions(deps: AgentHarnessToolDeps, args: AgentHarnessToolArgs): readonly Record<string, unknown>[] {
  const query = readString(args.query);
  const categoryId = readString(args.categoryId || args.category);
  const limit = readLimit(args.limit, 200);
  const includeEditor = args.includeParameters === true;
  const editorContext = includeEditor ? buildWorkspaceEditorContext(deps.commandContext, args) : null;
  const source = query
    ? searchAgentWorkspaceActions(AGENT_WORKSPACE_CATEGORIES, query).map((result) => ({ category: result.category, action: result.action }))
    : allWorkspaceActions();
  return source
    .filter((entry) => !categoryId || entry.category.id === categoryId)
    .slice(0, limit)
    .map((entry) => describeWorkspaceAction(entry.category, entry.action, { includeEditor, editorContext }));
}

function findWorkspaceAction(args: AgentHarnessToolArgs): { readonly category: AgentWorkspaceCategory; readonly action: AgentWorkspaceAction } | null {
  const actionId = readString(args.actionId || args.query);
  const categoryId = readString(args.categoryId || args.category);
  if (!actionId) return null;
  return allWorkspaceActions().find((entry) => {
    if (categoryId && entry.category.id !== categoryId) return false;
    return entry.action.id === actionId || entry.action.label.toLowerCase() === actionId.toLowerCase();
  }) ?? null;
}

function requireConfirmedAction(args: AgentHarnessToolArgs, action: string): string | null {
  const explicitUserRequest = readString(args.explicitUserRequest);
  if (!explicitUserRequest) return `${action} requires explicitUserRequest with the user's exact request or a short faithful summary.`;
  if (args.confirm !== true) return `${action} requires confirm:true after an explicit user request.`;
  return null;
}

function commandFromArgs(args: AgentHarnessToolArgs): { readonly name: string; readonly args: readonly string[] } | null {
  const rawCommand = readString(args.command);
  if (rawCommand) {
    const parsed = parseSlashCommand(rawCommand);
    if (!parsed.name) return null;
    return {
      name: parsed.name,
      args: parsed.args,
    };
  }
  const commandName = readString(args.commandName).replace(/^\//, '');
  if (!commandName) return null;
  const commandArgs = readStringArray(args.args);
  return {
    name: commandName,
    args: commandArgs,
  };
}

function safeCommandDisplay(name: string): string {
  return `/${name}`;
}

async function runCommand(deps: AgentHarnessToolDeps, args: AgentHarnessToolArgs): Promise<{ readonly success: boolean; readonly output?: string; readonly error?: string }> {
  const confirmationError = requireConfirmedAction(args, 'Slash command invocation');
  if (confirmationError) return error(confirmationError);
  const parsed = commandFromArgs(args);
  if (!parsed) return error('run_command requires command or commandName.');
  if (!deps.commandRegistry.get(parsed.name)) return error(`Unknown slash command /${parsed.name}. Use mode:"commands" to inspect available commands.`);

  const printed: string[] = [];
  const toolContext: CommandContext = {
    ...deps.commandContext,
    print: (text: string) => {
      printed.push(text);
    },
    renderRequest: () => {},
    executeCommand: async (name: string, commandArgs: string[]) => {
      return deps.commandRegistry.execute(name, commandArgs, toolContext);
    },
  };
  const handled = await deps.commandRegistry.execute(parsed.name, [...parsed.args], toolContext);
  if (!handled) return error(`Unknown slash command /${parsed.name}.`);
  return output([
    `Command ${safeCommandDisplay(parsed.name)} completed.`,
    printed.length > 0 ? printed.join('\n') : '(no text output)',
  ].join('\n'));
}

function fieldReader(editor: AgentWorkspaceLocalEditor, fields: Readonly<Record<string, string>>): (fieldId: string) => string {
  return (fieldId: string) => fields[fieldId] ?? editor.fields.find((field) => field.id === fieldId)?.value ?? '';
}

function missingRequiredEditorFields(editor: AgentWorkspaceLocalEditor, fields: Readonly<Record<string, string>>): readonly string[] {
  const readField = fieldReader(editor, fields);
  return editor.fields
    .filter((field) => field.required && !readField(field.id).trim())
    .map((field) => field.id);
}

async function runWorkspaceEditorAction(
  deps: AgentHarnessToolDeps,
  action: AgentWorkspaceAction,
  editor: AgentWorkspaceLocalEditor,
  args: AgentHarnessToolArgs,
): Promise<{ readonly success: boolean; readonly output?: string; readonly error?: string }> {
  const fields = readFieldMap(args.fields);
  const missing = missingRequiredEditorFields(editor, fields);
  if (missing.length > 0) {
    return output({
      status: 'missing_required_fields',
      missing,
      action: action.id,
      editor: describeWorkspaceEditor(editor),
    });
  }

  if (editor.kind === 'learned-behavior') {
    const confirmationError = requireConfirmedAction(args, 'Workspace learned-behavior capture');
    if (confirmationError) return error(confirmationError);
    const shellPaths = deps.commandContext.workspace.shellPaths;
    if (!shellPaths) return error('Agent shell paths are unavailable.');
    const readField = fieldReader(editor, fields);
    const target = readField('target').trim().toLowerCase();
    if (target !== 'skill' && target !== 'routine' && target !== 'persona') {
      return error('learned-behavior target must be skill, routine, or persona.');
    }
    const created = createAgentWorkspaceLearnedBehavior(shellPaths, {
      target,
      name: readField('name'),
      description: readField('description'),
      notes: readField('notes'),
      tags: splitList(readField('tags')),
      triggers: splitList(readField('triggers')),
      enable: isAffirmative(readField('enable')),
    });
    return output({
      status: 'created',
      kind: created.kind,
      id: created.id,
      name: created.name,
      policy: 'Agent-local behavior only; no connected-host mutation, default knowledge write, or delegated job was created.',
    });
  }

  if (editor.kind === 'profile') {
    const readField = fieldReader(editor, fields);
    const name = readField('name');
    const template = readField('template');
    const parts = ['/agent-profile', 'create', name];
    if (template.trim() && template.trim().toLowerCase() !== 'none') parts.push('--template', template);
    parts.push('--yes');
    return runCommand(deps, {
      ...args,
      command: parts.map((part, index) => index < 2 || part.startsWith('--') ? part : JSON.stringify(part)).join(' '),
    });
  }

  if (!isAgentWorkspaceCommandEditorKind(editor.kind)) {
    if (
      editor.kind === 'memory'
      || editor.kind === 'note'
      || editor.kind === 'persona'
      || editor.kind === 'skill'
      || editor.kind === 'routine'
    ) {
      return runLocalWorkspaceEditorAction(deps, editor, args);
    }
    return output({
      status: 'model_tool_required',
      action: action.id,
      editor: describeWorkspaceEditor(editor),
      modelExecution: localEditorModelExecution(editor.kind),
    });
  }

  const submission = buildAgentWorkspaceCommandEditorSubmission(
    editor,
    fieldReader(editor, fields),
    true,
    true,
  );
  if (submission.kind === 'editor') {
    return output({
      status: submission.status,
      action: action.id,
      editor: describeWorkspaceEditor(submission.editor),
      actionResult: submission.actionResult ?? null,
    });
  }
  if (submission.kind === 'prompt') {
    return output({
      status: submission.status,
      action: action.id,
      prompt: submission.prompt,
      actionResult: submission.actionResult,
      note: 'This workspace action submits a normal main-conversation prompt in the TUI. In model-tool context, use the returned prompt as the conversation task instead of creating a hidden nested turn.',
    });
  }
  return runCommand(deps, {
    ...args,
    command: submission.command,
  });
}

async function runWorkspaceAction(
  deps: AgentHarnessToolDeps,
  args: AgentHarnessToolArgs,
): Promise<{ readonly success: boolean; readonly output?: string; readonly error?: string }> {
  const found = findWorkspaceAction(args);
  if (!found) return error('run_workspace_action requires a valid actionId. Use mode:"workspace_actions" to inspect available actions.');
  const { category, action } = found;

  if (action.safety === 'blocked') {
    return error(`Workspace action ${action.id} is blocked in Agent: ${action.detail}`);
  }
  if (action.kind === 'guidance') {
    const editorContext = buildWorkspaceEditorContext(deps.commandContext, args);
    return output({
      status: 'guidance',
      action: describeWorkspaceAction(category, action, { includeEditor: true, editorContext }),
    });
  }
  if (action.kind === 'workspace' && action.targetCategoryId) {
    const target = AGENT_WORKSPACE_CATEGORIES.find((entry) => entry.id === action.targetCategoryId);
    return output({
      status: 'workspace_target',
      action: describeWorkspaceAction(category, action),
      targetCategory: target ? describeWorkspaceCategory(target) : action.targetCategoryId,
      targetActions: target ? target.actions.map((entry) => describeWorkspaceAction(target, entry)).slice(0, 40) : [],
    });
  }
  if (action.kind === 'command' && action.command) {
    if (/<[^>\s]+(?:\s+[^>]*)?>/.test(action.command)) {
      return output({
        status: 'needs_concrete_command',
        action: describeWorkspaceAction(category, action),
        note: 'This workspace action is a command template. Provide concrete values with mode:"run_command" once the exact command is known.',
      });
    }
    return runCommand(deps, { ...args, command: action.command });
  }
  if (action.kind === 'editor' && action.editorKind) {
    const editor = createWorkspaceEditor(action.editorKind, buildWorkspaceEditorContext(deps.commandContext, args));
    if (!editor) return error(`No workspace editor bridge exists for ${action.editorKind}.`);
    return runWorkspaceEditorAction(deps, action, editor, args);
  }
  if (action.kind === 'local-selection' || action.kind === 'local-operation') {
    return runLocalWorkspaceAction(deps, action, args);
  }
  const editorContext = buildWorkspaceEditorContext(deps.commandContext, args);
  return output({
    status: 'no_direct_effect',
    action: describeWorkspaceAction(category, action, { includeEditor: true, editorContext }),
  });
}

export function createAgentHarnessTool(deps: AgentHarnessToolDeps): Tool {
  return {
    definition: {
      name: 'agent_harness',
      description: [
        'Discover and operate the GoodVibes Agent harness from the main conversation.',
        'Use this tool to inspect Agent workspace actions, built-in panels, top-level CLI mirrors, UI surfaces, keybindings, slash commands with policy metadata, model tools or one model tool schema, connected-host capabilities or one connected-host capability detail, and Agent settings, or to invoke a workspace action/command through the same in-process command registry the user uses in the TUI.',
        'Discovery modes are read-only. Setting/keybinding writes, resets, UI routing, slash command invocation, and workspace action invocation require confirm:true plus explicitUserRequest.',
        'This tool preserves Agent product boundaries: connected-host lifecycle and listener posture stay externally owned, connected-host mode reports allowed and blocked route families, and secret-backed settings store raw values through the secret manager while config receives only a secret reference.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: AGENT_HARNESS_PARAMETER_PROPERTIES,
        required: ['mode'],
        additionalProperties: false,
      },
      sideEffects: ['state'],
      concurrency: 'serial',
    },
    execute: async (rawArgs) => {
      const args = rawArgs as AgentHarnessToolArgs;
      if (!isMode(args.mode)) return error(`Unknown agent_harness mode: ${String(args.mode)}`);
      try {
        if (args.mode === 'summary') {
          return output({
            cliCommands: totalHarnessCliCommands(),
            blockedCliCommandTokens: blockedHarnessCliCommandTokens(),
            panels: totalHarnessPanels(deps.commandContext),
            uiSurfaces: totalHarnessUiSurfaces(),
            shortcuts: totalHarnessShortcuts(deps.commandContext),
            keybindings: totalHarnessKeybindings(deps.commandContext),
            commands: deps.commandRegistry.list().length,
            settings: deps.commandContext.platform.configManager.getSchema().length,
            workspaceCategories: AGENT_WORKSPACE_CATEGORIES.length,
            workspaceActions: allWorkspaceActions().length,
            tools: deps.toolRegistry.getToolDefinitions().length,
            modelAccess: {
              cliCommands: 'Use mode:"cli_commands" and mode:"cli_command" to inspect package CLI mirrors and their preferred in-process model routes. CLI modes are discovery-only.',
              panels: 'Use mode:"panels" and mode:"panel" to inspect built-in panel catalog/open state; use mode:"open_panel" with confirm:true plus explicitUserRequest to route a visible panel/workspace change.',
              uiSurfaces: 'Use mode:"ui_surfaces" and mode:"ui_surface" to inspect modal/overlay/picker/workspace surfaces; use mode:"open_ui_surface" with confirm:true plus explicitUserRequest to route visible UI navigation.',
              shortcuts: 'Use mode:"shortcuts" to inspect fixed shortcuts plus configurable keybindings. Use mode:"set_keybinding" and mode:"reset_keybinding" with confirm:true plus explicitUserRequest to edit the same config file the user edits.',
              slashCommands: 'Use mode:"commands" to list slash commands and mode:"command" with command, commandName, target, or query to inspect one command; use mode:"run_command" with confirm:true plus explicitUserRequest to execute.',
              workspace: 'Use mode:"workspace_actions" to list and mode:"workspace_action" for editor schemas; set includeParameters:true on workspace_actions to inline editor schemas.',
              settings: 'Use mode:"settings", mode:"get_setting", mode:"set_setting", and mode:"reset_setting".',
              tools: 'Use mode:"tools" to list first-class model tools, or mode:"tool" with toolName, target, or query to inspect one schema.',
              connectedHost: 'Use mode:"connected_host" for the connected-host capability map and blocked boundaries. Use mode:"connected_host_capability" with capabilityId, target, or query for one allowed or blocked capability.',
              connectedHostStatus: 'Use mode:"connected_host_status" for live read-only host reachability, SDK compatibility, token posture, and Agent Knowledge route readiness.',
            },
            settingsPolicy: settingsPolicySummary(),
            connectedHost: connectedHostSummary(deps.commandContext, deps.toolRegistry),
          });
        }
        if (args.mode === 'cli_commands') {
          const commands = listHarnessCliCommands(args);
          return output({
            commands,
            returned: commands.length,
            total: totalHarnessCliCommands(),
            blockedTokens: blockedHarnessCliCommandTokens(),
            policy: 'CLI modes are read-only discovery. Use first-class model tools, workspace actions, settings modes, or confirmed slash-command mirrors for in-process operation.',
          });
        }
        if (args.mode === 'cli_command') {
          return output(describeHarnessCliCommand(args));
        }
        if (args.mode === 'panels') {
          const panels = listHarnessPanels(deps.commandContext, args);
          return output({
            panels,
            returned: panels.length,
            total: totalHarnessPanels(deps.commandContext),
            policy: 'Panel modes expose Agent/TUI operator view catalog and open state. open_panel is confirmation-gated and routes through the current Agent shell bridge.',
          });
        }
        if (args.mode === 'panel') {
          const panel = describeHarnessPanel(deps.commandContext, args);
          return panel ? output(panel) : error(`Unknown panel ${readString(args.panelId || args.query) || '<missing>'}.`);
        }
        if (args.mode === 'open_panel') {
          const confirmationError = requireConfirmedAction(args, 'Panel routing');
          if (confirmationError) return error(confirmationError);
          return output(openHarnessPanel(deps.commandContext, args));
        }
        if (args.mode === 'ui_surfaces') {
          const surfaces = listHarnessUiSurfaces(deps.commandContext, args);
          return output({ surfaces, returned: surfaces.length, total: totalHarnessUiSurfaces() });
        }
        if (args.mode === 'ui_surface') {
          const surface = describeHarnessUiSurface(deps.commandContext, args);
          return surface ? output(surface) : error(`Unknown UI surface ${readString(args.surfaceId || args.query) || '<missing>'}.`);
        }
        if (args.mode === 'open_ui_surface') {
          const confirmationError = requireConfirmedAction(args, 'UI surface routing');
          if (confirmationError) return error(confirmationError);
          return output(await openHarnessUiSurface(deps.commandContext, args));
        }
        if (args.mode === 'shortcuts') return output(listHarnessShortcuts(deps.commandContext, args));
        if (args.mode === 'keybindings') return output(listHarnessKeybindings(deps.commandContext, args));
        if (args.mode === 'keybinding') {
          const binding = describeHarnessKeybinding(deps.commandContext, args);
          return binding ? output(binding) : error(`Unknown keybinding action ${readString(args.actionId || args.key || args.query) || '<missing>'}.`);
        }
        if (args.mode === 'set_keybinding') {
          const confirmationError = requireConfirmedAction(args, 'Keybinding mutation');
          if (confirmationError) return error(confirmationError);
          return output(setHarnessKeybinding(deps.commandContext, args));
        }
        if (args.mode === 'reset_keybinding') {
          const confirmationError = requireConfirmedAction(args, 'Keybinding reset');
          if (confirmationError) return error(confirmationError);
          return output(resetHarnessKeybinding(deps.commandContext, args));
        }
        if (args.mode === 'commands') {
          const commands = listHarnessCommands(deps.commandRegistry, args);
          return output({ commands, returned: commands.length, total: deps.commandRegistry.list().length });
        }
        if (args.mode === 'command') {
          const detail = describeHarnessCommand(deps.commandRegistry, args);
          const query = readString(args.command || args.commandName || args.target || args.query);
          return detail
            ? output(detail)
            : error(`Unknown slash command ${query || '<missing>'}. Use mode:"commands" to inspect available commands.`);
        }
        if (args.mode === 'run_command') return runCommand(deps, args);
        if (args.mode === 'settings') {
          const settings = listHarnessSettings(deps.commandContext.platform.configManager, {
            category: readString(args.category) || undefined,
            prefix: readString(args.prefix) || undefined,
            query: readString(args.query) || undefined,
            includeHidden: args.includeHidden === true,
            limit: readLimit(args.limit, 100),
          });
          return output({ settings, returned: settings.length, policy: settingsPolicySummary() });
        }
        if (args.mode === 'get_setting') {
          const key = readString(args.key);
          const setting = getHarnessSetting(deps.commandContext.platform.configManager, key);
          return setting ? output(setting) : error(`Unknown setting ${key || '<missing>'}.`);
        }
        if (args.mode === 'set_setting') {
          const confirmationError = requireConfirmedAction(args, 'Setting mutation');
          if (confirmationError) return error(confirmationError);
          if (args.value === undefined) return error('set_setting requires value.');
          const key = readString(args.key);
          const result = await setHarnessSetting(
            deps.commandContext.platform.configManager,
            deps.commandContext.platform.secretsManager,
            key,
            args.value,
          );
          return output(result);
        }
        if (args.mode === 'reset_setting') {
          const confirmationError = requireConfirmedAction(args, 'Setting reset');
          if (confirmationError) return error(confirmationError);
          const key = readString(args.key);
          const result = await resetHarnessSetting(
            deps.commandContext.platform.configManager,
            deps.commandContext.platform.secretsManager,
            key,
          );
          return output(result);
        }
        if (args.mode === 'workspace' || args.mode === 'workspace_categories') {
          return output({
            categories: AGENT_WORKSPACE_CATEGORIES.map(describeWorkspaceCategory),
            actions: allWorkspaceActions().length,
          });
        }
        if (args.mode === 'workspace_actions') {
          const actions = listWorkspaceActions(deps, args);
          return output({ actions, returned: actions.length, total: allWorkspaceActions().length });
        }
        if (args.mode === 'workspace_action') {
          const found = findWorkspaceAction(args);
          const editorContext = buildWorkspaceEditorContext(deps.commandContext, args);
          return found
            ? output(describeWorkspaceAction(found.category, found.action, { includeEditor: true, editorContext }))
            : error(`Unknown Agent workspace action ${readString(args.actionId || args.query) || '<missing>'}.`);
        }
        if (args.mode === 'run_workspace_action') return runWorkspaceAction(deps, args);
        if (args.mode === 'tools') {
          const tools = listHarnessModelTools(deps.toolRegistry, args);
          return output({ tools, returned: tools.length, total: deps.toolRegistry.getToolDefinitions().length });
        }
        if (args.mode === 'tool') {
          const query = readString(args.toolName || args.target || args.query);
          const tool = describeHarnessModelTool(deps.toolRegistry, args);
          return tool
            ? output(tool)
            : error(`Unknown model tool ${query || '<missing>'}. Use mode:"tools" to inspect available model tools.`);
        }
        if (args.mode === 'connected_host') return output(connectedHostSummary(deps.commandContext, deps.toolRegistry));
        if (args.mode === 'connected_host_capability') {
          const query = readString(args.capabilityId || args.target || args.query);
          const capability = describeConnectedHostCapability(deps.toolRegistry, query);
          return capability
            ? output(capability)
            : error(`Unknown connected-host capability ${query || '<missing>'}. Use mode:"connected_host" to inspect allowed and blocked capability ids.`);
        }
        if (args.mode === 'connected_host_status') return output(await connectedHostStatusSummary(deps.commandContext, deps.toolRegistry));
        return error(`Unhandled agent_harness mode: ${args.mode}`);
      } catch (err) {
        return error(formatHarnessError(err));
      }
    },
  };
}

export function registerAgentHarnessTool(
  registry: ToolRegistry,
  commandRegistry: CommandRegistry,
  commandContext: CommandContext,
): void {
  registry.register(createAgentHarnessTool({
    commandRegistry,
    commandContext,
    toolRegistry: registry,
  }));
}
