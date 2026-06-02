import type { AgentWorkspaceActionResult, AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import type { AgentWorkspaceChannelCommandEditorKind } from './agent-workspace-channel-command-editors.ts';
import { isAgentWorkspaceChannelCommandEditorKind } from './agent-workspace-channel-command-editors.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceChannelCommandEditorSubmission =
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

export function isAgentWorkspaceChannelCommandSubmissionKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceChannelCommandEditorKind {
  return isAgentWorkspaceChannelCommandEditorKind(kind);
}

export function buildAgentWorkspaceChannelCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
): AgentWorkspaceChannelCommandEditorSubmission {
  const subcommand = editor.kind === 'channel-doctor' ? 'doctor' : editor.kind === 'channel-setup' ? 'setup' : 'show';
  const command = `/channels ${subcommand} ${quoteSlashCommandArg(readField('channel'))}`;
  const title = editor.kind === 'channel-doctor'
    ? 'Opening channel doctor'
    : editor.kind === 'channel-setup'
      ? 'Opening channel setup guidance'
      : 'Opening channel detail';
  return {
    kind: 'dispatch',
    command,
    status: `${title}.`,
    actionResult: {
      kind: 'dispatched',
      title,
      detail: 'The workspace handed read-only channel inspection to the shell-owned command router.',
      command,
      safety: 'read-only',
    },
  };
}
