import type { AgentWorkspaceActionResult, AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import type { AgentWorkspaceTaskCommandEditorKind } from './agent-workspace-task-command-editors.ts';
import { isAgentWorkspaceTaskCommandEditorKind } from './agent-workspace-task-command-editors.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceTaskCommandEditorSubmission =
  | {
    readonly kind: 'editor';
    readonly editor: AgentWorkspaceLocalEditor;
    readonly status: string;
    readonly actionResult?: AgentWorkspaceActionResult;
  }
  | {
    readonly kind: 'dispatch';
    readonly command: string;
    readonly status: string;
    readonly actionResult: AgentWorkspaceActionResult;
  };

export function isAgentWorkspaceTaskCommandSubmissionKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceTaskCommandEditorKind {
  return isAgentWorkspaceTaskCommandEditorKind(kind);
}

export function buildAgentWorkspaceTaskCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
): AgentWorkspaceTaskCommandEditorSubmission {
  const subcommand = editor.kind === 'task-output' ? 'output' : 'show';
  const command = `/tasks ${subcommand} ${quoteSlashCommandArg(readField('taskId'))}`;
  const title = editor.kind === 'task-output' ? 'Opening task output' : 'Opening task inspection';
  return {
    kind: 'dispatch',
    command,
    status: `${title}.`,
    actionResult: {
      kind: 'dispatched',
      title,
      detail: 'The workspace handed read-only connected-host task inspection to the shell-owned command router.',
      command,
      safety: 'read-only',
    },
  };
}
