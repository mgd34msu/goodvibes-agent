import type { AgentWorkspaceActionResult, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import type { AgentWorkspaceSkillBundleCommandEditorKind } from './agent-workspace-skill-bundle-command-editors.ts';
import { isAgentWorkspaceSkillBundleCommandEditorKind } from './agent-workspace-skill-bundle-command-editors.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceSkillBundleCommandEditorSubmission =
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

export function isAgentWorkspaceSkillBundleCommandSubmissionKind(kind: string): kind is AgentWorkspaceSkillBundleCommandEditorKind {
  return isAgentWorkspaceSkillBundleCommandEditorKind(kind as AgentWorkspaceSkillBundleCommandEditorKind);
}

function isAffirmative(value: string): boolean {
  return /^(y|yes|true)$/i.test(value.trim());
}

function unconfirmed(editor: AgentWorkspaceLocalEditor, message: string): AgentWorkspaceSkillBundleCommandEditorSubmission {
  return {
    kind: 'editor',
    editor: { ...editor, message },
    status: message,
  };
}

function dispatch(command: string, title: string, detail: string, safety: AgentWorkspaceActionResult['safety']): AgentWorkspaceSkillBundleCommandEditorSubmission {
  return {
    kind: 'dispatch',
    command,
    status: `${title}.`,
    actionResult: { kind: 'dispatched', title, detail, command, safety },
  };
}

export function buildAgentWorkspaceSkillBundleCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
): AgentWorkspaceSkillBundleCommandEditorSubmission {
  if (editor.kind === 'skill-bundle-search') {
    const query = readField('query').trim();
    const command = query.length > 0 ? `/agent-skills bundle search ${quoteSlashCommandArg(query)}` : '/agent-skills bundle search';
    return dispatch(command, 'Opening skill bundle search', 'The workspace handed a read-only skill bundle search command to the shell-owned command router.', 'read-only');
  }
  if (editor.kind === 'skill-bundle-show') {
    return dispatch(
      `/agent-skills bundle show ${quoteSlashCommandArg(readField('id'))}`,
      'Opening skill bundle detail',
      'The workspace handed a read-only skill bundle detail command to the shell-owned command router.',
      'read-only',
    );
  }
  if (editor.kind === 'skill-bundle-update') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Skill bundle update not confirmed. Type yes, then press Enter.');
    const parts = ['/agent-skills', 'bundle', 'update', quoteSlashCommandArg(readField('id'))];
    const name = readField('name');
    const description = readField('description');
    const skills = readField('skills');
    if (name.length > 0) parts.push('--name', quoteSlashCommandArg(name));
    if (description.length > 0) parts.push('--description', quoteSlashCommandArg(description));
    if (skills.length > 0) parts.push('--skills', quoteSlashCommandArg(skills));
    return dispatch(parts.join(' '), 'Opening skill bundle update', 'The workspace handed a confirmed skill bundle update command to the shell-owned command router.', 'safe');
  }
  if (editor.kind === 'skill-bundle-enable' || editor.kind === 'skill-bundle-disable' || editor.kind === 'skill-bundle-review') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Skill bundle action not confirmed. Type yes, then press Enter.');
    const verb = editor.kind.replace('skill-bundle-', '');
    return dispatch(
      `/agent-skills bundle ${verb} ${quoteSlashCommandArg(readField('id'))}`,
      `Opening skill bundle ${verb}`,
      `The workspace handed a confirmed skill bundle ${verb} command to the shell-owned command router.`,
      'safe',
    );
  }
  if (editor.kind === 'skill-bundle-stale') {
    if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Skill bundle stale action not confirmed. Type yes, then press Enter.');
    return dispatch(
      `/agent-skills bundle stale ${quoteSlashCommandArg(readField('id'))} ${quoteSlashCommandArg(readField('reason'))}`,
      'Opening skill bundle stale review',
      'The workspace handed a confirmed skill bundle stale command to the shell-owned command router.',
      'safe',
    );
  }
  if (!isAffirmative(readField('confirm'))) return unconfirmed(editor, 'Skill bundle delete not confirmed. Type yes, then press Enter.');
  return dispatch(
    `/agent-skills bundle delete ${quoteSlashCommandArg(readField('id'))} --yes`,
    'Opening skill bundle delete',
    'The workspace handed a confirmed skill bundle delete command to the shell-owned command router.',
    'safe',
  );
}
