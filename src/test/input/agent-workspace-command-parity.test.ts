import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_WORKSPACE_CATEGORIES } from '../../input/agent-workspace-categories.ts';

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
  return Boolean(
    requirement.commandRoots?.some((root) => coverage.commandRoots.has(root))
    || requirement.actionIds?.some((id) => coverage.actionIds.has(id))
    || requirement.categoryIds?.some((id) => coverage.categoryIds.has(id))
    || requirement.editorPrefixes?.some((prefix) => [...coverage.editorKinds].some((kind) => kind.startsWith(prefix))),
  );
}

describe('Agent workspace command parity', () => {
  test('product CLI commands have TUI workspace coverage unless they are pure shell utilities', () => {
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
