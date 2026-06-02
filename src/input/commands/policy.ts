import type { SlashCommand, CommandContext } from '../command-registry.ts';
import { dispatchPolicyCommand } from './policy-dispatch.ts';

export const policyCommand: SlashCommand = {
  name: 'policy',
  aliases: ['pol'],
  description: 'Review or manage versioned policy bundles (load, simulate, diff, promote, rollback).',
  usage: '<subcommand> [args]',
  argsHint: 'load|simulate|diff|lint|preflight|promote|rollback|status',
  handler: async (args: string[], context: CommandContext): Promise<void> => {
    await dispatchPolicyCommand(args, context);
  },
};
