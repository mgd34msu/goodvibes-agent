import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { CommandContext } from '../input/command-registry.ts';
import type { WorkPlanItem } from '../work-plans/work-plan-store.ts';
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
type ManagedPlanStatus = 'ready' | 'active' | 'attention' | 'needs-setup';

interface RemoteRuntimeSnapshot {
  readonly pools: readonly Record<string, unknown>[];
  readonly contracts: readonly Record<string, unknown>[];
  readonly artifacts: readonly Record<string, unknown>[];
}

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

function remoteContracts(context: CommandContext): readonly Record<string, unknown>[] {
  try {
    return context.ops.remoteRuntime?.listContracts().map((record) => record as unknown as Record<string, unknown>) ?? [];
  } catch {
    return [];
  }
}

function remotePools(context: CommandContext): readonly Record<string, unknown>[] {
  try {
    return context.ops.remoteRuntime?.listPools().map((record) => record as unknown as Record<string, unknown>) ?? [];
  } catch {
    return [];
  }
}

function remoteArtifacts(context: CommandContext): readonly Record<string, unknown>[] {
  try {
    return context.ops.remoteRuntime?.listArtifacts().map((record) => record as unknown as Record<string, unknown>) ?? [];
  } catch {
    return [];
  }
}

function remoteRuntimeSnapshot(context: CommandContext): RemoteRuntimeSnapshot {
  return {
    pools: remotePools(context),
    contracts: remoteContracts(context),
    artifacts: remoteArtifacts(context),
  };
}

function agentToolRegistered(toolRegistry: ToolRegistry): boolean {
  return toolRegistry.getToolDefinitions().some((tool) => tool.name === 'agent');
}

function remoteToolRegistered(toolRegistry: ToolRegistry): boolean {
  return toolRegistry.getToolDefinitions().some((tool) => tool.name === 'remote');
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

function remoteRunnerId(record: Record<string, unknown>): string {
  return readString(record.runnerId);
}

function transportState(contract: Record<string, unknown>): string {
  const transport = contract.transport;
  return transport && typeof transport === 'object' ? readString((transport as Record<string, unknown>).state) || 'unknown' : 'unknown';
}

function capabilityCeiling(contract: Record<string, unknown>): Record<string, unknown> {
  const ceiling = contract.capabilityCeiling;
  return ceiling && typeof ceiling === 'object' ? ceiling as Record<string, unknown> : {};
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function contractSummary(contract: Record<string, unknown>, includeParameters: boolean): Record<string, unknown> {
  const ceiling = capabilityCeiling(contract);
  return {
    id: readString(contract.id),
    runnerId: remoteRunnerId(contract),
    poolId: readString(contract.poolId) || null,
    label: previewHarnessText(readString(contract.label) || remoteRunnerId(contract), includeParameters ? 120 : 72),
    sourceTransport: readString(contract.sourceTransport) || 'unknown',
    trustClass: readString(contract.trustClass) || 'unknown',
    template: readString(contract.template) || 'general',
    transportState: transportState(contract),
    allowedTools: stringArray(ceiling.allowedTools).slice(0, includeParameters ? 20 : 8),
    capabilityCeilingTools: stringArray(ceiling.capabilityCeilingTools).slice(0, includeParameters ? 20 : 8),
    executionProtocol: readString(ceiling.executionProtocol) || 'unknown',
    reviewMode: readString(ceiling.reviewMode) || 'unknown',
    communicationLane: readString(ceiling.communicationLane) || 'unknown',
    orchestrationDepth: typeof ceiling.orchestrationDepth === 'number' ? ceiling.orchestrationDepth : null,
    requiredEvidence: stringArray(ceiling.requiredEvidence).slice(0, includeParameters ? 12 : 5),
    successCriteria: stringArray(ceiling.successCriteria).slice(0, includeParameters ? 12 : 5),
    writeScope: stringArray(ceiling.writeScope).slice(0, includeParameters ? 12 : 5),
  };
}

function artifactSummary(artifact: Record<string, unknown>, includeParameters: boolean): Record<string, unknown> {
  const task = artifact.task && typeof artifact.task === 'object' ? artifact.task as Record<string, unknown> : {};
  const evidence = artifact.evidence && typeof artifact.evidence === 'object' ? artifact.evidence as Record<string, unknown> : {};
  return {
    id: readString(artifact.id),
    runnerId: remoteRunnerId(artifact),
    status: readString(task.status) || 'unknown',
    task: previewHarnessText(readString(task.task), includeParameters ? 160 : 72),
    summary: previewHarnessText(readString(task.summary), includeParameters ? 220 : 96),
    toolCallCount: typeof evidence.toolCallCount === 'number' ? evidence.toolCallCount : 0,
    messageCount: typeof evidence.messageCount === 'number' ? evidence.messageCount : 0,
    errorCount: typeof evidence.errorCount === 'number' ? evidence.errorCount : 0,
    hasKnowledgeInjections: Boolean(evidence.hasKnowledgeInjections),
    modelRoute: `remote { mode: "review", artifactId: "${readString(artifact.id)}" }`,
  };
}

function agentRoutes(id: string): Record<string, string> {
  return {
    inspect: routeForAgent('get', id),
    status: routeForAgent('status', id),
    budget: routeForAgent('budget', id),
    plan: routeForAgent('plan', id),
    wait: routeForAgent('wait', id),
    message: routeForAgent('message', id),
    cancel: routeForAgent('cancel', id),
  };
}

function contractByRunnerId(contracts: readonly Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const entries: Array<readonly [string, Record<string, unknown>]> = [];
  for (const contract of contracts) {
    const id = remoteRunnerId(contract);
    if (id) entries.push([id, contract]);
  }
  return new Map(entries);
}

function artifactsByRunnerId(artifacts: readonly Record<string, unknown>[]): Map<string, readonly Record<string, unknown>[]> {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const artifact of artifacts) {
    const id = remoteRunnerId(artifact);
    if (!id) continue;
    const entries = grouped.get(id) ?? [];
    entries.push(artifact);
    grouped.set(id, entries);
  }
  return grouped;
}

function workPlanItems(context: CommandContext): readonly WorkPlanItem[] {
  try {
    return context.workspace.workPlanStore?.listItems() ?? [];
  } catch {
    return [];
  }
}

function workPlanItemsByAgentId(items: readonly WorkPlanItem[]): Map<string, readonly WorkPlanItem[]> {
  const grouped = new Map<string, WorkPlanItem[]>();
  for (const item of items) {
    const id = item.linked?.agentId;
    if (!id) continue;
    const entries = grouped.get(id) ?? [];
    entries.push(item);
    grouped.set(id, entries);
  }
  return grouped;
}

function dispatchReceiptLines(item: WorkPlanItem): readonly string[] {
  return readString(item.notes)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('Agent dispatch receipt'));
}

