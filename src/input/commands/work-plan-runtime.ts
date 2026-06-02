import type { CommandRegistry } from '../command-registry.ts';
import type { WorkPlanItemStatus, WorkPlanStore } from '../../work-plans/work-plan-store.ts';
import { WORK_PLAN_STATUSES } from '../../work-plans/work-plan-store.ts';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

const STATUS_COMMANDS: Record<string, WorkPlanItemStatus> = {
  pending: 'pending',
  todo: 'pending',
  start: 'in_progress',
  active: 'in_progress',
  progress: 'in_progress',
  block: 'blocked',
  blocked: 'blocked',
  done: 'done',
  complete: 'done',
  fail: 'failed',
  failed: 'failed',
  cancel: 'cancelled',
  cancelled: 'cancelled',
};

function getStore(ctx: import('../command-registry.ts').CommandContext): WorkPlanStore | null {
  return ctx.workspace.workPlanStore ?? null;
}

function formatList(store: WorkPlanStore): string {
  const items = store.listItems();
  if (items.length === 0) return 'Work plan is empty. Add one with /workplan add <title>.';
  return [
    `Work Plan (${items.length})`,
    ...items.map((item) => {
      const owner = item.owner ? ` @${item.owner}` : '';
      return `  ${item.id}  ${item.status.padEnd(11)} ${item.title}${owner}`;
    }),
  ].join('\n');
}

function parseAddArgs(args: string[]): { title: string; owner?: string; source?: string; notes?: string } {
  const titleParts: string[] = [];
  let owner: string | undefined;
  let source: string | undefined;
  let notes: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const part = args[i] ?? '';
    if (part === '--owner' && args[i + 1]) {
      owner = args[++i];
      continue;
    }
    if (part === '--source' && args[i + 1]) {
      source = args[++i];
      continue;
    }
    if (part === '--notes' && args[i + 1]) {
      notes = args.slice(i + 1).join(' ').trim();
      break;
    }
    titleParts.push(part);
  }
  return {
    title: titleParts.join(' ').trim(),
    ...(owner ? { owner } : {}),
    ...(source ? { source } : {}),
    ...(notes ? { notes } : {}),
  };
}

export function registerWorkPlanRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'workplan',
    aliases: ['wp', 'todo'],
    description: 'Track a persistent workspace-scoped work plan',
    usage: '[list|show|add <title> [--owner name] [--source label] [--notes text]|done <id>|start <id>|block <id>|fail <id>|cancel <id>|pending <id>|remove <id> --yes|clear-done --yes]',
    argsHint: '[list|add|show|done]',
    handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const store = getStore(ctx);
      if (!store) {
        ctx.print('Work plan store is not available in this runtime.');
        return;
      }
      const subcommand = (commandArgs[0] ?? 'list').toLowerCase();
      try {
        if (subcommand === 'panel' || subcommand === 'open') {
          ctx.print('Open Agent Workspace -> Work -> Work plan for the workspace view, or run /workplan list for compact command output.');
          return;
        }
        if (subcommand === 'list') {
          ctx.print(formatList(store));
          return;
        }
        if (subcommand === 'show' || subcommand === 'markdown') {
          ctx.print(store.toMarkdown());
          return;
        }
        if (subcommand === 'add') {
          const addArgs = parseAddArgs(commandArgs.slice(1));
          if (!addArgs.title) {
            ctx.print('Usage: /workplan add <title> [--owner name] [--source label] [--notes text]');
            return;
          }
          const addOptions = {
            ...(addArgs.owner ? { owner: addArgs.owner } : {}),
            source: addArgs.source ?? 'manual',
            ...(addArgs.notes ? { notes: addArgs.notes } : {}),
          };
          const item = store.addItem(addArgs.title, addOptions);
          ctx.print(`Added work plan item ${item.id}. Open Agent Workspace -> Work -> Work plan to review.`);
          return;
        }
        if (subcommand === 'remove' || subcommand === 'delete' || subcommand === 'rm') {
          const id = commandArgs[1];
          if (!id) {
            ctx.print(`Usage: /workplan ${subcommand} <id> --yes`);
            return;
          }
          if (!parsed.yes) {
            requireYesFlag(ctx, `remove work plan item ${id}`, `/workplan ${subcommand} <id> --yes`);
            return;
          }
          const item = store.removeItem(id);
          ctx.print(`Removed work plan item ${item.id}: ${item.title}`);
          return;
        }
        if (subcommand === 'clear-done' || subcommand === 'clear-completed') {
          if (!parsed.yes) {
            requireYesFlag(ctx, 'clear completed work plan items', `/workplan ${subcommand} --yes`);
            return;
          }
          const count = store.clearCompleted();
          ctx.print(`Cleared ${count} completed/cancelled work plan item${count === 1 ? '' : 's'}.`);
          return;
        }
        if (subcommand === 'cycle' || subcommand === 'toggle') {
          const id = commandArgs[1];
          if (!id) {
            ctx.print(`Usage: /workplan ${subcommand} <id>`);
            return;
          }
          const item = store.cycleItemStatus(id);
          ctx.print(`Updated ${item.id}: ${item.status}.`);
          return;
        }
        const status = STATUS_COMMANDS[subcommand];
        if (status) {
          const id = commandArgs[1];
          if (!id) {
            ctx.print(`Usage: /workplan ${subcommand} <id>`);
            return;
          }
          const item = store.setItemStatus(id, status);
          ctx.print(`Updated ${item.id}: ${item.status}.`);
          return;
        }
        if (WORK_PLAN_STATUSES.includes(subcommand as WorkPlanItemStatus)) {
          ctx.print(`Usage: /workplan ${subcommand} <id>`);
          return;
        }
        ctx.print(`Unknown workplan subcommand: ${subcommand}`);
      } catch (error) {
        ctx.print(summarizeError(error));
      }
    },
  });
}
