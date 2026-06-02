import { buildAgentWorkspaceBasicCommandEditorSubmission, isAgentWorkspaceBasicCommandEditorKind } from './agent-workspace-basic-command-editors.ts';
import { buildAgentKnowledgeUrlEditorSubmission } from './agent-workspace-knowledge-url-editor.ts';
import { buildAgentKnowledgeQueryEditorSubmission } from './agent-workspace-knowledge-query-editor.ts';
import { buildAgentRoutineScheduleEditorSubmission } from './agent-workspace-routine-schedule-editor.ts';
import type { AgentWorkspaceActionResult, AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;
type AgentWorkspaceCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  'knowledge-url'
  | 'knowledge-search'
  | 'knowledge-ask'
  | 'routine-schedule'
  | 'knowledge-bookmarks'
  | 'tts-prompt'
  | 'image-input'
  | 'skill-bundle'
  | 'profile-template-export'
  | 'profile-template-import'
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
  };

export function isAgentWorkspaceCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceCommandEditorKind {
  return kind === 'knowledge-url'
    || kind === 'knowledge-search'
    || kind === 'knowledge-ask'
    || kind === 'routine-schedule'
    || isAgentWorkspaceBasicCommandEditorKind(kind);
}

export function buildAgentWorkspaceCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
  commandDispatchAvailable: boolean,
): AgentWorkspaceCommandEditorSubmission {
  if (editor.kind === 'knowledge-url') return buildAgentKnowledgeUrlEditorSubmission(editor, readField, commandDispatchAvailable);
  if (editor.kind === 'knowledge-search' || editor.kind === 'knowledge-ask') {
    return buildAgentKnowledgeQueryEditorSubmission(editor, readField, commandDispatchAvailable);
  }
  if (isAgentWorkspaceBasicCommandEditorKind(editor.kind)) {
    return buildAgentWorkspaceBasicCommandEditorSubmission(editor, readField, commandDispatchAvailable);
  }
  return buildAgentRoutineScheduleEditorSubmission(editor, readField, commandDispatchAvailable);
}
