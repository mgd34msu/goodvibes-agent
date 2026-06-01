import type { CommandContext, CommandRegistry } from '../input/command-registry.ts';
import type { InputHandler } from '../input/handler.ts';
import { readOnboardingCheckMarker } from '../runtime/onboarding/index.ts';
import type { GoodVibesCliParseResult } from './types.ts';

export type InteractiveTerminalCheckInput = {
  readonly binary: string;
  readonly stdinIsTTY: boolean | undefined;
  readonly stdoutIsTTY: boolean | undefined;
};

type NodeLikeError = Error & {
  readonly code?: string;
  readonly path?: string;
  readonly syscall?: string;
};

export type FatalStartupFormatOptions = {
  readonly binary: string;
  readonly debug?: boolean;
};

function isNodeLikeError(error: unknown): error is NodeLikeError {
  return error instanceof Error;
}

function fatalStartupMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function fatalStartupStack(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return fatalStartupMessage(error);
}

export function formatFatalStartupErrorForLog(error: unknown): string {
  return fatalStartupStack(error);
}

export function formatFatalStartupErrorForUser(error: unknown, options: FatalStartupFormatOptions): string {
  if (options.debug === true) return fatalStartupStack(error);

  const message = fatalStartupMessage(error);
  if (isNodeLikeError(error) && (error.code === 'EACCES' || error.code === 'EPERM')) {
    return [
      `${options.binary} could not prepare its local workspace or log directory.`,
      error.path ? `  path: ${error.path}` : '',
      error.syscall ? `  operation: ${error.syscall}` : '',
      '  reason: permission denied',
      `  next: launch from a writable directory, pass '${options.binary} --cd <dir>', or set GOODVIBES_WORKING_DIR to a writable path.`,
      '  note: GOODVIBES_AGENT_HOME can be set to move Agent-local config, sessions, memory, skills, personas, and routines.',
    ].filter((line) => line.length > 0).join('\n');
  }

  if (isNodeLikeError(error) && error.code === 'ENOENT') {
    return [
      `${options.binary} could not find a required startup path.`,
      error.path ? `  path: ${error.path}` : '',
      `  reason: ${message}`,
      `  next: check '${options.binary} --cd <dir>' and GOODVIBES_WORKING_DIR, then rerun '${options.binary} status'.`,
    ].filter((line) => line.length > 0).join('\n');
  }

  return [
    message || `${options.binary} failed during startup.`,
    'Set GOODVIBES_AGENT_DEBUG=1 to print a stack trace.',
  ].join('\n');
}

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
  const seededPrompt = cli.flags.prompt ?? (cli.rawCommand === undefined && cli.positionals.length > 0 ? cli.positionals.join(' ') : undefined);
  if (cli.command === 'onboarding') {
    input.openOnboardingWizard({ mode: 'edit', reset: true });
  } else if (cli.command === 'sessions' && cli.commandArgs[0] === 'resume') {
    const target = cli.commandArgs.slice(1).join(' ').trim();
    if (target) {
      void commandRegistry.execute('session', ['resume', target], commandContext).then(() => render());
    }
  } else if (!globalOnboardingMarker.exists) {
    input.openOnboardingWizard({ mode: 'new', reset: true });
  } else if (cli.command === 'tui' && seededPrompt === undefined) {
    input.openAgentWorkspace(commandContext);
  }

  if (seededPrompt) {
    input.prompt = seededPrompt;
    input.cursorPos = seededPrompt.length;
  }
}
