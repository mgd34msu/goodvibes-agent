import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_WORKSPACE_CATEGORIES } from '../../input/agent-workspace-categories.ts';
import { AgentWorkspace } from '../../input/agent-workspace.ts';
import { activateAgentWorkspaceSelection } from '../../input/agent-workspace-activation.ts';
import type {
  AgentWorkspaceAction,
  AgentWorkspaceActionResult,
  AgentWorkspaceCategory,
  AgentWorkspaceFocusPane,
  AgentWorkspaceLocalEditor,
  AgentWorkspaceLocalEditorKind,
  AgentWorkspaceLocalLibraryItem,
  AgentWorkspaceLocalOperation,
} from '../../input/agent-workspace-types.ts';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerBuiltinCommands } from '../../input/commands.ts';

const ROOT = join(import.meta.dir, '../../..');

interface WorkspaceCoverage {
  readonly commandRoots: ReadonlySet<string>;
  readonly actionIds: ReadonlySet<string>;
  readonly categoryIds: ReadonlySet<string>;
  readonly editorKinds: ReadonlySet<string>;
}

interface CoverageRequirement {
  readonly commandRoots?: readonly string[];
  readonly actionIds?: readonly string[];
  readonly categoryIds?: readonly string[];
  readonly editorPrefixes?: readonly string[];
}

function parseCliCommands(): readonly string[] {
  const source = readFileSync(join(ROOT, 'src/cli/types.ts'), 'utf-8');
  const unionMatch = source.match(/export type GoodVibesCliCommand =([\s\S]*?);/);
  if (!unionMatch) return [];
  return [...unionMatch[1]!.matchAll(/\|\s*'([^']+)'/g)].map((match) => match[1]!).sort();
}

function commandRoot(command: string): string {
  return command.trim().replace(/^\//, '').split(/\s+/)[0] ?? '';
}

function makeCommandContext(): CommandContext {
  return {
    executeCommand: async () => true,
    print: () => {},
  } as unknown as CommandContext;
}

function makeRegisteredCommands(): CommandRegistry {
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry);
  return registry;
}

function collectWorkspaceCoverage(): WorkspaceCoverage {
  const commandRoots = new Set<string>();
  const actionIds = new Set<string>();
  const categoryIds = new Set<string>();
  const editorKinds = new Set<string>();

  for (const category of AGENT_WORKSPACE_CATEGORIES) {
    categoryIds.add(category.id);
    for (const action of category.actions) {
      actionIds.add(action.id);
      if (action.command) commandRoots.add(commandRoot(action.command));
      if (action.editorKind) editorKinds.add(action.editorKind);
    }
  }

  return { commandRoots, actionIds, categoryIds, editorKinds };
}

function hasCoverage(coverage: WorkspaceCoverage, requirement: CoverageRequirement): boolean {
  for (const root of requirement.commandRoots ?? []) {
    if (coverage.commandRoots.has(root)) return true;
  }
  for (const id of requirement.actionIds ?? []) {
    if (coverage.actionIds.has(id)) return true;
  }
  for (const id of requirement.categoryIds ?? []) {
    if (coverage.categoryIds.has(id)) return true;
  }
  for (const prefix of requirement.editorPrefixes ?? []) {
    for (const kind of coverage.editorKinds) {
      if (kind.startsWith(prefix)) return true;
    }
  }
  return false;
}

