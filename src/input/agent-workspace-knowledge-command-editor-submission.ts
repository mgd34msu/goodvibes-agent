import type { AgentWorkspaceActionResult, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import type { AgentWorkspaceKnowledgeCommandEditorKind } from './agent-workspace-knowledge-command-editors.ts';
import { isAgentWorkspaceKnowledgeCommandEditorKind } from './agent-workspace-knowledge-command-editors.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceKnowledgeCommandEditorSubmission =
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

export function isAgentWorkspaceKnowledgeCommandSubmissionKind(kind: string): kind is AgentWorkspaceKnowledgeCommandEditorKind {
  return isAgentWorkspaceKnowledgeCommandEditorKind(kind as AgentWorkspaceKnowledgeCommandEditorKind);
}

function isAffirmative(value: string): boolean {
  return /^(y|yes|true)$/i.test(value.trim());
}

function splitCommaList(value: string): readonly string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function unconfirmed(editor: AgentWorkspaceLocalEditor, message: string): AgentWorkspaceKnowledgeCommandEditorSubmission {
  return {
    kind: 'editor',
    editor: { ...editor, message },
    status: message,
  };
}

function dispatch(command: string, title: string, detail: string, safety: AgentWorkspaceActionResult['safety']): AgentWorkspaceKnowledgeCommandEditorSubmission {
  return {
    kind: 'dispatch',
    command,
    status: `${title}.`,
    actionResult: { kind: 'dispatched', title, detail, command, safety },
  };
}

export function buildAgentWorkspaceKnowledgeCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
): AgentWorkspaceKnowledgeCommandEditorSubmission {
  if (editor.kind === 'knowledge-get') {
    return dispatch(
      `/knowledge get ${quoteSlashCommandArg(readField('id'))}`,
      'Opening Agent Knowledge item',
      'The workspace handed a read-only Agent Knowledge item command to the shell-owned command router.',
      'read-only',
    );
  }
  if (editor.kind === 'knowledge-map') {
    const query = readField('query');
    const limit = readField('limit');
    const parts = ['/knowledge', 'map'];
    if (query.length > 0) parts.push(quoteSlashCommandArg(query));
    if (limit.length > 0) parts.push('--limit', quoteSlashCommandArg(limit));
    return dispatch(
      parts.join(' '),
      'Opening Agent Knowledge map',
      'The workspace handed a read-only Agent Knowledge map command to the shell-owned command router.',
      'read-only',
    );
  }
  if (editor.kind === 'knowledge-review-issue') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Agent Knowledge issue review not confirmed. Type yes, then press Enter.');
    const parts = [
      '/knowledge',
      'review-issue',
      quoteSlashCommandArg(readField('issueId')),
      quoteSlashCommandArg(readField('action')),
    ];
    const reviewer = readField('reviewer');
    const value = readField('value');
    if (reviewer.length > 0) parts.push('--reviewer', quoteSlashCommandArg(reviewer));
    if (value.length > 0) parts.push('--value', quoteSlashCommandArg(value));
    parts.push('--yes');
    return dispatch(
      parts.join(' '),
      'Opening Agent Knowledge issue review',
      'The workspace handed a confirmed Agent Knowledge issue review command to the shell-owned command router.',
      'safe',
    );
  }
  if (editor.kind === 'knowledge-consolidate') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Agent Knowledge consolidation not confirmed. Type yes, then press Enter.');
    return dispatch(
      `/knowledge consolidate ${quoteSlashCommandArg(readField('mode'))} --yes`,
      'Opening Agent Knowledge consolidation',
      'The workspace handed a confirmed Agent Knowledge consolidation command to the shell-owned command router.',
      'safe',
    );
  }
  const subcommand = editor.kind === 'knowledge-explain' ? 'explain' : 'packet';
  const parts = ['/knowledge', subcommand, quoteSlashCommandArg(readField('task'))];
  for (const scope of splitCommaList(readField('scopes'))) {
    parts.push('--scope', quoteSlashCommandArg(scope));
  }
  return dispatch(
    parts.join(' '),
    subcommand === 'explain' ? 'Opening Agent Knowledge explanation' : 'Opening Agent Knowledge prompt packet',
    'The workspace handed a read-only Agent Knowledge context command to the shell-owned command router.',
    'read-only',
  );
}
