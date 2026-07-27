import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { withInventoryDisclosure } from './inventory-disclosure.ts';

export interface AgentHarnessModelToolCatalogArgs {
  readonly query?: unknown;
  readonly toolName?: unknown;
  readonly target?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

type HarnessModelToolDefinition = ReturnType<ToolRegistry['getToolDefinitions']>[number];
type ModelToolLookupSource = 'toolName' | 'target' | 'query';

export type HarnessModelToolResolution =
  | { readonly status: 'found'; readonly tool: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] };

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function previewText(value: string, maxLength = 56): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function searchTokens(input: string): readonly string[] {
  return input.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 0);
}

function schemaSearchText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(schemaSearchText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value)
    .map(([key, entry]) => `${key}\n${schemaSearchText(entry)}`)
    .filter(Boolean)
    .join('\n');
}

function modelToolSearchText(tool: HarnessModelToolDefinition): string {
  return [
    tool.name,
    tool.name.replace(/_/g, ' '),
    tool.description,
    ...(tool.sideEffects ?? []),
    schemaSearchText(tool.parameters),
  ].join('\n').toLowerCase();
}

function modelToolMatchesSearch(tool: HarnessModelToolDefinition, input: string): boolean {
  const text = modelToolSearchText(tool);
  const normalized = input.toLowerCase().trim();
  if (!normalized) return true;
  if (text.includes(normalized)) return true;
  const tokens = searchTokens(normalized);
  return tokens.length > 0 && tokens.every((token) => text.includes(token));
}

function tokenScore(tokens: readonly string[], value: string | undefined, weight: number): number {
  if (!value) return 0;
  const text = value.toLowerCase();
  return tokens.reduce((score, token) => score + (text.includes(token) ? weight : 0), 0);
}

const ACTION_VERBS = new Set(['run', 'set', 'reset', 'open', 'create', 'send', 'schedule', 'generate', 'read', 'search', 'ingest']);

function modelToolRelevance(tool: HarnessModelToolDefinition, input: string): number {
  const normalized = input.toLowerCase().trim();
  if (!normalized) return 0;

  const tokens = searchTokens(normalized);
  const name = tool.name.toLowerCase();
  const namePhrase = name.replace(/_/g, ' ');
  const nameLookup = normalized.replace(/\s+/g, '_');
  const parameterText = schemaSearchText(tool.parameters);
  let score = 0;

  if (name === normalized || namePhrase === normalized) score += 10_000;
  if (name.startsWith(nameLookup) || namePhrase.startsWith(normalized)) score += 5_000;
  if (name.includes(nameLookup) || namePhrase.includes(normalized)) score += 2_500;

  score += tokenScore(tokens, `${name}\n${namePhrase}`, 1_000);
  score += tokenScore(tokens, tool.description, 300);
  score += tokenScore(tokens, (tool.sideEffects ?? []).join('\n'), 250);
  score += tokenScore(tokens, parameterText, 150);

  const actionVerb = tokens.find((token) => ACTION_VERBS.has(token));
  if (actionVerb && searchTokens(name).includes(actionVerb)) score += 1_500;

  return score;
}

function matchingModelTools(tools: readonly HarnessModelToolDefinition[], input: string): readonly HarnessModelToolDefinition[] {
  const query = input.toLowerCase().trim();
  const matches = tools
    .map((tool, index) => ({ tool, index, score: modelToolRelevance(tool, query) }))
    .filter(({ tool }) => modelToolMatchesSearch(tool, query));
  return matches
    .sort((left, right) => {
      if (!query) return left.tool.name.localeCompare(right.tool.name);
      return right.score - left.score || left.tool.name.localeCompare(right.tool.name) || left.index - right.index;
    })
    .map(({ tool }) => tool);
}

