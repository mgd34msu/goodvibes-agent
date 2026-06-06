import { randomUUID } from 'node:crypto';
import type { ArtifactDescriptor, ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { ChatRequest, ChatResponse, LLMProvider } from '@pellux/goodvibes-sdk/platform/providers';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';

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
  readonly winner?: unknown;
  readonly winnerBlindId?: unknown;
  readonly reasons?: unknown;
  readonly notes?: unknown;
  readonly limit?: unknown;
  readonly includeReasons?: unknown;
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
  readonly winnerModel?: {
    readonly registryKey: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly displayName: string;
  };
}

interface SavedComparisonArtifact {
  readonly artifactId: string;
  readonly filename?: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

interface ComparisonArtifactStatus {
  readonly state: 'saved' | 'disabled' | 'unavailable' | 'failed';
  readonly message: string;
}

const MODE_RUN = 'run';
const MODE_REVEAL = 'reveal';
const MODE_REVIEW = 'review';
const MODE_JUDGE = 'judge';
const MODE_APPLY = 'apply';
const MODE_EXPORT = 'export';
const MODE_ANALYTICS = 'analytics';
const BENCHMARK_KIND_LOCAL_MODEL_ROUTE = 'local-model-route';
const MAX_PROMPT_CHARS = 24_000;
const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 4;
const DEFAULT_CANDIDATE_COUNT = 2;
const DEFAULT_MAX_TOKENS = 2_048;
const MAX_COMPLETION_TOKENS = 8_192;
const DEFAULT_CANDIDATE_OUTPUT_CHARS = 12_000;
const MAX_SOURCE_ARTIFACT_BYTES = 18_000;
const COMPARISON_STORE_LIMIT = 25;
const BLIND_LABELS = ['A', 'B', 'C', 'D'] as const;

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
  const kind = readString(value);
  return kind === BENCHMARK_KIND_LOCAL_MODEL_ROUTE ? kind : '';
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
      return `  ${artifact.id} ${comparisonId} candidates ${completed}/${count} prompt ${promptPreview}`;
    }),
    '',
    'Review one with mode:"review" and artifactId, or reveal with mode:"reveal" after judging.',
  ].join('\n');
}

function isModelCompareJudgmentArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = readString(artifact.metadata.purpose);
  if (purpose === 'agent-model-compare-judgment') return true;
  if (purpose) return false;
  return readString(artifact.filename).startsWith('blind-model-comparison-judgment-');
}