function workPlanCloseoutItem(item: WorkPlanItem, includeParameters: boolean): Record<string, unknown> {
  const receipts = dispatchReceiptLines(item);
  return {
    itemId: item.id,
    title: previewHarnessText(item.title, includeParameters ? 160 : 72),
    status: item.status,
    owner: item.owner ?? null,
    source: item.source ?? null,
    dispatchReceiptCount: receipts.length,
    latestDispatchReceipt: receipts.at(-1) ? previewHarnessText(receipts.at(-1)!, includeParameters ? 260 : 120) : null,
    routes: {
      inspect: `agent_work_plan action:"get" id:"${item.id}"`,
      markDone: `agent_work_plan action:"set_status" id:"${item.id}" status:"done"`,
      markBlocked: `agent_work_plan action:"set_status" id:"${item.id}" status:"blocked"`,
    },
  };
}

function closeoutReviewRoutes(id: string, items: readonly WorkPlanItem[], artifacts: readonly Record<string, unknown>[]): readonly string[] {
  return [
    routeForAgent('get', id),
    ...items.map((item) => `agent_work_plan action:"get" id:"${item.id}"`),
    ...artifacts.map((artifact) => `remote { mode: "review", artifactId: "${readString(artifact.id)}" }`),
  ];
}

function closeoutStatus(status: string, items: readonly WorkPlanItem[], artifacts: readonly Record<string, unknown>[]): string {
  if (['pending', 'running'].includes(status)) return 'pending-work';
  if (status === 'failed') return 'attention';
  if (items.some((item) => item.status === 'blocked' || item.status === 'failed')) return 'attention';
  if (artifacts.length > 0) return 'evidence-ready';
  if (items.length > 0) return 'needs-artifact-evidence';
  return 'unlinked';
}

