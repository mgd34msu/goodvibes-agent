import type { AgentWorkspaceActionResult, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import type { AgentWorkspaceAccessCommandEditorKind } from './agent-workspace-access-command-editors.ts';
import { isAgentWorkspaceAccessCommandEditorKind } from './agent-workspace-access-command-editors.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceAccessCommandEditorSubmission =
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

export function isAgentWorkspaceAccessCommandSubmissionKind(kind: string): kind is AgentWorkspaceAccessCommandEditorKind {
  return isAgentWorkspaceAccessCommandEditorKind(kind as AgentWorkspaceAccessCommandEditorKind);
}

function isAffirmative(value: string): boolean {
  return /^(y|yes|true)$/i.test(value.trim());
}

function unconfirmed(editor: AgentWorkspaceLocalEditor, message: string): AgentWorkspaceAccessCommandEditorSubmission {
  return {
    kind: 'editor',
    editor: { ...editor, message },
    status: message,
  };
}

function dispatch(command: string, title: string, detail: string, safety: AgentWorkspaceActionResult['safety']): AgentWorkspaceAccessCommandEditorSubmission {
  return {
    kind: 'dispatch',
    command,
    status: `${title}.`,
    actionResult: {
      kind: 'dispatched',
      title,
      detail,
      command,
      safety,
    },
  };
}

export function buildAgentWorkspaceAccessCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
): AgentWorkspaceAccessCommandEditorSubmission {
  if (editor.kind === 'auth-show') {
    return dispatch(
      `/auth show ${quoteSlashCommandArg(readField('provider'))}`,
      'Opening provider auth inspection',
      'The workspace handed a read-only provider auth inspection command to the shell-owned command router.',
      'read-only',
    );
  }
  if (editor.kind === 'auth-repair') {
    return dispatch(
      `/auth repair ${quoteSlashCommandArg(readField('provider'))}`,
      'Opening provider auth repair review',
      'The workspace handed a read-only provider auth repair review command to the shell-owned command router.',
      'read-only',
    );
  }
  if (editor.kind === 'auth-bundle-export') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Auth review bundle export not confirmed. Type yes, then press Enter.');
    return dispatch(
      `/auth bundle export ${quoteSlashCommandArg(readField('path'))} --yes`,
      'Opening auth review bundle export',
      'The workspace handed a confirmed auth review bundle export command to the shell-owned command router.',
      'safe',
    );
  }
  if (editor.kind === 'auth-bundle-inspect') {
    return dispatch(
      `/auth bundle inspect ${quoteSlashCommandArg(readField('path'))}`,
      'Opening auth review bundle inspection',
      'The workspace handed a read-only auth review bundle inspect command to the shell-owned command router.',
      'read-only',
    );
  }
  if (editor.kind === 'trust-bundle-export') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Trust bundle export not confirmed. Type yes, then press Enter.');
    return dispatch(
      `/trust bundle export ${quoteSlashCommandArg(readField('path'))} --yes`,
      'Opening trust bundle export',
      'The workspace handed a confirmed trust bundle export command to the shell-owned command router.',
      'safe',
    );
  }
  if (editor.kind === 'trust-bundle-inspect') {
    return dispatch(
      `/trust bundle inspect ${quoteSlashCommandArg(readField('path'))}`,
      'Opening trust bundle inspection',
      'The workspace handed a read-only trust bundle inspect command to the shell-owned command router.',
      'read-only',
    );
  }
  if (editor.kind === 'subscription-bundle-export') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Subscription bundle export not confirmed. Type yes, then press Enter.');
    return dispatch(
      `/subscription bundle export ${quoteSlashCommandArg(readField('path'))} --yes`,
      'Opening subscription bundle export',
      'The workspace handed a confirmed subscription bundle export command to the shell-owned command router.',
      'safe',
    );
  }
  if (editor.kind === 'subscription-bundle-inspect') {
    return dispatch(
      `/subscription bundle inspect ${quoteSlashCommandArg(readField('path'))}`,
      'Opening subscription bundle inspection',
      'The workspace handed a read-only subscription bundle inspect command to the shell-owned command router.',
      'read-only',
    );
  }
  if (editor.kind === 'voice-enable' || editor.kind === 'voice-disable') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, `Voice interaction ${editor.kind === 'voice-enable' ? 'enable' : 'disable'} not confirmed. Type yes, then press Enter.`);
    const mode = editor.kind === 'voice-enable' ? 'enable' : 'disable';
    return dispatch(
      `/voice ${mode} --yes`,
      `Opening voice interaction ${mode}`,
      `The workspace handed a confirmed voice ${mode} command to the shell-owned command router.`,
      'safe',
    );
  }
  if (editor.kind === 'voice-bundle-export') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Voice bundle export not confirmed. Type yes, then press Enter.');
    return dispatch(
      `/voice bundle export ${quoteSlashCommandArg(readField('path'))} --yes`,
      'Opening voice bundle export',
      'The workspace handed a confirmed voice bundle export command to the shell-owned command router.',
      'safe',
    );
  }
  return dispatch(
    `/voice bundle inspect ${quoteSlashCommandArg(readField('path'))}`,
    'Opening voice bundle inspection',
    'The workspace handed a read-only voice bundle inspect command to the shell-owned command router.',
    'read-only',
  );
}
