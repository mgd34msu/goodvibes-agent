import type { AgentWorkspaceActionResult, AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import type { AgentWorkspaceProviderCommandEditorKind } from './agent-workspace-provider-command-editors.ts';
import { isAgentWorkspaceProviderCommandEditorKind } from './agent-workspace-provider-command-editors.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceProviderCommandEditorSubmission =
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

function isAffirmative(value: string): boolean {
  return /^(y|yes|true)$/i.test(value.trim());
}

function unconfirmed(editor: AgentWorkspaceLocalEditor, label: string): AgentWorkspaceProviderCommandEditorSubmission {
  return {
    kind: 'editor',
    editor: { ...editor, message: `${label} not confirmed. Type yes, then press Enter.` },
    status: `${label} not confirmed.`,
  };
}

export function isAgentWorkspaceProviderCommandSubmissionKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceProviderCommandEditorKind {
  return isAgentWorkspaceProviderCommandEditorKind(kind);
}

export function buildAgentWorkspaceProviderCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
): AgentWorkspaceProviderCommandEditorSubmission {
  if (editor.kind === 'provider-use') {
    const command = `/provider ${quoteSlashCommandArg(readField('provider'))}`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening provider selection.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening provider selection',
        detail: 'The workspace handed provider selection to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'provider-inspect') {
    const command = `/accounts show ${quoteSlashCommandArg(readField('provider'))}`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening provider inspection.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening provider inspection',
        detail: 'The workspace handed read-only provider inspection to the shell-owned command router.',
        command,
        safety: 'read-only',
      },
    };
  }
  if (editor.kind === 'provider-add') {
    if (!isAffirmative(readField('confirm'))) {
      return unconfirmed(editor, 'Custom provider add');
    }
    const key = readField('apiKey');
    const parts = [
      '/provider',
      'add',
      quoteSlashCommandArg(readField('name')),
      quoteSlashCommandArg(readField('baseUrl')),
    ];
    const redactedParts = [...parts];
    if (key.length > 0) {
      parts.push(quoteSlashCommandArg(key));
      redactedParts.push('<redacted-api-key>');
    }
    parts.push('--yes');
    redactedParts.push('--yes');
    return {
      kind: 'dispatch',
      command: parts.join(' '),
      status: 'Opening custom provider add.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening custom provider add',
        detail: 'The workspace handed a confirmed custom provider add command to the shell-owned command router without rendering the raw API key.',
        command: redactedParts.join(' '),
        safety: 'safe',
      },
    };
  }

  if (!isAffirmative(readField('confirm'))) {
    return unconfirmed(editor, 'Custom provider removal');
  }
  const command = `/provider remove ${quoteSlashCommandArg(readField('name'))} --yes`;
  return {
    kind: 'dispatch',
    command,
    status: 'Opening custom provider removal.',
    actionResult: {
      kind: 'dispatched',
      title: 'Opening custom provider removal',
      detail: 'The workspace handed a confirmed custom provider removal command to the shell-owned command router.',
      command,
      safety: 'safe',
    },
  };
}
