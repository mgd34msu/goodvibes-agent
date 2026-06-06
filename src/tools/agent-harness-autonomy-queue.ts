import { getOperatorContract } from '@pellux/goodvibes-sdk/contracts';
import type { CommandContext } from '../input/command-registry.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from '../input/agent-workspace-snapshot.ts';
import { previewHarnessText } from './agent-harness-text.ts';

type AutonomyQueueStatus = 'ready' | 'active' | 'needs-setup' | 'attention' | 'blocked';

interface AgentHarnessAutonomyQueueArgs {
  readonly queueItemId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

interface OperatorContractMethod {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly category?: string;
  readonly http?: {
    readonly method?: string;
    readonly path?: string;
  };
}

interface AutonomyQueueItem {
  readonly id: string;
  readonly label: string;
  readonly status: AutonomyQueueStatus;
  readonly owner: 'agent' | 'connected-host' | 'agent-and-connected-host';
  readonly kind: 'work-plan' | 'research-run' | 'host-task' | 'approval' | 'automation-run' | 'schedule' | 'reminder' | 'routine-schedule' | 'delegated-agent' | 'delivery';
  readonly visible: true;
  readonly cancellable: boolean;
  readonly count: number;
  readonly current: string;
  readonly next: string;
  readonly inspectRoute: string;
  readonly modelRoute: string;
  readonly cancelRoute?: string;
  readonly createRoute?: string;
  readonly methodIds?: readonly string[];
  readonly liveRecords?: readonly AutonomyQueueLiveRecord[];
}

interface AutonomyQueueLiveRecord {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly phase?: string;
  readonly progress?: number;
  readonly updatedAt?: string;
  readonly summary: string;
  readonly inspectRoute: string;
  readonly cancelRoute?: string;
  readonly checkpointRoute?: string;
  readonly nextSteps?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly logTail?: readonly string[];
}

export type AutonomyQueueResolution =
  | { readonly status: 'found'; readonly item: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, Math.trunc(parsed)));
}

function operatorContractMethods(): readonly OperatorContractMethod[] {
  const contract = getOperatorContract();
  const methods = Array.isArray(contract.operator?.methods)
    ? contract.operator.methods as OperatorContractMethod[]
    : [];
  return methods.filter((method) => method.id);
}

function methodSearchText(method: OperatorContractMethod): string {
  return [
    method.id,
    method.title,
    method.description,
    method.category,
    method.http?.method,
    method.http?.path,
  ].filter(Boolean).join('\n').toLowerCase();
}

function methodIdsMatching(tokens: readonly string[]): readonly string[] {
  if (tokens.length === 0) return [];
  return operatorContractMethods()
    .filter((method) => {
      const text = methodSearchText(method);
      return tokens.some((token) => text.includes(token));
    })
    .map((method) => method.id)
    .sort((left, right) => left.localeCompare(right));
}

function statusRank(status: AutonomyQueueStatus): number {
  if (status === 'attention') return 5;
  if (status === 'active') return 4;
  if (status === 'needs-setup') return 3;
  if (status === 'ready') return 2;
  return 1;
}

function researchRunLiveRecords(snapshot: ReturnType<typeof buildAgentWorkspaceRuntimeSnapshot>): readonly AutonomyQueueLiveRecord[] {
  return snapshot.researchRuns.map((run) => {
    const terminal = run.status === 'cancelled' || run.status === 'completed' || run.status === 'failed';
    return {
      id: run.id,
      label: run.title,
      status: run.status,
      phase: run.phase,
      progress: run.progress,
      updatedAt: run.updatedAt,
      summary: [
        `${run.status}/${run.phase} ${run.progress}%`,
        `${run.checkpointCount} checkpoint(s)`,
        `${run.sourceIds.length} source(s)`,
        run.reportArtifactId ? `report ${run.reportArtifactId}` : '',
        run.note ?? '',
      ].filter(Boolean).join(' | '),
      inspectRoute: `agent_research_runs show id="${run.id}"`,
      ...(terminal ? {} : {
        cancelRoute: `agent_research_runs cancel id="${run.id}" note="..." confirm:true explicitUserRequest:"..."`,
        checkpointRoute: `agent_research_runs checkpoint id="${run.id}" note="..." progress:${run.progress} confirm:true explicitUserRequest:"..."`,
      }),
      nextSteps: run.nextSteps,
      sourceIds: run.sourceIds,
      logTail: run.logTail,
    };
  });
}

