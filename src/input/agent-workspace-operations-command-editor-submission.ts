import type { AgentWorkspaceActionResult, AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import type { AgentWorkspaceOperationsCommandEditorKind } from './agent-workspace-operations-command-editors.ts';
import { isAgentWorkspaceOperationsCommandEditorKind } from './agent-workspace-operations-command-editors.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceOperationsCommandEditorSubmission =
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

export function isAgentWorkspaceOperationsCommandSubmissionKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceOperationsCommandEditorKind {
  return isAgentWorkspaceOperationsCommandEditorKind(kind);
}

export function buildAgentWorkspaceOperationsCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
): AgentWorkspaceOperationsCommandEditorSubmission {
  const plan = editor.kind === 'plan-show';
  const command = plan
    ? `/plan show ${quoteSlashCommandArg(readField('planId'))}`
    : `/health repair ${quoteSlashCommandArg(readField('domain'))}`;
  const title = plan ? 'Opening saved plan' : 'Opening health repair guidance';
  return {
    kind: 'dispatch',
    command,
    status: `${title}.`,
    actionResult: {
      kind: 'dispatched',
      title,
      detail: plan
        ? 'The workspace handed read-only saved-plan inspection to the shell-owned command router.'
        : 'The workspace handed read-only health repair guidance to the shell-owned command router.',
      command,
      safety: 'read-only',
    },
  };
}
