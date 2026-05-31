import type { CommandRegistry } from '../command-registry.ts';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

export function registerMemoryProductRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'memory-sync',
    aliases: ['memsync'],
    description: 'Dedicated front-door for durable memory export/import and bundle exchange',
    usage: '[export <path> [scope] --yes | import <path> --yes]',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const sub = (commandArgs[0] ?? '').toLowerCase();
      if (!ctx.executeCommand) {
        ctx.print('Memory sync controls are not available in this runtime.');
        return;
      }
      if (sub === 'export' && commandArgs[1]) {
        if (!parsed.yes) {
          requireYesFlag(ctx, `export durable memory bundle to ${commandArgs[1]}`, '/memory-sync export <path> [scope] --yes');
          return;
        }
        const scope = commandArgs[2];
        const recallArgs = ['export', commandArgs[1], ...(scope ? ['--scope', scope] : []), '--yes'];
        await ctx.executeCommand('recall', recallArgs);
        return;
      }
      if (sub === 'import' && commandArgs[1]) {
        if (!parsed.yes) {
          requireYesFlag(ctx, `import durable memory bundle from ${commandArgs[1]}`, '/memory-sync import <path> --yes');
          return;
        }
        await ctx.executeCommand('recall', ['import', commandArgs[1], '--yes']);
        return;
      }
      ctx.print('Usage: /memory-sync [export <path> [scope] --yes | import <path> --yes]');
    },
  });

  registry.register({
    name: 'handoff',
    description: 'Dedicated front-door for reviewable memory handoff bundles',
    usage: '[export <path> [scope] --yes | inspect <path> | import <path> --yes]',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const sub = (commandArgs[0] ?? '').toLowerCase();
      if (!ctx.executeCommand) {
        ctx.print('Handoff controls are not available in this runtime.');
        return;
      }
      if (sub === 'export' && commandArgs[1]) {
        if (!parsed.yes) {
          requireYesFlag(ctx, `export memory handoff bundle to ${commandArgs[1]}`, '/handoff export <path> [scope] --yes');
          return;
        }
        const scope = commandArgs[2];
        await ctx.executeCommand('recall', ['handoff-export', commandArgs[1], ...(scope ? ['--scope', scope] : []), '--yes']);
        return;
      }
      if (sub === 'inspect' && commandArgs[1]) {
        await ctx.executeCommand('recall', ['handoff-inspect', commandArgs[1]]);
        return;
      }
      if (sub === 'import' && commandArgs[1]) {
        if (!parsed.yes) {
          requireYesFlag(ctx, `import memory handoff bundle from ${commandArgs[1]}`, '/handoff import <path> --yes');
          return;
        }
        await ctx.executeCommand('recall', ['handoff-import', commandArgs[1], '--yes']);
        return;
      }
      ctx.print('Usage: /handoff [export <path> [scope] --yes | inspect <path> | import <path> --yes]');
    },
  });

  registry.register({
    name: 'session-memory',
    description: 'Dedicated front-door for session-scoped memory capture and review',
    usage: '[queue [limit] | export <path> --yes | add <class> <summary...>]',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const sub = (commandArgs[0] ?? 'queue').toLowerCase();
      if (!ctx.executeCommand) {
        ctx.print('Session memory controls are not available in this runtime.');
        return;
      }
      if (sub === 'queue') {
        await ctx.executeCommand('recall', ['queue', ...(commandArgs[1] ? [commandArgs[1]] : [])]);
        return;
      }
      if (sub === 'export' && commandArgs[1]) {
        if (!parsed.yes) {
          requireYesFlag(ctx, `export session memory bundle to ${commandArgs[1]}`, '/session-memory export <path> --yes');
          return;
        }
        await ctx.executeCommand('recall', ['export', commandArgs[1], '--scope', 'session', '--yes']);
        return;
      }
      if (sub === 'add' && commandArgs.length >= 3) {
        await ctx.executeCommand('recall', ['add', commandArgs[1], ...commandArgs.slice(2), '--scope', 'session']);
        return;
      }
      ctx.print('Usage: /session-memory [queue [limit] | export <path> --yes | add <class> <summary...>]');
    },
  });

  registry.register({
    name: 'team-memory',
    description: 'Dedicated front-door for team/shared memory review and exchange',
    usage: '[queue [limit] | export <path> --yes | import <path> --yes | capture policy]',
    async handler(args, ctx) {
      const parsed = stripYesFlag(args);
      const commandArgs = [...parsed.rest];
      const sub = (commandArgs[0] ?? 'queue').toLowerCase();
      if (!ctx.executeCommand) {
        ctx.print('Team memory controls are not available in this runtime.');
        return;
      }
      if (sub === 'queue') {
        await ctx.executeCommand('recall', ['queue', ...(commandArgs[1] ? [commandArgs[1]] : [])]);
        return;
      }
      if (sub === 'export' && commandArgs[1]) {
        if (!parsed.yes) {
          requireYesFlag(ctx, `export team memory handoff bundle to ${commandArgs[1]}`, '/team-memory export <path> --yes');
          return;
        }
        await ctx.executeCommand('recall', ['handoff-export', commandArgs[1], '--scope', 'team', '--yes']);
        return;
      }
      if (sub === 'import' && commandArgs[1]) {
        if (!parsed.yes) {
          requireYesFlag(ctx, `import team memory handoff bundle from ${commandArgs[1]}`, '/team-memory import <path> --yes');
          return;
        }
        await ctx.executeCommand('recall', ['handoff-import', commandArgs[1], '--yes']);
        return;
      }
      if (sub === 'capture' && commandArgs[1]?.toLowerCase() === 'policy') {
        await ctx.executeCommand('recall', ['capture', 'policy']);
        return;
      }
      ctx.print('Usage: /team-memory [queue [limit] | export <path> --yes | import <path> --yes | capture policy]');
    },
  });
}
