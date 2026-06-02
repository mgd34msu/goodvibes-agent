import type { AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

export type AgentWorkspaceChannelCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  'channel-show' | 'channel-doctor' | 'channel-setup'
>;

export function isAgentWorkspaceChannelCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceChannelCommandEditorKind {
  return kind === 'channel-show' || kind === 'channel-doctor' || kind === 'channel-setup';
}

export function createAgentWorkspaceChannelCommandEditor(kind: AgentWorkspaceChannelCommandEditorKind): AgentWorkspaceLocalEditor {
  if (kind === 'channel-doctor') {
    return {
      kind,
      mode: 'create',
      title: 'Run Channel Doctor',
      selectedFieldIndex: 0,
      message: 'Inspect one connected channel route without sending messages or changing delivery state.',
      fields: [
        { id: 'channel', label: 'Channel id', value: '', required: true, multiline: false, hint: 'Channel id, such as slack, telegram, discord, ntfy, signal, or whatsapp.' },
      ],
    };
  }
  if (kind === 'channel-setup') {
    return {
      kind,
      mode: 'create',
      title: 'Show Channel Setup',
      selectedFieldIndex: 0,
      message: 'Show read-only setup guidance for one channel. This does not pair, enable, or send through the channel.',
      fields: [
        { id: 'channel', label: 'Channel id', value: '', required: true, multiline: false, hint: 'Channel id, such as slack, telegram, discord, ntfy, signal, or whatsapp.' },
      ],
    };
  }
  return {
    kind,
    mode: 'create',
    title: 'Show Channel Detail',
    selectedFieldIndex: 0,
    message: 'Show one channel readiness record from the Agent workspace without changing channel state.',
    fields: [
      { id: 'channel', label: 'Channel id', value: '', required: true, multiline: false, hint: 'Channel id, such as slack, telegram, discord, ntfy, signal, or whatsapp.' },
    ],
  };
}
