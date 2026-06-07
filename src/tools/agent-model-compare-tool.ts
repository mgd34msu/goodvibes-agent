import { randomUUID } from 'node:crypto';
import type { ArtifactDescriptor, ArtifactRecord, ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { ChatRequest, ChatResponse, LLMProvider } from '@pellux/goodvibes-sdk/platform/providers';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import {
  createZipArchive,
  packageArtifactFilename,
  sanitizeArtifactMetadata,
  sanitizeArtifactSourceUri,
  type ArtifactPackageEntry,
} from './artifact-archive.ts';

export interface AgentModelCompareToolArgs {
  readonly mode?: unknown;
  readonly prompt?: unknown;
  readonly modelRefs?: unknown;
  readonly candidateCount?: unknown;
  readonly rubric?: unknown;
  readonly systemPrompt?: unknown;
  readonly maxTokens?: unknown;
  readonly reveal?: unknown;
  readonly saveArtifact?: unknown;
  readonly benchmarkKind?: unknown;
  readonly comparisonId?: unknown;
  readonly artifactId?: unknown;
  readonly leftArtifactId?: unknown;
  readonly rightArtifactId?: unknown;
  readonly sectionId?: unknown;
  readonly winner?: unknown;
  readonly winnerBlindId?: unknown;
  readonly reasons?: unknown;
  readonly notes?: unknown;
  readonly decision?: unknown;
  readonly limit?: unknown;
  readonly includeReasons?: unknown;
  readonly taskType?: unknown;
  readonly documentId?: unknown;
  readonly relatedArtifactIds?: unknown;
  readonly previewBytes?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

export interface AgentModelCompareRouteUpdateResult {
  readonly previousModel?: string;
  readonly selectedModel: string;
}

export interface AgentModelCompareCatalogModel {
  readonly id?: string;
  readonly modelId?: string;
  readonly provider?: string;
  readonly providerId?: string;
  readonly registryKey?: string;
  readonly displayName?: string;
  readonly selectable?: boolean;
  readonly current?: boolean;
  readonly contextWindow?: number;
}

export interface AgentModelCompareModelCatalog {
  readonly listModels: (query?: { readonly selectableOnly?: boolean }) => readonly AgentModelCompareCatalogModel[] | Promise<readonly AgentModelCompareCatalogModel[]>;
  readonly getCurrentModel?: () => AgentModelCompareCatalogModel | Promise<AgentModelCompareCatalogModel>;
  readonly recordModelUsage?: (registryKey: string) => Promise<unknown>;
}

export interface AgentModelCompareProviderRegistry {
  readonly getForModel: (modelId: string, provider?: string) => LLMProvider;
}

type AgentModelCompareArtifactStore = Pick<ArtifactStore, 'create'> & Partial<Pick<ArtifactStore, 'list' | 'readContent'>>;

export interface AgentModelCompareToolDeps {
  readonly modelCatalog: AgentModelCompareModelCatalog;
  readonly providerRegistry: AgentModelCompareProviderRegistry;
  readonly artifactStore?: AgentModelCompareArtifactStore;
  readonly applyModelRoute?: (registryKey: string) => AgentModelCompareRouteUpdateResult | Promise<AgentModelCompareRouteUpdateResult>;
}

interface ResolvedCompareModel {
  readonly registryKey: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly current: boolean;
}

type CompareCandidateStatus = 'completed' | 'failed';

interface CompareCandidateResult {
  readonly blindId: string;
  readonly model: ResolvedCompareModel;
  readonly status: CompareCandidateStatus;
  readonly content: string;
  readonly stopReason?: string;
  readonly usage?: ChatResponse['usage'];
  readonly latencyMs: number;
  readonly toolCallCount?: number;
  readonly error?: string;
}

interface StoredComparison {
  readonly comparisonId: string;
  readonly createdAt: string;
  readonly promptPreview: string;
  readonly rubric: string;
  readonly sourceArtifact?: SavedComparisonArtifact;
  readonly benchmarkKind?: string;
  readonly taskType?: string;
  readonly documentId?: string;
  readonly candidates: readonly CompareCandidateResult[];
  readonly artifact?: SavedComparisonArtifact;
  readonly artifactStatus?: ComparisonArtifactStatus;
}

interface LoadedComparisonJudgment {
  readonly artifact: SavedComparisonArtifact;
  readonly judgmentId: string;
  readonly comparisonId: string;
  readonly winnerBlindId: string;
  readonly reasons: string;
  readonly notes: string;
  readonly revealIncludedInJudgment: boolean;
  readonly sourceArtifactId?: string;
  readonly benchmarkKind?: string;
  readonly taskType?: string;
  readonly documentId?: string;
  readonly winnerModel?: {
    readonly registryKey: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly displayName: string;
  };
}

interface LoadedComparisonHandoff {
  readonly artifact: SavedComparisonArtifact;
  readonly handoffId: string;
  readonly sourceArtifactId: string;
  readonly sourceKind: 'comparison' | 'judgment';
  readonly comparisonId: string;
  readonly relatedArtifactIds: readonly string[];
  readonly revealIncludedInHandoff: boolean;
}

interface SavedComparisonArtifact {
  readonly artifactId: string;
  readonly filename?: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly documentId?: string;
}

interface ComparisonArtifactStatus {
  readonly state: 'saved' | 'disabled' | 'unavailable' | 'failed';
  readonly message: string;
}

const MODE_RUN = 'run';
const MODE_REVEAL = 'reveal';
const MODE_REVIEW = 'review';
const MODE_SIDE_BY_SIDE = 'sideBySide';
const MODE_JUDGE = 'judge';
const MODE_APPLY = 'apply';
const MODE_ROUTE_DECISION = 'routeDecision';
const MODE_EXPORT = 'export';
const MODE_HANDOFF = 'handoff';
const MODE_HANDOFF_ARCHIVE = 'handoffArchive';
const MODE_HANDOFF_DIFF = 'handoffDiff';
const MODE_ANALYTICS = 'analytics';
const MODE_SYNTHESIS = 'synthesis';
const MAX_PROMPT_CHARS = 24_000;
const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 4;
const DEFAULT_CANDIDATE_COUNT = 2;
const DEFAULT_MAX_TOKENS = 2_048;
const MAX_COMPLETION_TOKENS = 8_192;
const DEFAULT_CANDIDATE_OUTPUT_CHARS = 12_000;
const MAX_SOURCE_ARTIFACT_BYTES = 18_000;
const MAX_HANDOFF_ARTIFACT_BYTES = 40_000;
const MAX_HANDOFF_ARCHIVE_ARTIFACTS = 100;
const MAX_HANDOFF_DIFF_INPUT_LINES = 360;
const MAX_HANDOFF_DIFF_ROWS = 120;
const MAX_HANDOFF_DIFF_SECTION_PREVIEW_CHARS = 180;
const DEFAULT_SIDE_BY_SIDE_PREVIEW_BYTES = 2_000;
const MAX_SIDE_BY_SIDE_PREVIEW_BYTES = 10_000;
const COMPARISON_STORE_LIMIT = 25;
const BLIND_LABELS = ['A', 'B', 'C', 'D'] as const;

const SYNTHESIS_THEMES: readonly {
  readonly label: string;
  readonly pattern: RegExp;
}[] = [
  { label: 'Concrete/actionable output', pattern: /\b(concrete|actionable|specific|steps?|route|command|practical)\b/i },
  { label: 'Clear/scannable communication', pattern: /\b(clear|clarity|concise|scan|scannable|readable|structured|tone)\b/i },
  { label: 'Accuracy and faithfulness', pattern: /\b(accurate|accuracy|faithful|correct|factual|hallucinat|source|evidence)\b/i },
  { label: 'Context fit', pattern: /\b(context|project|user|goal|fit|rubric|instruction)\b/i },
  { label: 'Safety and risk handling', pattern: /\b(safe|safety|risk|guard|permission|confirm|policy)\b/i },
  { label: 'Speed and efficiency', pattern: /\b(fast|speed|latency|efficient|short|token)\b/i },
];

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes';
}

function readOptionalBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  return readBoolean(value);
}

function readNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function readBenchmarkKind(value: unknown): string {
  return readComparisonTag(value);
}