function formatArtifactStatus(comparison: StoredComparison): string {
  if (comparison.artifact) {
    const filename = comparison.artifact.filename ? ` ${comparison.artifact.filename}` : '';
    return `artifact ${comparison.artifact.artifactId}${filename} (${comparison.artifact.mimeType}, ${comparison.artifact.sizeBytes} bytes; includes full prompt, blinded outputs, and reveal map)`;
  }
  if (comparison.artifactStatus) return `artifact ${comparison.artifactStatus.message}`;
  return 'artifact not saved';
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

function parseJudgmentArtifactPayload(value: unknown, artifact: SavedComparisonArtifact): LoadedComparisonJudgment | null {
  const payload = readRecord(value);
  if (!payload || readString(payload.schema) !== 'goodvibes.agent.model_compare_judgment.v1') return null;
  const winnerModel = readRecord(payload.winnerModel);
  const registryKey = readString(winnerModel?.registryKey);
  return {
    artifact,
    judgmentId: readString(payload.judgmentId) || `judgment_from_${artifact.artifactId}`,
    comparisonId: readString(payload.comparisonId) || 'unknown-comparison',
    winnerBlindId: readString(payload.winnerBlindId) || '?',
    reasons: readString(payload.reasons),
    notes: readString(payload.notes),
    revealIncludedInJudgment: payload.revealIncludedInJudgment === true,
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
  return parseJudgmentArtifactPayload(payload, toSavedComparisonArtifact(record));
}

async function loadSavedJudgments(
  artifactStore: AgentModelCompareArtifactStore | undefined,
  limit: number,
): Promise<readonly LoadedComparisonJudgment[]> {
  if (!artifactStore?.list || !artifactStore.readContent) return [];
  const artifacts = artifactStore.list(Math.max(limit * 3, limit))
    .filter(isModelCompareJudgmentArtifact)
    .slice(0, limit);
  const loaded = await Promise.all(artifacts.map(async (artifact) => {
    try {
      return await loadJudgmentFromArtifact(artifactStore, artifact.id);
    } catch {
      return null;
    }
  }));
  return loaded.filter((judgment): judgment is LoadedComparisonJudgment => judgment !== null);
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
}): string {
  const lines = [
    `Applied blind model comparison winner ${input.judgment.judgmentId}`,
    `comparison ${input.judgment.comparisonId}`,
    `winner Candidate ${input.judgment.winnerBlindId}`,
    `selected model ${input.result.selectedModel}`,
  ];
  if (input.result.previousModel) lines.push(`previous model ${input.result.previousModel}`);
  lines.push('Judgment and comparison artifacts were not changed.');
  return lines.join('\n');
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedCounts(map: Map<string, number>): readonly [string, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function formatComparisonAnalytics(input: {
  readonly judgments: readonly LoadedComparisonJudgment[];
  readonly limit: number;
  readonly includeReasons: boolean;
  readonly storeAvailable: boolean;
}): string {
  if (!input.storeAvailable) {
    return 'Saved comparison analytics are unavailable because the artifact store does not expose listing and content reads in this runtime.';
  }
  if (input.judgments.length === 0) {
    return 'No saved comparison judgments found. Save a judgment with agent_model_compare mode:"judge" first.';
  }
  const modelWinners = new Map<string, number>();
  const blindWinners = new Map<string, number>();
  let revealed = 0;
  for (const judgment of input.judgments) {
    incrementCount(blindWinners, normalizeBlindId(judgment.winnerBlindId) || judgment.winnerBlindId || '?');
    if (judgment.winnerModel?.registryKey) {
      revealed += 1;
      incrementCount(modelWinners, `${judgment.winnerModel.registryKey} (${judgment.winnerModel.displayName})`);
    }
  }
  const hidden = input.judgments.length - revealed;
  const lines = [
    'Blind model comparison analytics',
    `judgments ${input.judgments.length}; revealed ${revealed}; hidden ${hidden}; limit ${input.limit}`,
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
  lines.push('Recent judgments');
  for (const judgment of input.judgments.slice(0, 10)) {
    const model = judgment.winnerModel?.registryKey
      ? ` model ${judgment.winnerModel.registryKey}`
      : ' model hidden';
    lines.push(`  ${judgment.artifact.artifactId} ${judgment.comparisonId} winner Candidate ${judgment.winnerBlindId}${model}`);
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

function formatRunResult(comparison: StoredComparison, reveal: boolean): string {
  const completed = comparison.candidates.filter((candidate) => candidate.status === 'completed').length;
  const lines = [
    `Blind model comparison ${comparison.comparisonId}`,
    `created ${comparison.createdAt}`,
    `prompt ${comparison.promptPreview}`,
    `rubric ${comparison.rubric || '(none)'}`,
    ...(comparison.sourceArtifact ? [`source artifact ${comparison.sourceArtifact.artifactId} (${comparison.sourceArtifact.mimeType}, ${comparison.sourceArtifact.sizeBytes} bytes)`] : []),
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
  return [
    'Agent blind model comparison preview',
    `  prompt ${previewText(readString(args.prompt) || '(missing)')}`,
    ...(readString(args.artifactId) ? [`  source artifact ${readString(args.artifactId)}`] : []),
    `  candidates ${refs.length > 0 ? refs.length : candidateCount}`,
    `  selection ${refs.length > 0 ? 'user supplied model refs' : 'auto-select from selectable models'}`,
    `  rubric ${previewText(readString(args.rubric) || '(none)')}`,
    ...(benchmarkKind ? [`  benchmark ${benchmarkKind}`] : []),
    `  reveal ${readBoolean(args.reveal) ? 'immediate' : 'delayed'}`,
    `  artifact ${readOptionalBoolean(args.saveArtifact, true) ? 'save local JSON review' : 'do not save'}`,
    '  policy model comparison sends the same prompt to each candidate and requires confirm:true plus explicitUserRequest',
  ].join('\n');
}

function parseMode(value: unknown): 'run' | 'reveal' | 'review' | 'judge' | 'apply' | 'export' | 'analytics' {
  const mode = readString(value) || MODE_RUN;
  if (
    mode === MODE_RUN
    || mode === MODE_REVEAL
    || mode === MODE_REVIEW
    || mode === MODE_JUDGE
    || mode === MODE_APPLY
    || mode === MODE_EXPORT
    || mode === MODE_ANALYTICS
  ) return mode;
  throw new Error('mode must be run, reveal, review, judge, apply, export, or analytics.');
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
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    maxTokens: input.maxTokens,
    rubric: input.comparison.rubric,
    ...(input.benchmarkKind ? { benchmarkKind: input.benchmarkKind } : {}),
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
  return {
    artifactId: descriptor.id,
    ...(descriptor.filename ? { filename: descriptor.filename } : {}),
    mimeType: descriptor.mimeType,
    sizeBytes: descriptor.sizeBytes,
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
        candidateCount: input.comparison.candidates.length,
        completedCandidates: input.comparison.candidates.filter((candidate) => candidate.status === 'completed').length,
        ...(input.benchmarkKind ? { benchmarkKind: input.benchmarkKind } : {}),
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
      },
    } : {}),
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
      description: 'Blind compare prompts or saved text artifacts.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: [MODE_RUN, MODE_REVEAL, MODE_REVIEW, MODE_JUDGE, MODE_APPLY, MODE_EXPORT, MODE_ANALYTICS],
            description: 'Use run, review, reveal, judge, apply, export, or analytics.',
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
            enum: [BENCHMARK_KIND_LOCAL_MODEL_ROUTE],
            description: 'Optional benchmark tag for saved comparison artifacts.',
          },
          comparisonId: {
            type: 'string',
            description: 'Stored comparison id for mode reveal.',
          },
          artifactId: {
            type: 'string',
            description: 'Run source artifact, saved comparison, or judgment artifact id.',
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
          limit: {
            type: 'number',
            description: 'Max saved judgments to inspect for analytics.',
          },
          includeReasons: {
            type: 'boolean',
            description: 'If true, include short reason excerpts in analytics.',
          },
          confirm: {
            type: 'boolean',
            description: 'Required true for run, judge, apply, and export.',
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

        if (mode === MODE_ANALYTICS) {
          const limit = clamp(readNumber(args.limit, 20), 1, 100);
          const judgments = await loadSavedJudgments(deps.artifactStore, limit);
          return output(formatComparisonAnalytics({
            judgments,
            limit,
            includeReasons: readOptionalBoolean(args.includeReasons, true),
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
          return output(formatApplyResult({ judgment, result }));
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

        const promptInput = readString(args.prompt);
        const explicitUserRequest = readString(args.explicitUserRequest);
        const sourceArtifactId = readString(args.artifactId);
        const refs = readModelRefs(args.modelRefs);
        const benchmarkKind = readBenchmarkKind(args.benchmarkKind);
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