function closeoutCard(
  id: string,
  status: string,
  items: readonly WorkPlanItem[],
  artifacts: readonly Record<string, unknown>[],
  includeParameters: boolean,
): Record<string, unknown> {
  return {
    status: closeoutStatus(status, items, artifacts),
    workPlanItemCount: items.length,
    dispatchReceiptCount: items.reduce((count, item) => count + dispatchReceiptLines(item).length, 0),
    remoteArtifactCount: artifacts.length,
    autoAttachReason: artifacts.length > 0 ? 'remote artifact runnerId matched the visible agent id' : null,
    workPlanItems: items.slice(0, includeParameters ? 8 : 3).map((item) => workPlanCloseoutItem(item, includeParameters)),
    autoAttachedRemoteArtifacts: artifacts.slice(0, includeParameters ? 8 : 3).map((artifact) => artifactSummary(artifact, includeParameters)),
    reviewRoutes: closeoutReviewRoutes(id, items, artifacts).slice(0, includeParameters ? 20 : 8),
    updateRoutes: items.slice(0, includeParameters ? 8 : 3).flatMap((item) => [
      `agent_work_plan action:"set_status" id:"${item.id}" status:"done"`,
      `agent_work_plan action:"set_status" id:"${item.id}" status:"blocked"`,
    ]),
    policy: 'Closeout is read-only here; status changes stay on agent_work_plan and artifact review stays on first-class routes.',
  };
}

function managedPlanItem(
  record: AgentRecordView,
  contract: Record<string, unknown> | undefined,
  artifacts: readonly Record<string, unknown>[],
  linkedWorkItems: readonly WorkPlanItem[],
  includeParameters: boolean,
): Record<string, unknown> {
  const id = agentId(record);
  const status = agentStatus(record);
  const task = readString(record.task);
  const progress = readString(record.progress);
  const hasRemoteContract = Boolean(contract);
  const running = ['pending', 'running'].includes(status);
  const failed = status === 'failed';
  return {
    planItemId: `agent:${id}`,
    agentId: id,
    lane: hasRemoteContract ? 'remote-runner' : 'visible-agent',
    milestoneId: running ? 'visible-agent-work' : 'review-and-closeout',
    status,
    title: previewHarnessText(task || id, includeParameters ? 160 : 72),
    progress: progress ? previewHarnessText(progress, includeParameters ? 180 : 72) : null,
    template: readString(record.template) || 'general',
    toolCallCount: typeof record.toolCallCount === 'number' ? record.toolCallCount : 0,
    routes: agentRoutes(id),
    workPlanLinks: linkedWorkItems.slice(0, includeParameters ? 8 : 3).map((item) => workPlanCloseoutItem(item, includeParameters)),
    remoteContract: contract ? contractSummary(contract, includeParameters) : null,
    artifactTrail: artifacts.slice(0, includeParameters ? 8 : 3).map((artifact) => artifactSummary(artifact, includeParameters)),
    closeout: closeoutCard(id, status, linkedWorkItems, artifacts, includeParameters),
    reviewGate: {
      status: artifacts.length > 0 ? 'artifact-ready' : running ? 'pending-work' : linkedWorkItems.length > 0 ? 'needs-artifact-evidence' : 'needs-link',
      requiredEvidence: contract ? stringArray(capabilityCeiling(contract).requiredEvidence).slice(0, includeParameters ? 12 : 5) : [],
      modelRoutes: closeoutReviewRoutes(id, linkedWorkItems, artifacts).slice(0, includeParameters ? 20 : 8),
    },
    nextAction: failed
      ? 'Inspect the failed agent, then decide whether to message, retry through a new visible task, or cancel related work.'
      : running
        ? 'Use wait/status for progress, message for guidance, or cancel if the work no longer helps the user.'
        : artifacts.length > 0
          ? 'Review the artifact trail before closing the plan.'
          : 'Capture or attach outcome evidence before treating this work as complete.',
  };
}

function managedPlanStatus(records: readonly AgentRecordView[], agentToolAvailable: boolean): ManagedPlanStatus {
  if (records.some((record) => agentStatus(record) === 'failed')) return 'attention';
  if (records.some((record) => ['pending', 'running'].includes(agentStatus(record)))) return 'active';
  if (records.length > 0 || agentToolAvailable) return 'ready';
  return 'needs-setup';
}

