import type { CommandRegistry } from '../command-registry.ts';
import {
  formatEveryInterval,
} from '@pellux/goodvibes-sdk/platform/automation';
import type { AutomationJob } from '@pellux/goodvibes-sdk/platform/automation';
import type { AutomationScheduleDefinition } from '@pellux/goodvibes-sdk/platform/automation';
import {
  buildReminderSchedulePreview,
  createReminderSchedule,
  parseReminderScheduleArgs,
  resolveReminderConnectedHostConnection,
} from '../../agent/reminder-schedule.ts';
import {
  formatReminderScheduleFailure,
  formatReminderSchedulePreview,
  formatReminderScheduleSuccess,
} from '../../agent/reminder-schedule-format.ts';
import { AgentRoutineRegistry } from '../../agent/routine-registry.ts';
import {
  buildRoutineSchedulePreview,
  promoteRoutineToConnectedSchedule,
  resolveAgentConnectedHostConnection,
} from '../../agent/routine-schedule-promotion.ts';
import { parseRoutineSchedulePromotionArgs } from '../../agent/routine-schedule-args.ts';
import {
  formatRoutineScheduleCorrelation,
  formatRoutineScheduleFailure,
  formatRoutineSchedulePreview,
  formatRoutineScheduleReceipt,
  formatRoutineScheduleReceipts,
  formatRoutineScheduleSuccess,
} from '../../agent/routine-schedule-format.ts';
import {
  reconcileRoutineScheduleReceipts,
  RoutineScheduleReceiptStore,
} from '../../agent/routine-schedule-receipts.ts';
import {
  buildScheduleEditPreview,
  editConnectedSchedule,
  parseScheduleEditArgs,
  resolveScheduleEditConnectedHostConnection,
} from '../../agent/schedule-edit.ts';
import {
  formatScheduleEditFailure,
  formatScheduleEditPreview,
  formatScheduleEditSuccess,
} from '../../agent/schedule-edit-format.ts';
import type { CommandContext } from '../command-registry.ts';
import { requireShellPaths } from './runtime-services.ts';
import { executeConfirmedOperatorAction } from './operator-actions-runtime.ts';

function formatSchedule(schedule: AutomationScheduleDefinition): string {
  switch (schedule.kind) {
    case 'cron':
      return [
        schedule.expression,
        schedule.timezone ? `[${schedule.timezone}]` : '',
        schedule.staggerMs !== undefined ? `[stagger ${schedule.staggerMs}ms]` : '',
      ].filter(Boolean).join(' ');
    case 'every':
      return formatEveryInterval(schedule.intervalMs);
    case 'at':
      return new Date(schedule.at).toLocaleString();
  }
}

function formatNextRun(nextRunAt?: number): string {
  return nextRunAt ? new Date(nextRunAt).toLocaleString() : 'n/a';
}

function formatPrompt(job: AutomationJob): string {
  const prompt = (job.execution.prompt ?? job.description ?? '').trim();
  return prompt.length > 60 ? `${prompt.slice(0, 60)}...` : prompt;
}

function printReadOnlyScheduleBoundary(print: (text: string) => void, requestedAction: string): void {
  print([
    'GoodVibes Agent local schedule commands are read-only in this runtime.',
    `  requested ${requestedAction}`,
    '  policy no hidden local Agent automation jobs or immediate automation runs',
    '  use /schedule list',
    '  connected run route /automation schedule run <schedule-id> --yes',
    '  schedule route use /schedule promote-routine <routine> --cron <expr> --yes to create a connected schedule explicitly',
  ].join('\n'));
}

