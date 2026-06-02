import { createShellPathService } from '@/runtime/index.ts';
import { discoverRoutines, type DiscoveredRoutineRecord } from '../agent/routine-discovery.ts';
import { AgentRoutineRegistry, evaluateAgentRoutineReadiness, type AgentRoutineRecord } from '../agent/routine-registry.ts';
import { buildAgentSkillRequirements, formatAgentSkillRequirement } from '../agent/skill-registry.ts';
import {
  buildRoutineSchedulePreview,
  promoteRoutineToDaemonSchedule,
  resolveAgentDaemonConnection,
} from '../agent/routine-schedule-promotion.ts';
import { parseRoutineSchedulePromotionArgs } from '../agent/routine-schedule-args.ts';
import {
  formatRoutineScheduleCorrelation,
  formatRoutineScheduleFailure,
  formatRoutineSchedulePreview,
  formatRoutineScheduleReceipt,
  formatRoutineScheduleReceipts,
  formatRoutineScheduleSuccess,
} from '../agent/routine-schedule-format.ts';
import {
  reconcileRoutineScheduleReceipts,
  RoutineScheduleReceiptStore,
} from '../agent/routine-schedule-receipts.ts';
import type { CliCommandOutput } from './types.ts';
import type { CliCommandRuntime } from './management.ts';

interface RoutinesCommandSuccess<TData> {
  readonly ok: true;
  readonly kind: string;
  readonly data: TData;
}

interface RoutinesCommandFailure {
  readonly ok: false;
  readonly kind: string;
  readonly error: string;
}

function jsonOrText(runtime: CliCommandRuntime, value: unknown, text: string): string {
  return runtime.cli.flags.outputFormat === 'json' ? JSON.stringify(value, null, 2) : text;
}

function routineRegistry(runtime: CliCommandRuntime): AgentRoutineRegistry {
  return AgentRoutineRegistry.fromShellPaths(createShellPathService({
    workingDirectory: runtime.workingDirectory,
    homeDirectory: runtime.homeDirectory,
  }));
}

function shellPaths(runtime: CliCommandRuntime): ReturnType<typeof createShellPathService> {
  return createShellPathService({
    workingDirectory: runtime.workingDirectory,
    homeDirectory: runtime.homeDirectory,
  });
}

function routineReceiptStore(runtime: CliCommandRuntime): RoutineScheduleReceiptStore {
  return RoutineScheduleReceiptStore.fromShellPaths(createShellPathService({
    workingDirectory: runtime.workingDirectory,
    homeDirectory: runtime.homeDirectory,
  }));
}