function readComparisonTag(value: unknown): string {
  return readString(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
    .trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function failure(error: string): { readonly success: false; readonly error: string } {
  return { success: false, error };
}

function output(text: string): { readonly success: true; readonly output: string } {
  return { success: true, output: text };
}

function previewText(value: string, limit = 96): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3).trimEnd()}...`;
}

function isTextLike(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith('text/')
    || normalized.includes('json')
    || normalized.includes('xml')
    || normalized.includes('yaml')
    || normalized.includes('csv')
    || normalized.includes('javascript')
    || normalized.includes('typescript')
    || normalized.includes('markdown');
}

function readModelRefs(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => readString(entry))
      .filter(Boolean);
  }
  const text = readString(value);
  if (!text) return [];
  return text.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
}

function readStringList(value: unknown): readonly string[] {
  const raw = Array.isArray(value)
    ? value
    : readString(value).split(/[\n,]/);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    const text = readString(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function normalizeCatalogModel(model: AgentModelCompareCatalogModel): ResolvedCompareModel | null {
  const modelId = readString(model.modelId ?? model.id);
  const providerId = readString(model.providerId ?? model.provider);
  if (!modelId || !providerId) return null;
  return {
    modelId,
    providerId,
    registryKey: readString(model.registryKey) || `${providerId}:${modelId}`,
    displayName: readString(model.displayName) || modelId,
    current: model.current === true,
  };
}

function modelSearchText(model: ResolvedCompareModel): string {
  return [
    model.registryKey,
    model.modelId,
    model.providerId,
    model.displayName,
  ].join('\n').toLowerCase();
}

function dedupeModels(models: readonly ResolvedCompareModel[]): readonly ResolvedCompareModel[] {
  const seen = new Set<string>();
  const result: ResolvedCompareModel[] = [];
  for (const model of models) {
    if (seen.has(model.registryKey)) continue;
    seen.add(model.registryKey);
    result.push(model);
  }
  return result;
}

async function listSelectableModels(catalog: AgentModelCompareModelCatalog): Promise<readonly ResolvedCompareModel[]> {
  const rawModels = await catalog.listModels({ selectableOnly: true });
  return dedupeModels(rawModels
    .filter((model) => model.selectable !== false)
    .map(normalizeCatalogModel)
    .filter((model): model is ResolvedCompareModel => model !== null));
}

async function resolveCurrentModel(catalog: AgentModelCompareModelCatalog): Promise<ResolvedCompareModel | null> {
  if (!catalog.getCurrentModel) return null;
  try {
    return normalizeCatalogModel(await catalog.getCurrentModel());
  } catch {
    return null;
  }
}

function resolveRequestedModels(
  refs: readonly string[],
  selectableModels: readonly ResolvedCompareModel[],
): readonly ResolvedCompareModel[] {
  const resolved: ResolvedCompareModel[] = [];
  for (const ref of refs) {
    const normalizedRef = ref.toLowerCase();
    const exact = selectableModels.find((model) => model.registryKey.toLowerCase() === normalizedRef)
      ?? selectableModels.find((model) => `${model.providerId}:${model.modelId}`.toLowerCase() === normalizedRef);
    if (exact) {
      resolved.push(exact);
      continue;
    }
    const modelIdMatches = selectableModels.filter((model) => model.modelId.toLowerCase() === normalizedRef);
    if (modelIdMatches.length === 1) {
      resolved.push(modelIdMatches[0]!);
      continue;
    }
    const displayMatches = selectableModels.filter((model) => model.displayName.toLowerCase() === normalizedRef);
    if (displayMatches.length === 1) {
      resolved.push(displayMatches[0]!);
      continue;
    }
    const fuzzy = selectableModels.filter((model) => modelSearchText(model).includes(normalizedRef));
    if (fuzzy.length === 1) resolved.push(fuzzy[0]!);
  }
  return dedupeModels(resolved);
}

async function selectComparisonModels(
  catalog: AgentModelCompareModelCatalog,
  refs: readonly string[],
  candidateCount: number,
): Promise<readonly ResolvedCompareModel[]> {
  const selectableModels = await listSelectableModels(catalog);
  if (selectableModels.length < MIN_CANDIDATES) {
    throw new Error(`At least ${MIN_CANDIDATES} selectable models are required for blind comparison.`);
  }

  if (refs.length > 0) {
    const requested = resolveRequestedModels(refs, selectableModels);
    const missing = refs.length - requested.length;
    if (missing > 0) {
      throw new Error(`Could not resolve ${missing} requested model reference(s). Use registry keys from mode:"model_routing".`);
    }
    if (requested.length < MIN_CANDIDATES) throw new Error(`Select at least ${MIN_CANDIDATES} different models.`);
    if (requested.length > MAX_CANDIDATES) throw new Error(`Select at most ${MAX_CANDIDATES} models.`);
    return requested;
  }

  const current = await resolveCurrentModel(catalog);
  const count = clamp(candidateCount, MIN_CANDIDATES, MAX_CANDIDATES);
  const ordered = dedupeModels([
    ...(current ? [current] : []),
    ...selectableModels,
  ]).filter((model) => selectableModels.some((selectable) => selectable.registryKey === model.registryKey));
  return ordered.slice(0, count);
}

function createPromptRequest(
  model: ResolvedCompareModel,
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
): ChatRequest {
  return {
    model: model.modelId,
    messages: [{ role: 'user', content: prompt }],
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(maxTokens > 0 ? { maxTokens } : {}),
  };
}

async function runCandidate(
  deps: AgentModelCompareToolDeps,
  model: ResolvedCompareModel,
  blindId: string,
  prompt: string,
  systemPrompt: string,
  maxTokens: number,
): Promise<CompareCandidateResult> {
  const startedAt = Date.now();
  try {
    const provider = deps.providerRegistry.getForModel(model.modelId, model.providerId);
    const response = await provider.chat(createPromptRequest(model, prompt, systemPrompt, maxTokens));
    return {
      blindId,
      model,
      status: 'completed',
      content: response.content,
      stopReason: response.stopReason,
      usage: response.usage,
      latencyMs: Date.now() - startedAt,
      toolCallCount: response.toolCalls.length,
    };
  } catch (error) {
    return {
      blindId,
      model,
      status: 'failed',
      content: '',
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatUsage(usage: ChatResponse['usage'] | undefined): string {
  if (!usage) return 'unknown';
  const cache = [
    usage.cacheReadTokens ? `cache read ${usage.cacheReadTokens}` : '',
    usage.cacheWriteTokens ? `cache write ${usage.cacheWriteTokens}` : '',
  ].filter(Boolean).join(', ');
  return `${usage.inputTokens} in / ${usage.outputTokens} out${cache ? `, ${cache}` : ''}`;
}

function candidateContent(content: string): string {
  if (content.length <= DEFAULT_CANDIDATE_OUTPUT_CHARS) return content || '(empty)';
  return `${content.slice(0, DEFAULT_CANDIDATE_OUTPUT_CHARS).trimEnd()}\n\n[Candidate output truncated at ${DEFAULT_CANDIDATE_OUTPUT_CHARS} characters.]`;
}

function formatCandidate(candidate: CompareCandidateResult, reveal: boolean): string {
  const lines = [
    `Candidate ${candidate.blindId}`,
    `  status ${candidate.status}`,
    `  latency ${candidate.latencyMs}ms`,
  ];
  if (reveal) {
    lines.push(`  model ${candidate.model.registryKey} (${candidate.model.displayName})`);
  }
  if (candidate.status === 'failed') {
    lines.push(`  error ${reveal ? candidate.error ?? 'unknown' : 'Provider-specific error hidden until reveal.'}`);
    return lines.join('\n');
  }
  lines.push(`  stop ${candidate.stopReason ?? 'unknown'}`);
  lines.push(`  usage ${formatUsage(candidate.usage)}`);
  if ((candidate.toolCallCount ?? 0) > 0) lines.push(`  tool calls ${candidate.toolCallCount}`);
  lines.push('');
  lines.push(candidateContent(candidate.content));
  return lines.join('\n');
}

function formatReveal(comparison: StoredComparison): string {
  return [
    `Blind model comparison reveal ${comparison.comparisonId}`,
    `created ${comparison.createdAt}`,
    `prompt ${comparison.promptPreview}`,
    ...(comparison.sourceArtifact ? [`source artifact ${comparison.sourceArtifact.artifactId} (${comparison.sourceArtifact.mimeType}, ${comparison.sourceArtifact.sizeBytes} bytes)`] : []),
    ...formatComparisonDimensionLines(comparison),
    ...(comparison.artifact ? [`artifact ${comparison.artifact.artifactId} (${comparison.artifact.mimeType}, ${comparison.artifact.sizeBytes} bytes)`] : []),
    '',
    ...comparison.candidates.map((candidate) => `${candidate.blindId}: ${candidate.model.registryKey} (${candidate.model.displayName})`),
  ].join('\n');
}

function formatSavedComparisonArtifacts(artifactStore?: AgentModelCompareArtifactStore): string {
  if (!artifactStore?.list) {
    return 'Saved blind comparison artifacts are unavailable because the artifact store does not expose listing in this runtime.';
  }
  const artifacts = artifactStore.list(50)
    .filter(isModelCompareArtifact)
    .slice(0, 10);
  if (artifacts.length === 0) {
    return 'No saved blind comparison artifacts found. Run agent_model_compare mode:"run" first.';
  }
  return [
    'Saved blind comparison artifacts',
    ...artifacts.map((artifact) => {
      const comparisonId = readString(artifact.metadata.comparisonId) || 'unknown-comparison';
      const promptPreview = readString(artifact.metadata.promptPreview) || '(prompt unavailable)';
      const completed = typeof artifact.metadata.completedCandidates === 'number' ? artifact.metadata.completedCandidates : '?';
      const count = typeof artifact.metadata.candidateCount === 'number' ? artifact.metadata.candidateCount : '?';
      const dimensions = [
        readComparisonTag(artifact.metadata.benchmarkKind) ? `benchmark ${readComparisonTag(artifact.metadata.benchmarkKind)}` : null,
        readComparisonTag(artifact.metadata.taskType) ? `task ${readComparisonTag(artifact.metadata.taskType)}` : null,
        readComparisonTag(artifact.metadata.documentId) ? `document ${readComparisonTag(artifact.metadata.documentId)}` : null,
      ].filter(Boolean).join('; ');
      return `  ${artifact.id} ${comparisonId} candidates ${completed}/${count}${dimensions ? ` ${dimensions}` : ''} prompt ${promptPreview}`;
    }),
    '',
    'Review one with mode:"review" and artifactId, render related evidence with mode:"sideBySide", or reveal with mode:"reveal" after judging.',
  ].join('\n');
}

function isModelCompareJudgmentArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = readString(artifact.metadata.purpose);
  if (purpose === 'agent-model-compare-judgment') return true;
  if (purpose) return false;
  return readString(artifact.filename).startsWith('blind-model-comparison-judgment-');
}

function isModelCompareHandoffArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = readString(artifact.metadata.purpose);
  if (purpose === 'agent-model-compare-handoff') return true;
  if (purpose) return false;
  return readString(artifact.filename).startsWith('blind-model-comparison-handoff-');
}

function isModelCompareRouteDecisionArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = readString(artifact.metadata.purpose);
  if (purpose === 'agent-model-compare-route-decision') return true;
  if (purpose) return false;
  return readString(artifact.filename).startsWith('blind-model-comparison-route-decision-');
}

function formatSavedHandoffArtifacts(artifactStore?: AgentModelCompareArtifactStore): string {
  if (!artifactStore?.list) {
    return 'Saved blind comparison reviewer handoffs are unavailable because the artifact store does not expose listing in this runtime.';
  }
  const artifacts = artifactStore.list(50)
    .filter(isModelCompareHandoffArtifact)
    .slice(0, 10);
  if (artifacts.length === 0) {
    return 'No saved blind comparison reviewer handoffs found. Create one with mode:"handoff" first.';
  }
  return [
    'Saved blind comparison reviewer handoffs',
    ...artifacts.map((artifact) => {
      const handoffId = readString(artifact.metadata.handoffId) || 'unknown-handoff';
      const comparisonId = readString(artifact.metadata.comparisonId) || 'unknown-comparison';
      const sourceArtifactId = readString(artifact.metadata.sourceArtifactId) || '(missing source)';
      const sourceKind = readString(artifact.metadata.sourceKind) || 'unknown';
      const relatedArtifactIds = readStringList(artifact.metadata.relatedArtifactIds);
      return `  ${artifact.id} ${handoffId} comparison ${comparisonId} source ${sourceArtifactId} (${sourceKind}) related ${relatedArtifactIds.length}`;
    }),
    '',
    'Archive one with mode:"handoffArchive" and artifactId, compare two with mode:"handoffDiff" plus leftArtifactId/rightArtifactId.',
  ].join('\n');
}

function formatArtifactStatus(comparison: StoredComparison): string {
  if (comparison.artifact) {
    const filename = comparison.artifact.filename ? ` ${comparison.artifact.filename}` : '';
    return `artifact ${comparison.artifact.artifactId}${filename} (${comparison.artifact.mimeType}, ${comparison.artifact.sizeBytes} bytes; includes full prompt, blinded outputs, and reveal map)`;
  }
  if (comparison.artifactStatus) return `artifact ${comparison.artifactStatus.message}`;
  return 'artifact not saved';
}

function formatComparisonDimensionLines(comparison: StoredComparison): readonly string[] {
  const lines: string[] = [];
  if (comparison.benchmarkKind) lines.push(`benchmark ${comparison.benchmarkKind}`);
  if (comparison.taskType) lines.push(`task type ${comparison.taskType}`);
  if (comparison.documentId) lines.push(`document ${comparison.documentId}`);
  return lines;
}

function formatIndentedContent(content: string): string {
  return candidateContent(content)
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

function formatReviewCandidate(candidate: CompareCandidateResult, reveal: boolean): string {
  const lines = [
    `Candidate ${candidate.blindId}`,
    `  status ${candidate.status}`,
    `  latency ${candidate.latencyMs}ms`,
  ];
  if (reveal) lines.push(`  model ${candidate.model.registryKey} (${candidate.model.displayName})`);
  if (candidate.status === 'failed') {
    lines.push(`  error ${reveal ? candidate.error ?? 'unknown' : 'Provider-specific error hidden until reveal.'}`);
    return lines.join('\n');
  }
  lines.push(`  stop ${candidate.stopReason ?? 'unknown'}`);
  lines.push(`  usage ${formatUsage(candidate.usage)}`);
  lines.push('  output');
  lines.push(formatIndentedContent(candidate.content));
  return lines.join('\n');
}

function formatReview(comparison: StoredComparison, reveal: boolean): string {
  const lines = [
    `Blind model comparison review ${comparison.comparisonId}`,
    `created ${comparison.createdAt}`,
    `prompt ${comparison.promptPreview}`,
    `rubric ${comparison.rubric || '(none)'}`,
    ...(comparison.sourceArtifact ? [`source artifact ${comparison.sourceArtifact.artifactId} (${comparison.sourceArtifact.mimeType}, ${comparison.sourceArtifact.sizeBytes} bytes)`] : []),
    ...formatComparisonDimensionLines(comparison),
    formatArtifactStatus(comparison),
    '',
    'Review board',
    ...comparison.candidates.flatMap((candidate, index) => [
      formatReviewCandidate(candidate, reveal),
      ...(index < comparison.candidates.length - 1 ? [''] : []),
    ]),
    '',
    'Decision worksheet',
    '  winner: (user chooses after reading the blinded outputs)',
    '  reasons: capture strengths, weaknesses, factuality, tone, and fit to rubric',
    '  route update: separate confirmed model-routing action only',
  ];
  if (reveal) {
    lines.push('');
    lines.push('Reveal');
    lines.push(...comparison.candidates.map((candidate) => `  ${candidate.blindId}: ${candidate.model.registryKey} (${candidate.model.displayName})`));
  } else {
    lines.push('');
    lines.push(`Identities hidden. Reveal after judging with mode:"reveal" and comparisonId:"${comparison.comparisonId}".`);
  }
  lines.push('No selected model was changed.');
  return lines.join('\n');
}

function normalizeBlindId(value: string): string {
  return value
    .replace(/^candidate\s+/i, '')
    .trim()
    .toUpperCase();
}

function findCandidate(comparison: StoredComparison, blindId: string): CompareCandidateResult | null {
  const normalized = normalizeBlindId(blindId);
  return comparison.candidates.find((candidate) => candidate.blindId.toUpperCase() === normalized) ?? null;
}

function modelRouteHandoff(candidate: CompareCandidateResult, reveal: boolean): Record<string, unknown> {
  return {
    ...(reveal ? {
      routeInspection: `agent_harness mode:"model_route" target:"${candidate.model.registryKey}"`,
      confirmedMainRouteUpdate: `agent_harness mode:"set_setting" key:"provider.model" value:"${candidate.model.registryKey}" confirm:true explicitUserRequest:"..."`,
    } : {
      routeInspection: 'reveal the winning model before model-route inspection',
    }),
    policy: 'This judgment does not change the selected model. Route updates require a separate confirmed action.',
  };
}

function judgmentArtifactText(input: {
  readonly judgmentId: string;
  readonly comparison: StoredComparison;
  readonly winner: CompareCandidateResult;
  readonly reasons: string;
  readonly notes: string;
  readonly reveal: boolean;
}): string {
  return `${JSON.stringify({
    schema: 'goodvibes.agent.model_compare_judgment.v1',
    judgmentId: input.judgmentId,
    comparisonId: input.comparison.comparisonId,
    sourceArtifactId: input.comparison.artifact?.artifactId ?? null,
    sourceDocumentId: input.comparison.documentId ?? null,
    documentId: input.comparison.documentId ?? null,
    benchmarkKind: input.comparison.benchmarkKind ?? null,
    taskType: input.comparison.taskType ?? null,
    createdAt: new Date().toISOString(),
    promptPreview: input.comparison.promptPreview,
    rubric: input.comparison.rubric,
    winnerBlindId: input.winner.blindId,
    ...(input.reveal ? {
      winnerModel: {
        registryKey: input.winner.model.registryKey,
        providerId: input.winner.model.providerId,
        modelId: input.winner.model.modelId,
        displayName: input.winner.model.displayName,
      },
    } : {}),
    reasons: input.reasons,
    notes: input.notes,
    revealIncludedInJudgment: input.reveal,
    routeHandoff: modelRouteHandoff(input.winner, input.reveal),
    candidates: input.comparison.candidates.map((candidate) => ({
      blindId: candidate.blindId,
      status: candidate.status,
      ...(input.reveal ? {
        model: {
          registryKey: candidate.model.registryKey,
          providerId: candidate.model.providerId,
          modelId: candidate.model.modelId,
          displayName: candidate.model.displayName,
        },
      } : {}),
    })),
  }, null, 2)}\n`;
}

async function saveComparisonJudgmentArtifact(input: {
  readonly artifactStore?: AgentModelCompareArtifactStore;
  readonly comparison: StoredComparison;
  readonly winner: CompareCandidateResult;
  readonly reasons: string;
  readonly notes: string;
  readonly reveal: boolean;
}): Promise<SavedComparisonArtifact> {
  if (!input.artifactStore) throw new Error('Cannot save judgment because the artifact store is unavailable.');
  const judgmentId = `jdg_${randomUUID()}`;
  const descriptor = await input.artifactStore.create({
    kind: 'data',
    mimeType: 'application/json',
    filename: `blind-model-comparison-judgment-${judgmentId}.json`,
    text: judgmentArtifactText({
      judgmentId,
      comparison: input.comparison,
      winner: input.winner,
      reasons: input.reasons,
      notes: input.notes,
      reveal: input.reveal,
    }),
    metadata: {
      purpose: 'agent-model-compare-judgment',
      judgmentId,
      comparisonId: input.comparison.comparisonId,
      sourceArtifactId: input.comparison.artifact?.artifactId ?? null,
      sourceDocumentId: input.comparison.documentId ?? null,
      documentId: input.comparison.documentId ?? null,
      benchmarkKind: input.comparison.benchmarkKind ?? null,
      taskType: input.comparison.taskType ?? null,
      winnerBlindId: input.winner.blindId,
      promptPreview: input.comparison.promptPreview,
      revealIncludedInJudgment: input.reveal,
      ...(input.reveal ? { winnerModel: input.winner.model.registryKey } : {}),
    },
  });
  return toSavedComparisonArtifact(descriptor);
}

function formatJudgePreview(args: AgentModelCompareToolArgs): string {
  return [
    'Agent blind model comparison judgment preview',
    `  comparison ${readString(args.comparisonId) || readString(args.artifactId) || '(missing)'}`,
    `  winner ${readString(args.winnerBlindId ?? args.winner) || '(missing)'}`,
    `  reasons ${previewText(readString(args.reasons) || '(missing)')}`,
    `  reveal ${readBoolean(args.reveal) ? 'include model identity in judgment' : 'keep judgment blind'}`,
    '  policy saves a local judgment artifact and never changes the selected model',
  ].join('\n');
}

function formatJudgmentResult(input: {
  readonly comparison: StoredComparison;
  readonly winner: CompareCandidateResult;
  readonly artifact: SavedComparisonArtifact;
  readonly reasons: string;
  readonly reveal: boolean;
}): string {
  const routeHandoff = modelRouteHandoff(input.winner, input.reveal);
  const lines = [
    `Blind model comparison judgment saved for ${input.comparison.comparisonId}`,
    `winner Candidate ${input.winner.blindId}`,
    ...(input.reveal ? [`winner model ${input.winner.model.registryKey} (${input.winner.model.displayName})`] : []),
    `artifact ${input.artifact.artifactId}${input.artifact.filename ? ` ${input.artifact.filename}` : ''} (${input.artifact.mimeType}, ${input.artifact.sizeBytes} bytes)`,
    `reasons ${input.reasons || '(none)'}`,
    '',
    'Route handoff',
    `  inspect ${routeHandoff.routeInspection}`,
  ];
  if (input.reveal) {
    lines.push(`  update ${routeHandoff.confirmedMainRouteUpdate}`);
  } else {
    lines.push('  update reveal the winner first, then use a separate confirmed model-routing action');
  }
  lines.push('No selected model was changed.');
  return lines.join('\n');
}

function parseJudgmentArtifactPayload(value: unknown, artifact: SavedComparisonArtifact, metadata: Record<string, unknown> = {}): LoadedComparisonJudgment | null {
  const payload = readRecord(value);
  if (!payload || readString(payload.schema) !== 'goodvibes.agent.model_compare_judgment.v1') return null;
  const winnerModel = readRecord(payload.winnerModel);
  const registryKey = readString(winnerModel?.registryKey);
  const sourceArtifactId = readString(payload.sourceArtifactId) || readString(metadata.sourceArtifactId);
  const benchmarkKind = readComparisonTag(payload.benchmarkKind) || readComparisonTag(metadata.benchmarkKind);
  const taskType = readComparisonTag(payload.taskType) || readComparisonTag(metadata.taskType);
  const documentId = readString(payload.documentId)
    || readString(payload.sourceDocumentId)
    || readString(metadata.documentId)
    || readString(metadata.sourceDocumentId);
  return {
    artifact,
    judgmentId: readString(payload.judgmentId) || `judgment_from_${artifact.artifactId}`,
    comparisonId: readString(payload.comparisonId) || 'unknown-comparison',
    winnerBlindId: readString(payload.winnerBlindId) || '?',
    reasons: readString(payload.reasons),
    notes: readString(payload.notes),
    revealIncludedInJudgment: payload.revealIncludedInJudgment === true,
    ...(sourceArtifactId ? { sourceArtifactId } : {}),
    ...(benchmarkKind ? { benchmarkKind } : {}),
    ...(taskType ? { taskType } : {}),
    ...(documentId ? { documentId } : {}),
    ...(registryKey ? {
      winnerModel: {
        registryKey,
        providerId: readString(winnerModel?.providerId),
        modelId: readString(winnerModel?.modelId),
        displayName: readString(winnerModel?.displayName) || registryKey,
      },
    } : {}),
  };
}

async function loadJudgmentFromArtifact(
  artifactStore: AgentModelCompareArtifactStore | undefined,
  artifactId: string,
): Promise<LoadedComparisonJudgment | null> {
  if (!artifactStore?.readContent) return null;
  const { record, buffer } = await artifactStore.readContent(artifactId);
  let payload: unknown;
  try {
    payload = JSON.parse(buffer.toString('utf-8')) as unknown;
  } catch {
    return null;
  }
  return parseJudgmentArtifactPayload(payload, toSavedComparisonArtifact(record), record.metadata);
}

async function loadSavedJudgments(
  artifactStore: AgentModelCompareArtifactStore | undefined,
  limit: number,
  filters: ComparisonAnalyticsFilters = {},
): Promise<readonly LoadedComparisonJudgment[]> {
  if (!artifactStore?.list || !artifactStore.readContent) return [];
  const listLimit = hasComparisonFilters(filters) ? Math.max(limit * 10, 100) : Math.max(limit * 3, limit);
  const artifacts = artifactStore.list(listLimit)
    .filter(isModelCompareJudgmentArtifact)
    .slice(0, listLimit);
  const loaded = await Promise.all(artifacts.map(async (artifact) => {
    try {
      return await loadJudgmentFromArtifact(artifactStore, artifact.id);
    } catch {
      return null;
    }
  }));
  return loaded
    .filter((judgment): judgment is LoadedComparisonJudgment => judgment !== null)
    .filter((judgment) => judgmentMatchesFilters(judgment, filters))
    .slice(0, limit);
}

async function ensureSelectableWinnerModel(
  catalog: AgentModelCompareModelCatalog,
  registryKey: string,
): Promise<void> {
  const selectableModels = await listSelectableModels(catalog);
  if (!selectableModels.some((model) => model.registryKey === registryKey)) {
    throw new Error(`Winner model ${registryKey} is not currently selectable. Refresh model routing before applying this judgment.`);
  }
}

function formatApplyPreview(judgment: LoadedComparisonJudgment): string {
  return [
    'Agent blind model comparison route update preview',
    `  judgment ${judgment.judgmentId}`,
    `  comparison ${judgment.comparisonId}`,
    `  winner Candidate ${judgment.winnerBlindId}`,
    `  model ${judgment.winnerModel?.registryKey ?? '(not revealed in judgment)'}`,
    `  reasons ${previewText(judgment.reasons || '(none)')}`,
    '  policy changes provider.model only after explicit confirmation',
  ].join('\n');
}

function formatApplyResult(input: {
  readonly judgment: LoadedComparisonJudgment;
  readonly result: AgentModelCompareRouteUpdateResult;
  readonly receipt?: SavedComparisonArtifact | null;
  readonly receiptError?: string | null;
}): string {
  const lines = [
    `Applied blind model comparison winner ${input.judgment.judgmentId}`,
    `comparison ${input.judgment.comparisonId}`,
    `winner Candidate ${input.judgment.winnerBlindId}`,
    `selected model ${input.result.selectedModel}`,
  ];
  if (input.result.previousModel) lines.push(`previous model ${input.result.previousModel}`);
  if (input.receipt) lines.push(`route decision receipt ${input.receipt.artifactId}${input.receipt.filename ? ` ${input.receipt.filename}` : ''}`);
  if (input.receiptError) lines.push(`route decision receipt unavailable: ${input.receiptError}`);
  lines.push('Judgment and comparison artifacts were not changed.');
  return lines.join('\n');
}

type ComparisonRouteDecision = 'applied-winner' | 'left-unchanged';

function parseRouteDecision(value: unknown): ComparisonRouteDecision | null {
  const normalized = readString(value).toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'leftunchanged' || normalized === 'leaveunchanged' || normalized === 'keepcurrent' || normalized === 'nochange' || normalized === 'unchanged') {
    return 'left-unchanged';
  }
  if (normalized === 'appliedwinner' || normalized === 'applywinner' || normalized === 'apply') return 'applied-winner';
  return null;
}

function routeDecisionArtifactText(input: {
  readonly decisionId: string;
  readonly decision: ComparisonRouteDecision;
  readonly judgment: LoadedComparisonJudgment;
  readonly route?: AgentModelCompareRouteUpdateResult | null;
  readonly currentModel?: string | null;
  readonly explicitUserRequest: string;
}): string {
  return `${JSON.stringify({
    schema: 'goodvibes.agent.model_compare.route_decision.v1',
    decisionId: input.decisionId,
    decision: input.decision,
    createdAt: new Date().toISOString(),
    comparisonId: input.judgment.comparisonId,
    judgmentId: input.judgment.judgmentId,
    judgmentArtifactId: input.judgment.artifact.artifactId,
    winnerBlindId: input.judgment.winnerBlindId,
    winnerModel: input.judgment.winnerModel?.registryKey ?? null,
    currentModel: input.currentModel ?? input.route?.selectedModel ?? null,
    previousModel: input.route?.previousModel ?? null,
    selectedModel: input.route?.selectedModel ?? input.currentModel ?? null,
    explicitUserRequest: input.explicitUserRequest,
    policy: {
      mutation: input.decision === 'applied-winner' ? 'provider.model updated through confirmed apply' : 'provider.model intentionally left unchanged',
      transcript: 'Route-decision evidence is saved as an artifact; comparison and judgment artifacts are not modified.',
    },
  }, null, 2)}\n`;
}

async function saveRouteDecisionArtifact(input: {
  readonly artifactStore?: AgentModelCompareArtifactStore;
  readonly decision: ComparisonRouteDecision;
  readonly judgment: LoadedComparisonJudgment;
  readonly route?: AgentModelCompareRouteUpdateResult | null;
  readonly currentModel?: string | null;
  readonly explicitUserRequest: string;
}): Promise<SavedComparisonArtifact> {
  if (!input.artifactStore) throw new Error('Cannot save route decision because the artifact store is unavailable.');
  const decisionId = `rdec_${randomUUID()}`;
  const descriptor = await input.artifactStore.create({
    kind: 'data',
    mimeType: 'application/json',
    filename: `blind-model-comparison-route-decision-${decisionId}.json`,
    text: routeDecisionArtifactText({
      decisionId,
      decision: input.decision,
      judgment: input.judgment,
      route: input.route,
      currentModel: input.currentModel,
      explicitUserRequest: input.explicitUserRequest,
    }),
    metadata: {
      purpose: 'agent-model-compare-route-decision',
      decisionId,
      decision: input.decision,
      comparisonId: input.judgment.comparisonId,
      judgmentId: input.judgment.judgmentId,
      judgmentArtifactId: input.judgment.artifact.artifactId,
      winnerBlindId: input.judgment.winnerBlindId,
      ...(input.judgment.winnerModel?.registryKey ? { winnerModel: input.judgment.winnerModel.registryKey } : {}),
      ...(input.currentModel ? { currentModel: input.currentModel } : {}),
      ...(input.route?.previousModel ? { previousModel: input.route.previousModel } : {}),
      selectedModel: input.route?.selectedModel ?? input.currentModel ?? null,
    },
  });
  return toSavedComparisonArtifact(descriptor);
}

function formatRouteDecisionPreview(input: {
  readonly judgment: LoadedComparisonJudgment;
  readonly decision: ComparisonRouteDecision;
  readonly currentModel?: string | null;
}): string {
  return [
    'Agent blind model comparison route-decision preview',
    `  decision ${input.decision}`,
    `  judgment ${input.judgment.judgmentId}`,
    `  comparison ${input.judgment.comparisonId}`,
    `  winner Candidate ${input.judgment.winnerBlindId}`,
    `  winner model ${input.judgment.winnerModel?.registryKey ?? '(not revealed in judgment)'}`,
    `  current model ${input.currentModel ?? '(unknown)'}`,
    '  policy creates one local route-decision receipt and does not change model routing',
  ].join('\n');
}

function formatRouteDecisionResult(input: {
  readonly judgment: LoadedComparisonJudgment;
  readonly decision: ComparisonRouteDecision;
  readonly receipt: SavedComparisonArtifact;
  readonly currentModel?: string | null;
}): string {
  return [
    `Recorded blind model comparison route decision ${input.decision}`,
    `comparison ${input.judgment.comparisonId}`,
    `judgment ${input.judgment.judgmentId}`,
    `winner Candidate ${input.judgment.winnerBlindId}`,
    `current model ${input.currentModel ?? '(unknown)'}`,
    `route decision receipt ${input.receipt.artifactId}${input.receipt.filename ? ` ${input.receipt.filename}` : ''}`,
    'No selected model was changed.',
  ].join('\n');
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedCounts(map: Map<string, number>): readonly [string, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

interface ComparisonAnalyticsFilters {
  readonly benchmarkKind?: string;
  readonly taskType?: string;
  readonly documentId?: string;
}

function readComparisonAnalyticsFilters(args: AgentModelCompareToolArgs): ComparisonAnalyticsFilters {
  const benchmarkKind = readComparisonTag(args.benchmarkKind);
  const taskType = readComparisonTag(args.taskType);
  const documentId = readComparisonTag(args.documentId);
  return {
    ...(benchmarkKind ? { benchmarkKind } : {}),
    ...(taskType ? { taskType } : {}),
    ...(documentId ? { documentId } : {}),
  };
}

function hasComparisonFilters(filters: ComparisonAnalyticsFilters): boolean {
  return Boolean(filters.benchmarkKind || filters.taskType || filters.documentId);
}

function matchesFilter(actual: string | undefined, expected: string | undefined): boolean {
  if (!expected) return true;
  return (actual ?? '').toLowerCase() === expected.toLowerCase();
}

function judgmentMatchesFilters(judgment: LoadedComparisonJudgment, filters: ComparisonAnalyticsFilters): boolean {
  return matchesFilter(judgment.benchmarkKind, filters.benchmarkKind)
    && matchesFilter(judgment.taskType, filters.taskType)
    && matchesFilter(judgment.documentId, filters.documentId);
}

function formatComparisonFilters(filters: ComparisonAnalyticsFilters): string {
  if (!hasComparisonFilters(filters)) return 'filters none';
  const parts = [
    filters.benchmarkKind ? `benchmarkKind ${filters.benchmarkKind}` : null,
    filters.taskType ? `taskType ${filters.taskType}` : null,
    filters.documentId ? `documentId ${filters.documentId}` : null,
  ].filter((entry): entry is string => Boolean(entry));
  return `filters ${parts.join('; ')}`;
}

function incrementOptionalDimension(map: Map<string, number>, value: string | undefined): void {
  incrementCount(map, value || '(untagged)');
}

function formatComparisonAnalytics(input: {
  readonly judgments: readonly LoadedComparisonJudgment[];
  readonly limit: number;
  readonly includeReasons: boolean;
  readonly filters: ComparisonAnalyticsFilters;
  readonly storeAvailable: boolean;
}): string {
  if (!input.storeAvailable) {
    return 'Saved comparison analytics are unavailable because the artifact store does not expose listing and content reads in this runtime.';
  }
  if (input.judgments.length === 0) {
    return hasComparisonFilters(input.filters)
      ? `No saved comparison judgments matched ${formatComparisonFilters(input.filters)}. Clear a filter or save a matching judgment with agent_model_compare mode:"judge".`
      : 'No saved comparison judgments found. Save a judgment with agent_model_compare mode:"judge" first.';
  }
  const modelWinners = new Map<string, number>();
  const blindWinners = new Map<string, number>();
  const benchmarkCounts = new Map<string, number>();
  const taskCounts = new Map<string, number>();
  const documentCounts = new Map<string, number>();
  let revealed = 0;
  for (const judgment of input.judgments) {
    incrementCount(blindWinners, normalizeBlindId(judgment.winnerBlindId) || judgment.winnerBlindId || '?');
    incrementOptionalDimension(benchmarkCounts, judgment.benchmarkKind);
    incrementOptionalDimension(taskCounts, judgment.taskType);
    incrementOptionalDimension(documentCounts, judgment.documentId);
    if (judgment.winnerModel?.registryKey) {
      revealed += 1;
      incrementCount(modelWinners, `${judgment.winnerModel.registryKey} (${judgment.winnerModel.displayName})`);
    }
  }
  const hidden = input.judgments.length - revealed;
  const lines = [
    'Blind model comparison analytics',
    `judgments ${input.judgments.length}; revealed ${revealed}; hidden ${hidden}; limit ${input.limit}`,
    formatComparisonFilters(input.filters),
    '',
    'Winning models',
  ];
  if (modelWinners.size === 0) {
    lines.push('  No revealed winner models yet. Save a judgment with reveal:true before model-level analytics are available.');
  } else {
    lines.push(...sortedCounts(modelWinners).map(([model, count]) => `  ${model}: ${count}`));
  }
  lines.push('');
  lines.push('Winning blind slots');
  lines.push(...sortedCounts(blindWinners).map(([blindId, count]) => `  Candidate ${blindId}: ${count}`));
  lines.push('');
  lines.push('Trend dimensions');
  lines.push('  benchmark tags');
  lines.push(...sortedCounts(benchmarkCounts).map(([tag, count]) => `    ${tag}: ${count}`));
  lines.push('  task types');
  lines.push(...sortedCounts(taskCounts).map(([task, count]) => `    ${task}: ${count}`));
  lines.push('  documents');
  lines.push(...sortedCounts(documentCounts).map(([document, count]) => `    ${document}: ${count}`));
  lines.push('');
  lines.push('Recent judgments');
  for (const judgment of input.judgments.slice(0, 10)) {
    const model = judgment.winnerModel?.registryKey
      ? ` model ${judgment.winnerModel.registryKey}`
      : ' model hidden';
    lines.push(`  ${judgment.artifact.artifactId} ${judgment.comparisonId} winner Candidate ${judgment.winnerBlindId}${model}`);
    const dimensions = [
      judgment.benchmarkKind ? `benchmark ${judgment.benchmarkKind}` : null,
      judgment.taskType ? `task ${judgment.taskType}` : null,
      judgment.documentId ? `document ${judgment.documentId}` : null,
    ].filter(Boolean).join('; ');
    if (dimensions) lines.push(`    ${dimensions}`);
    if (input.includeReasons && judgment.reasons) {
      lines.push(`    reasons ${previewText(judgment.reasons, 120)}`);
    }
    if (input.includeReasons && judgment.notes) {
      lines.push(`    notes ${previewText(judgment.notes, 120)}`);
    }
  }
  lines.push('No selected model was changed.');
  return lines.join('\n');
}

function countPhrase(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function pushSynthesisTheme(
  map: Map<string, LoadedComparisonJudgment[]>,
  label: string,
  judgment: LoadedComparisonJudgment,
): void {
  const judgments = map.get(label) ?? [];
  judgments.push(judgment);
  map.set(label, judgments);
}

function formatComparisonSynthesis(input: {
  readonly judgments: readonly LoadedComparisonJudgment[];
  readonly limit: number;
  readonly includeReasons: boolean;
  readonly filters: ComparisonAnalyticsFilters;
  readonly storeAvailable: boolean;
}): string {
  if (!input.storeAvailable) {
    return 'Saved comparison synthesis is unavailable because the artifact store does not expose listing and content reads in this runtime.';
  }
  if (input.judgments.length === 0) {
    return hasComparisonFilters(input.filters)
      ? `No saved comparison judgments matched ${formatComparisonFilters(input.filters)}. Clear a filter or save a matching judgment with agent_model_compare mode:"judge".`
      : 'No saved comparison judgments found. Save a judgment with agent_model_compare mode:"judge" first.';
  }

  const modelWinners = new Map<string, number>();
  const comparisonIds = new Set<string>();
  const benchmarkCounts = new Map<string, number>();
  const taskCounts = new Map<string, number>();
  const documentCounts = new Map<string, number>();
  const themes = new Map<string, LoadedComparisonJudgment[]>();
  let revealed = 0;
  for (const judgment of input.judgments) {
    comparisonIds.add(judgment.comparisonId);
    incrementOptionalDimension(benchmarkCounts, judgment.benchmarkKind);
    incrementOptionalDimension(taskCounts, judgment.taskType);
    incrementOptionalDimension(documentCounts, judgment.documentId);
    if (judgment.winnerModel?.registryKey) {
      revealed += 1;
      incrementCount(modelWinners, `${judgment.winnerModel.registryKey} (${judgment.winnerModel.displayName})`);
    }
    const preferenceText = `${judgment.reasons}\n${judgment.notes}`.trim();
    const matched = SYNTHESIS_THEMES.filter((theme) => theme.pattern.test(preferenceText));
    if (matched.length === 0) {
      pushSynthesisTheme(themes, 'Uncategorized preference signal', judgment);
    } else {
      for (const theme of matched) pushSynthesisTheme(themes, theme.label, judgment);
    }
  }

  const hidden = input.judgments.length - revealed;
  const themeCounts = [...themes.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const lines = [
    'Blind model comparison synthesis',
    `judgments ${input.judgments.length}; revealed ${revealed}; hidden ${hidden}; compared comparisons ${comparisonIds.size}; limit ${input.limit}`,
    formatComparisonFilters(input.filters),
    '',
    'Winning model direction',
  ];
  if (modelWinners.size === 0) {
    lines.push('  No revealed winner models yet. Reveal judgment winners before model-level synthesis is available.');
  } else {
    lines.push(...sortedCounts(modelWinners).map(([model, count]) => `  ${model}: ${count}`));
  }
  if (hidden > 0) {
    lines.push(`  Hidden winners: ${countPhrase(hidden, 'judgment')} ${hidden === 1 ? 'needs' : 'need'} reveal before model-level synthesis.`);
  }

  lines.push('');
  lines.push('Cross-session reason themes');
  for (const [label, judgments] of themeCounts) {
    lines.push(`  ${label}: ${countPhrase(judgments.length, 'judgment')}`);
    if (!input.includeReasons) continue;
    const example = judgments.find((judgment) => judgment.reasons || judgment.notes);
    if (!example) continue;
    const source = example.reasons || example.notes;
    lines.push(`    example ${example.artifact.artifactId}: ${previewText(source, 120)}`);
  }

  lines.push('');
  lines.push('Trend dimensions');
  lines.push('  benchmark tags');
  lines.push(...sortedCounts(benchmarkCounts).map(([tag, count]) => `    ${tag}: ${count}`));
  lines.push('  task types');
  lines.push(...sortedCounts(taskCounts).map(([task, count]) => `    ${task}: ${count}`));
  lines.push('  documents');
  lines.push(...sortedCounts(documentCounts).map(([document, count]) => `    ${document}: ${count}`));

  lines.push('');
  lines.push('Recent synthesis inputs');
  for (const judgment of input.judgments.slice(0, 10)) {
    const model = judgment.winnerModel?.registryKey
      ? ` model ${judgment.winnerModel.registryKey}`
      : ' model hidden';
    lines.push(`  ${judgment.artifact.artifactId} ${judgment.comparisonId} winner Candidate ${judgment.winnerBlindId}${model}`);
    const dimensions = [
      judgment.benchmarkKind ? `benchmark ${judgment.benchmarkKind}` : null,
      judgment.taskType ? `task ${judgment.taskType}` : null,
      judgment.documentId ? `document ${judgment.documentId}` : null,
    ].filter(Boolean).join('; ');
    if (dimensions) lines.push(`    ${dimensions}`);
  }

  lines.push('');
  lines.push('Recommended next actions');
  if (hidden > 0) lines.push('  - Reveal hidden judgments before applying model-level route changes.');
  lines.push('  - Export comparison or judgment reports before sharing evidence externally.');
  lines.push('  - Apply a winner only through confirmed mode:"apply".');
  lines.push('No selected model was changed.');
  return lines.join('\n');
}

function markdownBlock(value: string): string {
  const fence = value.includes('```') ? '~~~~' : '```';
  return `${fence}\n${value || '(empty)'}\n${fence}`;
}

function comparisonExportMarkdown(comparison: StoredComparison, reveal: boolean): string {
  const lines = [
    '# Blind Model Comparison',
    '',
    `Comparison: ${comparison.comparisonId}`,
    `Created: ${comparison.createdAt}`,
    `Prompt: ${comparison.promptPreview}`,
    `Rubric: ${comparison.rubric || '(none)'}`,
    ...(comparison.sourceArtifact ? [`Source artifact: ${comparison.sourceArtifact.artifactId} (${comparison.sourceArtifact.mimeType}, ${comparison.sourceArtifact.sizeBytes} bytes)`] : []),
    ...(comparison.benchmarkKind ? [`Benchmark: ${comparison.benchmarkKind}`] : []),
    ...(comparison.taskType ? [`Task type: ${comparison.taskType}`] : []),
    ...(comparison.documentId ? [`Document: ${comparison.documentId}`] : []),
    `Reveal included: ${reveal ? 'yes' : 'no'}`,
    '',
    '## Candidates',
    '',
  ];
  for (const candidate of comparison.candidates) {
    lines.push(`### Candidate ${candidate.blindId}`);
    lines.push('');
    lines.push(`Status: ${candidate.status}`);
    lines.push(`Latency: ${candidate.latencyMs}ms`);
    if (reveal) lines.push(`Model: ${candidate.model.registryKey} (${candidate.model.displayName})`);
    if (candidate.status === 'failed') {
      lines.push(`Error: ${reveal ? candidate.error ?? 'unknown' : 'Provider-specific error hidden until reveal.'}`);
      lines.push('');
      continue;
    }
    lines.push(`Stop: ${candidate.stopReason ?? 'unknown'}`);
    lines.push(`Usage: ${formatUsage(candidate.usage)}`);
    lines.push('');
    lines.push(markdownBlock(candidate.content));
    lines.push('');
  }
  lines.push('## Decision Worksheet');
  lines.push('');
  lines.push('- Winner:');
  lines.push('- Reasons:');
  lines.push('- Risks:');
  lines.push('');
  return lines.join('\n');
}

