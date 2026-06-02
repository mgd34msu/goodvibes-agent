import type { AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

export type AgentWorkspaceProviderCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  'provider-add' | 'provider-remove' | 'provider-use' | 'provider-inspect' | 'provider-routes' | 'provider-account-repair'
>;

export function isAgentWorkspaceProviderCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceProviderCommandEditorKind {
  return kind === 'provider-add'
    || kind === 'provider-remove'
    || kind === 'provider-use'
    || kind === 'provider-inspect'
    || kind === 'provider-routes'
    || kind === 'provider-account-repair';
}

export function createAgentWorkspaceProviderCommandEditor(kind: AgentWorkspaceProviderCommandEditorKind): AgentWorkspaceLocalEditor {
  if (kind === 'provider-use') {
    return {
      kind,
      mode: 'create',
      title: 'Use Provider',
      selectedFieldIndex: 0,
      message: 'Switch the Agent chat provider through the TUI command router. Use the model picker for exact provider/model selection.',
      fields: [
        { id: 'provider', label: 'Provider id', value: '', required: true, multiline: false, hint: 'Provider row id, such as openai-subscriber, openai, anthropic, or a custom provider.' },
      ],
    };
  }
  if (kind === 'provider-inspect') {
    return {
      kind,
      mode: 'create',
      title: 'Inspect Provider',
      selectedFieldIndex: 0,
      message: 'Inspect provider auth and setup routes from the Agent TUI without changing provider selection.',
      fields: [
        { id: 'provider', label: 'Provider id', value: '', required: true, multiline: false, hint: 'Provider row id to inspect.' },
      ],
    };
  }
  if (kind === 'provider-routes') {
    return {
      kind,
      mode: 'create',
      title: 'Inspect Provider Routes',
      selectedFieldIndex: 0,
      message: 'Inspect provider account routes from the Agent TUI without changing routing or auth.',
      fields: [
        { id: 'provider', label: 'Provider id', value: '', required: true, multiline: false, hint: 'Provider row id to inspect.' },
      ],
    };
  }
  if (kind === 'provider-account-repair') {
    return {
      kind,
      mode: 'create',
      title: 'Review Provider Account Repair',
      selectedFieldIndex: 0,
      message: 'Show provider account repair guidance from the Agent TUI without starting login or storing tokens.',
      fields: [
        { id: 'provider', label: 'Provider id', value: '', required: true, multiline: false, hint: 'Provider row id to inspect.' },
      ],
    };
  }
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