function itemSearchText(item: AutonomyQueueItem): string {
  return [
    item.id,
    item.label,
    item.status,
    item.owner,
    item.kind,
    item.current,
    item.next,
    item.inspectRoute,
    item.modelRoute,
    item.cancelRoute ?? '',
    item.createRoute ?? '',
    item.methodIds?.join('\n') ?? '',
    item.liveRecords?.flatMap((record) => [
      record.id,
      record.label,
      record.status,
      record.phase ?? '',
      record.summary,
      record.inspectRoute,
      record.cancelRoute ?? '',
      record.checkpointRoute ?? '',
      record.nextSteps?.join('\n') ?? '',
      record.sourceIds?.join('\n') ?? '',
      record.logTail?.join('\n') ?? '',
    ]).join('\n') ?? '',
  ].join('\n').toLowerCase();
}

function describeLiveRecord(record: AutonomyQueueLiveRecord, includeParameters: boolean): Record<string, unknown> {
  return {
    id: record.id,
    label: record.label,
    status: record.status,
    ...(record.phase ? { phase: record.phase } : {}),
    ...(typeof record.progress === 'number' ? { progress: record.progress } : {}),
    ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
    summary: previewHarnessText(record.summary, includeParameters ? 180 : 96),
    inspectRoute: record.inspectRoute,
    ...(record.cancelRoute ? { cancelRoute: record.cancelRoute } : {}),
    ...(record.checkpointRoute ? { checkpointRoute: record.checkpointRoute } : {}),
    ...(record.nextSteps && record.nextSteps.length > 0 ? { nextSteps: record.nextSteps.slice(0, includeParameters ? 8 : 3) } : {}),
    ...(record.sourceIds && record.sourceIds.length > 0 ? { sourceIds: record.sourceIds.slice(0, includeParameters ? 12 : 4) } : {}),
    ...(record.logTail && record.logTail.length > 0 ? { logTail: record.logTail.slice(-(includeParameters ? 5 : 2)) } : {}),
  };
}

function describeItem(item: AutonomyQueueItem, includeParameters: boolean, lookup?: Record<string, unknown>): Record<string, unknown> {
  return {
    queueItemId: item.id,
    label: item.label,
    status: item.status,
    owner: item.owner,
    kind: item.kind,
    visible: item.visible,
    cancellable: item.cancellable,
    count: item.count,
    current: previewHarnessText(item.current, includeParameters ? 180 : 96),
    next: previewHarnessText(item.next, includeParameters ? 180 : 96),
    modelRoute: item.modelRoute,
    inspectRoute: item.inspectRoute,
    ...(item.cancelRoute ? { cancelRoute: item.cancelRoute } : {}),
    ...(item.createRoute ? { createRoute: item.createRoute } : {}),
    ...(item.liveRecords && item.liveRecords.length > 0 ? { liveRecords: item.liveRecords.slice(0, includeParameters ? 8 : 3).map((record) => describeLiveRecord(record, includeParameters)) } : {}),
    ...(lookup ? { lookup } : {}),
    ...(includeParameters ? {
      routes: {
        inspect: item.inspectRoute,
        model: item.modelRoute,
        cancel: item.cancelRoute ?? null,
        create: item.createRoute ?? null,
      },
      methodIds: item.methodIds ?? [],
      policy: 'Queue rows are read-only. Create, run, pause, resume, cancel, approve, deny, send, and schedule effects stay on their owning confirmed route.',
    } : {}),
  };
}

