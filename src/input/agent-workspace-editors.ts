import type { AgentPersonaRecord } from '../agent/persona-registry.ts';
import type { AgentRoutineRecord } from '../agent/routine-registry.ts';
import type { AgentSkillRecord } from '../agent/skill-registry.ts';
import type {
  AgentWorkspaceLocalEditor,
  AgentWorkspaceLocalEditorKind,
  AgentWorkspaceLocalLibraryItem,
  AgentWorkspaceRuntimeStarterTemplateItem,
} from './agent-workspace-types.ts';

export function createProfileEditor(templates: readonly AgentWorkspaceRuntimeStarterTemplateItem[]): AgentWorkspaceLocalEditor {
  const defaultTemplate = templates.find((template) => template.id === 'research')?.id ?? templates[0]?.id ?? 'none';
  const preview = templates.length === 0
    ? 'No starter templates found; use none to create an empty isolated profile.'
    : templates
      .slice(0, 6)
      .map((template) => `${template.id} (${template.name})`)
      .join(', ');
  return {
    kind: 'profile',
    mode: 'create',
    title: 'Create Agent Profile',
    selectedFieldIndex: 0,
    message: 'Create an isolated Agent home seeded with a persona, skills, and routines. The current process keeps using its existing home until relaunched with --agent-profile.',
    fields: [
      { id: 'name', label: 'Profile name', value: '', required: true, multiline: false, hint: 'Short profile name. It normalizes to lowercase letters, numbers, dots, underscores, and dashes.' },
      { id: 'template', label: 'Starter template', value: defaultTemplate, required: false, multiline: false, hint: `Template id or none. Available: ${preview}.` },
    ],
  };
}

export function createLocalEditor(kind: AgentWorkspaceLocalEditorKind): AgentWorkspaceLocalEditor {
  if (kind === 'profile') return createProfileEditor([]);
  if (kind === 'persona') {
    return {
      kind,
      mode: 'create',
      title: 'Create Persona',
      selectedFieldIndex: 0,
      message: 'Enter a local behavior profile for the serial main-conversation assistant.',
      fields: [
        { id: 'name', label: 'Name', value: '', required: true, multiline: false, hint: 'Short persona name.' },
        { id: 'description', label: 'Description', value: '', required: true, multiline: false, hint: 'One-line summary of when to use it.' },
        { id: 'body', label: 'Instructions', value: '', required: true, multiline: true, hint: 'Operating guidance. Ctrl-J inserts a new line.' },
        { id: 'tags', label: 'Tags', value: '', required: false, multiline: false, hint: 'Comma-separated optional tags.' },
        { id: 'triggers', label: 'Triggers', value: '', required: false, multiline: false, hint: 'Comma-separated words that suggest this persona.' },
        { id: 'activate', label: 'Activate now', value: 'yes', required: false, multiline: false, hint: 'yes/no.' },
      ],
    };
  }
  if (kind === 'skill') {
    return {
      kind,
      mode: 'create',
      title: 'Create Skill',
      selectedFieldIndex: 0,
      message: 'Enter a reusable local procedure the assistant can apply from the main conversation.',
      fields: [
        { id: 'name', label: 'Name', value: '', required: true, multiline: false, hint: 'Short skill name.' },
        { id: 'description', label: 'Description', value: '', required: true, multiline: false, hint: 'One-line summary of the procedure.' },
        { id: 'procedure', label: 'Procedure', value: '', required: true, multiline: true, hint: 'Reusable steps. Ctrl-J inserts a new line.' },
        { id: 'triggers', label: 'Triggers', value: '', required: false, multiline: false, hint: 'Comma-separated words that suggest this skill.' },
        { id: 'tags', label: 'Tags', value: '', required: false, multiline: false, hint: 'Comma-separated optional tags.' },
        { id: 'enabled', label: 'Enable now', value: 'yes', required: false, multiline: false, hint: 'yes/no.' },
      ],
    };
  }
  return {
    kind,
    mode: 'create',
    title: 'Create Routine',
    selectedFieldIndex: 0,
    message: 'Enter a repeatable workflow. It runs in the main conversation unless explicitly promoted to an external schedule.',
    fields: [
      { id: 'name', label: 'Name', value: '', required: true, multiline: false, hint: 'Short routine name.' },
      { id: 'description', label: 'Description', value: '', required: true, multiline: false, hint: 'One-line summary of the workflow.' },
      { id: 'steps', label: 'Steps', value: '', required: true, multiline: true, hint: 'Workflow steps. Ctrl-J inserts a new line.' },
      { id: 'triggers', label: 'Triggers', value: '', required: false, multiline: false, hint: 'Comma-separated words that suggest this routine.' },
      { id: 'tags', label: 'Tags', value: '', required: false, multiline: false, hint: 'Comma-separated optional tags.' },
      { id: 'enabled', label: 'Enable now', value: 'yes', required: false, multiline: false, hint: 'yes/no.' },
    ],
  };
}

