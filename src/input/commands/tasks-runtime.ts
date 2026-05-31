import type { CommandRegistry } from '../command-registry.ts';
import type { RuntimeTask, TaskLifecycleState } from '@/runtime/index.ts';
import { reviewWorktreeAttachments } from '@/runtime/index.ts';
import { requireOperatorClient, requirePanelManager, requireShellPaths } from './runtime-services.ts';

const BLOCKED_TASK_MUTATIONS: ReadonlySet<string> = new Set([
  'create',
  'update',
  'complete',
  'fail',
  'cancel',
  'pause',
  'resume',
  'retry',
]);

function printTaskMutationBlocked(print: (text: string) => void, subcommand: string): void {
  print([
    `Task mutation "${subcommand}" is blocked in GoodVibes Agent.`,
    '  policy: runtime tasks are read-only from the Agent surface; normal work stays in the main conversation.',
    '  durable tasks: use /workplan for visible planning and task tracking.',
    '  build/fix/review: use /delegate <task> to hand explicit implementation work to GoodVibes TUI.',
    '  result: no local runtime task state was changed.',
  ].join('\n'));
}

function sortRuntimeTasks(tasks: RuntimeTask[]): RuntimeTask[] {
  const statusOrder: TaskLifecycleState[] = ['running', 'queued', 'blocked', 'failed', 'completed', 'cancelled'];
  const ranking = new Map(statusOrder.map((status, index) => [status, index] as const));
  return [...tasks].sort((a, b) => {
    const rankDelta = (ranking.get(a.status) ?? 99) - (ranking.get(b.status) ?? 99);
    if (rankDelta !== 0) return rankDelta;
    const aWhen = a.startedAt ?? a.queuedAt;
    const bWhen = b.startedAt ?? b.queuedAt;
    return bWhen - aWhen;
  });
}

function summarizeTaskResult(task: RuntimeTask): string {
  const payload = (
    typeof task.result === 'string'
      ? task.result
      : task.error
        ?? (task.result !== undefined ? JSON.stringify(task.result) : task.description)
        ?? task.title
  );
  const normalized = String(payload).replace(/\s+/g, ' ').trim();
  return normalized.length <= 140 ? normalized : `${normalized.slice(0, 137)}...`;
}

export function registerTasksRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'tasks',
    aliases: ['task'],
    description: 'Inspect runtime tasks without starting or mutating local background work',
    usage: '[list [status|kind] | show <taskId> | output <taskId>]',
    handler(args, ctx) {
      if (args.length === 0) {
        if (ctx.showPanel) ctx.showPanel('tasks');
        else {
          const panelManager = requirePanelManager(ctx);
          panelManager.open('tasks');
          panelManager.show();
          ctx.renderRequest();
        }
        return;
      }

      const operatorClient = requireOperatorClient(ctx);
      const tasks = sortRuntimeTasks([...operatorClient.tasks.list(500)]);
      const subcommand = args[0]?.toLowerCase() ?? 'list';

      if (subcommand === 'list') {
        const filter = args[1]?.toLowerCase();
        const filtered = tasks.filter((task) => !filter || task.status === filter || task.kind === filter);
        if (filtered.length === 0) {
          ctx.print(filter ? `No tasks matched "${filter}".` : 'No tasks recorded yet.');
          return;
        }
        ctx.print([
          `Runtime Tasks (${filtered.length})`,
          ...filtered.slice(0, 20).map((task) => `  ${task.id}  ${task.status.padEnd(9)} ${task.kind.padEnd(11)} ${task.owner}  ${task.title}`),
        ].join('\n'));
        return;
      }

      if (subcommand === 'show') {
        const taskId = args[1];
        if (!taskId) {
          ctx.print('Usage: /tasks show <taskId>');
          return;
        }
        const task = operatorClient.tasks.get(taskId);
        if (!task) {
          ctx.print(`Unknown task: ${taskId}`);
          return;
        }
        ctx.print([
          `Task ${task.id}`,
          `  title: ${task.title}`,
          `  kind: ${task.kind}`,
          `  status: ${task.status}`,
          `  owner: ${task.owner}`,
          `  cancellable: ${task.cancellable ? 'yes' : 'no'}`,
          `  queuedAt: ${new Date(task.queuedAt).toISOString()}`,
          `  startedAt: ${task.startedAt ? new Date(task.startedAt).toISOString() : 'n/a'}`,
          `  endedAt: ${task.endedAt ? new Date(task.endedAt).toISOString() : 'n/a'}`,
          `  parent: ${task.parentTaskId ?? 'none'}`,
          `  children: ${task.childTaskIds.join(', ') || '(none)'}`,
          `  correlationId: ${task.correlationId ?? 'n/a'}`,
          ...(() => {
            const shellPaths = requireShellPaths(ctx);
            const worktrees = reviewWorktreeAttachments('task', task.id, {
              workingDirectory: shellPaths.workingDirectory,
            });
            return worktrees.total > 0
              ? [
                  `  worktrees: ${worktrees.total} tracked (${worktrees.active} active / ${worktrees.paused} paused / ${worktrees.pendingCleanup} cleanup)`,
                  `  worktree next: /worktree task ${task.id}`,
                ]
              : [];
          })(),
          `  summary: ${summarizeTaskResult(task)}`,
        ].join('\n'));
        return;
      }

      if (subcommand === 'output') {
        const taskId = args[1];
        if (!taskId) {
          ctx.print('Usage: /tasks output <taskId>');
          return;
        }
        const task = operatorClient.tasks.get(taskId);
        if (!task) {
          ctx.print(`Unknown task: ${taskId}`);
          return;
        }
        const payload = typeof task.result === 'string'
          ? task.result
          : task.result !== undefined
            ? JSON.stringify(task.result, null, 2)
            : task.error ?? task.description ?? task.title;
        ctx.print(String(payload));
        return;
      }

      if (BLOCKED_TASK_MUTATIONS.has(subcommand)) {
        printTaskMutationBlocked(ctx.print, subcommand);
        return;
      }

      ctx.print(`Unknown tasks subcommand: ${subcommand}`);
    },
  });
}
