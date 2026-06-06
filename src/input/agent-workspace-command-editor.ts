import type { AgentWorkspaceBasicCommandEditorKind } from './agent-workspace-basic-command-editors.ts';
import { buildAgentArtifactBrowserPromptSubmission, buildAgentArtifactPromoteKnowledgePromptSubmission } from './agent-workspace-artifact-browser-editor.ts';
import { buildAgentWorkspaceBasicCommandEditorSubmission, isAgentWorkspaceBasicCommandEditorKind } from './agent-workspace-basic-command-editors.ts';
import { buildAgentDocumentPromptSubmission } from './agent-workspace-document-editor.ts';
import { buildAgentKnowledgeUrlEditorSubmission } from './agent-workspace-knowledge-url-editor.ts';
import { buildAgentKnowledgeQueryEditorSubmission } from './agent-workspace-knowledge-query-editor.ts';
import { buildAgentModelCompareAnalyticsPromptSubmission, buildAgentModelCompareApplyPromptSubmission, buildAgentModelCompareExportPromptSubmission, buildAgentModelCompareJudgmentPromptSubmission, buildAgentModelComparePromptSubmission, buildAgentModelCompareReviewPromptSubmission } from './agent-workspace-model-compare-editor.ts';
import { buildAgentReminderScheduleEditorSubmission } from './agent-workspace-reminder-schedule-editor.ts';
import { buildAgentRoutineScheduleEditorSubmission } from './agent-workspace-routine-schedule-editor.ts';
import { buildAgentWorkspaceWebResearchSubmission } from './agent-workspace-web-research-editor.ts';
import type { AgentWorkspaceActionResult, AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;
type AgentWorkspaceCommandEditorKind = AgentWorkspaceBasicCommandEditorKind | Extract<
  AgentWorkspaceEditorKind,
  'web-research'
  | 'web-fetch'
  | 'knowledge-url'
  | 'knowledge-urls'
  | 'knowledge-file'
  | 'knowledge-browser-history'
  | 'knowledge-connector-ingest'
  | 'knowledge-reindex'
  | 'knowledge-search'
  | 'knowledge-ask'
  | 'model-compare'
  | 'document-browse'
  | 'document-show'
  | 'document-create'
  | 'document-update'
  | 'document-review'
  | 'document-insert-artifact'
  | 'document-export'
  | 'model-compare-review'
  | 'model-compare-judge'
  | 'model-compare-apply'
  | 'model-compare-export'
  | 'model-compare-analytics'
  | 'mcp-server'
  | 'notify-webhook'
  | 'notify-webhook-remove'
  | 'notify-webhook-clear'
  | 'notify-webhook-test'
  | 'notify-send'
  | 'secret-set'
  | 'secret-link'
  | 'secret-test'
  | 'secret-delete'
  | 'routine-schedule'
  | 'reminder-schedule'
  | 'knowledge-bookmarks'
  | 'tts-prompt'
  | 'image-input'
  | 'artifact-browser'
  | 'artifact-show'
  | 'artifact-promote-knowledge'
  | 'skill-bundle'
  | 'persona-discovery-import'
  | 'routine-discovery-import'
  | 'skill-discovery-import'
  | 'profile-template-export'
  | 'profile-template-import'
  | 'profile-template-from-discovered'
  | 'profile-from-discovered'
  | 'profile-default'
  | 'profile-default-clear'
  | 'support-bundle-export'
  | 'support-bundle-inspect'
  | 'support-bundle-import'
  | 'subscription-inspect'
  | 'subscription-login-start'
  | 'subscription-login-finish'
  | 'subscription-logout'
  | 'delegate-task'
  | 'workplan-add'
  | 'workplan-status'
  | 'workplan-delete'
  | 'workplan-clear-completed'
>;

type AgentWorkspaceCommandEditorSubmission =
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
  }
  | {
    readonly kind: 'prompt';
    readonly prompt: string;
    readonly status: string;
    readonly actionResult: AgentWorkspaceActionResult;
  };