export function createPersonaUpdateEditor(record: AgentPersonaRecord, active: boolean): AgentWorkspaceLocalEditor {
  return {
    kind: 'persona',
    mode: 'update',
    recordId: record.id,
    title: 'Edit Persona',
    selectedFieldIndex: 0,
    message: `Editing ${record.name}. Saving marks it fresh for review.`,
    fields: [
      { id: 'name', label: 'Name', value: record.name, required: true, multiline: false, hint: 'Short persona name.' },
      { id: 'description', label: 'Description', value: record.description, required: true, multiline: false, hint: 'One-line summary of when to use it.' },
      { id: 'body', label: 'Instructions', value: record.body, required: true, multiline: true, hint: 'Operating guidance. Ctrl-J inserts a new line.' },
      { id: 'tags', label: 'Tags', value: record.tags.join(', '), required: false, multiline: false, hint: 'Comma-separated optional tags.' },
      { id: 'triggers', label: 'Triggers', value: record.triggers.join(', '), required: false, multiline: false, hint: 'Comma-separated words that suggest this persona.' },
      { id: 'activate', label: 'Active', value: active ? 'yes' : 'no', required: false, multiline: false, hint: 'yes/no. Setting no clears this persona only if it is currently active.' },
    ],
  };
}

export function createSkillUpdateEditor(record: AgentSkillRecord): AgentWorkspaceLocalEditor {
  return {
    kind: 'skill',
    mode: 'update',
    recordId: record.id,
    title: 'Edit Skill',
    selectedFieldIndex: 0,
    message: `Editing ${record.name}. Saving marks it fresh for review.`,
    fields: [
      { id: 'name', label: 'Name', value: record.name, required: true, multiline: false, hint: 'Short skill name.' },
      { id: 'description', label: 'Description', value: record.description, required: true, multiline: false, hint: 'One-line summary of the procedure.' },
      { id: 'procedure', label: 'Procedure', value: record.procedure, required: true, multiline: true, hint: 'Reusable steps. Ctrl-J inserts a new line.' },
      { id: 'triggers', label: 'Triggers', value: record.triggers.join(', '), required: false, multiline: false, hint: 'Comma-separated words that suggest this skill.' },
      { id: 'tags', label: 'Tags', value: record.tags.join(', '), required: false, multiline: false, hint: 'Comma-separated optional tags.' },
      { id: 'enabled', label: 'Enabled', value: record.enabled ? 'yes' : 'no', required: false, multiline: false, hint: 'yes/no.' },
    ],
  };
}

export function createRoutineUpdateEditor(record: AgentRoutineRecord): AgentWorkspaceLocalEditor {
  return {
    kind: 'routine',
    mode: 'update',
    recordId: record.id,
    title: 'Edit Routine',
    selectedFieldIndex: 0,
    message: `Editing ${record.name}. Saving marks it fresh for review.`,
    fields: [
      { id: 'name', label: 'Name', value: record.name, required: true, multiline: false, hint: 'Short routine name.' },
      { id: 'description', label: 'Description', value: record.description, required: true, multiline: false, hint: 'One-line summary of the workflow.' },
      { id: 'steps', label: 'Steps', value: record.steps, required: true, multiline: true, hint: 'Workflow steps. Ctrl-J inserts a new line.' },
      { id: 'triggers', label: 'Triggers', value: record.triggers.join(', '), required: false, multiline: false, hint: 'Comma-separated words that suggest this routine.' },
      { id: 'tags', label: 'Tags', value: record.tags.join(', '), required: false, multiline: false, hint: 'Comma-separated optional tags.' },
      { id: 'enabled', label: 'Enabled', value: record.enabled ? 'yes' : 'no', required: false, multiline: false, hint: 'yes/no.' },
    ],
  };
}

export function createDeleteEditor(kind: AgentWorkspaceLocalEditorKind, item: AgentWorkspaceLocalLibraryItem): AgentWorkspaceLocalEditor {
  const label = kind[0]!.toUpperCase() + kind.slice(1);
  return {
    kind,
    mode: 'delete',
    recordId: item.id,
    title: `Delete ${label}`,
    selectedFieldIndex: 0,
    message: `Type ${item.id} exactly to delete ${item.name}. This only changes the Agent-local registry.`,
    fields: [
      { id: 'confirm', label: 'Confirm id', value: '', required: true, multiline: false, hint: `Type ${item.id} exactly.` },
    ],
  };
}

export function splitList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

export function isAffirmative(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === '' || normalized === 'yes' || normalized === 'y' || normalized === 'true' || normalized === 'enabled' || normalized === 'on';
}

export function editorCategoryId(kind: AgentWorkspaceLocalEditorKind): string {
  if (kind === 'profile') return 'profiles';
  if (kind === 'persona') return 'personas';
  if (kind === 'skill') return 'skills';
  return 'routines';
}