function managedExecutionPlan(
  records: readonly AgentRecordView[],
  context: CommandContext,
  toolRegistry: ToolRegistry,
  remoteSnapshot: RemoteRuntimeSnapshot,
  includeParameters: boolean,
): Record<string, unknown> {
  const agentToolAvailable = agentToolRegistered(toolRegistry);
  const remoteToolAvailable = remoteToolRegistered(toolRegistry);
  const { pools, contracts, artifacts } = remoteSnapshot;
  const contractsByRunner = contractByRunnerId(contracts);
  const artifactsByRunner = artifactsByRunnerId(artifacts);
  const workPlanByAgent = workPlanItemsByAgentId(workPlanItems(context));
  const items = records.map((record) => {
    const id = agentId(record);
    return managedPlanItem(record, contractsByRunner.get(id), artifactsByRunner.get(id) ?? [], workPlanByAgent.get(id) ?? [], includeParameters);
  });
  const status = managedPlanStatus(records, agentToolAvailable);
  const running = records.filter((record) => ['pending', 'running'].includes(agentStatus(record))).length;
  const failed = records.filter((record) => agentStatus(record) === 'failed').length;
  const completed = records.filter((record) => agentStatus(record) === 'completed').length;
  const remoteStatus = contracts.length > 0 || artifacts.length > 0 ? 'ready' : context.ops.remoteRuntime ? 'ready' : 'needs-setup';
  const linkedWorkPlanItemCount = Array.from(workPlanByAgent.values()).reduce((count, entries) => count + entries.length, 0);
  const dispatchReceiptCount = Array.from(workPlanByAgent.values()).reduce(
    (count, entries) => count + entries.reduce((entryCount, item) => entryCount + dispatchReceiptLines(item).length, 0),
    0,
  );
  return {
    planId: 'visible-managed-execution',
    status,
    summary: `${records.length} visible agent${records.length === 1 ? '' : 's'}, ${running} active, ${failed} attention, ${artifacts.length} remote artifact${artifacts.length === 1 ? '' : 's'}, ${dispatchReceiptCount} dispatch receipt${dispatchReceiptCount === 1 ? '' : 's'}.`,
    milestones: [
      {
        id: 'intake-and-lane-selection',
        label: 'Intake and lane selection',
        status: 'ready',
        purpose: 'Choose serial chat, one visible agent, batch agents, delegated review, or remote inspection based on user outcome.',
        routes: ['delegation action:"status"', 'agent_harness mode:"execution_posture"', 'agent_harness mode:"agent_orchestration"', 'agent_work_plan action:"dispatch_agents" ids:["..."] confirm:true explicitUserRequest:"..."'],
      },
      {
        id: 'visible-agent-work',
        label: 'Visible agent work',
        status: running > 0 ? 'active' : failed > 0 ? 'attention' : agentToolAvailable ? 'ready' : 'needs-setup',
        count: records.length,
        active: running,
        completed,
        failed,
        cancellableRoutes: records.filter((record) => ['pending', 'running'].includes(agentStatus(record))).map((record) => routeForAgent('cancel', agentId(record))).slice(0, 12),
      },
      {
        id: 'remote-runner-evidence',
        label: 'Remote runner evidence',
        status: remoteStatus,
        pools: pools.length,
        contracts: contracts.length,
        artifacts: artifacts.length,
        routes: {
          pools: remoteToolAvailable ? 'remote { mode: "pools", view: "summary" }' : 'delegation action:"route" delegationRouteId:"remote-runner-inspection"',
          contracts: remoteToolAvailable ? 'remote { mode: "contracts", view: "summary" }' : 'delegation action:"route" delegationRouteId:"remote-runner-inspection"',
          artifacts: remoteToolAvailable ? 'remote { mode: "artifacts", view: "summary" }' : 'delegation action:"route" delegationRouteId:"remote-runner-inspection"',
        },
      },
      {
        id: 'review-and-closeout',
        label: 'Review and closeout',
        status: failed > 0 ? 'attention' : running > 0 ? 'active' : records.length > 0 ? 'ready' : 'needs-setup',
        linkedWorkPlanItems: linkedWorkPlanItemCount,
        dispatchReceipts: dispatchReceiptCount,
        autoAttachedRemoteArtifacts: artifacts.length,
        requiredEvidence: ['changed files or artifact', 'test or verification output', 'agent status', 'recovery route when writes happened'],
        routes: ['agent_harness mode:"agent_orchestration"', 'agent_harness mode:"execution_history"', 'agent_harness mode:"file_recovery"', 'delegation action:"status"', 'agent_work_plan action:"list"'],
      },
    ],
    workItems: items,
    remoteEvidence: {
      status: remoteStatus,
      pools: pools.slice(0, includeParameters ? 8 : 3).map((pool) => ({
        id: readString(pool.id),
        label: readString(pool.label) || readString(pool.id),
        runnerIds: stringArray(pool.runnerIds).slice(0, includeParameters ? 12 : 5),
      })),
      contracts: contracts.slice(0, includeParameters ? 8 : 3).map((contract) => contractSummary(contract, includeParameters)),
      artifacts: artifacts.slice(0, includeParameters ? 8 : 3).map((artifact) => artifactSummary(artifact, includeParameters)),
      policy: 'Remote runner evidence is read-only here; creating pools, assigning runners, importing artifacts, or spawning agents stays on confirmed first-class routes.',
    },
    modelAccess: {
      spawn: 'agent { mode: "spawn" }',
      batchSpawn: 'agent { mode: "batch-spawn" }',
      listAgents: 'agent { mode: "list" }',
      remoteContracts: remoteToolAvailable ? 'remote { mode: "contracts", view: "summary" }' : 'delegation action:"route" delegationRouteId:"remote-runner-inspection"',
      remoteArtifacts: remoteToolAvailable ? 'remote { mode: "artifacts", view: "summary" }' : 'delegation action:"route" delegationRouteId:"remote-runner-inspection"',
    },
    policy: 'Managed execution plans are read-only summaries. Parallel work must remain visible, cancellable, attached to evidence, and justified by user outcome.',
  };
}

