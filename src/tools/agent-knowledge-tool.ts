import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { ShellPathService } from '@/runtime/index.ts';
import type { AgentDaemonConfigReader } from '../agent/routine-schedule-promotion.ts';
import { resolveAgentDaemonConnection } from '../agent/routine-schedule-promotion.ts';
import {
  createAgentSdk,
  classifyKnowledgeError,
  type AgentKnowledgeFailure,
} from '../cli/agent-knowledge-runtime.ts';
import { AGENT_KNOWLEDGE_METHODS, type DaemonCallMethod } from '../cli/agent-knowledge-methods.ts';
import {
  formatAsk,
  formatFailure,
  formatSearch,
  formatStatus,
} from '../cli/agent-knowledge-format.ts';

export type AgentKnowledgeToolAction = 'status' | 'ask' | 'search';
export type AgentKnowledgeAskMode = 'concise' | 'standard' | 'detailed';

export interface AgentKnowledgeToolArgs {
  readonly action?: unknown;
  readonly query?: unknown;
  readonly limit?: unknown;
  readonly mode?: unknown;
}

const ACTIONS: readonly AgentKnowledgeToolAction[] = ['status', 'ask', 'search'];
const ASK_MODES: readonly AgentKnowledgeAskMode[] = ['concise', 'standard', 'detailed'];

function isAction(value: unknown): value is AgentKnowledgeToolAction {
  return typeof value === 'string' && ACTIONS.includes(value as AgentKnowledgeToolAction);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return Math.min(value, 25);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return Math.min(parsed, 25);
  }
  return fallback;
}

function readMode(value: unknown): AgentKnowledgeAskMode {
  return typeof value === 'string' && ASK_MODES.includes(value as AgentKnowledgeAskMode)
    ? value as AgentKnowledgeAskMode
    : 'standard';
}

function toolFailure(error: string): { readonly success: false; readonly error: string } {
  return { success: false, error };
}

function toolOutput(output: string): { readonly success: true; readonly output: string } {
  return { success: true, output };
}

function formatKnowledgeFailure(failure: AgentKnowledgeFailure): string {
  return formatFailure(failure, false);
}

async function classifyToolKnowledgeError(
  error: unknown,
  connection: ReturnType<typeof resolveAgentDaemonConnection>,
  method: DaemonCallMethod,
): Promise<{ readonly success: false; readonly error: string }> {
  return toolFailure(formatKnowledgeFailure(await classifyKnowledgeError(error, connection, method.route)));
}

export function createAgentKnowledgeTool(
  shellPaths: ShellPathService,
  configManager: AgentDaemonConfigReader,
): Tool {
  return {
    definition: {
      name: 'agent_knowledge',
      description: [
        'Read isolated GoodVibes Agent Knowledge from the main conversation.',
        'Use for Agent-owned knowledge status, ask, and search only.',
        'This tool calls /api/goodvibes-agent/knowledge/* on the connected GoodVibes host and must never fall back to default Knowledge/Wiki, HomeGraph, or non-Agent knowledge spaces.',
        'It is read-only and does not ingest, reindex, mutate, or create background work.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [...ACTIONS],
            description: 'Read-only Agent Knowledge action.',
          },
          query: {
            type: 'string',
            description: 'Question/query for ask or search.',
          },
          limit: {
            type: 'number',
            description: 'Maximum source/search results, capped at 25.',
          },
          mode: {
            type: 'string',
            enum: [...ASK_MODES],
            description: 'Answer detail mode for ask.',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      sideEffects: ['network'],
    },
    execute: async (rawArgs: unknown) => {
      const args = rawArgs as AgentKnowledgeToolArgs;
      if (!isAction(args.action)) return toolFailure(`Unknown Agent Knowledge action. Valid: ${ACTIONS.join(', ')}.`);
      const connection = resolveAgentDaemonConnection(configManager, shellPaths.homeDirectory);
      if (!connection.token) {
        return toolFailure(formatKnowledgeFailure({
          ok: false,
          kind: 'auth_required',
          error: `No runtime operator token found at ${connection.tokenPath}`,
          baseUrl: connection.baseUrl,
          route: '/api/goodvibes-agent/knowledge/*',
        }));
      }
      try {
        const sdk = createAgentSdk(connection);
        if (args.action === 'status') {
          const data = await sdk.knowledge.status();
          return toolOutput(formatStatus(data));
        }
        if (args.action === 'ask') {
          const query = readString(args.query);
          if (!query) return toolFailure('query is required for Agent Knowledge ask.');
          const data = await sdk.knowledge.ask({
            query,
            limit: readLimit(args.limit, 8),
            mode: readMode(args.mode),
            includeSources: true,
            includeConfidence: true,
            includeLinkedObjects: true,
          });
          return toolOutput(formatAsk(data, query));
        }
        const query = readString(args.query);
        if (!query) return toolFailure('query is required for Agent Knowledge search.');
        const method = AGENT_KNOWLEDGE_METHODS.search;
        const data = await sdk.knowledge.search({ query, limit: readLimit(args.limit, 10) });
        return toolOutput(formatSearch(data, query));
      } catch (error) {
        const method = args.action === 'status'
          ? AGENT_KNOWLEDGE_METHODS.status
          : args.action === 'ask'
            ? AGENT_KNOWLEDGE_METHODS.ask
            : AGENT_KNOWLEDGE_METHODS.search;
        return classifyToolKnowledgeError(error, connection, method);
      }
    },
  };
}

export function registerAgentKnowledgeTool(
  registry: ToolRegistry,
  shellPaths: ShellPathService,
  configManager: AgentDaemonConfigReader,
): void {
  registry.register(createAgentKnowledgeTool(shellPaths, configManager));
}
