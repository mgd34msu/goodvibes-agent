import type { AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import type { AgentWorkspaceAccessCommandEditorKind } from './agent-workspace-access-command-editors.ts';
import { createAgentWorkspaceAccessCommandEditor, isAgentWorkspaceAccessCommandEditorKind } from './agent-workspace-access-command-editors.ts';
import type { AgentWorkspaceChannelCommandEditorKind } from './agent-workspace-channel-command-editors.ts';
import { createAgentWorkspaceChannelCommandEditor, isAgentWorkspaceChannelCommandEditorKind } from './agent-workspace-channel-command-editors.ts';
import type { AgentWorkspaceKnowledgeCommandEditorKind } from './agent-workspace-knowledge-command-editors.ts';
import { createAgentWorkspaceKnowledgeCommandEditor, isAgentWorkspaceKnowledgeCommandEditorKind } from './agent-workspace-knowledge-command-editors.ts';
import type { AgentWorkspaceLibraryCommandEditorKind } from './agent-workspace-library-command-editors.ts';
import { createAgentWorkspaceLibraryCommandEditor, isAgentWorkspaceLibraryCommandEditorKind } from './agent-workspace-library-command-editors.ts';
import type { AgentWorkspaceMemoryCommandEditorKind } from './agent-workspace-memory-command-editors.ts';
import { createAgentWorkspaceMemoryCommandEditor, isAgentWorkspaceMemoryCommandEditorKind } from './agent-workspace-memory-command-editors.ts';
import type { AgentWorkspaceMediaCommandEditorKind } from './agent-workspace-media-command-editors.ts';
import { createAgentWorkspaceMediaCommandEditor, isAgentWorkspaceMediaCommandEditorKind } from './agent-workspace-media-command-editors.ts';
import type { AgentWorkspaceOperationsCommandEditorKind } from './agent-workspace-operations-command-editors.ts';
import { createAgentWorkspaceOperationsCommandEditor, isAgentWorkspaceOperationsCommandEditorKind } from './agent-workspace-operations-command-editors.ts';
import type { AgentWorkspaceProviderCommandEditorKind } from './agent-workspace-provider-command-editors.ts';
import { createAgentWorkspaceProviderCommandEditor, isAgentWorkspaceProviderCommandEditorKind } from './agent-workspace-provider-command-editors.ts';
import type { AgentWorkspaceSessionCommandEditorKind } from './agent-workspace-session-command-editors.ts';
import { createAgentWorkspaceSessionCommandEditor, isAgentWorkspaceSessionCommandEditorKind } from './agent-workspace-session-command-editors.ts';
import type { AgentWorkspaceSkillBundleCommandEditorKind } from './agent-workspace-skill-bundle-command-editors.ts';
import { createAgentWorkspaceSkillBundleCommandEditor, isAgentWorkspaceSkillBundleCommandEditorKind } from './agent-workspace-skill-bundle-command-editors.ts';
import type { AgentWorkspaceTaskCommandEditorKind } from './agent-workspace-task-command-editors.ts';
import { createAgentWorkspaceTaskCommandEditor, isAgentWorkspaceTaskCommandEditorKind } from './agent-workspace-task-command-editors.ts';
export type { AgentWorkspaceBasicCommandEditorSubmission } from './agent-workspace-basic-command-editor-submission.ts';
export { buildAgentWorkspaceBasicCommandEditorSubmission } from './agent-workspace-basic-command-editor-submission.ts';

export type AgentWorkspaceBasicCommandEditorKind = AgentWorkspaceAccessCommandEditorKind | AgentWorkspaceChannelCommandEditorKind | AgentWorkspaceKnowledgeCommandEditorKind | AgentWorkspaceLibraryCommandEditorKind | AgentWorkspaceMemoryCommandEditorKind | AgentWorkspaceMediaCommandEditorKind | AgentWorkspaceOperationsCommandEditorKind | AgentWorkspaceProviderCommandEditorKind | AgentWorkspaceSessionCommandEditorKind | AgentWorkspaceSkillBundleCommandEditorKind | AgentWorkspaceTaskCommandEditorKind | Extract<
  AgentWorkspaceEditorKind,
  'knowledge-file' | 'knowledge-urls' | 'knowledge-bookmarks' | 'knowledge-browser-history' | 'knowledge-connector-ingest' | 'knowledge-reindex' | 'tts-prompt' | 'image-input' | 'skill-bundle' | 'skill-discovery-import' | 'profile-template-export' | 'profile-template-import'
  | 'profile-template-from-discovered' | 'profile-from-discovered' | 'profile-default' | 'profile-default-clear'
  | 'profile-template-show' | 'profile-show' | 'profile-delete'
  | 'support-bundle-export' | 'support-bundle-inspect' | 'support-bundle-import'
  | 'subscription-inspect' | 'subscription-login-start' | 'subscription-login-finish' | 'subscription-logout'
  | 'model-pin' | 'model-unpin'
  | 'delegate-task'
  | 'workplan-add' | 'workplan-show' | 'workplan-status' | 'workplan-delete' | 'workplan-clear-completed'
  | 'persona-discovery-import'
  | 'routine-discovery-import'
  | 'mcp-server' | 'mcp-tools-server' | 'mcp-repair' | 'notify-webhook' | 'notify-webhook-remove' | 'notify-webhook-clear' | 'notify-webhook-test' | 'notify-send'
  | 'secret-set' | 'secret-link' | 'secret-test' | 'secret-delete'
>;

export function isAgentWorkspaceBasicCommandEditorKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceBasicCommandEditorKind {
  return isAgentWorkspaceAccessCommandEditorKind(kind)
    || isAgentWorkspaceChannelCommandEditorKind(kind)
    || isAgentWorkspaceKnowledgeCommandEditorKind(kind)
    || isAgentWorkspaceLibraryCommandEditorKind(kind)
    || isAgentWorkspaceMemoryCommandEditorKind(kind)
    || isAgentWorkspaceMediaCommandEditorKind(kind)
    || isAgentWorkspaceOperationsCommandEditorKind(kind)
    || isAgentWorkspaceProviderCommandEditorKind(kind)
    || isAgentWorkspaceSessionCommandEditorKind(kind)
    || isAgentWorkspaceSkillBundleCommandEditorKind(kind)
    || isAgentWorkspaceTaskCommandEditorKind(kind)
    || kind === 'knowledge-bookmarks'
    || kind === 'knowledge-file'
    || kind === 'knowledge-urls'
    || kind === 'knowledge-browser-history'
    || kind === 'knowledge-connector-ingest'
    || kind === 'knowledge-reindex'
    || kind === 'tts-prompt'
    || kind === 'image-input'
    || kind === 'skill-bundle'
    || kind === 'persona-discovery-import'
    || kind === 'routine-discovery-import'
    || kind === 'skill-discovery-import'
    || kind === 'profile-template-export'
    || kind === 'profile-template-import'
    || kind === 'profile-template-from-discovered'
    || kind === 'profile-from-discovered'
    || kind === 'profile-default'
    || kind === 'profile-default-clear'
    || kind === 'profile-template-show'
    || kind === 'profile-show'
    || kind === 'profile-delete'
    || kind === 'support-bundle-export'
    || kind === 'support-bundle-inspect'
    || kind === 'support-bundle-import'
    || kind === 'subscription-inspect'
    || kind === 'subscription-login-start'
    || kind === 'subscription-login-finish'
    || kind === 'subscription-logout'
    || kind === 'model-pin'
    || kind === 'model-unpin'
    || kind === 'delegate-task'
    || kind === 'workplan-add'
    || kind === 'workplan-show'
    || kind === 'workplan-status'
    || kind === 'workplan-delete'
    || kind === 'workplan-clear-completed'
    || kind === 'mcp-server'
    || kind === 'mcp-tools-server'
    || kind === 'mcp-repair'
    || kind === 'notify-webhook'
    || kind === 'notify-webhook-remove'
    || kind === 'notify-webhook-clear'
    || kind === 'notify-webhook-test'
    || kind === 'notify-send'
    || kind === 'secret-set'
    || kind === 'secret-link'
    || kind === 'secret-test'
    || kind === 'secret-delete';
}

export function createAgentWorkspaceBasicCommandEditor(kind: AgentWorkspaceBasicCommandEditorKind): AgentWorkspaceLocalEditor {
  if (isAgentWorkspaceAccessCommandEditorKind(kind)) {
    return createAgentWorkspaceAccessCommandEditor(kind);
  }
  if (isAgentWorkspaceChannelCommandEditorKind(kind)) {
    return createAgentWorkspaceChannelCommandEditor(kind);
  }
  if (isAgentWorkspaceKnowledgeCommandEditorKind(kind)) {
    return createAgentWorkspaceKnowledgeCommandEditor(kind);
  }
  if (isAgentWorkspaceLibraryCommandEditorKind(kind)) {
    return createAgentWorkspaceLibraryCommandEditor(kind);
  }
  if (isAgentWorkspaceMemoryCommandEditorKind(kind)) {
    return createAgentWorkspaceMemoryCommandEditor(kind);
  }
  if (isAgentWorkspaceMediaCommandEditorKind(kind)) {
    return createAgentWorkspaceMediaCommandEditor(kind);
  }
  if (isAgentWorkspaceOperationsCommandEditorKind(kind)) {
    return createAgentWorkspaceOperationsCommandEditor(kind);
  }
  if (isAgentWorkspaceProviderCommandEditorKind(kind)) {
    return createAgentWorkspaceProviderCommandEditor(kind);
  }
  if (isAgentWorkspaceSessionCommandEditorKind(kind)) {
    return createAgentWorkspaceSessionCommandEditor(kind);
  }
  if (isAgentWorkspaceSkillBundleCommandEditorKind(kind)) {
    return createAgentWorkspaceSkillBundleCommandEditor(kind);
  }
  if (isAgentWorkspaceTaskCommandEditorKind(kind)) {
    return createAgentWorkspaceTaskCommandEditor(kind);
  }
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
  if (kind === 'knowledge-urls') {
    return {
      kind,
      mode: 'create',
      title: 'Import URL List into Agent Knowledge',
      selectedFieldIndex: 0,
      message: 'Import a local newline-delimited URL list into the isolated Agent Knowledge segment. Type yes on the final field to confirm.',
      fields: [
        { id: 'path', label: 'URL list path', value: '', required: true, multiline: false, hint: 'Path to a local file containing one URL per line.' },
        { id: 'allowPrivateHosts', label: 'Allow private hosts', value: '', required: false, multiline: false, hint: 'yes/no. Blank defaults to no.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /knowledge import-urls with --yes.' },
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
  if (kind === 'knowledge-reindex') {
    return {
      kind,
      mode: 'update',
      title: 'Reindex Agent Knowledge',
      selectedFieldIndex: 0,
      message: 'Rebuild the isolated Agent Knowledge index. Type yes on the final field to confirm.',
      fields: [
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /knowledge reindex with --yes.' },
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
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to save the MCP server through the TUI command router.' },
      ],
    };
  }
  if (kind === 'mcp-tools-server') {
    return {
      kind,
      mode: 'create',
      title: 'Show MCP Server Tools',
      selectedFieldIndex: 0,
      message: 'List tools exposed by one MCP server without changing server trust, role, or config.',
      fields: [
        { id: 'server', label: 'Server name', value: '', required: true, multiline: false, hint: 'MCP server name from MCP Review or the fullscreen MCP workspace.' },
      ],
    };
  }
  if (kind === 'mcp-repair') {
    return {
      kind,
      mode: 'create',
      title: 'Show MCP Repair Guidance',
      selectedFieldIndex: 0,
      message: 'Show read-only repair guidance for one MCP server. This does not approve quarantine, change trust, or reload the runtime.',
      fields: [
        { id: 'server', label: 'Server name', value: '', required: true, multiline: false, hint: 'MCP server name from MCP Review or Auth review.' },
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
  if (kind === 'notify-webhook-clear') {
    return {
      kind,
      mode: 'delete',
      title: 'Clear Notification Webhooks',
      selectedFieldIndex: 0,
      message: 'Remove every configured webhook notification target. Type yes on the final field to confirm.',
      fields: [
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /notify clear with --yes.' },
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
  if (kind === 'notify-send') {
    return {
      kind,
      mode: 'create',
      title: 'Send Notification',
      selectedFieldIndex: 0,
      message: 'Send one message to configured Agent notification webhook targets. Type yes on the final field to confirm.',
      fields: [
        { id: 'message', label: 'Message', value: '', required: true, multiline: true, hint: 'Plain-text message to send. Ctrl-J inserts a new line.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /notify send with --yes.' },
      ],
    };
  }
  if (kind === 'secret-set') {
    return {
      kind,
      mode: 'create',
      title: 'Store Secret Value',
      selectedFieldIndex: 0,
      message: 'Store one secret value through the Agent secret manager. The value is masked in this workspace. Type yes on the final field to confirm.',
      fields: [
        { id: 'key', label: 'Secret key', value: '', required: true, multiline: false, hint: 'Environment-style key, such as OPENAI_API_KEY.' },
        { id: 'value', label: 'Secret value', value: '', required: true, multiline: false, hint: 'Raw value to store. It is masked here and never rendered in action results.', redact: true },
        { id: 'scope', label: 'Scope', value: '', required: false, multiline: false, hint: 'project or user. Blank defaults to project.' },
        { id: 'storage', label: 'Storage', value: '', required: false, multiline: false, hint: 'secure or plaintext. Blank defaults to secure.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to store the secret value.' },
      ],
    };
  }
  if (kind === 'secret-link') {
    return {
      kind,
      mode: 'create',
      title: 'Link Secret Reference',
      selectedFieldIndex: 0,
      message: 'Link one key to an external goodvibes://secrets/... reference. Type yes on the final field to confirm.',
      fields: [
        { id: 'key', label: 'Secret key', value: '', required: true, multiline: false, hint: 'Environment-style key, such as SLACK_BOT_TOKEN.' },
        { id: 'ref', label: 'Secret ref', value: '', required: true, multiline: false, hint: 'goodvibes://secrets/... reference from a supported provider.' },
        { id: 'scope', label: 'Scope', value: '', required: false, multiline: false, hint: 'project or user. Blank defaults to project.' },
        { id: 'storage', label: 'Storage', value: '', required: false, multiline: false, hint: 'secure or plaintext. Blank defaults to secure.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to link the secret reference.' },
      ],
    };
  }
  if (kind === 'secret-test') {
    return {
      kind,
      mode: 'create',
      title: 'Test Secret Reference',
      selectedFieldIndex: 0,
      message: 'Resolve one goodvibes://secrets/... reference and show only resolved/missing status. Type yes on the final field to confirm.',
      fields: [
        { id: 'ref', label: 'Secret ref', value: '', required: true, multiline: false, hint: 'goodvibes://secrets/... reference to test without printing its value.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to test the secret reference.' },
      ],
    };
  }
  if (kind === 'secret-delete') {
    return {
      kind,
      mode: 'delete',
      title: 'Delete Stored Secret',
      selectedFieldIndex: 0,
      message: 'Delete one stored secret key from the selected scope/storage. Type yes on the final field to confirm.',
      fields: [
        { id: 'key', label: 'Secret key', value: '', required: true, multiline: false, hint: 'Stored key to delete.' },
        { id: 'scope', label: 'Scope', value: '', required: false, multiline: false, hint: 'Optional project or user. Blank lets the command choose the matching stored key.' },
        { id: 'storage', label: 'Storage', value: '', required: false, multiline: false, hint: 'Optional secure or plaintext.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to delete the stored secret key.' },
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
  if (kind === 'model-pin' || kind === 'model-unpin') {
    const pinning = kind === 'model-pin';
    return {
      kind,
      mode: 'create',
      title: pinning ? 'Pin Model' : 'Unpin Model',
      selectedFieldIndex: 0,
      message: pinning
        ? 'Pin one model registry key so it is easy to reuse from the Agent TUI.'
        : 'Remove one pinned model registry key from the Agent model favorites.',
      fields: [
        {
          id: 'model',
          label: 'Model registry key',
          value: '',
          required: true,
          multiline: false,
          hint: 'Use a registry key shown by the model picker, such as openai:gpt-5.5.',
        },
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
  if (kind === 'profile-template-show') {
    return {
      kind,
      mode: 'create',
      title: 'Preview Agent Starter Template',
      selectedFieldIndex: 0,
      message: 'Preview one built-in or local starter template before creating or exporting a profile.',
      fields: [
        { id: 'id', label: 'Starter id', value: '', required: true, multiline: false, hint: 'Starter template id from /agent-profile templates.' },
      ],
    };
  }
  if (kind === 'profile-show') {
    return {
      kind,
      mode: 'create',
      title: 'Show Agent Profile',
      selectedFieldIndex: 0,
      message: 'Show one isolated Agent profile home, starter metadata, and launch command.',
      fields: [
        { id: 'profile', label: 'Profile name', value: '', required: true, multiline: false, hint: 'Existing isolated Agent profile name from /agent-profile list.' },
      ],
    };
  }
  if (kind === 'profile-template-from-discovered') {
    return {
      kind,
      mode: 'create',
      title: 'Create Starter from Discovered Behavior',
      selectedFieldIndex: 0,
      message: 'Create an Agent-local starter template from reviewed discovered persona, skill, and routine markdown. Type yes on the final field to confirm.',
      fields: [
        { id: 'id', label: 'Starter id', value: '', required: true, multiline: false, hint: 'New local starter id, for example research-desk.' },
        { id: 'name', label: 'Starter name', value: '', required: false, multiline: false, hint: 'Optional display name. Defaults to the selected persona name.' },
        { id: 'description', label: 'Description', value: '', required: false, multiline: false, hint: 'Optional one-line summary.' },
        { id: 'persona', label: 'Persona', value: '', required: false, multiline: false, hint: 'Optional discovered persona name/path. Blank uses the first discovered persona.' },
        { id: 'skills', label: 'Skills', value: '', required: false, multiline: false, hint: 'all or comma-separated discovered skill names. Blank includes all.' },
        { id: 'routines', label: 'Routines', value: '', required: false, multiline: false, hint: 'all or comma-separated discovered routine names. Blank includes all.' },
        { id: 'replace', label: 'Replace existing', value: 'no', required: false, multiline: false, hint: 'yes/no. Existing starter ids are protected unless this is yes.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /agent-profile template from-discovered with --yes.' },
      ],
    };
  }
  if (kind === 'profile-from-discovered') {
    return {
      kind,
      mode: 'create',
      title: 'Create Profile from Discovered Behavior',
      selectedFieldIndex: 0,
      message: 'Create a local starter template and isolated Agent profile from reviewed discovered behavior markdown. Type yes on the final field to confirm.',
      fields: [
        { id: 'profile', label: 'Profile name', value: '', required: true, multiline: false, hint: 'New isolated Agent profile name, for example research-desk.' },
        { id: 'templateId', label: 'Starter id', value: '', required: false, multiline: false, hint: 'Optional local starter id. Blank uses the profile name.' },
        { id: 'name', label: 'Starter name', value: '', required: false, multiline: false, hint: 'Optional display name for the generated starter.' },
        { id: 'description', label: 'Description', value: '', required: false, multiline: false, hint: 'Optional one-line summary.' },
        { id: 'persona', label: 'Persona', value: '', required: false, multiline: false, hint: 'Optional discovered persona name/path. Blank uses the first discovered persona.' },
        { id: 'skills', label: 'Skills', value: '', required: false, multiline: false, hint: 'all or comma-separated discovered skill names. Blank includes all.' },
        { id: 'routines', label: 'Routines', value: '', required: false, multiline: false, hint: 'all or comma-separated discovered routine names. Blank includes all.' },
        { id: 'replace', label: 'Replace starter', value: 'no', required: false, multiline: false, hint: 'yes/no. Existing starter ids are protected unless this is yes.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /agent-profile create-from-discovered with --yes.' },
      ],
    };
  }
  if (kind === 'profile-default') {
    return {
      kind,
      mode: 'update',
      title: 'Use Default Agent Profile',
      selectedFieldIndex: 0,
      message: 'Select which isolated Agent profile the next plain goodvibes-agent run should use. Type yes on the final field to confirm.',
      fields: [
        { id: 'profile', label: 'Profile name', value: '', required: true, multiline: false, hint: 'Existing isolated Agent profile name from /agent-profile list.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /agent-profile use with --yes.' },
      ],
    };
  }
  if (kind === 'profile-default-clear') {
    return {
      kind,
      mode: 'update',
      title: 'Clear Default Agent Profile',
      selectedFieldIndex: 0,
      message: 'Return the next plain goodvibes-agent run to the base Agent home. Type yes to confirm.',
      fields: [
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /agent-profile default clear with --yes.' },
      ],
    };
  }
  if (kind === 'profile-delete') {
    return {
      kind,
      mode: 'delete',
      title: 'Delete Agent Profile',
      selectedFieldIndex: 0,
      message: 'Delete one isolated Agent profile home. Type yes on the final field to confirm.',
      fields: [
        { id: 'profile', label: 'Profile name', value: '', required: true, multiline: false, hint: 'Existing isolated Agent profile name from /agent-profile list.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /agent-profile delete with --yes.' },
      ],
    };
  }
  if (kind === 'support-bundle-export') {
    return {
      kind,
      mode: 'create',
      title: 'Export Agent Support Bundle',
      selectedFieldIndex: 0,
      message: 'Export a redacted Agent support bundle from this workspace. Type yes on the final field to confirm.',
      fields: [
        { id: 'path', label: 'Output path', value: 'goodvibes-agent-bundle.json', required: true, multiline: false, hint: 'Workspace-relative JSON path to write.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /bundle export with --yes.' },
      ],
    };
  }
  if (kind === 'support-bundle-inspect') {
    return {
      kind,
      mode: 'create',
      title: 'Inspect Agent Support Bundle',
      selectedFieldIndex: 0,
      message: 'Inspect a redacted Agent support bundle before import or sharing.',
      fields: [
        { id: 'path', label: 'Bundle path', value: 'goodvibes-agent-bundle.json', required: true, multiline: false, hint: 'Workspace-relative bundle JSON path.' },
      ],
    };
  }
  if (kind === 'support-bundle-import') {
    return {
      kind,
      mode: 'update',
      title: 'Import Agent Support Bundle',
      selectedFieldIndex: 0,
      message: 'Import non-redacted config values from a reviewed Agent support bundle. Type yes on the final field to confirm.',
      fields: [
        { id: 'path', label: 'Bundle path', value: 'goodvibes-agent-bundle.json', required: true, multiline: false, hint: 'Workspace-relative bundle JSON path to import.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /bundle import with --yes.' },
      ],
    };
  }
  if (kind === 'subscription-inspect') {
    return {
      kind,
      mode: 'create',
      title: 'Inspect Provider Subscription',
      selectedFieldIndex: 0,
      message: 'Inspect one provider subscription route without starting login or printing token values.',
      fields: [
        { id: 'provider', label: 'Provider', value: 'openai', required: true, multiline: false, hint: 'Subscription provider id from /subscription providers.' },
      ],
    };
  }
  if (kind === 'subscription-login-start') {
    return {
      kind,
      mode: 'create',
      title: 'Start Provider Subscription Login',
      selectedFieldIndex: 0,
      message: 'Start one provider subscription OAuth login. Type yes on the final field to confirm browser/pending-login side effects.',
      fields: [
        { id: 'provider', label: 'Provider', value: 'openai', required: true, multiline: false, hint: 'Subscription provider id from /subscription providers.' },
        { id: 'openBrowser', label: 'Open browser', value: 'yes', required: false, multiline: false, hint: 'yes/no. Use no to print the authorization URL only.' },
        { id: 'manual', label: 'Manual callback', value: 'no', required: false, multiline: false, hint: 'yes/no. Use yes to avoid the local callback listener and finish manually.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /subscription login <provider> start with --yes.' },
      ],
    };
  }
  if (kind === 'subscription-login-finish') {
    return {
      kind,
      mode: 'update',
      title: 'Finish Provider Subscription Login',
      selectedFieldIndex: 0,
      message: 'Finish a pending provider subscription OAuth login from a code or redirected URL. Type yes on the final field to confirm token storage.',
      fields: [
        { id: 'provider', label: 'Provider', value: 'openai', required: true, multiline: false, hint: 'Provider id used when starting login.' },
        { id: 'code', label: 'Code or redirect URL', value: '', required: true, multiline: false, hint: 'OAuth code or full redirect URL containing code=...' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /subscription login <provider> finish with --yes.' },
      ],
    };
  }
  if (kind === 'subscription-logout') {
    return {
      kind,
      mode: 'delete',
      title: 'Logout Provider Subscription',
      selectedFieldIndex: 0,
      message: 'Remove one stored provider subscription session. Ambient API key resolution applies again if configured. Type yes to confirm.',
      fields: [
        { id: 'provider', label: 'Provider', value: 'openai', required: true, multiline: false, hint: 'Stored subscription provider id.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /subscription logout with --yes.' },
      ],
    };
  }
  if (kind === 'delegate-task') {
    return {
      kind,
      mode: 'create',
      title: 'Delegate Build Work to GoodVibes TUI',
      selectedFieldIndex: 0,
      message: 'Send one explicit build/fix/review task to GoodVibes TUI/shared-session routes. Type yes on the final field to confirm.',
      fields: [
        { id: 'task', label: 'Original task', value: '', required: true, multiline: true, hint: 'Paste the full original user ask. Ctrl-J inserts a new line.' },
        { id: 'wrfc', label: 'Request WRFC', value: '', required: false, multiline: false, hint: 'yes/no. Blank means no WRFC request.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /delegate for this task.' },
      ],
    };
  }
  if (kind === 'workplan-add') {
    return {
      kind,
      mode: 'create',
      title: 'Add Work Plan Item',
      selectedFieldIndex: 0,
      message: 'Create one visible work plan item from the Agent workspace.',
      fields: [
        { id: 'title', label: 'Title', value: '', required: true, multiline: true, hint: 'Task title. Ctrl-J inserts a new line.' },
        { id: 'owner', label: 'Owner', value: '', required: false, multiline: false, hint: 'Optional owner label.' },
        { id: 'source', label: 'Source', value: '', required: false, multiline: false, hint: 'Optional source label. Blank defaults to manual.' },
        { id: 'notes', label: 'Notes', value: '', required: false, multiline: true, hint: 'Optional notes. Ctrl-J inserts a new line.' },
      ],
    };
  }
  if (kind === 'workplan-show') {
    return {
      kind,
      mode: 'create',
      title: 'Show Work Plan Detail',
      selectedFieldIndex: 0,
      message: 'Print the detailed work plan from the Agent workspace without mutating work state.',
      fields: [
        { id: 'format', label: 'Format', value: '', required: false, multiline: false, hint: 'Optional. Blank uses the default detail view; markdown also works.' },
      ],
    };
  }
  if (kind === 'workplan-status') {
    return {
      kind,
      mode: 'update',
      title: 'Update Work Plan Status',
      selectedFieldIndex: 0,
      message: 'Update one visible work plan item status from the Agent workspace.',
      fields: [
        { id: 'id', label: 'Work item id', value: '', required: true, multiline: false, hint: 'Existing work plan item id.' },
        { id: 'status', label: 'Status', value: '', required: true, multiline: false, hint: 'pending, start, blocked, done, failed, or cancelled.' },
      ],
    };
  }
  if (kind === 'workplan-delete') {
    return {
      kind,
      mode: 'delete',
      title: 'Remove Work Plan Item',
      selectedFieldIndex: 0,
      message: 'Remove one work plan item. Type yes on the final field to confirm.',
      fields: [
        { id: 'id', label: 'Work item id', value: '', required: true, multiline: false, hint: 'Existing work plan item id.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /workplan remove with --yes.' },
      ],
    };
  }
  if (kind === 'workplan-clear-completed') {
    return {
      kind,
      mode: 'delete',
      title: 'Clear Completed Work Plan Items',
      selectedFieldIndex: 0,
      message: 'Clear completed and cancelled work plan items. Type yes to confirm.',
      fields: [
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /workplan clear-completed with --yes.' },
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
  if (kind === 'routine-discovery-import') {
    return {
      kind,
      mode: 'create',
      title: 'Import Discovered Routine',
      selectedFieldIndex: 0,
      message: 'Import one discovered routine markdown file into the Agent-local routine registry. Type yes on the final field to confirm.',
      fields: [
        { id: 'name', label: 'Discovered routine', value: '', required: true, multiline: false, hint: 'Name shown by /routines discover.' },
        { id: 'enabled', label: 'Enable now', value: 'yes', required: false, multiline: false, hint: 'yes/no.' },
        { id: 'confirm', label: 'Confirm', value: '', required: true, multiline: false, hint: 'Type yes to run /routines import-discovered with --yes.' },
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
