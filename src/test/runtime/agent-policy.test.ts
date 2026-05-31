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
import { registerControlRoomRuntimeCommands } from '../../input/commands/control-room-runtime.ts';
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

  test('bootstrap does not start the copied local automation runner', () => {
    const source = readFileSync(join(import.meta.dir, '../../runtime/bootstrap.ts'), 'utf8');
    expect(source).not.toContain('automationManager.start(');
    expect(source).toContain('Local automation runners are disabled in GoodVibes Agent');
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

    await expect(services.automationManager.runNow(job.id)).rejects.toThrow('does not spawn local automation agents');
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
    expect(text).toContain('no local Agent automation jobs');
    expect(manager.start).toHaveBeenCalledTimes(0);
    expect(manager.createJob).toHaveBeenCalledTimes(0);
    expect(manager.removeJob).toHaveBeenCalledTimes(0);
    expect(manager.setEnabled).toHaveBeenCalledTimes(0);
    expect(manager.runNow).toHaveBeenCalledTimes(0);
  });

  test('orchestration command is read-only and does not cancel local Agent graphs', () => {
    const registry = new CommandRegistry();
    registerControlRoomRuntimeCommands(registry);
    const orchestration = registry.get('orchestration');
    expect(orchestration).toBeDefined();

    const out: string[] = [];
    const manager = {
      cancelGraph: mock(() => []),
      cancelSubtree: mock(() => []),
    };
    const ctx = {
      ops: { agentManager: manager },
      platform: {
        readModels: {
          orchestration: {
            getSnapshot: () => ({ graphs: [] }),
          },
        },
      },
      print: (text: string) => out.push(text),
    } as unknown as CommandContext;

    orchestration!.handler(['cancel', 'graph', 'graph-1'], ctx);
    orchestration!.handler(['cancel', 'subtree', 'agent-1'], ctx);

    const text = out.join('\n');
    expect(text).toContain('orchestration is read-only');
    expect(text).toContain('use /delegate');
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
    expect(out.join('\n')).toContain('WRFC requested');
  });

  test('copied TUI coding commands are externalized and do not mutate local Agent state', async () => {
    const services = makeRuntimeServices();
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const git = registry.get('git');
    const diff = registry.get('diff');
    const worktree = registry.get('worktree');
    const sandbox = registry.get('sandbox');
    expect(git).toBeDefined();
    expect(diff).toBeDefined();
    expect(worktree).toBeDefined();
    expect(sandbox).toBeDefined();

    const out: string[] = [];
    const ctx = {
      print: (text: string) => out.push(text),
      workspace: {
        sandboxSessionRegistry: services.sandboxSessionRegistry,
        worktreeRegistry: services.worktreeRegistry,
      },
      platform: {
        configManager: services.configManager,
      },
    } as unknown as CommandContext;

    await git!.handler(['status'], ctx);
    await diff!.handler(['working'], ctx);
    await worktree!.handler(['attach', '/tmp/agent-worktree', 'session', 'session-1'], ctx);
    await sandbox!.handler(['session', 'start', 'eval-py'], ctx);

    const text = out.join('\n');
    expect(text).toContain('git is externalized in GoodVibes Agent.');
    expect(text).toContain('diff is externalized in GoodVibes Agent.');
    expect(text).toContain('worktree is externalized in GoodVibes Agent.');
    expect(text).toContain('sandbox is externalized in GoodVibes Agent.');
    expect(existsSync(join(root, '.git'))).toBe(false);
    expect(services.sandboxSessionRegistry.list()).toHaveLength(0);
  });
});