async function promoteRoutineSchedule(args: readonly string[], ctx: CommandContext): Promise<void> {
  const parsed = parseRoutineSchedulePromotionArgs(args);
  if (parsed.errors.length > 0) {
    ctx.print([
      'Usage: /schedule promote-routine <routine-id> (--cron <expr>|--every <interval>|--at <iso-time>) [--timezone <tz>] [--name <schedule-name>] [--provider <id>] [--model <model>] [--delivery-channel <channel[:route[:label]]>|--delivery-route <route[:label]>|--delivery-webhook <url>|--delivery-link <url>] [--disabled] --yes',
      ...parsed.errors.map((error) => `  ${error}`),
    ].join('\n'));
    return;
  }
  const shellPaths = requireShellPaths(ctx);
  const routine = AgentRoutineRegistry.fromShellPaths(shellPaths).get(parsed.routineId ?? '');
  if (!routine) {
    ctx.print(`Unknown Agent routine ${parsed.routineId ?? ''}`);
    return;
  }
  const preview = buildRoutineSchedulePreview(routine, parsed);
  if (!parsed.yes) {
    ctx.print(formatRoutineSchedulePreview(preview));
    return;
  }
  const connection = resolveAgentConnectedHostConnection(ctx.platform.configManager, shellPaths.homeDirectory);
  const result = await promoteRoutineToConnectedSchedule(connection, preview);
  const receipt = RoutineScheduleReceiptStore.fromShellPaths(shellPaths).append(connection, preview, result);
  ctx.print(result.ok ? `${formatRoutineScheduleSuccess(result)}\n  receipt: ${receipt.id}` : `${formatRoutineScheduleFailure(result)}\n  receipt: ${receipt.id}`);
}

async function createReminder(args: readonly string[], ctx: CommandContext): Promise<void> {
  const parsed = parseReminderScheduleArgs(args);
  if (parsed.errors.length > 0) {
    ctx.print([
      'Usage: /schedule remind (--cron <expr>|--every <interval>|--at <iso-time>) (--message <text>|<text...>) [--timezone <tz>] [--name <schedule-name>] [--provider <id>] [--model <model>] [--delivery-channel <channel[:route[:label]]>|--delivery-route <route[:label]>|--delivery-webhook <url>|--delivery-link <url>] [--disabled] --yes',
      ...parsed.errors.map((error) => `  ${error}`),
    ].join('\n'));
    return;
  }
  const preview = buildReminderSchedulePreview(parsed);
  if (!parsed.yes) {
    ctx.print(formatReminderSchedulePreview(preview));
    return;
  }
  const shellPaths = requireShellPaths(ctx);
  const connection = resolveReminderConnectedHostConnection(ctx.platform.configManager, shellPaths.homeDirectory);
  const result = await createReminderSchedule(connection, preview);
  ctx.print(result.ok ? formatReminderScheduleSuccess(result) : formatReminderScheduleFailure(result));
}

async function editSchedule(args: readonly string[], ctx: CommandContext): Promise<void> {
  const parsed = parseScheduleEditArgs(args, {
    defaultExplicitUserRequest: `/schedule edit ${args[0] ?? ''}`.trim(),
  });
  if (parsed.errors.length > 0) {
    ctx.print([
      'Usage: /schedule edit <schedule-id> [--cron <expr>|--every <interval>|--at <iso-time>] [--timezone <tz>] [--stagger-ms <ms>] [--name <text>] [--prompt <text>|--task <text> --success-criteria <text>] --yes',
      ...parsed.errors.map((error) => `  ${error}`),
    ].join('\n'));
    return;
  }
  const preview = buildScheduleEditPreview(parsed);
  if (!parsed.yes) {
    ctx.print(formatScheduleEditPreview(preview));
    return;
  }
  const shellPaths = requireShellPaths(ctx);
  const connection = resolveScheduleEditConnectedHostConnection(ctx.platform.configManager, shellPaths.homeDirectory);
  const result = await editConnectedSchedule(connection, preview);
  ctx.print(result.ok ? formatScheduleEditSuccess(result) : formatScheduleEditFailure(result));
}

