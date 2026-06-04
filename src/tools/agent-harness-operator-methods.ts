import { AGENT_KNOWLEDGE_METHODS } from '../cli/agent-knowledge-methods.ts';
import { OPERATOR_ACTIONS } from '../agent/operator-actions.ts';

export interface AgentHarnessOperatorMethodArgs {
  readonly methodId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

type OperatorMethodEffect =
  | 'read-only-network'
  | 'confirmed-connected-host-state'
  | 'confirmed-agent-knowledge-write';

type OperatorMethodLookupSource = 'methodId' | 'target' | 'query';

interface OperatorMethodDescriptor {
  readonly id: string;
  readonly label: string;
  readonly route: string;
  readonly effect: OperatorMethodEffect;
  readonly owner: 'connected-host';
  readonly preferredModelTool: string;
  readonly confirmation: string;
  readonly boundary: string;
  readonly parameters?: readonly Record<string, unknown>[];
}

type OperatorMethodResolution =
  | { readonly status: 'found'; readonly method: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

const OPERATOR_BRIEFING_METHODS: readonly OperatorMethodDescriptor[] = [
  {
    id: 'projectPlanning.workPlan.snapshot',
    label: 'Read work-plan snapshot.',
    route: '/api/projects/planning/work-plan',
    effect: 'read-only-network',
    owner: 'connected-host',
    preferredModelTool: 'agent_operator_briefing',
    confirmation: 'Read-only; use the owning first-class tool.',
    boundary: 'Public operator read route only; no work-plan mutation or hidden task creation.',
  },
  {
    id: 'approvals.list',
    label: 'List approval posture.',
    route: '/api/approvals',
    effect: 'read-only-network',
    owner: 'connected-host',
    preferredModelTool: 'agent_operator_briefing',
    confirmation: 'Read-only; use the owning first-class tool.',
    boundary: 'Public operator read route only; approval mutations must use explicit allowlisted actions.',
  },
  {
    id: 'automation.integration.snapshot',
    label: 'Read automation posture.',
    route: '/api/automation',
    effect: 'read-only-network',
    owner: 'connected-host',
    preferredModelTool: 'agent_operator_briefing',
    confirmation: 'Read-only; use the owning first-class tool.',
    boundary: 'Public operator read route only; automation definition creation and lifecycle ownership stay blocked.',
  },
  {
    id: 'schedules.list',
    label: 'List connected schedules.',
    route: '/api/automation/schedules',
    effect: 'read-only-network',
    owner: 'connected-host',
    preferredModelTool: 'agent_operator_briefing',
    confirmation: 'Read-only; use the owning first-class tool.',
    boundary: 'Public operator read route only; schedule creation/run requires explicit user intent through allowed tools.',
  },
  {
    id: 'scheduler.capacity',
    label: 'Read scheduler capacity.',
    route: '/api/runtime/scheduler',
    effect: 'read-only-network',
    owner: 'connected-host',
    preferredModelTool: 'agent_operator_briefing',
    confirmation: 'Read-only; use the owning first-class tool.',
    boundary: 'Public operator read route only; no local scheduler or host lifecycle mutation.',
  },
];

const AGENT_KNOWLEDGE_READ_KEYS = new Set([
  'status',
  'ask',
  'search',
  'sourcesList',
  'nodesList',
  'issuesList',
  'itemGet',
  'map',
  'connectorsList',
  'connectorGet',
  'connectorDoctor',
]);

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function agentKnowledgeMethods(): readonly OperatorMethodDescriptor[] {
  return Object.entries(AGENT_KNOWLEDGE_METHODS).map(([key, method]) => {
    const readOnly = AGENT_KNOWLEDGE_READ_KEYS.has(key);
    return {
      id: method.kind,
      label: readOnly ? `Read isolated Agent Knowledge ${key}.` : `Mutate isolated Agent Knowledge ${key}.`,
      route: method.route,
      effect: readOnly ? 'read-only-network' : 'confirmed-agent-knowledge-write',
      owner: 'connected-host',
      preferredModelTool: readOnly ? 'agent_knowledge' : key === 'reindex' ? 'agent_harness run_command' : 'agent_knowledge_ingest',
      confirmation: readOnly ? 'Read-only; use the owning first-class tool.' : 'Requires explicit user request and confirmation through the owning tool or command bridge.',
      boundary: 'Isolated Agent Knowledge route family only; default knowledge and non-Agent knowledge segments are forbidden.',
      ...(readOnly ? {} : {
        parameters: [
          { name: 'confirm', required: true },
          { name: 'explicitUserRequest', required: true },
        ],
      }),
    } satisfies OperatorMethodDescriptor;
  });
}

function operatorActionMethods(): readonly OperatorMethodDescriptor[] {
  return Object.values(OPERATOR_ACTIONS).map((action) => ({
    id: action.action,
    label: action.label,
    route: action.pathTemplate,
    effect: 'confirmed-connected-host-state',
    owner: 'connected-host',
    preferredModelTool: 'agent_operator_action',
    confirmation: 'Requires confirm:true and explicitUserRequest for the exact target.',
    boundary: 'Allowlisted public operator action only; no arbitrary route invocation, automation definition creation, or host lifecycle control.',
    parameters: [
      { name: action.targetField, required: true },
      { name: 'confirm', required: true },
      { name: 'explicitUserRequest', required: true },
    ],
  }));
}

function allOperatorMethods(): readonly OperatorMethodDescriptor[] {
  return [
    ...OPERATOR_BRIEFING_METHODS,
    ...operatorActionMethods(),
    ...agentKnowledgeMethods(),
    {
      id: 'schedules.create',
      label: 'Create one connected reminder or routine schedule.',
      route: '/api/automation/schedules',
      effect: 'confirmed-connected-host-state',
      owner: 'connected-host',
      preferredModelTool: 'agent_reminder_schedule or agent_harness run_workspace_action',
      confirmation: 'Requires explicit user request and confirmation.',
      boundary: 'Connected schedule creation only; no hidden local scheduler or separate Agent job.',
      parameters: [
        { name: 'scheduleKind', required: true },
        { name: 'scheduleValue', required: true },
        { name: 'message', required: true },
        { name: 'confirm', required: true },
        { name: 'explicitUserRequest', required: true },
      ],
    } satisfies OperatorMethodDescriptor,
  ].sort((a, b) => a.id.localeCompare(b.id));
}

function methodSearchText(method: OperatorMethodDescriptor): string {
  return [
    method.id,
    method.label,
    method.route,
    method.effect,
    method.preferredModelTool,
    method.boundary,
  ].join('\n').toLowerCase();
}

function describeMethod(
  method: OperatorMethodDescriptor,
  options: { readonly includeParameters?: boolean; readonly lookup?: Record<string, unknown> } = {},
): Record<string, unknown> {
  return {
    id: method.id,
    label: method.label,
    route: method.route,
    effect: method.effect,
    owner: method.owner,
    preferredModelTool: method.preferredModelTool,
    confirmation: method.confirmation,
    boundary: method.boundary,
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(options.includeParameters ? { parameters: method.parameters ?? [] } : {}),
  };
}

function describeCandidate(method: OperatorMethodDescriptor): Record<string, unknown> {
  return {
    methodId: method.id,
    route: method.route,
    effect: method.effect,
    preferredModelTool: method.preferredModelTool,
  };
}

function lookupFromArgs(args: AgentHarnessOperatorMethodArgs): { readonly source: OperatorMethodLookupSource; readonly input: string } | null {
  const methodId = readString(args.methodId);
  if (methodId) return { source: 'methodId', input: methodId };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

export function operatorMethodCatalogStatus(): Record<string, unknown> {
  const methods = allOperatorMethods();
  return {
    modes: ['operator_methods', 'operator_method'],
    methods: methods.length,
    readOnlyMethods: methods.filter((method) => method.effect === 'read-only-network').length,
    confirmedMethods: methods.filter((method) => method.effect !== 'read-only-network').length,
    policy: 'This is a read-only catalog. Use the preferred first-class model tool for execution; arbitrary connected-host route invocation remains unavailable.',
  };
}

export function operatorMethodSummary(args: AgentHarnessOperatorMethodArgs): Record<string, unknown> {
  const query = readString(args.query).toLowerCase();
  const limit = readLimit(args.limit, 200);
  const includeParameters = args.includeParameters === true;
  const methods = allOperatorMethods()
    .filter((method) => !query || methodSearchText(method).includes(query))
    .slice(0, limit)
    .map((method) => describeMethod(method, { includeParameters }));
  return {
    methods,
    returned: methods.length,
    total: allOperatorMethods().length,
    policy: 'Read-only operator method catalog. Execute only through the listed preferred first-class tool and only when its confirmation policy is satisfied.',
  };
}

export function describeHarnessOperatorMethod(args: AgentHarnessOperatorMethodArgs): OperatorMethodResolution {
  const lookup = lookupFromArgs(args);
  if (!lookup) {
    return {
      status: 'missing_lookup',
      usage: 'operator_method requires methodId, target, or query.',
    };
  }
  const methods = allOperatorMethods();
  const normalized = lookup.input.toLowerCase();
  const exact = methods.find((method) => method.id === lookup.input);
  if (exact) {
    return { status: 'found', method: describeMethod(exact, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'id' } }) };
  }
  const insensitive = methods.find((method) => method.id.toLowerCase() === normalized);
  if (insensitive) {
    return { status: 'found', method: describeMethod(insensitive, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-id' } }) };
  }
  const searched = methods.filter((method) => methodSearchText(method).includes(normalized));
  if (searched.length === 1) {
    return { status: 'found', method: describeMethod(searched[0]!, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'search' } }) };
  }
  if (searched.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: searched.slice(0, 8).map(describeCandidate),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown operator method ${lookup.input}. Use mode:"operator_methods" to inspect available methods.`,
  };
}
