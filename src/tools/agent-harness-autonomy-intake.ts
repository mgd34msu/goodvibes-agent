import type { CommandContext } from '../input/command-registry.ts';
import { previewHarnessText } from './agent-harness-text.ts';

interface AgentHarnessAutonomyIntakeArgs {
  readonly query?: unknown;
  readonly target?: unknown;
  readonly includeParameters?: unknown;
}

interface ScheduleDetection {
  readonly kind?: 'at' | 'every' | 'cron';
  readonly value?: string;
  readonly missing: readonly string[];
  readonly notes: readonly string[];
}

interface AutonomyRouteCandidate {
  readonly id: string;
  readonly label: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly why: string;
  readonly modelRoute: string;
  readonly inspectRoute: string;
  readonly requiresConfirmation: boolean;
  readonly missingFields?: readonly string[];
  readonly userQuestion?: string;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasAny(text: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

function normalizeInterval(amount: string, rawUnit: string): string {
  const unit = rawUnit.toLowerCase();
  if (unit === 'ms') return `${amount}ms`;
  if (unit === 's' || unit.startsWith('sec')) return `${amount}s`;
  if (unit === 'm' || unit === 'min' || unit.startsWith('minute')) return `${amount}m`;
  if (unit === 'h' || unit === 'hr' || unit.startsWith('hour')) return `${amount}h`;
  return `${amount}d`;
}

function detectSchedule(request: string): ScheduleDetection {
  const lower = request.toLowerCase();
  const iso = request.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?\b/);
  if (iso) return { kind: 'at', value: iso[0], missing: [], notes: ['Detected exact ISO timestamp.'] };

  const interval = lower.match(/\bevery\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?|m|min|minutes?|h|hr|hours?|d|days?)\b/);
  if (interval?.[1] && interval[2]) {
    return {
      kind: 'every',
      value: normalizeInterval(interval[1], interval[2]),
      missing: [],
      notes: ['Detected exact recurring interval.'],
    };
  }

  const compactEvery = lower.match(/\bevery\s+(\d+(?:\.\d+)?(?:ms|s|m|h|d))\b/);
  if (compactEvery?.[1]) {
    return { kind: 'every', value: compactEvery[1], missing: [], notes: ['Detected exact recurring interval.'] };
  }

  const cron = request.match(/\bcron[:\s]+(\S+\s+\S+\s+\S+\s+\S+\s+\S+(?:\s+\S+)?)/i);
  if (cron?.[1]) return { kind: 'cron', value: cron[1].trim(), missing: [], notes: ['Detected cron expression.'] };

  if (hasAny(lower, ['daily', 'every day', 'each day'])) {
    return {
      kind: 'cron',
      missing: ['scheduleValue', 'timezone'],
      notes: ['Daily intent detected; ask for an exact time/timezone or cron expression before creating anything.'],
    };
  }
  if (hasAny(lower, ['weekly', 'every week', 'each week'])) {
    return {
      kind: 'cron',
      missing: ['scheduleValue', 'timezone'],
      notes: ['Weekly intent detected; ask for day, time, and timezone or a cron expression before creating anything.'],
    };
  }
  if (hasAny(lower, ['monthly', 'every month', 'each month'])) {
    return {
      kind: 'cron',
      missing: ['scheduleValue', 'timezone'],
      notes: ['Monthly intent detected; ask for day, time, and timezone or a cron expression before creating anything.'],
    };
  }
  if (hasAny(lower, ['schedule', 'scheduled', 'recurring', 'repeat', 'remind', 'reminder', 'follow up', 'follow-up'])) {
    return {
      missing: ['scheduleKind', 'scheduleValue'],
      notes: ['Scheduling intent detected; ask for exact ISO time, interval, or cron expression.'],
    };
  }
  return { missing: [], notes: [] };
}

