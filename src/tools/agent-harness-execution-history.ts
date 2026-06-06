import type { CommandContext } from '../input/command-registry.ts';
import type { AgentExecutionRecord, AgentExecutionRouteKind, AgentExecutionStatus } from '../runtime/execution-ledger.ts';
import { fileRecoveryCatalogStatus } from './agent-harness-file-recovery.ts';
import { previewHarnessText } from './agent-harness-text.ts';

export interface AgentHarnessExecutionHistoryArgs {
  readonly executionRecordId?: unknown;
  readonly recordId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

type ExecutionHistoryLookupSource = 'executionRecordId' | 'recordId' | 'target' | 'query';

type ExecutionHistoryResolution =
  | { readonly status: 'found'; readonly record: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function iso(value: number | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function lookupFromArgs(args: AgentHarnessExecutionHistoryArgs): { readonly source: ExecutionHistoryLookupSource; readonly input: string } | null {
  const executionRecordId = readString(args.executionRecordId);
  if (executionRecordId) return { source: 'executionRecordId', input: executionRecordId };
  const recordId = readString(args.recordId);
  if (recordId) return { source: 'recordId', input: recordId };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

function records(context: CommandContext): readonly AgentExecutionRecord[] {
  return context.ops.executionLedger?.getSnapshot().records ?? [];
}

function recordSearchText(record: AgentExecutionRecord): string {
  return [
    record.id,
    record.callId,
    record.turnId,
    record.tool,
    record.routeKind,
    record.status,
    record.phase,
    record.argsPreview,
    record.commandPreview ?? '',
    record.targetPreview ?? '',
    record.resultSummary?.preview ?? '',
    record.error ?? '',
    record.cancelReason ?? '',
  ].join('\n').toLowerCase();
}

function isRecoverableRoute(record: AgentExecutionRecord): boolean {
  if (record.routeKind === 'write') return true;
  const tool = record.tool.toLowerCase();
  return tool.includes('write') || tool.includes('edit') || tool.includes('patch') || tool.includes('delete');
}

function toolInspectorAvailable(context: CommandContext): boolean {
  return Boolean(context.workspace.panelManager?.getRegisteredTypes().some((panel) => panel.id === 'tools'));
}

function supervisionRoutes(context: CommandContext, record: AgentExecutionRecord): readonly Record<string, unknown>[] {
  const routes: Record<string, unknown>[] = [];
  if (toolInspectorAvailable(context)) {
    routes.push({
      id: 'tool-inspector',
      label: 'Tool Call Inspector',
      modelRoute: 'agent_harness mode:"open_panel" panelId:"tools"',
      requiresConfirmation: true,
    });
  }
  if (record.routeKind === 'shell') {
    if (typeof context.openProcessModal === 'function') {
      routes.push({
        id: 'process-monitor',
        label: 'Runtime Activity Monitor',
        modelRoute: 'agent_harness mode:"open_ui_surface" surfaceId:"process-monitor"',
        requiresConfirmation: true,
      });
    }
    if (typeof context.openLiveTail === 'function') {
      routes.push({
        id: 'live-tail',
        label: 'Live Process Output',
        modelRoute: 'agent_harness mode:"open_ui_surface" surfaceId:"live-tail"',
        requiresConfirmation: true,
      });
    }
  }
  return routes;
}

function routeKindSummary(records: readonly AgentExecutionRecord[]): Record<AgentExecutionRouteKind, number> {
  return {
    read: records.filter((record) => record.routeKind === 'read').length,
    write: records.filter((record) => record.routeKind === 'write').length,
    shell: records.filter((record) => record.routeKind === 'shell').length,
    network: records.filter((record) => record.routeKind === 'network').length,
    browser: records.filter((record) => record.routeKind === 'browser').length,
    delegation: records.filter((record) => record.routeKind === 'delegation').length,
    other: records.filter((record) => record.routeKind === 'other').length,
  };
}

function statusSummary(records: readonly AgentExecutionRecord[]): Record<AgentExecutionStatus, number> {
  return {
    running: records.filter((record) => record.status === 'running').length,
    succeeded: records.filter((record) => record.status === 'succeeded').length,
    failed: records.filter((record) => record.status === 'failed').length,
    cancelled: records.filter((record) => record.status === 'cancelled').length,
  };
}

function describeRecord(
  context: CommandContext,
  record: AgentExecutionRecord,
  includeParameters: boolean,
  lookup?: Record<string, unknown>,
): Record<string, unknown> {
  const recoverable = isRecoverableRoute(record) && (fileRecoveryCatalogStatus(context).undoDepth as number | undefined ?? 0) > 0;
  return {
    executionRecordId: record.id,
    callId: record.callId,
    turnId: record.turnId,
    tool: record.tool,
    routeKind: record.routeKind,
    status: record.status,
    phase: record.phase,
    receivedAt: iso(record.receivedAt),
    updatedAt: iso(record.updatedAt),
    ...(record.completedAt ? { completedAt: iso(record.completedAt) } : {}),
    ...(typeof record.durationMs === 'number' ? { durationMs: record.durationMs } : {}),
    ...(typeof record.permissionApproved === 'boolean' ? { permissionApproved: record.permissionApproved } : {}),
    ...(record.commandPreview ? { commandPreview: previewHarnessText(record.commandPreview, includeParameters ? 180 : 96) } : {}),
    ...(record.targetPreview ? { targetPreview: previewHarnessText(record.targetPreview, includeParameters ? 180 : 96) } : {}),
    argsPreview: previewHarnessText(record.argsPreview, includeParameters ? 360 : 120),
    ...(record.resultSummary ? {
      resultSummary: {
        kind: record.resultSummary.kind,
        byteSize: record.resultSummary.byteSize,
        ...(record.resultSummary.preview ? { preview: previewHarnessText(record.resultSummary.preview, includeParameters ? 220 : 96) } : {}),
      },
    } : {}),
    ...(record.error ? { error: previewHarnessText(record.error, includeParameters ? 220 : 96) } : {}),
    ...(record.cancelReason ? { cancelReason: previewHarnessText(record.cancelReason, includeParameters ? 220 : 96) } : {}),
    supervisionRoutes: supervisionRoutes(context, record),
    ...(recoverable ? { recoveryRoute: 'agent_harness mode:"file_recovery"' } : {}),
    modelRoute: `agent_harness mode:"execution_history_item" executionRecordId:"${record.id}"`,
    ...(lookup ? { lookup } : {}),
    ...(includeParameters ? {
      argsKeys: record.argsKeys,
      policy: {
        effect: 'read-only',
        values: 'Execution history stores bounded, redacted args and result summaries only; raw file bytes, binary bodies, and secret-looking argument keys are not exposed.',
        mutation: 'Follow-up UI routing and file recovery remain confirmation-gated through open_panel, open_ui_surface, file_recovery, or run_file_recovery.',
      },
      modelAccess: {
        inspectHistory: 'agent_harness mode:"execution_history"',
        inspectRecord: `agent_harness mode:"execution_history_item" executionRecordId:"${record.id}"`,
        toolInspector: 'agent_harness mode:"open_panel" panelId:"tools" confirm:true explicitUserRequest:"..."',
        fileRecovery: 'agent_harness mode:"file_recovery"',
      },
    } : {}),
  };
}

function candidate(record: AgentExecutionRecord): Record<string, unknown> {
  return {
    executionRecordId: record.id,
    tool: record.tool,
    routeKind: record.routeKind,
    status: record.status,
    modelRoute: `agent_harness mode:"execution_history_item" executionRecordId:"${record.id}"`,
  };
}

export function executionHistoryCatalogStatus(context: CommandContext): Record<string, unknown> {
  const ledger = context.ops.executionLedger;
  if (!ledger) {
    return {
      modes: ['execution_history', 'execution_history_item'],
      status: 'unavailable',
      readOnly: true,
    };
  }
  const snapshot = ledger.getSnapshot();
  return {
    modes: ['execution_history', 'execution_history_item'],
    status: 'available',
    records: snapshot.total,
    running: snapshot.running,
    failed: snapshot.failed,
    readOnly: true,
  };
}

export function executionHistorySummary(context: CommandContext, args: AgentHarnessExecutionHistoryArgs): Record<string, unknown> {
  const all = records(context);
  const query = readString(args.query).toLowerCase();
  const includeParameters = args.includeParameters === true;
  const filtered = all
    .filter((record) => !query || recordSearchText(record).includes(query))
    .slice(0, readLimit(args.limit, 100));
  return {
    status: context.ops.executionLedger ? 'available' : 'unavailable',
    summary: {
      records: all.length,
      ...statusSummary(all),
      routeKinds: routeKindSummary(all),
    },
    records: filtered.map((record) => describeRecord(context, record, includeParameters)),
    returned: filtered.length,
    total: all.length,
    policy: 'Read-only local execution history. Use exact inspect routes for one record; UI routing and recovery remain separate confirmation-gated modes.',
  };
}

export function describeExecutionHistoryItem(context: CommandContext, args: AgentHarnessExecutionHistoryArgs): ExecutionHistoryResolution {
  const lookup = lookupFromArgs(args);
  if (!lookup) {
    return {
      status: 'missing_lookup',
      usage: 'execution_history_item requires executionRecordId, recordId, target, or query. Use mode:"execution_history" to inspect recent record ids.',
    };
  }
  const all = records(context);
  const normalized = lookup.input.toLowerCase();
  const exact = all.find((record) => record.id === lookup.input || record.callId === lookup.input);
  if (exact) return { status: 'found', record: describeRecord(context, exact, true, { ...lookup, resolvedBy: 'id' }) };
  const insensitive = all.find((record) => record.id.toLowerCase() === normalized || record.callId.toLowerCase() === normalized);
  if (insensitive) return { status: 'found', record: describeRecord(context, insensitive, true, { ...lookup, resolvedBy: 'case-insensitive-id' }) };
  const searched = all.filter((record) => recordSearchText(record).includes(normalized));
  if (searched.length === 1) return { status: 'found', record: describeRecord(context, searched[0]!, true, { ...lookup, resolvedBy: 'search' }) };
  if (searched.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: searched.slice(0, 8).map(candidate),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown execution history record ${lookup.input}. Use mode:"execution_history" to inspect recent record ids.`,
  };
}