function splitList(value: string | undefined): readonly string[] {
  if (!value) return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function parseImportFlags(args: readonly string[]): {
  readonly name: string;
  readonly enabled: boolean;
  readonly yes: boolean;
} {
  const positionals: string[] = [];
  let enabled = false;
  let yes = false;
  for (const arg of args) {
    if (arg === '--enabled') {
      enabled = true;
      continue;
    }
    if (arg === '--yes') {
      yes = true;
      continue;
    }
    positionals.push(arg);
  }
  return { name: positionals.join(' ').trim(), enabled, yes };
}

function summarizeRoutine(routine: AgentRoutineRecord): string {
  const enabled = routine.enabled ? 'enabled' : 'disabled';
  const tags = routine.tags.length > 0 ? ` tags=${routine.tags.join(',')}` : '';
  const readiness = evaluateAgentRoutineReadiness(routine);
  const ready = readiness.ready ? 'ready' : `needs ${readiness.missing.map(formatAgentSkillRequirement).join(',')}`;
  return `  ${routine.id}  ${enabled}  ${routine.reviewState}  ${ready}  starts=${routine.startCount}  ${routine.name} - ${routine.description}${tags}`;
}

function summarizeDiscoveredRoutine(routine: DiscoveredRoutineRecord): string {
  const description = routine.description ? ` - ${routine.description}` : '';
  return [
    `  ${routine.name}  ${routine.origin}${description}`,
    `    path: ${routine.path}`,
  ].join('\n');
}

function renderDiscoveredRoutineList(routines: readonly DiscoveredRoutineRecord[]): string {
  if (routines.length === 0) {
    return [
      'Discovered Agent routine files',
      '  No routine markdown files found in Agent routine folders.',
      '  Search roots: .goodvibes/routines, .goodvibes/agent/routines, ~/.goodvibes/routines, ~/.goodvibes/agent/routines',
    ].join('\n');
  }
  return [
    `Discovered Agent routine files (${routines.length})`,
    ...routines.map(summarizeDiscoveredRoutine),
    '',
    'Import one with: goodvibes-agent routines import-discovered <name> --yes',
  ].join('\n');
}

function discoveredRoutineLookupValues(routine: DiscoveredRoutineRecord): readonly string[] {
  const slug = routine.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const basename = routine.path.split(/[\\/]/).pop()?.replace(/\.md$/i, '') ?? '';
  return [routine.name, slug, routine.path, basename]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function findDiscoveredRoutine(routines: readonly DiscoveredRoutineRecord[], idOrName: string): DiscoveredRoutineRecord | null {
  const lookup = idOrName.trim().toLowerCase();
  if (!lookup) return null;
  return routines.find((routine) => discoveredRoutineLookupValues(routine).includes(lookup)) ?? null;
}

function discoveredRoutineFrontmatterList(routine: DiscoveredRoutineRecord, key: string): readonly string[] {
  const value = routine.frontmatter[key];
  if (!value) return [];
  return splitList(value);
}

function discoveredRoutineFrontmatterAnyList(routine: DiscoveredRoutineRecord, keys: readonly string[]): readonly string[] {
  for (const key of keys) {
    const values = discoveredRoutineFrontmatterList(routine, key);
    if (values.length > 0) return values;
  }
  return [];
}

function renderRoutineList(title: string, path: string, routines: readonly AgentRoutineRecord[]): string {
  if (routines.length === 0) {
    return [
      title,
      '  No local Agent routines yet.',
      '  Create routines inside the Agent TUI with /routines create, or create an Agent profile from a starter template.',
    ].join('\n');
  }
  return [
    `${title} (${routines.length})`,
    `  store: ${path}`,
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
  ].filter((line): line is string => Boolean(line)).join('\n');
}

async function handleRoutinePromotion(runtime: CliCommandRuntime, args: readonly string[]): Promise<CliCommandOutput> {
  const parsed = parseRoutineSchedulePromotionArgs(args);
  const json = runtime.cli.flags.outputFormat === 'json';
  if (parsed.errors.length > 0) {
    const failure: RoutinesCommandFailure = {
      ok: false,
      kind: 'invalid_routine_schedule_promotion',
      error: parsed.errors.join(' '),
    };
    return {
      output: json ? JSON.stringify(failure, null, 2) : [
        'Usage: goodvibes-agent routines promote <id> (--cron <expr>|--every <interval>|--at <iso-time>) [--timezone <tz>] [--name <schedule-name>] [--provider <id>] [--model <model>] [--delivery-channel <channel[:route[:label]]>|--delivery-route <route[:label]>|--delivery-webhook <url>|--delivery-link <url>] [--disabled] --yes',
        ...parsed.errors.map((error) => `  ${error}`),
      ].join('\n'),
      exitCode: 2,
    };
  }
  const registry = routineRegistry(runtime);
  const routine = registry.get(parsed.routineId ?? '');
  if (!routine) {
    const failure: RoutinesCommandFailure = {
      ok: false,
      kind: 'routine_not_found',
      error: `Unknown Agent routine: ${parsed.routineId ?? ''}`,
    };
    return {
      output: json ? JSON.stringify(failure, null, 2) : failure.error,
      exitCode: 1,
    };
  }
  const preview = buildRoutineSchedulePreview(routine, parsed);
  if (!parsed.yes) {
    const value: RoutinesCommandSuccess<typeof preview> = {
      ok: true,
      kind: 'schedules.create.preview',
      data: preview,
    };
    return {
      output: jsonOrText(runtime, value, formatRoutineSchedulePreview(preview)),
      exitCode: 0,
    };
  }
  const connection = resolveAgentDaemonConnection(runtime.configManager, runtime.homeDirectory);
  const result = await promoteRoutineToDaemonSchedule(connection, preview);
  const receipt = routineReceiptStore(runtime).append(connection, preview, result);
  if (!result.ok) {
    return {
      output: json ? JSON.stringify({ ...result, receipt }, null, 2) : `${formatRoutineScheduleFailure(result)}\n  receipt: ${receipt.id}`,
      exitCode: 1,
    };
  }
  const value = { ...result, receipt };
  return {
    output: jsonOrText(runtime, value, `${formatRoutineScheduleSuccess(result)}\n  receipt: ${receipt.id}`),
    exitCode: 0,
  };
}

export async function handleRoutinesCommand(runtime: CliCommandRuntime): Promise<CliCommandOutput> {
  const [sub = 'list', ...rest] = runtime.cli.commandArgs;
  const registry = routineRegistry(runtime);
  const snapshot = registry.snapshot();
  const normalized = sub.toLowerCase();
  if (normalized === 'list' || normalized === 'enabled') {
    const routines = normalized === 'enabled' ? snapshot.enabledRoutines : snapshot.routines;
    const value: RoutinesCommandSuccess<{
      readonly path: string;
      readonly routines: readonly AgentRoutineRecord[];
      readonly enabledCount: number;
    }> = {
      ok: true,
      kind: normalized === 'enabled' ? 'agent.routines.enabled' : 'agent.routines.list',
      data: {
        path: snapshot.path,
        routines,
        enabledCount: snapshot.enabledRoutines.length,
      },
    };
    return {
      output: jsonOrText(runtime, value, renderRoutineList(normalized === 'enabled' ? 'Enabled Agent routines' : 'Agent routines', snapshot.path, routines)),
      exitCode: 0,
    };
  }
  if (normalized === 'discover') {
    const discovered = await discoverRoutines(shellPaths(runtime));
    const value: RoutinesCommandSuccess<{ readonly routines: readonly DiscoveredRoutineRecord[] }> = {
      ok: true,
      kind: 'agent.routines.discover',
      data: { routines: discovered },
    };
    return {
      output: jsonOrText(runtime, value, renderDiscoveredRoutineList(discovered)),
      exitCode: 0,
    };
  }
  if (normalized === 'import-discovered' || normalized === 'import-routine') {
    const parsed = parseImportFlags(rest);
    if (!parsed.name) {
      const failure: RoutinesCommandFailure = {
        ok: false,
        kind: 'invalid_routine_command',
        error: 'Usage: goodvibes-agent routines import-discovered <name> [--enabled] --yes',
      };
      return {
        output: runtime.cli.flags.outputFormat === 'json' ? JSON.stringify(failure, null, 2) : failure.error,
        exitCode: 2,
      };
    }
    const discovered = findDiscoveredRoutine(await discoverRoutines(shellPaths(runtime)), parsed.name);
    if (!discovered) {
      const failure: RoutinesCommandFailure = {
        ok: false,
        kind: 'routine_discovery_not_found',
        error: `Unknown discovered Agent routine: ${parsed.name}\nRun goodvibes-agent routines discover to inspect available routine files.`,
      };
      return {
        output: runtime.cli.flags.outputFormat === 'json' ? JSON.stringify(failure, null, 2) : failure.error,
        exitCode: 1,
      };
    }
    if (!parsed.yes) {
      const value: RoutinesCommandSuccess<{ readonly routine: DiscoveredRoutineRecord }> = {
        ok: true,
        kind: 'agent.routines.import_discovered.preview',
        data: { routine: discovered },
      };
      return {
        output: jsonOrText(runtime, value, [
          'Agent routine import preview',
          `  name: ${discovered.name}`,
          `  origin: ${discovered.origin}`,
          `  path: ${discovered.path}`,
          `  description: ${discovered.description || '(none)'}`,
          `  steps characters: ${discovered.steps.length}`,
          '  next: rerun with --yes to import into the Agent-local routine registry',
        ].join('\n')),
        exitCode: 0,
      };
    }
    const routine = registry.create({
      name: discovered.name,
      description: discovered.description || `Imported routine from ${discovered.origin} markdown file.`,
      steps: discovered.steps,
      tags: discoveredRoutineFrontmatterList(discovered, 'tags'),
      triggers: discoveredRoutineFrontmatterList(discovered, 'triggers'),
      requirements: buildAgentSkillRequirements({
        env: discoveredRoutineFrontmatterAnyList(discovered, ['requiresEnv', 'requires-env', 'requires_env']),
        commands: discoveredRoutineFrontmatterAnyList(discovered, ['requiresCommands', 'requires-commands', 'requires_commands', 'commands']),
      }),
      enabled: parsed.enabled,
      source: 'imported',
      provenance: `discovered:${discovered.origin}:${discovered.path}`,
    });
    const value: RoutinesCommandSuccess<AgentRoutineRecord> = {
      ok: true,
      kind: 'agent.routines.import_discovered',
      data: routine,
    };
    return {
      output: jsonOrText(runtime, value, `Imported Agent routine ${routine.id}: ${routine.name}${routine.enabled ? ' (enabled)' : ''}`),
      exitCode: 0,
    };
  }
  if (normalized === 'show') {
    const id = rest[0];
    if (!id) return { output: 'Usage: goodvibes-agent routines show <id>', exitCode: 2 };
    const routine = registry.get(id);
    if (!routine) {
      const failure: RoutinesCommandFailure = { ok: false, kind: 'routine_not_found', error: `Unknown Agent routine: ${id}` };
      return {
        output: runtime.cli.flags.outputFormat === 'json' ? JSON.stringify(failure, null, 2) : failure.error,
        exitCode: 1,
      };
    }
    const value: RoutinesCommandSuccess<AgentRoutineRecord> = { ok: true, kind: 'agent.routines.show', data: routine };
    return {
      output: jsonOrText(runtime, value, renderRoutine(routine)),
      exitCode: 0,
    };
  }
  if (normalized === 'receipts' || normalized === 'history') {
    const snapshot = routineReceiptStore(runtime).snapshot();
    const value: RoutinesCommandSuccess<typeof snapshot> = {
      ok: true,
      kind: 'agent.routines.scheduleReceipts.list',
      data: snapshot,
    };
    return {
      output: jsonOrText(runtime, value, formatRoutineScheduleReceipts(snapshot)),
      exitCode: 0,
    };
  }
  if (normalized === 'reconcile' || normalized === 'sync' || normalized === 'status') {
    const store = routineReceiptStore(runtime);
    const result = await reconcileRoutineScheduleReceipts(
      resolveAgentDaemonConnection(runtime.configManager, runtime.homeDirectory),
      store.snapshot(),
    );
    return {
      output: jsonOrText(runtime, result, formatRoutineScheduleCorrelation(result)),
      exitCode: result.ok ? 0 : 1,
    };
  }
  if (normalized === 'receipt') {
    const id = rest[0];
    if (!id) return { output: 'Usage: goodvibes-agent routines receipt <receipt-id>', exitCode: 2 };
    const receipt = routineReceiptStore(runtime).get(id);
    if (!receipt) {
      const failure: RoutinesCommandFailure = { ok: false, kind: 'routine_schedule_receipt_not_found', error: `Unknown routine schedule receipt: ${id}` };
      return {
        output: runtime.cli.flags.outputFormat === 'json' ? JSON.stringify(failure, null, 2) : failure.error,
        exitCode: 1,
      };
    }
    const value: RoutinesCommandSuccess<typeof receipt> = {
      ok: true,
      kind: 'agent.routines.scheduleReceipts.get',
      data: receipt,
    };
    return {
      output: jsonOrText(runtime, value, formatRoutineScheduleReceipt(receipt)),
      exitCode: 0,
    };
  }
  if (normalized === 'promote' || normalized === 'schedule' || normalized === 'promote-schedule') {
    return handleRoutinePromotion(runtime, rest);
  }
  return {
    output: 'Usage: goodvibes-agent routines [list|enabled|discover|import-discovered <name> --yes|show <id>|receipts|reconcile|receipt <id>|promote <id> (--cron <expr>|--every <interval>|--at <iso-time>) [--delivery-channel <channel>|--delivery-route <route>|--delivery-webhook <url>] --yes]',
    exitCode: 2,
  };
}