function modelToolLookupFromArgs(args: AgentHarnessModelToolCatalogArgs): { readonly source: ModelToolLookupSource; readonly input: string } | null {
  const toolName = readString(args.toolName);
  if (toolName) return { source: 'toolName', input: toolName };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

function describeModelTool(tool: HarnessModelToolDefinition, options: { readonly includeParameters?: boolean; readonly lookup?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    name: tool.name,
    ...(options.includeParameters ? { description: tool.description } : { summary: previewText(tool.description) }),
    modelRoute: tool.name,
    modelAccess: {
      inspect: `agent_harness mode:"tool" toolName:"${tool.name}"`,
      invoke: tool.name,
    },
    sideEffects: tool.sideEffects ?? [],
    concurrency: tool.concurrency ?? 'parallel',
    supportsProgress: tool.supportsProgress ?? false,
    supportsStreamingOutput: tool.supportsStreamingOutput ?? false,
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(options.includeParameters ? { parameters: tool.parameters } : {}),
  };
}

function describeModelToolCandidates(tools: readonly HarnessModelToolDefinition[]): readonly Record<string, unknown>[] {
  return tools.slice(0, 8).map((tool) => ({
    toolName: tool.name,
    summary: previewText(tool.description),
    modelRoute: tool.name,
    inspectRoute: `agent_harness mode:"tool" toolName:"${tool.name}"`,
    sideEffects: tool.sideEffects ?? [],
  }));
}

export function listHarnessModelTools(toolRegistry: ToolRegistry, args: AgentHarnessModelToolCatalogArgs): readonly Record<string, unknown>[] {
  const query = readString(args.query).toLowerCase();
  const includeParameters = args.includeParameters === true;
  const limit = readLimit(args.limit, 500);
  return matchingModelTools(toolRegistry.getToolDefinitions(), query)
    .slice(0, limit)
    .map((tool) => describeModelTool(tool, { includeParameters }));
}

/**
 * The payload for mode:"tools", including why the list is short when it is.
 *
 * A search that matched nothing used to answer `{"tools": [], "returned": 0,
 * "total": 76}` — a filtered result presented as an inventory, which is how a
 * model concludes a capability does not exist.
 */
export function harnessModelToolsPayload(
  toolRegistry: ToolRegistry,
  args: AgentHarnessModelToolCatalogArgs,
): Record<string, unknown> {
  const tools = listHarnessModelTools(toolRegistry, args);
  const total = toolRegistry.getToolDefinitions().length;
  return withInventoryDisclosure(
    { tools, returned: tools.length, total },
    {
      subject: 'model tools',
      returned: tools.length,
      total,
      filters: { query: readString(args.query) },
      listAllRoute: 'agent_harness mode:"tools"',
    },
  );
}

export function describeHarnessModelTool(toolRegistry: ToolRegistry, args: AgentHarnessModelToolCatalogArgs): HarnessModelToolResolution | null {
  const lookup = modelToolLookupFromArgs(args);
  if (!lookup) return null;
  const tools = toolRegistry.getToolDefinitions().sort((a, b) => a.name.localeCompare(b.name));
  const normalized = lookup.input.toLowerCase();
  const exact = tools.find((tool) => tool.name === lookup.input);
  const found = exact
    ? { tool: exact, resolvedBy: 'name' }
    : (() => {
        const insensitive = tools.find((tool) => tool.name.toLowerCase() === normalized);
        if (insensitive) return { tool: insensitive, resolvedBy: 'case-insensitive-name' };
        if (lookup.source === 'toolName') return null;
        const searched = matchingModelTools(tools, normalized);
        if (searched.length === 1) return { tool: searched[0]!, resolvedBy: 'search' };
        if (searched.length > 1) return { candidates: searched };
        return null;
      })();
  if (!found) return null;
  if ('candidates' in found) return { status: 'ambiguous', input: lookup.input, candidates: describeModelToolCandidates(found.candidates) };
  return {
    status: 'found',
    tool: {
      ...describeModelTool(found.tool, { includeParameters: true, lookup: { ...lookup, resolvedBy: found.resolvedBy } }),
      policy: 'This is a first-class model tool definition. Use the returned JSON schema directly; mutating or external side-effect tools still require the explicit confirmation arguments defined by that tool.',
    },
  };
}
