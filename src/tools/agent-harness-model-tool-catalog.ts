import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';

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

function previewText(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function modelToolSearchText(tool: HarnessModelToolDefinition): string {
  return [
    tool.name,
    tool.description,
    ...(tool.sideEffects ?? []),
  ].join('\n').toLowerCase();
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
    sideEffects: tool.sideEffects ?? [],
  }));
}

export function listHarnessModelTools(toolRegistry: ToolRegistry, args: AgentHarnessModelToolCatalogArgs): readonly Record<string, unknown>[] {
  const query = readString(args.query).toLowerCase();
  const includeParameters = args.includeParameters === true;
  const limit = readLimit(args.limit, 200);
  return toolRegistry.getToolDefinitions()
    .filter((tool) => !query || modelToolSearchText(tool).includes(query))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((tool) => describeModelTool(tool, { includeParameters }));
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
        const searched = tools.filter((tool) => modelToolSearchText(tool).includes(normalized));
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
