import type { AgentWorkspaceActionResult, AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceBasicCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  'knowledge-bookmarks' | 'tts-prompt' | 'image-input' | 'skill-bundle' | 'profile-template-export' | 'profile-template-import'
>;

export type AgentWorkspaceBasicCommandEditorSubmission =
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

function isAffirmative(value: string): boolean {
  return /^(y|yes|true)$/i.test(value.trim());
}

export function isAgentWorkspaceBasicCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceBasicCommandEditorKind {
  return kind === 'knowledge-bookmarks'
    || kind === 'tts-prompt'
    || kind === 'image-input'
    || kind === 'skill-bundle'
    || kind === 'profile-template-export'
    || kind === 'profile-template-import';
}

export function createAgentWorkspaceBasicCommandEditor(kind: AgentWorkspaceBasicCommandEditorKind): AgentWorkspaceLocalEditor {
  if (kind === 'knowledge-bookmarks') {
    return {
      kind,
      mode: 'create',
      title: 'Import Bookmarks into Agent Knowledge',
      selectedFieldIndex: 0,
      message: 'Import a browser bookmark export into the isolated Agent Knowledge segment. Type yes on the final field to confirm.',
      fields: [
        { id: 'path', label: 'Bookmark export path', value: '', required: true, multiline: false, hint: 'Path to an HTML or JSON browser bookmark export.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /knowledge import-bookmarks with --yes.' },
      ],
    };
  }
  if (kind === 'tts-prompt') {
    return {
      kind,
      mode: 'create',
      title: 'Speak Assistant Reply',
      selectedFieldIndex: 0,
      message: 'Submit a normal assistant prompt and play the reply through configured live TTS.',
      fields: [
        { id: 'prompt', label: 'Prompt', value: '', required: true, multiline: true, hint: 'Assistant prompt to speak. Ctrl-J inserts a new line.' },
      ],
    };
  }
  if (kind === 'image-input') {
    return {
      kind,
      mode: 'create',
      title: 'Attach Image Input',
      selectedFieldIndex: 0,
      message: 'Attach an image to the next assistant turn. The existing image command validates file type and model support.',
      fields: [
        { id: 'path', label: 'Image path', value: '', required: true, multiline: false, hint: 'PNG, JPEG, WebP, or GIF path under the current workspace.' },
        { id: 'prompt', label: 'Prompt', value: '', required: false, multiline: true, hint: 'Optional prompt. Ctrl-J inserts a new line.' },
      ],
    };
  }
  if (kind === 'profile-template-export') {
    return {
      kind,
      mode: 'create',
      title: 'Export Agent Starter Template',
      selectedFieldIndex: 0,
      message: 'Export a starter template JSON file for review and customization. Type yes on the final field to confirm.',
      fields: [
        { id: 'templateId', label: 'Starter id', value: '', required: true, multiline: false, hint: 'Existing starter id from /agent-profile templates.' },
        { id: 'path', label: 'Output path', value: '', required: true, multiline: false, hint: 'Workspace-relative JSON path to write.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /agent-profile template export with --yes.' },
      ],
    };
  }
  if (kind === 'profile-template-import') {
    return {
      kind,
      mode: 'create',
      title: 'Import Agent Starter Template',
      selectedFieldIndex: 0,
      message: 'Import a reviewed starter template JSON file into this Agent home. Type yes on the final field to confirm.',
      fields: [
        { id: 'path', label: 'Template path', value: '', required: true, multiline: false, hint: 'Workspace-relative JSON path to import.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /agent-profile template import with --yes.' },
      ],
    };
  }
  return {
    kind,
    mode: 'create',
    title: 'Create Skill Bundle',
    selectedFieldIndex: 0,
    message: 'Group existing local skills into a reviewable bundle that can be enabled together.',
    fields: [
      { id: 'name', label: 'Bundle name', value: '', required: true, multiline: false, hint: 'Short bundle name.' },
      { id: 'description', label: 'Description', value: '', required: true, multiline: false, hint: 'One-line bundle summary.' },
      { id: 'skills', label: 'Skill ids', value: '', required: true, multiline: false, hint: 'Comma-separated existing local skill ids.' },
      { id: 'enabled', label: 'Enable now', value: 'yes', required: false, multiline: false, hint: 'yes/no.' },
    ],
  };
}

export function buildAgentWorkspaceBasicCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
  commandDispatchAvailable: boolean,
): AgentWorkspaceBasicCommandEditorSubmission {
  if (!commandDispatchAvailable) {
    return {
      kind: 'editor',
      editor: { ...editor, message: 'Command dispatch is unavailable; this action cannot run from this workspace.' },
      status: 'Command dispatch unavailable.',
      actionResult: {
        kind: 'error',
        title: 'Command dispatch unavailable',
        detail: 'The Agent workspace cannot hand this action to the shell-owned command router.',
      },
    };
  }
  if (editor.kind === 'knowledge-bookmarks') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Bookmark import not confirmed. Type yes, then press Enter.' },
        status: 'Agent Knowledge bookmark import not confirmed.',
      };
    }
    const command = `/knowledge import-bookmarks ${quoteSlashCommandArg(readField('path'))} --yes`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent Knowledge bookmark import.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent Knowledge bookmark import',
        detail: 'The workspace handed a confirmed bookmark import command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'tts-prompt') {
    const command = `/tts ${quoteSlashCommandArg(readField('prompt'))}`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening spoken assistant prompt.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening spoken assistant prompt',
        detail: 'The workspace handed a spoken prompt to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'image-input') {
    const prompt = readField('prompt');
    const command = prompt.length > 0
      ? `/image ${quoteSlashCommandArg(readField('path'))} ${quoteSlashCommandArg(prompt)}`
      : `/image ${quoteSlashCommandArg(readField('path'))}`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening image input.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening image input',
        detail: 'The workspace handed an image attachment command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'profile-template-export') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Starter template export not confirmed. Type yes, then press Enter.' },
        status: 'Agent starter template export not confirmed.',
      };
    }
    const command = `/agent-profile template export ${quoteSlashCommandArg(readField('templateId'))} ${quoteSlashCommandArg(readField('path'))} --yes`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent starter template export.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent starter template export',
        detail: 'The workspace handed a confirmed starter template export command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'profile-template-import') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Starter template import not confirmed. Type yes, then press Enter.' },
        status: 'Agent starter template import not confirmed.',
      };
    }
    const command = `/agent-profile template import ${quoteSlashCommandArg(readField('path'))} --yes`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent starter template import.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent starter template import',
        detail: 'The workspace handed a confirmed starter template import command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  const commandParts = [
    '/agent-skills bundle create',
    '--name',
    quoteSlashCommandArg(readField('name')),
    '--description',
    quoteSlashCommandArg(readField('description')),
    '--skills',
    quoteSlashCommandArg(readField('skills')),
  ];
  if (isAffirmative(readField('enabled'))) commandParts.push('--enabled');
  const command = commandParts.join(' ');
  return {
    kind: 'dispatch',
    command,
    status: 'Opening skill bundle creation.',
    actionResult: {
      kind: 'dispatched',
      title: 'Opening skill bundle creation',
      detail: 'The workspace handed a concrete local skill bundle command to the shell-owned command router.',
      command,
      safety: 'safe',
    },
  };
}
