import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { CommandContext } from '../input/command-registry.ts';
import { previewHarnessText } from './agent-harness-text.ts';

interface AgentHarnessAgentOrchestrationArgs {
  readonly agentId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

type AgentLookupSource = 'agentId' | 'target' | 'query';
type AgentRecordView = Record<string, unknown>;

export type AgentOrchestrationResolution =
  | { readonly status: 'found'; readonly agent: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

const AGENT_TOOL_MODES = [
  'spawn',
  'batch-spawn',
  'list',
  'templates',
  'status',
  'get',
  'budget',
  'plan',
  'wait',
  'message',
  'cancel',
  'wrfc-chains',
  'wrfc-history',
  'cohort-status',
  'cohort-report',
] as const;

const AGENT_TEMPLATES = [
  'orchestrator',
  'engineer',
  'reviewer',
  'tester',
  'researcher',
  'integrator',
  'general',
] as const;

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function lookupFromArgs(args: AgentHarnessAgentOrchestrationArgs): { readonly source: AgentLookupSource; readonly input: string } | null {
  const agentId = readString(args.agentId);
  if (agentId) return { source: 'agentId', input: agentId };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

function exportAgents(context: CommandContext): readonly AgentRecordView[] | null {
  const agentManager = context.ops.agentManager;
  if (!agentManager) return null;
  try {
    return agentManager.exportState().map((record) => record as unknown as AgentRecordView);
  } catch {
    return [];
  }
}

function agentToolRegistered(toolRegistry: ToolRegistry): boolean {
  return toolRegistry.getToolDefinitions().some((tool) => tool.name === 'agent');
}

function agentId(record: AgentRecordView): string {
  return readString(record.id);
}

function agentStatus(record: AgentRecordView): string {
  return readString(record.status) || 'unknown';
}

function agentSearchText(record: AgentRecordView): string {
  return [
    record.id,
    record.task,
    record.template,
    record.status,
    record.progress,
    record.model,
    record.provider,
    Array.isArray(record.tools) ? record.tools.join('\n') : '',
    record.context,
  ].map((value) => typeof value === 'string' ? value : String(value ?? '')).join('\n').toLowerCase();
}

function statusCounts(records: readonly AgentRecordView[]): Record<string, number> {
  const counts: Record<string, number> = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    unknown: 0,
  };
  for (const record of records) {
    const status = agentStatus(record);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function routeForAgent(mode: string, id: string): string {
  return `agent { mode: "${mode}", agentId: "${id}" }`;
}

function describeAgent(record: AgentRecordView, includeParameters: boolean): Record<string, unknown> {
  const id = agentId(record);
  const task = readString(record.task);
  const progress = readString(record.progress);
  const context = readString(record.context);
  return {
    agentId: id,
    status: agentStatus(record),
    template: readString(record.template) || 'general',
    task: previewHarnessText(task, includeParameters ? 240 : 96),
    progress: progress ? previewHarnessText(progress, includeParameters ? 180 : 72) : null,
    toolCallCount: typeof record.toolCallCount === 'number' ? record.toolCallCount : 0,
    modelRoute: 'agent { mode: "get" }',
    userRoute: 'Agent Workspace -> Work -> Autonomy queue',
    routes: {
      inspect: routeForAgent('get', id),
      status: routeForAgent('status', id),
      budget: routeForAgent('budget', id),
      plan: routeForAgent('plan', id),
      wait: routeForAgent('wait', id),
      message: routeForAgent('message', id),
      cancel: routeForAgent('cancel', id),
    },
    ...(readString(record.model) ? { model: readString(record.model) } : {}),
    ...(readString(record.provider) ? { provider: readString(record.provider) } : {}),
    ...(includeParameters ? {
      tools: Array.isArray(record.tools) ? record.tools.filter((tool): tool is string => typeof tool === 'string') : [],
      context: context ? previewHarnessText(context, 500) : null,
      startedAt: typeof record.startedAt === 'number' ? record.startedAt : null,
      completedAt: typeof record.completedAt === 'number' ? record.completedAt : null,
      usage: record.usage && typeof record.usage === 'object' ? record.usage : null,
    } : {}),
  };
}

function decisionCards(agentToolAvailable: boolean): readonly Record<string, unknown>[] {
  return [
    {
      id: 'serial-by-default',
      label: 'Stay serial by default',
      status: 'ready',
      chooseWhen: ['Ordinary chat, planning, research, setup, local context, and short current-workspace tool work.'],
      route: 'main conversation',
      reason: 'Lowest-friction route for the user when parallelism does not improve outcome.',
    },
    {
      id: 'visible-single-agent',
      label: 'Spawn one visible agent',
      status: agentToolAvailable ? 'ready' : 'unavailable',
      chooseWhen: ['A bounded autonomous task can run independently with visible status and cancellation.'],
      requiredFields: ['task', 'successCriteria or requiredEvidence when outcome quality matters'],
      modelRoute: 'agent { mode: "spawn" }',
      inspectRoute: 'agent_harness mode:"agent_orchestration"',
    },
    {
      id: 'visible-batch-spawn',
      label: 'Batch-spawn independent agents',
      status: agentToolAvailable ? 'ready' : 'unavailable',
      chooseWhen: ['Tasks are genuinely independent and parallel work materially improves time-to-result.'],
      doNotUseWhen: ['Review/test/verification role fanout for one deliverable; that collapses to one owner chain.'],
      requiredFields: ['tasks[]', 'authoritativeTask for the original user ask when applicable'],
      modelRoute: 'agent { mode: "batch-spawn" }',
      inspectRoute: 'agent_harness mode:"agent_orchestration"',
    },
    {
      id: 'inspect-or-control-visible-agent',
      label: 'Inspect or control a visible agent',
      status: agentToolAvailable ? 'ready' : 'unavailable',
      chooseWhen: ['The user asks for progress, budget, plan, message, wait, cancel, WRFC chain, or cohort status.'],
      modelRoutes: ['agent { mode: "list" }', 'agent { mode: "get" }', 'agent { mode: "message" }', 'agent { mode: "wait" }', 'agent { mode: "cancel" }'],
    },
    {
      id: 'hidden-fanout-blocked',
      label: 'Block hidden fanout',
      status: 'blocked',
      chooseWhen: ['A request implies invisible background agents, unmanaged parallel coding workers, or orphaned jobs.'],
      saferRoutes: ['visible work plan', 'research run', 'confirmed schedule', 'agent { mode: "spawn" }', 'agent_harness mode:"delegation_posture"'],
    },
  ];
}

export function agentOrchestrationCatalogStatus(context: CommandContext, toolRegistry: ToolRegistry): Record<string, unknown> {
  const records = exportAgents(context);
  const counts = statusCounts(records ?? []);
  const toolRegistered = agentToolRegistered(toolRegistry);
  return {
    modes: ['agent_orchestration', 'agent_orchestration_agent'],
    status: !records ? 'unavailable' : counts.running > 0 || counts.pending > 0 ? 'attention' : toolRegistered ? 'ready' : 'needs-setup',
    toolRegistered,
    agents: records?.length ?? 0,
    running: counts.running,
    pending: counts.pending,
    failed: counts.failed,
    cancellable: (records ?? []).filter((record) => ['pending', 'running'].includes(agentStatus(record))).length,
    readOnly: true,
  };
}

export function agentOrchestrationSummary(context: CommandContext, toolRegistry: ToolRegistry, args: AgentHarnessAgentOrchestrationArgs): Record<string, unknown> {
  const records = exportAgents(context);
  const toolRegistered = agentToolRegistered(toolRegistry);
  if (!records) {
    return {
      status: 'unavailable',
      reason: 'Visible Agent orchestration requires an Agent manager in the runtime.',
      modes: ['agent_orchestration', 'agent_orchestration_agent'],
      toolRegistered,
      policy: 'Read-only orchestration posture. Actual spawn/message/wait/cancel remains on the first-class agent tool.',
    };
  }
  const counts = statusCounts(records);
  const query = readString(args.query).toLowerCase();
  const includeParameters = args.includeParameters === true;
  const filtered = records
    .filter((record) => !query || agentSearchText(record).includes(query))
    .slice(0, readLimit(args.limit, 100));
  return {
    status: counts.running > 0 || counts.pending > 0 ? 'attention' : toolRegistered ? 'ready' : 'needs-setup',
    summary: {
      agents: records.length,
      running: counts.running,
      pending: counts.pending,
      completed: counts.completed,
      failed: counts.failed,
      cancelled: counts.cancelled,
      cancellable: records.filter((record) => ['pending', 'running'].includes(agentStatus(record))).length,
      toolRegistered,
      serialDefault: true,
    },
    agents: filtered.map((record) => describeAgent(record, includeParameters)),
    returned: filtered.length,
    total: records.length,
    decisionCards: decisionCards(toolRegistered),
    modes: [...AGENT_TOOL_MODES],
    templates: [...AGENT_TEMPLATES],
    modelAccess: {
      list: 'agent { mode: "list" }',
      templates: 'agent { mode: "templates" }',
      spawn: 'agent { mode: "spawn" }',
      batchSpawn: 'agent { mode: "batch-spawn" }',
      inspect: 'agent { mode: "get" }',
      cancel: 'agent { mode: "cancel" }',
      harness: 'agent_harness mode:"agent_orchestration"',
    },
    policy: 'Read-only orchestration posture. Agent work must be visible, statused, cancellable, and tied to the user request; hidden fanout is blocked.',
  };
}

export function describeAgentOrchestrationAgent(context: CommandContext, args: AgentHarnessAgentOrchestrationArgs): AgentOrchestrationResolution {
  const lookup = lookupFromArgs(args);
  if (!lookup) {
    return {
      status: 'missing_lookup',
      usage: 'agent_orchestration_agent requires agentId, target, or query. Use mode:"agent_orchestration" to inspect visible agents.',
    };
  }
  const records = exportAgents(context);
  if (!records) {
    return {
      status: 'missing_lookup',
      usage: 'Visible Agent orchestration requires an Agent manager in the runtime.',
    };
  }
  const exact = records.find((record) => agentId(record) === lookup.input);
  if (exact) return { status: 'found', agent: describeAgent(exact, args.includeParameters !== false) };
  const normalized = lookup.input.toLowerCase();
  const matches = records.filter((record) => agentSearchText(record).includes(normalized));
  if (matches.length === 1) return { status: 'found', agent: describeAgent(matches[0]!, args.includeParameters !== false) };
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: matches.slice(0, 8).map((record) => describeAgent(record, false)),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown visible agent ${lookup.input}. Use mode:"agent_orchestration" to inspect visible agents.`,
  };
}