function buildQueueItems(context: CommandContext): readonly AutonomyQueueItem[] {
  const snapshot = buildAgentWorkspaceRuntimeSnapshot(context);
  const approvalMethods = methodIdsMatching(['approval']);
  const automationMethods = methodIdsMatching(['automation']);
  const scheduleMethods = methodIdsMatching(['schedule', 'reminder']);
  const taskMethods = methodIdsMatching(['task', 'work-plan', 'workplan']);
  const readyChannels = snapshot.channels.filter((channel) => channel.ready).length;
  const configuredTargets = snapshot.channels.filter((channel) => channel.defaultTarget === 'configured').length;
  const researchRuns = researchRunLiveRecords(snapshot);
  const latestResearchRun = researchRuns[0];
  const scheduleReadyRoutines = snapshot.localRoutines.filter((routine) => (
    routine.enabled === true
    && routine.reviewState === 'reviewed'
    && (routine.missingRequirementCount ?? 0) === 0
  )).length;
  const routineReceiptStatus: AutonomyQueueStatus = snapshot.failedRoutineScheduleReceiptCount > 0
    ? 'attention'
    : snapshot.successfulRoutineScheduleReceiptCount > 0
      ? 'active'
      : scheduleReadyRoutines > 0
        ? 'ready'
        : 'needs-setup';

  const items: AutonomyQueueItem[] = [
    {
      id: 'visible-work-plan',
      label: 'Visible work plan',
      status: 'ready',
      owner: 'agent',
      kind: 'work-plan',
      visible: true,
      cancellable: true,
      count: taskMethods.length,
      current: `Work-plan actions are available in the Agent workspace; ${taskMethods.length} task/work-plan daemon method(s) are discoverable.`,
      next: 'Track ongoing user work here first, then update status to active, blocked, done, failed, or cancelled from the confirmed form.',
      inspectRoute: 'agent_harness mode:"workspace_action" actionId:"workplan-show"',
      modelRoute: 'agent_work_plan',
      cancelRoute: 'agent_harness mode:"run_workspace_action" actionId:"workplan-status" confirm:true explicitUserRequest:"..."',
      createRoute: 'agent_harness mode:"run_workspace_action" actionId:"workplan-add" confirm:true explicitUserRequest:"..."',
      methodIds: taskMethods,
    },
    {
      id: 'research-runs',
      label: 'Research runs',
      status: snapshot.researchRunBlockedCount > 0
        ? 'attention'
        : snapshot.researchRunRunningCount > 0
          ? 'active'
          : snapshot.researchRunPausedCount > 0 || snapshot.researchRunPlannedCount > 0
            ? 'ready'
            : 'needs-setup',
      owner: 'agent',
      kind: 'research-run',
      visible: true,
      cancellable: snapshot.researchRunRunningCount + snapshot.researchRunPausedCount + snapshot.researchRunPlannedCount + snapshot.researchRunBlockedCount > 0,
      count: snapshot.researchRunCount,
      current: [
        `${snapshot.researchRunCount} run(s), ${snapshot.researchRunRunningCount} running, ${snapshot.researchRunPausedCount} paused, ${snapshot.researchRunBlockedCount} blocked, ${snapshot.researchRunPlannedCount} planned.`,
        latestResearchRun ? `Latest visible run: ${latestResearchRun.label} (${latestResearchRun.status}${typeof latestResearchRun.progress === 'number' ? ` ${latestResearchRun.progress}%` : ''}).` : '',
      ].filter(Boolean).join(' '),
      next: snapshot.researchRunBlockedCount > 0
        ? 'Inspect blocked research runs, then checkpoint, resume, cancel, or complete one exact run.'
        : snapshot.researchRunRunningCount > 0
          ? 'Checkpoint progress, source ids, and next steps before switching tasks or saving a report.'
          : 'Create a visible research run when the user wants resumable deep research.',
      inspectRoute: 'agent_harness mode:"research_runs"',
      modelRoute: 'agent_harness mode:"research_runs"',
      cancelRoute: 'agent_research_runs cancel id="..." note="..." confirm:true explicitUserRequest="..."',
      createRoute: 'agent_harness mode:"run_workspace_action" actionId:"research-start-run" confirm:true explicitUserRequest:"..."',
      liveRecords: researchRuns,
    },
    {
      id: 'connected-host-tasks',
      label: 'Connected-host tasks',
      status: taskMethods.length > 0 ? 'ready' : 'needs-setup',
      owner: 'connected-host',
      kind: 'host-task',
      visible: true,
      cancellable: false,
      count: taskMethods.length,
      current: `${taskMethods.length} task-like daemon method(s) are present; Agent exposes read-only host task inspection.`,
      next: taskMethods.length > 0
        ? 'Inspect host tasks before changing any work plan or automation state.'
        : 'Update the connected GoodVibes host or connector set until task inspection methods are present.',
      inspectRoute: 'agent_harness mode:"workspace_action" actionId:"tasks-list"',
      modelRoute: 'agent_harness mode:"operator_methods" query:"task"',
      methodIds: taskMethods,
    },
    {
      id: 'pending-approvals',
      label: 'Pending approvals',
      status: approvalMethods.length > 0 ? 'ready' : 'needs-setup',
      owner: 'connected-host',
      kind: 'approval',
      visible: true,
      cancellable: true,
      count: approvalMethods.length,
      current: `${approvalMethods.length} approval daemon method(s) are present; approval decisions remain explicit and reviewable.`,
      next: 'Review the matrix, then approve, deny, or cancel one exact approval id only when the user asks.',
      inspectRoute: 'agent_harness mode:"workspace_action" actionId:"approvals"',
      modelRoute: 'agent_harness mode:"operator_methods" query:"approval"',
      cancelRoute: 'agent_harness mode:"run_workspace_action" actionId:"approval-cancel" confirm:true explicitUserRequest:"..."',
      methodIds: approvalMethods,
    },
    {
      id: 'automation-runs',
      label: 'Automation runs',
      status: automationMethods.length > 0 ? 'ready' : 'needs-setup',
      owner: 'connected-host',
      kind: 'automation-run',
      visible: true,
      cancellable: true,
      count: automationMethods.length,
      current: `${automationMethods.length} automation daemon method(s) are present; run, pause, resume, cancel, and retry actions are confirmed forms.`,
      next: 'Inspect automation posture first. Use exact run/job ids for confirmed run control.',
      inspectRoute: 'agent_harness mode:"operator_methods" query:"automation"',
      modelRoute: 'agent_harness mode:"workspace_actions" categoryId:"automation"',
      cancelRoute: 'agent_harness mode:"run_workspace_action" actionId:"automation-run-cancel" confirm:true explicitUserRequest:"..."',
      methodIds: automationMethods,
    },
    {
      id: 'connected-schedules',
      label: 'Connected schedules',
      status: scheduleMethods.length > 0 ? 'ready' : 'needs-setup',
      owner: 'connected-host',
      kind: 'schedule',
      visible: true,
      cancellable: false,
      count: scheduleMethods.length,
      current: `${scheduleMethods.length} schedule/reminder daemon method(s) are present; schedule inspection and run-now controls are visible.`,
      next: 'List schedules or reconcile routine receipts before triggering one schedule by id.',
      inspectRoute: 'agent_harness mode:"workspace_action" actionId:"schedule-list"',
      modelRoute: 'agent_harness mode:"operator_methods" query:"schedule"',
      createRoute: 'agent_harness mode:"run_workspace_action" actionId:"schedule-reminder" confirm:true explicitUserRequest:"..."',
      methodIds: scheduleMethods,
    },
    {
      id: 'reminder-requests',
      label: 'Reminder requests',
      status: scheduleMethods.length > 0 ? readyChannels > 0 || configuredTargets > 0 ? 'ready' : 'needs-setup' : 'needs-setup',
      owner: 'agent-and-connected-host',
      kind: 'reminder',
      visible: true,
      cancellable: false,
      count: configuredTargets,
      current: `${configuredTargets} configured delivery target(s), ${readyChannels} ready channel(s), ${scheduleMethods.length} schedule/reminder method(s).`,
      next: readyChannels > 0 || configuredTargets > 0
        ? 'Create one reminder only after the user gives real timing and delivery scope.'
        : 'Configure at least one delivery target before relying on reminder delivery.',
      inspectRoute: 'agent_harness mode:"personal_ops_lane" laneId:"reminders"',
      modelRoute: 'agent_reminder_schedule',
      createRoute: 'agent_reminder_schedule confirm:true explicitUserRequest:"..."',
      methodIds: scheduleMethods,
    },
    {
      id: 'routine-schedule-promotions',
      label: 'Routine schedule promotions',
      status: routineReceiptStatus,
      owner: 'agent-and-connected-host',
      kind: 'routine-schedule',
      visible: true,
      cancellable: false,
      count: snapshot.routineScheduleReceiptCount,
      current: `${snapshot.routineScheduleReceiptCount} receipt(s), ${snapshot.successfulRoutineScheduleReceiptCount} created, ${snapshot.failedRoutineScheduleReceiptCount} failed, ${scheduleReadyRoutines} schedule-ready routine(s).`,
      next: snapshot.failedRoutineScheduleReceiptCount > 0
        ? 'Reconcile failed receipts before creating more routine schedules.'
        : scheduleReadyRoutines > 0
          ? 'Promote one reviewed routine only when the user asks for recurrence.'
          : 'Create, enable, and review a routine before schedule promotion.',
      inspectRoute: 'agent_harness mode:"workspace_action" actionId:"schedule-receipts"',
      modelRoute: 'agent_harness mode:"workspace_actions" categoryId:"routines"',
      createRoute: 'agent_harness mode:"run_workspace_action" actionId:"schedule-promote-routine" confirm:true explicitUserRequest:"..."',
      methodIds: scheduleMethods,
    },
    {
      id: 'delegated-subagents',
      label: 'Delegated subagents',
      status: 'ready',
      owner: 'agent',
      kind: 'delegated-agent',
      visible: true,
      cancellable: true,
      count: 0,
      current: 'Subagent and delegation routes are visible and cancellable; ordinary chat remains serial by default.',
      next: 'Use visible delegation only when isolation, parallelism, remote execution, or an explicit build/fix/review handoff helps the user.',
      inspectRoute: 'agent tool list route',
      modelRoute: 'agent_harness mode:"delegation_posture"',
      cancelRoute: 'agent tool cancel route with agentId',
      createRoute: 'agent_harness mode:"run_workspace_action" actionId:"delegate-task" confirm:true explicitUserRequest:"..."',
    },
    {
      id: 'delivery-followups',
      label: 'Delivery follow-ups',
      status: readyChannels > 0 ? 'ready' : 'needs-setup',
      owner: 'agent-and-connected-host',
      kind: 'delivery',
      visible: true,
      cancellable: false,
      count: readyChannels,
      current: `${readyChannels}/${snapshot.channels.length} channel(s) ready; ${configuredTargets} configured default target(s).`,
      next: readyChannels > 0
        ? 'Use confirmed notification or channel send tools only after the user asks for delivery.'
        : 'Pair or configure a delivery channel before promising proactive follow-up.',
      inspectRoute: 'agent_harness mode:"channels"',
      modelRoute: 'agent_harness mode:"channels"',
      createRoute: 'agent_harness mode:"run_workspace_action" actionId:"personal-ops-channels" confirm:true explicitUserRequest:"..."',
    },
  ];
  return items.sort((left, right) => statusRank(right.status) - statusRank(left.status) || left.label.localeCompare(right.label));
}

