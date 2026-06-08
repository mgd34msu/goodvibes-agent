import type { CommandContext } from '../input/command-registry.ts';
import { resolveHarnessCommandDetail, type CommandDetailLookup } from './agent-harness-command-catalog.ts';
import type { AgentHarnessToolArgs, AgentHarnessToolDeps } from './agent-harness-tool-types.ts';
import { error, output, requireConfirmedAction } from './agent-harness-tool-utils.ts';

function invocationArgsFromLookup(lookup: CommandDetailLookup): readonly string[] {
  return lookup.resolvedBy === 'description' ? [] : lookup.parsedArgs;
}

function safeCommandDisplay(name: string): string {
  return `/${name}`;
}

export async function runCommand(deps: AgentHarnessToolDeps, args: AgentHarnessToolArgs): Promise<{ readonly success: boolean; readonly output?: string; readonly error?: string }> {
  const confirmationError = requireConfirmedAction(args, 'Slash command invocation');
  if (confirmationError) return error(confirmationError);
  const resolved = resolveHarnessCommandDetail(deps.commandRegistry, args);
  if (resolved?.status === 'ambiguous') {
    return error(`Ambiguous slash command ${resolved.input}. Candidates: ${JSON.stringify(resolved.candidates)}`);
  }
  if (!resolved) return error('run_command requires a valid command, commandName, target, or query. Use mode:"commands" to inspect available commands.');

  const printed: string[] = [];
  const toolContext: CommandContext = {
    ...deps.commandContext,
    print: (text: string) => {
      printed.push(text);
    },
    renderRequest: () => {},
    executeCommand: async (name: string, commandArgs: string[]) => {
      return deps.commandRegistry.execute(name, commandArgs, toolContext);
    },
  };
  const commandArgs = invocationArgsFromLookup(resolved.lookup);
  const handled = await deps.commandRegistry.execute(resolved.command.name, [...commandArgs], toolContext);
  if (!handled) return error(`Unknown slash command /${resolved.command.name}.`);
  return output([
    `Command ${safeCommandDisplay(resolved.command.name)} completed.`,
    `Resolved by ${resolved.lookup.source} ${resolved.lookup.resolvedBy}.`,
    printed.length > 0 ? printed.join('\n') : '(no text output)',
  ].join('\n'));
}