export function registerScheduleRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'schedule',
    aliases: ['sched'],
    description: 'Inspect schedules, create confirmed reminders, and explicitly promote Agent-local routines to connected schedules',
    usage: 'list | edit <id> --cron <expr> --yes | remind --at <iso> --message <text> --yes | receipts | reconcile | receipt <id> | promote-routine <routine-id> --cron <expr> --yes',
    argsHint: 'list | edit <id> --cron <expr> --yes | remind --at <iso> --message <text> --yes | receipts | reconcile | receipt <id> | promote-routine <routine-id> --cron <expr> --yes',
    async handler(args, ctx) {
      const sub = args[0];

      if (sub === 'remind' || sub === 'reminder') {
        await createReminder(args.slice(1), ctx);
        return;
      }

      if (sub === 'promote-routine' || sub === 'promote' || sub === 'create-routine-schedule') {
        await promoteRoutineSchedule(args.slice(1), ctx);
        return;
      }

      if (sub === 'receipts' || sub === 'history') {
        ctx.print(formatRoutineScheduleReceipts(RoutineScheduleReceiptStore.fromShellPaths(requireShellPaths(ctx)).snapshot()));
        return;
      }

      if (sub === 'reconcile' || sub === 'sync' || sub === 'status') {
        const shellPaths = requireShellPaths(ctx);
        const connection = resolveAgentConnectedHostConnection(ctx.platform.configManager, shellPaths.homeDirectory);
        const result = await reconcileRoutineScheduleReceipts(connection, RoutineScheduleReceiptStore.fromShellPaths(shellPaths).snapshot());
        ctx.print(formatRoutineScheduleCorrelation(result));
        return;
      }

      if (sub === 'receipt') {
        const id = args[1];
        if (!id) {
          ctx.print('Usage: /schedule receipt <receipt-id>');
          return;
        }
        const receipt = RoutineScheduleReceiptStore.fromShellPaths(requireShellPaths(ctx)).get(id);
        ctx.print(receipt ? formatRoutineScheduleReceipt(receipt) : `Unknown routine schedule receipt ${id}`);
        return;
      }

      if (sub === 'edit' || sub === 'update' || sub === 'patch') {
        await editSchedule(args.slice(1), ctx);
        return;
      }

      if (sub === 'run' || sub === 'enable' || sub === 'disable' || sub === 'delete' || sub === 'remove') {
        const scheduleId = args[1] ?? '';
        if (!scheduleId) {
          ctx.print(`Usage: /schedule ${sub} <schedule-id> --yes`);
          return;
        }
        const action = sub === 'run'
          ? 'schedules.run'
          : sub === 'enable'
            ? 'schedules.enable'
            : sub === 'disable'
              ? 'schedules.disable'
              : 'schedules.delete';
        await executeConfirmedOperatorAction(ctx, action, 'scheduleId', scheduleId, args.slice(2), `/schedule ${sub} <schedule-id> --yes`);
        return;
      }

      const manager = ctx.ops.automationManager;
      if (!manager) {
        ctx.print('Automation manager is not available in this runtime.');
        return;
      }

      if (!sub || sub === 'list') {
        const jobs = manager.listJobs();
        if (jobs.length === 0) {
          ctx.print(
            'No automation jobs.\n'
            + 'Local add/run/enable/disable/remove are blocked. Use /schedule remind --at <time> --message <text> --yes for reminders or /schedule promote-routine <routine> --cron <expr> --yes for explicit connected schedules.'
          );
          return;
        }
        const lines = ['Automation jobs', ''];
        for (const job of jobs) {
          const status = job.enabled ? '● enabled ' : '○ paused  ';
          const next = formatNextRun(job.nextRunAt);
          const last = job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : 'never';
          lines.push(`  ${job.id.slice(0, 12)}  ${status} runs ${job.runCount}  next ${next}  last ${last}`);
          lines.push(`    name ${job.name}  schedule ${formatSchedule(job.schedule)}`);
          lines.push(`    prompt ${formatPrompt(job)}`);
        }
        ctx.print(lines.join('\n'));
        return;
      }

      if (sub === 'add') {
        printReadOnlyScheduleBoundary(ctx.print, `/schedule ${args.join(' ')}`.trim());
        return;
      }

      ctx.print(
        'Usage:\n'
        + '  /schedule list\n'
        + '  /schedule receipts\n'
        + '  /schedule reconcile\n'
        + '  /schedule receipt <receipt-id>\n'
        + '  /schedule run <schedule-id> --yes\n'
        + '  /schedule enable <schedule-id> --yes\n'
        + '  /schedule disable <schedule-id> --yes\n'
        + '  /schedule delete <schedule-id> --yes\n'
        + '  /schedule edit <schedule-id> [--cron <expr>|--every <interval>|--at <iso-time>] [--name <text>] [--prompt <text>|--task <text> --success-criteria <text>] --yes\n'
        + '  /schedule remind (--cron <expr>|--every <interval>|--at <iso-time>) (--message <text>|<text...>) [--delivery-channel <channel>|--delivery-route <route>|--delivery-webhook <url>] --yes\n'
        + '  /schedule promote-routine <routine-id> (--cron <expr>|--every <interval>|--at <iso-time>) [--delivery-channel <channel>|--delivery-route <route>|--delivery-webhook <url>] --yes\n'
        + '  Local schedule creation remains blocked; schedule lifecycle/edit actions are confirmed connected-host actions.'
      );
    },
  });
}
