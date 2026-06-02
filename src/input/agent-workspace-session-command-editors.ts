import type { AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

export type AgentWorkspaceSessionCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  | 'conversation-export'
  | 'session-save'
  | 'session-load'
  | 'session-rename'
  | 'session-resume'
  | 'session-info'
  | 'session-export-saved'
  | 'session-search'
  | 'session-delete'
  | 'mode-preset'
  | 'mode-domain'
>;

export function isAgentWorkspaceSessionCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceSessionCommandEditorKind {
  return kind === 'conversation-export'
    || kind === 'session-save'
    || kind === 'session-load'
    || kind === 'session-rename'
    || kind === 'session-resume'
    || kind === 'session-info'
    || kind === 'session-export-saved'
    || kind === 'session-search'
    || kind === 'session-delete'
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
  if (kind === 'session-rename') {
    return {
      kind,
      mode: 'update',
      title: 'Rename Current Session',
      selectedFieldIndex: 0,
      message: 'Rename the active Agent session from the workspace.',
      fields: [
        { id: 'name', label: 'New session name', value: '', required: true, multiline: false, hint: 'New reviewable name for the current session.' },
      ],
    };
  }
  if (kind === 'session-resume') {
    return {
      kind,
      mode: 'update',
      title: 'Resume Saved Session',
      selectedFieldIndex: 0,
      message: 'Resume one saved Agent session by id, prefix, or title.',
      fields: [
        { id: 'target', label: 'Session id or name', value: '', required: true, multiline: false, hint: 'Use /session list or the Saved sessions action to find ids.' },
      ],
    };
  }
  if (kind === 'session-info') {
    return {
      kind,
      mode: 'create',
      title: 'Inspect Saved Session',
      selectedFieldIndex: 0,
      message: 'Inspect saved session metadata without changing the current conversation.',
      fields: [
        { id: 'target', label: 'Session id or name', value: '', required: true, multiline: false, hint: 'Saved session id, prefix, or name.' },
      ],
    };
  }
  if (kind === 'session-export-saved') {
    return {
      kind,
      mode: 'create',
      title: 'Export Saved Session',
      selectedFieldIndex: 0,
      message: 'Print one saved session transcript as markdown or text.',
      fields: [
        { id: 'target', label: 'Session id or name', value: '', required: true, multiline: false, hint: 'Use . for the current session, or a saved session id/name.' },
        { id: 'format', label: 'Format', value: 'markdown', required: true, multiline: false, hint: 'markdown or text.' },
      ],
    };
  }
  if (kind === 'session-search') {
    return {
      kind,
      mode: 'create',
      title: 'Search Saved Sessions',
      selectedFieldIndex: 0,
      message: 'Search saved Agent sessions from the workspace.',
      fields: [
        { id: 'query', label: 'Search query', value: '', required: true, multiline: false, hint: 'Keyword or phrase to find in saved sessions.' },
      ],
    };
  }
  if (kind === 'session-delete') {
    return {
      kind,
      mode: 'delete',
      title: 'Delete Saved Session',
      selectedFieldIndex: 0,
      message: 'Delete one saved Agent session. Type yes on the final field to confirm.',
      fields: [
        { id: 'target', label: 'Session id or name', value: '', required: true, multiline: false, hint: 'Saved session id or prefix. The active session cannot be deleted.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /session delete with --yes.' },
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
