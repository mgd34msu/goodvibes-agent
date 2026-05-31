import { AgentPersonaRegistry, type AgentPersonaRecord } from '../../agent/persona-registry.ts';
import type { CommandContext, CommandRegistry } from '../command-registry.ts';
import { requireShellPaths } from './runtime-services.ts';

interface ParsedPersonaArgs {
  readonly rest: readonly string[];
  readonly flags: ReadonlyMap<string, string>;
  readonly yes: boolean;
}

function parsePersonaArgs(args: readonly string[]): ParsedPersonaArgs {
  const flags = new Map<string, string>();
  const rest: string[] = [];
  let yes = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? '';
    if (token === '--yes') {
      yes = true;
      continue;
    }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = args[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        index += 1;
      } else {
        flags.set(key, 'true');
      }
      continue;
    }
    rest.push(token);
  }
  return { rest, flags, yes };
}

function splitList(value: string | undefined): readonly string[] {
  if (!value) return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function registryFromContext(ctx: CommandContext): AgentPersonaRegistry {
  return AgentPersonaRegistry.fromShellPaths(requireShellPaths(ctx));
}

function summarizePersona(persona: AgentPersonaRecord, activePersonaId: string | null): string {
  const active = persona.id === activePersonaId ? 'active' : 'inactive';
  const tags = persona.tags.length > 0 ? ` tags=${persona.tags.join(',')}` : '';
  return `  ${persona.id}  ${active}  ${persona.reviewState}  ${persona.name} - ${persona.description}${tags}`;
}

function renderList(title: string, registry: AgentPersonaRegistry, personas: readonly AgentPersonaRecord[]): string {
  const snapshot = registry.snapshot();
  if (personas.length === 0) {
    return `${title}\n  No local Agent personas yet. Create one with /personas create --name <name> --description <summary> --body <instructions>.`;
  }
  return [
    `${title} (${personas.length})`,
    `  store: ${snapshot.path}`,
    `  active: ${snapshot.activePersona?.name ?? '(none)'}`,
    ...personas.map((persona) => summarizePersona(persona, snapshot.activePersonaId)),
  ].join('\n');
}

function renderPersona(persona: AgentPersonaRecord, activePersonaId: string | null): string {
  return [
    `Persona ${persona.name}`,
    `  id: ${persona.id}`,
    `  active: ${persona.id === activePersonaId ? 'yes' : 'no'}`,
    `  review: ${persona.reviewState}`,
    `  source: ${persona.source}`,
    `  provenance: ${persona.provenance}`,
    `  tags: ${persona.tags.join(', ') || '(none)'}`,
    `  triggers: ${persona.triggers.join(', ') || '(none)'}`,
    `  created: ${persona.createdAt}`,
    `  updated: ${persona.updatedAt}`,
    persona.staleReason ? `  stale reason: ${persona.staleReason}` : '',
    '',
    persona.description,
    '',
    persona.body,
  ].filter(Boolean).join('\n');
}

function requiredFlag(flags: ReadonlyMap<string, string>, key: string): string {
  const value = flags.get(key)?.trim();
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}

function printError(ctx: CommandContext, error: unknown): void {
  ctx.print(`Error: ${error instanceof Error ? error.message : String(error)}`);
}

export function registerPersonasRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'personas',
    aliases: ['persona'],
    description: 'Manage local GoodVibes Agent personas',
    usage: '[list|search <query>|show <id>|create --name <name> --description <summary> --body <instructions>|update <id> [--name ...] [--description ...] [--body ...]|use <id>|active|clear|review <id>|stale <id> <reason...>|delete <id> --yes]',
    async handler(args, ctx) {
      const sub = (args[0] ?? 'list').toLowerCase();
      const registryStore = registryFromContext(ctx);
      try {
        if (sub === 'list' || sub === 'open') {
          ctx.print(renderList('Agent Personas', registryStore, registryStore.list()));
          return;
        }
        if (sub === 'search') {
          const query = args.slice(1).join(' ').trim();
          ctx.print(renderList(query ? `Agent Personas matching "${query}"` : 'Agent Personas', registryStore, registryStore.search(query)));
          return;
        }
        if (sub === 'show') {
          const id = args[1];
          if (!id) {
            ctx.print('Usage: /personas show <id>');
            return;
          }
          const snapshot = registryStore.snapshot();
          const persona = registryStore.get(id);
          ctx.print(persona ? renderPersona(persona, snapshot.activePersonaId) : `Unknown persona: ${id}`);
          return;
        }
        if (sub === 'create') {
          const parsed = parsePersonaArgs(args.slice(1));
          const body = parsed.flags.get('body')?.trim() || parsed.rest.join(' ').trim();
          const persona = registryStore.create({
            name: requiredFlag(parsed.flags, 'name'),
            description: requiredFlag(parsed.flags, 'description'),
            body,
            tags: splitList(parsed.flags.get('tags')),
            triggers: splitList(parsed.flags.get('triggers')),
            source: 'user',
            provenance: 'slash-command',
          });
          ctx.print(`Created Agent persona ${persona.id}: ${persona.name}`);
          return;
        }
        if (sub === 'update') {
          const id = args[1];
          if (!id) {
            ctx.print('Usage: /personas update <id> [--name ...] [--description ...] [--body ...]');
            return;
          }
          const parsed = parsePersonaArgs(args.slice(2));
          const updated = registryStore.update(id, {
            name: parsed.flags.get('name'),
            description: parsed.flags.get('description'),
            body: parsed.flags.get('body'),
            tags: parsed.flags.has('tags') ? splitList(parsed.flags.get('tags')) : undefined,
            triggers: parsed.flags.has('triggers') ? splitList(parsed.flags.get('triggers')) : undefined,
            provenance: 'slash-command',
          });
          ctx.print(`Updated Agent persona ${updated.id}: ${updated.name}`);
          return;
        }
        if (sub === 'use') {
          const id = args[1];
          if (!id) {
            ctx.print('Usage: /personas use <id>');
            return;
          }
          const persona = registryStore.setActive(id);
          ctx.print(`Active Agent persona: ${persona.name} (${persona.id})`);
          return;
        }
        if (sub === 'active') {
          const snapshot = registryStore.snapshot();
          ctx.print(snapshot.activePersona ? renderPersona(snapshot.activePersona, snapshot.activePersonaId) : 'No active Agent persona.');
          return;
        }
        if (sub === 'clear') {
          registryStore.clearActive();
          ctx.print('Cleared active Agent persona.');
          return;
        }
        if (sub === 'review') {
          const id = args[1];
          if (!id) {
            ctx.print('Usage: /personas review <id>');
            return;
          }
          const persona = registryStore.markReviewed(id);
          ctx.print(`Reviewed Agent persona ${persona.id}.`);
          return;
        }
        if (sub === 'stale') {
          const id = args[1];
          if (!id) {
            ctx.print('Usage: /personas stale <id> <reason...>');
            return;
          }
          const persona = registryStore.markStale(id, args.slice(2).join(' '));
          ctx.print(`Marked Agent persona ${persona.id} stale.`);
          return;
        }
        if (sub === 'delete' || sub === 'remove') {
          const parsed = parsePersonaArgs(args.slice(1));
          const id = parsed.rest[0];
          if (!id) {
            ctx.print('Usage: /personas delete <id> --yes');
            return;
          }
          if (!parsed.yes) {
            ctx.print(`Refusing to delete Agent persona ${id} without --yes.`);
            return;
          }
          const removed = registryStore.deletePersona(id);
          ctx.print(`Deleted Agent persona ${removed.id}: ${removed.name}`);
          return;
        }
        ctx.print('Usage: /personas [list|search <query>|show <id>|create|update|use|active|clear|review|stale|delete]');
      } catch (error) {
        printError(ctx, error);
      }
    },
  });
}
