import type { AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

export type AgentWorkspaceProviderCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  'provider-add' | 'provider-remove'
>;

export function isAgentWorkspaceProviderCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceProviderCommandEditorKind {
  return kind === 'provider-add' || kind === 'provider-remove';
}

export function createAgentWorkspaceProviderCommandEditor(kind: AgentWorkspaceProviderCommandEditorKind): AgentWorkspaceLocalEditor {
  if (kind === 'provider-add') {
    return {
      kind,
      mode: 'create',
      title: 'Add Custom Provider',
      selectedFieldIndex: 0,
      message: 'Add an OpenAI-compatible provider for Agent chat/model routing. Type yes on the final field to confirm.',
      fields: [
        { id: 'name', label: 'Provider name', value: '', required: true, multiline: false, hint: 'Letters, numbers, hyphens, and underscores only.' },
        { id: 'baseUrl', label: 'Base URL', value: '', required: true, multiline: false, hint: 'OpenAI-compatible base URL, such as http://127.0.0.1:8000/v1.' },
        { id: 'apiKey', label: 'API key', value: '', required: false, multiline: false, hint: 'Optional API key. Prefer a local provider or a secret-backed provider config when possible.', redact: true },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /provider add with --yes.' },
      ],
    };
  }
  return {
    kind,
    mode: 'delete',
    title: 'Remove Custom Provider',
    selectedFieldIndex: 0,
    message: 'Remove one custom provider config from the Agent provider list. Type yes on the final field to confirm.',
    fields: [
      { id: 'name', label: 'Provider name', value: '', required: true, multiline: false, hint: 'Existing custom provider name.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /provider remove with --yes.' },
    ],
  };
}
