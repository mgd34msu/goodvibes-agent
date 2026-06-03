import type { CommandRegistry, SlashCommand } from '../input/command-registry.ts';
import { parseSlashCommand } from '../input/slash-command-parser.ts';
import { describeCommandPolicy } from './agent-harness-metadata.ts';

export interface AgentHarnessCommandCatalogArgs {
  readonly query?: unknown;
  readonly command?: unknown;
  readonly commandName?: unknown;
  readonly args?: unknown;
  readonly target?: unknown;
  readonly limit?: unknown;
}

interface CommandDetailLookup {
  readonly source: 'command' | 'commandName' | 'target' | 'query';
  readonly input: string;
  readonly parsedName: string;
  readonly parsedArgs: readonly string[];
  readonly resolvedBy: 'name' | 'alias' | 'case-insensitive-name' | 'case-insensitive-alias' | 'description' | 'prefix';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => typeof entry === 'string' ? entry : String(entry));
}

function commandMatches(command: SlashCommand, query: string): boolean {
  if (!query) return true;
  const haystack = [
    command.name,
    ...(command.aliases ?? []),
    command.description,
    command.usage ?? '',
    command.argsHint ?? '',
  ].join('\n').toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function describeCommand(command: SlashCommand, lookup?: CommandDetailLookup): Record<string, unknown> {
  return {
    name: command.name,
    slash: `/${command.name}`,
    aliases: command.aliases ?? [],
    description: command.description,
    usage: command.usage ?? '',
    argsHint: command.argsHint ?? command.usage ?? '',
    ...(lookup ? {
      lookup: {
        source: lookup.source,
        input: lookup.input,
        parsedName: lookup.parsedName,
        parsedArgs: lookup.parsedArgs,
        resolvedBy: lookup.resolvedBy,
      },
    } : {}),
    policy: describeCommandPolicy(command.name),
  };
}

function commandDetailLookupFromArgs(args: AgentHarnessCommandCatalogArgs): Omit<CommandDetailLookup, 'resolvedBy'> | null {
  const rawCommand = readString(args.command);
  if (rawCommand) {
    const parsed = parseSlashCommand(rawCommand);
    return { source: 'command', input: rawCommand, parsedName: parsed.name, parsedArgs: parsed.args };
  }
  const rawCommandName = readString(args.commandName);
  if (rawCommandName) {
    const parsed = parseSlashCommand(rawCommandName);
    const explicitArgs = readStringArray(args.args);
    return {
      source: 'commandName',
      input: rawCommandName,
      parsedName: parsed.name,
      parsedArgs: explicitArgs.length > 0 ? explicitArgs : parsed.args,
    };
  }
  const rawTarget = readString(args.target);
  if (rawTarget) {
    const parsed = parseSlashCommand(rawTarget);
    return { source: 'target', input: rawTarget, parsedName: parsed.name, parsedArgs: parsed.args };
  }
  const rawQuery = readString(args.query);
  if (rawQuery) {
    const parsed = parseSlashCommand(rawQuery);
    return { source: 'query', input: rawQuery, parsedName: parsed.name, parsedArgs: parsed.args };
  }
  return null;
}

function resolveCommandDetail(commandRegistry: CommandRegistry, args: AgentHarnessCommandCatalogArgs): { readonly command: SlashCommand; readonly lookup: CommandDetailLookup } | null {
  const lookup = commandDetailLookupFromArgs(args);
  if (!lookup?.parsedName) return null;
  const direct = commandRegistry.get(lookup.parsedName);
  if (direct) {
    return {
      command: direct,
      lookup: {
        ...lookup,
        resolvedBy: direct.name === lookup.parsedName ? 'name' : 'alias',
      },
    };
  }

  const normalized = lookup.parsedName.toLowerCase();
  for (const command of commandRegistry.list()) {
    if (command.name.toLowerCase() === normalized) {
      return { command, lookup: { ...lookup, resolvedBy: 'case-insensitive-name' } };
    }
    if ((command.aliases ?? []).some((alias) => alias.toLowerCase() === normalized)) {
      return { command, lookup: { ...lookup, resolvedBy: 'case-insensitive-alias' } };
    }
  }

  const descriptionMatches = commandRegistry.list().filter((command) => commandMatches(command, lookup.input));
  if (descriptionMatches.length === 1) {
    return { command: descriptionMatches[0]!, lookup: { ...lookup, resolvedBy: 'description' } };
  }

  const prefixMatches = commandRegistry.fuzzyMatch(lookup.parsedName).filter((entry) => entry.score >= 80);
  if (prefixMatches.length === 1) {
    return { command: prefixMatches[0]!.command, lookup: { ...lookup, resolvedBy: 'prefix' } };
  }
  return null;
}

export function listHarnessCommands(commandRegistry: CommandRegistry, args: AgentHarnessCommandCatalogArgs): readonly Record<string, unknown>[] {
  const query = readString(args.query);
  const limit = readLimit(args.limit, 200);
  return commandRegistry.list()
    .filter((command) => commandMatches(command, query))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((command) => describeCommand(command));
}

export function describeHarnessCommand(commandRegistry: CommandRegistry, args: AgentHarnessCommandCatalogArgs): Record<string, unknown> | null {
  const detail = resolveCommandDetail(commandRegistry, args);
  return detail ? describeCommand(detail.command, detail.lookup) : null;
}
