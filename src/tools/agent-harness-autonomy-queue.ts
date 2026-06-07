import { getOperatorContract } from '@pellux/goodvibes-sdk/contracts';
import type { CommandContext } from '../input/command-registry.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from '../input/agent-workspace-snapshot.ts';
import { previewHarnessText } from './agent-harness-text.ts';
import type { UiAutomationSnapshot, UiTasksSnapshot } from '../runtime/ui-read-models.ts';

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
  readonly batchCreateRoute?: string;
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
  readonly pauseRoute?: string;
  readonly resumeRoute?: string;
  readonly nextSteps?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly logTail?: readonly string[];
  readonly output?: AutonomyQueueRecordOutput;
  readonly diagnostics?: readonly string[];
  readonly controls?: readonly AutonomyQueueRecordControl[];
}

interface AutonomyQueueRecordOutput {
  readonly status: 'preview' | 'route-only';
  readonly route: string;
  readonly source: 'runtime-task-result' | 'runtime-task-error' | 'not-published';
  readonly preview?: string;
  readonly policy: string;
}

interface AutonomyQueueRecordControl {
  readonly id: string;
  readonly label: string;
  readonly state: 'available' | 'unavailable';
  readonly effect: 'read-only' | 'confirmed-effect';
  readonly confirmationRequired: boolean;
  readonly modelRoute?: string;
  readonly reason?: string;
}

type SnapshotReader<TSnapshot> = {
  readonly getSnapshot: () => TSnapshot;
};

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

function readSnapshot<TSnapshot>(readModel: SnapshotReader<TSnapshot> | undefined): TSnapshot | null {
  if (!readModel) return null;
  try {
    return readModel.getSnapshot();
  } catch {
    return null;
  }
}

function formatEpochMs(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return new Date(value).toISOString();
}

function formatTimeFragment(label: string, value: number | undefined): string {
  const formatted = formatEpochMs(value);
  return formatted ? `${label} ${formatted}` : '';
}