function judgmentExportMarkdown(judgment: LoadedComparisonJudgment): string {
  const lines = [
    '# Blind Model Comparison Judgment',
    '',
    `Judgment: ${judgment.judgmentId}`,
    `Comparison: ${judgment.comparisonId}`,
    `Winner: Candidate ${judgment.winnerBlindId}`,
    ...(judgment.winnerModel ? [`Winner model: ${judgment.winnerModel.registryKey} (${judgment.winnerModel.displayName})`] : ['Winner model: (not revealed in judgment)']),
    '',
    '## Reasons',
    '',
    judgment.reasons || '(none)',
    '',
  ];
  if (judgment.notes) {
    lines.push('## Notes');
    lines.push('');
    lines.push(judgment.notes);
    lines.push('');
  }
  lines.push('## Route Update');
  lines.push('');
  if (judgment.winnerModel) {
    lines.push(`Confirmed apply route: agent_model_compare mode:"apply" artifactId:"${judgment.artifact.artifactId}" confirm:true explicitUserRequest:"..."`);
  } else {
    lines.push('Save or reveal the judgment before applying a model route update.');
  }
  lines.push('');
  return lines.join('\n');
}

async function saveComparisonExportArtifact(input: {
  readonly artifactStore?: AgentModelCompareArtifactStore;
  readonly sourceArtifactId: string;
  readonly sourceKind: 'comparison' | 'judgment';
  readonly comparisonId: string;
  readonly markdown: string;
  readonly reveal: boolean;
}): Promise<SavedComparisonArtifact> {
  if (!input.artifactStore) throw new Error('Cannot export comparison because the artifact store is unavailable.');
  const exportId = `exp_${randomUUID()}`;
  const descriptor = await input.artifactStore.create({
    kind: 'data',
    mimeType: 'text/markdown',
    filename: `blind-model-comparison-export-${exportId}.md`,
    text: input.markdown,
    metadata: {
      purpose: 'agent-model-compare-export',
      exportId,
      sourceArtifactId: input.sourceArtifactId,
      sourceKind: input.sourceKind,
      comparisonId: input.comparisonId,
      revealIncludedInExport: input.reveal,
    },
  });
  return toSavedComparisonArtifact(descriptor);
}