function nextActions(items: readonly AutonomyQueueItem[]): readonly string[] {
  return items
    .filter((item) => item.status === 'attention' || item.status === 'needs-setup' || item.status === 'active')
    .map((item) => `${item.label}: ${item.next}`)
    .slice(0, 5);
}

export function autonomyQueueCatalogStatus(context: CommandContext): Record<string, unknown> {
  const items = buildQueueItems(context);
  const counts = items.reduce<Record<AutonomyQueueStatus, number>>((acc, item) => {
    acc[item.status] += 1;
    return acc;
  }, { ready: 0, active: 0, 'needs-setup': 0, attention: 0, blocked: 0 });
  return {
    modes: ['autonomy_queue', 'autonomy_queue_item'],
    items: items.length,
    cancellable: items.filter((item) => item.cancellable).length,
    ...counts,
    readOnly: true,
  };
}

export function autonomyQueueSummary(context: CommandContext, args: AgentHarnessAutonomyQueueArgs): Record<string, unknown> {
  const includeParameters = args.includeParameters === true;
  const query = readString(args.query).toLowerCase();
  const limit = readLimit(args.limit, 100);
  const all = buildQueueItems(context);
  const filtered = all.filter((item) => !query || itemSearchText(item).includes(query));
  return {
    summary: {
      items: all.length,
      visible: all.filter((item) => item.visible).length,
      cancellable: all.filter((item) => item.cancellable).length,
      attention: all.filter((item) => item.status === 'attention').length,
      needsSetup: all.filter((item) => item.status === 'needs-setup').length,
      active: all.filter((item) => item.status === 'active').length,
      ready: all.filter((item) => item.status === 'ready').length,
    },
    queue: filtered.slice(0, limit).map((item) => describeItem(item, includeParameters)),
    returned: Math.min(filtered.length, limit),
    total: all.length,
    nextActions: nextActions(all),
    policy: 'Visible autonomy queue is read-only. Autonomous work must have a visible owner, status/progress route, inspect route, and cancellation or recovery route when the owning surface supports one.',
  };
}

