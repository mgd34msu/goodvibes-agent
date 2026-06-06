import type { ShellPathService } from '@/runtime/index.ts';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import {
  AgentResearchSourceRegistry,
  researchSourceReportLine,
  type AgentResearchSourceCreateInput,
  type AgentResearchSourceCredibility,
  type AgentResearchSourceRecord,
  type AgentResearchSourceStatus,
} from '../agent/research-source-registry.ts';

export interface AgentResearchSourcesToolArgs {
  readonly mode?: unknown;
  readonly id?: unknown;
  readonly query?: unknown;
  readonly status?: unknown;
  readonly question?: unknown;
  readonly title?: unknown;
  readonly url?: unknown;
  readonly publisher?: unknown;
  readonly publishedAt?: unknown;
  readonly accessedAt?: unknown;
  readonly summary?: unknown;
  readonly evidence?: unknown;
  readonly credibility?: unknown;
  readonly score?: unknown;
  readonly tags?: unknown;
  readonly note?: unknown;
  readonly reportArtifactId?: unknown;
  readonly includeReportLines?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

type AgentResearchSourcesMode = 'list' | 'search' | 'show' | 'add' | 'review' | 'reject' | 'use' | 'delete';

const MODES: readonly AgentResearchSourcesMode[] = ['list', 'search', 'show', 'add', 'review', 'reject', 'use', 'delete'];
const STATUS_VALUES: readonly AgentResearchSourceStatus[] = ['candidate', 'reviewed', 'rejected', 'used'];
const CREDIBILITY_VALUES: readonly AgentResearchSourceCredibility[] = ['unreviewed', 'low', 'medium', 'high', 'mixed'];

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readMode(value: unknown): AgentResearchSourcesMode {
  return typeof value === 'string' && MODES.includes(value as AgentResearchSourcesMode) ? value as AgentResearchSourcesMode : 'list';
}

function readStatus(value: unknown): AgentResearchSourceStatus | undefined {
  return typeof value === 'string' && STATUS_VALUES.includes(value as AgentResearchSourceStatus) ? value as AgentResearchSourceStatus : undefined;
}

function readCredibility(value: unknown): AgentResearchSourceCredibility | undefined {
  return typeof value === 'string' && CREDIBILITY_VALUES.includes(value as AgentResearchSourceCredibility) ? value as AgentResearchSourceCredibility : undefined;
}

function readScore(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)));
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : undefined;
}