async function loadHandoffRelatedArtifacts(
  artifactStore: AgentModelCompareArtifactStore | undefined,
  artifactIds: readonly string[],
  maxBytes = MAX_HANDOFF_ARTIFACT_BYTES,
): Promise<readonly { readonly artifact: SavedComparisonArtifact; readonly text?: string; readonly truncatedBytes: number }[]> {
  if (!artifactStore?.readContent) {
    throw new Error('Reviewer handoff requires an artifact store with readContent support.');
  }
  const related: { readonly artifact: SavedComparisonArtifact; readonly text?: string; readonly truncatedBytes: number }[] = [];
  for (const artifactId of artifactIds) {
    const { record, buffer } = await artifactStore.readContent(artifactId);
    const artifact = toSavedComparisonArtifact(record);
    if (!isTextLike(record.mimeType)) {
      related.push({ artifact, truncatedBytes: 0 });
      continue;
    }
    const sliced = buffer.subarray(0, Math.min(buffer.byteLength, maxBytes));
    related.push({
      artifact,
      text: sliced.toString('utf-8').replace(/\0/g, '').trimEnd(),
      truncatedBytes: Math.max(0, buffer.byteLength - sliced.byteLength),
    });
  }
  return related;
}

function comparisonHandoffMarkdown(input: {
  readonly sourceKind: 'comparison' | 'judgment';
  readonly sourceArtifactId: string;
  readonly comparisonId: string;
  readonly comparisonMarkdown: string;
  readonly reveal: boolean;
  readonly relatedArtifacts: readonly { readonly artifact: SavedComparisonArtifact; readonly text?: string; readonly truncatedBytes: number }[];
}): string {
  const lines = [
    '# Blind Model Comparison Reviewer Handoff',
    '',
    `Comparison: ${input.comparisonId}`,
    `Comparison artifact: ${input.sourceArtifactId}`,
    `Comparison artifact kind: ${input.sourceKind}`,
    `Reveal included: ${input.reveal ? 'yes' : 'no'}`,
    `Related artifacts: ${input.relatedArtifacts.length}`,
    '',
    '## Handoff Policy',
    '',
    '- This packet is local reviewer evidence.',
    '- It does not change model routing.',
    '- Route changes require a separate confirmed `agent_model_compare mode:"apply"` call.',
    '',
    '## Related Artifacts',
    '',
  ];
  for (const related of input.relatedArtifacts) {
    lines.push(`### ${related.artifact.artifactId}`);
    lines.push('');
    lines.push(`Filename: ${related.artifact.filename ?? '(none)'}`);
    lines.push(`MIME: ${related.artifact.mimeType}`);
    lines.push(`Size: ${related.artifact.sizeBytes} bytes`);
    lines.push('');
    if (related.text === undefined) {
      lines.push('_Content omitted for non-text artifact; binary/base64 bytes were not included._');
    } else {
      lines.push(markdownBlock(related.text || '(empty text artifact)'));
      if (related.truncatedBytes > 0) {
        lines.push('');
        lines.push(`_Truncated ${related.truncatedBytes} byte(s) from this artifact preview._`);
      }
    }
    lines.push('');
  }
  lines.push('## Comparison Evidence');
  lines.push('');
  lines.push(input.comparisonMarkdown);
  lines.push('');
  return lines.join('\n');
}

function formatRelatedArtifactEvidence(input: {
  readonly artifacts: readonly { readonly artifact: SavedComparisonArtifact; readonly text?: string; readonly truncatedBytes: number }[];
  readonly previewBytes: number;
}): readonly string[] {
  if (input.artifacts.length === 0) return ['  No related artifacts were provided.'];
  const lines: string[] = [];
  for (const related of input.artifacts) {
    lines.push(`  ${related.artifact.artifactId}${related.artifact.filename ? ` ${related.artifact.filename}` : ''} (${related.artifact.mimeType}, ${related.artifact.sizeBytes} bytes)`);
    if (related.text === undefined) {
      lines.push('    non-text artifact; content omitted');
      continue;
    }
    const excerpt = previewText(related.text || '(empty text artifact)', input.previewBytes)
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n');
    lines.push(excerpt);
    if (related.truncatedBytes > 0) lines.push(`    truncated ${related.truncatedBytes} byte(s)`);
  }
  return lines;
}

function formatComparisonEvidencePane(input: {
  readonly comparison?: StoredComparison;
  readonly judgment?: LoadedComparisonJudgment;
  readonly reveal: boolean;
  readonly previewBytes: number;
}): readonly string[] {
  if (input.judgment) {
    const judgment = input.judgment;
    return [
      `  judgment ${judgment.judgmentId}`,
      `  comparison ${judgment.comparisonId}`,
      `  winner Candidate ${judgment.winnerBlindId}`,
      `  winner model ${judgment.winnerModel ? `${judgment.winnerModel.registryKey} (${judgment.winnerModel.displayName})` : '(not revealed)'}`,
      ...(judgment.benchmarkKind ? [`  benchmark ${judgment.benchmarkKind}`] : []),
      ...(judgment.taskType ? [`  task type ${judgment.taskType}`] : []),
      ...(judgment.documentId ? [`  document ${judgment.documentId}`] : []),
      `  reasons ${previewText(judgment.reasons || '(none)', input.previewBytes)}`,
      ...(judgment.notes ? [`  notes ${previewText(judgment.notes, input.previewBytes)}`] : []),
    ];
  }
  const comparison = input.comparison;
  if (!comparison) return ['  No comparison evidence loaded.'];
  const lines = [
    `  comparison ${comparison.comparisonId}`,
    `  prompt ${comparison.promptPreview}`,
    `  rubric ${comparison.rubric || '(none)'}`,
    ...formatComparisonDimensionLines(comparison).map((line) => `  ${line}`),
    `  candidates ${comparison.candidates.length}`,
  ];
  for (const candidate of comparison.candidates) {
    lines.push(`  Candidate ${candidate.blindId}: ${candidate.status}; latency ${candidate.latencyMs}ms`);
    if (input.reveal) lines.push(`    model ${candidate.model.registryKey} (${candidate.model.displayName})`);
    if (candidate.status === 'failed') {
      lines.push(`    error ${input.reveal ? candidate.error ?? 'unknown' : 'Provider-specific error hidden until reveal.'}`);
      continue;
    }
    lines.push(`    output ${previewText(candidate.content || '(empty)', input.previewBytes)}`);
  }
  return lines;
}

function formatSideBySideReview(input: {
  readonly sourceKind: 'comparison' | 'judgment';
  readonly sourceArtifactId: string;
  readonly comparisonId: string;
  readonly comparison?: StoredComparison;
  readonly judgment?: LoadedComparisonJudgment;
  readonly reveal: boolean;
  readonly relatedArtifacts: readonly { readonly artifact: SavedComparisonArtifact; readonly text?: string; readonly truncatedBytes: number }[];
  readonly previewBytes: number;
}): string {
  return [
    'Blind model comparison side-by-side reviewer view',
    `comparison ${input.comparisonId}`,
    `source ${input.sourceArtifactId} (${input.sourceKind})`,
    `related artifacts ${input.relatedArtifacts.length}`,
    `preview bytes ${input.previewBytes}`,
    '',
    'Left pane: related document/artifact evidence',
    ...formatRelatedArtifactEvidence({ artifacts: input.relatedArtifacts, previewBytes: input.previewBytes }),
    '',
    'Right pane: comparison evidence',
    ...formatComparisonEvidencePane({
      comparison: input.comparison,
      judgment: input.judgment,
      reveal: input.reveal,
      previewBytes: input.previewBytes,
    }),
    '',
    'Reviewer next actions',
    `  create handoff agent_model_compare mode:"handoff" artifactId:"${input.sourceArtifactId}" relatedArtifactIds:${JSON.stringify(input.relatedArtifacts.map((entry) => entry.artifact.artifactId))} confirm:true explicitUserRequest:"..."`,
    `  export report agent_model_compare mode:"export" artifactId:"${input.sourceArtifactId}" confirm:true explicitUserRequest:"..."`,
    'No selected model was changed.',
  ].join('\n');
}

async function saveComparisonHandoffArtifact(input: {
  readonly artifactStore?: AgentModelCompareArtifactStore;
  readonly sourceArtifactId: string;
  readonly sourceKind: 'comparison' | 'judgment';
  readonly comparisonId: string;
  readonly relatedArtifactIds: readonly string[];
  readonly markdown: string;
  readonly reveal: boolean;
}): Promise<SavedComparisonArtifact> {
  if (!input.artifactStore) throw new Error('Cannot create reviewer handoff because the artifact store is unavailable.');
  const handoffId = `hnd_${randomUUID()}`;
  const descriptor = await input.artifactStore.create({
    kind: 'data',
    mimeType: 'text/markdown',
    filename: `blind-model-comparison-handoff-${handoffId}.md`,
    text: input.markdown,
    metadata: {
      purpose: 'agent-model-compare-handoff',
      handoffId,
      sourceArtifactId: input.sourceArtifactId,
      sourceKind: input.sourceKind,
      relatedArtifactIds: input.relatedArtifactIds,
      comparisonId: input.comparisonId,
      revealIncludedInHandoff: input.reveal,
    },
  });
  return toSavedComparisonArtifact(descriptor);
}

interface LoadedHandoffArchiveArtifact {
  readonly role: 'handoff' | 'source' | 'related' | 'route-decision';
  readonly record: ArtifactRecord;
  readonly buffer: Buffer;
}

interface ComparisonHandoffArchivePayload {
  readonly artifactCount: number;
  readonly sourceBytes: number;
  readonly includedArtifactIds: readonly string[];
  readonly routeDecisionArtifactIds: readonly string[];
  readonly entries: readonly ArtifactPackageEntry[];
}

function formatArchiveBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '(unknown)';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadHandoffFromArtifact(
  artifactStore: AgentModelCompareArtifactStore | undefined,
  artifactId: string,
): Promise<LoadedComparisonHandoff | null> {
  if (!artifactStore?.readContent) return null;
  const { record } = await artifactStore.readContent(artifactId);
  if (!isModelCompareHandoffArtifact(record)) return null;
  const sourceArtifactId = readString(record.metadata.sourceArtifactId);
  if (!sourceArtifactId) {
    throw new Error(`Reviewer handoff ${record.id} is missing sourceArtifactId metadata. Recreate the handoff with mode:"handoff".`);
  }
  const sourceKind = readString(record.metadata.sourceKind) === 'judgment' ? 'judgment' : 'comparison';
  return {
    artifact: toSavedComparisonArtifact(record),
    handoffId: readString(record.metadata.handoffId) || `handoff_from_${record.id}`,
    sourceArtifactId,
    sourceKind,
    comparisonId: readString(record.metadata.comparisonId) || 'unknown-comparison',
    relatedArtifactIds: readStringList(record.metadata.relatedArtifactIds).filter((relatedId) => relatedId !== record.id && relatedId !== sourceArtifactId),
    revealIncludedInHandoff: record.metadata.revealIncludedInHandoff === true,
  };
}

interface LoadedHandoffDiffArtifact {
  readonly handoff: LoadedComparisonHandoff;
  readonly text: string;
  readonly truncatedBytes: number;
  readonly originalLineCount: number;
}

