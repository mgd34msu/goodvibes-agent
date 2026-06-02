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
  if (editor.kind === 'conversation-events' || editor.kind === 'conversation-groups') {
    const subcommand = editor.kind === 'conversation-groups' ? 'groups' : 'events';
    const eventKind = readField('kind');
    const command = eventKind.length > 0
      ? `/conversation ${subcommand} ${quoteSlashCommandArg(eventKind)}`
      : `/conversation ${subcommand}`;
    return dispatch(
      command,
      editor.kind === 'conversation-groups' ? 'Opening transcript groups' : 'Opening transcript events',
      'The workspace handed read-only transcript structure inspection to the shell-owned command router.',
      'read-only',
    );
  }
  if (editor.kind === 'conversation-find') {
    const kind = readField('kind');
    const command = kind.length > 0
      ? `/conversation find ${quoteSlashCommandArg(readField('query'))} ${quoteSlashCommandArg(kind)}`
      : `/conversation find ${quoteSlashCommandArg(readField('query'))}`;
    return dispatch(
      command,
      'Opening transcript search',
      'The workspace handed read-only transcript search to the shell-owned command router.',
      'read-only',
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
  if (editor.kind === 'session-rename') {
    return dispatch(
      `/session rename ${quoteSlashCommandArg(readField('name'))}`,
      'Opening session rename',
      'The workspace handed current-session rename to the shell-owned command router.',
      'safe',
    );
  }
  if (editor.kind === 'session-resume') {
    return dispatch(
      `/session resume ${quoteSlashCommandArg(readField('target'))}`,
      'Opening session resume',
      'The workspace handed saved-session resume to the shell-owned command router.',
      'safe',
    );
  }
  if (editor.kind === 'session-info') {
    return dispatch(
      `/session info ${quoteSlashCommandArg(readField('target'))}`,
      'Opening session inspection',
      'The workspace handed read-only saved-session inspection to the shell-owned command router.',
      'read-only',
    );
  }
  if (editor.kind === 'session-export-saved') {
    return dispatch(
      `/session export ${quoteSlashCommandArg(readField('target'))} ${quoteSlashCommandArg(readField('format'))}`,
      'Opening saved-session export',
      'The workspace handed saved-session transcript export to the shell-owned command router.',
      'read-only',
    );
  }
  if (editor.kind === 'session-search') {
    return dispatch(
      `/session search ${quoteSlashCommandArg(readField('query'))}`,
      'Opening saved-session search',
      'The workspace handed saved-session search to the shell-owned command router.',
      'read-only',
    );
  }
  if (editor.kind === 'session-delete') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Session delete not confirmed. Type yes, then press Enter.');
    return dispatch(
      `/session delete ${quoteSlashCommandArg(readField('target'))} --yes`,
      'Opening saved-session delete',
      'The workspace handed confirmed saved-session deletion to the shell-owned command router.',
      'safe',
    );
  }
  if (editor.kind === 'session-fork') {
    const name = readField('name');
    return dispatch(
      name.length > 0 ? `/session fork ${quoteSlashCommandArg(name)}` : '/session fork',
      'Opening session fork',
      'The workspace handed current-session fork to the shell-owned command router.',
      'safe',
    );
  }
  if (editor.kind === 'session-graph') {
    const sessionId = readField('sessionId');
    const format = readField('format');
    const parts = ['/session', 'graph'];
    if (sessionId.length > 0) parts.push('--session', quoteSlashCommandArg(sessionId));
    if (format.length > 0) parts.push('--format', quoteSlashCommandArg(format));
    const command = parts.join(' ');
    return dispatch(
      command,
      'Opening session graph',
      'The workspace handed read-only session graph inspection to the shell-owned command router.',
      'read-only',
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
