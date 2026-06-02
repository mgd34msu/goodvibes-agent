import { discoverRoutines, type DiscoveredRoutineRecord } from '../../agent/routine-discovery.ts';
import { AgentRoutineRegistry, evaluateAgentRoutineReadiness, type AgentRoutineRecord } from '../../agent/routine-registry.ts';
import { buildAgentSkillRequirements, formatAgentSkillRequirement } from '../../agent/skill-registry.ts';
import {
  buildRoutineSchedulePreview,
  promoteRoutineToDaemonSchedule,
  resolveAgentDaemonConnection,
} from '../../agent/routine-schedule-promotion.ts';
import { parseRoutineSchedulePromotionArgs } from '../../agent/routine-schedule-args.ts';
import {
  formatRoutineScheduleCorrelation,
  formatRoutineScheduleFailure,
  formatRoutineSchedulePreview,
  formatRoutineScheduleReceipt,
  formatRoutineScheduleReceipts,
  formatRoutineScheduleSuccess,
} from '../../agent/routine-schedule-format.ts';
import {
  reconcileRoutineScheduleReceipts,
  RoutineScheduleReceiptStore,
} from '../../agent/routine-schedule-receipts.ts';
import type { CommandContext, CommandRegistry } from '../command-registry.ts';
import { requireShellPaths } from './runtime-services.ts';

interface ParsedRoutineArgs {
  readonly rest: readonly string[];
  readonly flags: ReadonlyMap<string, string>;
  readonly yes: boolean;
}