const SENSITIVE_TEXT_PATTERNS: readonly [RegExp, string][] = [
  [/("?\b(?:api[-_]?key|apikey|token|secret|password|passwd|credential|authorization)\b"?\s*:\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi, '$1"<redacted>"'],
  [/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTHORIZATION|BEARER)[A-Z0-9_]*)=("[^"]*"|'[^']*'|[^\s]+)/gi, '$1=<redacted>'],
  [/(\b(?:token|secret|password|passwd|api[-_]?key|apikey|authorization|credential)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi, '$1<redacted>'],
  [/(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>'],
  [/(\s--(?:token|password|secret|api-key|api_key)\s+)("[^"]*"|'[^']*'|[^\s]+)/gi, '$1<redacted>'],
];

function redactHarnessOutputText(value: string): string {
  return SENSITIVE_TEXT_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function compactUnknown(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return redactHarnessOutputText(value.replace(/\s+/g, ' ').trim());
  if (typeof value === 'number' || typeof value === 'boolean') return redactHarnessOutputText(String(value));
  try {
    return redactHarnessOutputText(JSON.stringify(value).replace(/\s+/g, ' ').trim());
  } catch {
    return '';
  }
}

function formatIntervalMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return `${value}ms`;
  const units: ReadonlyArray<readonly [number, string]> = [
    [86_400_000, 'd'],
    [3_600_000, 'h'],
    [60_000, 'm'],
    [1_000, 's'],
  ];
  for (const [size, suffix] of units) {
    if (value >= size && value % size === 0) return `${value / size}${suffix}`;
  }
  return `${value}ms`;
}

function summarizeSchedule(schedule: UiAutomationSnapshot['jobs'][number]['schedule']): string {
  if (schedule.kind === 'cron') {
    return [
      `cron ${schedule.expression}`,
      schedule.timezone ? `timezone ${schedule.timezone}` : '',
      schedule.staggerMs !== undefined ? `stagger ${schedule.staggerMs}ms` : '',
    ].filter(Boolean).join(', ');
  }
  if (schedule.kind === 'every') return `every ${formatIntervalMs(schedule.intervalMs)}`;
  return `at ${formatEpochMs(schedule.at) ?? schedule.at}`;
}

function quoteRouteValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function operatorMethodRoute(methodId: string, input: Record<string, string>): string {
  const payload = JSON.stringify(input);
  return `agent_operator_method methodId:"${quoteRouteValue(methodId)}" input:${payload} confirm:true explicitUserRequest:"..."`;
}

function availableControl(
  id: string,
  label: string,
  effect: AutonomyQueueRecordControl['effect'],
  modelRoute: string,
): AutonomyQueueRecordControl {
  return {
    id,
    label,
    state: 'available',
    effect,
    confirmationRequired: effect === 'confirmed-effect',
    modelRoute,
  };
}

function unavailableControl(id: string, label: string, reason: string): AutonomyQueueRecordControl {
  return {
    id,
    label,
    state: 'unavailable',
    effect: 'confirmed-effect',
    confirmationRequired: true,
    reason,
  };
}

function controlAvailable(record: AutonomyQueueLiveRecord, id: string): boolean {
  return record.controls?.some((control) => control.id === id && control.state === 'available') === true;
}

function availableControlRoute(record: AutonomyQueueLiveRecord, id: string): string | undefined {
  return record.controls?.find((control) => control.id === id && control.state === 'available')?.modelRoute;
}

function firstAvailableControlRoute(records: readonly AutonomyQueueLiveRecord[], id: string): string | undefined {
  for (const record of records) {
    const route = availableControlRoute(record, id);
    if (route) return route;
  }
  return undefined;
}

function taskOutputDescriptor(task: UiTasksSnapshot['tasks'][number]): AutonomyQueueRecordOutput {
  const route = `/tasks output ${task.id}`;
  const resultPreview = task.result !== undefined ? compactUnknown(task.result) : '';
  if (resultPreview.length > 0) {
    return {
      status: 'preview',
      route,
      source: 'runtime-task-result',
      preview: previewHarnessText(resultPreview, 240),
      policy: 'Bounded preview from the connected-host task read model; secret-looking text is redacted. Use the route for the full host-owned output view when available.',
    };
  }
  const errorPreview = task.error ? compactUnknown(task.error) : '';
  if (errorPreview.length > 0) {
    return {
      status: 'preview',
      route,
      source: 'runtime-task-error',
      preview: previewHarnessText(errorPreview, 240),
      policy: 'Bounded error preview from the connected-host task read model; secret-looking text is redacted. Use the route for the full host-owned output view when available.',
    };
  }
  return {
    status: 'route-only',
    route,
    source: 'not-published',
    policy: 'The connected host has not published task result/error text in the task read model. Use the route for host-owned output if that host exposes it.',
  };
}

function taskDiagnostics(task: UiTasksSnapshot['tasks'][number]): readonly string[] {
  const retry = task.retryPolicy
    ? `retry attempt ${task.retryPolicy.currentAttempt}/${task.retryPolicy.maxAttempts} backoff ${task.retryPolicy.backoff} delay ${task.retryPolicy.delayMs}ms categories ${task.retryPolicy.retryOn.join(',')}`
    : '';
  return [
    retry,
    task.retryAt ? `retry eligible ${formatEpochMs(task.retryAt)}` : '',
    task.exitCode !== undefined ? `exit code ${task.exitCode}` : '',
    task.parentTaskId ? `parent ${task.parentTaskId}` : '',
    task.childTaskIds.length > 0 ? `children ${task.childTaskIds.join(',')}` : '',
    task.correlationId ? `correlation ${task.correlationId}` : '',
    task.turnId ? `turn ${task.turnId}` : '',
    task.error ? `error ${compactUnknown(task.error)}` : '',
    task.result !== undefined ? `result ${compactUnknown(task.result)}` : '',
    `output route /tasks output ${task.id}`,
  ].filter((value): value is string => value.length > 0);
}

function automationRunDiagnostics(run: UiAutomationSnapshot['runs'][number]): readonly string[] {
  const telemetry = run.telemetry;
  const usage = telemetry?.usage;
  const usageSummary = usage
    ? [
      `telemetry usage input ${usage.inputTokens}`,
      `output ${usage.outputTokens}`,
      `cache-read ${usage.cacheReadTokens}`,
      `cache-write ${usage.cacheWriteTokens}`,
      usage.reasoningTokens !== undefined ? `reasoning ${usage.reasoningTokens}` : '',
    ].filter(Boolean).join(' ')
    : '';
  const callSummary = telemetry
    ? [
      telemetry.llmCallCount !== undefined ? `llm ${telemetry.llmCallCount}` : '',
      telemetry.toolCallCount !== undefined ? `tool ${telemetry.toolCallCount}` : '',
      telemetry.turnCount !== undefined ? `turns ${telemetry.turnCount}` : '',
      telemetry.reasoningSummaryPresent !== undefined ? `reasoning-summary ${telemetry.reasoningSummaryPresent ? 'yes' : 'no'}` : '',
    ].filter(Boolean).join(' ')
    : '';
  const route = run.route
    ? [
      `route ${run.route.id}`,
      run.route.surfaceKind,
      run.route.kind,
      run.route.title,
    ].filter(Boolean).join(' ')
    : '';
  const deliveries = (run.deliveryAttempts ?? []).slice(-3).map((delivery) => [
    `delivery ${delivery.id}`,
    delivery.status,
    delivery.responseId ? `response ${delivery.responseId}` : '',
    delivery.endedAt ? `ended ${formatEpochMs(delivery.endedAt)}` : '',
  ].filter(Boolean).join(' '));
  return [
    run.continuationMode ? `continuation ${run.continuationMode}` : '',
    run.executionIntent ? `intent ${compactUnknown(run.executionIntent)}` : '',
    telemetry?.source ? `telemetry source ${telemetry.source}` : '',
    telemetry?.modelId ? `telemetry model ${telemetry.modelId}` : '',
    telemetry?.providerId ? `telemetry provider ${telemetry.providerId}` : '',
    usageSummary,
    callSummary ? `telemetry calls ${callSummary}` : '',
    route,
    ...deliveries,
    run.result !== undefined ? `result ${compactUnknown(run.result)}` : '',
    run.cancelledReason ? `cancelled ${run.cancelledReason}` : '',
  ].filter((value): value is string => value.length > 0);
}

function scheduleEditRoute(job: UiAutomationSnapshot['jobs'][number]): string {
  const schedule = job.schedule;
  const value = schedule.kind === 'cron'
    ? schedule.expression
    : schedule.kind === 'every'
      ? formatIntervalMs(schedule.intervalMs)
      : formatEpochMs(schedule.at) ?? String(schedule.at);
  const timezone = schedule.kind === 'cron' && schedule.timezone
    ? ` timezone:"${quoteRouteValue(schedule.timezone)}"`
    : '';
  return `schedule action:"edit" scheduleId:"${quoteRouteValue(job.id)}" scheduleKind:"${schedule.kind}" scheduleValue:"${quoteRouteValue(value)}"${timezone} confirm:true explicitUserRequest:"..."`;
}

function taskStatusRank(status: UiTasksSnapshot['tasks'][number]['status']): number {
  if (status === 'running') return 0;
  if (status === 'queued') return 1;
  if (status === 'blocked') return 2;
  if (status === 'failed') return 3;
  if (status === 'completed') return 4;
  return 5;
}

function taskLiveRecords(context: CommandContext): readonly AutonomyQueueLiveRecord[] {
  const snapshot = readSnapshot(context.platform.readModels?.tasks);
  const tasks = [...(snapshot?.tasks ?? [])].sort((left, right) => {
    const rankDelta = taskStatusRank(left.status) - taskStatusRank(right.status);
    if (rankDelta !== 0) return rankDelta;
    const leftTime = left.endedAt ?? left.startedAt ?? left.queuedAt;
    const rightTime = right.endedAt ?? right.startedAt ?? right.queuedAt;
    return rightTime - leftTime || left.title.localeCompare(right.title);
  });
  return tasks.slice(0, 20).map((task) => {
    const active = task.status === 'queued' || task.status === 'running' || task.status === 'blocked';
    const canCancel = task.cancellable && active;
    const canRetry = task.status === 'failed' || task.status === 'cancelled';
    const cancelRoute = operatorMethodRoute('tasks.cancel', { taskId: task.id });
    const retryRoute = operatorMethodRoute('tasks.retry', { taskId: task.id });
    const retry = task.retryPolicy
      ? `attempt ${task.retryPolicy.currentAttempt}/${task.retryPolicy.maxAttempts}`
      : '';
    const summary = [
      `${task.status} ${task.kind}`,
      `owner ${task.owner}`,
      task.cancellable ? 'host-cancellable' : 'not cancellable',
      formatTimeFragment('queued', task.queuedAt),
      formatTimeFragment('started', task.startedAt),
      formatTimeFragment('ended', task.endedAt),
      retry,
      task.retryAt ? `retry ${formatEpochMs(task.retryAt)}` : '',
      task.error ? `error ${compactUnknown(task.error)}` : '',
      task.result !== undefined ? `result ${compactUnknown(task.result)}` : compactUnknown(task.description),
    ].filter(Boolean).join(' | ');
    const output = taskOutputDescriptor(task);
    return {
      id: task.id,
      label: task.title,
      status: task.status,
      phase: task.kind,
      updatedAt: formatEpochMs(task.endedAt ?? task.startedAt ?? task.queuedAt),
      summary,
      inspectRoute: `/tasks show ${task.id}`,
      ...(canCancel ? { cancelRoute } : {}),
      nextSteps: [
        `/tasks show ${task.id}`,
        `/tasks output ${task.id}`,
        ...(canCancel ? [cancelRoute] : []),
        ...(canRetry ? [retryRoute] : []),
        'Use /workplan for Agent-owned visible task changes; host task mutation requires exact confirmed daemon methods.',
      ],
      sourceIds: [
        task.parentTaskId,
        ...task.childTaskIds,
        task.correlationId,
        task.turnId,
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
      ...(task.error ? { logTail: [compactUnknown(task.error)] } : {}),
      output,
      diagnostics: taskDiagnostics(task),
      controls: [
        availableControl('inspect', 'Inspect task', 'read-only', `/tasks show ${task.id}`),
        availableControl('output', 'Show output', 'read-only', `/tasks output ${task.id}`),
        canCancel
          ? availableControl('cancel', 'Cancel task', 'confirmed-effect', cancelRoute)
          : unavailableControl('cancel', 'Cancel task', task.cancellable ? `Task is ${task.status}; cancel is only useful before terminal completion.` : 'Task owner did not mark this task cancellable.'),
        canRetry
          ? availableControl('retry', 'Retry task', 'confirmed-effect', retryRoute)
          : unavailableControl('retry', 'Retry task', `Task is ${task.status}; retry is only offered for failed or cancelled tasks.`),
      ],
    };
  });
}

function approvalLiveRecords(context: CommandContext): readonly AutonomyQueueLiveRecord[] {
  const snapshot = readSnapshot(context.platform.readModels?.controlPlane);
  const statusRank = new Map([
    ['pending', 0],
    ['claimed', 1],
    ['denied', 2],
    ['cancelled', 3],
    ['expired', 4],
    ['approved', 5],
  ]);
  return [...(snapshot?.approvals ?? [])]
    .sort((left, right) => {
      const rankDelta = (statusRank.get(left.status) ?? 99) - (statusRank.get(right.status) ?? 99);
      if (rankDelta !== 0) return rankDelta;
      return right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
    })
    .slice(0, 20)
    .map((approval) => {
      const active = approval.status === 'pending' || approval.status === 'claimed';
      const label = `${approval.request.tool}: ${approval.request.analysis.summary}`;
      const approveRoute = `agent_operator_action action:"approvals.approve" approvalId:"${approval.id}" confirm:true explicitUserRequest:"..."`;
      const denyRoute = `agent_operator_action action:"approvals.deny" approvalId:"${approval.id}" confirm:true explicitUserRequest:"..."`;
      const cancelRoute = `agent_operator_action action:"approvals.cancel" approvalId:"${approval.id}" confirm:true explicitUserRequest:"..."`;
      return {
        id: approval.id,
        label,
        status: approval.status,
        phase: approval.request.analysis.riskLevel,
        updatedAt: formatEpochMs(approval.updatedAt),
        summary: [
          `${approval.request.category}/${approval.request.analysis.riskLevel}`,
          approval.request.analysis.classification,
          `call ${approval.callId}`,
          approval.sessionId ? `session ${approval.sessionId}` : '',
          approval.routeId ? `route ${approval.routeId}` : '',
          approval.claimedBy ? `claimed by ${approval.claimedBy}` : '',
          approval.resolvedBy ? `resolved by ${approval.resolvedBy}` : '',
          compactUnknown(approval.request.args),
        ].filter(Boolean).join(' | '),
        inspectRoute: '/approval matrix',
        ...(active ? {
          cancelRoute,
        } : {}),
        nextSteps: active ? [
          approveRoute,
          denyRoute,
          cancelRoute,
        ] : [`/approval matrix`],
        sourceIds: [
          approval.callId,
          approval.sessionId,
          approval.routeId,
          ...approval.audit.map((entry) => entry.id),
        ].filter((value): value is string => typeof value === 'string' && value.length > 0),
        logTail: approval.audit.slice(-3).map((entry) => [
          entry.action,
          entry.actor,
          formatEpochMs(entry.createdAt),
          entry.note,
        ].filter(Boolean).join(' ')),
        controls: [
          availableControl('inspect', 'Inspect approval matrix', 'read-only', '/approval matrix'),
          active
            ? availableControl('approve', 'Approve approval', 'confirmed-effect', approveRoute)
            : unavailableControl('approve', 'Approve approval', `Approval is ${approval.status}; only pending or claimed approvals can be approved.`),
          active
            ? availableControl('deny', 'Deny approval', 'confirmed-effect', denyRoute)
            : unavailableControl('deny', 'Deny approval', `Approval is ${approval.status}; only pending or claimed approvals can be denied.`),
          active
            ? availableControl('cancel', 'Cancel approval', 'confirmed-effect', cancelRoute)
            : unavailableControl('cancel', 'Cancel approval', `Approval is ${approval.status}; only pending or claimed approvals can be cancelled.`),
        ],
      };
    });
}

function automationRunLiveRecords(context: CommandContext): readonly AutonomyQueueLiveRecord[] {
  const snapshot = readSnapshot(context.platform.readModels?.automation);
  return [...(snapshot?.runs ?? [])]
    .sort((left, right) => {
      const activeDelta = Number(right.status === 'queued' || right.status === 'running') - Number(left.status === 'queued' || left.status === 'running');
      if (activeDelta !== 0) return activeDelta;
      return right.queuedAt - left.queuedAt || left.id.localeCompare(right.id);
    })
    .slice(0, 20)
    .map((run) => {
      const active = run.status === 'queued' || run.status === 'running';
      const failed = run.status === 'failed';
      const cancelRoute = `agent_operator_action action:"automation.runs.cancel" runId:"${run.id}" confirm:true explicitUserRequest:"..."`;
      const retryRoute = `agent_operator_action action:"automation.runs.retry" runId:"${run.id}" confirm:true explicitUserRequest:"..."`;
      const timing = [
        formatTimeFragment('queued', run.queuedAt),
        formatTimeFragment('started', run.startedAt),
        formatTimeFragment('ended', run.endedAt),
        run.durationMs !== undefined ? `duration ${run.durationMs}ms` : '',
      ].filter(Boolean).join(', ');
      return {
        id: run.id,
        label: `${run.jobId} -> ${run.target.kind}`,
        status: run.status,
        phase: run.scheduleKind ?? run.triggeredBy.kind,
        updatedAt: formatEpochMs(run.updatedAt),
        summary: [
          `job ${run.jobId}`,
          `target ${run.target.kind}`,
          `attempt ${run.attempt}`,
          run.agentId ? `agent ${run.agentId}` : '',
          run.sessionId ? `session ${run.sessionId}` : '',
          run.routeId ? `route ${run.routeId}` : '',
          run.modelId ? `model ${run.modelId}` : '',
          run.providerId ? `provider ${run.providerId}` : '',
          timing,
          run.error ? `error ${run.error}` : '',
          run.result !== undefined ? `result ${compactUnknown(run.result)}` : '',
        ].filter(Boolean).join(' | '),
        inspectRoute: 'agent_harness mode:"workspace_action" actionId:"schedule-list"',
        ...(active ? {
          cancelRoute,
        } : {}),
        nextSteps: [
          ...(active ? [cancelRoute] : []),
          ...(failed ? [retryRoute] : []),
          `agent_harness mode:"workspace_action" actionId:"schedule-list"`,
        ],
        sourceIds: [
          run.jobId,
          run.agentId,
          run.sessionId,
          run.routeId,
          run.triggeredBy.id,
          ...run.deliveryIds,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0),
        logTail: [
          run.error,
          run.cancelledReason,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0),
        diagnostics: automationRunDiagnostics(run),
        controls: [
          availableControl('inspect', 'Inspect schedule list', 'read-only', 'agent_harness mode:"workspace_action" actionId:"schedule-list"'),
          active
            ? availableControl('cancel', 'Cancel automation run', 'confirmed-effect', cancelRoute)
            : unavailableControl('cancel', 'Cancel automation run', `Run is ${run.status}; cancel is only offered for queued or running runs.`),
          failed
            ? availableControl('retry', 'Retry automation run', 'confirmed-effect', retryRoute)
            : unavailableControl('retry', 'Retry automation run', `Run is ${run.status}; retry is only offered for failed runs.`),
        ],
      };
    });
}

function scheduleLiveRecords(context: CommandContext): readonly AutonomyQueueLiveRecord[] {
  const snapshot = readSnapshot(context.platform.readModels?.automation);
  return [...(snapshot?.jobs ?? [])]
    .sort((left, right) => {
      const errorDelta = Number(right.status === 'error') - Number(left.status === 'error');
      if (errorDelta !== 0) return errorDelta;
      return (right.nextRunAt ?? 0) - (left.nextRunAt ?? 0) || left.name.localeCompare(right.name);
    })
    .slice(0, 20)
    .map((job) => {
      const enabled = job.enabled && job.status === 'enabled';
      const paused = job.status === 'paused' || !job.enabled;
      const toggleRoute = enabled
        ? `schedule action:"pause" scheduleId:"${job.id}" confirm:true explicitUserRequest:"..."`
        : `schedule action:"resume" scheduleId:"${job.id}" confirm:true explicitUserRequest:"..."`;
      const runRoute = `schedule action:"run" scheduleId:"${job.id}" confirm:true explicitUserRequest:"..."`;
      const editRoute = scheduleEditRoute(job);
      const deleteRoute = `schedule action:"delete" scheduleId:"${job.id}" confirm:true explicitUserRequest:"..."`;
      return {
        id: job.id,
        label: job.name,
        status: job.status,
        phase: job.schedule.kind,
        updatedAt: formatEpochMs(job.updatedAt),
        summary: [
          enabled ? 'enabled' : paused ? 'paused' : job.status,
          summarizeSchedule(job.schedule),
          `runs ${job.runCount}`,
          `success ${job.successCount}`,
          `failed ${job.failureCount}`,
          formatTimeFragment('next', job.nextRunAt),
          formatTimeFragment('last', job.lastRunAt),
          job.lastRunId ? `last run ${job.lastRunId}` : '',
          job.description ?? '',
          job.pausedReason ? `paused ${job.pausedReason}` : '',
        ].filter(Boolean).join(' | '),
        inspectRoute: '/schedule list',
        ...(enabled ? { cancelRoute: toggleRoute } : {}),
        ...(enabled ? { pauseRoute: toggleRoute } : { resumeRoute: toggleRoute }),
        nextSteps: [
          runRoute,
          editRoute,
          toggleRoute,
          deleteRoute,
          `agent_harness mode:"workspace_action" actionId:"schedule-list"`,
        ],
        sourceIds: [
          job.source.id,
          job.lastRunId,
          ...job.labels,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0),
        ...(job.pausedReason || job.status === 'error' ? {
          logTail: [job.pausedReason ?? `Schedule status ${job.status}`],
        } : {}),
        controls: [
          availableControl('inspect', 'Inspect schedules', 'read-only', '/schedule list'),
          availableControl('run', 'Run schedule now', 'confirmed-effect', runRoute),
          availableControl('edit', 'Edit schedule', 'confirmed-effect', editRoute),
          availableControl(enabled ? 'pause' : 'resume', enabled ? 'Pause schedule' : 'Resume schedule', 'confirmed-effect', toggleRoute),
          availableControl(enabled ? 'disable' : 'enable', enabled ? 'Disable schedule' : 'Enable schedule', 'confirmed-effect', toggleRoute),
          availableControl('delete', 'Delete schedule', 'confirmed-effect', deleteRoute),
        ],
      };
    });
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
    const canPause = run.status === 'running' || run.status === 'blocked';
    const canResume = run.status === 'paused' || run.status === 'planned' || run.status === 'blocked';
    const inspectRoute = `research action:"run" runId="${run.id}"`;
    const cancelRoute = `research action:"cancel" id="${run.id}" note="..." confirm:true explicitUserRequest:"..."`;
    const checkpointRoute = `research action:"checkpoint" id="${run.id}" note="..." progress:${run.progress} confirm:true explicitUserRequest:"..."`;
    const pauseRoute = `research action:"pause" id="${run.id}" note="..." confirm:true explicitUserRequest:"..."`;
    const resumeRoute = `research action:"resume" id="${run.id}" note="..." confirm:true explicitUserRequest:"..."`;
    const availableNextRoutes = [
      checkpointRoute,
      ...(canPause ? [pauseRoute] : []),
      ...(canResume ? [resumeRoute] : []),
      cancelRoute,
    ];
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
      inspectRoute,
      ...(terminal ? {} : {
        cancelRoute,
        checkpointRoute,
        ...(canPause ? { pauseRoute } : {}),
        ...(canResume ? { resumeRoute } : {}),
      }),
      nextSteps: terminal ? run.nextSteps : [...run.nextSteps, ...availableNextRoutes],
      sourceIds: run.sourceIds,
      logTail: run.logTail,
      controls: [
        availableControl('inspect', 'Inspect research run', 'read-only', inspectRoute),
        terminal
          ? unavailableControl('checkpoint', 'Checkpoint research run', `Research run is ${run.status}; checkpoint is only offered before terminal completion.`)
          : availableControl('checkpoint', 'Checkpoint research run', 'confirmed-effect', checkpointRoute),
        canPause
          ? availableControl('pause', 'Pause research run', 'confirmed-effect', pauseRoute)
          : unavailableControl('pause', 'Pause research run', terminal ? `Research run is ${run.status}; pause is only offered before terminal completion.` : `Research run is ${run.status}; pause is offered for running or blocked runs.`),
        canResume
          ? availableControl('resume', 'Resume research run', 'confirmed-effect', resumeRoute)
          : unavailableControl('resume', 'Resume research run', terminal ? `Research run is ${run.status}; resume is only offered before terminal completion.` : `Research run is ${run.status}; resume is offered for planned, paused, or blocked runs.`),
        terminal
          ? unavailableControl('cancel', 'Cancel research run', `Research run is ${run.status}; cancel is only offered before terminal completion.`)
          : availableControl('cancel', 'Cancel research run', 'confirmed-effect', cancelRoute),
      ],
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
    item.batchCreateRoute ?? '',
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
      record.pauseRoute ?? '',
      record.resumeRoute ?? '',
      record.nextSteps?.join('\n') ?? '',
      record.sourceIds?.join('\n') ?? '',
      record.logTail?.join('\n') ?? '',
      record.output ? [
        record.output.status,
        record.output.route,
        record.output.source,
        record.output.preview ?? '',
        record.output.policy,
      ].join('\n') : '',
      record.diagnostics?.join('\n') ?? '',
      record.controls?.map((control) => [
        control.id,
        control.label,
        control.state,
        control.effect,
        control.modelRoute ?? '',
        control.reason ?? '',
      ].join(' ')).join('\n') ?? '',
    ]).join('\n') ?? '',
  ].join('\n').toLowerCase();
}

function describeControl(control: AutonomyQueueRecordControl): Record<string, unknown> {
  return {
    id: control.id,
    label: control.label,
    state: control.state,
    effect: control.effect,
    confirmationRequired: control.confirmationRequired,
    ...(control.modelRoute ? { modelRoute: control.modelRoute } : {}),
    ...(control.reason ? { reason: previewHarnessText(control.reason, 120) } : {}),
  };
}

function describeOutput(output: AutonomyQueueRecordOutput, includeParameters: boolean): Record<string, unknown> {
  return {
    status: output.status,
    route: output.route,
    source: output.source,
    ...(output.preview ? { preview: previewHarnessText(output.preview, includeParameters ? 220 : 96) } : {}),
    policy: previewHarnessText(output.policy, includeParameters ? 180 : 96),
  };
}

function describeLiveRecord(record: AutonomyQueueLiveRecord, includeParameters: boolean): Record<string, unknown> {
  const availableControls = record.controls
    ?.filter((control) => control.state === 'available')
    .map((control) => control.id);
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
    ...(record.pauseRoute ? { pauseRoute: record.pauseRoute } : {}),
    ...(record.resumeRoute ? { resumeRoute: record.resumeRoute } : {}),
    ...(record.nextSteps && record.nextSteps.length > 0 ? { nextSteps: record.nextSteps.slice(0, includeParameters ? 8 : 3) } : {}),
    ...(record.sourceIds && record.sourceIds.length > 0 ? { sourceIds: record.sourceIds.slice(0, includeParameters ? 12 : 4) } : {}),
    ...(record.logTail && record.logTail.length > 0 ? { logTail: record.logTail.slice(-(includeParameters ? 5 : 2)) } : {}),
    ...(record.output ? { output: describeOutput(record.output, includeParameters) } : {}),
    ...(record.diagnostics && record.diagnostics.length > 0 ? { diagnostics: record.diagnostics.slice(0, includeParameters ? 10 : 3).map((line) => previewHarnessText(line, includeParameters ? 160 : 96)) } : {}),
    ...(availableControls && availableControls.length > 0 ? { availableControls: availableControls.slice(0, includeParameters ? 8 : 4) } : {}),
    ...(includeParameters && record.controls && record.controls.length > 0 ? { controls: record.controls.map(describeControl) } : {}),
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
    ...(item.batchCreateRoute ? { batchCreateRoute: item.batchCreateRoute } : {}),
    ...(item.liveRecords && item.liveRecords.length > 0 ? { liveRecords: item.liveRecords.slice(0, includeParameters ? 8 : 3).map((record) => describeLiveRecord(record, includeParameters)) } : {}),
    ...(lookup ? { lookup } : {}),
    ...(includeParameters ? {
      routes: {
        inspect: item.inspectRoute,
        model: item.modelRoute,
        cancel: item.cancelRoute ?? null,
        create: item.createRoute ?? null,
        batchCreate: item.batchCreateRoute ?? null,
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
  const taskRecords = taskLiveRecords(context);
  const approvalRecords = approvalLiveRecords(context);
  const automationRecords = automationRunLiveRecords(context);
  const scheduleRecords = scheduleLiveRecords(context);
  const latestResearchRun = researchRuns[0];
  const taskCancelRoute = firstAvailableControlRoute(taskRecords, 'cancel');
  const taskStatus: AutonomyQueueStatus = taskRecords.some((record) => record.status === 'blocked' || record.status === 'failed')
    ? 'attention'
    : taskRecords.some((record) => record.status === 'running' || record.status === 'queued')
      ? 'active'
      : taskMethods.length > 0
        ? 'ready'
        : 'needs-setup';
  const approvalStatus: AutonomyQueueStatus = approvalRecords.some((record) => record.status === 'pending' || record.status === 'claimed')
    ? 'attention'
    : approvalMethods.length > 0
      ? 'ready'
      : 'needs-setup';
  const automationStatus: AutonomyQueueStatus = automationRecords.some((record) => record.status === 'failed')
    ? 'attention'
    : automationRecords.some((record) => record.status === 'queued' || record.status === 'running')
      ? 'active'
      : automationMethods.length > 0
        ? 'ready'
        : 'needs-setup';
  const scheduleStatus: AutonomyQueueStatus = scheduleRecords.some((record) => record.status === 'error')
    ? 'attention'
    : scheduleRecords.some((record) => record.status === 'enabled')
      ? 'active'
      : scheduleMethods.length > 0
        ? 'ready'
        : 'needs-setup';
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
      inspectRoute: 'research action:"runs"',
      modelRoute: 'research action:"runs"',
      cancelRoute: 'research action:"cancel" id="..." note="..." confirm:true explicitUserRequest="..."',
      createRoute: 'research action:"create_run" title:"..." question:"..." confirm:true explicitUserRequest:"..."',
      liveRecords: researchRuns,
    },
    {
      id: 'connected-host-tasks',
      label: 'Connected-host tasks',
      status: taskStatus,
      owner: 'connected-host',
      kind: 'host-task',
      visible: true,
      cancellable: taskRecords.some((record) => controlAvailable(record, 'cancel')),
      count: taskRecords.length > 0 ? taskRecords.length : taskMethods.length,
      current: taskRecords.length > 0
        ? `${taskRecords.length} live connected-host task record(s); active cancellable tasks expose exact confirmed daemon controls. ${taskMethods.length} task-like daemon method(s) are discoverable.`
        : `${taskMethods.length} task-like daemon method(s) are present; Agent exposes read-only host task inspection.`,
      next: taskRecords.some((record) => record.status === 'blocked' || record.status === 'failed')
        ? 'Inspect failed or blocked host tasks, then use the exact retry control when useful or update Agent workplan state from the visible work-plan route.'
        : taskCancelRoute
          ? 'Inspect active host tasks; cancel only the exact host task id through its confirmed daemon control when the user authorizes it.'
          : taskRecords.some((record) => record.status === 'running' || record.status === 'queued')
            ? 'Inspect active host tasks before changing any work plan, delegation, or automation state.'
          : taskMethods.length > 0
            ? 'Inspect host tasks before changing any work plan or automation state.'
        : 'Update the connected GoodVibes host or connector set until task inspection methods are present.',
      inspectRoute: 'agent_harness mode:"workspace_action" actionId:"tasks-list"',
      modelRoute: 'host action:"methods" query:"task"',
      ...(taskCancelRoute ? { cancelRoute: taskCancelRoute } : {}),
      methodIds: taskMethods,
      liveRecords: taskRecords,
    },
    {
      id: 'pending-approvals',
      label: 'Pending approvals',
      status: approvalStatus,
      owner: 'connected-host',
      kind: 'approval',
      visible: true,
      cancellable: true,
      count: approvalRecords.length > 0 ? approvalRecords.length : approvalMethods.length,
      current: approvalRecords.length > 0
        ? `${approvalRecords.length} recent approval record(s); pending or claimed approvals require explicit user-visible decisions.`
        : `${approvalMethods.length} approval daemon method(s) are present; approval decisions remain explicit and reviewable.`,
      next: approvalRecords.some((record) => record.status === 'pending' || record.status === 'claimed')
        ? 'Review pending approval records, risk, and args; approve, deny, or cancel exactly one id only when the user asks.'
        : 'Review the matrix, then approve, deny, or cancel one exact approval id only when the user asks.',
      inspectRoute: 'agent_harness mode:"workspace_action" actionId:"approvals"',
      modelRoute: 'host action:"methods" query:"approval"',
      cancelRoute: 'agent_harness mode:"run_workspace_action" actionId:"approval-cancel" confirm:true explicitUserRequest:"..."',
      methodIds: approvalMethods,
      liveRecords: approvalRecords,
    },
    {
      id: 'automation-runs',
      label: 'Automation runs',
      status: automationStatus,
      owner: 'connected-host',
      kind: 'automation-run',
      visible: true,
      cancellable: true,
      count: automationRecords.length > 0 ? automationRecords.length : automationMethods.length,
      current: automationRecords.length > 0
        ? `${automationRecords.length} recent automation run record(s); active, failed, and retryable runs expose exact control routes.`
        : `${automationMethods.length} automation daemon method(s) are present; run, pause, resume, cancel, and retry actions are confirmed forms.`,
      next: automationRecords.some((record) => record.status === 'failed')
        ? 'Inspect failed automation runs, then retry or leave them alone only through exact confirmed run routes.'
        : automationRecords.some((record) => record.status === 'queued' || record.status === 'running')
          ? 'Inspect active automation runs and cancel only the exact run id the user authorizes.'
          : 'Inspect automation posture first. Use exact run/job ids for confirmed run control.',
      inspectRoute: 'host action:"methods" query:"automation"',
      modelRoute: 'agent_harness mode:"workspace_actions" categoryId:"automation"',
      cancelRoute: 'agent_harness mode:"run_workspace_action" actionId:"automation-run-cancel" confirm:true explicitUserRequest:"..."',
      methodIds: automationMethods,
      liveRecords: automationRecords,
    },
    {
      id: 'autonomous-schedule-requests',
      label: 'Autonomous schedule requests',
      status: scheduleMethods.length > 0 ? 'ready' : 'needs-setup',
      owner: 'agent-and-connected-host',
      kind: 'schedule',
      visible: true,
      cancellable: false,
      count: scheduleMethods.length,
      current: `${scheduleMethods.length} schedule/reminder daemon method(s); autonomous schedules require explicit task, cadence, success criteria, and user request provenance.`,
      next: scheduleMethods.length > 0
        ? 'Create one visible autonomous schedule only after the user gives exact timing and success criteria.'
        : 'Update the connected GoodVibes host until schedules.create is available.',
      inspectRoute: 'agent_harness mode:"autonomy_intake" query:"..."',
      modelRoute: 'schedule action:"create"',
      createRoute: 'schedule action:"create" task:"..." successCriteria:"..." scheduleKind:"..." scheduleValue:"..." confirm:true explicitUserRequest:"..."',
      methodIds: scheduleMethods,
    },
    {
      id: 'connected-schedules',
      label: 'Connected schedules',
      status: scheduleStatus,
      owner: 'connected-host',
      kind: 'schedule',
      visible: true,
      cancellable: true,
      count: scheduleRecords.length > 0 ? scheduleRecords.length : scheduleMethods.length,
      current: scheduleRecords.length > 0
        ? `${scheduleRecords.length} live connected schedule record(s); edit, run-now, enable, disable, and delete remain explicit confirmed actions.`
        : `${scheduleMethods.length} schedule/reminder daemon method(s) are present; schedule inspection, edit, and lifecycle controls are visible.`,
      next: scheduleRecords.some((record) => record.status === 'error')
        ? 'Inspect schedule errors before running, enabling, disabling, deleting, or creating more schedules.'
        : scheduleRecords.length > 0
          ? 'Review live schedules or reconcile routine receipts before controlling one exact schedule id.'
          : 'List schedules or reconcile routine receipts before controlling one schedule by id.',
      inspectRoute: 'agent_harness mode:"workspace_action" actionId:"schedule-list"',
      modelRoute: 'schedule action:"list|edit|run|pause|resume|delete"',
      cancelRoute: 'schedule action:"pause" scheduleId:"..." confirm:true explicitUserRequest:"..."',
      createRoute: 'schedule action:"create" task:"..." successCriteria:"..." scheduleKind:"..." scheduleValue:"..." confirm:true explicitUserRequest:"..."',
      methodIds: scheduleMethods,
      liveRecords: scheduleRecords,
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
      inspectRoute: 'personal_ops action:"lane" laneId:"reminders"',
      modelRoute: 'schedule action:"remind"',
      createRoute: 'schedule action:"remind" message:"..." scheduleKind:"..." scheduleValue:"..." confirm:true explicitUserRequest:"..."',
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
      inspectRoute: 'agent_harness mode:"agent_orchestration"',
      modelRoute: 'agent_harness mode:"agent_orchestration"',
      cancelRoute: 'agent { mode: "cancel", agentId: "..." }',
      createRoute: 'agent { mode: "spawn", task: "..." }',
      batchCreateRoute: 'agent { mode: "batch-spawn", tasks: [...] }',
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
      inspectRoute: 'channels action:"status"',
      modelRoute: 'channels action:"status"',
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