describe('Agent workspace command parity', () => {
  test('unsupported editor kinds fail closed instead of falling back to a local editor', () => {
    const malformedAction = {
      id: 'bad-editor',
      label: 'Bad editor',
      detail: 'This malformed action should never open a fallback editor.',
      editorKind: 'unknown-editor' as unknown as AgentWorkspaceAction['editorKind'],
      kind: 'editor',
      safety: 'safe',
    } satisfies AgentWorkspaceAction;
    const category: AgentWorkspaceCategory = {
      id: 'bad-category',
      group: 'START', // test fixture — real group not needed for this structural test
      label: 'Bad Category',
      summary: 'Malformed test category.',
      detail: 'Malformed test category.',
      actions: [malformedAction],
    };
    const host = {
      categories: [category],
      selectedCategory: category,
      selectedAction: malformedAction,
      runtimeSnapshot: null,
      localEditor: null as AgentWorkspaceLocalEditor | null,
      focusPane: 'actions' as AgentWorkspaceFocusPane,
      selectedCategoryIndex: 0,
      selectedActionIndex: 0,
      status: '',
      lastActionResult: null as AgentWorkspaceActionResult | null,
      submitEditorFieldOrForm: () => {},
      focusActions: () => {},
      clampSelection: () => {},
      moveLocalLibraryItemSelection: (_kind: AgentWorkspaceLocalEditorKind, _delta: number) => {},
      selectedLocalLibraryItem: (_kind: AgentWorkspaceLocalEditorKind): AgentWorkspaceLocalLibraryItem | null => null,
      applyLocalLibraryOperation: (_operation: AgentWorkspaceLocalOperation) => {},
      hasCommandDispatch: () => true,
      dispatchWorkspaceCommand: (_command: string, _behavior?: 'inline' | 'compose' | 'exit') => {},
      commitActionSearchSelection: () => true,
    };

    activateAgentWorkspaceSelection(host);

    expect(host.localEditor).toBeNull();
    expect(host.status).toBe('Editor unavailable: unknown-editor.');
    expect(host.lastActionResult).toEqual({
      kind: 'error',
      title: 'Editor unavailable',
      detail: 'No Agent workspace editor exists for unknown-editor.',
      safety: 'safe',
    });
  });

  test('workspace actions point to registered commands, real categories, and concrete editors', () => {
    const registry = makeRegisteredCommands();
    const categoryIds = new Set(AGENT_WORKSPACE_CATEGORIES.map((category) => category.id));
    const seenActionIds = new Set<string>();
    const failures: string[] = [];

    for (const category of AGENT_WORKSPACE_CATEGORIES) {
      for (let actionIndex = 0; actionIndex < category.actions.length; actionIndex += 1) {
        const action = category.actions[actionIndex]!;
        const actionRef = `${category.id}/${action.id}`;

        if (seenActionIds.has(action.id)) failures.push(`${actionRef}: duplicate action id`);
        seenActionIds.add(action.id);

        if (action.command) {
          const root = commandRoot(action.command);
          if (registry.get(root) === undefined) failures.push(`${actionRef}: unregistered command root ${root}`);
          if (/<[^>\s]+(?:\s+[^>]*)?>/.test(action.command)) failures.push(`${actionRef}: template command ${action.command}`);
        }
        if (action.targetCategoryId && !categoryIds.has(action.targetCategoryId)) {
          failures.push(`${actionRef}: unknown target category ${action.targetCategoryId}`);
        }
        if (action.kind === 'editor') {
          if (!action.editorKind) {
            failures.push(`${actionRef}: editor action has no editorKind`);
            continue;
          }
          const workspace = new AgentWorkspace();
          workspace.open(makeCommandContext(), () => {}, category.id);
          workspace.selectedActionIndex = workspace.actions.findIndex((entry) => entry.id === action.id);
          if (workspace.selectedActionIndex < 0) {
            failures.push(`${actionRef}: editor action is not visible`);
            continue;
          }
          workspace.activateSelected();
          if (!workspace.localEditor) {
            failures.push(`${actionRef}: did not open an editor`);
          } else {
            if (workspace.localEditor.kind !== action.editorKind) {
              failures.push(`${actionRef}: opened ${workspace.localEditor.kind} instead of ${action.editorKind}`);
            }
            if (workspace.localEditor.fields.length === 0) {
              failures.push(`${actionRef}: opened editor without fields`);
            }
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });

  test.skip('product CLI commands have TUI workspace coverage unless they are pure shell utilities', () => {
    const coverage = collectWorkspaceCoverage();
    const shellOnlyCommands = new Set(['completion', 'help', 'tui', 'unknown', 'version']);
    const requirements: Record<string, CoverageRequirement> = {
      ask: { categoryIds: ['knowledge'], editorPrefixes: ['knowledge-ask'] },
      auth: { commandRoots: ['auth'], editorPrefixes: ['auth-'] },
      bundle: { commandRoots: ['bundle'], editorPrefixes: ['support-bundle-', 'trust-bundle-', 'auth-bundle-', 'subscription-bundle-'] },
      compat: { commandRoots: ['compat'] },
      delegate: { commandRoots: ['delegate'], editorPrefixes: ['delegate-'] },
      doctor: { commandRoots: ['doctor'] },
      knowledge: { commandRoots: ['knowledge'], categoryIds: ['knowledge'] },
      memory: { commandRoots: ['memory'], categoryIds: ['memory'], editorPrefixes: ['memory'] },
      models: { commandRoots: ['model'], editorPrefixes: ['model-'] },
      onboarding: { commandRoots: ['setup'], categoryIds: ['setup'] },
      pair: { commandRoots: ['pair'] },
      personas: { commandRoots: ['personas'], categoryIds: ['personas'], editorPrefixes: ['persona'] },
      profiles: { commandRoots: ['agent-profile'], categoryIds: ['profiles'], editorPrefixes: ['profile'] },
      providers: { commandRoots: ['provider', 'accounts'], editorPrefixes: ['provider-'] },
      routines: { commandRoots: ['routines'], categoryIds: ['routines'], editorPrefixes: ['routine'] },
      run: { actionIds: ['chat'] },
      search: { categoryIds: ['knowledge'], editorPrefixes: ['knowledge-search'] },
      secrets: { commandRoots: ['secrets'], editorPrefixes: ['secret-'] },
      sessions: { commandRoots: ['sessions'], editorPrefixes: ['session-'] },
      skills: { commandRoots: ['skills'], categoryIds: ['skills'], editorPrefixes: ['skill'] },
      status: { commandRoots: ['health', 'doctor', 'compat'] },
      subscription: { commandRoots: ['subscription'], editorPrefixes: ['subscription-'] },
      tasks: { commandRoots: ['tasks'], editorPrefixes: ['task-'] },
    };

    const missing = parseCliCommands()
      .filter((command) => !shellOnlyCommands.has(command))
      .filter((command) => !hasCoverage(coverage, requirements[command] ?? {}));

    expect(missing).toEqual([]);
  });
});