export function isAgentWorkspaceCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceCommandEditorKind {
  return kind === 'web-research'
    || kind === 'web-fetch'
    || kind === 'knowledge-url'
    || kind === 'knowledge-search'
    || kind === 'knowledge-ask'
    || kind === 'artifact-browser'
    || kind === 'artifact-show'
    || kind === 'artifact-promote-knowledge'
    || kind === 'model-compare'
    || kind === 'document-browse'
    || kind === 'document-show'
    || kind === 'document-create'
    || kind === 'document-update'
    || kind === 'document-review'
    || kind === 'document-insert-artifact'
    || kind === 'document-export'
    || kind === 'model-compare-review'
    || kind === 'model-compare-judge'
    || kind === 'model-compare-apply'
    || kind === 'model-compare-export'
    || kind === 'model-compare-analytics'
    || kind === 'routine-schedule'
    || kind === 'reminder-schedule'
    || isAgentWorkspaceBasicCommandEditorKind(kind);
}

export function buildAgentWorkspaceCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
  commandDispatchAvailable: boolean,
  promptDispatchAvailable: boolean,
): AgentWorkspaceCommandEditorSubmission {
  if (editor.kind === 'web-research' || editor.kind === 'web-fetch') {
    return buildAgentWorkspaceWebResearchSubmission(editor, readField, promptDispatchAvailable);
  }
  if (editor.kind === 'knowledge-url') return buildAgentKnowledgeUrlEditorSubmission(editor, readField, commandDispatchAvailable);
  if (editor.kind === 'knowledge-search' || editor.kind === 'knowledge-ask') {
    return buildAgentKnowledgeQueryEditorSubmission(editor, readField, commandDispatchAvailable);
  }
  if (editor.kind === 'artifact-browser' || editor.kind === 'artifact-show') {
    return buildAgentArtifactBrowserPromptSubmission(editor, readField, promptDispatchAvailable);
  }
  if (editor.kind === 'artifact-promote-knowledge') {
    return buildAgentArtifactPromoteKnowledgePromptSubmission(editor, readField, promptDispatchAvailable);
  }
  if (
    editor.kind === 'document-browse'
    || editor.kind === 'document-show'
    || editor.kind === 'document-create'
    || editor.kind === 'document-update'
    || editor.kind === 'document-review'
    || editor.kind === 'document-insert-artifact'
    || editor.kind === 'document-export'
  ) {
    return buildAgentDocumentPromptSubmission(editor, readField, promptDispatchAvailable);
  }
  if (editor.kind === 'model-compare') {
    return buildAgentModelComparePromptSubmission(editor, readField, promptDispatchAvailable);
  }
  if (editor.kind === 'model-compare-review') {
    return buildAgentModelCompareReviewPromptSubmission(editor, readField, promptDispatchAvailable);
  }
  if (editor.kind === 'model-compare-judge') {
    return buildAgentModelCompareJudgmentPromptSubmission(editor, readField, promptDispatchAvailable);
  }
  if (editor.kind === 'model-compare-apply') {
    return buildAgentModelCompareApplyPromptSubmission(editor, readField, promptDispatchAvailable);
  }
  if (editor.kind === 'model-compare-export') {
    return buildAgentModelCompareExportPromptSubmission(editor, readField, promptDispatchAvailable);
  }
  if (editor.kind === 'model-compare-analytics') {
    return buildAgentModelCompareAnalyticsPromptSubmission(editor, readField, promptDispatchAvailable);
  }
  if (isAgentWorkspaceBasicCommandEditorKind(editor.kind)) {
    return buildAgentWorkspaceBasicCommandEditorSubmission(editor, readField, commandDispatchAvailable);
  }
  if (editor.kind === 'reminder-schedule') return buildAgentReminderScheduleEditorSubmission(editor, readField, commandDispatchAvailable);
  return buildAgentRoutineScheduleEditorSubmission(editor, readField, commandDispatchAvailable);
}
