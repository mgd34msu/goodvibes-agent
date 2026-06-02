import type { AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';

export type AgentWorkspaceSkillBundleCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  | 'skill-bundle-search'
  | 'skill-bundle-show'
  | 'skill-bundle-update'
  | 'skill-bundle-enable'
  | 'skill-bundle-disable'
  | 'skill-bundle-review'
  | 'skill-bundle-stale'
  | 'skill-bundle-delete'
>;

export function isAgentWorkspaceSkillBundleCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceSkillBundleCommandEditorKind {
  return kind === 'skill-bundle-search'
    || kind === 'skill-bundle-show'
    || kind === 'skill-bundle-update'
    || kind === 'skill-bundle-enable'
    || kind === 'skill-bundle-disable'
    || kind === 'skill-bundle-review'
    || kind === 'skill-bundle-stale'
    || kind === 'skill-bundle-delete';
}

export function createAgentWorkspaceSkillBundleCommandEditor(kind: AgentWorkspaceSkillBundleCommandEditorKind): AgentWorkspaceLocalEditor {
  if (kind === 'skill-bundle-search') {
    return {
      kind,
      mode: 'create',
      title: 'Search Skill Bundles',
      selectedFieldIndex: 0,
      message: 'Search local Agent skill bundles by name, description, or member skill.',
      fields: [
        { id: 'query', label: 'Search query', value: '', required: false, multiline: false, hint: 'Optional text query. Blank lists every bundle.' },
      ],
    };
  }
  if (kind === 'skill-bundle-show') {
    return {
      kind,
      mode: 'create',
      title: 'Show Skill Bundle',
      selectedFieldIndex: 0,
      message: 'Show one local Agent skill bundle with readiness and member skills.',
      fields: [
        { id: 'id', label: 'Bundle id', value: '', required: true, multiline: false, hint: 'Existing local skill bundle id.' },
      ],
    };
  }
  if (kind === 'skill-bundle-update') {
    return {
      kind,
      mode: 'update',
      title: 'Update Skill Bundle',
      selectedFieldIndex: 0,
      message: 'Update one local Agent skill bundle. Type yes on the final field to confirm.',
      fields: [
        { id: 'id', label: 'Bundle id', value: '', required: true, multiline: false, hint: 'Existing local skill bundle id.' },
        { id: 'name', label: 'Name', value: '', required: false, multiline: false, hint: 'Optional replacement name.' },
        { id: 'description', label: 'Description', value: '', required: false, multiline: false, hint: 'Optional replacement one-line description.' },
        { id: 'skills', label: 'Skill ids', value: '', required: false, multiline: false, hint: 'Optional replacement comma-separated local skill ids.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /agent-skills bundle update.' },
      ],
    };
  }
  if (kind === 'skill-bundle-stale') {
    return {
      kind,
      mode: 'update',
      title: 'Mark Skill Bundle Stale',
      selectedFieldIndex: 0,
      message: 'Mark one local Agent skill bundle stale with a review reason. Type yes on the final field to confirm.',
      fields: [
        { id: 'id', label: 'Bundle id', value: '', required: true, multiline: false, hint: 'Existing local skill bundle id.' },
        { id: 'reason', label: 'Reason', value: '', required: true, multiline: true, hint: 'Why this bundle needs review. Ctrl-J inserts a new line.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /agent-skills bundle stale.' },
      ],
    };
  }
  if (kind === 'skill-bundle-delete') {
    return {
      kind,
      mode: 'delete',
      title: 'Delete Skill Bundle',
      selectedFieldIndex: 0,
      message: 'Delete one local Agent skill bundle. This does not delete member skills. Type yes to confirm.',
      fields: [
        { id: 'id', label: 'Bundle id', value: '', required: true, multiline: false, hint: 'Existing local skill bundle id.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /agent-skills bundle delete with --yes.' },
      ],
    };
  }
  const verb = kind === 'skill-bundle-enable'
    ? 'Enable'
    : kind === 'skill-bundle-disable'
      ? 'Disable'
      : 'Review';
  return {
    kind,
    mode: 'update',
    title: `${verb} Skill Bundle`,
    selectedFieldIndex: 0,
    message: `${verb} one local Agent skill bundle. Type yes on the final field to confirm.`,
    fields: [
      { id: 'id', label: 'Bundle id', value: '', required: true, multiline: false, hint: 'Existing local skill bundle id.' },
      { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: `Type yes to run /agent-skills bundle ${verb.toLowerCase()}.` },
    ],
  };
}