interface HandoffDiffRow {
  readonly kind: 'same' | 'left' | 'right';
  readonly text: string;
}

async function loadHandoffDiffArtifact(
  artifactStore: AgentModelCompareArtifactStore | undefined,
  artifactId: string,
): Promise<LoadedHandoffDiffArtifact | null> {
  if (!artifactStore?.readContent) return null;
  const { record, buffer } = await artifactStore.readContent(artifactId);
  if (!isModelCompareHandoffArtifact(record)) return null;
  if (!isTextLike(record.mimeType)) {
    throw new Error(`Reviewer handoff ${record.id} is ${record.mimeType}; diff can only compare text-like handoff artifacts.`);
  }
  const handoff = await loadHandoffFromArtifact(artifactStore, artifactId);
  if (!handoff) return null;
  const sliced = buffer.subarray(0, Math.min(buffer.byteLength, MAX_HANDOFF_ARTIFACT_BYTES));
  const text = sliced.toString('utf-8').replace(/\0/g, '').trimEnd();
  return {
    handoff,
    text,
    truncatedBytes: Math.max(0, buffer.byteLength - sliced.byteLength),
    originalLineCount: text.split('\n').length,
  };
}

function normalizedSectionContent(lines: readonly string[]): string {
  return lines.join('\n').replace(/\s+/g, ' ').trim();
}

function handoffSectionMap(text: string): Map<string, string> {
  const lineMap = handoffSectionLineMap(text);
  const normalized = new Map<string, string>();
  for (const [section, lines] of lineMap) {
    normalized.set(section, normalizedSectionContent(lines));
  }
  return normalized;
}

function handoffSectionLineMap(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = '(preamble)';
  let inCodeFence = false;
  sections.set(current, []);
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      sections.get(current)?.push(line);
      inCodeFence = !inCodeFence;
      continue;
    }
    const heading = inCodeFence ? null : /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    const headingText = heading?.[2] ?? '';
    const opensPacketSection = Boolean(heading) && (
      heading![1]!.length === 2
      || (heading![1]!.length === 1 && headingText === 'Blind Model Comparison Reviewer Handoff')
    );
    if (opensPacketSection) {
      current = headingText || '(untitled)';
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    sections.get(current)?.push(line);
  }
  return sections;
}

function normalizeHandoffSectionAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveHandoffSectionName(sectionId: string, lineMap: Map<string, string[]>): string | null {
  const normalized = normalizeHandoffSectionAlias(sectionId);
  if (!normalized || normalized === 'all' || normalized === 'full') return null;
  if (normalized === 'metadata' || normalized === 'metadatadelta') return 'Metadata delta';
  const aliases = new Map<string, string>([
    ['preamble', '(preamble)'],
    ['header', 'Blind Model Comparison Reviewer Handoff'],
    ['summary', 'Blind Model Comparison Reviewer Handoff'],
    ['overview', 'Blind Model Comparison Reviewer Handoff'],
    ['policy', 'Handoff Policy'],
    ['handoffpolicy', 'Handoff Policy'],
    ['related', 'Related Artifacts'],
    ['relatedartifacts', 'Related Artifacts'],
    ['artifacts', 'Related Artifacts'],
    ['comparison', 'Comparison Evidence'],
    ['comparisonevidence', 'Comparison Evidence'],
    ['evidence', 'Comparison Evidence'],
  ]);
  const aliased = aliases.get(normalized);
  if (aliased && lineMap.has(aliased)) return aliased;
  for (const section of lineMap.keys()) {
    if (normalizeHandoffSectionAlias(section) === normalized) return section;
  }
  return '';
}

function formatHandoffMetadataDelta(
  label: string,
  left: string | readonly string[] | boolean,
  right: string | readonly string[] | boolean,
): string {
  const leftValue = Array.isArray(left) ? left.join(', ') || '(none)' : String(left === '' ? '(none)' : left);
  const rightValue = Array.isArray(right) ? right.join(', ') || '(none)' : String(right === '' ? '(none)' : right);
  return leftValue === rightValue
    ? `  ${label}: same (${leftValue})`
    : `  ${label}: changed ${leftValue} -> ${rightValue}`;
}

function buildLineDiff(left: readonly string[], right: readonly string[]): readonly HandoffDiffRow[] {
  const rows = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      rows[leftIndex]![rightIndex] = left[leftIndex] === right[rightIndex]
        ? rows[leftIndex + 1]![rightIndex + 1]! + 1
        : Math.max(rows[leftIndex + 1]![rightIndex]!, rows[leftIndex]![rightIndex + 1]!);
    }
  }

  const diff: HandoffDiffRow[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      diff.push({ kind: 'same', text: left[leftIndex]! });
      leftIndex += 1;
      rightIndex += 1;
    } else if (rows[leftIndex + 1]![rightIndex]! >= rows[leftIndex]![rightIndex + 1]!) {
      diff.push({ kind: 'left', text: left[leftIndex]! });
      leftIndex += 1;
    } else {
      diff.push({ kind: 'right', text: right[rightIndex]! });
      rightIndex += 1;
    }
  }
  while (leftIndex < left.length) {
    diff.push({ kind: 'left', text: left[leftIndex]! });
    leftIndex += 1;
  }
  while (rightIndex < right.length) {
    diff.push({ kind: 'right', text: right[rightIndex]! });
    rightIndex += 1;
  }
  return diff;
}

function formatHandoffDiffRows(rows: readonly HandoffDiffRow[]): readonly string[] {
  const lines: string[] = [];
  let hiddenUnchanged = 0;
  let emittedChanges = 0;
  let omittedChanges = 0;
  for (const row of rows) {
    if (row.kind === 'same') {
      hiddenUnchanged += 1;
      continue;
    }
    if (emittedChanges >= MAX_HANDOFF_DIFF_ROWS) {
      omittedChanges += 1;
      continue;
    }
    if (hiddenUnchanged > 0) {
      lines.push(`  ... ${hiddenUnchanged} unchanged line(s) hidden`);
      hiddenUnchanged = 0;
    }
    const prefix = row.kind === 'left' ? '- ' : '+ ';
    lines.push(`${prefix}${previewText(row.text || '(blank)', 220)}`);
    emittedChanges += 1;
  }
  if (hiddenUnchanged > 0 && lines.length > 0) lines.push(`  ... ${hiddenUnchanged} unchanged line(s) hidden`);
  if (omittedChanges > 0) lines.push(`  ... ${omittedChanges} changed line(s) omitted by diff row cap`);
  return lines.length > 0 ? lines : ['  No textual changes detected in the bounded handoff preview.'];
}

function formatHandoffSectionDiff(
  left: LoadedHandoffDiffArtifact,
  right: LoadedHandoffDiffArtifact,
): readonly string[] {
  const leftSections = handoffSectionMap(left.text);
  const rightSections = handoffSectionMap(right.text);
  const sectionNames = Array.from(new Set([...leftSections.keys(), ...rightSections.keys()]));
  if (sectionNames.length === 0) return ['  No markdown sections detected.'];
  return sectionNames.map((section) => {
    const leftValue = leftSections.get(section);
    const rightValue = rightSections.get(section);
    if (leftValue === undefined) return `  ${section}: added on right (${previewText(rightValue ?? '', MAX_HANDOFF_DIFF_SECTION_PREVIEW_CHARS) || 'empty'})`;
    if (rightValue === undefined) return `  ${section}: removed from right (${previewText(leftValue, MAX_HANDOFF_DIFF_SECTION_PREVIEW_CHARS) || 'empty'})`;
    if (leftValue === rightValue) return `  ${section}: same`;
    return `  ${section}: changed`;
  });
}

function formatHandoffDiff(input: {
  readonly left: LoadedHandoffDiffArtifact;
  readonly right: LoadedHandoffDiffArtifact;
  readonly sectionId?: string;
}): string {
  const leftSectionLines = handoffSectionLineMap(input.left.text);
  const rightSectionLines = handoffSectionLineMap(input.right.text);
  const sectionName = resolveHandoffSectionName(
    input.sectionId ?? '',
    new Map([...leftSectionLines, ...rightSectionLines]),
  );
  const sectionAvailable = sectionName !== '';
  const allSections = ['Metadata delta', ...Array.from(new Set([...leftSectionLines.keys(), ...rightSectionLines.keys()]))]
    .filter((section) => section !== '(preamble)')
    .join(', ');
  const leftRawLines = sectionName
    ? leftSectionLines.get(sectionName) ?? []
    : input.left.text.split('\n');
  const rightRawLines = sectionName
    ? rightSectionLines.get(sectionName) ?? []
    : input.right.text.split('\n');
  const leftLines = leftRawLines.slice(0, MAX_HANDOFF_DIFF_INPUT_LINES);
  const rightLines = rightRawLines.slice(0, MAX_HANDOFF_DIFF_INPUT_LINES);
  const diffRows = buildLineDiff(leftLines, rightLines);
  return [
    'Blind model comparison reviewer handoff visual diff',
    `left ${input.left.handoff.artifact.artifactId} (${input.left.handoff.handoffId})`,
    `right ${input.right.handoff.artifact.artifactId} (${input.right.handoff.handoffId})`,
    `section jump ${sectionName ? sectionName : input.sectionId && !sectionAvailable ? `unmatched ${input.sectionId}` : 'all'}`,
    `available sections ${allSections || '(none)'}`,
    `line window ${leftLines.length}/${input.left.originalLineCount} left, ${rightLines.length}/${input.right.originalLineCount} right`,
    ...(input.left.truncatedBytes > 0 || input.right.truncatedBytes > 0
      ? [`truncated bytes left ${input.left.truncatedBytes}, right ${input.right.truncatedBytes}`]
      : []),
    '',
    'Metadata delta',
    formatHandoffMetadataDelta('comparison', input.left.handoff.comparisonId, input.right.handoff.comparisonId),
    formatHandoffMetadataDelta('source', `${input.left.handoff.sourceArtifactId} (${input.left.handoff.sourceKind})`, `${input.right.handoff.sourceArtifactId} (${input.right.handoff.sourceKind})`),
    formatHandoffMetadataDelta('related artifacts', input.left.handoff.relatedArtifactIds, input.right.handoff.relatedArtifactIds),
    formatHandoffMetadataDelta('reveal included', input.left.handoff.revealIncludedInHandoff, input.right.handoff.revealIncludedInHandoff),
    '',
    'Section delta',
    ...formatHandoffSectionDiff(input.left, input.right),
    '',
    'Aligned line diff',
    ...(sectionAvailable ? formatHandoffDiffRows(diffRows) : [`  Section ${input.sectionId || '(blank)'} was not found. Use all, policy, related, or comparison.`]),
    '',
    'No selected model was changed.',
  ].join('\n');
}

async function loadHandoffArchiveArtifacts(
  artifactStore: AgentModelCompareArtifactStore | undefined,
  handoff: LoadedComparisonHandoff,
  routeDecisionArtifactIds: readonly string[] = [],
): Promise<readonly LoadedHandoffArchiveArtifact[]> {
  if (!artifactStore?.readContent) {
    throw new Error('Reviewer handoff archive requires an artifact store with readContent support.');
  }
  const requested: Array<{ readonly id: string; readonly role: LoadedHandoffArchiveArtifact['role'] }> = [
    { id: handoff.artifact.artifactId, role: 'handoff' },
    { id: handoff.sourceArtifactId, role: 'source' },
    ...handoff.relatedArtifactIds.map((id) => ({ id, role: 'related' as const })),
    ...routeDecisionArtifactIds.map((id) => ({ id, role: 'route-decision' as const })),
  ];
  const seen = new Set<string>();
  const artifacts: LoadedHandoffArchiveArtifact[] = [];
  for (const request of requested) {
    if (!request.id || seen.has(request.id)) continue;
    seen.add(request.id);
    if (artifacts.length >= MAX_HANDOFF_ARCHIVE_ARTIFACTS) {
      throw new Error(`Reviewer handoff archive supports at most ${MAX_HANDOFF_ARCHIVE_ARTIFACTS} artifacts.`);
    }
    const loaded = await artifactStore.readContent(request.id);
    artifacts.push({ role: request.role, ...loaded });
  }
  return artifacts;
}

function findRouteDecisionArtifactIdsForHandoff(
  artifactStore: AgentModelCompareArtifactStore | undefined,
  handoff: LoadedComparisonHandoff,
): readonly string[] {
  if (!artifactStore?.list) return [];
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const artifact of artifactStore.list(100).filter(isModelCompareRouteDecisionArtifact)) {
    const judgmentArtifactId = readString(artifact.metadata.judgmentArtifactId);
    const comparisonId = readString(artifact.metadata.comparisonId);
    const matchesSource = handoff.sourceKind === 'judgment'
      ? judgmentArtifactId === handoff.sourceArtifactId
      : comparisonId === handoff.comparisonId;
    if (!matchesSource || seen.has(artifact.id)) continue;
    seen.add(artifact.id);
    matches.push(artifact.id);
  }
  return matches;
}

function buildComparisonHandoffArchivePayload(input: {
  readonly handoff: LoadedComparisonHandoff;
  readonly artifacts: readonly LoadedHandoffArchiveArtifact[];
}): ComparisonHandoffArchivePayload {
  const usedFilenames = new Set<string>();
  const entries: ArtifactPackageEntry[] = [];
  const manifestArtifacts: Array<Record<string, unknown>> = [];
  const fileLines: string[] = [];
  let sourceBytes = 0;
  const routeDecisionArtifactIds = input.artifacts
    .filter((artifact) => artifact.role === 'route-decision')
    .map((artifact) => artifact.record.id);

  for (let index = 0; index < input.artifacts.length; index += 1) {
    const artifact = input.artifacts[index]!;
    const filename = packageArtifactFilename(artifact.record, index, usedFilenames);
    const relativePath = `artifacts/${artifact.role}/${filename}`;
    entries.push({ path: relativePath, buffer: artifact.buffer });
    sourceBytes += artifact.buffer.byteLength;
    fileLines.push(`- ${artifact.role}: ${artifact.record.id} -> ${relativePath} (${formatArchiveBytes(artifact.buffer.byteLength)}, ${artifact.record.mimeType})`);
    manifestArtifacts.push({
      role: artifact.role,
      id: artifact.record.id,
      file: relativePath,
      originalFilename: artifact.record.filename ?? null,
      kind: artifact.record.kind,
      mimeType: artifact.record.mimeType,
      sizeBytes: artifact.record.sizeBytes,
      copiedBytes: artifact.buffer.byteLength,
      sha256: artifact.record.sha256,
      createdAt: new Date(artifact.record.createdAt).toISOString(),
      expiresAt: artifact.record.expiresAt ? new Date(artifact.record.expiresAt).toISOString() : null,
      acquisitionMode: artifact.record.acquisitionMode,
      fetchMode: artifact.record.fetchMode,
      sourceUri: sanitizeArtifactSourceUri(artifact.record.sourceUri) ?? null,
      metadata: sanitizeArtifactMetadata(artifact.record.metadata),
    });
  }

  const createdAt = new Date().toISOString();
  const manifest = {
    version: 1,
    product: 'goodvibes-agent',
    archiveKind: 'agent-model-compare-handoff',
    createdAt,
    comparisonId: input.handoff.comparisonId,
    handoff: {
      handoffId: input.handoff.handoffId,
      handoffArtifactId: input.handoff.artifact.artifactId,
      sourceArtifactId: input.handoff.sourceArtifactId,
      sourceKind: input.handoff.sourceKind,
      relatedArtifactIds: input.handoff.relatedArtifactIds,
      routeDecisionArtifactIds,
      revealIncludedInHandoff: input.handoff.revealIncludedInHandoff,
    },
    artifactCount: input.artifacts.length,
    sourceBytes,
    policy: {
      content: 'Exact saved artifact bytes copied into artifacts/.',
      transcript: 'Artifact contents are not printed by the compare tool.',
      metadata: 'Secret-like metadata keys and URL query parameters are redacted in this manifest.',
      routeMutation: 'No selected model route is changed by this archive.',
      retention: 'Original saved artifacts are retained in the Agent artifact store.',
    },
    artifacts: manifestArtifacts,
  };

  entries.push({
    path: 'manifest.json',
    buffer: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf-8'),
  });
  entries.push({
    path: 'README.md',
    buffer: Buffer.from(
      [
        '# GoodVibes Agent Comparison Handoff Archive',
        '',
        `Generated: ${createdAt}`,
        `Comparison: ${input.handoff.comparisonId}`,
        `Handoff artifact: ${input.handoff.artifact.artifactId}`,
        `Source artifact: ${input.handoff.sourceArtifactId} (${input.handoff.sourceKind})`,
        `Related artifacts: ${input.handoff.relatedArtifactIds.length}`,
        `Route-decision receipts: ${routeDecisionArtifactIds.length}`,
        `Source bytes: ${sourceBytes}`,
        '',
        'Files',
        ...fileLines,
        '',
        'Manifest',
        '- `manifest.json` contains redacted artifact metadata, archive policy, and file paths.',
        '- Artifact bytes live under `artifacts/` and are copied exactly from the saved Agent artifact store.',
        '- Original artifacts remain saved in Agent. This archive does not change the selected model.',
        '',
      ].join('\n'),
      'utf-8',
    ),
  });

  return {
    artifactCount: input.artifacts.length,
    sourceBytes,
    includedArtifactIds: input.artifacts.map((artifact) => artifact.record.id),
    routeDecisionArtifactIds,
    entries,
  };
}

