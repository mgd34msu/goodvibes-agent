import type { AgentWorkspaceActionResult, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import { buildAgentWorkspaceAccessCommandEditorSubmission, isAgentWorkspaceAccessCommandSubmissionKind } from './agent-workspace-access-command-editor-submission.ts';
import { buildAgentWorkspaceChannelCommandEditorSubmission, isAgentWorkspaceChannelCommandSubmissionKind } from './agent-workspace-channel-command-editor-submission.ts';
import { buildAgentWorkspaceDelegationEditorSubmission, isAgentWorkspaceDelegationEditorKind } from './agent-workspace-delegation-editor-submission.ts';
import { buildAgentWorkspaceKnowledgeCommandEditorSubmission, isAgentWorkspaceKnowledgeCommandSubmissionKind } from './agent-workspace-knowledge-command-editor-submission.ts';
import { buildAgentWorkspaceLibraryCommandEditorSubmission, isAgentWorkspaceLibraryCommandSubmissionKind } from './agent-workspace-library-command-editor-submission.ts';
import { buildAgentWorkspaceMemoryCommandEditorSubmission, isAgentWorkspaceMemoryCommandSubmissionKind } from './agent-workspace-memory-command-editor-submission.ts';
import { buildAgentWorkspaceMediaCommandEditorSubmission, isAgentWorkspaceMediaCommandSubmissionKind } from './agent-workspace-media-command-editor-submission.ts';
import { buildAgentWorkspaceMcpCommandEditorSubmission, isAgentWorkspaceMcpCommandSubmissionKind } from './agent-workspace-mcp-command-editor-submission.ts';
import { buildAgentWorkspaceNotifyEditorSubmission, isAgentWorkspaceNotifyEditorKind } from './agent-workspace-notify-editor-submission.ts';
import { buildAgentWorkspaceOperationsCommandEditorSubmission, isAgentWorkspaceOperationsCommandSubmissionKind } from './agent-workspace-operations-command-editor-submission.ts';
import { buildAgentWorkspaceProviderCommandEditorSubmission, isAgentWorkspaceProviderCommandSubmissionKind } from './agent-workspace-provider-command-editor-submission.ts';
import { buildAgentWorkspaceSecretEditorSubmission, isAgentWorkspaceSecretEditorKind } from './agent-workspace-secret-editor-submission.ts';
import { buildAgentWorkspaceSessionCommandEditorSubmission, isAgentWorkspaceSessionCommandSubmissionKind } from './agent-workspace-session-command-editor-submission.ts';
import { buildAgentWorkspaceSkillBundleCommandEditorSubmission, isAgentWorkspaceSkillBundleCommandSubmissionKind } from './agent-workspace-skill-bundle-command-editor-submission.ts';
import { buildAgentWorkspaceTaskCommandEditorSubmission, isAgentWorkspaceTaskCommandSubmissionKind } from './agent-workspace-task-command-editor-submission.ts';
import { buildAgentWorkspaceWorkPlanEditorSubmission, isAgentWorkspaceWorkPlanEditorKind } from './agent-workspace-workplan-editor-submission.ts';
import { quoteSlashCommandArg } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

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
  if (editor.kind === 'knowledge-file') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'File ingest not confirmed. Type yes, then press Enter.' },
        status: 'Agent Knowledge file ingest not confirmed.',
      };
    }
    const parts = ['/knowledge', 'ingest-file', quoteSlashCommandArg(readField('path'))];
    const title = readField('title');
    const tags = readField('tags');
    const folder = readField('folder');
    if (title.length > 0) parts.push('--title', quoteSlashCommandArg(title));
    if (tags.length > 0) parts.push('--tags', quoteSlashCommandArg(tags));
    if (folder.length > 0) parts.push('--folder', quoteSlashCommandArg(folder));
    parts.push('--yes');
    const command = parts.join(' ');
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent Knowledge file ingest.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent Knowledge file ingest',
        detail: 'The workspace handed a confirmed file ingest command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'knowledge-urls') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'URL list import not confirmed. Type yes, then press Enter.' },
        status: 'Agent Knowledge URL list import not confirmed.',
      };
    }
    const parts = ['/knowledge', 'import-urls', quoteSlashCommandArg(readField('path'))];
    if (isAffirmative(readField('allowPrivateHosts'))) parts.push('--allow-private-hosts');
    parts.push('--yes');
    const command = parts.join(' ');
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent Knowledge URL list import.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent Knowledge URL list import',
        detail: 'The workspace handed a confirmed URL list import command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'knowledge-browser-history') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Browser history import not confirmed. Type yes, then press Enter.' },
        status: 'Agent Knowledge browser history import not confirmed.',
      };
    }
    const parts = ['/knowledge', 'import-browser-history'];
    const browsers = readField('browsers');
    const sources = readField('sources');
    const limit = readField('limit');
    const sinceDays = readField('sinceDays');
    if (browsers.length > 0) parts.push('--browsers', quoteSlashCommandArg(browsers));
    if (sources.length > 0) parts.push('--sources', quoteSlashCommandArg(sources));
    if (limit.length > 0) parts.push('--limit', quoteSlashCommandArg(limit));
    if (sinceDays.length > 0) parts.push('--since-days', quoteSlashCommandArg(sinceDays));
    parts.push('--yes');
    const command = parts.join(' ');
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent Knowledge browser history import.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent Knowledge browser history import',
        detail: 'The workspace handed a confirmed browser-history import command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'knowledge-connector-ingest') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Connector ingest not confirmed. Type yes, then press Enter.' },
        status: 'Agent Knowledge connector ingest not confirmed.',
      };
    }
    const connectorId = readField('connectorId');
    const input = readField('input');
    const path = readField('path');
    const content = readField('content');
    const parts = ['/knowledge', 'ingest-connector', quoteSlashCommandArg(connectorId)];
    if (input.length > 0) parts.push('--input', quoteSlashCommandArg(input));
    if (path.length > 0) parts.push('--path', quoteSlashCommandArg(path));
    if (content.length > 0) parts.push('--content', quoteSlashCommandArg(content));
    if (isAffirmative(readField('allowPrivateHosts'))) parts.push('--allow-private-hosts');
    parts.push('--yes');
    const command = parts.join(' ');
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent Knowledge connector ingest.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent Knowledge connector ingest',
        detail: 'The workspace handed a confirmed connector ingest command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'knowledge-reindex') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Agent Knowledge reindex not confirmed. Type yes, then press Enter.' },
        status: 'Agent Knowledge reindex not confirmed.',
      };
    }
    const command = '/knowledge reindex --yes';
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent Knowledge reindex.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent Knowledge reindex',
        detail: 'The workspace handed a confirmed reindex command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (isAgentWorkspaceAccessCommandSubmissionKind(editor.kind)) {
    return buildAgentWorkspaceAccessCommandEditorSubmission(editor, readField);
  }
  if (isAgentWorkspaceChannelCommandSubmissionKind(editor.kind)) {
    return buildAgentWorkspaceChannelCommandEditorSubmission(editor, readField);
  }
  if (isAgentWorkspaceKnowledgeCommandSubmissionKind(editor.kind)) {
    return buildAgentWorkspaceKnowledgeCommandEditorSubmission(editor, readField);
  }
  if (isAgentWorkspaceLibraryCommandSubmissionKind(editor.kind)) {
    return buildAgentWorkspaceLibraryCommandEditorSubmission(editor, readField);
  }
  if (isAgentWorkspaceMemoryCommandSubmissionKind(editor.kind)) {
    return buildAgentWorkspaceMemoryCommandEditorSubmission(editor, readField);
  }
  if (isAgentWorkspaceMediaCommandSubmissionKind(editor.kind)) {
    return buildAgentWorkspaceMediaCommandEditorSubmission(editor, readField);
  }
  if (isAgentWorkspaceProviderCommandSubmissionKind(editor.kind)) {
    return buildAgentWorkspaceProviderCommandEditorSubmission(editor, readField);
  }
  if (isAgentWorkspaceSessionCommandSubmissionKind(editor.kind)) {
    return buildAgentWorkspaceSessionCommandEditorSubmission(editor, readField);
  }
  if (isAgentWorkspaceSkillBundleCommandSubmissionKind(editor.kind)) {
    return buildAgentWorkspaceSkillBundleCommandEditorSubmission(editor, readField);
  }
  if (isAgentWorkspaceTaskCommandSubmissionKind(editor.kind)) {
    return buildAgentWorkspaceTaskCommandEditorSubmission(editor, readField);
  }
  if (isAgentWorkspaceMcpCommandSubmissionKind(editor.kind)) {
    return buildAgentWorkspaceMcpCommandEditorSubmission(editor, readField);
  }
  if (isAgentWorkspaceOperationsCommandSubmissionKind(editor.kind)) {
    return buildAgentWorkspaceOperationsCommandEditorSubmission(editor, readField);
  }
  if (isAgentWorkspaceNotifyEditorKind(editor.kind)) return buildAgentWorkspaceNotifyEditorSubmission(editor, readField);
  if (isAgentWorkspaceSecretEditorKind(editor.kind)) {
    return buildAgentWorkspaceSecretEditorSubmission(editor, readField);
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
  if (editor.kind === 'model-pin' || editor.kind === 'model-unpin') {
    const pinning = editor.kind === 'model-pin';
    const command = `/${pinning ? 'pin' : 'unpin'} ${quoteSlashCommandArg(readField('model'))}`;
    return {
      kind: 'dispatch',
      command,
      status: pinning ? 'Opening model pin action.' : 'Opening model unpin action.',
      actionResult: {
        kind: 'dispatched',
        title: pinning ? 'Opening model pin action' : 'Opening model unpin action',
        detail: 'The workspace handed model favorites maintenance to the shell-owned command router.',
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
  if (editor.kind === 'profile-template-show') {
    const command = `/agent-profile template show ${quoteSlashCommandArg(readField('id'))}`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent starter template preview.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent starter template preview',
        detail: 'The workspace handed a read-only starter template preview command to the shell-owned command router.',
        command,
        safety: 'read-only',
      },
    };
  }
  if (editor.kind === 'profile-show') {
    const command = `/agent-profile show ${quoteSlashCommandArg(readField('profile'))}`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent profile detail.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent profile detail',
        detail: 'The workspace handed a read-only Agent profile inspection command to the shell-owned command router.',
        command,
        safety: 'read-only',
      },
    };
  }
  if (editor.kind === 'profile-template-from-discovered') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Starter-from-discovered creation not confirmed. Type yes, then press Enter.' },
        status: 'Agent starter-from-discovered creation not confirmed.',
      };
    }
    const parts = [
      '/agent-profile',
      'template',
      'from-discovered',
      quoteSlashCommandArg(readField('id')),
    ];
    const name = readField('name');
    const description = readField('description');
    const persona = readField('persona');
    const skills = readField('skills');
    const routines = readField('routines');
    if (name.length > 0) parts.push('--name', quoteSlashCommandArg(name));
    if (description.length > 0) parts.push('--description', quoteSlashCommandArg(description));
    if (persona.length > 0) parts.push('--persona', quoteSlashCommandArg(persona));
    if (skills.length > 0) parts.push('--skills', quoteSlashCommandArg(skills));
    if (routines.length > 0) parts.push('--routines', quoteSlashCommandArg(routines));
    if (isAffirmative(readField('replace'))) parts.push('--replace');
    parts.push('--yes');
    const command = parts.join(' ');
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent starter-from-discovered creation.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent starter-from-discovered creation',
        detail: 'The workspace handed a confirmed starter creation command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'profile-from-discovered') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Profile-from-discovered creation not confirmed. Type yes, then press Enter.' },
        status: 'Agent profile-from-discovered creation not confirmed.',
      };
    }
    const parts = [
      '/agent-profile',
      'create-from-discovered',
      quoteSlashCommandArg(readField('profile')),
    ];
    const templateId = readField('templateId');
    const name = readField('name');
    const description = readField('description');
    const persona = readField('persona');
    const skills = readField('skills');
    const routines = readField('routines');
    if (templateId.length > 0) parts.push('--template-id', quoteSlashCommandArg(templateId));
    if (name.length > 0) parts.push('--name', quoteSlashCommandArg(name));
    if (description.length > 0) parts.push('--description', quoteSlashCommandArg(description));
    if (persona.length > 0) parts.push('--persona', quoteSlashCommandArg(persona));
    if (skills.length > 0) parts.push('--skills', quoteSlashCommandArg(skills));
    if (routines.length > 0) parts.push('--routines', quoteSlashCommandArg(routines));
    if (isAffirmative(readField('replace'))) parts.push('--replace');
    parts.push('--yes');
    const command = parts.join(' ');
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent profile-from-discovered creation.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent profile-from-discovered creation',
        detail: 'The workspace handed a confirmed discovered-behavior profile creation command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'profile-default') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Default Agent profile selection not confirmed. Type yes, then press Enter.' },
        status: 'Default Agent profile selection not confirmed.',
      };
    }
    const command = `/agent-profile use ${quoteSlashCommandArg(readField('profile'))} --yes`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening default Agent profile selection.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening default Agent profile selection',
        detail: 'The workspace handed a confirmed default profile selection command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'profile-default-clear') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Default Agent profile clear not confirmed. Type yes, then press Enter.' },
        status: 'Default Agent profile clear not confirmed.',
      };
    }
    const command = '/agent-profile default clear --yes';
    return {
      kind: 'dispatch',
      command,
      status: 'Opening default Agent profile clear.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening default Agent profile clear',
        detail: 'The workspace handed a confirmed default profile clear command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'profile-delete') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Agent profile delete not confirmed. Type yes, then press Enter.' },
        status: 'Agent profile delete not confirmed.',
      };
    }
    const command = `/agent-profile delete ${quoteSlashCommandArg(readField('profile'))} --yes`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent profile deletion.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent profile deletion',
        detail: 'The workspace handed a confirmed profile deletion command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'support-bundle-export') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Agent support bundle export not confirmed. Type yes, then press Enter.' },
        status: 'Agent support bundle export not confirmed.',
      };
    }
    const command = `/bundle export ${quoteSlashCommandArg(readField('path'))} --yes`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent support bundle export.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent support bundle export',
        detail: 'The workspace handed a confirmed support bundle export command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'support-bundle-inspect') {
    const command = `/bundle inspect ${quoteSlashCommandArg(readField('path'))}`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent support bundle inspection.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent support bundle inspection',
        detail: 'The workspace handed a support bundle inspect command to the shell-owned command router.',
        command,
        safety: 'read-only',
      },
    };
  }
  if (editor.kind === 'support-bundle-import') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Agent support bundle import not confirmed. Type yes, then press Enter.' },
        status: 'Agent support bundle import not confirmed.',
      };
    }
    const command = `/bundle import ${quoteSlashCommandArg(readField('path'))} --yes`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening Agent support bundle import.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening Agent support bundle import',
        detail: 'The workspace handed a confirmed support bundle import command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'subscription-inspect') {
    const command = `/subscription inspect ${quoteSlashCommandArg(readField('provider'))}`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening provider subscription inspection.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening provider subscription inspection',
        detail: 'The workspace handed a read-only provider subscription inspection command to the shell-owned command router.',
        command,
        safety: 'read-only',
      },
    };
  }
  if (editor.kind === 'subscription-login-start') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Provider subscription login start not confirmed. Type yes, then press Enter.' },
        status: 'Provider subscription login start not confirmed.',
      };
    }
    const parts = [
      '/subscription',
      'login',
      quoteSlashCommandArg(readField('provider')),
      'start',
    ];
    if (!isAffirmative(readField('openBrowser'))) parts.push('--no-browser');
    if (isAffirmative(readField('manual'))) parts.push('--manual');
    parts.push('--yes');
    const command = parts.join(' ');
    return {
      kind: 'dispatch',
      command,
      status: 'Opening provider subscription login start.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening provider subscription login start',
        detail: 'The workspace handed a confirmed subscription-login start command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'subscription-login-finish') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Provider subscription login finish not confirmed. Type yes, then press Enter.' },
        status: 'Provider subscription login finish not confirmed.',
      };
    }
    const command = `/subscription login ${quoteSlashCommandArg(readField('provider'))} finish ${quoteSlashCommandArg(readField('code'))} --yes`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening provider subscription login finish.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening provider subscription login finish',
        detail: 'The workspace handed a confirmed subscription-login finish command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'subscription-logout') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Provider subscription logout not confirmed. Type yes, then press Enter.' },
        status: 'Provider subscription logout not confirmed.',
      };
    }
    const command = `/subscription logout ${quoteSlashCommandArg(readField('provider'))} --yes`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening provider subscription logout.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening provider subscription logout',
        detail: 'The workspace handed a confirmed provider subscription logout command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (isAgentWorkspaceDelegationEditorKind(editor.kind)) return buildAgentWorkspaceDelegationEditorSubmission(editor, readField);
  if (isAgentWorkspaceWorkPlanEditorKind(editor.kind)) return buildAgentWorkspaceWorkPlanEditorSubmission(editor, readField);
  if (editor.kind === 'skill-discovery-import') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Discovered skill import not confirmed. Type yes, then press Enter.' },
        status: 'Agent skill import not confirmed.',
      };
    }
    const parts = [
      '/agent-skills',
      'import-discovered',
      quoteSlashCommandArg(readField('name')),
    ];
    if (isAffirmative(readField('enabled'))) parts.push('--enabled');
    parts.push('--yes');
    const command = parts.join(' ');
    return {
      kind: 'dispatch',
      command,
      status: 'Opening discovered skill import.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening discovered skill import',
        detail: 'The workspace handed a confirmed local skill import command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'persona-discovery-import') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Discovered persona import not confirmed. Type yes, then press Enter.' },
        status: 'Agent persona import not confirmed.',
      };
    }
    const parts = [
      '/personas',
      'import-discovered',
      quoteSlashCommandArg(readField('name')),
    ];
    if (isAffirmative(readField('use'))) parts.push('--use');
    parts.push('--yes');
    const command = parts.join(' ');
    return {
      kind: 'dispatch',
      command,
      status: 'Opening discovered persona import.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening discovered persona import',
        detail: 'The workspace handed a confirmed local persona import command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'routine-discovery-import') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Discovered routine import not confirmed. Type yes, then press Enter.' },
        status: 'Agent routine import not confirmed.',
      };
    }
    const parts = [
      '/routines',
      'import-discovered',
      quoteSlashCommandArg(readField('name')),
    ];
    if (isAffirmative(readField('enabled'))) parts.push('--enabled');
    parts.push('--yes');
    const command = parts.join(' ');
    return {
      kind: 'dispatch',
      command,
      status: 'Opening discovered routine import.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening discovered routine import',
        detail: 'The workspace handed a confirmed local routine import command to the shell-owned command router.',
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
