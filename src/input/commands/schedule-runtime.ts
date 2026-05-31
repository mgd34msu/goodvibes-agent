import type { CommandRegistry } from '../command-registry.ts';
import {
  formatEveryInterval,
} from '@pellux/goodvibes-sdk/platform/automation';
import type { AutomationJob } from '@pellux/goodvibes-sdk/platform/automation';
import type { AutomationScheduleDefinition } from '@pellux/goodvibes-sdk/platform/automation';
import { AgentRoutineRegistry } from '../../agent/routine-registry.ts';
import {
  buildRoutineSchedulePreview,
  formatRoutineScheduleFailure,
  formatRoutineSchedulePreview,
  formatRoutineScheduleSuccess,
  parseRoutineSchedulePromotionArgs,
  promoteRoutineToDaemonSchedule,
  resolveAgentDaemonConnection,
} from '../../agent/routine-schedule-promotion.ts';
import type { CommandContext } from '../command-registry.ts';
import { requireShellPaths } from './runtime-services.ts';

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
    `  requested: ${requestedAction}`,
    '  policy: no local Agent automation jobs, scheduled spawns, or immediate automation runs',
    '  use: /schedule list',
    '  daemon route: use /schedule promote-routine <routine> --cron <expr> --yes to create an external daemon schedule explicitly',
  ].join('\n'));
}

async function promoteRoutineSchedule(args: readonly string[], ctx: CommandContext): Promise<void> {
  const parsed = parseRoutineSchedulePromotionArgs(args);
  if (parsed.errors.length > 0) {
    ctx.print([
      'Usage: /schedule promote-routine <routine-id> (--cron <expr>|--every <interval>|--at <iso-time>) [--timezone <tz>] [--name <schedule-name>] [--provider <id>] [--model <model>] [--disabled] --yes',
      ...parsed.errors.map((error) => `  ${error}`),
    ].join('\n'));
    return;
  }
  const shellPaths = requireShellPaths(ctx);
  const routine = AgentRoutineRegistry.fromShellPaths(shellPaths).get(parsed.routineId ?? '');
  if (!routine) {
    ctx.print(`Unknown Agent routine: ${parsed.routineId ?? ''}`);
    return;
  }
  const preview = buildRoutineSchedulePreview(routine, parsed);
  if (!parsed.yes) {
    ctx.print(formatRoutineSchedulePreview(preview));
    return;
  }
  const connection = resolveAgentDaemonConnection(ctx.platform.configManager, shellPaths.homeDirectory);
  const result = await promoteRoutineToDaemonSchedule(connection, preview);
  ctx.print(result.ok ? formatRoutineScheduleSuccess(result) : formatRoutineScheduleFailure(result));
}

export function registerScheduleRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'schedule',
    aliases: ['sched'],
    description: 'Inspect schedules and explicitly promote local Agent routines to daemon schedules',
    usage: 'list | promote-routine <routine-id> --cron <expr> --yes',
    argsHint: 'list | promote-routine <routine-id> --cron <expr> --yes',
    async handler(args, ctx) {
      const sub = args[0];

      if (sub === 'promote-routine' || sub === 'promote' || sub === 'create-routine-schedule') {
        await promoteRoutineSchedule(args.slice(1), ctx);
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
            + 'Local add/run/enable/disable/remove are blocked. Use /schedule promote-routine <routine> --cron <expr> --yes for an explicit external daemon schedule.'
          );
          return;
        }
        const lines = ['Automation jobs:', ''];
        for (const job of jobs) {
          const status = job.enabled ? '● enabled ' : '○ paused  ';
          const next = formatNextRun(job.nextRunAt);
          const last = job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : 'never';
          lines.push(`  ${job.id.slice(0, 12)}  ${status} runs:${job.runCount}  next:${next}  last:${last}`);
          lines.push(`    name: ${job.name}  schedule: ${formatSchedule(job.schedule)}`);
          lines.push(`    prompt: ${formatPrompt(job)}`);
        }
        ctx.print(lines.join('\n'));
        return;
      }

      if (sub === 'add' || sub === 'remove' || sub === 'enable' || sub === 'disable' || sub === 'run') {
        printReadOnlyScheduleBoundary(ctx.print, `/schedule ${args.join(' ')}`.trim());
        return;
      }

      ctx.print(
        'Usage:\n'
        + '  /schedule list\n'
        + '  /schedule promote-routine <routine-id> (--cron <expr>|--every <interval>|--at <iso-time>) --yes\n'
        + '  Local schedule mutations and runs remain blocked.'
      );
    },
  });
}
