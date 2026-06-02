import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { ShellPathService } from '@/runtime/index.ts';
import type { AgentDaemonConfigReader } from '../agent/routine-schedule-promotion.ts';
import { resolveAgentDaemonConnection } from '../agent/routine-schedule-promotion.ts';
import {
  classifyKnowledgeError,
  postAgentKnowledgeJson,
  type AgentKnowledgeFailure,
} from '../cli/agent-knowledge-runtime.ts';
import { AGENT_KNOWLEDGE_METHODS } from '../cli/agent-knowledge-methods.ts';
import { formatFailure, formatIngest } from '../cli/agent-knowledge-format.ts';

export interface AgentKnowledgeIngestToolArgs {
  readonly url?: unknown;
  readonly title?: unknown;
  readonly tags?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringList(value: unknown): readonly string[] {
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes';
}

function validateUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Agent Knowledge URL ingest requires an http(s) URL.';
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function failure(error: string): { readonly success: false; readonly error: string } {
  return { success: false, error };
}

function output(text: string): { readonly success: true; readonly output: string } {
  return { success: true, output: text };
}

function formatKnowledgeFailure(failureResult: AgentKnowledgeFailure): string {
  return formatFailure(failureResult, false);
}

function preview(url: string, title: string, tags: readonly string[]): string {
  return [
    'Agent Knowledge URL ingest preview',
    `  url: ${url}`,
    title ? `  title: ${title}` : '  title: (none)',
    `  tags: ${tags.join(', ') || '(none)'}`,
    `  route: ${AGENT_KNOWLEDGE_METHODS.ingestUrl.route}`,
    '  policy: isolated Agent Knowledge only; no default Knowledge/Wiki or non-Agent fallback',
  ].join('\n');
}

export function createAgentKnowledgeIngestTool(
  shellPaths: ShellPathService,
  configManager: AgentDaemonConfigReader,
): Tool {
  return {
    definition: {
      name: 'agent_knowledge_ingest',
      description: [
        'Ingest one explicit URL into isolated GoodVibes Agent Knowledge from the main conversation.',
        'Use only when the user explicitly asks Agent to add, remember, import, or ingest a URL into its Agent Knowledge/Wiki.',
        'This writes only to /api/goodvibes-agent/knowledge/ingest/url on the connected GoodVibes host.',
        'It must never call default Knowledge/Wiki, HomeGraph, non-Agent knowledge spaces, background workers, local schedulers, or WRFC.',
        'Set confirm:true only for an explicit user request. Otherwise return the preview/confirmation error.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'HTTP(S) URL to ingest into isolated Agent Knowledge.',
          },
          title: {
            type: 'string',
            description: 'Optional source title.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for the Agent Knowledge source.',
          },
          confirm: {
            type: 'boolean',
            description: 'Required true only when the user explicitly asked to ingest this URL.',
          },
          explicitUserRequest: {
            type: 'string',
            description: 'Short quote or summary of the user request that authorized this Agent Knowledge ingest.',
          },
        },
        required: ['url', 'confirm', 'explicitUserRequest'],
        additionalProperties: false,
      },
      sideEffects: ['network', 'state'],
    },
    execute: async (rawArgs: unknown) => {
      const args = rawArgs as AgentKnowledgeIngestToolArgs;
      const url = readString(args.url);
      const title = readString(args.title);
      const tags = readStringList(args.tags);
      const explicitUserRequest = readString(args.explicitUserRequest);
      if (!url) return failure('url is required.');
      const invalidUrl = validateUrl(url);
      if (invalidUrl) return failure(invalidUrl);
      if (!explicitUserRequest) {
        return failure('explicitUserRequest is required so Agent Knowledge ingest stays tied to a direct user request.');
      }
      if (!readBoolean(args.confirm)) {
        return failure([
          preview(url, title, tags),
          '',
          'Model tool confirmation required: call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to ingest this URL.',
        ].join('\n'));
      }

      const connection = resolveAgentDaemonConnection(configManager, shellPaths.homeDirectory);
      if (!connection.token) {
        return failure(formatKnowledgeFailure({
          ok: false,
          kind: 'auth_required',
          error: `No runtime operator token found at ${connection.tokenPath}`,
          baseUrl: connection.baseUrl,
          route: AGENT_KNOWLEDGE_METHODS.ingestUrl.route,
        }));
      }

      try {
        const data = await postAgentKnowledgeJson(connection, AGENT_KNOWLEDGE_METHODS.ingestUrl.route, {
          url,
          title,
          tags: [...tags],
          sourceType: 'url',
          connectorId: 'goodvibes-agent-main-conversation',
          metadata: {
            originSurface: 'goodvibes-agent',
            explicitUserRequest,
          },
        });
        return output(formatIngest(data, url));
      } catch (error) {
        return failure(formatKnowledgeFailure(await classifyKnowledgeError(error, connection, AGENT_KNOWLEDGE_METHODS.ingestUrl.route)));
      }
    },
  };
}

export function registerAgentKnowledgeIngestTool(
  registry: ToolRegistry,
  shellPaths: ShellPathService,
  configManager: AgentDaemonConfigReader,
): void {
  registry.register(createAgentKnowledgeIngestTool(shellPaths, configManager));
}
