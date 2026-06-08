import type { CommandContext } from '../input/command-registry.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from '../input/agent-workspace-snapshot.ts';
import { calendarWorkflows, connectorSignalsMatching, inboxWorkflows, methodIdsMatching, reminderWorkflows, taskWorkflows } from './agent-harness-personal-ops-discovery.ts';
import { channelRecords, connectorRecords, localRecord, refreshableSavedRecordCount, reminderOperationRecords, routineReceiptRecord, savedReviewArtifactRecords, savedReviewQueueRecords, taskOperationRecords } from './agent-harness-personal-ops-records.ts';
import type { McpToolRecord, McpToolSchema, PersonalOpsLane, PersonalOpsLiveRecord } from './agent-harness-personal-ops-types.ts';

export function buildLanes(
  context: CommandContext,
  options: {
    readonly toolsByServer?: ReadonlyMap<string, readonly McpToolRecord[]>;
    readonly schemasByQualifiedName?: ReadonlyMap<string, McpToolSchema>;
  } = {},
): readonly PersonalOpsLane[] {
  const snapshot = buildAgentWorkspaceRuntimeSnapshot(context);
  const emailMethods = methodIdsMatching(['email', 'mail', 'imap', 'smtp']);
  const calendarMethods = methodIdsMatching(['calendar', 'caldav', 'agenda']);
  const toolsByName = options.toolsByServer ?? new Map<string, readonly McpToolRecord[]>();
  const schemasByQualifiedName = options.schemasByQualifiedName ?? new Map<string, McpToolSchema>();
  const emailConnectors = connectorSignalsMatching(context, ['email', 'mail', 'imap', 'smtp', 'gmail'], { lane: 'inbox', toolsByServer: toolsByName, schemasByQualifiedName });
  const calendarConnectors = connectorSignalsMatching(context, ['calendar', 'caldav', 'agenda'], { lane: 'calendar', toolsByServer: toolsByName, schemasByQualifiedName });
  const inboxArtifactRecords = savedReviewArtifactRecords(context, 'inbox', emailConnectors);
  const calendarArtifactRecords = savedReviewArtifactRecords(context, 'calendar', calendarConnectors);
  const inboxReviewQueueRecords = savedReviewQueueRecords(context, 'inbox', emailConnectors);
  const calendarReviewQueueRecords = savedReviewQueueRecords(context, 'calendar', calendarConnectors);
  const refreshableInboxQueueRecords = refreshableSavedRecordCount(inboxReviewQueueRecords);
  const refreshableCalendarQueueRecords = refreshableSavedRecordCount(calendarReviewQueueRecords);
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
      status: emailMethods.length > 0 || emailConnectors.length > 0 || inboxArtifactRecords.length > 0 ? 'partial' : 'gap',
      outcome: 'Triage inbound email or message inboxes, summarize threads, draft replies, and send only after confirmation.',
      current: emailMethods.length > 0
        ? 'The daemon contract exposes email-like methods; Personal Ops workflow cards now guide inbox triage and draft boundaries around exact methods.'
        : emailConnectors.length > 0
          ? 'A configured MCP connector looks email-capable; Personal Ops workflow cards now guide inbox triage, schema-derived operation records, and draft boundaries around its exact tools.'
          : inboxArtifactRecords.length > 0
            ? 'Saved inbox review artifacts and thread queue items are available for recap, local draft review, or promotion; no fresh email connector is currently ready.'
        : 'No email/IMAP/SMTP methods are present in the current GoodVibes SDK operator contract.',
      next: emailMethods.length > 0
        ? 'Use the inbox workflow cards to inspect exact methods, read selected threads, summarize priorities, and keep send as a separate confirmation.'
        : emailConnectors.length > 0
          ? 'Use the inbox workflow cards and operation records to inspect matching MCP connector schemas, then route triage only through reviewed connector actions.'
          : inboxArtifactRecords.length > 0
            ? 'Use saved thread queue records for local draft review or recap, then repair an email connector before reading fresh inbox data or sending.'
        : 'Install or build an email connector/MCP/plugin, then expose triage and draft-reply actions here.',
      userRoute: 'Agent Workspace -> Personal Ops -> Channels or connector setup',
      modelRoute: emailConnectors.length > 0 ? 'agent_harness mode:"mcp_servers" query:"email"' : 'host action:"methods" query:"email"',
      signals: [
        `${emailMethods.length} email-like daemon method(s)`,
        `${emailConnectors.length} email-like MCP connector(s)`,
        `${inboxArtifactRecords.length} saved inbox review artifact(s)`,
        `${inboxReviewQueueRecords.length} saved inbox thread queue item(s)`,
        `${refreshableInboxQueueRecords} refreshable saved inbox queue item(s)`,
        `${readyChannels}/${snapshot.channels.length} channel(s) ready for delivery`,
      ],
      methodIds: emailMethods,
      connectorSignals: emailConnectors,
      workflows: inboxWorkflows(emailMethods, emailConnectors),
      liveRecords: [
        ...inboxReviewQueueRecords,
        ...inboxArtifactRecords,
        ...connectorRecords(emailConnectors, 'Inbox', 'inbox'),
      ],
    },
    {
      id: 'calendar',
      label: 'Calendar',
      status: calendarMethods.length > 0 || calendarConnectors.length > 0 || calendarArtifactRecords.length > 0 ? 'partial' : 'gap',
      outcome: 'Read agenda context, identify conflicts, prepare briefings, and create reminders for calendar-driven work.',
      current: calendarMethods.length > 0
        ? 'The daemon contract exposes calendar-like methods; Personal Ops workflow cards now guide agenda briefing and conflict-scan boundaries.'
        : calendarConnectors.length > 0
          ? 'A configured MCP connector looks calendar-capable; Personal Ops workflow cards now guide agenda briefing, schema-derived operation records, and conflict-scan boundaries around its exact tools.'
          : calendarArtifactRecords.length > 0
            ? 'Saved calendar review artifacts and event queue items are available for agenda recap, reminder creation, or follow-up planning; no fresh calendar connector is currently ready.'
        : 'No calendar/CalDAV/agenda methods are present in the current GoodVibes SDK operator contract.',
      next: calendarMethods.length > 0
        ? 'Use the calendar workflow cards to inspect exact methods, fetch a bounded agenda window, and propose reminders or follow-ups.'
        : calendarConnectors.length > 0
          ? 'Use the calendar workflow cards and operation records to inspect matching MCP connector schemas, then route agenda work only through reviewed connector actions.'
          : calendarArtifactRecords.length > 0
            ? 'Use saved event queue records for recap or reminder creation, then repair a calendar connector before reading fresh agenda data or editing events.'
        : 'Add a CalDAV/calendar connector and route agenda briefing, conflicts, and reminders through this lane.',
      userRoute: 'Agent Workspace -> Personal Ops -> Create reminder',
      modelRoute: calendarConnectors.length > 0 ? 'agent_harness mode:"mcp_servers" query:"calendar"' : 'host action:"methods" query:"calendar"',
      signals: [
        `${calendarMethods.length} calendar-like daemon method(s)`,
        `${calendarConnectors.length} calendar-like MCP connector(s)`,
        `${calendarArtifactRecords.length} saved calendar review artifact(s)`,
        `${calendarReviewQueueRecords.length} saved calendar event queue item(s)`,
        `${refreshableCalendarQueueRecords} refreshable saved calendar queue item(s)`,
        `${scheduleMethods.length} schedule/reminder method(s) available for follow-up`,
      ],
      methodIds: calendarMethods,
      connectorSignals: calendarConnectors,
      workflows: calendarWorkflows(calendarMethods, calendarConnectors),
      liveRecords: [
        ...calendarReviewQueueRecords,
        ...calendarArtifactRecords,
        ...connectorRecords(calendarConnectors, 'Calendar', 'calendar'),
      ],
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
      modelRoute: 'agent_work_plan action:"create"',
      signals: [
        `${taskMethods.length} task/work-plan daemon method(s)`,
        'Work plan add/show/status/delete actions are available',
      ],
      methodIds: taskMethods,
      workflows: taskWorkflows(taskMethods),
      liveRecords: taskOperationRecords(taskMethods),
    },
    {
      id: 'reminders',
      label: 'Reminders',
      status: scheduleMethods.length > 0 ? 'ready' : 'partial',
      outcome: 'Turn a user request into a visible reminder or autonomous schedule with delivery target and cancellation path.',
      current: `Reminder and autonomous schedule creation are available through Agent tools; ${scheduleMethods.length} schedule/reminder daemon method(s) are discoverable.`,
      next: 'Create one confirmed reminder or autonomous schedule with title, time, scope, delivery target, success criteria, and explicit user request.',
      userRoute: 'Agent Workspace -> Personal Ops -> Create reminder',
      modelRoute: 'schedule action:"remind|create"',
      signals: [
        `${scheduleMethods.length} schedule/reminder daemon method(s)`,
        `${configuredTargets} configured delivery target(s)`,
      ],
      methodIds: scheduleMethods,
      workflows: reminderWorkflows(scheduleMethods, configuredTargets > 0 || readyChannels > 0),
      liveRecords: reminderOperationRecords(scheduleMethods, configuredTargets > 0 || readyChannels > 0),
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
      modelRoute: 'workspace action:"actions" categoryId:"routines"',
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
      modelRoute: 'channels action:"status"',
      signals: [
        `${readyChannels} ready channel(s)`,
        `${configuredTargets} configured default target(s)`,
      ],
      liveRecords: channelRecords(snapshot),
    },
  ];
}
