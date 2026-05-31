import type { CommandRegistry } from '../command-registry.ts';
import { handleReplayCommand } from '@pellux/goodvibes-sdk/platform/core';
import { requireReplayEngine } from './runtime-services.ts';
import { requireYesFlag, stripYesFlag } from './confirmation.ts';

export function registerReplayRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'replay',
    aliases: ['rep'],
    description: 'Deterministic replay: load, step, seek, diff, and export recorded runs',
    usage: '[load [runId] | step [n] | seek <rev> | diff | export <path> --yes]',
    argsHint: '[load|step|seek|diff|export]',
    handler(args, ctx) {
      const command = args[0] ?? 'help';
      const { rest, yes } = stripYesFlag(args);
      if (command === 'export' && !yes) {
        requireYesFlag(ctx, `export replay run to ${args[1] ?? '<path>'}`, '/replay export <path> --yes');
        return;
      }
      const replayEngine = requireReplayEngine(ctx);
      const result = handleReplayCommand({ replayEngine }, command, rest.slice(1));
      ctx.print(result.output);
    },
  });
}