function describeAgent(
  record: AgentRecordView,
  includeParameters: boolean,
  contract?: Record<string, unknown>,
  artifacts: readonly Record<string, unknown>[] = [],
  linkedWorkItems: readonly WorkPlanItem[] = [],
): Record<string, unknown> {
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
    routes: agentRoutes(id),
    managedPlanCard: managedPlanItem(record, contract, artifacts, linkedWorkItems, includeParameters),
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
      id: 'managed-multi-runner-plan',
      label: 'Use a managed multi-runner plan',
      status: agentToolAvailable ? 'ready' : 'unavailable',
      chooseWhen: ['A large task already has approval for parallel work and needs milestones, evidence, and cancellation routes.'],
      requiredFields: ['original user ask', 'lane reason', 'success criteria', 'per-runner evidence', 'cancel/recovery route'],
      modelRoute: 'agent_work_plan action:"dispatch_agents" ids:["..."] confirm:true explicitUserRequest:"..."',
      inspectRoute: 'agent_harness mode:"agent_orchestration"',
      policy: 'Read-only plan surface first; approved work-plan dispatch, spawn, message, wait, cancel, or remote mutation stays on confirmed first-class routes.',
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
      saferRoutes: ['visible work plan', 'research run', 'confirmed schedule', 'agent { mode: "spawn" }', 'delegation action:"status"'],
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
  const remoteSnapshot = remoteRuntimeSnapshot(context);
  const contracts = contractByRunnerId(remoteSnapshot.contracts);
  const artifacts = artifactsByRunnerId(remoteSnapshot.artifacts);
  const workPlanByAgent = workPlanItemsByAgentId(workPlanItems(context));
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
      managedPlanStatus: managedPlanStatus(records, toolRegistered),
    },
    managedExecutionPlan: managedExecutionPlan(records, context, toolRegistry, remoteSnapshot, includeParameters),
    agents: filtered.map((record) => {
      const id = agentId(record);
      return describeAgent(record, includeParameters, contracts.get(id), artifacts.get(id) ?? [], workPlanByAgent.get(id) ?? []);
    }),
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
  const remoteSnapshot = remoteRuntimeSnapshot(context);
  const contracts = contractByRunnerId(remoteSnapshot.contracts);
  const artifacts = artifactsByRunnerId(remoteSnapshot.artifacts);
  const workPlanByAgent = workPlanItemsByAgentId(workPlanItems(context));
  if (exact) {
    const id = agentId(exact);
    return { status: 'found', agent: describeAgent(exact, args.includeParameters !== false, contracts.get(id), artifacts.get(id) ?? [], workPlanByAgent.get(id) ?? []) };
  }
  const normalized = lookup.input.toLowerCase();
  const matches = records.filter((record) => agentSearchText(record).includes(normalized));
  if (matches.length === 1) {
    const record = matches[0]!;
    const id = agentId(record);
    return { status: 'found', agent: describeAgent(record, args.includeParameters !== false, contracts.get(id), artifacts.get(id) ?? [], workPlanByAgent.get(id) ?? []) };
  }
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: matches.slice(0, 8).map((record) => {
        const id = agentId(record);
        return describeAgent(record, false, contracts.get(id), artifacts.get(id) ?? [], workPlanByAgent.get(id) ?? []);
      }),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown visible agent ${lookup.input}. Use mode:"agent_orchestration" to inspect visible agents.`,
  };
}
