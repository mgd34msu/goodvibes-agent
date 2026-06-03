import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import {
  WORK_PLAN_STATUSES,
  type WorkPlanItem,
  type WorkPlanItemStatus,
  type WorkPlanStore,
} from '../work-plans/work-plan-store.ts';

export type AgentWorkPlanAction =
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'set_status'
  | 'remove'
  | 'clear_completed';

export interface AgentWorkPlanToolArgs {
  readonly action?: unknown;
  readonly id?: unknown;
  readonly title?: unknown;
  readonly status?: unknown;
  readonly owner?: unknown;
  readonly source?: unknown;
  readonly notes?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

const ACTIONS: readonly AgentWorkPlanAction[] = [
  'list',
  'get',
  'create',
  'update',
  'set_status',
  'remove',
  'clear_completed',
];

function isAction(value: unknown): value is AgentWorkPlanAction {
  return typeof value === 'string' && ACTIONS.includes(value as AgentWorkPlanAction);
}

function isStatus(value: unknown): value is WorkPlanItemStatus {
  return typeof value === 'string' && WORK_PLAN_STATUSES.includes(value as WorkPlanItemStatus);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes';
}

function failure(error: string): { readonly success: false; readonly error: string } {
  return { success: false, error };
}

function output(text: string): { readonly success: true; readonly output: string } {
  return { success: true, output: text };
}

function requireId(args: AgentWorkPlanToolArgs): string {
  const id = readString(args.id);
  if (!id) throw new Error('id is required.');
  return id;
}

function requireTitle(args: AgentWorkPlanToolArgs): string {
  const title = readString(args.title);
  if (!title) throw new Error('title is required.');
  return title;
}

function readOptionalStatus(value: unknown): WorkPlanItemStatus | undefined {
  if (value === undefined || value === null || readString(value) === '') return undefined;
  if (!isStatus(value)) throw new Error(`Invalid status. Valid: ${WORK_PLAN_STATUSES.join(', ')}.`);
  return value;
}

function formatStatus(status: WorkPlanItemStatus): string {
  return status.replace(/_/g, ' ');
}

function formatItem(item: WorkPlanItem): string {
  const owner = item.owner ? ` owner=${item.owner}` : '';
  const source = item.source ? ` source=${item.source}` : '';
  const completed = item.completedAt ? ` completed=${new Date(item.completedAt).toISOString()}` : '';
  return `${item.id}  ${formatStatus(item.status)}${owner}${source}${completed}  ${item.title}`;
}

function formatItemDetail(item: WorkPlanItem): string {
  return [
    formatItem(item),
    `created: ${new Date(item.createdAt).toISOString()}`,
    `updated: ${new Date(item.updatedAt).toISOString()}`,
    item.linked
      ? `linked: ${Object.entries(item.linked).map(([key, value]) => `${key}:${value}`).join(', ')}`
      : 'linked: (none)',
    '',
    item.notes || '(no notes)',
  ].join('\n');
}

function resolveItem(store: WorkPlanStore, idOrPrefix: string): WorkPlanItem {
  const needle = idOrPrefix.trim();
  if (!needle) throw new Error('id is required.');
  const items = store.listItems();
  const exact = items.find((item) => item.id === needle);
  if (exact) return exact;
  const matches = items.filter((item) => item.id.startsWith(needle));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new Error(`Work plan item id "${needle}" is ambiguous: ${matches.map((item) => item.id).join(', ')}`);
  }
  throw new Error(`Work plan item not found: ${needle}`);
}

