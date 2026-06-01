import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createShellPathService } from '@/runtime/index.ts';
import { CommandRegistry } from '../../input/command-registry.ts';
import { applyInitialTuiCliState, formatFatalStartupErrorForUser, getInteractiveTerminalLaunchError } from '../../cli/tui-startup.ts';
import { writeOnboardingCheckMarker } from '../../runtime/onboarding/index.ts';
import type { CommandContext } from '../../input/command-registry.ts';
import type { InputHandler } from '../../input/handler.ts';
import type { GoodVibesCliParseResult } from '../../cli/types.ts';

function makeShellPaths() {
  const root = join(tmpdir(), `gv-tui-startup-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return createShellPathService({
    workingDirectory: join(root, 'workspace'),
    homeDirectory: join(root, 'home'),
  });
}

function makeCli(overrides: Partial<GoodVibesCliParseResult> = {}): GoodVibesCliParseResult {
  return {
    binary: 'goodvibes',
    command: 'tui',
    rawCommand: undefined,
    commandArgs: [],
    positionals: [],
    flags: {
      provider: undefined,
      model: undefined,
      agentProfile: undefined,
      daemonHome: undefined,
      workingDir: undefined,
      help: false,
      version: false,
      prompt: undefined,
      print: false,
      outputFormat: 'text',
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      noAltScreen: false,
      port: undefined,
      hostname: undefined,
      open: false,
      continueLast: false,
      resume: undefined,
      session: undefined,
      fork: false,
      rawOutput: false,
      acceptRawOutputRisk: false,
    },
    errors: [],
    ...overrides,
  };
}

function runStartup(
  shellPaths: ReturnType<typeof makeShellPaths>,
  cli: GoodVibesCliParseResult = makeCli(),
): { readonly onboardingOpened: number; readonly workspaceOpened: number; readonly prompt: string } {
  let opened = 0;
  let workspaceOpened = 0;
  const input = {
    prompt: '',
    cursorPos: 0,
    openOnboardingWizard: () => {
      opened += 1;
    },
    openAgentWorkspace: () => {
      workspaceOpened += 1;
    },
  } as unknown as InputHandler;

  applyInitialTuiCliState({
    cli,
    input,
    commandRegistry: new CommandRegistry(),
    commandContext: {} as CommandContext,
    shellPaths,
    render: () => {},
  });

  return { onboardingOpened: opened, workspaceOpened, prompt: input.prompt };
}

describe('initial TUI onboarding startup check', () => {
  test('opens onboarding when the global user check marker is absent', () => {
    const shellPaths = makeShellPaths();

    const result = runStartup(shellPaths);
    expect(result.onboardingOpened).toBe(1);
    expect(result.workspaceOpened).toBe(0);
  });

  test('does not use project markers as the global onboarding check', () => {
    const shellPaths = makeShellPaths();
    writeOnboardingCheckMarker(shellPaths, {
      scope: 'project',
      source: 'wizard',
      mode: 'new',
    });

    const result = runStartup(shellPaths);
    expect(result.onboardingOpened).toBe(1);
    expect(result.workspaceOpened).toBe(0);
  });

  test('opens Agent workspace after the global user check marker exists', () => {
    const shellPaths = makeShellPaths();
    writeOnboardingCheckMarker(shellPaths, {
      scope: 'user',
      source: 'wizard',
      mode: 'new',
    });

    const result = runStartup(shellPaths);
    expect(result.onboardingOpened).toBe(0);
    expect(result.workspaceOpened).toBe(1);
  });

  test('does not replace a seeded prompt with the Agent workspace', () => {
    const shellPaths = makeShellPaths();
    writeOnboardingCheckMarker(shellPaths, {
      scope: 'user',
      source: 'wizard',
      mode: 'new',
    });

    const result = runStartup(shellPaths, makeCli({
      positionals: ['summarize', 'today'],
    }));

    expect(result.onboardingOpened).toBe(0);
    expect(result.workspaceOpened).toBe(0);
    expect(result.prompt).toBe('summarize today');
  });
});

describe('interactive TUI terminal guard', () => {
  test('allows launch when stdin and stdout are TTY streams', () => {
    expect(getInteractiveTerminalLaunchError({
      binary: 'goodvibes-agent',
      stdinIsTTY: true,
      stdoutIsTTY: true,
    })).toBeNull();
  });

  test('returns a plain non-TTY error before renderer startup', () => {
    const message = getInteractiveTerminalLaunchError({
      binary: 'goodvibes-agent',
      stdinIsTTY: false,
      stdoutIsTTY: false,
    });

    expect(message).toContain('requires an interactive terminal');
    expect(message).toContain('stdin and stdout are not a TTY');
    expect(message).toContain('goodvibes-agent status --json');
    expect(message).not.toContain('\x1b[');
  });
});

describe('fatal TUI startup formatting', () => {
  test('renders permission errors without stack traces', () => {
    const error = Object.assign(new Error("EACCES: permission denied, mkdir '/work'"), {
      code: 'EACCES',
      path: '/work',
      syscall: 'mkdir',
    });

    const message = formatFatalStartupErrorForUser(error, { binary: 'goodvibes-agent' });

    expect(message).toContain('could not prepare its local workspace or log directory');
    expect(message).toContain('path: /work');
    expect(message).toContain('goodvibes-agent --cd <dir>');
    expect(message).not.toContain('at ');
    expect(message).not.toContain('Error: EACCES');
  });

  test('keeps stack traces available only in explicit debug mode', () => {
    const error = new Error('startup failed');

    const normal = formatFatalStartupErrorForUser(error, { binary: 'goodvibes-agent' });
    const debug = formatFatalStartupErrorForUser(error, { binary: 'goodvibes-agent', debug: true });

    expect(normal).toBe('startup failed\nSet GOODVIBES_AGENT_DEBUG=1 to print a stack trace.');
    expect(debug).toContain('Error: startup failed');
    expect(debug).toContain('at ');
  });
});
