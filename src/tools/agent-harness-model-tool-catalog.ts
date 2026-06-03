import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';

export interface AgentHarnessModelToolCatalogArgs {
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

export function listHarnessModelTools(toolRegistry: ToolRegistry, args: AgentHarnessModelToolCatalogArgs): readonly Record<string, unknown>[] {
  const query = readString(args.query).toLowerCase();
  const includeParameters = args.includeParameters === true;
  const limit = readLimit(args.limit, 200);
  return toolRegistry.getToolDefinitions()
    .filter((tool) => !query || [tool.name, tool.description, ...(tool.sideEffects ?? [])].join('\n').toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      sideEffects: tool.sideEffects ?? [],
      concurrency: tool.concurrency ?? 'parallel',
      supportsProgress: tool.supportsProgress ?? false,
      supportsStreamingOutput: tool.supportsStreamingOutput ?? false,
      ...(includeParameters ? { parameters: tool.parameters } : {}),
    }));
}