async function saveComparisonHandoffArchiveArtifact(input: {
  readonly artifactStore?: AgentModelCompareArtifactStore;
  readonly handoff: LoadedComparisonHandoff;
  readonly payload: ComparisonHandoffArchivePayload;
  readonly archive: Buffer;
}): Promise<SavedComparisonArtifact> {
  if (!input.artifactStore) throw new Error('Cannot create reviewer handoff archive because the artifact store is unavailable.');
  const archiveId = `hndarc_${randomUUID()}`;
  const descriptor = await input.artifactStore.create({
    kind: 'archive',
    mimeType: 'application/zip',
    filename: `blind-model-comparison-handoff-archive-${archiveId}.zip`,
    dataBase64: input.archive.toString('base64'),
    metadata: {
      purpose: 'agent-model-compare-handoff-archive',
      archiveId,
      handoffArtifactId: input.handoff.artifact.artifactId,
      handoffId: input.handoff.handoffId,
      sourceArtifactId: input.handoff.sourceArtifactId,
      sourceKind: input.handoff.sourceKind,
      relatedArtifactIds: input.handoff.relatedArtifactIds,
      routeDecisionArtifactIds: input.payload.routeDecisionArtifactIds,
      includedArtifactIds: input.payload.includedArtifactIds,
      comparisonId: input.handoff.comparisonId,
      artifactCount: input.payload.artifactCount,
      sourceBytes: input.payload.sourceBytes,
      archiveBytes: input.archive.byteLength,
      revealIncludedInHandoff: input.handoff.revealIncludedInHandoff,
    },
  });
  return toSavedComparisonArtifact(descriptor);
}

function formatExportPreview(input: {
  readonly sourceKind: 'comparison' | 'judgment';
  readonly sourceArtifactId: string;
  readonly comparisonId: string;
  readonly reveal: boolean;
}): string {
  return [
    'Agent blind model comparison export preview',
    `  source ${input.sourceArtifactId} (${input.sourceKind})`,
    `  comparison ${input.comparisonId}`,
    `  format markdown`,
    `  reveal ${input.reveal ? 'include model identities when available' : 'keep model identities hidden'}`,
    '  policy creates one local markdown artifact and does not change model routing',
  ].join('\n');
}

function formatHandoffPreview(input: {
  readonly sourceKind: 'comparison' | 'judgment';
  readonly sourceArtifactId: string;
  readonly comparisonId: string;
  readonly reveal: boolean;
  readonly relatedArtifactIds: readonly string[];
}): string {
  return [
    'Agent blind model comparison reviewer handoff preview',
    `  source ${input.sourceArtifactId} (${input.sourceKind})`,
    `  comparison ${input.comparisonId}`,
    `  related artifacts ${input.relatedArtifactIds.join(', ') || '(missing)'}`,
    `  reveal ${input.reveal ? 'include model identities when available' : 'keep model identities hidden'}`,
    '  policy creates one local markdown handoff artifact and does not change model routing',
  ].join('\n');
}

function formatHandoffArchivePreview(input: {
  readonly handoff: LoadedComparisonHandoff;
  readonly routeDecisionArtifactIds: readonly string[];
}): string {
  return [
    'Agent blind model comparison reviewer handoff archive preview',
    `  handoff ${input.handoff.artifact.artifactId} (${input.handoff.handoffId})`,
    `  comparison ${input.handoff.comparisonId}`,
    `  source ${input.handoff.sourceArtifactId} (${input.handoff.sourceKind})`,
    `  related artifacts ${input.handoff.relatedArtifactIds.join(', ') || '(none)'}`,
    `  route-decision receipts ${input.routeDecisionArtifactIds.join(', ') || '(none)'}`,
    `  reveal ${input.handoff.revealIncludedInHandoff ? 'handoff includes model identities when available' : 'handoff keeps model identities hidden'}`,
    '  policy creates one local ZIP artifact with exact handoff/source/evidence bytes, redacted manifest metadata, and no model route change',
  ].join('\n');
}

function formatExportResult(input: {
  readonly sourceKind: 'comparison' | 'judgment';
  readonly sourceArtifactId: string;
  readonly comparisonId: string;
  readonly artifact: SavedComparisonArtifact;
}): string {
  return [
    `Blind model comparison export saved for ${input.comparisonId}`,
    `source ${input.sourceArtifactId} (${input.sourceKind})`,
    `artifact ${input.artifact.artifactId}${input.artifact.filename ? ` ${input.artifact.filename}` : ''} (${input.artifact.mimeType}, ${input.artifact.sizeBytes} bytes)`,
    'No selected model was changed.',
  ].join('\n');
}

function formatHandoffResult(input: {
  readonly sourceKind: 'comparison' | 'judgment';
  readonly sourceArtifactId: string;
  readonly comparisonId: string;
  readonly relatedArtifactCount: number;
  readonly artifact: SavedComparisonArtifact;
}): string {
  return [
    `Blind model comparison reviewer handoff saved for ${input.comparisonId}`,
    `source ${input.sourceArtifactId} (${input.sourceKind})`,
    `related artifacts ${input.relatedArtifactCount}`,
    `artifact ${input.artifact.artifactId}${input.artifact.filename ? ` ${input.artifact.filename}` : ''} (${input.artifact.mimeType}, ${input.artifact.sizeBytes} bytes)`,
    `archive agent_model_compare mode:"handoffArchive" artifactId:"${input.artifact.artifactId}" confirm:true explicitUserRequest:"..."`,
    'No selected model was changed.',
  ].join('\n');
}

function formatHandoffArchiveResult(input: {
  readonly handoff: LoadedComparisonHandoff;
  readonly artifact: SavedComparisonArtifact;
  readonly artifactCount: number;
  readonly routeDecisionArtifactCount: number;
  readonly sourceBytes: number;
  readonly archiveBytes: number;
}): string {
  const exportPath = `exports/${input.artifact.filename ?? `${input.artifact.artifactId}.zip`}`;
  return [
    `Blind model comparison reviewer handoff archive saved for ${input.handoff.comparisonId}`,
    `handoff ${input.handoff.artifact.artifactId} (${input.handoff.handoffId})`,
    `source ${input.handoff.sourceArtifactId} (${input.handoff.sourceKind})`,
    `related artifacts ${input.handoff.relatedArtifactIds.length}`,
    `route-decision receipts ${input.routeDecisionArtifactCount}`,
    `included artifacts ${input.artifactCount}`,
    `source bytes ${formatArchiveBytes(input.sourceBytes)}`,
    `archive ${input.artifact.artifactId}${input.artifact.filename ? ` ${input.artifact.filename}` : ''} (${input.artifact.mimeType}, ${input.archiveBytes} bytes)`,
    `export agent_artifacts mode:"export" artifactId:"${input.artifact.artifactId}" destinationPath:"${exportPath}" confirm:true explicitUserRequest:"..."`,
    'policy exact saved artifact bytes packaged; manifest metadata redacted; original artifacts retained',
    'No selected model was changed.',
  ].join('\n');
}

function formatRunResult(comparison: StoredComparison, reveal: boolean): string {
  const completed = comparison.candidates.filter((candidate) => candidate.status === 'completed').length;
  const lines = [
    `Blind model comparison ${comparison.comparisonId}`,
    `created ${comparison.createdAt}`,
    `prompt ${comparison.promptPreview}`,
    `rubric ${comparison.rubric || '(none)'}`,
    ...(comparison.sourceArtifact ? [`source artifact ${comparison.sourceArtifact.artifactId} (${comparison.sourceArtifact.mimeType}, ${comparison.sourceArtifact.sizeBytes} bytes)`] : []),
    ...formatComparisonDimensionLines(comparison),
    `candidates ${comparison.candidates.length}; completed ${completed}; reveal ${reveal ? 'included' : 'hidden'}`,
    formatArtifactStatus(comparison),
    '',
    ...comparison.candidates.flatMap((candidate, index) => [
      formatCandidate(candidate, reveal),
      ...(index < comparison.candidates.length - 1 ? [''] : []),
    ]),
    '',
  ];
  if (reveal) {
    lines.push('Reveal');
    lines.push(...comparison.candidates.map((candidate) => `  ${candidate.blindId}: ${candidate.model.registryKey} (${candidate.model.displayName})`));
  } else {
    lines.push(`Identities hidden. Judge the outputs first, then call agent_model_compare with mode:"reveal" and comparisonId:"${comparison.comparisonId}".`);
  }
  lines.push('No selected model was changed.');
  return lines.join('\n');
}

function formatPreview(
  args: AgentModelCompareToolArgs,
  refs: readonly string[],
  candidateCount: number,
): string {
  const benchmarkKind = readBenchmarkKind(args.benchmarkKind);
  const taskType = readComparisonTag(args.taskType);
  const documentId = readComparisonTag(args.documentId);
  return [
    'Agent blind model comparison preview',
    `  prompt ${previewText(readString(args.prompt) || '(missing)')}`,
    ...(readString(args.artifactId) ? [`  source artifact ${readString(args.artifactId)}`] : []),
    `  candidates ${refs.length > 0 ? refs.length : candidateCount}`,
    `  selection ${refs.length > 0 ? 'user supplied model refs' : 'auto-select from selectable models'}`,
    `  rubric ${previewText(readString(args.rubric) || '(none)')}`,
    ...(benchmarkKind ? [`  benchmark ${benchmarkKind}`] : []),
    ...(taskType ? [`  task type ${taskType}`] : []),
    ...(documentId ? [`  document ${documentId}`] : []),
    `  reveal ${readBoolean(args.reveal) ? 'immediate' : 'delayed'}`,
    `  artifact ${readOptionalBoolean(args.saveArtifact, true) ? 'save local JSON review' : 'do not save'}`,
    '  policy model comparison sends the same prompt to each candidate and requires confirm:true plus explicitUserRequest',
  ].join('\n');
}

function parseMode(value: unknown): 'run' | 'reveal' | 'review' | 'sideBySide' | 'judge' | 'apply' | 'routeDecision' | 'export' | 'handoff' | 'handoffArchive' | 'handoffDiff' | 'analytics' | 'synthesis' {
  const mode = readString(value) || MODE_RUN;
  if (
    mode === MODE_RUN
    || mode === MODE_REVEAL
    || mode === MODE_REVIEW
    || mode === MODE_SIDE_BY_SIDE
    || mode === MODE_JUDGE
    || mode === MODE_APPLY
    || mode === MODE_ROUTE_DECISION
    || mode === MODE_EXPORT
    || mode === MODE_HANDOFF
    || mode === MODE_HANDOFF_ARCHIVE
    || mode === MODE_HANDOFF_DIFF
    || mode === MODE_ANALYTICS
    || mode === MODE_SYNTHESIS
  ) return mode;
  throw new Error('mode must be run, reveal, review, sideBySide, judge, apply, routeDecision, export, handoff, handoffArchive, handoffDiff, analytics, or synthesis.');
}

function rememberComparison(store: Map<string, StoredComparison>, comparison: StoredComparison): void {
  store.set(comparison.comparisonId, comparison);
  while (store.size > COMPARISON_STORE_LIMIT) {
    const oldest = store.keys().next().value as string | undefined;
    if (!oldest) break;
    store.delete(oldest);
  }
}

function toArtifactCandidate(candidate: CompareCandidateResult): Record<string, unknown> {
  return {
    blindId: candidate.blindId,
    status: candidate.status,
    content: candidate.content,
    latencyMs: candidate.latencyMs,
    ...(candidate.stopReason ? { stopReason: candidate.stopReason } : {}),
    ...(candidate.usage ? { usage: candidate.usage } : {}),
    ...(typeof candidate.toolCallCount === 'number' ? { toolCallCount: candidate.toolCallCount } : {}),
    ...(candidate.error ? { error: candidate.error } : {}),
    model: {
      registryKey: candidate.model.registryKey,
      providerId: candidate.model.providerId,
      modelId: candidate.model.modelId,
      displayName: candidate.model.displayName,
      current: candidate.model.current,
    },
  };
}

function comparisonArtifactText(input: {
  readonly comparison: StoredComparison;
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly maxTokens: number;
  readonly revealIncludedInTranscript: boolean;
  readonly benchmarkKind?: string;
}): string {
  return `${JSON.stringify({
    schema: 'goodvibes.agent.model_compare.v1',
    comparisonId: input.comparison.comparisonId,
    createdAt: input.comparison.createdAt,
    prompt: input.prompt,
    promptPreview: input.comparison.promptPreview,
    ...(input.comparison.sourceArtifact ? { sourceArtifact: input.comparison.sourceArtifact } : {}),
    ...(input.comparison.documentId ? { documentId: input.comparison.documentId } : {}),
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    maxTokens: input.maxTokens,
    rubric: input.comparison.rubric,
    ...(input.benchmarkKind ? { benchmarkKind: input.benchmarkKind } : {}),
    ...(input.comparison.taskType ? { taskType: input.comparison.taskType } : {}),
    revealIncludedInTranscript: input.revealIncludedInTranscript,
    reviewFlow: {
      blindFirst: true,
      revealInstruction: `Call agent_model_compare with mode:"reveal" and comparisonId:"${input.comparison.comparisonId}".`,
      routeMutation: 'none',
    },
    candidates: input.comparison.candidates.map(toArtifactCandidate),
  }, null, 2)}\n`;
}

function toSavedComparisonArtifact(descriptor: ArtifactDescriptor): SavedComparisonArtifact {
  const documentId = readString(descriptor.metadata.documentId);
  return {
    artifactId: descriptor.id,
    ...(descriptor.filename ? { filename: descriptor.filename } : {}),
    mimeType: descriptor.mimeType,
    sizeBytes: descriptor.sizeBytes,
    ...(documentId ? { documentId } : {}),
  };
}

async function loadRunSourceArtifact(
  artifactStore: AgentModelCompareArtifactStore | undefined,
  artifactId: string,
): Promise<{ readonly artifact: SavedComparisonArtifact; readonly promptBlock: string }> {
  if (!artifactStore?.readContent) {
    throw new Error('Saved artifact comparison requires an artifact store with readContent support.');
  }
  const { record, buffer } = await artifactStore.readContent(artifactId);
  if (!isTextLike(record.mimeType)) {
    throw new Error(`Saved artifact ${record.id} is ${record.mimeType}; blind comparison can only inline text-like artifacts.`);
  }
  const sliced = buffer.subarray(0, Math.min(buffer.byteLength, MAX_SOURCE_ARTIFACT_BYTES));
  const text = sliced.toString('utf-8').replace(/\0/g, '').trim();
  const lines = [
    'Saved artifact context',
    `Artifact ID: ${record.id}`,
    `Filename: ${record.filename ?? '(none)'}`,
    `MIME: ${record.mimeType}`,
    '',
    text || '(empty text artifact)',
  ];
  if (buffer.byteLength > sliced.byteLength) {
    lines.push('', `[Artifact content truncated at ${MAX_SOURCE_ARTIFACT_BYTES} bytes.]`);
  }
  return {
    artifact: toSavedComparisonArtifact(record),
    promptBlock: lines.join('\n'),
  };
}

async function buildRunPromptFromArtifact(input: {
  readonly artifactStore?: AgentModelCompareArtifactStore;
  readonly prompt: string;
  readonly artifactId: string;
}): Promise<{ readonly prompt: string; readonly sourceArtifact?: SavedComparisonArtifact }> {
  if (!input.artifactId) return { prompt: input.prompt };
  const loaded = await loadRunSourceArtifact(input.artifactStore, input.artifactId);
  const instruction = input.prompt || 'Compare model responses using the saved artifact context below.';
  return {
    prompt: [instruction, '', loaded.promptBlock].join('\n'),
    sourceArtifact: loaded.artifact,
  };
}

