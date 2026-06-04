import type { CommandContext } from '../input/command-registry.ts';

export interface AgentHarnessDelegationArgs {
  readonly delegationRouteId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

type DelegationResolution =
  | { readonly status: 'found'; readonly route: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

type DelegationLookupSource = 'delegationRouteId' | 'target' | 'query';

interface DelegationRoute {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly effect: 'read-only' | 'main-conversation' | 'delegated-work' | 'blocked';
  readonly command?: string;
  readonly commandTemplate?: string;
  readonly workspaceActionId?: string;
  readonly confirmationRequired?: boolean;
  readonly reviewPolicy?: 'explicit-only' | 'not-applicable';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function lookupFromArgs(args: AgentHarnessDelegationArgs): { readonly source: DelegationLookupSource; readonly input: string } | null {
  const delegationRouteId = readString(args.delegationRouteId);
  if (delegationRouteId) return { source: 'delegationRouteId', input: delegationRouteId };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

function routes(): readonly DelegationRoute[] {
  return [
    {
      id: 'delegate-build-task',
      label: 'Delegate build/fix/review task',
      detail: 'Send one explicit build, fix, implementation, patch, or review task to GoodVibes TUI/shared-session routes with the full original ask.',
      effect: 'delegated-work',
      commandTemplate: '/delegate <full original user ask>',
      workspaceActionId: 'delegate-task',
      confirmationRequired: true,
      reviewPolicy: 'explicit-only',
    },
    {
      id: 'delegate-build-task-with-review',
      label: 'Delegate with requested review',
      detail: 'Request delegated review only when the user explicitly asks for review or explicitly requests review as part of a build/fix/review handoff.',
      effect: 'delegated-work',
      commandTemplate: '/delegate --review <full original user ask>',
      workspaceActionId: 'delegate-task',
      confirmationRequired: true,
      reviewPolicy: 'explicit-only',
    },
    {
      id: 'delegation-status',
      label: 'Delegation status',
      detail: 'Inspect build-delegation receipts and shared-session status without starting coding work.',
      effect: 'read-only',
      command: '/delegate status',
      workspaceActionId: 'delegation-status',
      reviewPolicy: 'not-applicable',
    },
    {
      id: 'ordinary-agent-work',
      label: 'Ordinary Agent work',
      detail: 'Planning, research, operations, memory, configuration, approvals, automation observability, media generation, and ordinary assistant work stay in the main Agent conversation or first-class Agent tools.',
      effect: 'main-conversation',
      reviewPolicy: 'not-applicable',
    },
    {
      id: 'local-coding-blocked',
      label: 'Local coding execution blocked in Agent',
      detail: 'Agent does not own file edits, git/worktree workflows, execution isolation UX, coding panels, or local delegated review chains.',
      effect: 'blocked',
      reviewPolicy: 'not-applicable',
    },
  ];
}

function routeSearchText(route: DelegationRoute): string {
  return [
    route.id,
    route.label,
    route.detail,
    route.effect,
    route.command ?? '',
    route.commandTemplate ?? '',
    route.workspaceActionId ?? '',
    route.reviewPolicy ?? '',
  ].join('\n').toLowerCase();
}

function describeCandidate(route: DelegationRoute): Record<string, unknown> {
  return {
    delegationRouteId: route.id,
    label: route.label,
    effect: route.effect,
    confirmationRequired: route.confirmationRequired === true,
  };
}

function describeRoute(
  context: CommandContext,
  route: DelegationRoute,
  options: { readonly includeParameters?: boolean; readonly lookup?: Record<string, unknown> } = {},
): Record<string, unknown> {
  return {
    delegationRouteId: route.id,
    label: route.label,
    detail: route.detail,
    effect: route.effect,
    ...(route.command ? { command: route.command } : {}),
    ...(route.commandTemplate ? { commandTemplate: route.commandTemplate } : {}),
    ...(route.workspaceActionId ? { workspaceActionId: route.workspaceActionId } : {}),
    confirmationRequired: route.confirmationRequired === true,
    reviewPolicy: route.reviewPolicy ?? 'not-applicable',
    runtime: {
      sessionId: context.session.runtime.sessionId,
      operatorClientAttached: Boolean(context.clients?.operator),
    },
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(options.includeParameters ? {
      policy: {
        effect: route.effect,
        values: 'Delegation posture returns policy, route, confirmation, and runtime availability metadata only; it does not submit delegated work.',
        mutation: 'Delegated work submission stays a visible confirmed workspace or slash-command flow and must preserve the full original user ask.',
      },
      modelAccess: {
        inspectDelegation: 'agent_harness mode:"delegation_posture"',
        inspectRoute: 'agent_harness mode:"delegation_route"',
        workspaceAction: route.workspaceActionId ? `agent_harness mode:"workspace_action" actionId:"${route.workspaceActionId}"` : null,
        runWorkspaceAction: route.workspaceActionId ? `agent_harness mode:"run_workspace_action" actionId:"${route.workspaceActionId}" confirm:true explicitUserRequest:"..."` : null,
        runCommand: route.command ? `agent_harness mode:"run_command" command:"${route.command}" confirm:true explicitUserRequest:"..."` : null,
        runCommandTemplate: route.commandTemplate ? `agent_harness mode:"run_command" command:"${route.commandTemplate}" confirm:true explicitUserRequest:"..."` : null,
      },
    } : {}),
  };
}

export function delegationPostureCatalogStatus(context: CommandContext): Record<string, unknown> {
  return {
    modes: ['delegation_posture', 'delegation_route'],
    routes: routes().length,
    operatorClientAttached: Boolean(context.clients?.operator),
    readOnly: true,
  };
}

export function delegationPostureSummary(context: CommandContext, args: AgentHarnessDelegationArgs): Record<string, unknown> {
  const query = readString(args.query).toLowerCase();
  const includeParameters = args.includeParameters === true;
  const filtered = routes()
    .filter((route) => !query || routeSearchText(route).includes(query))
    .slice(0, readLimit(args.limit, 100));
  return {
    status: 'available',
    summary: {
      routes: routes().length,
      operatorClientAttached: Boolean(context.clients?.operator),
      sessionId: context.session.runtime.sessionId,
      delegatedReviewPolicy: 'explicit-build-delegation-only',
      normalChatPolicy: 'ordinary assistant work stays in the main Agent conversation',
      codingOwnership: 'GoodVibes TUI owns file edits, git/worktree workflows, execution isolation UX, coding panels, and delegated review coordination',
    },
    routes: filtered.map((route) => describeRoute(context, route, { includeParameters })),
    returned: filtered.length,
    total: routes().length,
    policy: 'Read-only delegation posture. Delegation submission requires an explicit build/fix/review/implementation user request, visible confirmation, and preservation of the full original ask.',
  };
}

export function describeHarnessDelegationRoute(context: CommandContext, args: AgentHarnessDelegationArgs): DelegationResolution {
  const lookup = lookupFromArgs(args);
  if (!lookup) {
    return {
      status: 'missing_lookup',
      usage: 'delegation_route requires delegationRouteId, target, or query. Use mode:"delegation_posture" to inspect delegation route ids.',
    };
  }
  const all = routes();
  const normalized = lookup.input.toLowerCase();
  const exact = all.find((route) => route.id === lookup.input);
  if (exact) return { status: 'found', route: describeRoute(context, exact, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'id' } }) };
  const insensitive = all.find((route) => route.id.toLowerCase() === normalized);
  if (insensitive) return { status: 'found', route: describeRoute(context, insensitive, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-id' } }) };
  const searched = all.filter((route) => routeSearchText(route).includes(normalized));
  if (searched.length === 1) return { status: 'found', route: describeRoute(context, searched[0]!, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'search' } }) };
  if (searched.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: searched.slice(0, 8).map(describeCandidate),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown delegation route ${lookup.input}. Use mode:"delegation_posture" to inspect delegation route ids.`,
  };
}
