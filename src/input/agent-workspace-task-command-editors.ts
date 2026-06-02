import type { AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

export type AgentWorkspaceTaskCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  'task-show' | 'task-output'
>;

export function isAgentWorkspaceTaskCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceTaskCommandEditorKind {
  return kind === 'task-show' || kind === 'task-output';
}

export function createAgentWorkspaceTaskCommandEditor(kind: AgentWorkspaceTaskCommandEditorKind): AgentWorkspaceLocalEditor {
  if (kind === 'task-output') {
    return {
      kind,
      mode: 'create',
      title: 'Show Task Output',
      selectedFieldIndex: 0,
      message: 'Print one connected-host task output from the Agent workspace. This is read-only and does not retry, cancel, or mutate the task.',
      fields: [
        { id: 'taskId', label: 'Task id', value: '', required: true, multiline: false, hint: 'Connected-host task id from Runtime tasks.' },
      ],
    };
  }
  return {
    kind,
    mode: 'create',
    title: 'Inspect Runtime Task',
    selectedFieldIndex: 0,
    message: 'Inspect one connected-host task from the Agent workspace. This is read-only and does not retry, cancel, or mutate the task.',
    fields: [
      { id: 'taskId', label: 'Task id', value: '', required: true, multiline: false, hint: 'Connected-host task id from Runtime tasks.' },
    ],
  };
}
