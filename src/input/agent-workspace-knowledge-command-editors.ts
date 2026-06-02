import type { AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

export type AgentWorkspaceKnowledgeCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  | 'knowledge-get'
  | 'knowledge-review-issue'
  | 'knowledge-consolidate'
  | 'knowledge-packet'
  | 'knowledge-explain'
>;

export function isAgentWorkspaceKnowledgeCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceKnowledgeCommandEditorKind {
  return kind === 'knowledge-get'
    || kind === 'knowledge-review-issue'
    || kind === 'knowledge-consolidate'
    || kind === 'knowledge-packet'
    || kind === 'knowledge-explain';
}

export function createAgentWorkspaceKnowledgeCommandEditor(kind: AgentWorkspaceKnowledgeCommandEditorKind): AgentWorkspaceLocalEditor {
  if (kind === 'knowledge-get') {
    return {
      kind,
      mode: 'create',
      title: 'Show Agent Knowledge Item',
      selectedFieldIndex: 0,
      message: 'Show one source, node, or issue from the isolated Agent Knowledge segment.',
      fields: [
        { id: 'id', label: 'Item id', value: '', required: true, multiline: false, hint: 'Agent Knowledge source, node, or issue id.' },
      ],
    };
  }
  if (kind === 'knowledge-review-issue') {
    return {
      kind,
      mode: 'update',
      title: 'Review Agent Knowledge Issue',
      selectedFieldIndex: 0,
      message: 'Accept, reject, resolve, reopen, edit, or forget one Agent Knowledge issue. Type yes on the final field to confirm.',
      fields: [
        { id: 'issueId', label: 'Issue id', value: '', required: true, multiline: false, hint: 'Issue id from the review queue.' },
        { id: 'action', label: 'Action', value: 'resolve', required: true, multiline: false, hint: 'accept, reject, resolve, reopen, edit, or forget.' },
        { id: 'reviewer', label: 'Reviewer', value: 'agent', required: false, multiline: false, hint: 'Reviewer label. Blank defaults to agent.' },
        { id: 'value', label: 'Value JSON', value: '', required: false, multiline: true, hint: 'Optional JSON object for edit actions. Ctrl-J inserts a new line.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /knowledge review-issue with --yes.' },
      ],
    };
  }
  if (kind === 'knowledge-consolidate') {
    return {
      kind,
      mode: 'update',
      title: 'Consolidate Agent Knowledge',
      selectedFieldIndex: 0,
      message: 'Run isolated Agent Knowledge consolidation. Type yes on the final field to confirm.',
      fields: [
        { id: 'mode', label: 'Mode', value: 'light', required: true, multiline: false, hint: 'light or deep.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /knowledge consolidate with --yes.' },
      ],
    };
  }
  const explain = kind === 'knowledge-explain';
  return {
    kind,
    mode: 'create',
    title: explain ? 'Explain Memory Selection' : 'Build Prompt Packet',
    selectedFieldIndex: 0,
    message: explain
      ? 'Explain which Agent Knowledge and memory context would be selected for a task.'
      : 'Build a compact Agent Knowledge prompt packet for a task.',
    fields: [
      { id: 'task', label: 'Task', value: '', required: true, multiline: true, hint: 'Task or question. Ctrl-J inserts a new line.' },
      { id: 'scopes', label: 'Scopes', value: '', required: false, multiline: false, hint: 'Optional comma-separated --scope values.' },
    ],
  };
}
