import { getOperatorContract } from '@pellux/goodvibes-sdk/contracts';
import type { CommandContext } from '../input/command-registry.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from '../input/agent-workspace-snapshot.ts';
import { previewHarnessText } from './agent-harness-text.ts';

export type PersonalOpsLaneId =
  | 'inbox'
  | 'calendar'
  | 'notes'
  | 'tasks'
  | 'reminders'
  | 'routines'
  | 'delivery';

type PersonalOpsStatus = 'ready' | 'partial' | 'needs-setup' | 'gap';

interface AgentHarnessPersonalOpsArgs {
  readonly laneId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
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

interface PersonalOpsLane {
  readonly id: PersonalOpsLaneId;
  readonly label: string;
  readonly status: PersonalOpsStatus;
  readonly outcome: string;
  readonly current: string;
  readonly next: string;
  readonly userRoute: string;
  readonly modelRoute: string;
  readonly signals: readonly string[];
  readonly methodIds?: readonly string[];
  readonly connectorSignals?: readonly PersonalOpsConnectorSignal[];
  readonly liveRecords?: readonly PersonalOpsLiveRecord[];
}

interface PersonalOpsConnectorSignal {
  readonly id: string;
  readonly kind: 'mcp-server';
  readonly label: string;
  readonly status: 'ready' | 'attention';
  readonly summary: string;
  readonly modelRoute: string;
}

interface PersonalOpsLiveRecord {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly summary: string;
  readonly userRoute: string;
  readonly modelRoute: string;
  readonly tags?: readonly string[];
}

export type PersonalOpsLaneResolution =
  | { readonly status: 'found'; readonly lane: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

const LANE_IDS: readonly PersonalOpsLaneId[] = ['inbox', 'calendar', 'notes', 'tasks', 'reminders', 'routines', 'delivery'];

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

function mcpServerRecords(context: CommandContext): readonly {
  readonly name: string;
  readonly connected: boolean;
  readonly trustMode: string;
  readonly role: string;
  readonly schemaFreshness: string;
  readonly allowedHosts: readonly string[];
}[] {
  const api = context.clients?.mcpApi ?? context.extensions?.mcpRegistry;
  if (!api || typeof api.listServerSecurity !== 'function') return [];
  try {
    return api.listServerSecurity();
  } catch {
    return [];
  }
}

function mcpServerSearchText(server: ReturnType<typeof mcpServerRecords>[number]): string {
  return [
    server.name,
    server.connected ? 'connected' : 'disconnected',
    server.trustMode,
    server.role,
    server.schemaFreshness,
    ...server.allowedHosts,
  ].join('\n').toLowerCase();
}

function connectorSignalsMatching(context: CommandContext, tokens: readonly string[]): readonly PersonalOpsConnectorSignal[] {
  if (tokens.length === 0) return [];
  return mcpServerRecords(context)
    .filter((server) => {
      const text = mcpServerSearchText(server);
      return tokens.some((token) => text.includes(token));
    })
    .map((server) => {
      const ready = server.connected && server.schemaFreshness === 'fresh' && server.trustMode !== 'blocked';
      return {
        id: `mcp:${server.name}`,
        kind: 'mcp-server' as const,
        label: server.name,
        status: ready ? 'ready' as const : 'attention' as const,
        summary: `${server.connected ? 'connected' : 'disconnected'} ${server.trustMode} ${server.schemaFreshness}`,
        modelRoute: `agent_harness mode:"mcp_server" mcpServerId:"${server.name}"`,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function laneStatusRank(status: PersonalOpsStatus): number {
  if (status === 'ready') return 4;
  if (status === 'partial') return 3;
  if (status === 'needs-setup') return 2;
  return 1;
}

function searchText(lane: PersonalOpsLane): string {
  return [
    lane.id,
    lane.label,
    lane.status,
    lane.outcome,
    lane.current,
    lane.next,
    lane.userRoute,
    lane.modelRoute,
    lane.signals.join('\n'),
    lane.liveRecords?.flatMap((record) => [
      record.id,
      record.label,
      record.status,
      record.summary,
      record.userRoute,
      record.modelRoute,
      record.tags?.join('\n') ?? '',
    ]).join('\n') ?? '',
  ].join('\n').toLowerCase();
}

function describeLiveRecord(record: PersonalOpsLiveRecord, includeParameters: boolean): Record<string, unknown> {
  return {
    id: record.id,
    label: record.label,
    status: record.status,
    summary: previewHarnessText(record.summary, includeParameters ? 180 : 96),
    userRoute: previewHarnessText(record.userRoute, includeParameters ? 140 : 96),
    modelRoute: previewHarnessText(record.modelRoute, includeParameters ? 140 : 96),
    ...(record.tags && record.tags.length > 0 ? { tags: record.tags.slice(0, includeParameters ? 12 : 4) } : {}),
  };
}

function describeConnectorSignal(signal: PersonalOpsConnectorSignal, includeParameters: boolean): Record<string, unknown> {
  return {
    id: signal.id,
    kind: signal.kind,
    label: signal.label,
    status: signal.status,
    summary: previewHarnessText(signal.summary, includeParameters ? 180 : 96),
    modelRoute: previewHarnessText(signal.modelRoute, includeParameters ? 140 : 96),
  };
}

function describeLane(lane: PersonalOpsLane, includeParameters: boolean): Record<string, unknown> {
  return {
    id: lane.id,
    label: lane.label,
    status: lane.status,
    outcome: lane.outcome,
    current: lane.current,
    next: lane.next,
    userRoute: previewHarnessText(lane.userRoute, 96),
    modelRoute: previewHarnessText(lane.modelRoute, 96),
    signals: lane.signals,
    ...(lane.connectorSignals && lane.connectorSignals.length > 0 ? { connectorSignals: lane.connectorSignals.slice(0, includeParameters ? 8 : 3).map((signal) => describeConnectorSignal(signal, includeParameters)) } : {}),
    ...(lane.liveRecords && lane.liveRecords.length > 0 ? { liveRecords: lane.liveRecords.slice(0, includeParameters ? 8 : 3).map((record) => describeLiveRecord(record, includeParameters)) } : {}),
    ...(includeParameters ? {
      routes: {
        user: lane.userRoute,
        model: lane.modelRoute,
      },
      methodIds: lane.methodIds ?? [],
      safety: 'Writes, sends, schedules, and operator calls require explicit user request and confirmation through the owning tool.',
    } : {}),
  };
}

function localRecord(domain: 'note' | 'routine', item: ReturnType<typeof buildAgentWorkspaceRuntimeSnapshot>['localNotes'][number]): PersonalOpsLiveRecord {
  return {
    id: item.id,
    label: item.name,
    status: item.reviewState,
    summary: item.description,
    userRoute: domain === 'note' ? 'Agent Workspace -> Notes' : 'Agent Workspace -> Routines',
    modelRoute: `agent_local_registry domain:"${domain}" action:"get" id:"${item.id}"`,
    tags: item.tags,
  };
}

function routineReceiptRecord(receipt: ReturnType<typeof buildAgentWorkspaceRuntimeSnapshot>['latestRoutineScheduleReceipt']): PersonalOpsLiveRecord | null {
  if (!receipt) return null;
  return {
    id: receipt.id,
    label: receipt.scheduleName,
    status: receipt.status,
    summary: `${receipt.routineName} -> ${receipt.scheduleKind} ${receipt.scheduleValue}`,
    userRoute: 'Agent Workspace -> Personal Ops -> Routine schedule receipts',
    modelRoute: 'agent_harness mode:"autonomy_queue_item" queueItemId:"routine-schedule-promotions"',
  };
}

function channelRecords(snapshot: ReturnType<typeof buildAgentWorkspaceRuntimeSnapshot>): readonly PersonalOpsLiveRecord[] {
  return snapshot.channels.map((channel) => ({
    id: channel.id,
    label: channel.label,
    status: channel.setupState,
    summary: `${channel.delivery}; ${channel.riskLabel}. ${channel.nextStep}`,
    userRoute: 'Agent Workspace -> Channels',
    modelRoute: `agent_harness mode:"channel" channelId:"${channel.id}"`,
    tags: [channel.risk, channel.delivery],
  }));
}

function connectorRecords(signals: readonly PersonalOpsConnectorSignal[], laneLabel: string): readonly PersonalOpsLiveRecord[] {
  return signals.map((signal) => ({
    id: signal.id,
    label: `${laneLabel} connector: ${signal.label}`,
    status: signal.status,
    summary: signal.summary,
    userRoute: 'Agent Workspace -> Tools & MCP',
    modelRoute: signal.modelRoute,
    tags: ['connector', signal.kind],
  }));
}

function buildLanes(context: CommandContext): readonly PersonalOpsLane[] {
  const snapshot = buildAgentWorkspaceRuntimeSnapshot(context);
  const emailMethods = methodIdsMatching(['email', 'mail', 'imap', 'smtp']);
  const calendarMethods = methodIdsMatching(['calendar', 'caldav', 'agenda']);
  const emailConnectors = connectorSignalsMatching(context, ['email', 'mail', 'imap', 'smtp', 'gmail']);
  const calendarConnectors = connectorSignalsMatching(context, ['calendar', 'caldav', 'agenda']);
  const taskMethods = methodIdsMatching(['task', 'work-plan', 'workplan']);
  const scheduleMethods = methodIdsMatching(['schedule', 'reminder']);
  const readyChannels = snapshot.channels.filter((channel) => channel.ready).length;
  const enabledChannels = snapshot.channels.filter((channel) => channel.enabled).length;
  const configuredTargets = snapshot.channels.filter((channel) => channel.defaultTarget === 'configured').length;
  const scheduleReadyRoutines = snapshot.localRoutines.filter((routine) => (
    routine.enabled === true
    && routine.reviewState === 'reviewed'
    && (routine.missingRequirementCount ?? 0) === 0
  )).length;

  return [
    {
      id: 'inbox',
      label: 'Inbox',
      status: emailMethods.length > 0 || emailConnectors.length > 0 ? 'partial' : 'gap',
      outcome: 'Triage inbound email or message inboxes, summarize threads, draft replies, and send only after confirmation.',
      current: emailMethods.length > 0
        ? 'The daemon contract exposes email-like methods, but Agent still needs a dedicated inbox workflow.'
        : emailConnectors.length > 0
          ? 'A configured MCP connector looks email-capable, but Agent still needs a dedicated inbox workflow around its exact tools.'
        : 'No email/IMAP/SMTP methods are present in the current GoodVibes SDK operator contract.',
      next: emailMethods.length > 0
        ? 'Inspect the exact methods, then add a first-class inbox triage workflow around them.'
        : emailConnectors.length > 0
          ? 'Inspect the matching MCP connector and tool schemas, then route inbox triage only through reviewed connector actions.'
        : 'Install or build an email connector/MCP/plugin, then expose triage and draft-reply actions here.',
      userRoute: 'Agent Workspace -> Personal Ops -> Channels or connector setup',
      modelRoute: emailConnectors.length > 0 ? 'agent_harness mode:"mcp_servers" query:"email"' : 'agent_harness mode:"operator_methods" query:"email"',
      signals: [
        `${emailMethods.length} email-like daemon method(s)`,
        `${emailConnectors.length} email-like MCP connector(s)`,
        `${readyChannels}/${snapshot.channels.length} channel(s) ready for delivery`,
      ],
      methodIds: emailMethods,
      connectorSignals: emailConnectors,
      liveRecords: connectorRecords(emailConnectors, 'Inbox'),
    },
    {
      id: 'calendar',
      label: 'Calendar',
      status: calendarMethods.length > 0 || calendarConnectors.length > 0 ? 'partial' : 'gap',
      outcome: 'Read agenda context, identify conflicts, prepare briefings, and create reminders for calendar-driven work.',
      current: calendarMethods.length > 0
        ? 'The daemon contract exposes calendar-like methods, but Agent still needs an agenda workflow.'
        : calendarConnectors.length > 0
          ? 'A configured MCP connector looks calendar-capable, but Agent still needs a dedicated agenda workflow around its exact tools.'
        : 'No calendar/CalDAV/agenda methods are present in the current GoodVibes SDK operator contract.',
      next: calendarMethods.length > 0
        ? 'Inspect the exact methods, then add agenda briefing and conflict detection around them.'
        : calendarConnectors.length > 0
          ? 'Inspect the matching MCP connector and tool schemas, then route agenda work only through reviewed connector actions.'
        : 'Add a CalDAV/calendar connector and route agenda briefing, conflicts, and reminders through this lane.',
      userRoute: 'Agent Workspace -> Personal Ops -> Create reminder',
      modelRoute: calendarConnectors.length > 0 ? 'agent_harness mode:"mcp_servers" query:"calendar"' : 'agent_harness mode:"operator_methods" query:"calendar"',
      signals: [
        `${calendarMethods.length} calendar-like daemon method(s)`,
        `${calendarConnectors.length} calendar-like MCP connector(s)`,
        `${scheduleMethods.length} schedule/reminder method(s) available for follow-up`,
      ],
      methodIds: calendarMethods,
      connectorSignals: calendarConnectors,
      liveRecords: connectorRecords(calendarConnectors, 'Calendar'),
    },
    {
      id: 'notes',
      label: 'Notes',
      status: 'ready',
      outcome: 'Capture working context, source triage, decisions, and handoff notes without polluting durable memory.',
      current: `Agent-local notes are available: ${snapshot.localNoteCount} note(s), ${snapshot.localNoteReviewQueueCount} needing review.`,
      next: snapshot.localNoteCount > 0
        ? 'Review or promote selected notes into memory, skills, routines, or Agent Knowledge when useful.'
        : 'Create a note from the Personal Ops or Notes workspace when the next decision or source needs tracking.',
      userRoute: 'Agent Workspace -> Personal Ops -> Create note',
      modelRoute: 'agent_local_registry domain:"notes" action:"create"',
      signals: [
        `${snapshot.localNoteCount} local note(s)`,
        `${snapshot.localNoteReviewQueueCount} note(s) in review queue`,
      ],
      liveRecords: snapshot.localNotes.slice(0, 5).map((note) => localRecord('note', note)),
    },
    {
      id: 'tasks',
      label: 'Tasks',
      status: taskMethods.length > 0 ? 'ready' : 'partial',
      outcome: 'Track user-visible work items, inspect host task state, and update work plan status without hidden jobs.',
      current: `Agent has work-plan actions and ${taskMethods.length} task/work-plan daemon method(s) in the SDK contract.`,
      next: 'Use work plans for user-visible task tracking; inspect runtime host tasks separately before mutating anything.',
      userRoute: 'Agent Workspace -> Personal Ops -> Add work item',
      modelRoute: 'agent_work_plan action:"add"',
      signals: [
        `${taskMethods.length} task/work-plan daemon method(s)`,
        'Work plan add/show/status/delete actions are available',
      ],
      methodIds: taskMethods,
    },
    {
      id: 'reminders',
      label: 'Reminders',
      status: scheduleMethods.length > 0 ? 'ready' : 'partial',
      outcome: 'Turn a user request into a visible reminder or autonomous schedule with delivery target and cancellation path.',
      current: `Reminder and autonomous schedule creation are available through Agent tools; ${scheduleMethods.length} schedule/reminder daemon method(s) are discoverable.`,
      next: 'Create one confirmed reminder or autonomous schedule with title, time, scope, delivery target, success criteria, and explicit user request.',
      userRoute: 'Agent Workspace -> Personal Ops -> Create reminder',
      modelRoute: 'agent_reminder_schedule or agent_autonomy_schedule',
      signals: [
        `${scheduleMethods.length} schedule/reminder daemon method(s)`,
        `${configuredTargets} configured delivery target(s)`,
      ],
      methodIds: scheduleMethods,
    },
    {
      id: 'routines',
      label: 'Routines',
      status: scheduleReadyRoutines > 0 ? 'ready' : snapshot.localRoutineCount > 0 ? 'partial' : 'needs-setup',
      outcome: 'Reuse repeatable local workflows and promote reviewed routines to connected schedules only when useful.',
      current: `${snapshot.localRoutineCount} routine(s), ${snapshot.enabledRoutineCount} enabled, ${scheduleReadyRoutines} schedule-ready, ${snapshot.routineScheduleReceiptCount} promotion receipt(s).`,
      next: scheduleReadyRoutines > 0
        ? 'Promote a reviewed routine to a connected schedule when the user asks for recurrence.'
        : 'Create or review a routine, resolve setup gaps, then promote only with explicit schedule confirmation.',
      userRoute: 'Agent Workspace -> Personal Ops -> Routine library',
      modelRoute: 'agent_harness mode:"workspace_actions" categoryId:"routines"',
      signals: [
        `${scheduleReadyRoutines} schedule-ready routine(s)`,
        `${snapshot.failedRoutineScheduleReceiptCount} failed promotion receipt(s)`,
      ],
      liveRecords: [
        ...snapshot.localRoutines.slice(0, 5).map((routine) => localRecord('routine', routine)),
        ...[routineReceiptRecord(snapshot.latestRoutineScheduleReceipt)].filter((record): record is PersonalOpsLiveRecord => record !== null),
      ],
    },
    {
      id: 'delivery',
      label: 'Delivery',
      status: readyChannels > 0 ? 'ready' : enabledChannels > 0 ? 'needs-setup' : 'partial',
      outcome: 'Reach the user through configured channels and send messages or notifications only after explicit confirmation.',
      current: `${readyChannels}/${snapshot.channels.length} channel(s) ready, ${enabledChannels} enabled, ${configuredTargets} configured default target(s).`,
      next: readyChannels > 0
        ? 'Use confirmed channel send or notification tools when the user asks for delivery.'
        : 'Enable and configure one delivery channel so personal-ops reminders and summaries can reach the user.',
      userRoute: 'Agent Workspace -> Personal Ops -> Channels',
      modelRoute: 'agent_harness mode:"channels"',
      signals: [
        `${readyChannels} ready channel(s)`,
        `${configuredTargets} configured default target(s)`,
      ],
      liveRecords: channelRecords(snapshot),
    },
  ];
}

function nextActions(lanes: readonly PersonalOpsLane[]): readonly string[] {
  const urgent = lanes
    .filter((lane) => lane.status === 'gap' || lane.status === 'needs-setup')
    .map((lane) => `${lane.label}: ${lane.next}`);
  const partial = lanes
    .filter((lane) => lane.status === 'partial')
    .map((lane) => `${lane.label}: ${lane.next}`);
  return [...urgent, ...partial].slice(0, 5);
}

export function personalOpsCatalogStatus(context: CommandContext): Record<string, unknown> {
  const lanes = buildLanes(context);
  const counts = lanes.reduce<Record<PersonalOpsStatus, number>>((acc, lane) => {
    acc[lane.status] += 1;
    return acc;
  }, { ready: 0, partial: 0, 'needs-setup': 0, gap: 0 });
  return {
    modes: ['personal_ops', 'personal_ops_lane'],
    lanes: lanes.length,
    ...counts,
    bestReadyStatus: lanes.reduce((best, lane) => Math.max(best, laneStatusRank(lane.status)), 0),
  };
}

export function personalOpsSummary(context: CommandContext, args: AgentHarnessPersonalOpsArgs): Record<string, unknown> {
  const includeParameters = args.includeParameters === true;
  const lanes = buildLanes(context);
  return {
    lanes: lanes.map((lane) => describeLane(lane, includeParameters)),
    returned: lanes.length,
    total: lanes.length,
    policy: 'Personal Ops unifies inbox, agenda, notes, tasks, reminders, routines, and delivery. Lanes include live records when Agent owns them. Missing email/calendar connectors are reported as setup gaps, not faked.',
    nextActions: nextActions(lanes),
  };
}

export function describePersonalOpsLane(context: CommandContext, args: AgentHarnessPersonalOpsArgs): PersonalOpsLaneResolution {
  const laneId = readString(args.laneId);
  const target = readString(args.target);
  const query = readString(args.query);
  const input = laneId || target || query;
  if (!input) {
    return {
      status: 'missing_lookup',
      usage: `personal_ops_lane requires laneId, target, or query. Lane ids: ${LANE_IDS.join(', ')}.`,
    };
  }
  const normalized = input.toLowerCase();
  const lanes = buildLanes(context);
  const exact = lanes.find((lane) => lane.id === normalized);
  if (exact) return { status: 'found', lane: describeLane(exact, true) };
  const matches = lanes.filter((lane) => searchText(lane).includes(normalized));
  if (matches.length === 1) return { status: 'found', lane: describeLane(matches[0]!, true) };
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      input,
      candidates: matches.map((lane) => ({
        laneId: lane.id,
        label: lane.label,
        status: lane.status,
        modelRoute: lane.modelRoute,
      })),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown Personal Ops lane ${input}. Lane ids: ${LANE_IDS.join(', ')}.`,
  };
}
