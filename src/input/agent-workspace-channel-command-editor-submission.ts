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
  if (editor.kind === 'channel-send') {
    if (!/^(y|yes|true)$/i.test(readField('confirm').trim())) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Channel delivery not confirmed. Type yes, then press Enter.' },
        status: 'Channel delivery not confirmed.',
      };
    }
    const parts = ['/channels', 'send'];
    const title = readField('title');
    const channel = readField('channel');
    const route = readField('route');
    const webhook = readField('webhook');
    const link = readField('link');
    if (title) parts.push('--title', quoteSlashCommandArg(title));
    if (channel) parts.push('--channel', quoteSlashCommandArg(channel));
    if (route) parts.push('--route', quoteSlashCommandArg(route));
    if (webhook) parts.push('--webhook', quoteSlashCommandArg(webhook));
    if (link) parts.push('--link', quoteSlashCommandArg(link));
    parts.push('--message', quoteSlashCommandArg(readField('message')), '--yes');
    const command = parts.join(' ');
    return {
      kind: 'dispatch',
      command,
      status: 'Opening channel delivery.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening channel delivery',
        detail: 'The workspace handed a confirmed channel delivery command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
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
