import type { AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

export type AgentWorkspaceLibraryCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  'persona-search' | 'persona-show' | 'skill-search' | 'skill-show' | 'routine-search' | 'routine-show'
>;

export function isAgentWorkspaceLibraryCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceLibraryCommandEditorKind {
  return kind === 'persona-search'
    || kind === 'persona-show'
    || kind === 'skill-search'
    || kind === 'skill-show'
    || kind === 'routine-search'
    || kind === 'routine-show';
}

export function createAgentWorkspaceLibraryCommandEditor(kind: AgentWorkspaceLibraryCommandEditorKind): AgentWorkspaceLocalEditor {
  const target = kind.startsWith('persona') ? 'persona' : kind.startsWith('skill') ? 'skill' : 'routine';
  const search = kind.endsWith('search');
  const label = target === 'persona' ? 'Persona' : target === 'skill' ? 'Skill' : 'Routine';
  return {
    kind,
    mode: 'create',
    title: search ? `Search ${label}s` : `Show ${label}`,
    selectedFieldIndex: 0,
    message: search
      ? `Search local Agent ${target}s by name, description, tags, triggers, or body.`
      : `Show one local Agent ${target} by id.`,
    fields: [
      search
        ? { id: 'query', label: 'Search query', value: '', required: false, multiline: false, hint: `Optional text query. Blank lists every local ${target}.` }
        : { id: 'id', label: `${label} id`, value: '', required: true, multiline: false, hint: `Existing local ${target} id.` },
    ],
  };
}