async function saveComparisonArtifact(input: {
  readonly artifactStore?: AgentModelCompareArtifactStore;
  readonly comparison: StoredComparison;
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly maxTokens: number;
  readonly revealIncludedInTranscript: boolean;
  readonly enabled: boolean;
  readonly benchmarkKind?: string;
}): Promise<{
  readonly artifact?: SavedComparisonArtifact;
  readonly status: ComparisonArtifactStatus;
}> {
  if (!input.enabled) {
    return { status: { state: 'disabled', message: 'not saved (saveArtifact false)' } };
  }
  if (!input.artifactStore) {
    return { status: { state: 'unavailable', message: 'not saved (artifact store unavailable)' } };
  }
  try {
    const descriptor = await input.artifactStore.create({
      kind: 'data',
      mimeType: 'application/json',
      filename: `blind-model-comparison-${input.comparison.comparisonId}.json`,
      text: comparisonArtifactText(input),
      metadata: {
        purpose: 'agent-model-compare',
        comparisonId: input.comparison.comparisonId,
        promptPreview: input.comparison.promptPreview,
        ...(input.comparison.sourceArtifact ? { sourceArtifactId: input.comparison.sourceArtifact.artifactId } : {}),
        ...(input.comparison.documentId ? { documentId: input.comparison.documentId } : {}),
        candidateCount: input.comparison.candidates.length,
        completedCandidates: input.comparison.candidates.filter((candidate) => candidate.status === 'completed').length,
        ...(input.benchmarkKind ? { benchmarkKind: input.benchmarkKind } : {}),
        ...(input.comparison.taskType ? { taskType: input.comparison.taskType } : {}),
        revealStored: true,
        revealIncludedInTranscript: input.revealIncludedInTranscript,
      },
    });
    return {
      artifact: toSavedComparisonArtifact(descriptor),
      status: { state: 'saved', message: `saved as ${descriptor.id}` },
    };
  } catch (error) {
    return {
      status: {
        state: 'failed',
        message: `not saved (${error instanceof Error ? error.message : String(error)})`,
      },
    };
  }
}

function isModelCompareArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = readString(artifact.metadata.purpose);
  if (purpose === 'agent-model-compare') return true;
  if (purpose) return false;
  return readString(artifact.filename).startsWith('blind-model-comparison-cmp_');
}

function parseArtifactUsage(value: unknown): ChatResponse['usage'] | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const inputTokens = readNumber(record.inputTokens, Number.NaN);
  const outputTokens = readNumber(record.outputTokens, Number.NaN);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return undefined;
  return {
    inputTokens,
    outputTokens,
    ...(typeof record.cacheReadTokens === 'number' ? { cacheReadTokens: record.cacheReadTokens } : {}),
    ...(typeof record.cacheWriteTokens === 'number' ? { cacheWriteTokens: record.cacheWriteTokens } : {}),
  };
}

function parseArtifactCandidate(value: unknown, index: number): CompareCandidateResult | null {
  const candidate = readRecord(value);
  if (!candidate) return null;
  const model = readRecord(candidate.model) ?? {};
  const blindId = readString(candidate.blindId) || BLIND_LABELS[index] || String(index + 1);
  const status = readString(candidate.status) === 'failed' ? 'failed' : 'completed';
  return {
    blindId,
    status,
    content: readString(candidate.content),
    latencyMs: Math.max(0, readNumber(candidate.latencyMs, 0)),
    ...(readString(candidate.stopReason) ? { stopReason: readString(candidate.stopReason) } : {}),
    ...(parseArtifactUsage(candidate.usage) ? { usage: parseArtifactUsage(candidate.usage) } : {}),
    ...(typeof candidate.toolCallCount === 'number' ? { toolCallCount: Math.max(0, Math.trunc(candidate.toolCallCount)) } : {}),
    ...(readString(candidate.error) ? { error: readString(candidate.error) } : {}),
    model: {
      registryKey: readString(model.registryKey) || `artifact:${blindId}`,
      providerId: readString(model.providerId) || 'artifact',
      modelId: readString(model.modelId) || blindId,
      displayName: readString(model.displayName) || readString(model.modelId) || blindId,
      current: model.current === true,
    },
  };
}

function parseComparisonArtifactPayload(
  value: unknown,
  artifact: SavedComparisonArtifact,
): StoredComparison | null {
  const payload = readRecord(value);
  if (!payload || readString(payload.schema) !== 'goodvibes.agent.model_compare.v1') return null;
  const rawCandidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const candidates = rawCandidates
    .map(parseArtifactCandidate)
    .filter((candidate): candidate is CompareCandidateResult => candidate !== null);
  if (candidates.length === 0) return null;
  const prompt = readString(payload.prompt);
  const sourceArtifact = readRecord(payload.sourceArtifact);
  const sourceArtifactId = readString(sourceArtifact?.artifactId);
  const sourceDocumentId = readString(sourceArtifact?.documentId);
  const documentId = readString(payload.documentId) || sourceDocumentId;
  const benchmarkKind = readComparisonTag(payload.benchmarkKind);
  const taskType = readComparisonTag(payload.taskType);
  return {
    comparisonId: readString(payload.comparisonId) || `cmp_from_${artifact.artifactId}`,
    createdAt: readString(payload.createdAt) || new Date().toISOString(),
    promptPreview: readString(payload.promptPreview) || previewText(prompt || '(prompt unavailable)', 160),
    rubric: readString(payload.rubric),
    ...(sourceArtifactId ? {
      sourceArtifact: {
        artifactId: sourceArtifactId,
        ...(readString(sourceArtifact?.filename) ? { filename: readString(sourceArtifact?.filename) } : {}),
        mimeType: readString(sourceArtifact?.mimeType) || 'application/octet-stream',
        sizeBytes: Math.max(0, readNumber(sourceArtifact?.sizeBytes, 0)),
        ...(sourceDocumentId ? { documentId: sourceDocumentId } : {}),
      },
    } : {}),
    ...(benchmarkKind ? { benchmarkKind } : {}),
    ...(taskType ? { taskType } : {}),
    ...(documentId ? { documentId } : {}),
    candidates,
    artifact,
    artifactStatus: { state: 'saved', message: `loaded from ${artifact.artifactId}` },
  };
}

async function loadComparisonFromArtifact(
  artifactStore: AgentModelCompareArtifactStore | undefined,
  artifactId: string,
): Promise<StoredComparison | null> {
  if (!artifactStore?.readContent) return null;
  const { record, buffer } = await artifactStore.readContent(artifactId);
  const artifact = toSavedComparisonArtifact(record);
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf-8')) as unknown;
  } catch {
    return null;
  }
  return parseComparisonArtifactPayload(parsed, artifact);
}

async function resolveComparisonForRead(input: {
  readonly artifactStore?: AgentModelCompareArtifactStore;
  readonly comparisons: Map<string, StoredComparison>;
  readonly comparisonId: string;
  readonly artifactId: string;
}): Promise<StoredComparison | null> {
  if (input.comparisonId) {
    const inMemory = input.comparisons.get(input.comparisonId);
    if (inMemory) return inMemory;
    const artifact = input.artifactStore?.list?.(100)
      .filter(isModelCompareArtifact)
      .find((entry) => readString(entry.metadata.comparisonId) === input.comparisonId);
    if (artifact) return loadComparisonFromArtifact(input.artifactStore, artifact.id);
  }
  if (input.artifactId) return loadComparisonFromArtifact(input.artifactStore, input.artifactId);
  return null;
}

