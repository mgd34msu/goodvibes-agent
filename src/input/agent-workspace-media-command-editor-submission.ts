import type { AgentWorkspaceActionResult, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import type { AgentWorkspaceMediaCommandEditorKind } from './agent-workspace-media-command-editors.ts';
import { isAgentWorkspaceMediaCommandEditorKind } from './agent-workspace-media-command-editors.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceMediaCommandEditorSubmission =
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

export function isAgentWorkspaceMediaCommandSubmissionKind(kind: string): kind is AgentWorkspaceMediaCommandEditorKind {
  return isAgentWorkspaceMediaCommandEditorKind(kind as AgentWorkspaceMediaCommandEditorKind);
}

function isAffirmative(value: string): boolean {
  return /^(y|yes|true)$/i.test(value.trim());
}

export function buildAgentWorkspaceMediaCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
): AgentWorkspaceMediaCommandEditorSubmission {
  if (!isAffirmative(readField('confirm'))) {
    return {
      kind: 'editor',
      editor: { ...editor, message: 'Media generation not confirmed. Type yes, then press Enter.' },
      status: 'Agent media generation not confirmed.',
    };
  }
  const parts = ['/media', 'generate'];
  const provider = readField('provider');
  const model = readField('model');
  const mime = readField('mime');
  if (provider) parts.push('--provider', quoteSlashCommandArg(provider));
  if (model) parts.push('--model', quoteSlashCommandArg(model));
  if (mime) parts.push('--mime', quoteSlashCommandArg(mime));
  parts.push(quoteSlashCommandArg(readField('prompt')), '--yes');
  const command = parts.join(' ');
  return {
    kind: 'dispatch',
    command,
    status: 'Opening media generation.',
    actionResult: {
      kind: 'dispatched',
      title: 'Opening media generation',
      detail: 'The workspace handed confirmed media generation to the shell-owned command router.',
      command,
      safety: 'safe',
    },
  };
}
