import type { AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

export type AgentWorkspaceOperationsCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  'plan-show' | 'plan-approve' | 'plan-override' | 'plan-clear' | 'health-repair' | 'approval-review' | 'routine-receipt' | 'schedule-receipt'
>;

export function isAgentWorkspaceOperationsCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceOperationsCommandEditorKind {
  return kind === 'plan-show'
    || kind === 'plan-approve'
    || kind === 'plan-override'
    || kind === 'plan-clear'
    || kind === 'health-repair'
    || kind === 'approval-review'
    || kind === 'routine-receipt'
    || kind === 'schedule-receipt';
}

export function createAgentWorkspaceOperationsCommandEditor(kind: AgentWorkspaceOperationsCommandEditorKind): AgentWorkspaceLocalEditor {
  if (kind === 'health-repair') {
    return {
      kind,
      mode: 'create',
      title: 'Show Health Repair Guidance',
      selectedFieldIndex: 0,
      message: 'Show health repair guidance for one domain. Agent does not start services or mutate connected-host lifecycle.',
      fields: [
        { id: 'domain', label: 'Domain', value: 'settings', required: true, multiline: false, hint: 'settings, auth, accounts, host, remote, mcp, continuity, or maintenance.' },
      ],
    };
  }
  if (kind === 'approval-review') {
    return {
      kind,
      mode: 'create',
      title: 'Review Approval Class',
      selectedFieldIndex: 0,
      message: 'Review one approval class without approving, denying, or mutating pending requests.',
      fields: [
        { id: 'kind', label: 'Approval kind', value: 'shell', required: true, multiline: false, hint: 'shell, file, network, delegate, mcp, remote, hook, or plugin.' },
      ],
    };
  }
  if (kind === 'plan-approve') {
    return {
      kind,
      mode: 'update',
      title: 'Approve Planning State',
      selectedFieldIndex: 0,
      message: 'Approve the current Agent planning state for execution. This changes planning state and requires typed confirmation.',
      fields: [
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /plan approve with --yes.' },
      ],
    };
  }
  if (kind === 'plan-override') {
    return {
      kind,
      mode: 'update',
      title: 'Override Planning Strategy',
      selectedFieldIndex: 0,
      message: 'Override the planner strategy through the runtime bridge. This changes planner state and requires typed confirmation.',
      fields: [
        { id: 'strategy', label: 'Strategy', value: 'serial', required: true, multiline: false, hint: 'Planner strategy, such as serial.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /plan override with --yes.' },
      ],
    };
  }
  if (kind === 'plan-clear') {
    return {
      kind,
      mode: 'delete',
      title: 'Clear Planning State',
      selectedFieldIndex: 0,
      message: 'Clear planner state. This is destructive and requires typed confirmation.',
      fields: [
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /plan clear with --yes.' },
      ],
    };
  }
  if (kind === 'routine-receipt' || kind === 'schedule-receipt') {
    const routine = kind === 'routine-receipt';
    return {
      kind,
      mode: 'create',
      title: routine ? 'Show Routine Promotion Receipt' : 'Show Schedule Receipt',
      selectedFieldIndex: 0,
      message: routine
        ? 'Show one local routine schedule-promotion receipt without reconciling or mutating connected schedules.'
        : 'Show one local schedule receipt without reconciling or mutating connected schedules.',
      fields: [
        { id: 'receiptId', label: 'Receipt id', value: '', required: true, multiline: false, hint: 'Receipt id from Promotion receipts.' },
      ],
    };
  }
  return {
    kind,
    mode: 'create',
    title: 'Show Saved Plan',
    selectedFieldIndex: 0,
    message: 'Show one saved execution plan by id or prefix without approving or starting execution.',
    fields: [
      { id: 'planId', label: 'Plan id', value: '', required: true, multiline: false, hint: 'Plan id or unique prefix from Saved plans.' },
    ],
  };
}