export function createAgentModelCompareTool(deps: AgentModelCompareToolDeps): Tool {
  const comparisons = new Map<string, StoredComparison>();
  return {
    definition: {
      name: 'agent_model_compare',
      description: 'Blind compare prompts/artifacts, review, route decisions, handoff, diff.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: [MODE_RUN, MODE_REVEAL, MODE_REVIEW, MODE_SIDE_BY_SIDE, MODE_JUDGE, MODE_APPLY, MODE_ROUTE_DECISION, MODE_EXPORT, MODE_HANDOFF, MODE_HANDOFF_ARCHIVE, MODE_HANDOFF_DIFF, MODE_ANALYTICS, MODE_SYNTHESIS],
            description: 'Select compare workflow mode.',
          },
          prompt: {
            type: 'string',
            description: 'Exact prompt sent identically to every candidate model.',
          },
          modelRefs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional registry keys or model ids. Omit to auto-select candidates.',
          },
          candidateCount: {
            type: 'number',
            description: 'Number of candidates to auto-select when modelRefs is omitted. 2 to 4.',
          },
          rubric: {
            type: 'string',
            description: 'Optional judging rubric shown with the blinded results.',
          },
          systemPrompt: {
            type: 'string',
            description: 'Optional system prompt sent identically to every candidate model.',
          },
          maxTokens: {
            type: 'number',
            description: 'Optional per-candidate output cap. Defaults to 2048, max 8192.',
          },
          reveal: {
            type: 'boolean',
            description: 'If true, include model identities immediately after the blinded outputs.',
          },
          saveArtifact: {
            type: 'boolean',
            description: 'Defaults true; save the local JSON review artifact.',
          },
          benchmarkKind: {
            type: 'string',
            description: 'Optional benchmark tag for saved comparisons or analytics filters.',
          },
          taskType: {
            type: 'string',
            description: 'Optional task type tag for saved comparisons or analytics filters.',
          },
          documentId: {
            type: 'string',
            description: 'Optional document id tag for saved comparisons or analytics filters.',
          },
          comparisonId: {
            type: 'string',
            description: 'Stored comparison id for mode reveal.',
          },
          artifactId: {
            type: 'string',
            description: 'Run source artifact, saved comparison, or judgment artifact id.',
          },
          leftArtifactId: {
            type: 'string',
            description: 'Left saved reviewer handoff artifact id for handoffDiff.',
          },
          rightArtifactId: {
            type: 'string',
            description: 'Right saved reviewer handoff artifact id for handoffDiff.',
          },
          sectionId: {
            type: 'string',
            description: 'Optional handoffDiff jump: all, metadata, policy, related, comparison.',
          },
          winnerBlindId: {
            type: 'string',
            description: 'Candidate label to save as winner, such as A or Candidate B.',
          },
          winner: {
            type: 'string',
            description: 'Alias for winnerBlindId.',
          },
          reasons: {
            type: 'string',
            description: 'User-visible reasons for the saved judgment.',
          },
          notes: {
            type: 'string',
            description: 'Optional extra judgment notes.',
          },
          decision: {
            type: 'string',
            enum: ['left-unchanged', 'leave-unchanged', 'keep-current', 'no-change', 'applied-winner'],
            description: 'Route-decision receipt choice for routeDecision mode.',
          },
          limit: {
            type: 'number',
            description: 'Max saved judgments to inspect.',
          },
          includeReasons: {
            type: 'boolean',
            description: 'If true, include short reason excerpts.',
          },
          relatedArtifactIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Related artifacts for reviewer view or handoff.',
          },
          previewBytes: {
            type: 'number',
            description: 'Max bytes per related artifact preview.',
          },
          confirm: {
            type: 'boolean',
            description: 'Required true for provider calls and mutating modes.',
          },
          explicitUserRequest: {
            type: 'string',
            description: 'User request authorizing this comparison.',
          },
        },
        required: ['mode'],
        additionalProperties: false,
      },
      sideEffects: ['network', 'state'],
      concurrency: 'serial',
    },
    execute: async (rawArgs: Record<string, unknown>) => {
      try {
        const args = rawArgs as AgentModelCompareToolArgs;
        const mode = parseMode(args.mode);
        if (mode === MODE_REVEAL || mode === MODE_REVIEW) {
          const comparisonId = readString(args.comparisonId);
          const artifactId = readString(args.artifactId);
          if (mode === MODE_REVIEW && !comparisonId && !artifactId) {
            return output(formatSavedComparisonArtifacts(deps.artifactStore));
          }
          if (!comparisonId && !artifactId) {
            return failure(`${mode} mode requires comparisonId or artifactId.`);
          }
          const comparison = await resolveComparisonForRead({
            artifactStore: deps.artifactStore,
            comparisons,
            comparisonId,
            artifactId,
          });
          if (!comparison) {
            return failure(`Unknown comparison. Run a new comparison or pass a saved comparison artifactId.`);
          }
          rememberComparison(comparisons, comparison);
          return output(mode === MODE_REVEAL ? formatReveal(comparison) : formatReview(comparison, readBoolean(args.reveal)));
        }

        if (mode === MODE_SIDE_BY_SIDE) {
          const artifactId = readString(args.artifactId);
          if (!artifactId) {
            return output([
              formatSavedComparisonArtifacts(deps.artifactStore),
              '',
              'Choose a saved comparison or judgment artifactId to render a side-by-side reviewer view.',
            ].join('\n'));
          }
          if (!deps.artifactStore?.readContent) {
            return failure('Side-by-side reviewer view is unavailable because this runtime cannot read artifact content.');
          }
          const relatedArtifactIds = readStringList(args.relatedArtifactIds).filter((relatedId) => relatedId !== artifactId);
          const previewBytes = clamp(
            readNumber(args.previewBytes, DEFAULT_SIDE_BY_SIDE_PREVIEW_BYTES),
            200,
            MAX_SIDE_BY_SIDE_PREVIEW_BYTES,
          );
          const comparison = await loadComparisonFromArtifact(deps.artifactStore, artifactId);
          if (comparison) {
            const relatedArtifacts = await loadHandoffRelatedArtifacts(deps.artifactStore, relatedArtifactIds, previewBytes);
            rememberComparison(comparisons, comparison);
            return output(formatSideBySideReview({
              sourceKind: 'comparison',
              sourceArtifactId: artifactId,
              comparisonId: comparison.comparisonId,
              comparison,
              reveal: readBoolean(args.reveal),
              relatedArtifacts,
              previewBytes,
            }));
          }
          const judgment = await loadJudgmentFromArtifact(deps.artifactStore, artifactId);
          if (!judgment) return failure('Unknown comparison or judgment artifact. Pass a saved blind model comparison artifactId.');
          const relatedArtifacts = await loadHandoffRelatedArtifacts(deps.artifactStore, relatedArtifactIds, previewBytes);
          return output(formatSideBySideReview({
            sourceKind: 'judgment',
            sourceArtifactId: artifactId,
            comparisonId: judgment.comparisonId,
            judgment,
            reveal: judgment.revealIncludedInJudgment,
            relatedArtifacts,
            previewBytes,
          }));
        }

        if (mode === MODE_HANDOFF_DIFF) {
          const leftArtifactId = readString(args.leftArtifactId || args.artifactId);
          const rightArtifactId = readString(args.rightArtifactId);
          if (!leftArtifactId && !rightArtifactId) {
            return output([
              formatSavedHandoffArtifacts(deps.artifactStore),
              '',
              'Choose two saved reviewer handoff artifact ids with leftArtifactId and rightArtifactId to render a visual diff.',
            ].join('\n'));
          }
          if (!leftArtifactId || !rightArtifactId) {
            return failure('handoffDiff mode requires leftArtifactId and rightArtifactId.');
          }
          if (leftArtifactId === rightArtifactId) {
            return failure('handoffDiff mode requires two different reviewer handoff artifact ids.');
          }
          if (!deps.artifactStore?.readContent) {
            return failure('Reviewer handoff diff is unavailable because this runtime cannot read artifact content.');
          }
          const left = await loadHandoffDiffArtifact(deps.artifactStore, leftArtifactId);
          const right = await loadHandoffDiffArtifact(deps.artifactStore, rightArtifactId);
          if (!left || !right) {
            return failure('Unknown reviewer handoff artifact. Pass two saved blind model comparison handoff artifact ids.');
          }
          return output(formatHandoffDiff({ left, right, sectionId: readString(args.sectionId) }));
        }

        if (mode === MODE_ANALYTICS) {
          const limit = clamp(readNumber(args.limit, 20), 1, 100);
          const filters = readComparisonAnalyticsFilters(args);
          const judgments = await loadSavedJudgments(deps.artifactStore, limit, filters);
          return output(formatComparisonAnalytics({
            judgments,
            limit,
            includeReasons: readOptionalBoolean(args.includeReasons, true),
            filters,
            storeAvailable: Boolean(deps.artifactStore?.list && deps.artifactStore.readContent),
          }));
        }

        if (mode === MODE_SYNTHESIS) {
          const limit = clamp(readNumber(args.limit, 20), 1, 100);
          const filters = readComparisonAnalyticsFilters(args);
          const judgments = await loadSavedJudgments(deps.artifactStore, limit, filters);
          return output(formatComparisonSynthesis({
            judgments,
            limit,
            includeReasons: readOptionalBoolean(args.includeReasons, true),
            filters,
            storeAvailable: Boolean(deps.artifactStore?.list && deps.artifactStore.readContent),
          }));
        }

        if (mode === MODE_JUDGE) {
          const comparisonId = readString(args.comparisonId);
          const artifactId = readString(args.artifactId);
          const winnerBlindId = readString(args.winnerBlindId ?? args.winner);
          const reasons = readString(args.reasons);
          const explicitUserRequest = readString(args.explicitUserRequest);
          if (!comparisonId && !artifactId) return failure('judge mode requires comparisonId or artifactId.');
          if (!winnerBlindId) return failure('winnerBlindId is required for judge mode.');
          if (!reasons) return failure('reasons are required for judge mode.');
          if (!explicitUserRequest) {
            return failure('explicitUserRequest is required so saved judgments stay tied to a direct user request.');
          }
          if (!readBoolean(args.confirm)) {
            return failure([
              formatJudgePreview(args),
              '',
              'Judgment confirmation required. Call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to save this judgment.',
            ].join('\n'));
          }
          const comparison = await resolveComparisonForRead({
            artifactStore: deps.artifactStore,
            comparisons,
            comparisonId,
            artifactId,
          });
          if (!comparison) return failure('Unknown comparison. Run a new comparison or pass a saved comparison artifactId.');
          const winner = findCandidate(comparison, winnerBlindId);
          if (!winner) {
            return failure(`Unknown winnerBlindId ${winnerBlindId}. Available candidates: ${comparison.candidates.map((candidate) => candidate.blindId).join(', ')}.`);
          }
          const artifact = await saveComparisonJudgmentArtifact({
            artifactStore: deps.artifactStore,
            comparison,
            winner,
            reasons,
            notes: readString(args.notes),
            reveal: readBoolean(args.reveal),
          });
          rememberComparison(comparisons, comparison);
          return output(formatJudgmentResult({
            comparison,
            winner,
            artifact,
            reasons,
            reveal: readBoolean(args.reveal),
          }));
        }

        if (mode === MODE_APPLY) {
          const artifactId = readString(args.artifactId);
          const explicitUserRequest = readString(args.explicitUserRequest);
          if (!artifactId) return failure('apply mode requires a saved judgment artifactId.');
          if (!explicitUserRequest) {
            return failure('explicitUserRequest is required so route updates stay tied to a direct user request.');
          }
          if (!deps.applyModelRoute) {
            return failure('Model route updates are unavailable in this runtime. Use agent_harness mode:"set_setting" for provider.model if available.');
          }
          if (!deps.artifactStore?.readContent) {
            return failure('Saved judgment artifacts are unavailable because this runtime cannot read artifact content.');
          }
          const judgment = await loadJudgmentFromArtifact(deps.artifactStore, artifactId);
          if (!judgment) return failure('Unknown judgment artifact. Pass a saved model comparison judgment artifactId.');
          if (!judgment.revealIncludedInJudgment || !judgment.winnerModel?.registryKey) {
            return failure('Judgment artifact does not include a revealed winner model. Save or reveal the judgment before applying a route update.');
          }
          if (!readBoolean(args.confirm)) {
            return failure([
              formatApplyPreview(judgment),
              '',
              'Route update confirmation required. Call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to apply this winning model.',
            ].join('\n'));
          }
          await ensureSelectableWinnerModel(deps.modelCatalog, judgment.winnerModel.registryKey);
          const result = await deps.applyModelRoute(judgment.winnerModel.registryKey);
          await deps.modelCatalog.recordModelUsage?.(judgment.winnerModel.registryKey);
          let receipt: SavedComparisonArtifact | null = null;
          let receiptError: string | null = null;
          try {
            receipt = await saveRouteDecisionArtifact({
              artifactStore: deps.artifactStore,
              decision: 'applied-winner',
              judgment,
              route: result,
              explicitUserRequest,
            });
          } catch (error) {
            receiptError = error instanceof Error ? error.message : String(error);
          }
          return output(formatApplyResult({ judgment, result, receipt, receiptError }));
        }

        if (mode === MODE_ROUTE_DECISION) {
          const artifactId = readString(args.artifactId);
          const explicitUserRequest = readString(args.explicitUserRequest);
          const decision = parseRouteDecision(args.decision);
          if (!artifactId) return failure('routeDecision mode requires a saved judgment artifactId.');
          if (!explicitUserRequest) {
            return failure('explicitUserRequest is required so route-decision receipts stay tied to a direct user request.');
          }
          if (decision !== 'left-unchanged') {
            return failure('routeDecision mode records leave-unchanged decisions. Use mode:"apply" to apply a revealed winner.');
          }
          if (!deps.artifactStore?.readContent || !deps.artifactStore.create) {
            return failure('Route-decision receipts are unavailable because this runtime cannot read and create artifact content.');
          }
          const judgment = await loadJudgmentFromArtifact(deps.artifactStore, artifactId);
          if (!judgment) return failure('Unknown judgment artifact. Pass a saved model comparison judgment artifactId.');
          if (!judgment.revealIncludedInJudgment || !judgment.winnerModel?.registryKey) {
            return failure('Judgment artifact does not include a revealed winner model. Save or reveal the judgment before recording a route decision.');
          }
          const currentModel = (await resolveCurrentModel(deps.modelCatalog))?.registryKey ?? null;
          if (!readBoolean(args.confirm)) {
            return failure([
              formatRouteDecisionPreview({ judgment, decision, currentModel }),
              '',
              'Route-decision confirmation required. Call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to leave the current model route unchanged.',
            ].join('\n'));
          }
          const receipt = await saveRouteDecisionArtifact({
            artifactStore: deps.artifactStore,
            decision,
            judgment,
            currentModel,
            explicitUserRequest,
          });
          return output(formatRouteDecisionResult({ judgment, decision, receipt, currentModel }));
        }

        if (mode === MODE_EXPORT) {
          const artifactId = readString(args.artifactId);
          const explicitUserRequest = readString(args.explicitUserRequest);
          if (!artifactId) return failure('export mode requires a saved comparison or judgment artifactId.');
          if (!explicitUserRequest) {
            return failure('explicitUserRequest is required so exports stay tied to a direct user request.');
          }
          if (!deps.artifactStore?.readContent || !deps.artifactStore.create) {
            return failure('Saved comparison export is unavailable because this runtime cannot read and create artifact content.');
          }

          const comparison = await loadComparisonFromArtifact(deps.artifactStore, artifactId);
          if (comparison) {
            const reveal = readBoolean(args.reveal);
            if (!readBoolean(args.confirm)) {
              return failure([
                formatExportPreview({
                  sourceKind: 'comparison',
                  sourceArtifactId: artifactId,
                  comparisonId: comparison.comparisonId,
                  reveal,
                }),
                '',
                'Export confirmation required. Call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to create this markdown report.',
              ].join('\n'));
            }
            const artifact = await saveComparisonExportArtifact({
              artifactStore: deps.artifactStore,
              sourceArtifactId: artifactId,
              sourceKind: 'comparison',
              comparisonId: comparison.comparisonId,
              markdown: comparisonExportMarkdown(comparison, reveal),
              reveal,
            });
            rememberComparison(comparisons, comparison);
            return output(formatExportResult({
              sourceKind: 'comparison',
              sourceArtifactId: artifactId,
              comparisonId: comparison.comparisonId,
              artifact,
            }));
          }

          const judgment = await loadJudgmentFromArtifact(deps.artifactStore, artifactId);
          if (!judgment) return failure('Unknown comparison or judgment artifact. Pass a saved blind model comparison artifactId.');
          const reveal = judgment.revealIncludedInJudgment;
          if (!readBoolean(args.confirm)) {
            return failure([
              formatExportPreview({
                sourceKind: 'judgment',
                sourceArtifactId: artifactId,
                comparisonId: judgment.comparisonId,
                reveal,
              }),
              '',
              'Export confirmation required. Call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to create this markdown report.',
            ].join('\n'));
          }
          const artifact = await saveComparisonExportArtifact({
            artifactStore: deps.artifactStore,
            sourceArtifactId: artifactId,
            sourceKind: 'judgment',
            comparisonId: judgment.comparisonId,
            markdown: judgmentExportMarkdown(judgment),
            reveal,
          });
          return output(formatExportResult({
            sourceKind: 'judgment',
            sourceArtifactId: artifactId,
            comparisonId: judgment.comparisonId,
            artifact,
          }));
        }

        if (mode === MODE_HANDOFF) {
          const artifactId = readString(args.artifactId);
          const explicitUserRequest = readString(args.explicitUserRequest);
          const relatedArtifactIds = readStringList(args.relatedArtifactIds).filter((relatedId) => relatedId !== artifactId);
          if (!artifactId) return failure('handoff mode requires a saved comparison or judgment artifactId.');
          if (relatedArtifactIds.length === 0) return failure('handoff mode requires at least one relatedArtifactIds entry.');
          if (!explicitUserRequest) {
            return failure('explicitUserRequest is required so reviewer handoffs stay tied to a direct user request.');
          }
          if (!deps.artifactStore?.readContent || !deps.artifactStore.create) {
            return failure('Reviewer handoff is unavailable because this runtime cannot read and create artifact content.');
          }

          const comparison = await loadComparisonFromArtifact(deps.artifactStore, artifactId);
          if (comparison) {
            const reveal = readBoolean(args.reveal);
            if (!readBoolean(args.confirm)) {
              return failure([
                formatHandoffPreview({
                  sourceKind: 'comparison',
                  sourceArtifactId: artifactId,
                  comparisonId: comparison.comparisonId,
                  reveal,
                  relatedArtifactIds,
                }),
                '',
                'Handoff confirmation required. Call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to create this reviewer handoff.',
              ].join('\n'));
            }
            const relatedArtifacts = await loadHandoffRelatedArtifacts(deps.artifactStore, relatedArtifactIds);
            const artifact = await saveComparisonHandoffArtifact({
              artifactStore: deps.artifactStore,
              sourceArtifactId: artifactId,
              sourceKind: 'comparison',
              comparisonId: comparison.comparisonId,
              relatedArtifactIds,
              markdown: comparisonHandoffMarkdown({
                sourceKind: 'comparison',
                sourceArtifactId: artifactId,
                comparisonId: comparison.comparisonId,
                comparisonMarkdown: comparisonExportMarkdown(comparison, reveal),
                reveal,
                relatedArtifacts,
              }),
              reveal,
            });
            rememberComparison(comparisons, comparison);
            return output(formatHandoffResult({
              sourceKind: 'comparison',
              sourceArtifactId: artifactId,
              comparisonId: comparison.comparisonId,
              relatedArtifactCount: relatedArtifacts.length,
              artifact,
            }));
          }

          const judgment = await loadJudgmentFromArtifact(deps.artifactStore, artifactId);
          if (!judgment) return failure('Unknown comparison or judgment artifact. Pass a saved blind model comparison artifactId.');
          const reveal = judgment.revealIncludedInJudgment;
          if (!readBoolean(args.confirm)) {
            return failure([
              formatHandoffPreview({
                sourceKind: 'judgment',
                sourceArtifactId: artifactId,
                comparisonId: judgment.comparisonId,
                reveal,
                relatedArtifactIds,
              }),
              '',
              'Handoff confirmation required. Call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to create this reviewer handoff.',
            ].join('\n'));
          }
          const relatedArtifacts = await loadHandoffRelatedArtifacts(deps.artifactStore, relatedArtifactIds);
          const artifact = await saveComparisonHandoffArtifact({
            artifactStore: deps.artifactStore,
            sourceArtifactId: artifactId,
            sourceKind: 'judgment',
            comparisonId: judgment.comparisonId,
            relatedArtifactIds,
            markdown: comparisonHandoffMarkdown({
              sourceKind: 'judgment',
              sourceArtifactId: artifactId,
              comparisonId: judgment.comparisonId,
              comparisonMarkdown: judgmentExportMarkdown(judgment),
              reveal,
              relatedArtifacts,
            }),
            reveal,
          });
          return output(formatHandoffResult({
            sourceKind: 'judgment',
            sourceArtifactId: artifactId,
            comparisonId: judgment.comparisonId,
            relatedArtifactCount: relatedArtifacts.length,
            artifact,
          }));
        }

        if (mode === MODE_HANDOFF_ARCHIVE) {
          const artifactId = readString(args.artifactId);
          const explicitUserRequest = readString(args.explicitUserRequest);
          if (!artifactId) return output(formatSavedHandoffArtifacts(deps.artifactStore));
          if (!explicitUserRequest) {
            return failure('explicitUserRequest is required so reviewer handoff archives stay tied to a direct user request.');
          }
          if (!deps.artifactStore?.readContent || !deps.artifactStore.create) {
            return failure('Reviewer handoff archive is unavailable because this runtime cannot read and create artifact content.');
          }

          const handoff = await loadHandoffFromArtifact(deps.artifactStore, artifactId);
          if (!handoff) return failure('Unknown reviewer handoff artifact. Pass a saved blind model comparison handoff artifactId.');
          const routeDecisionArtifactIds = findRouteDecisionArtifactIdsForHandoff(deps.artifactStore, handoff);
          if (!readBoolean(args.confirm)) {
            return failure([
              formatHandoffArchivePreview({ handoff, routeDecisionArtifactIds }),
              '',
              'Handoff archive confirmation required. Call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to create this reviewer handoff ZIP.',
            ].join('\n'));
          }

          const artifacts = await loadHandoffArchiveArtifacts(deps.artifactStore, handoff, routeDecisionArtifactIds);
          const payload = buildComparisonHandoffArchivePayload({ handoff, artifacts });
          const archive = createZipArchive(payload.entries);
          const artifact = await saveComparisonHandoffArchiveArtifact({
            artifactStore: deps.artifactStore,
            handoff,
            payload,
            archive,
          });
          return output(formatHandoffArchiveResult({
            handoff,
            artifact,
            artifactCount: payload.artifactCount,
            routeDecisionArtifactCount: payload.routeDecisionArtifactIds.length,
            sourceBytes: payload.sourceBytes,
            archiveBytes: archive.byteLength,
          }));
        }

        const promptInput = readString(args.prompt);
        const explicitUserRequest = readString(args.explicitUserRequest);
        const sourceArtifactId = readString(args.artifactId);
        const refs = readModelRefs(args.modelRefs);
        const benchmarkKind = readBenchmarkKind(args.benchmarkKind);
        const taskType = readComparisonTag(args.taskType);
        const requestedDocumentId = readComparisonTag(args.documentId);
        const candidateCount = clamp(readNumber(args.candidateCount, DEFAULT_CANDIDATE_COUNT), MIN_CANDIDATES, MAX_CANDIDATES);
        if (!promptInput && !sourceArtifactId) return failure('prompt or artifactId is required.');
        if (!explicitUserRequest) {
          return failure('explicitUserRequest is required so model comparison stays tied to a direct user request.');
        }
        if (!readBoolean(args.confirm)) {
          return failure([
            formatPreview(args, refs, candidateCount),
            '',
            'Model tool confirmation required. Call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to run this comparison.',
          ].join('\n'));
        }
        const runPrompt = await buildRunPromptFromArtifact({
          artifactStore: deps.artifactStore,
          prompt: promptInput,
          artifactId: sourceArtifactId,
        });
        const prompt = runPrompt.prompt;
        if (prompt.length > MAX_PROMPT_CHARS) return failure(`prompt exceeds ${MAX_PROMPT_CHARS} characters.`);

        const maxTokens = clamp(readNumber(args.maxTokens, DEFAULT_MAX_TOKENS), 1, MAX_COMPLETION_TOKENS);
        const systemPrompt = readString(args.systemPrompt);
        const models = await selectComparisonModels(deps.modelCatalog, refs, candidateCount);
        const results = await Promise.all(models.map((model, index) => runCandidate(
          deps,
          model,
          BLIND_LABELS[index] ?? String(index + 1),
          prompt,
          systemPrompt,
          maxTokens,
        )));
        const reveal = readBoolean(args.reveal);
        const baseComparison: StoredComparison = {
          comparisonId: `cmp_${randomUUID()}`,
          createdAt: new Date().toISOString(),
          promptPreview: previewText(prompt, 160),
          rubric: readString(args.rubric),
          ...(runPrompt.sourceArtifact ? { sourceArtifact: runPrompt.sourceArtifact } : {}),
          ...(benchmarkKind ? { benchmarkKind } : {}),
          ...(taskType ? { taskType } : {}),
          ...(requestedDocumentId || runPrompt.sourceArtifact?.documentId ? { documentId: requestedDocumentId || runPrompt.sourceArtifact?.documentId } : {}),
          candidates: results,
        };
        const saved = await saveComparisonArtifact({
          artifactStore: deps.artifactStore,
          comparison: baseComparison,
          prompt,
          systemPrompt,
          maxTokens,
          revealIncludedInTranscript: reveal,
          enabled: readOptionalBoolean(args.saveArtifact, true),
          ...(benchmarkKind ? { benchmarkKind } : {}),
        });
        const comparison: StoredComparison = {
          ...baseComparison,
          ...(saved.artifact ? { artifact: saved.artifact } : {}),
          artifactStatus: saved.status,
        };
        rememberComparison(comparisons, comparison);
        await Promise.allSettled(models.map((model) => deps.modelCatalog.recordModelUsage?.(model.registryKey)));
        const rendered = formatRunResult(comparison, reveal);
        return results.some((candidate) => candidate.status === 'completed')
          ? output(rendered)
          : failure(rendered);
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function registerAgentModelCompareTool(
  registry: ToolRegistry,
  deps: AgentModelCompareToolDeps,
): void {
  registry.register(createAgentModelCompareTool(deps));
}
