import type { AgentWorkspaceAction, AgentWorkspaceActionResult, AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';
import type { AgentWorkspaceMemoryCommandEditorKind } from './agent-workspace-memory-command-editors.ts';
import { isAgentWorkspaceMemoryCommandEditorKind } from './agent-workspace-memory-command-editors.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceMemoryCommandEditorSubmission =
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

type MemoryDispatchSafety = AgentWorkspaceAction['safety'];

function isAffirmative(value: string): boolean {
  return /^(y|yes|true)$/i.test(value.trim());
}

function splitCommaList(value: string): readonly string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function unconfirmed(editor: AgentWorkspaceLocalEditor, label: string): AgentWorkspaceMemoryCommandEditorSubmission {
  return {
    kind: 'editor',
    editor: { ...editor, message: `${label} not confirmed. Type yes, then press Enter.` },
    status: `${label} not confirmed.`,
  };
}

function dispatch(
  command: string,
  title: string,
  status: string,
  detail: string,
  safety: MemoryDispatchSafety,
): AgentWorkspaceMemoryCommandEditorSubmission {
  return {
    kind: 'dispatch',
    command,
    status,
    actionResult: {
      kind: 'dispatched',
      title,
      detail,
      command,
      safety,
    },
  };
}

function appendOptional(parts: string[], flag: string, value: string): void {
  if (value.trim().length > 0) {
    parts.push(flag, quoteSlashCommandArg(value));
  }
}

function requireConfirmation(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
  label: string,
): AgentWorkspaceMemoryCommandEditorSubmission | null {
  return isAffirmative(readField('confirm')) ? null : unconfirmed(editor, label);
}

export function isAgentWorkspaceMemoryCommandSubmissionKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceMemoryCommandEditorKind {
  return isAgentWorkspaceMemoryCommandEditorKind(kind);
}

export function buildAgentWorkspaceMemoryCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
): AgentWorkspaceMemoryCommandEditorSubmission {
  if (editor.kind === 'memory-search') {
    const parts = ['/memory', 'search'];
    const query = readField('query');
    if (query.length > 0) parts.push(quoteSlashCommandArg(query));
    appendOptional(parts, '--scope', readField('scope'));
    appendOptional(parts, '--cls', readField('class'));
    appendOptional(parts, '--limit', readField('limit'));
    if (isAffirmative(readField('semantic'))) parts.push('--semantic');
    const command = parts.join(' ');
    return dispatch(
      command,
      'Opening Agent memory search',
      'Opening Agent memory search.',
      'The workspace handed an Agent-local memory search command to the shell-owned command router.',
      'read-only',
    );
  }

  if (editor.kind === 'memory-get') {
    const command = `/memory get ${quoteSlashCommandArg(readField('id'))}`;
    return dispatch(
      command,
      'Opening Agent memory record',
      'Opening Agent memory record.',
      'The workspace handed an Agent-local memory lookup command to the shell-owned command router.',
      'read-only',
    );
  }

  if (editor.kind === 'memory-explain') {
    const parts = ['/memory', 'explain', quoteSlashCommandArg(readField('task'))];
    const scopes = splitCommaList(readField('scopes'));
    if (scopes.length > 0) {
      parts.push('--scope');
      for (const scope of scopes) parts.push(quoteSlashCommandArg(scope));
    }
    const command = parts.join(' ');
    return dispatch(
      command,
      'Opening Agent memory explanation',
      'Opening Agent memory explanation.',
      'The workspace handed an Agent-local memory explanation command to the shell-owned command router.',
      'read-only',
    );
  }

  if (editor.kind === 'memory-promote') {
    const confirmation = requireConfirmation(editor, readField, 'Memory promotion');
    if (confirmation) return confirmation;
    const command = `/memory promote ${quoteSlashCommandArg(readField('id'))} ${quoteSlashCommandArg(readField('scope'))} --yes`;
    return dispatch(
      command,
      'Opening Agent memory promotion',
      'Opening Agent memory promotion.',
      'The workspace handed a confirmed Agent-local memory promotion command to the shell-owned command router.',
      'safe',
    );
  }

  if (editor.kind === 'memory-link') {
    const confirmation = requireConfirmation(editor, readField, 'Memory link');
    if (confirmation) return confirmation;
    const command = `/memory link ${quoteSlashCommandArg(readField('fromId'))} ${quoteSlashCommandArg(readField('toId'))} ${quoteSlashCommandArg(readField('relation'))} --yes`;
    return dispatch(
      command,
      'Opening Agent memory link',
      'Opening Agent memory link.',
      'The workspace handed a confirmed Agent-local memory link command to the shell-owned command router.',
      'safe',
    );
  }

  if (editor.kind === 'memory-export') {
    const confirmation = requireConfirmation(editor, readField, 'Memory bundle export');
    if (confirmation) return confirmation;
    const parts = ['/memory', 'export', quoteSlashCommandArg(readField('path'))];
    appendOptional(parts, '--scope', readField('scope'));
    appendOptional(parts, '--cls', readField('class'));
    parts.push('--yes');
    return dispatch(
      parts.join(' '),
      'Opening Agent memory bundle export',
      'Opening Agent memory bundle export.',
      'The workspace handed a confirmed Agent-local memory export command to the shell-owned command router.',
      'safe',
    );
  }

  if (editor.kind === 'memory-import') {
    const confirmation = requireConfirmation(editor, readField, 'Memory bundle import');
    if (confirmation) return confirmation;
    const command = `/memory import ${quoteSlashCommandArg(readField('path'))} --yes`;
    return dispatch(
      command,
      'Opening Agent memory bundle import',
      'Opening Agent memory bundle import.',
      'The workspace handed a confirmed Agent-local memory import command to the shell-owned command router.',
      'safe',
    );
  }

  if (editor.kind === 'memory-handoff-export') {
    const confirmation = requireConfirmation(editor, readField, 'Memory handoff export');
    if (confirmation) return confirmation;
    const parts = ['/memory', 'handoff-export', quoteSlashCommandArg(readField('path'))];
    appendOptional(parts, '--scope', readField('scope'));
    parts.push('--yes');
    return dispatch(
      parts.join(' '),
      'Opening Agent memory handoff export',
      'Opening Agent memory handoff export.',
      'The workspace handed a confirmed Agent-local memory handoff export command to the shell-owned command router.',
      'safe',
    );
  }

  if (editor.kind === 'memory-handoff-inspect') {
    const command = `/memory handoff-inspect ${quoteSlashCommandArg(readField('path'))}`;
    return dispatch(
      command,
      'Opening Agent memory handoff inspection',
      'Opening Agent memory handoff inspection.',
      'The workspace handed an Agent-local memory handoff inspection command to the shell-owned command router.',
      'read-only',
    );
  }

  if (editor.kind === 'memory-handoff-import') {
    const confirmation = requireConfirmation(editor, readField, 'Memory handoff import');
    if (confirmation) return confirmation;
    const command = `/memory handoff-import ${quoteSlashCommandArg(readField('path'))} --yes`;
    return dispatch(
      command,
      'Opening Agent memory handoff import',
      'Opening Agent memory handoff import.',
      'The workspace handed a confirmed Agent-local memory handoff import command to the shell-owned command router.',
      'safe',
    );
  }

  const confirmation = requireConfirmation(editor, readField, 'Memory vector rebuild');
  if (confirmation) return confirmation;
  return dispatch(
    '/memory vector rebuild',
    'Opening Agent memory vector rebuild',
    'Opening Agent memory vector rebuild.',
    'The workspace handed a confirmed Agent-local memory vector rebuild command to the shell-owned command router.',
    'safe',
  );
}
