import { isAgentWorkspaceCommandEditorKind } from '../input/agent-workspace-command-editor.ts';
import type { AgentWorkspaceEditorKind } from '../input/agent-workspace-types.ts';

type LocalEditorDomain = 'memory' | 'note' | 'persona' | 'skill' | 'routine';

function localEditorDomain(editorKind: AgentWorkspaceEditorKind): LocalEditorDomain | null {
  if (
    editorKind === 'memory'
    || editorKind === 'note'
    || editorKind === 'persona'
    || editorKind === 'skill'
    || editorKind === 'routine'
  ) return editorKind;
  return null;
}

function localEditorSupportedActions(editorKind: LocalEditorDomain): readonly string[] {
  if (editorKind === 'memory') return ['list', 'search', 'get', 'review', 'stale', 'delete'];
  if (editorKind === 'note') return ['list', 'search', 'get', 'review', 'stale', 'delete'];
  if (editorKind === 'persona') return ['list', 'search', 'get', 'use', 'clear_active', 'review', 'stale', 'delete'];
  if (editorKind === 'skill') return ['list', 'search', 'get', 'enable', 'disable', 'review', 'stale', 'delete'];
  return ['list', 'search', 'get', 'enable', 'disable', 'start', 'review', 'stale', 'delete'];
}

export function describeWorkspaceEditorModelExecution(editorKind: AgentWorkspaceEditorKind): Record<string, unknown> {
  const localDomain = localEditorDomain(editorKind);
  if (localDomain) {
    return {
      route: 'agent_local_registry',
      tool: 'agent_local_registry',
      domain: localDomain,
      action: 'create_or_update_from_fields',
      confirmation: 'required',
      supportedActions: localEditorSupportedActions(localDomain),
      note: 'run_workspace_action validates the editor fields and dispatches through the Agent-local registry without writing default knowledge or non-Agent segments.',
    };
  }
  if (editorKind === 'learned-behavior') {
    return {
      route: 'direct-agent-local-create',
      action: 'create_learned_behavior',
      confirmation: 'required',
      note: 'run_workspace_action creates a local skill, routine, or persona from the submitted learned-behavior fields.',
    };
  }
  if (editorKind === 'profile') {
    return {
      route: 'slash-command-dispatch',
      command: '/agent-profile create <name> [--template <template>] --yes',
      dispatcher: 'run_command',
      confirmation: 'required',
      note: 'run_workspace_action builds the matching profile creation slash command from the submitted fields.',
    };
  }
  if (editorKind === 'web-research' || editorKind === 'web-fetch') {
    return {
      route: 'main-conversation-prompt',
      result: 'prompt',
      confirmation: 'not-required',
      note: 'run_workspace_action returns the main-conversation prompt produced by this editor; use that prompt as the conversation task instead of creating a hidden nested turn.',
    };
  }
  if (editorKind === 'model-compare') {
    return {
      route: 'agent_model_compare',
      tool: 'agent_model_compare',
      action: 'run_blind_comparison',
      confirmation: 'required',
      note: 'run_workspace_action validates the editor fields and executes the first-class blind comparison tool with delayed reveal support. The visible workspace form submits the same request to the main conversation.',
    };
  }
  if (isAgentWorkspaceCommandEditorKind(editorKind)) {
    return {
      route: 'slash-command-dispatch',
      dispatcher: 'run_command',
      confirmation: 'required',
      note: 'run_workspace_action builds the same slash-command submission as the TUI form from submitted fields, then executes it through the shared command registry.',
    };
  }
  return {
    route: 'model-tool-or-editor-schema',
    note: 'Use the returned editor schema, command field, or first-class Agent model tool when available.',
  };
}
