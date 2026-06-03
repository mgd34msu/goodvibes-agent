import { describe, expect, test } from 'bun:test';
import { CommandRegistry } from '../../input/command-registry.ts';
import type { CommandContext } from '../../input/command-registry.ts';
import { registerBuiltinCommands } from '../../input/commands.ts';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { createRuntimeOpsApi } from '@/runtime/index.ts';
import { createTaskManager } from '@/runtime/index.ts';
import { OpsControlPlane } from '@/runtime/index.ts';
import { createShellPathService } from '@/runtime/index.ts';
import { createTasksReadModel } from '../helpers/ui-read-models.ts';
import type { OperatorClient } from '@/runtime/index.ts';

const shellPaths = createShellPathService({
  workingDirectory: '/tmp/goodvibes-test',
  homeDirectory: '/tmp/goodvibes-home',
});

function makeTaskCommandContext(
  out: string[],
  readModels: CommandContext['platform']['readModels'],
  ops: Partial<CommandContext['ops']> = {},
  clients: CommandContext['clients'] = {},
): CommandContext {
  const providerRegistry = {} as never;
  const conversationManager = {} as never;
  const configManager = {} as never;
  return {
    session: {
      conversationManager,
      runtime: {
        model: '',
        provider: '',
        debugMode: false,
        systemPrompt: '',
        reasoningEffort: '',
        sessionId: 'sess-tasks',
      },
    },
    provider: {
      providerRegistry,
    },
    workspace: {
      shellPaths,
    },
    platform: {
      config: {} as never,
      configManager,
      readModels,
    },
    ops,
    extensions: {
      toolRegistry: {} as never,
      mcpRegistry: {} as never,
    },
    clients,
    renderRequest: () => {},
    print: (text: string) => { out.push(text); },
    exit: () => {},
  };
}

function createOperatorTaskClient(
  readModels: CommandContext['platform']['readModels'],
): OperatorClient {
  return {
    sessions: {} as never,
    approvals: {} as never,
    providers: {} as never,
    controlPlane: {} as never,
    events: {} as never,
    shellPaths,
    tasks: {
      snapshot: () => requireTasksReadModel(readModels).getSnapshot(),
      list: (limit = 100) => requireTasksReadModel(readModels).getSnapshot().tasks.slice(0, limit),
      get: (taskId) => requireTasksReadModel(readModels).getSnapshot().tasks.find((task) => task.id === taskId) ?? null,
      running: () => requireTasksReadModel(readModels).getSnapshot().tasks.filter((task) => task.status === 'running'),
    },
  };
}

function requireTasksReadModel(
  readModels: CommandContext['platform']['readModels'],
): NonNullable<CommandContext['platform']['readModels']>['tasks'] {
  const tasks = readModels?.tasks;
  if (!tasks) {
    throw new Error('tasks read model is required for task command tests');
  }
  return tasks;
}

