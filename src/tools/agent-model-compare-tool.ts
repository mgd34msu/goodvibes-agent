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
  readonly comparisonId?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
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

export interface AgentModelCompareToolDeps {
  readonly modelCatalog: AgentModelCompareModelCatalog;
  readonly providerRegistry: AgentModelCompareProviderRegistry;
  readonly artifactStore?: Pick<ArtifactStore, 'create'>;
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
  readonly candidates: readonly CompareCandidateResult[];
  readonly artifact?: SavedComparisonArtifact;
  readonly artifactStatus?: ComparisonArtifactStatus;
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
const MAX_PROMPT_CHARS = 24_000;
const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 4;
const DEFAULT_CANDIDATE_COUNT = 2;
const DEFAULT_MAX_TOKENS = 2_048;
const MAX_COMPLETION_TOKENS = 8_192;
const DEFAULT_CANDIDATE_OUTPUT_CHARS = 12_000;
const COMPARISON_STORE_LIMIT = 25;
const BLIND_LABELS = ['A', 'B', 'C', 'D'] as const;

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    ...(comparison.artifact ? [`artifact ${comparison.artifact.artifactId} (${comparison.artifact.mimeType}, ${comparison.artifact.sizeBytes} bytes)`] : []),
    '',
    ...comparison.candidates.map((candidate) => `${candidate.blindId}: ${candidate.model.registryKey} (${candidate.model.displayName})`),
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

function formatRunResult(comparison: StoredComparison, reveal: boolean): string {
  const completed = comparison.candidates.filter((candidate) => candidate.status === 'completed').length;
  const lines = [
    `Blind model comparison ${comparison.comparisonId}`,
    `created ${comparison.createdAt}`,
    `prompt ${comparison.promptPreview}`,
    `rubric ${comparison.rubric || '(none)'}`,
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
  return [
    'Agent blind model comparison preview',
    `  prompt ${previewText(readString(args.prompt) || '(missing)')}`,
    `  candidates ${refs.length > 0 ? refs.length : candidateCount}`,
    `  selection ${refs.length > 0 ? 'user supplied model refs' : 'auto-select from selectable models'}`,
    `  rubric ${previewText(readString(args.rubric) || '(none)')}`,
    `  reveal ${readBoolean(args.reveal) ? 'immediate' : 'delayed'}`,
    `  artifact ${readOptionalBoolean(args.saveArtifact, true) ? 'save local JSON review' : 'do not save'}`,
    '  policy model comparison sends the same prompt to each candidate and requires confirm:true plus explicitUserRequest',
  ].join('\n');
}

function parseMode(value: unknown): 'run' | 'reveal' {
  const mode = readString(value) || MODE_RUN;
  if (mode === MODE_RUN || mode === MODE_REVEAL) return mode;
  throw new Error('mode must be run or reveal.');
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
}): string {
  return `${JSON.stringify({
    schema: 'goodvibes.agent.model_compare.v1',
    comparisonId: input.comparison.comparisonId,
    createdAt: input.comparison.createdAt,
    prompt: input.prompt,
    promptPreview: input.comparison.promptPreview,
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    maxTokens: input.maxTokens,
    rubric: input.comparison.rubric,
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

async function saveComparisonArtifact(input: {
  readonly artifactStore?: Pick<ArtifactStore, 'create'>;
  readonly comparison: StoredComparison;
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly maxTokens: number;
  readonly revealIncludedInTranscript: boolean;
  readonly enabled: boolean;
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
        candidateCount: input.comparison.candidates.length,
        completedCandidates: input.comparison.candidates.filter((candidate) => candidate.status === 'completed').length,
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

export function createAgentModelCompareTool(deps: AgentModelCompareToolDeps): Tool {
  const comparisons = new Map<string, StoredComparison>();
  return {
    definition: {
      name: 'agent_model_compare',
      description: 'Run one confirmed blind model comparison.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: [MODE_RUN, MODE_REVEAL],
            description: 'Use run to compare models or reveal to reveal a stored comparison.',
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
          comparisonId: {
            type: 'string',
            description: 'Stored comparison id for mode reveal.',
          },
          confirm: {
            type: 'boolean',
            description: 'Required true for mode run only when the user requested this comparison.',
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
        if (mode === MODE_REVEAL) {
          const comparisonId = readString(args.comparisonId);
          if (!comparisonId) return failure('comparisonId is required for reveal mode.');
          const comparison = comparisons.get(comparisonId);
          if (!comparison) return failure(`Unknown comparisonId ${comparisonId}. Run a new comparison in this session.`);
          return output(formatReveal(comparison));
        }

        const prompt = readString(args.prompt);
        const explicitUserRequest = readString(args.explicitUserRequest);
        const refs = readModelRefs(args.modelRefs);
        const candidateCount = clamp(readNumber(args.candidateCount, DEFAULT_CANDIDATE_COUNT), MIN_CANDIDATES, MAX_CANDIDATES);
        if (!prompt) return failure('prompt is required.');
        if (prompt.length > MAX_PROMPT_CHARS) return failure(`prompt exceeds ${MAX_PROMPT_CHARS} characters.`);
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
