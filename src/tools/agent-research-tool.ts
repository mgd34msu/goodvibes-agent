import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { CommandContext, CommandRegistry } from '../input/command-registry.ts';
import { AgentResearchRunRegistry, type AgentResearchRunRecord } from '../agent/research-run-registry.ts';
import { createAgentArtifactsTool } from './agent-artifacts-tool.ts';
import { createAgentHarnessTool } from './agent-harness-tool.ts';
import { createAgentResearchReportTool } from './agent-research-report-tool.ts';
import { createAgentResearchRunsTool } from './agent-research-runs-tool.ts';
import { createAgentResearchSourcesTool } from './agent-research-sources-tool.ts';

type AgentResearchAction =
  | 'briefing'
  | 'plan'
  | 'runner'
  | 'runs'
  | 'run'
  | 'sources'
  | 'source'
  | 'bundle'
  | 'search'
  | 'reports'
  | 'report_artifact'
  | 'create_run'
  | 'start_run'
  | 'checkpoint'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'complete'
  | 'fail'
  | 'delete_run'
  | 'add_source'
  | 'review_source'
  | 'reject_source'
  | 'use_source'
  | 'delete_source'
  | 'report';

interface AgentResearchToolArgs {
  readonly action?: unknown;
  readonly mode?: unknown;
  readonly id?: unknown;
  readonly runId?: unknown;
  readonly sourceId?: unknown;
  readonly artifactId?: unknown;
  readonly query?: unknown;
  readonly target?: unknown;
  readonly providerId?: unknown;
  readonly maxResults?: unknown;
  readonly region?: unknown;
  readonly safeSearch?: unknown;
  readonly timeRange?: unknown;
  readonly evidenceTopN?: unknown;
  readonly evidenceExtract?: unknown;
  readonly title?: unknown;
  readonly question?: unknown;
  readonly goal?: unknown;
  readonly plan?: unknown;
  readonly nextSteps?: unknown;
  readonly sourceIds?: unknown;
  readonly status?: unknown;
  readonly phase?: unknown;
  readonly progress?: unknown;
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
  readonly error?: unknown;
  readonly reportMarkdown?: unknown;
  readonly sources?: unknown;
  readonly findings?: unknown;
  readonly gaps?: unknown;
  readonly recommendations?: unknown;
  readonly methodology?: unknown;
  readonly confidence?: unknown;
  readonly requireCitationCoverage?: unknown;
  readonly visualReport?: unknown;
  readonly includeReportLines?: unknown;
  readonly includeParameters?: unknown;
  readonly includeContent?: unknown;
  readonly previewBytes?: unknown;
  readonly limit?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

interface AgentResearchToolDeps {
  readonly commandRegistry: CommandRegistry;
  readonly commandContext: CommandContext;
  readonly toolRegistry: ToolRegistry;
  readonly harnessTool?: Tool;
  readonly runsTool?: Tool;
  readonly sourcesTool?: Tool;
  readonly reportTool?: Tool;
  readonly artifactTool?: Tool;
  readonly webSearchTool?: Tool;
}

function error(message: string): { readonly success: false; readonly error: string } {
  return { success: false, error: message };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(parsed)));
}