function parseRoutineArgs(args: readonly string[]): ParsedRoutineArgs {
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

function registryFromContext(ctx: CommandContext): AgentRoutineRegistry {
  return AgentRoutineRegistry.fromShellPaths(requireShellPaths(ctx));
}

function receiptStoreFromContext(ctx: CommandContext): RoutineScheduleReceiptStore {
  return RoutineScheduleReceiptStore.fromShellPaths(requireShellPaths(ctx));
}

function requiredFlag(flags: ReadonlyMap<string, string>, key: string): string {
  const value = flags.get(key)?.trim();
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}

function summarizeRoutine(routine: AgentRoutineRecord): string {
  const enabled = routine.enabled ? 'enabled' : 'disabled';
  const tags = routine.tags.length > 0 ? ` tags=${routine.tags.join(',')}` : '';
  const readiness = evaluateAgentRoutineReadiness(routine);
  const ready = readiness.ready ? 'ready' : `needs ${readiness.missing.map(formatAgentSkillRequirement).join(',')}`;
  return `  ${routine.id}  ${enabled}  ${routine.reviewState}  ${ready}  starts=${routine.startCount}  ${routine.name} - ${routine.description}${tags}`;
}

function renderList(title: string, registry: AgentRoutineRegistry, routines: readonly AgentRoutineRecord[]): string {
  const snapshot = registry.snapshot();
  if (routines.length === 0) {
    return `${title}\n  No local Agent routines yet. Create one with /routines create --name <name> --description <summary> --steps <steps>.`;
  }
  return [
    `${title} (${routines.length})`,
    `  store: ${snapshot.path}`,
    `  enabled: ${snapshot.enabledRoutines.length}`,
    ...routines.map(summarizeRoutine),
  ].join('\n');
}

function renderRoutine(routine: AgentRoutineRecord): string {
  const readiness = evaluateAgentRoutineReadiness(routine);
  return [
    `Routine ${routine.name}`,
    `  id: ${routine.id}`,
    `  enabled: ${routine.enabled ? 'yes' : 'no'}`,
    `  readiness: ${readiness.ready ? 'ready' : 'needs setup'}`,
    `  requirements: ${routine.requirements.map(formatAgentSkillRequirement).join(', ') || '(none)'}`,
    readiness.missing.length > 0 ? `  missing: ${readiness.missing.map(formatAgentSkillRequirement).join(', ')}` : '',
    `  review: ${routine.reviewState}`,
    `  source: ${routine.source}`,
    `  provenance: ${routine.provenance}`,
    `  tags: ${routine.tags.join(', ') || '(none)'}`,
    `  triggers: ${routine.triggers.join(', ') || '(manual)'}`,
    `  started: ${routine.startCount}${routine.lastStartedAt ? `; last ${routine.lastStartedAt}` : ''}`,
    `  created: ${routine.createdAt}`,
    `  updated: ${routine.updatedAt}`,
    routine.staleReason ? `  stale reason: ${routine.staleReason}` : '',
    '',
    routine.description,
    '',
    routine.steps,
  ].filter(Boolean).join('\n');
}

function summarizeDiscoveredRoutine(routine: DiscoveredRoutineRecord): string {
  const description = routine.description ? ` - ${routine.description}` : '';
  return `  ${routine.name}  ${routine.origin}${description}\n    path: ${routine.path}`;
}

function renderDiscoveredRoutines(routines: readonly DiscoveredRoutineRecord[]): string {
  if (routines.length === 0) {
    return [
      'Discovered Agent routine files',
      '  No routine markdown files found in project/global Agent routine folders.',
      '  Search roots: .goodvibes/routines, .goodvibes/agent/routines, ~/.goodvibes/routines, ~/.goodvibes/agent/routines',
    ].join('\n');
  }
  return [
    `Discovered Agent routine files (${routines.length})`,
    ...routines.map(summarizeDiscoveredRoutine),
    '',
    'Import one with: /routines import-discovered <name> --yes',
  ].join('\n');
}

function discoveredRoutineLookupValues(routine: DiscoveredRoutineRecord): readonly string[] {
  const slug = routine.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const basename = routine.path.split(/[\\/]/).pop()?.replace(/\.md$/i, '') ?? '';
  return [routine.name, slug, routine.path, basename].map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function findDiscoveredRoutine(routines: readonly DiscoveredRoutineRecord[], idOrName: string): DiscoveredRoutineRecord | null {
  const lookup = idOrName.trim().toLowerCase();
  if (!lookup) return null;
  return routines.find((routine) => discoveredRoutineLookupValues(routine).includes(lookup)) ?? null;
}

function frontmatterList(routine: DiscoveredRoutineRecord, key: string): readonly string[] {
  const value = routine.frontmatter[key];
  if (!value) return [];
  return splitList(value);
}

function frontmatterAnyList(routine: DiscoveredRoutineRecord, keys: readonly string[]): readonly string[] {
  for (const key of keys) {
    const values = frontmatterList(routine, key);
    if (values.length > 0) return values;
  }
  return [];
}

function printError(ctx: CommandContext, error: unknown): void {
  ctx.print(`Error: ${error instanceof Error ? error.message : String(error)}`);
}

async function importDiscoveredRoutine(args: readonly string[], ctx: CommandContext, routineRegistry: AgentRoutineRegistry): Promise<void> {
  const parsed = parseRoutineArgs(args);
  const name = parsed.rest.join(' ').trim();
  if (!name) {
    ctx.print('Usage: /routines import-discovered <name> [--enabled] --yes');
    return;
  }
  const discovered = findDiscoveredRoutine(await discoverRoutines(requireShellPaths(ctx)), name);
  if (!discovered) {
    ctx.print(`Unknown discovered Agent routine: ${name}\nRun /routines discover to inspect available routine files.`);
    return;
  }
  if (!parsed.yes) {
    ctx.print([
      'Agent routine import preview',
      `  name: ${discovered.name}`,
      `  origin: ${discovered.origin}`,
      `  path: ${discovered.path}`,
      `  description: ${discovered.description || '(none)'}`,
      `  steps characters: ${discovered.steps.length}`,
      '  next: rerun with --yes to import into the Agent-local routine registry',
    ].join('\n'));
    return;
  }
  const routine = routineRegistry.create({
    name: discovered.name,
    description: discovered.description || `Imported routine from ${discovered.origin} markdown file.`,
    steps: discovered.steps,
    tags: frontmatterList(discovered, 'tags'),
    triggers: frontmatterList(discovered, 'triggers'),
    requirements: buildAgentSkillRequirements({
      env: frontmatterAnyList(discovered, ['requiresEnv', 'requires-env', 'requires_env']),
      commands: frontmatterAnyList(discovered, ['requiresCommands', 'requires-commands', 'requires_commands', 'commands']),
    }),
    enabled: parsed.flags.get('enabled') === 'true',
    source: 'imported',
    provenance: `discovered:${discovered.origin}:${discovered.path}`,
  });
  ctx.print(`Imported Agent routine ${routine.id}: ${routine.name}${routine.enabled ? ' (enabled)' : ''}`);
}

async function promoteRoutine(args: readonly string[], routineRegistry: AgentRoutineRegistry, ctx: CommandContext): Promise<void> {
  const parsed = parseRoutineSchedulePromotionArgs(args);
  if (parsed.errors.length > 0) {
    ctx.print([
      'Usage: /routines promote <id> (--cron <expr>|--every <interval>|--at <iso-time>) [--timezone <tz>] [--name <schedule-name>] [--provider <id>] [--model <model>] [--disabled] --yes',
      ...parsed.errors.map((error) => `  ${error}`),
    ].join('\n'));
    return;
  }
  const routine = routineRegistry.get(parsed.routineId ?? '');
  if (!routine) {
    ctx.print(`Unknown Agent routine: ${parsed.routineId ?? ''}`);
    return;
  }
  const preview = buildRoutineSchedulePreview(routine, parsed);
  if (!parsed.yes) {
    ctx.print(formatRoutineSchedulePreview(preview));
    return;
  }
  const shellPaths = requireShellPaths(ctx);
  const connection = resolveAgentDaemonConnection(ctx.platform.configManager, shellPaths.homeDirectory);
  const result = await promoteRoutineToDaemonSchedule(connection, preview);
  const receipt = receiptStoreFromContext(ctx).append(connection, preview, result);
  ctx.print(result.ok ? `${formatRoutineScheduleSuccess(result)}\n  receipt: ${receipt.id}` : `${formatRoutineScheduleFailure(result)}\n  receipt: ${receipt.id}`);
}

export async function runRoutinesRuntimeCommand(args: readonly string[], ctx: CommandContext): Promise<void> {
  const sub = (args[0] ?? 'list').toLowerCase();
  const routineRegistry = registryFromContext(ctx);
  try {
    if (sub === 'list' || sub === 'open') {
      ctx.print(renderList('Agent Routines', routineRegistry, routineRegistry.list()));
      return;
    }
    if (sub === 'enabled') {
      const snapshot = routineRegistry.snapshot();
      ctx.print(renderList('Enabled Agent Routines', routineRegistry, snapshot.enabledRoutines));
      return;
    }
    if (sub === 'discover' || sub === 'discovered') {
      ctx.print(renderDiscoveredRoutines(await discoverRoutines(requireShellPaths(ctx))));
      return;
    }
    if (sub === 'import-discovered' || sub === 'import-routine') {
      await importDiscoveredRoutine(args.slice(1), ctx, routineRegistry);
      return;
    }
    if (sub === 'search') {
      const query = args.slice(1).join(' ').trim();
      ctx.print(renderList(query ? `Agent Routines matching "${query}"` : 'Agent Routines', routineRegistry, routineRegistry.search(query)));
      return;
    }
    if (sub === 'show') {
      const id = args[1];
      if (!id) {
        ctx.print('Usage: /routines show <id>');
        return;
      }
      const routine = routineRegistry.get(id);
      ctx.print(routine ? renderRoutine(routine) : `Unknown Agent routine: ${id}`);
      return;
    }
    if (sub === 'receipts' || sub === 'history') {
      ctx.print(formatRoutineScheduleReceipts(receiptStoreFromContext(ctx).snapshot()));
      return;
    }
    if (sub === 'reconcile' || sub === 'sync' || sub === 'status') {
      const shellPaths = requireShellPaths(ctx);
      const connection = resolveAgentDaemonConnection(ctx.platform.configManager, shellPaths.homeDirectory);
      const result = await reconcileRoutineScheduleReceipts(connection, receiptStoreFromContext(ctx).snapshot());
      ctx.print(formatRoutineScheduleCorrelation(result));
      return;
    }
    if (sub === 'receipt') {
      const id = args[1];
      if (!id) {
        ctx.print('Usage: /routines receipt <receipt-id>');
        return;
      }
      const receipt = receiptStoreFromContext(ctx).get(id);
      ctx.print(receipt ? formatRoutineScheduleReceipt(receipt) : `Unknown routine schedule receipt: ${id}`);
      return;
    }
    if (sub === 'create') {
      const parsed = parseRoutineArgs(args.slice(1));
      const steps = parsed.flags.get('steps')?.trim() || parsed.rest.join(' ').trim();
      const routine = routineRegistry.create({
        name: requiredFlag(parsed.flags, 'name'),
        description: requiredFlag(parsed.flags, 'description'),
        steps,
        triggers: splitList(parsed.flags.get('triggers')),
        tags: splitList(parsed.flags.get('tags')),
        requirements: buildAgentSkillRequirements({
          env: splitList(parsed.flags.get('requires-env')),
          commands: splitList(parsed.flags.get('requires-command') ?? parsed.flags.get('requires-commands')),
        }),
        enabled: parsed.flags.get('enabled') === 'true',
        source: 'user',
        provenance: 'slash-command',
      });
      ctx.print(`Created Agent routine ${routine.id}: ${routine.name}`);
      return;
    }
    if (sub === 'update') {
      const id = args[1];
      if (!id) {
        ctx.print('Usage: /routines update <id> [--name ...] [--description ...] [--steps ...]');
        return;
      }
      const parsed = parseRoutineArgs(args.slice(2));
      const updated = routineRegistry.update(id, {
        name: parsed.flags.get('name'),
        description: parsed.flags.get('description'),
        steps: parsed.flags.get('steps'),
        triggers: parsed.flags.has('triggers') ? splitList(parsed.flags.get('triggers')) : undefined,
        tags: parsed.flags.has('tags') ? splitList(parsed.flags.get('tags')) : undefined,
        requirements: parsed.flags.has('requires-env') || parsed.flags.has('requires-command') || parsed.flags.has('requires-commands')
          ? buildAgentSkillRequirements({
            env: splitList(parsed.flags.get('requires-env')),
            commands: splitList(parsed.flags.get('requires-command') ?? parsed.flags.get('requires-commands')),
          })
          : undefined,
        provenance: 'slash-command',
      });
      ctx.print(`Updated Agent routine ${updated.id}: ${updated.name}`);
      return;
    }
    if (sub === 'enable' || sub === 'disable') {
      const id = args[1];
      if (!id) {
        ctx.print(`Usage: /routines ${sub} <id>`);
        return;
      }
      const routine = routineRegistry.setEnabled(id, sub === 'enable');
      ctx.print(`${sub === 'enable' ? 'Enabled' : 'Disabled'} Agent routine ${routine.id}: ${routine.name}`);
      return;
    }
    if (sub === 'start' || sub === 'run') {
      const id = args[1];
      if (!id) {
        ctx.print(`Usage: /routines ${sub} <id>`);
        return;
      }
      const routine = routineRegistry.markStarted(id);
      const readiness = evaluateAgentRoutineReadiness(routine);
      ctx.print([
        `Started Agent routine ${routine.id}: ${routine.name}`,
        `  readiness: ${readiness.ready ? 'ready' : `needs setup (${readiness.missing.map(formatAgentSkillRequirement).join(', ')})`}`,
        '  policy: same main conversation; no hidden job, runtime mutation, or external side effect was started',
        '',
        routine.steps,
      ].join('\n'));
      return;
    }
    if (sub === 'review') {
      const id = args[1];
      if (!id) {
        ctx.print('Usage: /routines review <id>');
        return;
      }
      const routine = routineRegistry.markReviewed(id);
      ctx.print(`Reviewed Agent routine ${routine.id}.`);
      return;
    }
    if (sub === 'stale') {
      const id = args[1];
      if (!id) {
        ctx.print('Usage: /routines stale <id> <reason...>');
        return;
      }
      const routine = routineRegistry.markStale(id, args.slice(2).join(' '));
      ctx.print(`Marked Agent routine ${routine.id} stale.`);
      return;
    }
    if (sub === 'promote' || sub === 'schedule' || sub === 'promote-schedule') {
      await promoteRoutine(args.slice(1), routineRegistry, ctx);
      return;
    }
    if (sub === 'delete' || sub === 'remove') {
      const parsed = parseRoutineArgs(args.slice(1));
      const id = parsed.rest[0];
      if (!id) {
        ctx.print('Usage: /routines delete <id> --yes');
        return;
      }
      if (!parsed.yes) {
        ctx.print(`Refusing to delete Agent routine ${id} without --yes.`);
        return;
      }
      const removed = routineRegistry.deleteRoutine(id);
      ctx.print(`Deleted Agent routine ${removed.id}: ${removed.name}`);
      return;
    }
    ctx.print('Usage: /routines [list|enabled|discover|import-discovered|search|show|receipts|reconcile|receipt|create|update|enable|disable|start|review|stale|promote|delete]');
  } catch (error) {
    printError(ctx, error);
  }
}

export function registerRoutinesRuntimeCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'routines',
    aliases: ['routine'],
    description: 'Manage local GoodVibes Agent routines',
    usage: '[list|enabled|discover|import-discovered <name> --yes|search <query>|show <id>|receipts|reconcile|receipt <id>|create --name <name> --description <summary> --steps <steps> [--requires-env A,B] [--requires-command gh,jq]|update <id> [--name ...] [--description ...] [--steps ...]|enable <id>|disable <id>|start <id>|review <id>|stale <id> <reason...>|promote <id> --cron <expr> [--delivery-channel slack] --yes|delete <id> --yes]',
    handler: runRoutinesRuntimeCommand,
  });
}
