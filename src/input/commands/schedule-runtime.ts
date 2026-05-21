import type { CommandRegistry } from '../command-registry.ts';
import {
  formatEveryInterval,
} from '@pellux/goodvibes-sdk/platform/automation';
import type { AutomationJob } from '@pellux/goodvibes-sdk/platform/automation';
import type { AutomationScheduleDefinition } from '@pellux/goodvibes-sdk/platform/automation';

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
    'GoodVibes Agent schedule commands are read-only in this runtime.',
    `  requested: ${requestedAction}`,
    '  policy: no local Agent automation jobs, scheduled spawns, or immediate automation runs',
    '  use: /schedule list',
    '  future: mutate schedules through an Agent-safe public daemon route after explicit approval',
  ].join('\n'));
}

export function registerScheduleRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'schedule',
    aliases: ['sched'],
    description: 'Inspect automation jobs and scheduled runs',
    usage: 'list',
    argsHint: 'list',
    async handler(args, ctx) {
      const manager = ctx.ops.automationManager;
      if (!manager) {
        ctx.print('Automation manager is not available in this runtime.');
        return;
      }
      const sub = args[0];

      if (!sub || sub === 'list') {
        const jobs = manager.listJobs();
        if (jobs.length === 0) {
          ctx.print(
            'No automation jobs.\n'
            + 'Agent schedule commands are read-only here; create/run/enable/disable/remove are blocked until an Agent-safe route exists.'
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
        + '  Agent schedule mutations and runs are blocked until an Agent-safe route exists.'
      );
    },
  });
}