export function describeAutonomyQueueItem(context: CommandContext, args: AgentHarnessAutonomyQueueArgs): AutonomyQueueResolution {
  const queueItemId = readString(args.queueItemId);
  const target = readString(args.target);
  const query = readString(args.query);
  const input = queueItemId || target || query;
  if (!input) {
    return {
      status: 'missing_lookup',
      usage: 'autonomy_queue_item requires queueItemId, target, or query. Use mode:"autonomy_queue" to inspect queue item ids.',
    };
  }
  const normalized = input.toLowerCase();
  const items = buildQueueItems(context);
  const exact = items.find((item) => item.id === input);
  if (exact) return { status: 'found', item: describeItem(exact, true, { source: queueItemId ? 'queueItemId' : target ? 'target' : 'query', input, resolvedBy: 'id' }) };
  const insensitive = items.find((item) => item.id.toLowerCase() === normalized);
  if (insensitive) return { status: 'found', item: describeItem(insensitive, true, { source: queueItemId ? 'queueItemId' : target ? 'target' : 'query', input, resolvedBy: 'case-insensitive-id' }) };
  const matches = items.filter((item) => itemSearchText(item).includes(normalized));
  if (matches.length === 1) return { status: 'found', item: describeItem(matches[0]!, true, { source: queueItemId ? 'queueItemId' : target ? 'target' : 'query', input, resolvedBy: 'search' }) };
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      input,
      candidates: matches.slice(0, 8).map((item) => ({
        queueItemId: item.id,
        label: item.label,
        status: item.status,
        modelRoute: item.modelRoute,
      })),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown autonomy queue item ${input}. Use mode:"autonomy_queue" to inspect queue item ids.`,
  };
}
