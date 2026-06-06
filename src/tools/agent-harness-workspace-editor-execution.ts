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
  if (editorKind === 'research-report') {
    return {
      route: 'agent_research_report',
      tool: 'agent_research_report',
      action: 'save_research_report_artifact',
      confirmation: 'required',
      note: 'run_workspace_action saves one reviewed source-grounded markdown report as a local artifact with a source map. It does not ingest Agent Knowledge or send external messages.',
    };
  }
  if (editorKind === 'research-run') {
    return {
      route: 'agent_research_runs',
      tool: 'agent_research_runs',
      action: 'create_research_run',
      confirmation: 'required',
      note: 'run_workspace_action creates one project-local visible research run with plan, next steps, source ids, checkpoint/resume/cancel routes, and no hidden background execution. Web research, source review, reports, Knowledge ingest, and external sends remain separate explicit actions.',
    };
  }
  if (editorKind === 'research-source') {
    return {
      route: 'agent_research_sources',
      tool: 'agent_research_sources',
      action: 'add_source_candidate',
      confirmation: 'required',
      note: 'run_workspace_action adds one source to the project-local research queue. Report saving, Knowledge ingest, and external sends remain separate explicit actions.',
    };
  }
  if (editorKind === 'artifact-browser') {
    return {
      route: 'agent_artifacts',
      tool: 'agent_artifacts',
      action: 'list_artifacts',
      confirmation: 'not-required',
      note: 'run_workspace_action searches saved Agent artifacts through the first-class read-only artifact browser. It never deletes artifacts or inlines binary/base64 bytes.',
    };
  }
  if (editorKind === 'artifact-show') {
    return {
      route: 'agent_artifacts',
      tool: 'agent_artifacts',
      action: 'show_artifact',
      confirmation: 'not-required',
      note: 'run_workspace_action inspects one saved Agent artifact with redacted metadata and bounded text previews only.',
    };
  }
  if (editorKind === 'artifact-export-file') {
    return {
      route: 'agent_artifacts',
      tool: 'agent_artifacts',
      action: 'export_artifact_file',
      confirmation: 'required',
      note: 'run_workspace_action copies one reviewed saved artifact to a workspace file after confirmation. It preserves exact bytes, refuses overwrite unless requested, and never deletes artifacts or prints content.',
    };
  }
  if (editorKind === 'artifact-export-package') {
    return {
      route: 'agent_artifacts',
      tool: 'agent_artifacts',
      action: 'export_artifact_package',
      confirmation: 'required',
      note: 'run_workspace_action copies selected reviewed artifacts into a workspace package directory or ZIP archive after confirmation. It preserves exact bytes, writes a redacted manifest and README, refuses existing outputs unless overwrite is requested, and never deletes artifacts or prints content.',
    };
  }
  if (editorKind === 'artifact-promote-knowledge') {
    return {
      route: 'agent_knowledge_ingest',
      tool: 'agent_knowledge_ingest',
      action: 'promote_artifact_to_knowledge',
      confirmation: 'required',
      note: 'run_workspace_action ingests one reviewed saved artifact into isolated Agent Knowledge by artifact id. It never writes default knowledge or deletes artifacts.',
    };
  }
  if (
    editorKind === 'document-browse'
    || editorKind === 'document-show'
    || editorKind === 'document-create'
    || editorKind === 'document-update'
    || editorKind === 'document-review'
    || editorKind === 'document-comment'
    || editorKind === 'document-resolve-comment'
    || editorKind === 'document-suggest'
    || editorKind === 'document-accept-suggestion'
    || editorKind === 'document-reject-suggestion'
    || editorKind === 'document-insert-artifact'
    || editorKind === 'document-attach-artifact'
    || editorKind === 'document-export'
  ) {
    return {
      route: 'agent_documents',
      tool: 'agent_documents',
      action: editorKind.replace('document-', ''),
      confirmation: editorKind === 'document-browse' || editorKind === 'document-show' ? 'not-required' : 'required',
      note: 'run_workspace_action uses Agent-owned markdown drafts with version history, review comments, user-reviewed AI suggestions, artifact attachment, and artifact insertion. Export creates a saved markdown artifact with attachment metadata; insertion appends bounded text or a safe artifact reference. No default knowledge write occurs.',
    };
  }
  if (editorKind === 'model-compare' || editorKind === 'local-model-benchmark') {
    return {
      route: 'agent_model_compare',
      tool: 'agent_model_compare',
      action: editorKind === 'local-model-benchmark' ? 'run_local_model_benchmark' : 'run_blind_comparison',
      confirmation: 'required',
      note: editorKind === 'local-model-benchmark'
        ? 'run_workspace_action validates the local benchmark fields, tags the saved artifact as benchmarkKind local-model-route, and executes the first-class blind comparison tool. It never changes the selected model.'
        : 'run_workspace_action validates the editor fields and executes the first-class blind comparison tool with delayed reveal support. The visible workspace form submits the same request to the main conversation.',
    };
  }
  if (editorKind === 'model-compare-review') {
    return {
      route: 'agent_model_compare',
      tool: 'agent_model_compare',
      action: 'review_saved_comparison',
      confirmation: 'not-required',
      note: 'run_workspace_action renders saved blind comparison artifacts or a read-only review board through the first-class comparison tool; route updates stay separate.',
    };
  }
  if (editorKind === 'model-compare-judge') {
    return {
      route: 'agent_model_compare',
      tool: 'agent_model_compare',
      action: 'save_comparison_judgment',
      confirmation: 'required',
      note: 'run_workspace_action validates the editor fields and saves a local comparison judgment artifact. It never changes the selected model; route updates require separate confirmation.',
    };
  }
  if (editorKind === 'model-compare-apply') {
    return {
      route: 'agent_model_compare',
      tool: 'agent_model_compare',
      action: 'apply_comparison_winner',
      confirmation: 'required',
      note: 'run_workspace_action applies a revealed saved comparison judgment to provider.model after explicit confirmation.',
    };
  }
  if (editorKind === 'model-compare-export') {
    return {
      route: 'agent_model_compare',
      tool: 'agent_model_compare',
      action: 'export_comparison_report_or_handoff',
      confirmation: 'required',
      note: 'run_workspace_action creates one local markdown report or reviewer handoff from saved comparison evidence without changing model routing.',
    };
  }
  if (editorKind === 'model-compare-analytics') {
    return {
      route: 'agent_model_compare',
      tool: 'agent_model_compare',
      action: 'summarize_or_synthesize_comparison_judgments',
      confirmation: 'not-required',
      note: 'run_workspace_action summarizes or synthesizes saved comparison judgment artifacts without changing model routing.',
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