function normalizeResearchAction(value: unknown): AgentResearchAction | null {
  const action = readString(value).toLowerCase().replace(/-/g, '_');
  if (!action) return null;
  if (action === 'briefing' || action === 'brief' || action === 'status' || action === 'dashboard' || action === 'cockpit' || action === 'next') return 'briefing';
  if (action === 'plan' || action === 'workflow' || action === 'research') return 'plan';
  if (action === 'runner' || action === 'browser' || action === 'browser_runner' || action === 'browser_backed' || action === 'deep_research') return 'runner';
  if (action === 'runs' || action === 'list_runs' || action === 'run_list') return 'runs';
  if (action === 'run' || action === 'show_run' || action === 'inspect_run') return 'run';
  if (action === 'sources' || action === 'queue' || action === 'source_queue') return 'sources';
  if (action === 'source' || action === 'show_source' || action === 'inspect_source') return 'source';
  if (action === 'bundle' || action === 'bundle_sources' || action === 'source_bundle') return 'bundle';
  if (action === 'search' || action === 'public_search' || action === 'collect' || action === 'collect_sources' || action === 'source_candidates') return 'search';
  if (action === 'reports' || action === 'list_reports' || action === 'report_list' || action === 'visual_reports') return 'reports';
  if (action === 'report_artifact' || action === 'show_report' || action === 'inspect_report' || action === 'show_visual_report' || action === 'visual_report_artifact') return 'report_artifact';
  if (action === 'create_run' || action === 'new_run') return 'create_run';
  if (action === 'start' || action === 'start_run' || action === 'begin_run' || action === 'run_start') return 'start_run';
  if (action === 'checkpoint' || action === 'checkpoint_run') return 'checkpoint';
  if (action === 'pause' || action === 'pause_run') return 'pause';
  if (action === 'resume' || action === 'resume_run') return 'resume';
  if (action === 'cancel' || action === 'cancel_run') return 'cancel';
  if (action === 'complete' || action === 'complete_run') return 'complete';
  if (action === 'fail' || action === 'fail_run') return 'fail';
  if (action === 'delete_run' || action === 'remove_run') return 'delete_run';
  if (action === 'add_source' || action === 'capture_source' || action === 'new_source') return 'add_source';
  if (action === 'review_source' || action === 'score_source') return 'review_source';
  if (action === 'reject_source' || action === 'reject') return 'reject_source';
  if (action === 'use_source' || action === 'mark_source_used' || action === 'mark_used') return 'use_source';
  if (action === 'delete_source' || action === 'remove_source') return 'delete_source';
  if (action === 'report' || action === 'save_report' || action === 'visual_report') return 'report';
  return null;
}

function readAction(args: AgentResearchToolArgs): AgentResearchAction {
  const explicit = normalizeResearchAction(args.action) ?? normalizeResearchAction(args.mode);
  if (explicit) return explicit;
  if (readString(args.sourceId)) return 'source';
  if (readString(args.runId)) return 'run';
  if (readString(args.query) || readString(args.target)) return 'plan';
  return 'plan';
}

function compactArgs(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined && value !== ''));
}

function lookupId(args: AgentResearchToolArgs): string {
  return readString(args.id) || readString(args.runId) || readString(args.sourceId) || readString(args.artifactId) || readString(args.reportArtifactId);
}

function planArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    mode: 'research_workflow',
    query: args.query,
    target: args.target,
    runId: args.runId || args.id,
    includeParameters: args.includeParameters,
  });
}

function briefingArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    mode: 'research_briefing',
    query: args.query,
    target: args.target,
    limit: args.limit,
    includeParameters: args.includeParameters,
  });
}

function runsArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    mode: 'research_runs',
    query: args.query,
    limit: args.limit,
    includeParameters: args.includeParameters,
  });
}

function runnerArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    mode: 'research_workflow',
    query: args.query ?? args.target ?? 'browser-backed research runner',
    runId: args.runId || args.id,
    includeParameters: args.includeParameters ?? true,
  });
}

function runArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    mode: 'research_run',
    runId: lookupId(args),
    target: lookupId(args) ? undefined : args.target,
    query: lookupId(args) ? undefined : args.query,
    includeParameters: args.includeParameters,
  });
}

function sourcesArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    mode: 'research_queue',
    query: args.query,
    limit: args.limit,
    includeParameters: args.includeParameters,
  });
}

function sourceArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    mode: 'research_source',
    sourceId: lookupId(args),
    target: lookupId(args) ? undefined : args.target,
    query: lookupId(args) ? undefined : args.query,
    includeParameters: args.includeParameters,
  });
}

function confirmedArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    confirm: args.confirm,
    explicitUserRequest: args.explicitUserRequest,
  });
}

function createRunArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    mode: 'create',
    title: args.title,
    question: args.question ?? args.query,
    goal: args.goal,
    plan: args.plan,
    nextSteps: args.nextSteps,
    sourceIds: args.sourceIds,
    note: args.note,
    ...confirmedArgs(args),
  });
}

function runMutationArgs(args: AgentResearchToolArgs, mode: string): Record<string, unknown> {
  return compactArgs({
    mode,
    id: lookupId(args),
    status: args.status,
    phase: args.phase,
    progress: args.progress,
    note: args.note,
    nextSteps: args.nextSteps,
    sourceIds: args.sourceIds,
    reportArtifactId: args.reportArtifactId,
    error: args.error,
    ...confirmedArgs(args),
  });
}

function bundleArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    mode: 'bundle',
    query: args.query ?? args.target,
    limit: args.limit,
    includeReportLines: args.includeReportLines ?? true,
  });
}

function searchArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  const safeSearch = readString(args.safeSearch).toLowerCase() === 'strict' ? 'strict' : 'moderate';
  return compactArgs({
    query: args.query ?? args.target,
    providerId: args.providerId,
    maxResults: readNumber(args.maxResults, readNumber(args.limit, 5, 10), 10),
    verbosity: 'evidence',
    region: args.region,
    safeSearch,
    timeRange: args.timeRange,
    includeEvidence: true,
    evidenceTopN: readNumber(args.evidenceTopN, 3, 3),
    evidenceExtract: args.evidenceExtract ?? 'readable',
  });
}

function reportsArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    mode: 'list',
    purpose: 'agent-research-report',
    query: args.query ?? args.target,
    limit: args.limit,
  });
}

function reportArtifactArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    mode: 'show',
    artifactId: lookupId(args),
    includeContent: args.includeContent ?? true,
    previewBytes: args.previewBytes,
  });
}

function previewText(value: unknown, limit: number): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readRecordArray(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(readRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry)) : [];
}

function hostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function sanitizeUrlForRoute(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|password|authorization|credential|api[-_]?key/i.test(key)) url.searchParams.set(key, '<redacted>');
    }
    return url.toString();
  } catch {
    return value.replace(/([?&\s](?:token|secret|password|authorization|credential|api[-_]?key)=)[^\s&]+/gi, '$1<redacted>');
  }
}

function candidateFromSearchResult(question: string, result: Record<string, unknown>, index: number): Record<string, unknown> {
  const rawUrl = readString(result.url);
  const url = sanitizeUrlForRoute(rawUrl);
  const title = previewText(result.title, 120) || hostname(rawUrl) || `Search result ${index + 1}`;
  const publisher = previewText(result.domain, 80) || hostname(rawUrl);
  const evidenceRecords = readRecordArray(result.evidence);
  const evidenceText = previewText(
    evidenceRecords.map((entry) => readString(entry.content)).filter(Boolean).join('\n\n') || result.snippet,
    420,
  );
  const summary = previewText(result.snippet, 260) || previewText(evidenceText, 260) || `Public web result for ${question}.`;
  const captureArgs = compactArgs({
    action: 'add_source',
    question,
    title,
    url,
    publisher,
    summary,
    evidence: evidenceText,
    credibility: 'unreviewed',
    tags: ['research', 'web-search'],
    confirm: true,
    explicitUserRequest: '...',
  });
  return {
    rank: typeof result.rank === 'number' ? result.rank : index + 1,
    title,
    url,
    ...(publisher ? { publisher } : {}),
    summary,
    ...(evidenceText ? { evidencePreview: evidenceText } : {}),
    captureArgs,
    captureRoute: [
      'research action:"add_source"',
      `question:${quote(question)}`,
      `title:${quote(title)}`,
      ...(url ? [`url:${quote(url)}`] : []),
      ...(publisher ? [`publisher:${quote(publisher)}`] : []),
      `summary:${quote(summary)}`,
      ...(evidenceText ? [`evidence:${quote(evidenceText)}`] : []),
      'credibility:"unreviewed"',
      'tags:["research","web-search"]',
      'confirm:true',
      'explicitUserRequest:"..."',
    ].join(' '),
  };
}

function parseSearchPayload(outputValue: unknown): Record<string, unknown> | null {
  if (typeof outputValue !== 'string') return readRecord(outputValue);
  try {
    return readRecord(JSON.parse(outputValue));
  } catch {
    return null;
  }
}

function resolveSearchRun(args: AgentResearchToolArgs, shellPaths: CommandContext['workspace']['shellPaths'] | undefined): AgentResearchRunRecord | null {
  if (!shellPaths) return null;
  const lookup = readString(args.runId) || readString(args.id);
  if (!lookup) return null;
  return AgentResearchRunRegistry.fromShellPaths(shellPaths).get(lookup);
}

