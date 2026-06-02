import type { AgentWorkspaceActionResult, AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import { quoteSlashCommandArg, tokenizeSlashCommand } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceBasicCommandEditorKind = Extract<
  AgentWorkspaceEditorKind,
  'knowledge-file' | 'knowledge-bookmarks' | 'knowledge-browser-history' | 'knowledge-connector-ingest' | 'tts-prompt' | 'image-input' | 'skill-bundle' | 'skill-discovery-import' | 'profile-template-export' | 'profile-template-import'
  | 'persona-discovery-import'
  | 'mcp-server' | 'notify-webhook' | 'notify-webhook-remove' | 'notify-webhook-test'
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

function splitCommaList(value: string): readonly string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function isAgentWorkspaceBasicCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceBasicCommandEditorKind {
  return kind === 'knowledge-bookmarks'
    || kind === 'knowledge-file'
    || kind === 'knowledge-browser-history'
    || kind === 'knowledge-connector-ingest'
    || kind === 'tts-prompt'
    || kind === 'image-input'
    || kind === 'skill-bundle'
    || kind === 'persona-discovery-import'
    || kind === 'skill-discovery-import'
    || kind === 'profile-template-export'
    || kind === 'profile-template-import'
    || kind === 'mcp-server'
    || kind === 'notify-webhook'
    || kind === 'notify-webhook-remove'
    || kind === 'notify-webhook-test';
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
  if (kind === 'knowledge-file') {
    return {
      kind,
      mode: 'create',
      title: 'Ingest File into Agent Knowledge',
      selectedFieldIndex: 0,
      message: 'Import a local source-backed file into the isolated Agent Knowledge segment. Type yes on the final field to confirm.',
      fields: [
        { id: 'path', label: 'File path', value: '', required: true, multiline: false, hint: 'Path to a local document or text file to ingest.' },
        { id: 'title', label: 'Title', value: '', required: false, multiline: false, hint: 'Optional source title.' },
        { id: 'tags', label: 'Tags', value: '', required: false, multiline: false, hint: 'Comma-separated optional tags.' },
        { id: 'folder', label: 'Folder', value: '', required: false, multiline: false, hint: 'Optional Agent Knowledge folder path.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /knowledge ingest-file with --yes.' },
      ],
    };
  }
  if (kind === 'knowledge-browser-history') {
    return {
      kind,
      mode: 'create',
      title: 'Import Browser History into Agent Knowledge',
      selectedFieldIndex: 0,
      message: 'Import local browser history/bookmarks into the isolated Agent Knowledge segment. Type yes on the final field to confirm.',
      fields: [
        { id: 'browsers', label: 'Browsers', value: '', required: false, multiline: false, hint: 'Optional comma list: chrome, brave, edge, firefox, safari, etc.' },
        { id: 'sources', label: 'Sources', value: 'history,bookmark', required: false, multiline: false, hint: 'history, bookmark, or both.' },
        { id: 'limit', label: 'Limit', value: '250', required: false, multiline: false, hint: 'Maximum browser entries to import.' },
        { id: 'sinceDays', label: 'Since days', value: '', required: false, multiline: false, hint: 'Optional age window, such as 30.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /knowledge import-browser-history with --yes.' },
      ],
    };
  }
  if (kind === 'knowledge-connector-ingest') {
    return {
      kind,
      mode: 'create',
      title: 'Ingest Connector Input',
      selectedFieldIndex: 0,
      message: 'Send explicit connector input into the isolated Agent Knowledge segment. Type yes on the final field to confirm.',
      fields: [
        { id: 'connectorId', label: 'Connector id', value: '', required: true, multiline: false, hint: 'Connector id from /knowledge connectors.' },
        { id: 'input', label: 'Input', value: '', required: false, multiline: true, hint: 'Optional JSON or text input. Ctrl-J inserts a new line.' },
        { id: 'path', label: 'Path', value: '', required: false, multiline: false, hint: 'Optional local path for connectors that read files.' },
        { id: 'content', label: 'Content', value: '', required: false, multiline: true, hint: 'Optional raw content for connectors that accept text.' },
        { id: 'allowPrivateHosts', label: 'Allow private hosts', value: 'no', required: false, multiline: false, hint: 'yes/no. Defaults to no.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /knowledge ingest-connector with --yes.' },
      ],
    };
  }
  if (kind === 'mcp-server') {
    return {
      kind,
      mode: 'create',
      title: 'Add MCP Server',
      selectedFieldIndex: 0,
      message: 'Add or update one MCP server from the Agent workspace. Type yes on the final field to confirm.',
      fields: [
        { id: 'name', label: 'Server name', value: '', required: true, multiline: false, hint: 'Letters, numbers, dot, underscore, and dash only.' },
        { id: 'command', label: 'Command', value: '', required: true, multiline: false, hint: 'Executable command, such as bunx, npx, uvx, or a full local binary path.' },
        { id: 'args', label: 'Arguments', value: '', required: false, multiline: false, hint: 'Optional command arguments. Quotes are supported.' },
        { id: 'scope', label: 'Scope', value: '', required: false, multiline: false, hint: 'Optional. Defaults to project. Use project or global.' },
        { id: 'role', label: 'Role', value: '', required: false, multiline: false, hint: 'Optional. general, docs, filesystem, git, database, browser, automation, ops, or remote.' },
        { id: 'trust', label: 'Trust mode', value: '', required: false, multiline: false, hint: 'Optional. Defaults to constrained. Use constrained, ask-on-risk, or blocked. Use settings for allow-all.' },
        { id: 'env', label: 'Env refs', value: '', required: false, multiline: false, hint: 'Comma-separated KEY=VALUE entries. Prefer secret refs, not raw secrets.' },
        { id: 'paths', label: 'Allowed paths', value: '', required: false, multiline: false, hint: 'Comma-separated path allowlist entries.' },
        { id: 'hosts', label: 'Allowed hosts', value: '', required: false, multiline: false, hint: 'Comma-separated host allowlist entries.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /mcp add with --yes.' },
      ],
    };
  }
  if (kind === 'notify-webhook') {
    return {
      kind,
      mode: 'create',
      title: 'Add Notification Webhook',
      selectedFieldIndex: 0,
      message: 'Add one webhook notification target for explicit reminder/routine delivery. Type yes on the final field to confirm.',
      fields: [
        { id: 'url', label: 'Webhook URL', value: '', required: true, multiline: false, hint: 'HTTP(S) target, for example https://ntfy.sh/my-topic.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /notify add with --yes.' },
      ],
    };
  }
  if (kind === 'notify-webhook-remove') {
    return {
      kind,
      mode: 'delete',
      title: 'Remove Notification Webhook',
      selectedFieldIndex: 0,
      message: 'Remove one configured webhook notification target. Type yes on the final field to confirm.',
      fields: [
        { id: 'url', label: 'Webhook URL', value: '', required: true, multiline: false, hint: 'Exact HTTP(S) webhook URL to remove from configured notification targets.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /notify remove with --yes.' },
      ],
    };
  }
  if (kind === 'notify-webhook-test') {
    return {
      kind,
      mode: 'create',
      title: 'Test Notification Webhooks',
      selectedFieldIndex: 0,
      message: 'Send one test notification to configured webhook targets. Type yes on the final field to confirm.',
      fields: [
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /notify test with --yes.' },
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
  if (kind === 'skill-discovery-import') {
    return {
      kind,
      mode: 'create',
      title: 'Import Discovered Skill',
      selectedFieldIndex: 0,
      message: 'Import one discovered SKILL.md or .md skill file into the Agent-local skill registry. Type yes on the final field to confirm.',
      fields: [
        { id: 'name', label: 'Discovered skill', value: '', required: true, multiline: false, hint: 'Name shown by /agent-skills discover.' },
        { id: 'enabled', label: 'Enable now', value: 'yes', required: false, multiline: false, hint: 'yes/no.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /agent-skills import-discovered with --yes.' },
      ],
    };
  }
  if (kind === 'persona-discovery-import') {
    return {
      kind,
      mode: 'create',
      title: 'Import Discovered Persona',
      selectedFieldIndex: 0,
      message: 'Import one discovered persona markdown file into the Agent-local persona registry. Type yes on the final field to confirm.',
      fields: [
        { id: 'name', label: 'Discovered persona', value: '', required: true, multiline: false, hint: 'Name shown by /personas discover.' },
        { id: 'use', label: 'Use now', value: 'yes', required: false, multiline: false, hint: 'yes/no.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /personas import-discovered with --yes.' },
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
  if (editor.kind === 'mcp-server') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'MCP server add/update not confirmed. Type yes, then press Enter.' },
        status: 'MCP server add/update not confirmed.',
      };
    }
    const parts = [
      '/mcp',
      'add',
      quoteSlashCommandArg(readField('name')),
      quoteSlashCommandArg(readField('command')),
      ...tokenizeSlashCommand(readField('args')).map(quoteSlashCommandArg),
    ];
    const scope = readField('scope');
    const role = readField('role');
    const trust = readField('trust');
    if (scope.length > 0) parts.push('--scope', quoteSlashCommandArg(scope));
    if (role.length > 0) parts.push('--role', quoteSlashCommandArg(role));
    if (trust.length > 0) parts.push('--trust', quoteSlashCommandArg(trust));
    for (const env of splitCommaList(readField('env'))) parts.push('--env', quoteSlashCommandArg(env));
    for (const path of splitCommaList(readField('paths'))) parts.push('--path', quoteSlashCommandArg(path));
    for (const host of splitCommaList(readField('hosts'))) parts.push('--host', quoteSlashCommandArg(host));
    parts.push('--yes');
    const command = parts.join(' ');
    return {
      kind: 'dispatch',
      command,
      status: 'Opening MCP server add/update.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening MCP server add/update',
        detail: 'The workspace handed a confirmed MCP server add/update command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'notify-webhook') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Notification webhook add not confirmed. Type yes, then press Enter.' },
        status: 'Notification webhook add not confirmed.',
      };
    }
    const command = `/notify add ${quoteSlashCommandArg(readField('url'))} --yes`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening notification webhook add.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening notification webhook add',
        detail: 'The workspace handed a confirmed notification target command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'notify-webhook-remove') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Notification webhook remove not confirmed. Type yes, then press Enter.' },
        status: 'Notification webhook remove not confirmed.',
      };
    }
    const command = `/notify remove ${quoteSlashCommandArg(readField('url'))} --yes`;
    return {
      kind: 'dispatch',
      command,
      status: 'Opening notification webhook remove.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening notification webhook remove',
        detail: 'The workspace handed a confirmed notification target remove command to the shell-owned command router.',
        command,
        safety: 'safe',
      },
    };
  }
  if (editor.kind === 'notify-webhook-test') {
    if (!isAffirmative(readField('confirm'))) {
      return {
        kind: 'editor',
        editor: { ...editor, message: 'Notification webhook test not confirmed. Type yes, then press Enter.' },
        status: 'Notification webhook test not confirmed.',
      };
    }
    const command = '/notify test --yes';
    return {
      kind: 'dispatch',
      command,
      status: 'Opening notification webhook test.',
      actionResult: {
        kind: 'dispatched',
        title: 'Opening notification webhook test',
        detail: 'The workspace handed a confirmed notification test command to the shell-owned command router.',
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