function listOutput(store: WorkPlanStore): string {
  const plan = store.getActivePlan();
  const counts = new Map<WorkPlanItemStatus, number>(WORK_PLAN_STATUSES.map((status) => [status, 0]));
  for (const item of plan.items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  const lines = [
    'Agent local work plan',
    `  plan: ${plan.id}`,
    `  project: ${plan.projectRoot}`,
    `  items: ${plan.items.length}; pending ${counts.get('pending') ?? 0}; active ${counts.get('in_progress') ?? 0}; blocked ${counts.get('blocked') ?? 0}; done ${counts.get('done') ?? 0}`,
  ];
  if (plan.items.length === 0) {
    lines.push('', 'No local work plan items.');
    return lines.join('\n');
  }
  lines.push('', ...plan.items.slice(0, 20).map(formatItem));
  if (plan.items.length > 20) lines.push(`${plan.items.length - 20} more item(s) omitted.`);
  return lines.join('\n');
}

function requireDestructiveConfirmation(args: AgentWorkPlanToolArgs, action: string): string | null {
  const explicitUserRequest = readString(args.explicitUserRequest);
  if (!explicitUserRequest) return `explicitUserRequest is required before ${action}.`;
  if (!readBoolean(args.confirm)) {
    return [
      `Agent work plan ${action} preview`,
      '  policy: destructive local work-plan changes require confirm:true and an explicit user request',
      `  request: ${explicitUserRequest}`,
    ].join('\n');
  }
  return null;
}

function updatePatch(args: AgentWorkPlanToolArgs): Parameters<WorkPlanStore['updateItem']>[1] {
  const status = readOptionalStatus(args.status);
  return {
    ...(args.title !== undefined ? { title: requireTitle(args) } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(args.owner !== undefined ? { owner: readString(args.owner) || null } : {}),
    ...(args.source !== undefined ? { source: readString(args.source) || null } : {}),
    ...(args.notes !== undefined ? { notes: readString(args.notes) || null } : {}),
  };
}

export function createAgentWorkPlanTool(store: WorkPlanStore): Tool {
  return {
    definition: {
      name: 'agent_work_plan',
      description: [
        'Inspect and maintain the visible GoodVibes Agent local work plan from the main conversation.',
        'Use this to track concrete tasks the assistant is doing or has agreed to do, so the work is visible in the Agent TUI workspace.',
        'This uses only Agent-local persisted work-plan state; it does not call connected-host mutation routes, start local jobs, create local workers, use WRFC, write default knowledge, or use non-Agent knowledge segments.',
        'Create, update, and set_status are safe local state actions. remove and clear_completed require confirm:true plus explicitUserRequest.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: [...ACTIONS] },
          id: { type: 'string', description: 'Work plan item id or unique id prefix for get/update/set_status/remove.' },
          title: { type: 'string', description: 'Work plan item title for create/update.' },
          status: { type: 'string', enum: [...WORK_PLAN_STATUSES], description: 'Work plan item status.' },
          owner: { type: 'string', description: 'Optional owner label.' },
          source: { type: 'string', description: 'Optional source/provenance label.' },
          notes: { type: 'string', description: 'Optional work-plan notes.' },
          confirm: { type: 'boolean', description: 'Required true for remove and clear_completed.' },
          explicitUserRequest: { type: 'string', description: 'Required for destructive remove and clear_completed actions.' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      sideEffects: ['state'],
    },
    execute: async (rawArgs: unknown) => {
      try {
        const args = rawArgs as AgentWorkPlanToolArgs;
        if (!isAction(args.action)) return failure(`Unknown Agent work plan action. Valid: ${ACTIONS.join(', ')}.`);
        if (args.action === 'list') return output(listOutput(store));
        if (args.action === 'get') return output(formatItemDetail(resolveItem(store, requireId(args))));
        if (args.action === 'create') {
          const item = store.addItem(requireTitle(args), {
            status: readOptionalStatus(args.status) ?? 'pending',
            owner: readString(args.owner) || 'agent',
            source: readString(args.source) || 'main-conversation',
            notes: readString(args.notes) || undefined,
          });
          return output(`Created Agent work plan item ${item.id}: ${item.title}`);
        }
        if (args.action === 'update') {
          const item = store.updateItem(requireId(args), updatePatch(args));
          return output(`Updated Agent work plan item ${item.id}: ${item.title}`);
        }
        if (args.action === 'set_status') {
          const status = readOptionalStatus(args.status);
          if (!status) throw new Error('status is required.');
          const item = store.setItemStatus(requireId(args), status);
          return output(`Set Agent work plan item ${item.id} to ${formatStatus(item.status)}: ${item.title}`);
        }
        if (args.action === 'remove') {
          const denied = requireDestructiveConfirmation(args, `remove ${readString(args.id) || '(missing id)'}`);
          if (denied) return failure(denied);
          const item = store.removeItem(requireId(args));
          return output(`Removed Agent work plan item ${item.id}: ${item.title}`);
        }
        const denied = requireDestructiveConfirmation(args, 'clear completed');
        if (denied) return failure(denied);
        const count = store.clearCompleted();
        return output(`Cleared ${count} completed/cancelled Agent work plan item${count === 1 ? '' : 's'}.`);
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function registerAgentWorkPlanTool(registry: ToolRegistry, store: WorkPlanStore): void {
  registry.register(createAgentWorkPlanTool(store));
}
