import { describe, expect, mock, test } from 'bun:test';
import {
  evaluateProjectPlanningReadiness,
  type ProjectPlanningEvaluation,
  type ProjectPlanningService,
  type ProjectPlanningState,
} from '@pellux/goodvibes-sdk/platform/knowledge';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerPlanningRuntimeCommands } from '../../input/commands/planning-runtime.ts';
import type { PlanRuntimeService } from '../../runtime/index.ts';

function makeState(input: Partial<ProjectPlanningState> = {}): ProjectPlanningState {
  const now = Date.now();
  return {
    id: input.id ?? 'current',
    projectId: input.projectId ?? 'proj',
    knowledgeSpaceId: input.knowledgeSpaceId ?? 'project:proj',
    goal: input.goal ?? '',
    scope: input.scope,
    knownContext: input.knownContext ?? [],
    openQuestions: input.openQuestions ?? [],
    answeredQuestions: input.answeredQuestions ?? [],
    decisions: input.decisions ?? [],
    assumptions: input.assumptions ?? [],
    constraints: input.constraints ?? [],
    risks: input.risks ?? [],
    tasks: input.tasks ?? [],
    dependencies: input.dependencies ?? [],
    verificationGates: input.verificationGates ?? [],
    agentAssignments: input.agentAssignments ?? [],
    readiness: input.readiness ?? 'not-ready',
    executionApproved: input.executionApproved ?? false,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    metadata: input.metadata ?? {},
  };
}

function makeService(initial: ProjectPlanningState | null = null): {
  readonly service: ProjectPlanningService;
  readonly state: () => ProjectPlanningState | null;
} {
  let state = initial;
  const service = {
    async status() {
      return {
        ok: true,
        projectId: 'proj',
        knowledgeSpaceId: 'project:proj',
        passiveOnly: true,
        counts: { states: state ? 1 : 0, decisions: 0, languageArtifacts: 0 },
        capabilities: ['project-scoped-storage'],
      };
    },
    async getState() {
      return { ok: true, projectId: 'proj', knowledgeSpaceId: 'project:proj', state };
    },
    async upsertState(input: { state: Partial<ProjectPlanningState> }) {
      state = evaluateProjectPlanningReadiness(makeState(input.state)).state;
      return { ok: true, projectId: 'proj', knowledgeSpaceId: 'project:proj', state };
    },
    async evaluate(input?: { state?: Partial<ProjectPlanningState> }): Promise<ProjectPlanningEvaluation> {
      return evaluateProjectPlanningReadiness(makeState(input?.state ?? state ?? {}));
    },
  };
  return {
    service: service as unknown as ProjectPlanningService,
    state: () => state,
  };
}

function makeContext(
  service: ProjectPlanningService,
  out: string[],
  opened: string[],
  planRuntime?: PlanRuntimeService,
): CommandContext {
  return {
    print: (message: string) => out.push(message),
    showPanel: (panelId: string) => { opened.push(panelId); },
    session: {
      runtime: {
        model: 'gpt-test',
        provider: 'test',
        debugMode: false,
        systemPrompt: '',
        reasoningEffort: 'medium',
        sessionId: 'session',
      },
      conversationManager: {},
      sessionLineageTracker: {
        setOriginalTask: () => {},
      },
    },
    workspace: {
      projectPlanningService: service,
      projectPlanningProjectId: 'proj',
    },
    ops: {
      planManager: {
        getActive: () => null,
        getSummary: () => '',
        list: () => [],
        toMarkdown: () => '',
      },
      ...(planRuntime ? { planRuntime } : {}),
    },
    provider: {},
    platform: {},
    extensions: {},
    renderRequest: () => {},
    exit: () => {},
  } as unknown as CommandContext;
}

describe('/plan project planning runtime command', () => {
  test('seeding a plan persists the first SDK next question as open state', async () => {
    const registry = new CommandRegistry();
    registerPlanningRuntimeCommands(registry);
    const out: string[] = [];
    const opened: string[] = [];
    const fake = makeService();

    await registry.execute('plan', ['replace', 'the', 'planning', 'panel'], makeContext(fake.service, out, opened));

    expect(opened).toContain('project-planning');
    expect(out.join('\n')).toContain('Answer in the prompt, or focus the Planning workspace');
    expect(fake.state()?.knownContext.join('\n')).toContain('Agent /plan command');
    expect(fake.state()?.metadata?.['active']).toBe(true);
    expect(fake.state()?.metadata?.['owner']).toBe('agent');
    expect(fake.state()?.openQuestions.length).toBeGreaterThan(0);
  });

  test('/plan approve requires --yes before approving execution state', async () => {
    const registry = new CommandRegistry();
    registerPlanningRuntimeCommands(registry);
    const out: string[] = [];
    const opened: string[] = [];
    const fake = makeService(makeState({ executionApproved: false }));
    const ctx = makeContext(fake.service, out, opened);

    await registry.execute('plan', ['approve'], ctx);

    expect(fake.state()?.executionApproved).toBe(false);
    expect(opened).toHaveLength(0);
    expect(out.join('\n')).toContain('Refusing to approve project planning state for execution without --yes');

    out.length = 0;
    await registry.execute('plan', ['approve', '--yes'], ctx);

    expect(fake.state()?.executionApproved).toBe(true);
    expect(fake.state()?.metadata?.['approvedFrom']).toBe('plan-command');
    expect(opened).toContain('project-planning');
    expect(out.join('\n')).toContain('Project planning approved');
  });

  test('/plan override and clear require --yes before calling the planner runtime bridge', async () => {
    const registry = new CommandRegistry();
    registerPlanningRuntimeCommands(registry);
    const out: string[] = [];
    const opened: string[] = [];
    const fake = makeService();
    const planRuntime = mock((subcommand: string, args: string[]) => ({
      ok: true,
      output: `runtime:${subcommand}:${args.join(',')}`,
    }));
    const ctx = makeContext(fake.service, out, opened, planRuntime);

    await registry.execute('plan', ['override', 'serial'], ctx);

    expect(planRuntime).toHaveBeenCalledTimes(0);
    expect(out.join('\n')).toContain('Refusing to override planner runtime state without --yes');

    out.length = 0;
    await registry.execute('plan', ['override', 'serial', '--yes'], ctx);

    expect(planRuntime).toHaveBeenCalledWith('override', ['serial']);
    expect(out.join('\n')).toContain('runtime:override:serial');

    out.length = 0;
    await registry.execute('plan', ['clear'], ctx);

    expect(planRuntime).toHaveBeenCalledTimes(1);
    expect(out.join('\n')).toContain('Refusing to clear planner runtime state without --yes');

    out.length = 0;
    await registry.execute('plan', ['clear', '--yes'], ctx);

    expect(planRuntime).toHaveBeenCalledWith('clear', []);
    expect(planRuntime).toHaveBeenCalledTimes(2);
  });
});
