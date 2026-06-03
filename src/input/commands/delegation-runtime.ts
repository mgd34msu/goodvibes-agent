import type { CommandContext, CommandRegistry } from '../command-registry.ts';
import type { SharedSessionParticipant } from '@pellux/goodvibes-sdk/platform/control-plane';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function hasAnyFlag(args: readonly string[], flags: readonly string[]): boolean {
  return flags.some((flag) => hasFlag(args, flag));
}

function delegationTaskValues(args: readonly string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === '--review' || token === '--wrfc') continue;
    if (!token.startsWith('--')) {
      values.push(token);
      continue;
    }
  }
  return values;
}

function buildDelegationBody(task: string, reviewRequested: boolean): string {
  return [
    'GoodVibes Agent explicit build delegation.',
    '',
    'Original user ask',
    task,
    '',
    'Agent policy',
    '- GoodVibes Agent is not the coding TUI.',
    '- Preserve the full original ask.',
    '- GoodVibes TUI owns file edits, git/worktree flows, execution isolation UX, and any delegated review owner chain.',
    reviewRequested
      ? '- Delegated review was explicitly requested by the Agent user for this build/fix/review handoff.'
      : '- Delegated review was not explicitly requested; do not add review solely because this came from Agent.',
  ].join('\n');
}

export function registerDelegationRuntimeCommands(registry: CommandRegistry): void {
  const makeHandler = (defaultReview: boolean) => async (args: string[], ctx: CommandContext): Promise<void> => {
    const reviewRequested = defaultReview || hasAnyFlag(args, ['--review', '--wrfc']);
    const task = delegationTaskValues(args).join(' ').trim();
    if (!task) {
      ctx.print(defaultReview ? 'Usage: /delegate --review <build/fix/review task>' : 'Usage: /delegate [--review] <build/fix/review task>');
      return;
    }
    const operator = ctx.clients?.operator;
    if (!operator) {
      ctx.print([
        'Delegation unavailable. No operator client is attached.',
        'Use the shared-session route from a configured Agent runtime, or open GoodVibes TUI in the target workspace.',
      ].join('\n'));
      return;
    }
    try {
      const participant = {
        surfaceKind: 'service',
        surfaceId: 'goodvibes-agent',
        externalId: ctx.session.runtime.sessionId,
        displayName: 'GoodVibes Agent',
        lastSeenAt: Date.now(),
      } satisfies SharedSessionParticipant;
      const session = await operator.sessions.ensureSession({
        title: `Agent delegation: ${task.slice(0, 72)}`,
        participant,
        metadata: {
          originSurface: 'goodvibes-agent',
          sourceSessionId: ctx.session.runtime.sessionId,
          task,
          reviewRequested,
          wrfcRequested: reviewRequested,
        },
      });
      await operator.sessions.submitMessage({
        sessionId: session.id,
        body: buildDelegationBody(task, reviewRequested),
        surfaceKind: participant.surfaceKind,
        surfaceId: participant.surfaceId,
        externalId: participant.externalId,
        displayName: participant.displayName,
        title: `Agent delegation: ${task.slice(0, 72)}`,
        metadata: {
          originSurface: 'goodvibes-agent',
          sourceSessionId: ctx.session.runtime.sessionId,
          kind: 'task',
          task,
          reviewRequested,
          wrfcRequested: reviewRequested,
        },
        routing: {
          executionIntent: {
            riskClass: 'elevated',
            requiresApproval: true,
            networkPolicy: 'inherit',
            filesystemPolicy: 'workspace-write',
          },
        },
      });
      ctx.print([
        'Delegation submitted to GoodVibes TUI/shared-session routes.',
        `  session ${session.id}`,
        `  mode ${reviewRequested ? 'delegated review requested' : 'direct build delegation'}`,
        `  task ${task}`,
        '  next check GoodVibes TUI shared-session/task status for the result.',
      ].join('\n'));
    } catch (error) {
      ctx.print([
        'Delegation failed.',
        `  error ${summarizeError(error)}`,
        '  fallback open GoodVibes TUI in the target workspace and paste the original task there.',
      ].join('\n'));
    }
  };

  registry.register({
    name: 'delegate',
    aliases: ['build'],
    description: 'Explicitly delegate build/fix/review work to GoodVibes TUI through shared-session routes',
    usage: '[--review] <task>',
    argsHint: '[--review] <task>',
    handler: makeHandler(false),
  });
}