describe('tasks command', () => {
  test('lists, shows, and outputs connected-host tasks', async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const tasksCommand = registry.get('tasks');
    expect(tasksCommand).toBeDefined();

    const store = createRuntimeStore();
    const bus = new RuntimeEventBus();
    const taskManager = createTaskManager(store, bus, 'sess-tasks');
    const task = taskManager.createTask({
      kind: 'integration',
      title: 'Publish release evidence',
      description: 'Publish release evidence bundle',
      owner: 'release',
    });
    taskManager.startTask(task.id);
    taskManager.completeTask(task.id, { ok: true, artifactId: 'artifact-1' });

    const out: string[] = [];
    const opsApi = createRuntimeOpsApi({
      tasksReadModel: createTasksReadModel(store),
      taskManager,
      opsControlPlane: new OpsControlPlane(taskManager, bus, store, 'sess-tasks'),
    });
    const readModels = {
      tasks: createTasksReadModel(store),
    } as never;
    const ctx = makeTaskCommandContext(out, readModels, {
    }, {
      operator: createOperatorTaskClient(readModels),
      opsApi,
    });

    await tasksCommand!.handler(['list'], ctx);
    expect(out.join('\n')).toContain('Connected-host Tasks');
    expect(out.join('\n')).toContain('Publish release evidence');

    out.length = 0;
    await tasksCommand!.handler([], ctx);
    expect(out.join('\n')).toContain('Connected-host Tasks');
    expect(out.join('\n')).toContain('Publish release evidence');

    out.length = 0;
    await tasksCommand!.handler(['show', task.id], ctx);
    expect(out.join('\n')).toContain(`Task ${task.id}`);
    expect(out.join('\n')).toContain('kind: integration');

    out.length = 0;
    await tasksCommand!.handler(['output', task.id], ctx);
    expect(out.join('\n')).toContain('artifact-1');
  });

  test('blocks copied task panel routing in Agent', async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const tasksCommand = registry.get('tasks');
    expect(tasksCommand).toBeDefined();
    const out: string[] = [];
    const ctx = makeTaskCommandContext(out, undefined);

    await tasksCommand!.handler(['open'], ctx);

    expect(out.join('\n')).toContain('Agent Workspace -> Work -> Host tasks');
  });

  test('blocks copied runtime task interventions in Agent', async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const tasksCommand = registry.get('tasks');
    expect(tasksCommand).toBeDefined();

    const store = createRuntimeStore();
    const bus = new RuntimeEventBus();
    const taskManager = createTaskManager(store, bus, 'sess-tasks');
    const plane = new OpsControlPlane(taskManager, bus, store, 'sess-tasks');
    const task = taskManager.createTask({
      kind: 'exec',
      title: 'Run verification',
      owner: 'shell',
    });
    taskManager.startTask(task.id);

    const out: string[] = [];
    const opsApi = createRuntimeOpsApi({
      tasksReadModel: createTasksReadModel(store),
      taskManager,
      opsControlPlane: plane,
    });
    const readModels = {
      tasks: createTasksReadModel(store),
    } as never;
    const ctx = makeTaskCommandContext(out, readModels, {
    }, {
      operator: createOperatorTaskClient(readModels),
      opsApi,
    });

    await tasksCommand!.handler(['pause', task.id, 'waiting', 'for', 'approval'], ctx);
    expect(taskManager.getTask(task.id)?.status).toBe('running');
    expect(out.join('\n')).toContain('Task mutation "pause" is blocked in GoodVibes Agent.');
    expect(out.join('\n')).toContain('no local task state was changed');

    out.length = 0;
    await tasksCommand!.handler(['resume', task.id], ctx);
    expect(taskManager.getTask(task.id)?.status).toBe('running');
    expect(out.join('\n')).toContain('Task mutation "resume" is blocked in GoodVibes Agent.');

    out.length = 0;
    await tasksCommand!.handler(['cancel', task.id], ctx);
    expect(taskManager.getTask(task.id)?.status).toBe('running');
    expect(out.join('\n')).toContain('Task mutation "cancel" is blocked in GoodVibes Agent.');
  });

  test('blocks copied task CRUD mutation flows in Agent', async () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const tasksCommand = registry.get('tasks');
    expect(tasksCommand).toBeDefined();

    const store = createRuntimeStore();
    const bus = new RuntimeEventBus();
    const taskManager = createTaskManager(store, bus, 'sess-task-crud');

    const out: string[] = [];
    const opsApi = createRuntimeOpsApi({
      tasksReadModel: createTasksReadModel(store),
      taskManager,
      opsControlPlane: new OpsControlPlane(taskManager, bus, store, 'sess-task-crud'),
    });
    const readModels = {
      tasks: createTasksReadModel(store),
    } as never;
    const ctx = makeTaskCommandContext(out, readModels, {
    }, {
      operator: createOperatorTaskClient(readModels),
      opsApi,
    });
    ctx.session.runtime.sessionId = 'sess-task-crud';

    await tasksCommand!.handler(['create', 'integration', 'release-bot', 'Prepare', 'release', 'bundle'], ctx);
    expect(out.join('\n')).toContain('Task mutation "create" is blocked in GoodVibes Agent.');
    expect(taskManager.getTasksByKind('integration')).toHaveLength(0);

    out.length = 0;
    await tasksCommand!.handler(['update', 'task-1', 'description', 'Publish', 'and', 'verify', 'bundle'], ctx);
    expect(out.join('\n')).toContain('Task mutation "update" is blocked in GoodVibes Agent.');

    out.length = 0;
    await tasksCommand!.handler(['complete', 'task-1', 'bundle-ready'], ctx);
    expect(out.join('\n')).toContain('Task mutation "complete" is blocked in GoodVibes Agent.');

    const failedTask = taskManager.createTask({
      kind: 'exec',
      title: 'Run broken verification',
      owner: 'shell',
    });
    taskManager.startTask(failedTask.id);
    out.length = 0;
    await tasksCommand!.handler(['fail', failedTask.id, 'lint', 'failed'], ctx);
    expect(out.join('\n')).toContain('Task mutation "fail" is blocked in GoodVibes Agent.');
    expect(taskManager.getTask(failedTask.id)?.status).toBe('running');
  });
});
