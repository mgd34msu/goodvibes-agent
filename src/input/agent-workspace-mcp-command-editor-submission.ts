import type { AgentWorkspaceActionResult, AgentWorkspaceEditorKind, AgentWorkspaceLocalEditor } from './agent-workspace-types.ts';
import { quoteSlashCommandArg, tokenizeSlashCommand } from './slash-command-parser.ts';

type AgentWorkspaceFieldReader = (fieldId: string) => string;

export type AgentWorkspaceMcpCommandEditorKind = Extract<AgentWorkspaceEditorKind, 'mcp-server'>;

export type AgentWorkspaceMcpCommandEditorSubmission =
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

export function isAgentWorkspaceMcpCommandSubmissionKind(kind: AgentWorkspaceEditorKind): kind is AgentWorkspaceMcpCommandEditorKind {
  return kind === 'mcp-server';
}

function isAffirmative(value: string): boolean {
  return /^(y|yes|true)$/i.test(value.trim());
}

function splitCommaList(value: string): readonly string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function buildAgentWorkspaceMcpCommandEditorSubmission(
  editor: AgentWorkspaceLocalEditor,
  readField: AgentWorkspaceFieldReader,
): AgentWorkspaceMcpCommandEditorSubmission {
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