async function runPublicSearch(
  webSearchTool: Tool | undefined,
  args: AgentResearchToolArgs,
  shellPaths: CommandContext['workspace']['shellPaths'] | undefined,
): Promise<{ readonly success: true; readonly output: string } | { readonly success: false; readonly error: string }> {
  const run = resolveSearchRun(args, shellPaths);
  const query = readString(args.query) || readString(args.question) || run?.question || readString(args.target);
  if ((readString(args.runId) || readString(args.id)) && !run && !readString(args.query) && !readString(args.question)) {
    return error(`Unknown research run ${readString(args.runId) || readString(args.id)}. Use research action:"runs" to inspect run ids.`);
  }
  if (!query) return error('research action:"search" requires query or target.');
  if (!webSearchTool) {
    return error('Bounded public web search is unavailable because web_search is not registered. Use research action:"briefing" for the offline next-action queue or action:"plan" for the route plan.');
  }
  const webArgs = searchArgs({ ...args, query });
  const webResult = await webSearchTool.execute(webArgs);
  if (!webResult.success) return { success: false, error: readString(webResult.error) || 'web_search failed.' };
  const payload = parseSearchPayload(webResult.output);
  const results = readRecordArray(payload?.results);
  const sourceCandidates = results
    .filter((result) => readString(result.url))
    .map((result, index) => candidateFromSearchResult(query, result, index));
  return {
    success: true,
    output: JSON.stringify({
      status: sourceCandidates.length > 0 ? 'source-candidates-ready' : 'no-source-candidates',
      query,
      providerId: readString(payload?.providerId),
      providerLabel: readString(payload?.providerLabel),
      resultCount: results.length,
      sourceCandidateCount: sourceCandidates.length,
      sourceCandidates,
      nextRoutes: {
        ...(run ? {
          run: `research action:"run" runId:${quote(run.id)}`,
          briefing: `research action:"briefing" target:${quote(run.id)}`,
          startRun: `research action:"start_run" id:${quote(run.id)} confirm:true explicitUserRequest:"..."`,
          checkpointAfterCapture: `research action:"checkpoint" id:${quote(run.id)} phase:"reading" progress:${Math.max(run.progress, 25)} note:"Captured candidate sources for review." sourceIds:["..."] confirm:true explicitUserRequest:"..."`,
        } : {
          createRun: `research action:"create_run" question:${quote(query)} plan:["Search bounded public web sources","Capture candidate sources","Review credibility","Save sourced report"] confirm:true explicitUserRequest:"..."`,
        }),
        sourceQueue: `research action:"sources" query:${quote(query)}`,
        reviewedBundle: `research action:"bundle" query:${quote(query)} includeReportLines:true`,
        saveReport: `research action:"report" question:${quote(query)} sources:[...] visualReport:true requireCitationCoverage:true confirm:true explicitUserRequest:"..."`,
      },
      ...(run ? { run: { id: run.id, title: run.title, status: run.status, phase: run.phase, progress: run.progress } } : {}),
      searchArgs: webArgs,
      policy: 'This route performs bounded read-only public web search only. It does not create or start a run, save sources, checkpoint progress, write a report, ingest Knowledge, or send messages. Use each returned route only after explicit user confirmation.',
    }, null, 2),
  };
}

function addSourceArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    mode: 'add',
    question: args.question ?? args.query,
    title: args.title,
    url: args.url,
    publisher: args.publisher,
    publishedAt: args.publishedAt,
    accessedAt: args.accessedAt,
    summary: args.summary,
    evidence: args.evidence,
    credibility: args.credibility,
    score: args.score,
    tags: args.tags,
    note: args.note,
    ...confirmedArgs(args),
  });
}

function reviewSourceArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    mode: 'review',
    id: lookupId(args),
    credibility: args.credibility,
    score: args.score,
    note: args.note,
    summary: args.summary,
    evidence: args.evidence,
    tags: args.tags,
    ...confirmedArgs(args),
  });
}

function sourceMutationArgs(args: AgentResearchToolArgs, mode: string): Record<string, unknown> {
  return compactArgs({
    mode,
    id: lookupId(args),
    note: args.note,
    reportArtifactId: args.reportArtifactId,
    ...confirmedArgs(args),
  });
}

function reportArgs(args: AgentResearchToolArgs): Record<string, unknown> {
  return compactArgs({
    title: args.title,
    question: args.question ?? args.query,
    summary: args.summary,
    reportMarkdown: args.reportMarkdown,
    sources: args.sources,
    findings: args.findings,
    gaps: args.gaps,
    recommendations: args.recommendations,
    methodology: args.methodology,
    confidence: args.confidence,
    requireCitationCoverage: args.requireCitationCoverage,
    visualReport: args.visualReport,
    tags: args.tags,
    ...confirmedArgs(args),
  });
}

