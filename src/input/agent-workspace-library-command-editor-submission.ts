import type { AgentWorkspaceActionResult, AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import type { AgentWorkspaceLibraryCommandEditorKind } from './agent-workspace-library-command-editors.ts';
import { isAgentWorkspaceLibraryCommandEditorKind } from './agent-workspace-library-command-editors.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceLibraryCommandEditorSubmission =
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

export function isAgentWorkspaceLibraryCommandSubmissionKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceLibraryCommandEditorKind {
  return isAgentWorkspaceLibraryCommandEditorKind(kind);
}

export function buildAgentWorkspaceLibraryCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
): AgentWorkspaceLibraryCommandEditorSubmission {
  const target = editor.kind.startsWith('persona') ? 'persona' : editor.kind.startsWith('skill') ? 'skill' : 'routine';
  const root = target === 'persona' ? '/personas' : target === 'skill' ? '/agent-skills' : '/routines';
  const search = editor.kind.endsWith('search');
  const command = search
    ? `${root} search ${quoteSlashCommandArg(readField('query'))}`
    : `${root} show ${quoteSlashCommandArg(readField('id'))}`;
  const label = target === 'persona' ? 'persona' : target === 'skill' ? 'skill' : 'routine';
  const title = search ? `Opening ${label} search` : `Opening ${label} detail`;
  return {
    kind: 'dispatch',
    command,
    status: `${title}.`,
    actionResult: {
      kind: 'dispatched',
      title,
      detail: `The workspace handed read-only local ${label} ${search ? 'search' : 'detail inspection'} to the shell-owned command router.`,
      command,
      safety: 'read-only',
    },
  };
}
