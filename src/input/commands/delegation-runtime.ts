import type { CommandContext, CommandRegistry } from '../command-registry.ts';
import type { SharedSessionParticipant } from '@pellux/goodvibes-sdk/platform/control-plane';
import { summarizeError } from '@pellux/goodvibes-sdk/platform/utils';

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function delegationTaskValues(args: readonly string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === '--wrfc') continue;
    if (!token.startsWith('--')) {
      values.push(token);
      continue;
    }
  }
  return values;
}

function buildDelegationBody(task: string, wrfcRequested: boolean): string {
  return [
    'GoodVibes Agent explicit build delegation.',
    '',
    'Original user ask:',
    task,
    '',
    'Agent policy:',
    '- GoodVibes Agent is not the coding TUI.',
    '- Preserve the full original ask.',
    '- GoodVibes TUI owns file edits, git/worktree flows, runtime-isolation UX, and any WRFC owner chain.',
    wrfcRequested
      ? '- WRFC was explicitly requested by the Agent user for this build/fix/review delegation.'
      : '- WRFC was not explicitly requested; do not turn this into WRFC solely because it came from Agent.',
  ].join('\n');
}

export function registerDelegationRuntimeCommands(registry: CommandRegistry): void {
  const makeHandler = (defaultWrfc: boolean) => async (args: string[], ctx: CommandContext): Promise<void> => {
    const wrfcRequested = defaultWrfc || hasFlag(args, '--wrfc');
    const task = delegationTaskValues(args).join(' ').trim();
    if (!task) {
      ctx.print(defaultWrfc ? 'Usage: /wrfc <build/fix/review task>' : 'Usage: /delegate [--wrfc] <build/fix/review task>');
      return;
    }
    const operator = ctx.clients?.operator;
    if (!operator) {
      ctx.print([
        'Delegation unavailable: no operator client is attached.',
        'Use the external daemon/shared-session route from a configured Agent runtime, or open GoodVibes TUI in the target workspace.',
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
          wrfcRequested,
        },
      });
      await operator.sessions.submitMessage({
        sessionId: session.id,
        body: buildDelegationBody(task, wrfcRequested),
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
          wrfcRequested,
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
        `  session: ${session.id}`,
        `  mode: ${wrfcRequested ? 'WRFC requested' : 'direct build delegation'}`,
        `  task: ${task}`,
        '  next: check GoodVibes TUI shared-session/task status for the result.',
      ].join('\n'));
    } catch (error) {
      ctx.print([
        'Delegation failed.',
        `  error: ${summarizeError(error)}`,
        '  fallback: open GoodVibes TUI in the target workspace and paste the original task there.',
      ].join('\n'));
    }
  };

  registry.register({
    name: 'delegate',
    aliases: ['build'],
    description: 'Explicitly delegate build/fix/review work to GoodVibes TUI through shared-session routes',
    usage: '[--wrfc] <task>',
    argsHint: '[--wrfc] <task>',
    handler: makeHandler(false),
  });
  registry.register({
    name: 'wrfc',
    aliases: ['review'],
    description: 'Explicitly delegate build/fix/review work to GoodVibes TUI with WRFC requested',
    usage: '<task>',
    argsHint: '<task>',
    handler: makeHandler(true),
  });
}