function readStringList(value: unknown): readonly string[] {
  if (typeof value === 'string') {
    return value.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
}

function output(text: string): { readonly success: true; readonly output: string } {
  return { success: true, output: text };
}

function failure(error: string): { readonly success: false; readonly error: string } {
  return { success: false, error };
}

function requireId(args: AgentResearchSourcesToolArgs): string {
  const id = readString(args.id);
  if (!id) throw new Error('id is required.');
  return id;
}

function requireExplicitUserRequest(args: AgentResearchSourcesToolArgs, action: string): string {
  const explicitUserRequest = readString(args.explicitUserRequest);
  if (!explicitUserRequest) throw new Error(`${action} requires explicitUserRequest with the user's exact request or a short faithful summary.`);
  return explicitUserRequest;
}

function requireConfirmedDelete(args: AgentResearchSourcesToolArgs): void {
  requireExplicitUserRequest(args, 'Research source deletion');
  if (args.confirm !== true) throw new Error('Research source deletion requires confirm:true after an explicit user request.');
}

function sourceOneLine(source: AgentResearchSourceRecord): string {
  const url = source.url ? ` ${source.url}` : '';
  const publisher = source.publisher ? ` publisher ${source.publisher}` : '';
  return `${source.id}  ${source.status}  ${source.credibility}/${source.score}${publisher}${url}  ${source.title}`;
}

function formatSourceList(
  title: string,
  sources: readonly AgentResearchSourceRecord[],
  includeReportLines: boolean,
): string {
  if (sources.length === 0) return `${title}\nNo Agent research sources matched.`;
  const lines = [
    title,
    ...sources.map(sourceOneLine),
  ];
  const reportable = sources.filter((source) => source.status === 'reviewed' || source.status === 'used');
  if (includeReportLines && reportable.length > 0) {
    lines.push('', 'Report source lines', ...reportable.map((source) => `  ${researchSourceReportLine(source)}`));
  }
  return lines.join('\n');
}

function formatSourceDetail(source: AgentResearchSourceRecord): string {
  const lines = [
    `Research source ${source.id}`,
    `title ${source.title}`,
    `question ${source.question}`,
    `status ${source.status}`,
    `credibility ${source.credibility}`,
    `score ${source.score}`,
    ...(source.url ? [`url ${source.url}`] : []),
    ...(source.publisher ? [`publisher ${source.publisher}`] : []),
    ...(source.publishedAt ? [`published ${source.publishedAt}`] : []),
    ...(source.accessedAt ? [`accessed ${source.accessedAt}`] : []),
    `tags ${source.tags.join(', ') || '(none)'}`,
    ...(source.usedInReportArtifactId ? [`usedInReportArtifact ${source.usedInReportArtifactId}`] : []),
    `created ${source.createdAt}`,
    `updated ${source.updatedAt}`,
    ...(source.reviewedAt ? [`reviewed ${source.reviewedAt}`] : []),
    ...(source.rejectedAt ? [`rejected ${source.rejectedAt}`] : []),
    ...(source.usedAt ? [`used ${source.usedAt}`] : []),
    '',
    'Summary',
    source.summary,
    '',
    ...(source.evidence ? ['Evidence', source.evidence, ''] : []),
    ...(source.note ? ['Review note', source.note, ''] : []),
    'Report source line',
    researchSourceReportLine(source),
    '',
    'Policy: source queue records are local project state only; use agent_knowledge_ingest separately for durable Agent Knowledge.',
  ];
  return lines.join('\n');
}

function formatMutationResult(action: string, source: AgentResearchSourceRecord): string {
  return [
    action,
    `  id ${source.id}`,
    `  status ${source.status}`,
    `  credibility ${source.credibility}`,
    `  score ${source.score}`,
    `  title ${source.title}`,
    `  reportLine ${researchSourceReportLine(source)}`,
    '  policy local source queue only; no Knowledge ingest or external message was sent',
  ].join('\n');
}

function addInput(args: AgentResearchSourcesToolArgs): AgentResearchSourceCreateInput {
  const url = readString(args.url);
  const publisher = readString(args.publisher);
  const publishedAt = readString(args.publishedAt);
  const accessedAt = readString(args.accessedAt);
  const evidence = readString(args.evidence);
  const credibility = readCredibility(args.credibility);
  const score = readScore(args.score);
  const note = readString(args.note);
  const provenance = readString(args.explicitUserRequest);
  return {
    question: readString(args.question),
    title: readString(args.title),
    ...(url ? { url } : {}),
    ...(publisher ? { publisher } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(accessedAt ? { accessedAt } : {}),
    summary: readString(args.summary),
    ...(evidence ? { evidence } : {}),
    ...(credibility ? { credibility } : {}),
    ...(score === undefined ? {} : { score }),
    tags: readStringList(args.tags),
    ...(note ? { note } : {}),
    provenance: provenance || 'agent-research-sources-tool',
  };
}

function createAgentResearchSourcesTool(shellPaths?: Pick<ShellPathService, 'resolveProjectPath'>): Tool {
  return {
    definition: {
      name: 'agent_research_sources',
      description: 'Manage local research source review queue.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: MODES, description: 'Source queue operation.' },
          id: { type: 'string', description: 'Source id, title, or URL for show/review/reject/use/delete.' },
          query: { type: 'string', description: 'Search text for search/list filtering.' },
          status: { type: 'string', enum: STATUS_VALUES, description: 'Optional status filter for list.' },
          question: { type: 'string', description: 'Research question or topic.' },
          title: { type: 'string', description: 'Source title.' },
          url: { type: 'string', description: 'Source URL; secret-like query values are redacted before storage.' },
          publisher: { type: 'string', description: 'Publisher or source owner.' },
          publishedAt: { type: 'string', description: 'Published date if known.' },
          accessedAt: { type: 'string', description: 'Access date; defaults to now.' },
          summary: { type: 'string', description: 'Short source summary.' },
          evidence: { type: 'string', description: 'Useful quoted-or-paraphrased evidence notes within copyright limits.' },
          credibility: { type: 'string', enum: CREDIBILITY_VALUES, description: 'Review credibility label.' },
          score: { type: 'number', description: '0-100 usefulness/credibility score.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional source tags.' },
          note: { type: 'string', description: 'Review note, rejection reason, or use note.' },
          reportArtifactId: { type: 'string', description: 'Optional report artifact id when marking a source used.' },
          includeReportLines: { type: 'boolean', description: 'Include report-form source lines in list/search output.' },
          confirm: { type: 'boolean', description: 'Required true only for delete.' },
          explicitUserRequest: { type: 'string', description: 'User request authorizing source queue writes.' },
        },
        required: ['mode'],
        additionalProperties: false,
      },
      sideEffects: ['state'],
      concurrency: 'serial',
    },
    execute: async (rawArgs: Record<string, unknown>) => {
      if (!shellPaths) return failure('Research source queue is unavailable because this runtime did not provide shell paths.');
      const registry = AgentResearchSourceRegistry.fromShellPaths(shellPaths);
      const args = rawArgs as AgentResearchSourcesToolArgs;
      const mode = readMode(args.mode);
      try {
        if (mode === 'list') {
          const status = readStatus(args.status);
          const sources = registry.list(status);
          return output(formatSourceList(
            status ? `Agent research sources (${status})` : 'Agent research sources',
            sources,
            args.includeReportLines === true,
          ));
        }
        if (mode === 'search') {
          const query = readString(args.query);
          return output(formatSourceList(`Agent research source search ${query || '(all)'}`, registry.search(query), args.includeReportLines === true));
        }
        if (mode === 'show') {
          const source = registry.get(requireId(args));
          return source ? output(formatSourceDetail(source)) : failure(`Unknown research source ${readString(args.id)}`);
        }
        if (mode === 'add') {
          requireExplicitUserRequest(args, 'Research source add');
          return output(formatMutationResult('Added Agent research source', registry.create(addInput(args))));
        }
        if (mode === 'review') {
          requireExplicitUserRequest(args, 'Research source review');
          const credibility = readCredibility(args.credibility);
          const score = readScore(args.score);
          const note = readString(args.note);
          const summary = readString(args.summary);
          const evidence = readString(args.evidence);
          const tags = args.tags === undefined ? undefined : readStringList(args.tags);
          const source = registry.review(requireId(args), {
            ...(credibility ? { credibility } : {}),
            ...(score === undefined ? {} : { score }),
            ...(note ? { note } : {}),
            ...(summary ? { summary } : {}),
            ...(evidence ? { evidence } : {}),
            ...(tags === undefined ? {} : { tags }),
          });
          return output(formatMutationResult('Reviewed Agent research source', source));
        }
        if (mode === 'reject') {
          requireExplicitUserRequest(args, 'Research source rejection');
          return output(formatMutationResult('Rejected Agent research source', registry.reject(requireId(args), readString(args.note))));
        }
        if (mode === 'use') {
          requireExplicitUserRequest(args, 'Research source use');
          const reportArtifactId = readString(args.reportArtifactId);
          const note = readString(args.note);
          return output(formatMutationResult('Marked Agent research source used', registry.markUsed(requireId(args), {
            ...(reportArtifactId ? { reportArtifactId } : {}),
            ...(note ? { note } : {}),
          })));
        }
        requireConfirmedDelete(args);
        return output(formatMutationResult('Deleted Agent research source', registry.delete(requireId(args))));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export { createAgentResearchSourcesTool };

export function registerAgentResearchSourcesTool(
  registry: ToolRegistry,
  shellPaths?: Pick<ShellPathService, 'resolveProjectPath'>,
): void {
  registry.register(createAgentResearchSourcesTool(shellPaths));
}
