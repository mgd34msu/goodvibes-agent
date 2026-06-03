import type { GoodVibesCliCommand } from '../cli/types.ts';
import { describeGoodVibesCommandHelp } from '../cli/help.ts';
import {
  listBlockedGoodVibesCliCommandTokens,
  listGoodVibesCliCommandTokens,
  listGoodVibesCliCommands,
  parseGoodVibesCli,
} from '../cli/parser.ts';
import { describeCliCommandPolicy } from './agent-harness-metadata.ts';

export interface AgentHarnessCliArgs {
  readonly query?: unknown;
  readonly command?: unknown;
  readonly cliCommand?: unknown;
  readonly commandName?: unknown;
  readonly limit?: unknown;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function cliCommandTokens(command: GoodVibesCliCommand): readonly string[] {
  if (command === 'unknown') return [];
  if (command === 'tui') return ['(no command)'];
  return listGoodVibesCliCommandTokens()
    .filter((token) => parseGoodVibesCli([token]).command === command)
    .sort();
}

function fallbackCliSummary(command: GoodVibesCliCommand): string {
  if (command === 'tui') return 'Launch the interactive Agent TUI.';
  if (command === 'help') return 'Print top-level or command-specific help.';
  if (command === 'version') return 'Print the installed Agent package version.';
  return 'Inspect the CLI help for this Agent package command.';
}

function describeCliCommand(command: GoodVibesCliCommand): Record<string, unknown> {
  const help = describeGoodVibesCommandHelp(command);
  const tokens = cliCommandTokens(command);
  return {
    name: command,
    tokens,
    invocation: command === 'tui' ? 'goodvibes-agent' : `goodvibes-agent ${tokens[0] ?? command}`,
    helpTopic: help?.command ?? command,
    summary: help?.summary ?? fallbackCliSummary(command),
    usage: help?.usage ?? (command === 'tui' ? ['goodvibes-agent [OPTIONS]'] : [`goodvibes-agent ${command} [ARGS]`]),
    aliases: help?.aliases ?? tokens.filter((token) => token !== command),
    subcommands: help?.subcommands ?? [],
    examples: help?.examples ?? [],
    policy: describeCliCommandPolicy(command),
  };
}

function cliCommandMatches(command: Record<string, unknown>, query: string): boolean {
  if (!query) return true;
  return [
    command.name,
    command.tokens,
    command.summary,
    command.usage,
    command.aliases,
    command.subcommands,
    command.examples,
    command.policy,
  ].map((value) => JSON.stringify(value)).join('\n').toLowerCase().includes(query.toLowerCase());
}

export function totalHarnessCliCommands(): number {
  return listGoodVibesCliCommands().filter((command) => command !== 'unknown').length;
}

export function blockedHarnessCliCommandTokens(): readonly string[] {
  return listBlockedGoodVibesCliCommandTokens();
}

export function listHarnessCliCommands(args: AgentHarnessCliArgs): readonly Record<string, unknown>[] {
  const query = readString(args.query);
  const limit = readLimit(args.limit, 200);
  return listGoodVibesCliCommands()
    .filter((command) => command !== 'unknown')
    .map(describeCliCommand)
    .filter((command) => cliCommandMatches(command, query))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
}

function cliTokensFromArgs(args: AgentHarnessCliArgs): readonly string[] {
  const raw = readString(args.cliCommand) || readString(args.command) || readString(args.commandName) || readString(args.query);
  if (!raw) return [];
  const tokens = raw.split(/\s+/).filter((token) => token.length > 0);
  if (tokens[0] === 'goodvibes-agent' || tokens[0]?.endsWith('/goodvibes-agent')) return tokens.slice(1);
  return tokens;
}

export function describeHarnessCliCommand(args: AgentHarnessCliArgs): Record<string, unknown> {
  const tokens = cliTokensFromArgs(args);
  if (tokens.length === 0) return describeCliCommand('tui');
  const parsed = parseGoodVibesCli(tokens);
  if (parsed.command === 'unknown') {
    return {
      supported: false,
      token: parsed.rawCommand ?? tokens[0],
      errors: parsed.errors,
      blockedTokens: blockedHarnessCliCommandTokens(),
      policy: describeCliCommandPolicy(parsed.rawCommand ?? tokens[0] ?? 'unknown'),
    };
  }
  return {
    ...describeCliCommand(parsed.command),
    parsed: {
      command: parsed.command,
      rawCommand: parsed.rawCommand,
      commandArgs: parsed.commandArgs,
      positionals: parsed.positionals,
      flags: {
        provider: parsed.flags.provider,
        model: parsed.flags.model,
        agentProfile: parsed.flags.agentProfile,
        runtimeUrl: parsed.flags.runtimeUrl,
        workingDir: parsed.flags.workingDir,
        help: parsed.flags.help,
        version: parsed.flags.version,
        print: parsed.flags.print,
        outputFormat: parsed.flags.outputFormat,
        configOverrides: parsed.flags.configOverrides.map((override) => {
          const index = override.indexOf('=');
          return index < 0 ? override : `${override.slice(0, index)}=<redacted>`;
        }),
        enableFeatures: parsed.flags.enableFeatures,
        disableFeatures: parsed.flags.disableFeatures,
        noAltScreen: parsed.flags.noAltScreen,
        port: parsed.flags.port,
        hostname: parsed.flags.hostname,
        open: parsed.flags.open,
        continueLast: parsed.flags.continueLast,
        resume: parsed.flags.resume,
        session: parsed.flags.session,
        fork: parsed.flags.fork,
        rawOutput: parsed.flags.rawOutput,
        acceptRawOutputRisk: parsed.flags.acceptRawOutputRisk,
      },
      errors: parsed.errors,
    },
  };
}
