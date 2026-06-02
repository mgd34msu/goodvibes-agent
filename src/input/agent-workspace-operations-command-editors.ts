import type { AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

export type AgentWorkspaceOperationsCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  'plan-show' | 'health-repair'
>;

export function isAgentWorkspaceOperationsCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceOperationsCommandEditorKind {
  return kind === 'plan-show' || kind === 'health-repair';
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