function reminderRoute(request: string, schedule: ScheduleDetection): string {
  const message = previewHarnessText(request, 72).replace(/"/g, "'");
  const kind = schedule.kind ?? 'at|every|cron';
  const value = schedule.value ?? '...';
  return `agent_reminder_schedule message:"${message}" scheduleKind:"${kind}" scheduleValue:"${value}" confirm:true explicitUserRequest:"..."`;
}

function autonomyScheduleRoute(request: string, schedule: ScheduleDetection): string {
  const task = previewHarnessText(request, 96).replace(/"/g, "'");
  const kind = schedule.kind ?? 'at|every|cron';
  const value = schedule.value ?? '...';
  return `agent_autonomy_schedule task:"${task}" successCriteria:"..." scheduleKind:"${kind}" scheduleValue:"${value}" confirm:true explicitUserRequest:"..."`;
}

function buildCandidates(request: string): readonly AutonomyRouteCandidate[] {
  const lower = request.toLowerCase();
  const schedule = detectSchedule(request);
  const candidates: AutonomyRouteCandidate[] = [];
  const scheduled = schedule.missing.length > 0 || schedule.kind !== undefined;
  const asksForReminder = hasAny(lower, ['remind', 'reminder', 'follow up', 'follow-up', 'ping me', 'notify me']);
  const asksForRoutine = hasAny(lower, ['routine', 'checklist', 'recurring task', 'daily review', 'weekly review']);
  const asksForResearch = hasAny(lower, ['research', 'investigate', 'market map', 'source', 'report']);
  const asksForAutonomousSchedule = scheduled && !asksForReminder && hasAny(lower, [
    'audit',
    'brief',
    'briefing',
    'check',
    'daily report',
    'weekly report',
    'digest',
    'monitor',
    'research',
    'review',
    'run',
    'scan',
    'summarize',
    'triage',
  ]);
  const asksForDelegation = hasAny(lower, ['build', 'fix', 'implement', 'refactor', 'code', 'test']) && hasAny(lower, ['background', 'subagent', 'delegate', 'parallel']);
  const asksForApproval = hasAny(lower, ['approval', 'approve', 'deny']);
  const asksForAutomationControl = hasAny(lower, ['cancel', 'retry', 'pause', 'resume', 'run now'])
    && hasAny(lower, ['automation', 'schedule', 'job', 'run']);
  const asksForUnsupportedConnector = hasAny(lower, ['email', 'calendar', 'gmail', 'imap', 'caldav']);

  if (asksForAutomationControl) {
    candidates.push({
      id: 'automation-control',
      label: 'Control an existing automation or schedule',
      confidence: 'high',
      why: 'The request is about run, cancel, retry, pause, resume, or run-now control for an existing job/run/schedule.',
      modelRoute: 'agent_harness mode:"autonomy_queue_item" queueItemId:"automation-runs"',
      inspectRoute: 'agent_harness mode:"autonomy_queue"',
      requiresConfirmation: true,
      missingFields: ['exact jobId, runId, or scheduleId from the queue record'],
      userQuestion: 'Which exact job, run, or schedule id should be controlled?',
    });
  }

  if (asksForApproval) {
    candidates.push({
      id: 'approval-decision',
      label: 'Review or decide a pending approval',
      confidence: 'high',
      why: 'The request mentions approval review or decision.',
      modelRoute: 'agent_harness mode:"autonomy_queue_item" queueItemId:"pending-approvals"',
      inspectRoute: 'agent_harness mode:"workspace_action" actionId:"approvals"',
      requiresConfirmation: true,
      missingFields: ['exact approvalId', 'approve, deny, or cancel decision'],
      userQuestion: 'Which approval id and decision should be applied?',
    });
  }

  if (asksForReminder || (scheduled && !asksForRoutine && !asksForResearch)) {
    candidates.push({
      id: 'one-reminder-or-simple-recurring-reminder',
      label: 'Create one confirmed reminder schedule',
      confidence: asksForReminder ? 'high' : 'medium',
      why: 'The request looks like a reminder, follow-up, notification, or simple scheduled message.',
      modelRoute: reminderRoute(request, schedule),
      inspectRoute: 'agent_harness mode:"autonomy_queue_item" queueItemId:"reminder-requests"',
      requiresConfirmation: true,
      missingFields: schedule.missing.length > 0 ? schedule.missing : undefined,
      userQuestion: schedule.missing.length > 0 ? 'What exact ISO time, interval, or cron expression should GoodVibes use?' : undefined,
    });
  }

  if (asksForAutonomousSchedule && !asksForRoutine) {
    const missingFields = [
      ...schedule.missing,
      'successCriteria',
    ];
    candidates.push({
      id: 'confirmed-autonomous-schedule',
      label: 'Create one confirmed autonomous Agent schedule',
      confidence: asksForResearch ? 'high' : 'medium',
      why: 'The request asks for recurring Agent work, not just a reminder notification.',
      modelRoute: autonomyScheduleRoute(request, schedule),
      inspectRoute: 'agent_harness mode:"autonomy_queue_item" queueItemId:"autonomous-schedule-requests"',
      requiresConfirmation: true,
      missingFields: missingFields.length > 0 ? missingFields : undefined,
      userQuestion: schedule.missing.length > 0
        ? 'What exact cadence and success criteria should this scheduled Agent work use?'
        : 'What should count as a successful scheduled run?',
    });
  }

  if (asksForRoutine) {
    candidates.push({
      id: 'reviewed-routine-schedule',
      label: 'Promote a reviewed Agent routine to a connected schedule',
      confidence: asksForRoutine ? 'high' : 'medium',
      why: 'The request sounds like recurring agent work rather than a simple reminder.',
      modelRoute: 'agent_harness mode:"workspace_actions" categoryId:"routines" query:"promote routine"',
      inspectRoute: 'agent_harness mode:"autonomy_queue_item" queueItemId:"routine-schedule-promotions"',
      requiresConfirmation: true,
      missingFields: ['routineId', ...schedule.missing],
      userQuestion: 'Which reviewed routine should run, and what exact cadence should it use?',
    });
  }

  if (asksForResearch && !scheduled) {
    candidates.push({
      id: 'visible-research-run',
      label: 'Start a visible research run',
      confidence: 'high',
      why: 'The request is research/report oriented and needs a visible ledger before long-running work.',
      modelRoute: 'agent_harness mode:"run_workspace_action" actionId:"research-start-run" confirm:true explicitUserRequest:"..."',
      inspectRoute: 'agent_harness mode:"research_runs"',
      requiresConfirmation: true,
      missingFields: ['research question', 'success criteria'],
      userQuestion: 'What exact research question and deliverable should be tracked?',
    });
  }

  if (asksForDelegation) {
    candidates.push({
      id: 'visible-delegation',
      label: 'Delegate isolated build/fix/review work',
      confidence: 'medium',
      why: 'The request asks for implementation work in the background, parallel, or delegated path.',
      modelRoute: 'agent_harness mode:"delegation_posture"',
      inspectRoute: 'agent_harness mode:"autonomy_queue_item" queueItemId:"delegated-subagents"',
      requiresConfirmation: true,
      missingFields: ['task scope', 'repo/worktree target', 'review expectation'],
      userQuestion: 'What exact implementation scope should be delegated, and what result should come back?',
    });
  }

  if (asksForUnsupportedConnector) {
    candidates.push({
      id: 'connector-setup-first',
      label: 'Set up missing email or calendar connector first',
      confidence: 'medium',
      why: 'The request depends on email/calendar capability, which must be configured before autonomous inbox or agenda work.',
      modelRoute: 'agent_harness mode:"personal_ops_lane" laneId:"inbox"',
      inspectRoute: 'agent_harness mode:"personal_ops"',
      requiresConfirmation: false,
      missingFields: ['configured connector or MCP/plugin route'],
      userQuestion: 'Which configured connector should GoodVibes use for this inbox or calendar work?',
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      id: 'inspect-visible-autonomy-first',
      label: 'Inspect visible autonomy queue before acting',
      confidence: 'low',
      why: 'The request does not clearly map to a safe autonomous work route yet.',
      modelRoute: 'agent_harness mode:"autonomy_queue"',
      inspectRoute: 'agent_harness mode:"autonomy_queue"',
      requiresConfirmation: false,
      missingFields: ['goal', 'owner', 'timing', 'success criteria'],
      userQuestion: 'What should run, when should it run, and how should success be reported?',
    });
  }

  return candidates;
}

export function autonomyIntakeSummary(_context: CommandContext, args: AgentHarnessAutonomyIntakeArgs): Record<string, unknown> {
  const request = readString(args.query) || readString(args.target);
  if (!request) {
    return {
      status: 'missing_request',
      usage: 'Use mode:"autonomy_intake" with query:"<ongoing work request>". This mode is read-only and returns the safest confirmed route.',
      examples: [
        'Remind me every 2h to check the deploy.',
        'Run the weekly operator report as a reviewed routine.',
        'Cancel the running automation job.',
      ],
      queueRoute: 'agent_harness mode:"autonomy_queue"',
    };
  }
  const candidates = buildCandidates(request);
  const preferred = candidates[0]!;
  return {
    status: 'ready',
    request: previewHarnessText(request, args.includeParameters === true ? 220 : 120),
    preferred,
    candidates: candidates.slice(0, args.includeParameters === true ? 8 : 4),
    queueRoute: 'agent_harness mode:"autonomy_queue"',
    policy: 'Autonomy intake is read-only. It selects visible routes and missing fields; creation, approval, run control, delegation, and delivery still require the returned confirmed route plus explicit user request.',
  };
}
