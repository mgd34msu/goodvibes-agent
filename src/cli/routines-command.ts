import { createShellPathService } from '@/runtime/index.ts';
import { AgentRoutineRegistry, type AgentRoutineRecord } from '../agent/routine-registry.ts';
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

function routineReceiptStore(runtime: CliCommandRuntime): RoutineScheduleReceiptStore {
  return RoutineScheduleReceiptStore.fromShellPaths(createShellPathService({
    workingDirectory: runtime.workingDirectory,
    homeDirectory: runtime.homeDirectory,
  }));
}

function summarizeRoutine(routine: AgentRoutineRecord): string {
  const enabled = routine.enabled ? 'enabled' : 'disabled';
  const tags = routine.tags.length > 0 ? ` tags=${routine.tags.join(',')}` : '';
  return `  ${routine.id}  ${enabled}  ${routine.reviewState}  starts=${routine.startCount}  ${routine.name} - ${routine.description}${tags}`;
}

function renderRoutineList(title: string, path: string, routines: readonly AgentRoutineRecord[]): string {
  if (routines.length === 0) {
    return [
      title,
      '  No local Agent routines yet.',
      '  Create routines inside the Agent TUI with /routines create, or create a runtime profile from a starter template.',
    ].join('\n');
  }
  return [
    `${title} (${routines.length})`,
    `  store: ${path}`,
    ...routines.map(summarizeRoutine),
  ].join('\n');
}

function renderRoutine(routine: AgentRoutineRecord): string {
  return [
    `Routine ${routine.name}`,
    `  id: ${routine.id}`,
    `  enabled: ${routine.enabled ? 'yes' : 'no'}`,
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
        'Usage: goodvibes-agent routines promote <id> (--cron <expr>|--every <interval>|--at <iso-time>) [--timezone <tz>] [--name <schedule-name>] [--provider <id>] [--model <model>] [--delivery-surface <surface[:route[:label]]>|--delivery-route <route[:label]>|--delivery-webhook <url>|--delivery-link <url>] [--disabled] --yes',
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
    output: 'Usage: goodvibes-agent routines [list|enabled|show <id>|receipts|reconcile|receipt <id>|promote <id> (--cron <expr>|--every <interval>|--at <iso-time>) [--delivery-surface <surface>|--delivery-route <route>|--delivery-webhook <url>] --yes]',
    exitCode: 2,
  };
}
