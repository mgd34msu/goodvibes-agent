import type { AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

export type AgentWorkspaceSessionCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  | 'conversation-export'
  | 'session-save'
  | 'session-load'
  | 'mode-preset'
  | 'mode-domain'
>;

export function isAgentWorkspaceSessionCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceSessionCommandEditorKind {
  return kind === 'conversation-export'
    || kind === 'session-save'
    || kind === 'session-load'
    || kind === 'mode-preset'
    || kind === 'mode-domain';
}

export function createAgentWorkspaceSessionCommandEditor(kind: AgentWorkspaceSessionCommandEditorKind): AgentWorkspaceLocalEditor {
  if (kind === 'conversation-export') {
    return {
      kind,
      mode: 'create',
      title: 'Export Conversation',
      selectedFieldIndex: 0,
      message: 'Export the current conversation to a workspace file. Type yes on the final field to confirm.',
      fields: [
        { id: 'format', label: 'Format', value: 'markdown', required: true, multiline: false, hint: 'markdown or text.' },
        { id: 'path', label: 'Output path', value: './conversation.md', required: true, multiline: false, hint: 'Workspace-relative output path.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /export with --yes.' },
      ],
    };
  }
  if (kind === 'session-save') {
    return {
      kind,
      mode: 'create',
      title: 'Save Session',
      selectedFieldIndex: 0,
      message: 'Save the current Agent session under a reviewable name. Type yes on the final field to confirm.',
      fields: [
        { id: 'name', label: 'Session name', value: '', required: true, multiline: false, hint: 'Local saved-session name.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /save.' },
      ],
    };
  }
  if (kind === 'session-load') {
    return {
      kind,
      mode: 'update',
      title: 'Load Session',
      selectedFieldIndex: 0,
      message: 'Load a saved Agent session into the current conversation. Type yes on the final field to confirm.',
      fields: [
        { id: 'name', label: 'Session name', value: '', required: true, multiline: false, hint: 'Existing saved-session name from /sessions.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /load.' },
      ],
    };
  }
  if (kind === 'mode-preset') {
    return {
      kind,
      mode: 'update',
      title: 'Set Interaction Mode',
      selectedFieldIndex: 0,
      message: 'Set the Agent interaction noise level. Type yes on the final field to confirm.',
      fields: [
        { id: 'preset', label: 'Preset', value: 'balanced', required: true, multiline: false, hint: 'quiet, balanced, or operator.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /mode <preset> with --yes.' },
      ],
    };
  }
  return {
    kind,
    mode: 'update',
    title: 'Set Domain Verbosity',
    selectedFieldIndex: 0,
    message: 'Set interaction verbosity for one notification domain. Type yes on the final field to confirm.',
    fields: [
      { id: 'domain', label: 'Domain', value: '', required: true, multiline: false, hint: 'Domain name from mode output.' },
      { id: 'verbosity', label: 'Verbosity', value: 'normal', required: true, multiline: false, hint: 'minimal, normal, or verbose.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /mode set-domain.' },
    ],
  };
}
