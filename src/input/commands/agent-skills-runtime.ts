import { AgentSkillRegistry, type AgentSkillRecord } from '../../agent/skill-registry.ts';
import type { CommandContext, CommandRegistry } from '../command-registry.ts';
import { requireShellPaths } from './runtime-services.ts';

interface ParsedSkillArgs {
  readonly rest: readonly string[];
  readonly flags: ReadonlyMap<string, string>;
  readonly yes: boolean;
}

function parseSkillArgs(args: readonly string[]): ParsedSkillArgs {
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

function registryFromContext(ctx: CommandContext): AgentSkillRegistry {
  return AgentSkillRegistry.fromShellPaths(requireShellPaths(ctx));
}

function requiredFlag(flags: ReadonlyMap<string, string>, key: string): string {
  const value = flags.get(key)?.trim();
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}

function summarizeSkill(skill: AgentSkillRecord): string {
  const enabled = skill.enabled ? 'enabled' : 'disabled';
  const tags = skill.tags.length > 0 ? ` tags=${skill.tags.join(',')}` : '';
  return `  ${skill.id}  ${enabled}  ${skill.reviewState}  ${skill.name} - ${skill.description}${tags}`;
}

function renderList(title: string, registry: AgentSkillRegistry, skills: readonly AgentSkillRecord[]): string {
  const snapshot = registry.snapshot();
  if (skills.length === 0) {
    return `${title}\n  No local Agent skills yet. Create one with /agent-skills create --name <name> --description <summary> --procedure <steps>.`;
  }
  return [
    `${title} (${skills.length})`,
    `  store: ${snapshot.path}`,
    `  enabled: ${snapshot.enabledSkills.length}`,
    ...skills.map(summarizeSkill),
  ].join('\n');
}

function renderSkill(skill: AgentSkillRecord): string {
  return [
    `Skill ${skill.name}`,
    `  id: ${skill.id}`,
    `  enabled: ${skill.enabled ? 'yes' : 'no'}`,
    `  review: ${skill.reviewState}`,
    `  source: ${skill.source}`,
    `  provenance: ${skill.provenance}`,
    `  tags: ${skill.tags.join(', ') || '(none)'}`,
    `  triggers: ${skill.triggers.join(', ') || '(manual)'}`,
    `  created: ${skill.createdAt}`,
    `  updated: ${skill.updatedAt}`,
    skill.staleReason ? `  stale reason: ${skill.staleReason}` : '',
    '',
    skill.description,
    '',
    skill.procedure,
  ].filter(Boolean).join('\n');
}

function printError(ctx: CommandContext, error: unknown): void {
  ctx.print(`Error: ${error instanceof Error ? error.message : String(error)}`);
}

export function registerAgentSkillsRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'agent-skills',
    aliases: ['askills', 'local-skills'],
    description: 'Manage local GoodVibes Agent skills',
    usage: '[list|enabled|search <query>|show <id>|create --name <name> --description <summary> --procedure <steps>|update <id> [--name ...] [--description ...] [--procedure ...]|enable <id>|disable <id>|review <id>|stale <id> <reason...>|delete <id> --yes]',
    async handler(args, ctx) {
      const sub = (args[0] ?? 'list').toLowerCase();
      const skillRegistry = registryFromContext(ctx);
      try {
        if (sub === 'list' || sub === 'open') {
          ctx.print(renderList('Agent Skills', skillRegistry, skillRegistry.list()));
          return;
        }
        if (sub === 'enabled') {
          const snapshot = skillRegistry.snapshot();
          ctx.print(renderList('Enabled Agent Skills', skillRegistry, snapshot.enabledSkills));
          return;
        }
        if (sub === 'search') {
          const query = args.slice(1).join(' ').trim();
          ctx.print(renderList(query ? `Agent Skills matching "${query}"` : 'Agent Skills', skillRegistry, skillRegistry.search(query)));
          return;
        }
        if (sub === 'show') {
          const id = args[1];
          if (!id) {
            ctx.print('Usage: /agent-skills show <id>');
            return;
          }
          const skill = skillRegistry.get(id);
          ctx.print(skill ? renderSkill(skill) : `Unknown Agent skill: ${id}`);
          return;
        }
        if (sub === 'create') {
          const parsed = parseSkillArgs(args.slice(1));
          const procedure = parsed.flags.get('procedure')?.trim() || parsed.rest.join(' ').trim();
          const skill = skillRegistry.create({
            name: requiredFlag(parsed.flags, 'name'),
            description: requiredFlag(parsed.flags, 'description'),
            procedure,
            triggers: splitList(parsed.flags.get('triggers')),
            tags: splitList(parsed.flags.get('tags')),
            enabled: parsed.flags.get('enabled') === 'true',
            source: 'user',
            provenance: 'slash-command',
          });
          ctx.print(`Created Agent skill ${skill.id}: ${skill.name}`);
          return;
        }
        if (sub === 'update') {
          const id = args[1];
          if (!id) {
            ctx.print('Usage: /agent-skills update <id> [--name ...] [--description ...] [--procedure ...]');
            return;
          }
          const parsed = parseSkillArgs(args.slice(2));
          const updated = skillRegistry.update(id, {
            name: parsed.flags.get('name'),
            description: parsed.flags.get('description'),
            procedure: parsed.flags.get('procedure'),
            triggers: parsed.flags.has('triggers') ? splitList(parsed.flags.get('triggers')) : undefined,
            tags: parsed.flags.has('tags') ? splitList(parsed.flags.get('tags')) : undefined,
            provenance: 'slash-command',
          });
          ctx.print(`Updated Agent skill ${updated.id}: ${updated.name}`);
          return;
        }
        if (sub === 'enable' || sub === 'disable') {
          const id = args[1];
          if (!id) {
            ctx.print(`Usage: /agent-skills ${sub} <id>`);
            return;
          }
          const skill = skillRegistry.setEnabled(id, sub === 'enable');
          ctx.print(`${sub === 'enable' ? 'Enabled' : 'Disabled'} Agent skill ${skill.id}: ${skill.name}`);
          return;
        }
        if (sub === 'review') {
          const id = args[1];
          if (!id) {
            ctx.print('Usage: /agent-skills review <id>');
            return;
          }
          const skill = skillRegistry.markReviewed(id);
          ctx.print(`Reviewed Agent skill ${skill.id}.`);
          return;
        }
        if (sub === 'stale') {
          const id = args[1];
          if (!id) {
            ctx.print('Usage: /agent-skills stale <id> <reason...>');
            return;
          }
          const skill = skillRegistry.markStale(id, args.slice(2).join(' '));
          ctx.print(`Marked Agent skill ${skill.id} stale.`);
          return;
        }
        if (sub === 'delete' || sub === 'remove') {
          const parsed = parseSkillArgs(args.slice(1));
          const id = parsed.rest[0];
          if (!id) {
            ctx.print('Usage: /agent-skills delete <id> --yes');
            return;
          }
          if (!parsed.yes) {
            ctx.print(`Refusing to delete Agent skill ${id} without --yes.`);
            return;
          }
          const removed = skillRegistry.deleteSkill(id);
          ctx.print(`Deleted Agent skill ${removed.id}: ${removed.name}`);
          return;
        }
        ctx.print('Usage: /agent-skills [list|enabled|search|show|create|update|enable|disable|review|stale|delete]');
      } catch (error) {
        printError(ctx, error);
      }
    },
  });
}
