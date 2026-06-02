import type { AgentWorkspaceActionResult, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import type { AgentWorkspaceSessionCommandEditorKind } from './agent-workspace-session-command-editors.ts';
import { isAgentWorkspaceSessionCommandEditorKind } from './agent-workspace-session-command-editors.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceSessionCommandEditorSubmission =
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

export function isAgentWorkspaceSessionCommandSubmissionKind(kind: string): kind is AgentWorkspaceSessionCommandEditorKind {
  return isAgentWorkspaceSessionCommandEditorKind(kind as AgentWorkspaceSessionCommandEditorKind);
}

function isAffirmative(value: string): boolean {
  return /^(y|yes|true)$/i.test(value.trim());
}

function unconfirmed(editor: AgentWorkspaceLocalEditor, message: string): AgentWorkspaceSessionCommandEditorSubmission {
  return {
    kind: 'editor',
    editor: { ...editor, message },
    status: message,
  };
}

function dispatch(command: string, title: string, detail: string, safety: AgentWorkspaceActionResult['safety']): AgentWorkspaceSessionCommandEditorSubmission {
  return {
    kind: 'dispatch',
    command,
    status: `${title}.`,
    actionResult: { kind: 'dispatched', title, detail, command, safety },
  };
}

export function buildAgentWorkspaceSessionCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
): AgentWorkspaceSessionCommandEditorSubmission {
  if (editor.kind === 'conversation-export') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Conversation export not confirmed. Type yes, then press Enter.');
    return dispatch(
      `/export ${quoteSlashCommandArg(readField('format'))} ${quoteSlashCommandArg(readField('path'))} --yes`,
      'Opening conversation export',
      'The workspace handed a confirmed conversation export command to the shell-owned command router.',
      'safe',
    );
  }
  if (editor.kind === 'session-save') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Session save not confirmed. Type yes, then press Enter.');
    return dispatch(
      `/save ${quoteSlashCommandArg(readField('name'))}`,
      'Opening session save',
      'The workspace handed a confirmed session save command to the shell-owned command router.',
      'safe',
    );
  }
  if (editor.kind === 'session-load') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Session load not confirmed. Type yes, then press Enter.');
    return dispatch(
      `/load ${quoteSlashCommandArg(readField('name'))}`,
      'Opening session load',
      'The workspace handed a confirmed session load command to the shell-owned command router.',
      'safe',
    );
  }
  if (editor.kind === 'mode-preset') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Interaction mode change not confirmed. Type yes, then press Enter.');
    return dispatch(
      `/mode ${quoteSlashCommandArg(readField('preset'))} --yes`,
      'Opening interaction mode change',
      'The workspace handed a confirmed interaction mode command to the shell-owned command router.',
      'safe',
    );
  }
  if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Domain verbosity change not confirmed. Type yes, then press Enter.');
  return dispatch(
    `/mode set-domain ${quoteSlashCommandArg(readField('domain'))} ${quoteSlashCommandArg(readField('verbosity'))} --yes`,
    'Opening domain verbosity change',
    'The workspace handed a confirmed domain verbosity command to the shell-owned command router.',
    'safe',
  );
}
