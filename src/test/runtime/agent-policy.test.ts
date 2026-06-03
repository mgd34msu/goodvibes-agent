import { afterEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { normalizeEverySchedule } from '@pellux/goodvibes-sdk/platform/automation';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import { createRuntimeServices } from '../../runtime/services.ts';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { registerBuiltinCommands } from '../../input/commands.ts';
import { registerDelegationRuntimeCommands } from '../../input/commands/delegation-runtime.ts';
import { registerScheduleRuntimeCommands } from '../../input/commands/schedule-runtime.ts';
import { sessionCommand } from '../../input/commands/session.ts';

describe('Agent operator policy hidden spawn gates', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function makeRuntimeServices() {
    root = mkdtempSync(join(tmpdir(), 'gv-agent-policy-'));
    return createRuntimeServices({
      runtimeBus: new RuntimeEventBus(),
      runtimeStore: createRuntimeStore(),
      configManager: new ConfigManager({
        surfaceRoot: 'tui',
        workingDir: root,
        homeDir: root,
        configDir: join(root, '.goodvibes', 'tui'),
      }),
      workingDir: root,
      homeDirectory: root,
      getConversationTitle: () => 'Agent policy test',
    });
  }

  function productionSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === 'test') continue;
        files.push(...productionSourceFiles(fullPath));
      } else if (stat.isFile() && fullPath.endsWith('.ts')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  test('bootstrap does not register the copied ACP delegate tool', () => {
    const source = readFileSync(join(import.meta.dir, '../../runtime/bootstrap.ts'), 'utf8');
    expect(source).not.toContain('registerDelegateTool');
  });

  test('bootstrap does not construct copied local ACP runtime machinery', () => {
    const source = readFileSync(join(import.meta.dir, '../../runtime/bootstrap.ts'), 'utf8');
    expect(source).not.toContain('new AcpManager');
    expect(source).not.toContain('AcpTaskAdapter');
  });

  test('bootstrap core does not emit copied local WRFC chain telemetry', () => {
    const source = readFileSync(join(import.meta.dir, '../../runtime/bootstrap-core.ts'), 'utf8');
    expect(source).not.toContain('WORKFLOW_CONSTRAINTS_ENUMERATED');
    expect(source).not.toContain('WORKFLOW_FIX_ATTEMPTED');
    expect(source).not.toContain('Engineer enumerated');
    expect(source).not.toContain('constraint violation');
  });

  test('production runtime does not construct or register a local WRFC controller', () => {
    const srcRoot = join(import.meta.dir, '../..');
    const offenders: string[] = [];
    for (const file of productionSourceFiles(srcRoot)) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of ['new WrfcController', 'setWrfcController', 'registerBootstrapRuntimeEvents']) {
        if (content.includes(pattern)) offenders.push(`${file.slice(srcRoot.length + 1)}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('production runtime does not construct a local worktree registry', () => {
    const srcRoot = join(import.meta.dir, '../..');
    const offenders: string[] = [];
    for (const file of productionSourceFiles(srcRoot)) {
      const content = readFileSync(file, 'utf8');
      if (content.includes('new WorktreeRegistry')) {
        offenders.push(`${file.slice(srcRoot.length + 1)}: new WorktreeRegistry`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('operator policy tells the model to use local registry notes and memory for durable recall', () => {
    const source = readFileSync(join(import.meta.dir, '../../runtime/bootstrap.ts'), 'utf8');
    expect(source).toContain('scratchpad note, durable memory, reusable persona, skill, skill bundle, or routine');
    expect(source).toContain('records Agent-local, non-secret, source/provenance tagged');
    expect(source).toContain('Notes are for temporary/source-triage context');
    expect(source).toContain('Review memory with a confidence score');
    expect(source).toContain('buildReviewedMemoryPrompt(services.memoryRegistry)');
  });

  test('bootstrap does not start the copied local automation runner', () => {
    const source = readFileSync(join(import.meta.dir, '../../runtime/bootstrap.ts'), 'utf8');
    expect(source).not.toContain('automationManager.start(');
    expect(source).toContain('Local automation execution is disabled in GoodVibes Agent');
  });

  test('bootstrap describes connected-host posture without service ownership wording', () => {
    const source = readFileSync(join(import.meta.dir, '../../runtime/bootstrap.ts'), 'utf8');
    const runtimeIndexSource = readFileSync(join(import.meta.dir, '../../runtime/index.ts'), 'utf8');
    const combined = `${source}\n${runtimeIndexSource}`;

    expect(source).toContain('Phase 7: Connected-host posture + deferred startup');
    expect(source).toContain('createAgentDependencyStatus');
    expect(combined).toContain('does not start or restart it');
    expect(combined).not.toContain('Phase 7: External services + deferred startup');
    expect(combined).not.toContain('createExternalAgentServiceStatus');
    expect(combined).not.toContain('does not start or restart them');
  });

  test('production runtime does not call copied local spawn, cancel, or daemon ownership paths', () => {
    const srcRoot = join(import.meta.dir, '../..');
    const forbidden = [
      'agentManager.spawn',
      'agentManager.cancel',
      'agentManager.clear',
      'agentManager.importState',
      'agentManager.exportState',
      'acpManager.spawn',
      'acpManager.cancel',
      'acpManager.cancelAll',
      'spawnTask(',
      'startExternalServices(',
      'new DaemonServer',
      'new HttpListener',
      'createOAuthLocalListener',
    ];
    const offenders: string[] = [];
    for (const file of productionSourceFiles(srcRoot)) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        if (content.includes(pattern)) offenders.push(`${file.slice(srcRoot.length + 1)}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('activity UI does not present local agent cancellation or background-agent posture', () => {
    const srcRoot = join(import.meta.dir, '../..');
    const offenders: string[] = [];
    for (const file of productionSourceFiles(srcRoot)) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of ['Background Processes', 'No background processes', '[k] Kill']) {
        if (content.includes(pattern)) offenders.push(`${file.slice(srcRoot.length + 1)}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('main Agent footer does not count local AgentManager records as product activity', () => {
    const srcRoot = join(import.meta.dir, '../..');
    const mainSource = readFileSync(join(srcRoot, 'main.ts'), 'utf8');
    expect(mainSource).not.toContain('summarizeRunningAgents(');
    expect(mainSource).not.toContain('readModels.agents.getSnapshot()');
    expect(mainSource).toContain('runningAgentCount = 0');
  });

  test('shared-session task continuation fails closed instead of spawning a local agent', async () => {
    const services = makeRuntimeServices();
    await services.sessionBroker.start();

    const submission = await services.sessionBroker.followUpMessage({
      surfaceKind: 'goodvibes-agent',
      surfaceId: 'agent-policy-test',
      body: 'Build the thing',
    });
    const broker = services.sessionBroker as unknown as {
      runQueuedFollowUp(sessionId: string): Promise<unknown>;
    };

    await expect(broker.runQueuedFollowUp(submission.session.id)).rejects.toThrow('does not own shared-session task execution');
    expect(services.agentManager.list()).toHaveLength(0);
  });

  test('automation spawnTask fails closed instead of spawning a local agent', async () => {
    const services = makeRuntimeServices();
    const job = await services.automationManager.createJob({
      name: 'Blocked local automation',
      prompt: 'Run local automation task',
      schedule: normalizeEverySchedule('15m'),
      enabled: false,
    });

    await expect(services.automationManager.runNow(job.id)).rejects.toThrow('does not create local automation jobs');
    expect(services.agentManager.list()).toHaveLength(0);
  });

  test('schedule command is read-only and does not call automation mutations', async () => {
    const registry = new CommandRegistry();
    registerScheduleRuntimeCommands(registry);
    const schedule = registry.get('schedule');
    expect(schedule).toBeDefined();

    const out: string[] = [];
    const manager = {
      listJobs: mock(() => []),
      start: mock(async () => undefined),
      createJob: mock(async () => ({ id: 'job-created' })),
      removeJob: mock(async () => undefined),
      setEnabled: mock(async () => null),
      runNow: mock(async () => ({ id: 'run-created' })),
    } as unknown as NonNullable<CommandContext['ops']['automationManager']>;
    const ctx = {
      ops: { automationManager: manager },
      print: (text: string) => out.push(text),
    } as unknown as CommandContext;

    await schedule!.handler(['add', 'every', '15m', 'Build something'], ctx);
    await schedule!.handler(['run', 'job-1'], ctx);
    await schedule!.handler(['remove', 'job-1'], ctx);
    await schedule!.handler(['enable', 'job-1'], ctx);
    await schedule!.handler(['disable', 'job-1'], ctx);

    const text = out.join('\n');
    expect(text).toContain('schedule commands are read-only');
    expect(text).toContain('no hidden local Agent automation jobs or immediate automation runs');
    expect(manager.start).toHaveBeenCalledTimes(0);
    expect(manager.createJob).toHaveBeenCalledTimes(0);
    expect(manager.removeJob).toHaveBeenCalledTimes(0);
    expect(manager.setEnabled).toHaveBeenCalledTimes(0);
    expect(manager.runNow).toHaveBeenCalledTimes(0);
  });

  test('copied orchestration command is not registered in Agent runtime', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const manager = {
      cancelGraph: mock(() => []),
      cancelSubtree: mock(() => []),
    };

    expect(registry.get('orchestration')).toBeUndefined();
    expect(manager.cancelGraph).toHaveBeenCalledTimes(0);
    expect(manager.cancelSubtree).toHaveBeenCalledTimes(0);
  });

  test('session graph mutation commands are blocked and do not touch local orchestration state', async () => {
    const out: string[] = [];
    const orchestration = {
      linkTask: mock(() => ({ ok: true })),
      initiateHandoff: mock(() => ({ ok: true, handoffId: 'handoff-1' })),
      cancel: mock(() => ({ ok: true, cancelled: [], skipped: [] })),
      snapshot: mock(() => ({ refs: {}, dependencies: {}, handoffs: {} })),
      getDependencies: mock(() => []),
      getDependents: mock(() => []),
      getHandoffs: mock(() => []),
    };
    const ctx = {
      session: {
        runtime: {
          sessionId: 'agent-session-1',
        },
      },
      workspace: {
        sessionOrchestration: orchestration,
      },
      print: (text: string) => out.push(text),
    } as unknown as CommandContext;

    await sessionCommand.handler(['link-task', 'task-1'], ctx);
    await sessionCommand.handler(['handoff', 'task-1', '--to', 'session-2'], ctx);
    await sessionCommand.handler(['cancel', 'task-1'], ctx);

    const text = out.join('\n');
    expect(text).toContain('Local cross-session task graph mutation is blocked');
    expect(text).toContain('Use /delegate');
    expect(orchestration.linkTask).toHaveBeenCalledTimes(0);
    expect(orchestration.initiateHandoff).toHaveBeenCalledTimes(0);
    expect(orchestration.cancel).toHaveBeenCalledTimes(0);
  });

  test('delegate command submits one shared-session request without eating --wrfc task text', async () => {
    const registry = new CommandRegistry();
    registerDelegationRuntimeCommands(registry);
    const delegate = registry.get('delegate');
    expect(delegate).toBeDefined();

    const ensured: unknown[] = [];
    const submitted: unknown[] = [];
    const operator = {
      sessions: {
        ensureSession: mock(async (input: unknown) => {
          ensured.push(input);
          return { id: 'session-delegate' };
        }),
        submitMessage: mock(async (input: unknown) => {
          submitted.push(input);
          return {};
        }),
      },
    } as unknown as NonNullable<NonNullable<CommandContext['clients']>['operator']>;
    const out: string[] = [];
    const ctx = {
      clients: { operator },
      session: {
        conversationManager: {},
        runtime: {
          model: '',
          provider: '',
          debugMode: false,
          systemPrompt: '',
          reasoningEffort: '',
          sessionId: 'agent-session-1',
        },
      },
      print: (text: string) => out.push(text),
    } as unknown as CommandContext;

    await delegate!.handler(['--wrfc', 'fix', 'the', 'tests'], ctx);

    expect(operator.sessions.ensureSession).toHaveBeenCalledTimes(1);
    expect(operator.sessions.submitMessage).toHaveBeenCalledTimes(1);
    expect(ensured[0]).toMatchObject({
      participant: {
        surfaceKind: 'service',
        surfaceId: 'goodvibes-agent',
        externalId: 'agent-session-1',
      },
      metadata: {
        originSurface: 'goodvibes-agent',
        task: 'fix the tests',
        wrfcRequested: true,
      },
    });
    expect(submitted[0]).toMatchObject({
      sessionId: 'session-delegate',
      surfaceKind: 'service',
      surfaceId: 'goodvibes-agent',
      metadata: {
        kind: 'task',
        task: 'fix the tests',
        wrfcRequested: true,
      },
      routing: {
        executionIntent: {
          filesystemPolicy: 'workspace-write',
        },
      },
    });
    expect(out.join('\n')).toContain('delegated review requested');
  });

  test('copied TUI coding commands are not registered in Agent runtime', () => {
    const services = makeRuntimeServices();
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    expect(registry.get('git')).toBeUndefined();
    expect(registry.get('diff')).toBeUndefined();
    expect(registry.get('worktree')).toBeUndefined();
    expect(registry.get('sandbox')).toBeUndefined();
    expect(existsSync(join(root, '.git'))).toBe(false);
    expect(services.sandboxSessionRegistry.list()).toHaveLength(0);
  });

  test('runtime worktree registry is disabled and fail-closed', async () => {
    const services = makeRuntimeServices();

    await expect(services.worktreeRegistry.list()).resolves.toEqual([]);
    expect(() => services.worktreeRegistry.attach(join(root, 'agent-worktree'), { sessionId: 'agent-session' }))
      .toThrow('does not own local worktree attachment');
    expect(() => services.worktreeRegistry.setState(join(root, 'agent-worktree'), 'active'))
      .toThrow('does not own local worktree state');
    await expect(services.worktreeRegistry.cleanup(join(root, 'agent-worktree')))
      .rejects.toThrow('does not own local worktree cleanup');
  });
});