export function createAgentResearchTool(deps: AgentResearchToolDeps): Tool {
  const shellPaths = deps.commandContext.workspace?.shellPaths;
  const harnessTool = deps.harnessTool ?? createAgentHarnessTool({
    commandRegistry: deps.commandRegistry,
    commandContext: deps.commandContext,
    toolRegistry: deps.toolRegistry,
  });
  const runsTool = deps.runsTool ?? createAgentResearchRunsTool(shellPaths);
  const sourcesTool = deps.sourcesTool ?? createAgentResearchSourcesTool(shellPaths);
  const reportTool = deps.reportTool ?? createAgentResearchReportTool(deps.commandContext.platform?.artifactStore);
  const artifactTool = deps.artifactTool
    ?? deps.toolRegistry.list().find((entry) => entry.definition.name === 'agent_artifacts')
    ?? createAgentArtifactsTool(deps.commandContext.platform?.artifactStore);
  const webSearchTool = deps.webSearchTool
    ?? deps.toolRegistry.list().find((entry) => entry.definition.name === 'web_search');

  return {
    definition: {
      name: 'research',
      description: 'Plan, track, source, and save research.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'briefing',
              'plan',
              'runner',
              'runs',
              'run',
              'sources',
              'source',
              'bundle',
              'search',
              'reports',
              'report_artifact',
              'create_run',
              'start_run',
              'checkpoint',
              'pause',
              'resume',
              'cancel',
              'complete',
              'fail',
              'delete_run',
              'add_source',
              'review_source',
              'reject_source',
              'use_source',
              'delete_source',
              'report',
            ],
            description: 'Read plans/queues; confirm writes.',
          },
          mode: { type: 'string', description: 'Alias for action.' },
          id: { type: 'string', description: 'Run or source id alias.' },
          runId: { type: 'string', description: 'Research run id.' },
          sourceId: { type: 'string', description: 'Research source id.' },
          artifactId: { type: 'string', description: 'Research report artifact id.' },
          query: { type: 'string', description: 'Research request or queue search.' },
          target: { type: 'string', description: 'Lookup target alias.' },
          providerId: { type: 'string', description: 'Optional web_search provider id for action:"search".' },
          maxResults: { type: 'number', maximum: 10, description: 'Maximum public search results for action:"search".' },
          region: { type: 'string', description: 'Provider-specific region for action:"search".' },
          safeSearch: { type: 'string', enum: ['strict', 'moderate'], description: 'Safe-search setting for action:"search".' },
          timeRange: { type: 'string', enum: ['any', 'day', 'week', 'month', 'year'], description: 'Optional search time range.' },
          evidenceTopN: { type: 'number', maximum: 3, description: 'Maximum evidence fetches for action:"search".' },
          evidenceExtract: { type: 'string', enum: ['text', 'markdown', 'readable', 'code_blocks', 'links', 'metadata', 'tables'], description: 'Bounded evidence extraction mode.' },
          title: { type: 'string', description: 'Run, source, or report title.' },
          question: { type: 'string', description: 'Research question.' },
          goal: { type: 'string', description: 'Visible outcome for a new run.' },
          plan: { type: 'array', items: { type: 'string' }, description: 'Run plan steps.' },
          nextSteps: { type: 'array', items: { type: 'string' }, description: 'Next visible run steps.' },
          sourceIds: { type: 'array', items: { type: 'string' }, description: 'Run source ids.' },
          status: { type: 'string', description: 'Mutable run status.' },
          phase: { type: 'string', description: 'Research run phase.' },
          progress: { type: 'number', description: '0-100 run progress.' },
          url: { type: 'string', description: 'Source URL.' },
          publisher: { type: 'string', description: 'Source publisher.' },
          publishedAt: { type: 'string', description: 'Source published date.' },
          accessedAt: { type: 'string', description: 'Source access date.' },
          summary: { type: 'string', description: 'Summary for source or report.' },
          evidence: { type: 'string', description: 'Source evidence notes.' },
          credibility: { type: 'string', enum: ['unreviewed', 'low', 'medium', 'high', 'mixed'], description: 'Source credibility.' },
          score: { type: 'number', description: '0-100 source score.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
          note: { type: 'string', description: 'Run or source note.' },
          reportArtifactId: { type: 'string', description: 'Saved report artifact id.' },
          error: { type: 'string', description: 'Run failure detail.' },
          reportMarkdown: { type: 'string', description: 'Full report markdown.' },
          sources: { type: 'array', items: { type: 'object' }, description: 'Reviewed report sources.' },
          findings: { type: 'array', items: { type: 'string' }, description: 'Key findings.' },
          gaps: { type: 'array', items: { type: 'string' }, description: 'Open caveats.' },
          recommendations: { type: 'array', items: { type: 'string' }, description: 'Recommended actions.' },
          methodology: { type: 'string', description: 'Source selection method.' },
          confidence: { type: 'string', description: 'Overall confidence label.' },
          requireCitationCoverage: { type: 'boolean', description: 'Require cited sources.' },
          visualReport: { type: 'boolean', description: 'Append visual packet sections.' },
          includeReportLines: { type: 'boolean', description: 'Include report source lines.' },
          includeParameters: { type: 'boolean', description: 'Include bounded route details.' },
          includeContent: { type: 'boolean', description: 'Preview saved report artifact content.' },
          previewBytes: { type: 'number', description: 'Maximum saved report preview bytes.' },
          limit: { type: 'number', description: 'Maximum rows.' },
          confirm: { type: 'boolean', description: 'Required true for writes.' },
          explicitUserRequest: { type: 'string', description: 'User request authorizing writes.' },
        },
        additionalProperties: false,
      },
      sideEffects: ['state'],
      concurrency: 'serial',
    },
    execute: async (rawArgs: unknown) => {
      const args = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {}) as AgentResearchToolArgs;
      const action = readAction(args);

      if (action === 'briefing') return harnessTool.execute(briefingArgs(args));
      if (action === 'plan') return harnessTool.execute(planArgs(args));
      if (action === 'runner') return harnessTool.execute(runnerArgs(args));
      if (action === 'runs') return harnessTool.execute(runsArgs(args));
      if (action === 'run') return harnessTool.execute(runArgs(args));
      if (action === 'sources') return harnessTool.execute(sourcesArgs(args));
      if (action === 'source') return harnessTool.execute(sourceArgs(args));
      if (action === 'bundle') return sourcesTool.execute(bundleArgs(args));
      if (action === 'search') return runPublicSearch(webSearchTool, args, shellPaths);
      if (action === 'reports') return artifactTool.execute(reportsArgs(args));
      if (action === 'report_artifact') return artifactTool.execute(reportArtifactArgs(args));
      if (action === 'create_run') return runsTool.execute(createRunArgs(args));
      if (action === 'start_run') return runsTool.execute(runMutationArgs(args, 'start'));
      if (action === 'checkpoint') return runsTool.execute(runMutationArgs(args, 'checkpoint'));
      if (action === 'pause') return runsTool.execute(runMutationArgs(args, 'pause'));
      if (action === 'resume') return runsTool.execute(runMutationArgs(args, 'resume'));
      if (action === 'cancel') return runsTool.execute(runMutationArgs(args, 'cancel'));
      if (action === 'complete') return runsTool.execute(runMutationArgs(args, 'complete'));
      if (action === 'fail') return runsTool.execute(runMutationArgs(args, 'fail'));
      if (action === 'delete_run') return runsTool.execute(runMutationArgs(args, 'delete'));
      if (action === 'add_source') return sourcesTool.execute(addSourceArgs(args));
      if (action === 'review_source') return sourcesTool.execute(reviewSourceArgs(args));
      if (action === 'reject_source') return sourcesTool.execute(sourceMutationArgs(args, 'reject'));
      if (action === 'use_source') return sourcesTool.execute(sourceMutationArgs(args, 'use'));
      if (action === 'delete_source') return sourcesTool.execute(sourceMutationArgs(args, 'delete'));
      if (action === 'report') return reportTool.execute(reportArgs(args));

      return error('Unknown research action. Use action:"plan" for research routing.');
    },
  };
}

export function registerAgentResearchTool(
  registry: ToolRegistry,
  commandRegistry: CommandRegistry,
  commandContext: CommandContext,
): void {
  if (!registry.has('research')) registry.register(createAgentResearchTool({ commandRegistry, commandContext, toolRegistry: registry }));
}
