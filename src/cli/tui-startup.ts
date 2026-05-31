import type { CommandContext, CommandRegistry } from '../input/command-registry.ts';
import type { InputHandler } from '../input/handler.ts';
import { readOnboardingCheckMarker } from '../runtime/onboarding/index.ts';
import type { GoodVibesCliParseResult } from './types.ts';

export type InteractiveTerminalCheckInput = {
  readonly binary: string;
  readonly stdinIsTTY: boolean | undefined;
  readonly stdoutIsTTY: boolean | undefined;
};

export function getInteractiveTerminalLaunchError(input: InteractiveTerminalCheckInput): string | null {
  const stdinReady = input.stdinIsTTY === true;
  const stdoutReady = input.stdoutIsTTY === true;
  if (stdinReady && stdoutReady) return null;

  const missing = [
    stdinReady ? null : 'stdin',
    stdoutReady ? null : 'stdout',
  ].filter((entry): entry is string => entry !== null);
  const missingLabel = missing.length === 1 ? `${missing[0]} is` : `${missing.join(' and ')} are`;

  return [
    `${input.binary} requires an interactive terminal for the TUI (${missingLabel} not a TTY).`,
    `Run it from a terminal, or use non-interactive commands such as '${input.binary} --help', '${input.binary} status --json', or '${input.binary} run --print "<prompt>"'.`,
  ].join('\n');
}

export function applyInitialTuiCliState(options: {
  readonly cli: GoodVibesCliParseResult;
  readonly input: InputHandler;
  readonly commandRegistry: CommandRegistry;
  readonly commandContext: CommandContext;
  readonly shellPaths: Parameters<typeof readOnboardingCheckMarker>[0];
  readonly render: () => void;
}): void {
  const { cli, input, commandRegistry, commandContext, shellPaths, render } = options;
  const globalOnboardingMarker = readOnboardingCheckMarker(shellPaths, 'user');
  if (cli.command === 'onboarding') {
    input.openOnboardingWizard({ mode: 'edit', reset: true });
  } else if (cli.command === 'sessions' && cli.commandArgs[0] === 'resume') {
    const target = cli.commandArgs.slice(1).join(' ').trim();
    if (target) {
      void commandRegistry.execute('session', ['resume', target], commandContext).then(() => render());
    }
  } else if (!globalOnboardingMarker.exists) {
    input.openOnboardingWizard({ mode: 'new', reset: true });
  }

  const seededPrompt = cli.flags.prompt ?? (cli.rawCommand === undefined && cli.positionals.length > 0 ? cli.positionals.join(' ') : undefined);
  if (seededPrompt) {
    input.prompt = seededPrompt;
    input.cursorPos = seededPrompt.length;
  }
}
