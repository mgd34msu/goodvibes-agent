import { arch, cpus, freemem, platform, totalmem } from 'node:os';
import type { ArtifactDescriptor } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { CommandContext } from '../input/command-registry.ts';
import { requireProviderApi } from '../input/commands/runtime-services.ts';
import { previewHarnessText } from './agent-harness-text.ts';

export interface AgentHarnessModelRoutingArgs {
  readonly modelRouteId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

type ModelRouteResolution =
  | { readonly status: 'found'; readonly route: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

type ModelRouteLookupSource = 'modelRouteId' | 'target' | 'query';

interface ModelCandidate {
  readonly kind: 'model';
  readonly id: string;
  readonly registryKey: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly current: boolean;
  readonly contextWindow: number | null;
  readonly reasoningEffort: readonly string[];
  readonly capabilities: unknown;
  readonly tier?: string;
  readonly benchmarkCompositeScore?: number | null;
  readonly benchmarkQualityTier?: string;
  readonly pinned: boolean;
}

interface RouteCandidate {
  readonly kind: 'route';
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly currentValue: unknown;
  readonly settingKeys: readonly string[];
  readonly commands: readonly string[];
  readonly uiSurfaces: readonly string[];
}

interface LocalModelDetection {
  readonly providerIds: readonly string[];
  readonly modelRoutes: readonly string[];
  readonly stacks: readonly string[];
}

interface LocalModelHardwareProfile {
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly cpuThreads: number;
  readonly ramGb: number;
  readonly freeRamGb: number;
  readonly memoryTier: 'constrained' | 'starter' | 'comfortable' | 'large';
  readonly acceleratorHint: 'apple-silicon' | 'cuda-env' | 'none-detected';
  readonly privacy: 'local-only';
  readonly caveat: string;
}

interface LocalModelRecipe {
  readonly id: string;
  readonly label: string;
  readonly fit: string;
  readonly bestFor: string;
  readonly hardware: string;
  readonly setup: readonly string[];
  readonly modelExamples: readonly string[];
  readonly cautions: readonly string[];
}

interface LocalModelRecipeFit {
  readonly score: number;
  readonly level: 'weak' | 'usable' | 'good' | 'strong';
  readonly reasons: readonly string[];
}

interface ModelReadinessDimension {
  readonly id: 'latency' | 'context-window' | 'tool-support' | 'vision' | 'cost' | 'privacy';
  readonly label: string;
  readonly score: number;
  readonly weight: number;
  readonly summary: string;
}

interface ModelReadinessScore {
  readonly score: number;
  readonly level: 'risky' | 'usable' | 'good' | 'excellent';
  readonly confidence: 'estimated' | 'metadata-backed' | 'measured';
  readonly dimensions: readonly ModelReadinessDimension[];
  readonly missingSignals: readonly string[];
  readonly nextStep: string;
}

interface LocalModelBenchmarkPlan {
  readonly status: 'plan-ready';
  readonly prompt: string;
  readonly measurements: readonly string[];
  readonly workspaceActionRoute: string;
  readonly compareRoute: string;
  readonly refreshRoute: string;
  readonly notes: readonly string[];
}

interface LocalModelBenchmarkWinner {
  readonly judgmentArtifactId: string;
  readonly sourceArtifactId: string | null;
  readonly registryKey: string;
  readonly stack: string | null;
  readonly promptPreview: string;
  readonly reviewRoute: string;
  readonly exportRoute: string;
  readonly applyRoute: string;
}

interface LocalModelBenchmarkEvidence {
  readonly status: 'unavailable' | 'unmeasured' | 'comparison-saved' | 'reviewed-winner';
  readonly comparisonCount: number;
  readonly completedCandidateCount: number;
  readonly revealedJudgmentCount: number;
  readonly hiddenJudgmentCount: number;
  readonly winnerStacks: readonly string[];
  readonly winnerModels: readonly LocalModelBenchmarkWinner[];
  readonly summary: string;
  readonly confidence: 'estimated' | 'measured';
}

type LocalModelEndpointSource = 'provider-registry' | 'model-registry' | 'environment';

interface LocalModelServerEndpoint {
  readonly kind: 'local-server-endpoint';
  readonly id: string;
  readonly providerId: string | null;
  readonly stack: string | null;
  readonly baseUrl: string;
  readonly modelsUrl: string;
  readonly diagnosticStatus: 'registered-route-needs-smoke' | 'needs-provider-after-smoke';
  readonly inspectRoute: string;
  readonly sources: readonly LocalModelEndpointSource[];
  readonly sourceDetails: readonly string[];
  readonly modelRoutes: readonly string[];
  readonly smokeCommand: string;
  readonly smokeRoute: string;
  readonly refreshRoute: string;
  readonly addProviderRoute: string | null;
  readonly notes: readonly string[];
  readonly diagnostics?: {
    readonly liveProbe: 'not-run';
    readonly successCriteria: readonly string[];
    readonly failureTriage: readonly string[];
    readonly afterSmoke: readonly string[];
    readonly policy: string;
  };
}

interface LocalModelServerDefaultEndpoint {
  readonly id: string;
  readonly label: string;
  readonly stack: string;
  readonly baseUrl: string;
  readonly modelsUrl: string;
  readonly smokeCommand: string;
  readonly addProviderRoute: string;
  readonly startHint: string;
}

interface LocalModelServerHealthMap {
  readonly status: 'candidate-endpoints' | 'no-local-endpoints';
  readonly liveProbe: 'not-run';
  readonly endpointCount: number;
  readonly returnedEndpoints: number;
  readonly endpoints: readonly LocalModelServerEndpoint[];
  readonly suggestedDefaults: readonly LocalModelServerDefaultEndpoint[];
  readonly nextActions: readonly string[];
  readonly policy: string;
}

interface MutableLocalModelServerEndpoint {
  providerId: string | null;
  stack: string | null;
  readonly baseUrl: string;
  readonly sources: Set<LocalModelEndpointSource>;
  readonly sourceDetails: Set<string>;
  readonly modelRoutes: Set<string>;
  readonly notes: Set<string>;
}

interface LocalModelSetupPlan {
  readonly status: 'detected' | 'ready-to-try' | 'needs-hardware-review';
  readonly priority: number;
  readonly downloadGuidance: readonly string[];
  readonly providerRoutes: readonly string[];
  readonly benchmarkPlan: LocalModelBenchmarkPlan;
  readonly confirmationBoundary: string;
}

interface ArtifactListLike {
  readonly list?: (limit?: number) => readonly ArtifactDescriptor[];
}

interface ProviderApiLike {
  readonly getFavorites: () => Promise<unknown>;
  readonly getCurrentModel: () => Promise<unknown>;
  readonly listModels: (options?: { readonly selectableOnly?: boolean }) => Promise<readonly unknown[]>;
  readonly listProviderIds: () => readonly string[];
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map((entry) => readString(entry)).filter(Boolean) : [];
}

function readProviderModels(value: unknown, providerId: string): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') return providerId ? `${providerId}:${entry}` : entry;
    const modelId = modelModelId(entry);
    const registryKey = modelRegistryKey(entry);
    return registryKey || (providerId && modelId ? `${providerId}:${modelId}` : modelId);
  }).filter(Boolean);
}

function readArtifactStore(context: CommandContext): ArtifactListLike | null {
  const candidate = (context.platform as { readonly artifactStore?: unknown }).artifactStore;
  return candidate && typeof candidate === 'object' ? candidate as ArtifactListLike : null;
}

function readConfig(context: CommandContext, key: string): unknown {
  try {
    return (context.platform.configManager as { get(settingKey: string): unknown }).get(key);
  } catch {
    return undefined;
  }
}

function contextWindowFor(context: CommandContext, model: unknown): number | null {
  const record = readRecord(model);
  const direct = record.contextWindow;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  try {
    const registry = context.provider.providerRegistry as { getContextWindowForModel(candidate: unknown): number };
    const value = registry.getContextWindowForModel(model);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function modelRegistryKey(model: unknown): string {
  const record = readRecord(model);
  return readString(record.registryKey) || readString(record.id) || readString(record.modelId);
}

function modelProviderId(model: unknown): string {
  const record = readRecord(model);
  return readString(record.providerId) || readString(record.provider);
}

function modelModelId(model: unknown): string {
  const record = readRecord(model);
  return readString(record.modelId) || readString(record.id) || modelRegistryKey(model);
}

function modelDisplayName(model: unknown): string {
  const record = readRecord(model);
  return readString(record.displayName) || readString(record.name) || modelRegistryKey(model);
}

function modelCurrent(model: unknown): boolean {
  const record = readRecord(model);
  return record.current === true;
}

function modelReasoning(model: unknown): readonly string[] {
  const record = readRecord(model);
  return readStringArray(record.reasoningEffort);
}

function modelCapabilities(model: unknown): unknown {
  return readRecord(model).capabilities ?? null;
}

function modelTier(model: unknown): string | undefined {
  return readString(readRecord(model).tier) || undefined;
}

function modelBenchmarkCompositeScore(model: unknown): number | null {
  const benchmark = readRecord(readRecord(model).benchmark);
  const value = benchmark.compositeScore;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function modelBenchmarkQualityTier(model: unknown): string | undefined {
  return readString(readRecord(readRecord(model).benchmark).qualityTier) || undefined;
}

function readProviderApi(context: CommandContext): ProviderApiLike | null {
  try {
    return requireProviderApi(context) as ProviderApiLike;
  } catch {
    return null;
  }
}

async function loadPinnedModelIds(context: CommandContext): Promise<ReadonlySet<string>> {
  const providerApi = readProviderApi(context);
  if (!providerApi) return new Set();
  try {
    const favorites = await providerApi.getFavorites();
    const pinned = readRecord(favorites).pinned;
    if (!Array.isArray(pinned)) return new Set();
    return new Set(pinned.flatMap((entry) => {
      const record = readRecord(entry);
      return [readString(record.registryKey), readString(record.modelId)].filter(Boolean);
    }));
  } catch {
    return new Set();
  }
}

async function loadModels(context: CommandContext): Promise<readonly ModelCandidate[]> {
  const providerApi = readProviderApi(context);
  if (!providerApi) return [];
  const pinned = await loadPinnedModelIds(context);
  const models = await providerApi.listModels({ selectableOnly: true });
  return models.map((model) => {
    const registryKey = modelRegistryKey(model);
    const modelId = modelModelId(model);
    return {
      kind: 'model',
      id: registryKey,
      registryKey,
      modelId,
      providerId: modelProviderId(model),
      displayName: modelDisplayName(model),
      current: modelCurrent(model) || registryKey === context.session.runtime.model,
      contextWindow: contextWindowFor(context, model),
      reasoningEffort: modelReasoning(model),
      capabilities: modelCapabilities(model),
      tier: modelTier(model),
      benchmarkCompositeScore: modelBenchmarkCompositeScore(model),
      benchmarkQualityTier: modelBenchmarkQualityTier(model),
      pinned: pinned.has(registryKey) || pinned.has(modelId),
    };
  });
}

function listProviderIds(context: CommandContext): readonly string[] {
  return readProviderApi(context)?.listProviderIds() ?? [];
}

function listRegistryModels(context: CommandContext): readonly unknown[] {
  try {
    const registry = context.provider.providerRegistry as { listModels?: () => readonly unknown[] };
    return registry.listModels?.() ?? [];
  } catch {
    return [];
  }
}

function listProviderRegistryProviders(context: CommandContext): readonly unknown[] {
  try {
    const registry = context.provider.providerRegistry as { listProviders?: () => readonly unknown[] };
    return registry.listProviders?.() ?? [];
  } catch {
    return [];
  }
}

function localStackFor(value: string): string | null {
  const normalized = value.toLowerCase();
  if (/ollama[-_\s]?cloud/.test(normalized)) return null;
  if (/\bollama\b/.test(normalized)) return 'ollama';
  if (/llama[.-]?cpp|llamacpp/.test(normalized)) return 'llama.cpp';
  if (/\bvllm\b/.test(normalized)) return 'vllm';
  if (/lm[-_\s]?studio/.test(normalized)) return 'openai-compatible';
  if (/localai|text-generation-inference|\btgi\b/.test(normalized)) return 'openai-compatible';
  if (/localhost|127\.0\.0\.1|\[?::1\]?/.test(normalized)) return 'openai-compatible';
  if (/openai-compatible|openai compatible|custom-provider|custom provider/.test(normalized)) return 'openai-compatible';
  return null;
}

function cleanUrlCandidate(value: string): string {
  return value.trim().replace(/[),.;]+$/g, '');
}

function extractUrls(value: string): readonly string[] {
  const matches = value.match(/https?:\/\/[^\s"'`<>]+/gi) ?? [];
  return [...new Set(matches.map(cleanUrlCandidate).filter(Boolean))];
}

function parseUrlCandidate(raw: string): URL | null {
  const trimmed = cleanUrlCandidate(raw);
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1') return true;
  if (host.endsWith('.local')) return true;
  if (host.includes(':')) return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
  const octets = host.split('.').map((entry) => Number(entry));
  if (octets.length === 4 && octets.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    const [first, second] = octets as [number, number, number, number];
    return first === 10
      || first === 127
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 169 && second === 254)
      || first === 0;
  }
  return !host.includes('.');
}

function isPrivateOrLocalUrl(raw: string): boolean {
  const url = parseUrlCandidate(raw);
  if (!url || !/^https?:$/.test(url.protocol)) return false;
  return isPrivateOrLocalHost(url.hostname);
}

function normalizeLocalBaseUrl(raw: string, stackHint?: string | null): string | null {
  const url = parseUrlCandidate(raw);
  if (!url || !/^https?:$/.test(url.protocol)) return null;
  const stack = stackHint ?? localStackFor(raw) ?? (isPrivateOrLocalHost(url.hostname) ? 'openai-compatible' : null);
  if (!isPrivateOrLocalUrl(url.href)) return null;

  let pathname = url.pathname.replace(/\/+$/g, '');
  if (pathname.endsWith('/models')) pathname = pathname.slice(0, -'/models'.length);
  if (pathname.endsWith('/api/tags')) pathname = pathname.slice(0, -'/api/tags'.length);
  const needsOpenAiPath = stack === 'ollama' || stack === 'llama.cpp' || stack === 'vllm' || stack === 'openai-compatible';
  if (needsOpenAiPath && (!pathname || pathname === '/')) pathname = '/v1';
  url.pathname = pathname || '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/g, '');
}

function modelsUrlFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/g, '')}/models`;
}

function localProviderNameFor(providerId: string | null, stack: string | null, fallback: string): string {
  const seed = providerId || stack || fallback;
  const normalized = seed.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'local-openai';
}

function localProviderAddRoute(providerId: string | null, stack: string | null, baseUrl: string): string {
  const name = localProviderNameFor(providerId, stack, 'local-openai');
  return `agent_harness mode:"run_command" command:"/provider add ${name} ${baseUrl} local --yes" confirm:true explicitUserRequest:"Add this local provider after the server is running."`;
}

function localEndpointId(baseUrl: string): string {
  return `local-${baseUrl.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

function localEndpointInspectRoute(endpointId: string): string {
  return `agent_harness mode:"model_route" modelRouteId:"${endpointId}"`;
}

function localEndpointDiagnostics(endpoint: MutableLocalModelServerEndpoint, providerExists: boolean): NonNullable<LocalModelServerEndpoint['diagnostics']> {
  const stack = endpoint.stack ?? 'OpenAI-compatible';
  return {
    liveProbe: 'not-run',
    successCriteria: [
      'The confirmed smoke command exits 0.',
      'The model-list endpoint returns JSON without credentials in output.',
      'At least one model id is visible before refresh or benchmark.',
    ],
    failureTriage: [
      `If connection is refused, start the ${stack} server and load a model before refreshing Agent models.`,
      'If the endpoint returns 404, verify the base URL path; most OpenAI-compatible servers should use /v1.',
      'If the host is 0.0.0.0 or a LAN address, switch Agent to a trusted client URL such as 127.0.0.1 or the intended private host.',
    ],
    afterSmoke: providerExists
      ? ['Run the refresh route, then run a local benchmark before changing the default route.']
      : ['Add the provider route only after smoke succeeds, then refresh models and run a local benchmark.'],
    policy: 'Diagnostics are read-only criteria and confirmed route hints. Agent does not probe the network, add providers, refresh models, benchmark, or change routes from this inspection.',
  };
}

function localModelServerDefaults(): readonly LocalModelServerDefaultEndpoint[] {
  const defaults = [
    {
      id: 'ollama',
      label: 'Ollama',
      stack: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      startHint: 'Start Ollama, pull a practical model, then refresh models.',
    },
    {
      id: 'lm-studio',
      label: 'LM Studio',
      stack: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1234/v1',
      startHint: 'Start the LM Studio local server and load one model.',
    },
    {
      id: 'llama-cpp',
      label: 'llama.cpp',
      stack: 'llama.cpp',
      baseUrl: 'http://127.0.0.1:8080/v1',
      startHint: 'Run llama-server with a GGUF model before adding the provider.',
    },
    {
      id: 'vllm',
      label: 'vLLM',
      stack: 'vllm',
      baseUrl: 'http://127.0.0.1:8000/v1',
      startHint: 'Start the vLLM OpenAI-compatible API server after GPU/driver checks.',
    },
  ] as const;
  return defaults.map((entry) => ({
    ...entry,
    modelsUrl: modelsUrlFor(entry.baseUrl),
    smokeCommand: `curl -fsS ${modelsUrlFor(entry.baseUrl)}`,
    addProviderRoute: localProviderAddRoute(null, entry.stack, entry.baseUrl),
  }));
}

function localRecipeStackId(recipe: LocalModelRecipe): string {
  return recipe.id === 'openai-compatible-local' ? 'openai-compatible' : recipe.id === 'llama-cpp' ? 'llama.cpp' : recipe.id;
}

function localModelDetection(context: CommandContext): LocalModelDetection {
  const providerIds = new Set<string>();
  const modelRoutes = new Set<string>();
  const stacks = new Set<string>();
  for (const providerId of listProviderIds(context)) {
    const stack = localStackFor(providerId);
    if (!stack) continue;
    providerIds.add(providerId);
    stacks.add(stack);
  }
  for (const model of listRegistryModels(context)) {
    const record = readRecord(model);
    const providerId = modelProviderId(model);
    const registryKey = modelRegistryKey(model);
    const fields = [
      providerId,
      registryKey,
      modelModelId(model),
      modelDisplayName(model),
      readString(record.description),
      readString(record.baseURL),
      readString(record.baseUrl),
      readString(record.serverType),
      JSON.stringify(record.providerEnvVars ?? ''),
    ].join('\n');
    const stack = localStackFor(fields);
    if (!stack) continue;
    if (providerId) providerIds.add(providerId);
    if (registryKey) modelRoutes.add(registryKey);
    stacks.add(stack);
  }
  return {
    providerIds: [...providerIds].sort((a, b) => a.localeCompare(b)),
    modelRoutes: [...modelRoutes].sort((a, b) => a.localeCompare(b)),
    stacks: [...stacks].sort((a, b) => a.localeCompare(b)),
  };
}

function addLocalServerEndpoint(
  endpoints: Map<string, MutableLocalModelServerEndpoint>,
  input: {
    readonly baseUrl: string;
    readonly providerId?: string | null;
    readonly stack?: string | null;
    readonly source: LocalModelEndpointSource;
    readonly sourceDetail: string;
    readonly modelRoutes?: readonly string[];
    readonly notes?: readonly string[];
  },
): void {
  const normalized = normalizeLocalBaseUrl(input.baseUrl, input.stack);
  if (!normalized) return;
  const stack = input.stack ?? localStackFor(input.baseUrl) ?? localStackFor(`${input.providerId ?? ''}\n${input.sourceDetail}`) ?? 'openai-compatible';
  const existing = endpoints.get(normalized);
  if (existing) {
    if (!existing.providerId && input.providerId) existing.providerId = input.providerId;
    if (!existing.stack && stack) existing.stack = stack;
    existing.sources.add(input.source);
    existing.sourceDetails.add(input.sourceDetail);
    for (const route of input.modelRoutes ?? []) existing.modelRoutes.add(route);
    for (const note of input.notes ?? []) existing.notes.add(note);
    return;
  }
  endpoints.set(normalized, {
    providerId: input.providerId ?? null,
    stack,
    baseUrl: normalized,
    sources: new Set([input.source]),
    sourceDetails: new Set([input.sourceDetail]),
    modelRoutes: new Set(input.modelRoutes ?? []),
    notes: new Set(input.notes ?? []),
  });
}

function collectLocalServerEndpointCandidates(context: CommandContext): readonly MutableLocalModelServerEndpoint[] {
  const endpoints = new Map<string, MutableLocalModelServerEndpoint>();
  for (const provider of listProviderRegistryProviders(context)) {
    const record = readRecord(provider);
    const providerId = readString(record.name) || readString(record.id) || readString(record.providerId) || readString(record.provider);
    const fields = [
      providerId,
      readString(record.label),
      readString(record.displayName),
      readString(record.description),
      readString(record.baseURL),
      readString(record.baseUrl),
      readString(record.endpoint),
      JSON.stringify(record.serviceNames ?? ''),
      JSON.stringify(record.envVars ?? ''),
    ].join('\n');
    const stack = localStackFor(fields);
    const routes = readProviderModels(record.models, providerId);
    const urls = [
      readString(record.baseURL),
      readString(record.baseUrl),
      readString(record.endpoint),
      ...extractUrls(fields),
    ].filter(Boolean);
    for (const baseUrl of urls) {
      addLocalServerEndpoint(endpoints, {
        baseUrl,
        providerId: providerId || null,
        stack: stack ?? localStackFor(baseUrl),
        source: 'provider-registry',
        sourceDetail: providerId ? `provider:${providerId}` : 'provider-registry',
        modelRoutes: routes,
        notes: providerId ? ['Provider already exists in the registry.'] : [],
      });
    }
  }

  for (const model of listRegistryModels(context)) {
    const record = readRecord(model);
    const providerId = modelProviderId(model);
    const registryKey = modelRegistryKey(model);
    const fields = [
      providerId,
      registryKey,
      modelModelId(model),
      modelDisplayName(model),
      readString(record.description),
      readString(record.baseURL),
      readString(record.baseUrl),
      readString(record.serverType),
      JSON.stringify(record.providerEnvVars ?? ''),
    ].join('\n');
    const stack = localStackFor(fields);
    const urls = [
      readString(record.baseURL),
      readString(record.baseUrl),
      readString(record.endpoint),
      ...extractUrls(readString(record.description)),
    ].filter(Boolean);
    for (const baseUrl of urls) {
      addLocalServerEndpoint(endpoints, {
        baseUrl,
        providerId: providerId || null,
        stack: stack ?? localStackFor(baseUrl),
        source: 'model-registry',
        sourceDetail: registryKey ? `model:${registryKey}` : 'model-registry',
        modelRoutes: registryKey ? [registryKey] : [],
        notes: registryKey ? ['At least one model route is already registered for this endpoint.'] : [],
      });
    }
  }

  const envHints: readonly { readonly key: string; readonly stack: string; readonly note: string }[] = [
    { key: 'OLLAMA_BASE_URL', stack: 'ollama', note: 'Environment override for the Ollama base URL.' },
    { key: 'OLLAMA_HOST', stack: 'ollama', note: 'Environment override for the Ollama host.' },
    { key: 'LM_STUDIO_BASE_URL', stack: 'openai-compatible', note: 'Environment override for LM Studio.' },
    { key: 'OPENAI_COMPATIBLE_BASE_URL', stack: 'openai-compatible', note: 'Environment override for a local OpenAI-compatible server.' },
    { key: 'OPENAI_COMPAT_BASE_URL', stack: 'openai-compatible', note: 'Environment override for a local OpenAI-compatible server.' },
    { key: 'VLLM_BASE_URL', stack: 'vllm', note: 'Environment override for vLLM.' },
    { key: 'LLAMA_CPP_BASE_URL', stack: 'llama.cpp', note: 'Environment override for llama.cpp.' },
    { key: 'LITELLM_BASE_URL', stack: 'openai-compatible', note: 'Environment override for LiteLLM or a local gateway.' },
  ];
  for (const hint of envHints) {
    const value = readString(process.env[hint.key]);
    if (!value) continue;
    addLocalServerEndpoint(endpoints, {
      baseUrl: value,
      stack: hint.stack,
      source: 'environment',
      sourceDetail: `env:${hint.key}`,
      notes: [hint.note],
    });
  }

  return [...endpoints.values()].sort((left, right) => left.baseUrl.localeCompare(right.baseUrl));
}

function describeLocalServerEndpoint(endpoint: MutableLocalModelServerEndpoint, includeParameters = false): LocalModelServerEndpoint {
  const modelsUrl = modelsUrlFor(endpoint.baseUrl);
  const providerExists = Boolean(endpoint.providerId) || endpoint.modelRoutes.size > 0;
  const notes = new Set(endpoint.notes);
  if (endpoint.baseUrl.includes('0.0.0.0')) {
    notes.add('0.0.0.0 is usually a listen address; prefer 127.0.0.1 or a trusted LAN host for the client provider URL.');
  }
  if (!providerExists) {
    notes.add('No registered model route was found for this endpoint yet.');
  }
  const id = localEndpointId(endpoint.baseUrl);
  return {
    kind: 'local-server-endpoint',
    id,
    providerId: endpoint.providerId,
    stack: endpoint.stack,
    baseUrl: endpoint.baseUrl,
    modelsUrl,
    diagnosticStatus: providerExists ? 'registered-route-needs-smoke' : 'needs-provider-after-smoke',
    inspectRoute: localEndpointInspectRoute(id),
    sources: [...endpoint.sources].sort((a, b) => a.localeCompare(b)),
    sourceDetails: [...endpoint.sourceDetails].sort((a, b) => a.localeCompare(b)),
    modelRoutes: [...endpoint.modelRoutes].sort((a, b) => a.localeCompare(b)),
    smokeCommand: `curl -fsS ${modelsUrl}`,
    smokeRoute: `agent_harness mode:"run_command" command:"curl -fsS ${modelsUrl}" confirm:true explicitUserRequest:"Smoke test this local model server."`,
    refreshRoute: 'agent_harness mode:"run_command" command:"/refresh-models" confirm:true explicitUserRequest:"Refresh models after verifying the local server."',
    addProviderRoute: providerExists ? null : localProviderAddRoute(endpoint.providerId, endpoint.stack, endpoint.baseUrl),
    notes: [...notes],
    ...(includeParameters ? { diagnostics: localEndpointDiagnostics(endpoint, providerExists) } : {}),
  };
}

function localModelServerHealthMap(
  context: CommandContext,
  includeParameters: boolean,
): LocalModelServerHealthMap {
  const endpoints = collectLocalServerEndpointCandidates(context).map((endpoint) => describeLocalServerEndpoint(endpoint, includeParameters));
  const returned = endpoints.slice(0, includeParameters ? 8 : 3);
  const suggestedDefaults = localModelServerDefaults().slice(0, includeParameters ? 4 : 2);
  const first = returned[0];
  return {
    status: endpoints.length > 0 ? 'candidate-endpoints' : 'no-local-endpoints',
    liveProbe: 'not-run',
    endpointCount: endpoints.length,
    returnedEndpoints: returned.length,
    endpoints: returned,
    suggestedDefaults,
    nextActions: endpoints.length > 0
      ? [
        `Smoke test ${first?.modelsUrl ?? 'the detected model-list endpoint'} before benchmark or route changes.`,
        'Refresh the model catalog after the local server is running and reachable.',
        'Run the local benchmark comparison before making a local route the default.',
      ]
      : [
        'Start one local server from suggestedDefaults, then smoke test its model-list endpoint.',
        'Add or select the provider route only after the server is reachable.',
        'Refresh models and run the local benchmark before changing the default route.',
      ],
    policy: 'Read-only local endpoint map. It derives candidate model-list URLs, smoke commands, and confirmed route hints from registry/env metadata; it does not probe the network, install servers, download models, add providers, refresh models, benchmark, or change routes.',
  };
}

function roundGb(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.max(0, Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10);
}

function localHardwareProfile(): LocalModelHardwareProfile {
  const cpuList = cpus();
  const ramGb = roundGb(totalmem());
  const freeRamGb = roundGb(freemem());
  const runtimePlatform = platform();
  const runtimeArch = arch();
  const acceleratorHint = runtimePlatform === 'darwin' && runtimeArch === 'arm64'
    ? 'apple-silicon'
    : (process.env.CUDA_VISIBLE_DEVICES || process.env.NVIDIA_VISIBLE_DEVICES)
      ? 'cuda-env'
      : 'none-detected';
  return {
    platform: runtimePlatform,
    arch: runtimeArch,
    cpuModel: previewHarnessText(cpuList[0]?.model ?? 'unknown CPU', 96),
    cpuThreads: cpuList.length,
    ramGb,
    freeRamGb,
    memoryTier: ramGb >= 64 ? 'large' : ramGb >= 32 ? 'comfortable' : ramGb >= 16 ? 'starter' : 'constrained',
    acceleratorHint,
    privacy: 'local-only',
    caveat: 'Hardware scan uses local OS memory/CPU data and safe accelerator hints only; it does not probe drivers, download models, or benchmark live inference.',
  };
}

function fitLevel(score: number): LocalModelRecipeFit['level'] {
  if (score >= 85) return 'strong';
  if (score >= 70) return 'good';
  if (score >= 50) return 'usable';
  return 'weak';
}

function clampFit(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function modelReadinessLevel(score: number): ModelReadinessScore['level'] {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'usable';
  return 'risky';
}

function capabilityEnabled(capabilities: unknown, key: 'toolCalling' | 'multimodal'): boolean | null {
  const value = readRecord(capabilities)[key];
  if (typeof value === 'boolean') return value;
  return null;
}

function isLocalCandidate(fields: readonly string[]): boolean {
  return fields.some((field) => Boolean(localStackFor(field)));
}

function contextWindowScore(contextWindow: number | null): ModelReadinessDimension {
  const score = contextWindow == null
    ? 45
    : contextWindow >= 128_000
      ? 100
      : contextWindow >= 64_000
        ? 88
        : contextWindow >= 32_000
          ? 76
          : contextWindow >= 16_000
            ? 62
            : 45;
  return {
    id: 'context-window',
    label: 'Context window',
    score,
    weight: 20,
    summary: contextWindow == null
      ? 'No context-window metadata; inspect the provider route before long-context work.'
      : `${contextWindow.toLocaleString()} token context window.`,
  };
}

function toolSupportScore(capabilities: unknown): ModelReadinessDimension {
  const enabled = capabilityEnabled(capabilities, 'toolCalling');
  return {
    id: 'tool-support',
    label: 'Tool support',
    score: enabled === true ? 100 : enabled === false ? 35 : 55,
    weight: 20,
    summary: enabled === true
      ? 'Tool calling is advertised.'
      : enabled === false
        ? 'Tool calling is not advertised; use for chat or drafting, not autonomous tool workflows.'
        : 'Tool-calling support is unknown; inspect the provider before tool-heavy work.',
  };
}

function visionScore(capabilities: unknown): ModelReadinessDimension {
  const enabled = capabilityEnabled(capabilities, 'multimodal');
  return {
    id: 'vision',
    label: 'Vision',
    score: enabled === true ? 100 : enabled === false ? 45 : 55,
    weight: 10,
    summary: enabled === true
      ? 'Vision or multimodal input is advertised.'
      : enabled === false
        ? 'Vision is not advertised; avoid image/screen-heavy work on this route.'
        : 'Vision support is unknown.',
  };
}

function costScore(tier: string | undefined, local: boolean): ModelReadinessDimension {
  const normalized = (tier ?? '').toLowerCase();
  const score = local
    ? 100
    : normalized === 'free'
      ? 95
      : normalized === 'subscription'
        ? 86
        : normalized === 'standard'
          ? 72
          : normalized === 'premium'
            ? 55
            : 62;
  return {
    id: 'cost',
    label: 'Cost',
    score,
    weight: 15,
    summary: local
      ? 'Local route; marginal token cost is user hardware and power.'
      : tier
        ? `${tier} tier route.`
        : 'Cost tier is unknown; inspect provider pricing before long runs.',
  };
}

function privacyScore(local: boolean, providerId: string): ModelReadinessDimension {
  const normalized = providerId.toLowerCase();
  const score = local
    ? 100
    : /subscription|account|openrouter|openai|anthropic|google|gemini|xai|mistral|cohere/.test(normalized)
      ? 48
      : 60;
  return {
    id: 'privacy',
    label: 'Privacy',
    score,
    weight: 15,
    summary: local
      ? 'Local/private route detected.'
      : 'Cloud/provider route; treat sensitive data according to provider policy.',
  };
}

function latencyScore(local: boolean, benchmarkCompositeScore: number | null | undefined): ModelReadinessDimension {
  const score = local
    ? 55
    : benchmarkCompositeScore != null
      ? 78
      : 70;
  return {
    id: 'latency',
    label: 'Latency',
    score,
    weight: 20,
    summary: local
      ? 'Local latency is unmeasured until the user runs the benchmark prompt on this machine.'
      : benchmarkCompositeScore != null
        ? 'No live latency sample, but the route has benchmark metadata for quality context.'
        : 'No live latency sample; assume normal provider latency until measured.',
  };
}

function weightedReadiness(dimensions: readonly ModelReadinessDimension[]): number {
  const totalWeight = dimensions.reduce((total, dimension) => total + dimension.weight, 0);
  if (totalWeight <= 0) return 0;
  return clampFit(dimensions.reduce((total, dimension) => total + (dimension.score * dimension.weight), 0) / totalWeight);
}

function modelReadinessScore(model: ModelCandidate): ModelReadinessScore {
  const local = isLocalCandidate([model.providerId, model.registryKey, model.modelId, model.displayName]);
  const dimensions: readonly ModelReadinessDimension[] = [
    latencyScore(local, model.benchmarkCompositeScore),
    contextWindowScore(model.contextWindow),
    toolSupportScore(model.capabilities),
    visionScore(model.capabilities),
    costScore(model.tier, local),
    privacyScore(local, model.providerId),
  ];
  const score = weightedReadiness(dimensions);
  const missingSignals = [
    'No live latency benchmark has been recorded for this Agent route.',
    ...(model.contextWindow == null ? ['Context-window metadata is missing.'] : []),
    ...(capabilityEnabled(model.capabilities, 'toolCalling') == null ? ['Tool-calling support is unknown.'] : []),
    ...(capabilityEnabled(model.capabilities, 'multimodal') == null ? ['Vision support is unknown.'] : []),
    ...(!model.tier && !local ? ['Cost tier is unknown.'] : []),
  ];
  return {
    score,
    level: modelReadinessLevel(score),
    confidence: missingSignals.length === 0 ? 'metadata-backed' : 'estimated',
    dimensions,
    missingSignals,
    nextStep: local
      ? 'Run the local benchmark prompt before making this route the default.'
      : 'Use this score for routing triage; run a task-specific comparison before changing the default model.',
  };
}

function localRecipeReadinessScore(
  recipe: LocalModelRecipe,
  fit: LocalModelRecipeFit,
  detected: boolean,
  evidence: LocalModelBenchmarkEvidence,
): ModelReadinessScore {
  const contextScore = recipe.id === 'vllm' ? 70 : recipe.id === 'openai-compatible-local' ? 60 : 65;
  const toolScore = recipe.id === 'ollama' || recipe.id === 'openai-compatible-local' ? 70 : 55;
  const visionSupport = recipe.modelExamples.some((model) => /vision|vl|multimodal/i.test(model));
  const reviewedWinner = evidence.winnerStacks.includes(localRecipeStackId(recipe));
  const measured = evidence.comparisonCount > 0;
  const dimensions: readonly ModelReadinessDimension[] = [
    {
      id: 'latency',
      label: 'Latency',
      score: reviewedWinner ? 82 : measured ? 68 : detected ? 62 : 50,
      weight: 20,
      summary: reviewedWinner
        ? 'A revealed saved local benchmark judgment selected this stack.'
        : measured
          ? 'A saved local benchmark comparison exists, but no revealed winner is tied to this stack yet.'
          : detected
            ? 'Local stack is detected, but latency still needs an on-machine benchmark.'
            : 'Latency is unknown until the local server and model are running.',
    },
    {
      id: 'context-window',
      label: 'Context window',
      score: contextScore,
      weight: 20,
      summary: 'Depends on the selected local model and serving stack; verify after the route is available.',
    },
    {
      id: 'tool-support',
      label: 'Tool support',
      score: toolScore,
      weight: 20,
      summary: 'Tool behavior depends on the selected local model and OpenAI-compatible server support.',
    },
    {
      id: 'vision',
      label: 'Vision',
      score: visionSupport ? 75 : 45,
      weight: 10,
      summary: visionSupport ? 'Example list includes a vision-capable route.' : 'No vision route is assumed for this local recipe.',
    },
    {
      id: 'cost',
      label: 'Cost',
      score: 100,
      weight: 15,
      summary: 'Local route; marginal token cost is user hardware and power.',
    },
    {
      id: 'privacy',
      label: 'Privacy',
      score: 100,
      weight: 15,
      summary: 'Local route can keep prompts on user-controlled hardware.',
    },
  ];
  const score = clampFit((weightedReadiness(dimensions) * 0.72) + (fit.score * 0.28));
  return {
    score,
    level: modelReadinessLevel(score),
    confidence: reviewedWinner ? 'measured' : 'estimated',
    dimensions,
    missingSignals: [
      ...(measured ? [] : ['No live latency benchmark has been recorded for this local recipe.']),
      ...(reviewedWinner ? [] : ['No revealed local benchmark judgment has selected this recipe yet.']),
      'Context window, tool support, and vision support depend on the exact model served.',
    ],
    nextStep: reviewedWinner
      ? 'Review the saved benchmark judgment, then use a separate confirmed apply/update route only if the user wants this winner as the default.'
      : measured
        ? 'Review the saved comparison and save a revealed judgment before recommending a default-model change.'
        : 'Start the local server, refresh models, then run the setupPlan benchmark action before changing the default model.',
  };
}

function scoreLocalModelRecipe(
  recipe: LocalModelRecipe,
  hardware: LocalModelHardwareProfile,
  detection: LocalModelDetection,
): LocalModelRecipeFit {
  const stackId = localRecipeStackId(recipe);
  const detected = detection.stacks.includes(stackId);
  const reasons: string[] = [];
  let score = 45;
  if (detected) {
    score += 18;
    reasons.push('matching local provider or model route already detected');
  }
  if (recipe.id === 'ollama') {
    score += 20;
    reasons.push('lowest setup friction for most local users');
    if (hardware.ramGb >= 16) {
      score += 12;
      reasons.push(`${hardware.ramGb} GB RAM is enough for practical 7B/8B quantized models`);
    } else {
      score -= 10;
      reasons.push('RAM is below the comfortable 16 GB local-model baseline');
    }
    if (hardware.acceleratorHint === 'apple-silicon') {
      score += 10;
      reasons.push('Apple Silicon is a good Ollama path');
    }
  } else if (recipe.id === 'llama-cpp') {
    score += 16;
    reasons.push('best offline fallback when downloads and serving stay manual');
    if (hardware.ramGb >= 8) {
      score += 10;
      reasons.push('can use smaller GGUF quantized models within available system memory');
    }
    if (hardware.acceleratorHint === 'apple-silicon') {
      score += 8;
      reasons.push('Metal-backed llama.cpp is a strong local path on Apple Silicon');
    }
  } else if (recipe.id === 'vllm') {
    score += hardware.acceleratorHint === 'cuda-env' ? 30 : -12;
    reasons.push(hardware.acceleratorHint === 'cuda-env'
      ? 'CUDA environment hints are present'
      : 'no CUDA hint was detected; vLLM may still work, but requires GPU/driver verification');
    if (hardware.ramGb >= 32) {
      score += 10;
      reasons.push('system memory is comfortable for GPU serving overhead');
    }
  } else {
    score += detected ? 10 : 4;
    reasons.push(detected
      ? 'existing OpenAI-compatible local route can be reused'
      : 'useful when the user already runs LM Studio, LocalAI, TGI, or another local endpoint');
  }
  if (hardware.cpuThreads >= 8 && recipe.id !== 'vllm') {
    score += 5;
    reasons.push(`${hardware.cpuThreads} CPU threads help local inference`);
  }
  const finalScore = clampFit(score);
  return {
    score: finalScore,
    level: fitLevel(finalScore),
    reasons,
  };
}

function isLocalModelBenchmarkArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = readString(artifact.metadata.purpose);
  if (purpose !== 'agent-model-compare') return false;
  if (readString(artifact.metadata.benchmarkKind) === 'local-model-route') return true;
  const promptPreview = readString(artifact.metadata.promptPreview).toLowerCase();
  return promptPreview.includes('local model benchmark') || promptPreview.includes('benchmark this local route');
}

function isModelCompareJudgmentArtifact(artifact: ArtifactDescriptor): boolean {
  return readString(artifact.metadata.purpose) === 'agent-model-compare-judgment';
}

function benchmarkCreatedAt(artifact: ArtifactDescriptor): string | null {
  const timestamp = typeof artifact.createdAt === 'number' ? artifact.createdAt : null;
  return timestamp == null ? null : new Date(timestamp).toISOString();
}

function describeLocalBenchmarkArtifact(artifact: ArtifactDescriptor): Record<string, unknown> {
  return {
    artifactId: artifact.id,
    ...(artifact.filename ? { filename: artifact.filename } : {}),
    createdAt: benchmarkCreatedAt(artifact),
    comparisonId: readString(artifact.metadata.comparisonId) || null,
    promptPreview: previewHarnessText(readString(artifact.metadata.promptPreview) || 'local model benchmark', 120),
    candidateCount: artifact.metadata.candidateCount ?? null,
    completedCandidates: artifact.metadata.completedCandidates ?? null,
    benchmarkKind: readString(artifact.metadata.benchmarkKind) || 'local-model-route',
    reviewRoute: `agent_model_compare review artifactId:"${artifact.id}"`,
    revealRoute: `agent_model_compare reveal artifactId:"${artifact.id}"`,
  };
}

function describeLocalBenchmarkJudgment(artifact: ArtifactDescriptor): Record<string, unknown> {
  const winnerModel = readString(artifact.metadata.winnerModel);
  const sourceArtifactId = readString(artifact.metadata.sourceArtifactId);
  return {
    artifactId: artifact.id,
    ...(artifact.filename ? { filename: artifact.filename } : {}),
    createdAt: benchmarkCreatedAt(artifact),
    judgmentId: readString(artifact.metadata.judgmentId) || null,
    comparisonId: readString(artifact.metadata.comparisonId) || null,
    sourceArtifactId: sourceArtifactId || null,
    winnerBlindId: readString(artifact.metadata.winnerBlindId) || null,
    revealIncludedInJudgment: artifact.metadata.revealIncludedInJudgment === true,
    winnerModel: winnerModel || null,
    winnerStack: winnerModel ? localStackFor(winnerModel) : null,
    promptPreview: previewHarnessText(readString(artifact.metadata.promptPreview) || 'local model benchmark judgment', 120),
    analyticsRoute: 'agent_model_compare analytics benchmarkKind:"local-model-route" includeReasons:true',
    exportRoute: `agent_model_compare export artifactId:"${artifact.id}" confirm:true explicitUserRequest:"Export this local benchmark judgment."`,
    applyRoute: winnerModel
      ? `agent_model_compare apply artifactId:"${artifact.id}" confirm:true explicitUserRequest:"Apply this revealed local benchmark winner."`
      : null,
  };
}

function localBenchmarkEvidence(
  comparisons: readonly ArtifactDescriptor[],
  judgments: readonly ArtifactDescriptor[],
  storeAvailable: boolean,
): LocalModelBenchmarkEvidence {
  if (!storeAvailable) {
    return {
      status: 'unavailable',
      comparisonCount: 0,
      completedCandidateCount: 0,
      revealedJudgmentCount: 0,
      hiddenJudgmentCount: 0,
      winnerStacks: [],
      winnerModels: [],
      summary: 'Artifact history is unavailable in this runtime.',
      confidence: 'estimated',
    };
  }
  const winnerModels: LocalModelBenchmarkWinner[] = [];
  let hiddenJudgmentCount = 0;
  for (const judgment of judgments) {
    const winnerModel = readString(judgment.metadata.winnerModel);
    if (!winnerModel) {
      hiddenJudgmentCount += 1;
      continue;
    }
    const sourceArtifactId = readString(judgment.metadata.sourceArtifactId);
    winnerModels.push({
      judgmentArtifactId: judgment.id,
      sourceArtifactId: sourceArtifactId || null,
      registryKey: winnerModel,
      stack: localStackFor(winnerModel),
      promptPreview: previewHarnessText(readString(judgment.metadata.promptPreview) || 'local model benchmark judgment', 120),
      reviewRoute: sourceArtifactId
        ? `agent_model_compare review artifactId:"${sourceArtifactId}"`
        : 'agent_model_compare review',
      exportRoute: `agent_model_compare export artifactId:"${judgment.id}" confirm:true explicitUserRequest:"Export this local benchmark judgment."`,
      applyRoute: `agent_model_compare apply artifactId:"${judgment.id}" confirm:true explicitUserRequest:"Apply this revealed local benchmark winner."`,
    });
  }
  const winnerStacks = [...new Set(winnerModels.map((winner) => winner.stack).filter((stack): stack is string => Boolean(stack)))].sort((a, b) => a.localeCompare(b));
  const completedCandidateCount = comparisons.reduce((total, artifact) => {
    const value = artifact.metadata.completedCandidates;
    return total + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  }, 0);
  const status: LocalModelBenchmarkEvidence['status'] = winnerModels.length > 0
    ? 'reviewed-winner'
    : comparisons.length > 0
      ? 'comparison-saved'
      : 'unmeasured';
  return {
    status,
    comparisonCount: comparisons.length,
    completedCandidateCount,
    revealedJudgmentCount: winnerModels.length,
    hiddenJudgmentCount,
    winnerStacks,
    winnerModels,
    summary: winnerModels.length > 0
      ? `Reviewed benchmark winner(s): ${winnerModels.map((winner) => winner.registryKey).join(', ')}.`
      : comparisons.length > 0
        ? 'Saved local benchmark comparison exists; save a revealed judgment before route recommendations.'
        : 'No saved local benchmark comparison has been recorded yet.',
    confidence: winnerModels.length > 0 ? 'measured' : 'estimated',
  };
}

function localModelBenchmarkHistory(context: CommandContext, includeParameters: boolean): Record<string, unknown> {
  const store = readArtifactStore(context);
  if (!store?.list) {
    const evidence = localBenchmarkEvidence([], [], false);
    return {
      status: 'unavailable',
      count: 0,
      reason: 'Artifact history is unavailable in this runtime.',
      saveRoute: 'agent_model_compare run benchmarkKind:"local-model-route" taskType:"local-model-route" confirm:true explicitUserRequest:"..."',
      evidence,
    };
  }
  const allArtifacts = store.list(100);
  const artifacts = allArtifacts.filter(isLocalModelBenchmarkArtifact)
    .slice(0, includeParameters ? 10 : 3);
  const localComparisonIds = new Set(artifacts.map((artifact) => artifact.id));
  const judgments = allArtifacts
    .filter((artifact) => {
      if (!isModelCompareJudgmentArtifact(artifact)) return false;
      const sourceArtifactId = readString(artifact.metadata.sourceArtifactId);
      if (sourceArtifactId && localComparisonIds.has(sourceArtifactId)) return true;
      return readString(artifact.metadata.promptPreview).toLowerCase().includes('local model benchmark');
    })
    .slice(0, includeParameters ? 10 : 3);
  const evidence = localBenchmarkEvidence(artifacts, judgments, true);
  return {
    status: artifacts.length > 0 ? 'history-found' : 'no-history',
    count: artifacts.length,
    artifacts: artifacts.map(describeLocalBenchmarkArtifact),
    judgments: judgments.map(describeLocalBenchmarkJudgment),
    evidence,
    nextAction: artifacts.length > 0
      ? evidence.status === 'reviewed-winner'
        ? 'Use the revealed saved judgment as evidence only; apply/update still needs a separate confirmed user request.'
        : `Review saved local benchmark ${artifacts[0]!.id}, then save a revealed judgment before recommending any default-model change.`
      : 'Run the setupPlan benchmark prompt and save the comparison artifact before recommending any default-model change.',
    analyticsRoute: 'agent_model_compare analytics benchmarkKind:"local-model-route" includeReasons:true',
    saveRoute: 'agent_model_compare run benchmarkKind:"local-model-route" taskType:"local-model-route" confirm:true explicitUserRequest:"..."',
    policy: 'Benchmark history is read-only evidence. Route changes still require a separate revealed judgment and confirmed apply/update action.',
  };
}

function localModelBenchmarkPlan(recipe: LocalModelRecipe): LocalModelBenchmarkPlan {
  return {
    status: 'plan-ready',
    prompt: [
      'Benchmark this local route on one practical task:',
      '1. summarize the current project goal in five bullets,',
      '2. identify one likely setup risk,',
      '3. propose one next action with a command or route.',
    ].join(' '),
    measurements: [
      'time to first useful token',
      'total response latency',
      'whether the answer followed the requested structure',
      'whether the model handled project-specific nouns without hallucinating',
      'whether the route supports the needed context window and tool workflow',
    ],
    workspaceActionRoute: 'agent_harness mode:"run_workspace_action" actionId:"account-run-local-model-benchmark" confirm:true fields.confirm:"yes" fields.modelRefs:"<local-route>,<baseline-route>" explicitUserRequest:"Compare this local model route before making it default."',
    compareRoute: `agent_model_compare run prompt:"local model benchmark: ${recipe.label}" benchmarkKind:"local-model-route" taskType:"local-model-route" confirm:true explicitUserRequest:"Compare this local model route before making it default."`,
    refreshRoute: 'agent_harness mode:"run_command" command:"/refresh-models" confirm:true explicitUserRequest:"Refresh model catalog, benchmarks, and token limits after local model setup."',
    notes: [
      'Use the workspace action when the user wants a form with benchmark defaults; use compareRoute when the model already has exact modelRefs.',
      'Run the same prompt against the local route and a baseline route before selecting a winner.',
      'Keep benchmark notes in the saved comparison artifact before changing the default model.',
      'Do not treat cached public benchmark scores as a substitute for this local latency and fit check.',
    ],
  };
}

function localModelDownloadGuidance(recipe: LocalModelRecipe, hardware: LocalModelHardwareProfile): readonly string[] {
  if (recipe.id === 'ollama') {
    const model = hardware.ramGb >= 32 ? 'qwen2.5-coder:14b' : 'qwen2.5-coder:7b';
    return [
      'Install Ollama from the vendor package or package manager.',
      'Start the Ollama service before refreshing Agent models.',
      `Suggested first pull: ollama pull ${model}`,
      `Smoke test: ollama run ${model} "Say ready in one sentence."`,
    ];
  }
  if (recipe.id === 'llama-cpp') {
    return [
      'Choose a GGUF model that fits available RAM; prefer Q4/Q5 quantization on constrained systems.',
      'Download the GGUF from the model publisher or a trusted mirror.',
      'Start an OpenAI-compatible server: llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080',
      'Smoke test the /v1/models endpoint before adding the provider route.',
    ];
  }
  if (recipe.id === 'vllm') {
    return [
      'Verify CUDA driver, GPU memory, and Python environment before installing vLLM.',
      'Install vLLM in an isolated environment.',
      'Serve a small first model: python -m vllm.entrypoints.openai.api_server --model Qwen/Qwen2.5-Coder-7B-Instruct --host 127.0.0.1 --port 8000',
      'Smoke test /v1/models before adding the provider route.',
    ];
  }
  return [
    'Start the local OpenAI-compatible server in its own app or service.',
    'Confirm the server exposes /v1/models and a private localhost or trusted LAN base URL.',
    'Use the server app to download or load the model before adding it to Agent.',
    'Keep LAN endpoints private unless the user explicitly intends shared access.',
  ];
}

function localModelProviderRoutes(recipe: LocalModelRecipe): readonly string[] {
  if (recipe.id === 'ollama') {
    return [
      'agent_harness mode:"open_ui_surface" surfaceId:"provider-picker" confirm:true explicitUserRequest:"Select the discovered Ollama route."',
      'agent_harness mode:"run_command" command:"/refresh-models" confirm:true explicitUserRequest:"Refresh models after starting Ollama."',
    ];
  }
  if (recipe.id === 'llama-cpp') {
    return [
      'agent_harness mode:"run_command" command:"/provider add llama-cpp-local http://127.0.0.1:8080/v1 local --yes" confirm:true explicitUserRequest:"Add a local llama.cpp OpenAI-compatible provider."',
      'agent_harness mode:"run_command" command:"/refresh-models" confirm:true explicitUserRequest:"Refresh models after starting llama.cpp."',
    ];
  }
  if (recipe.id === 'vllm') {
    return [
      'agent_harness mode:"run_command" command:"/provider add vllm-local http://127.0.0.1:8000/v1 local --yes" confirm:true explicitUserRequest:"Add a local vLLM OpenAI-compatible provider."',
      'agent_harness mode:"run_command" command:"/refresh-models" confirm:true explicitUserRequest:"Refresh models after starting vLLM."',
    ];
  }
  return [
    'agent_harness mode:"run_command" command:"/provider add local-openai http://127.0.0.1:1234/v1 local --yes" confirm:true explicitUserRequest:"Add a local OpenAI-compatible provider."',
    'agent_harness mode:"run_command" command:"/refresh-models" confirm:true explicitUserRequest:"Refresh models after starting the local server."',
  ];
}

function localModelSetupPlan(
  recipe: LocalModelRecipe,
  hardware: LocalModelHardwareProfile,
  detection: LocalModelDetection,
  fit: LocalModelRecipeFit,
): LocalModelSetupPlan {
  const stackId = localRecipeStackId(recipe);
  const detected = detection.stacks.includes(stackId);
  return {
    status: detected ? 'detected' : fit.level === 'weak' ? 'needs-hardware-review' : 'ready-to-try',
    priority: fit.score,
    downloadGuidance: localModelDownloadGuidance(recipe, hardware),
    providerRoutes: localModelProviderRoutes(recipe),
    benchmarkPlan: localModelBenchmarkPlan(recipe),
    confirmationBoundary: 'The plan is read-only guidance. Installs, downloads, server starts, provider edits, refreshes, comparisons, and route changes require explicit user action or confirmation.',
  };
}

function localModelRecipes(): readonly LocalModelRecipe[] {
  return [
    {
      id: 'ollama',
      label: 'Ollama',
      fit: 'Best first local route for most users.',
      bestFor: 'Fast setup, chat, coding help, private everyday assistant work.',
      hardware: 'Usable on modern CPU or Apple Silicon; 16 GB RAM is comfortable for 7B/8B quantized models, 32 GB+ for 14B/32B.',
      setup: [
        'Install Ollama and start the local service.',
        'Pull one practical model, such as qwen2.5-coder:7b or llama3.1:8b.',
        'Refresh models in GoodVibes Agent, then choose the discovered ollama:<model> route.',
      ],
      modelExamples: ['qwen2.5-coder:7b', 'llama3.1:8b', 'mistral:7b'],
      cautions: ['Large models may run slowly without enough memory.', 'Use vLLM instead when the goal is multi-user throughput.'],
    },
    {
      id: 'llama-cpp',
      label: 'llama.cpp',
      fit: 'Best low-dependency offline route.',
      bestFor: 'CPU/Metal inference, GGUF files, portable offline use, constrained machines.',
      hardware: 'Works without a GPU; use Q4/Q5 GGUF files for small systems and larger quantization only when memory allows.',
      setup: [
        'Download a GGUF model that fits memory.',
        'Run llama-server with an OpenAI-compatible endpoint.',
        'Add or refresh the local OpenAI-compatible provider, then select it in the model picker.',
      ],
      modelExamples: ['Qwen2.5-Coder 7B Instruct GGUF', 'Llama 3.1 8B Instruct GGUF', 'Phi-3 Mini GGUF'],
      cautions: ['Manual model-file choice matters more than with Ollama.', 'Throughput is lower than GPU serving.'],
    },
    {
      id: 'vllm',
      label: 'vLLM',
      fit: 'Best high-throughput local or LAN server route.',
      bestFor: 'NVIDIA GPU serving, batching, OpenAI-compatible APIs, team/shared local models.',
      hardware: 'Prefer CUDA GPUs; 16 GB VRAM can serve small quantized models, 24-48 GB+ is better for larger coder models.',
      setup: [
        'Install vLLM in a CUDA-ready Python environment.',
        'Serve a model with the OpenAI-compatible API server.',
        'Add the endpoint as a custom provider and select that route.',
      ],
      modelExamples: ['Qwen2.5-Coder 7B Instruct', 'Llama 3.1 8B Instruct', 'DeepSeek Coder V2 Lite'],
      cautions: ['Not the easiest first setup.', 'GPU drivers and model memory limits are the common failure points.'],
    },
    {
      id: 'openai-compatible-local',
      label: 'Local OpenAI-compatible server',
      fit: 'Best when the user already has LM Studio, LocalAI, TGI, or another local endpoint.',
      bestFor: 'Reusing an existing localhost or LAN model server through one familiar API.',
      hardware: 'Depends on the server backend; verify context window and memory in the serving app first.',
      setup: [
        'Start the local server and confirm its /v1/models endpoint works.',
        'Add a custom provider with the local base URL.',
        'Refresh models and select the discovered route.',
      ],
      modelExamples: ['LM Studio loaded model', 'LocalAI model', 'TGI-served model'],
      cautions: ['Some servers omit context-window metadata.', 'Keep LAN endpoints private unless explicitly intended.'],
    },
  ];
}

function describeLocalModelRecipe(
  recipe: LocalModelRecipe,
  detection: LocalModelDetection,
  hardware: LocalModelHardwareProfile,
  benchmarkEvidence: LocalModelBenchmarkEvidence,
  includeParameters: boolean,
): Record<string, unknown> {
  const stackId = localRecipeStackId(recipe);
  const detected = detection.stacks.includes(stackId);
  const fit = scoreLocalModelRecipe(recipe, hardware, detection);
  const readiness = localRecipeReadinessScore(recipe, fit, detected, benchmarkEvidence);
  return {
    id: recipe.id,
    label: recipe.label,
    fit: recipe.fit,
    fitScore: fit.score,
    fitLevel: fit.level,
    readinessScore: readiness.score,
    readinessLevel: readiness.level,
    readiness: includeParameters
      ? readiness
      : {
        score: readiness.score,
        level: readiness.level,
        confidence: readiness.confidence,
        nextStep: readiness.nextStep,
      },
    bestFor: recipe.bestFor,
    hardware: previewHarnessText(recipe.hardware, includeParameters ? 180 : 96),
    hardwareMatched: fit.reasons.slice(0, includeParameters ? 6 : 3),
    detected,
    modelRoute: 'agent_harness mode:"model_routing" or mode:"open_ui_surface"',
    ...(includeParameters ? {
      setup: recipe.setup,
      modelExamples: recipe.modelExamples,
      cautions: recipe.cautions,
      setupPlan: localModelSetupPlan(recipe, hardware, detection, fit),
    } : {}),
  };
}

export function localModelCookbook(context: CommandContext, includeParameters: boolean): Record<string, unknown> {
  const detection = localModelDetection(context);
  const hardwareProfile = localHardwareProfile();
  const benchmarkHistory = localModelBenchmarkHistory(context, includeParameters);
  const benchmarkEvidence = readRecord(benchmarkHistory.evidence) as unknown as LocalModelBenchmarkEvidence;
  const localServerHealth = localModelServerHealthMap(context, includeParameters);
  const recipes = localModelRecipes()
    .map((recipe) => describeLocalModelRecipe(recipe, detection, hardwareProfile, benchmarkEvidence, includeParameters))
    .sort((left, right) => Number(readRecord(right).fitScore ?? 0) - Number(readRecord(left).fitScore ?? 0));
  const topRecipe = readRecord(recipes[0]);
  const topLabel = readString(topRecipe.label) || 'Ollama';
  const nextActions = [
    localServerHealth.endpointCount > 0
      ? `Smoke test detected local endpoint(s): ${localServerHealth.endpoints[0]?.modelsUrl ?? 'see localServerHealth.endpoints'}.`
      : detection.stacks.length > 0
      ? `Inspect detected local route(s): ${detection.modelRoutes.join(', ') || detection.providerIds.join(', ')}.`
      : `Start with ${topLabel}: inspect its setupPlan, then install/start the server outside Agent.`,
    'Refresh the model catalog after the local server is running.',
    'Run the local benchmark workspace action or saved model comparison before changing the default route.',
  ];
  return {
    status: detection.stacks.length > 0
      ? 'detected-local-route'
      : localServerHealth.endpointCount > 0
        ? 'detected-local-server'
        : 'recommendations-only',
    recommendation: detection.stacks.includes('ollama')
      ? 'Use the discovered Ollama route first unless throughput requirements point to vLLM.'
      : `Best current fit: ${topLabel}. Ollama remains the easiest first local route; use llama.cpp for offline GGUF files or vLLM for GPU throughput.`,
    hardwareProfile,
    detected: detection,
    localServerHealth,
    recipes,
    benchmarkHistory,
    readinessRubric: {
      score: '0-100 estimated readiness for autonomous Agent work.',
      confidence: 'estimated until a live route benchmark records latency and task fit on this machine',
      dimensions: [
        { id: 'latency', weight: 20 },
        { id: 'context-window', weight: 20 },
        { id: 'tool-support', weight: 20 },
        { id: 'vision', weight: 10 },
        { id: 'cost', weight: 15 },
        { id: 'privacy', weight: 15 },
      ],
    },
    nextActions,
    modelRoute: 'agent_harness mode:"model_routing" query:"local"',
    policy: 'Read-only hardware-aware cookbook. Readiness scores are estimated until a live benchmark is recorded. Setup plans include download/start guidance and a confirmed benchmark action route, but installs, downloads, live benchmarks, provider edits, and route changes stay separate visible user actions.',
  };
}

async function readCurrentModel(context: CommandContext): Promise<unknown> {
  try {
    return await readProviderApi(context)?.getCurrentModel() ?? null;
  } catch {
    return null;
  }
}

function routeCandidates(context: CommandContext): readonly RouteCandidate[] {
  return [
    {
      kind: 'route',
      id: 'main',
      label: 'Main conversation model',
      detail: 'Provider/model route for normal Agent chat turns.',
      currentValue: {
        provider: context.session.runtime.provider,
        model: context.session.runtime.model,
        reasoningEffort: context.session.runtime.reasoningEffort || readConfig(context, 'provider.reasoningEffort') || null,
      },
      settingKeys: ['provider.model', 'provider.reasoningEffort'],
      commands: ['/model', '/provider', '/effort'],
      uiSurfaces: ['model-picker', 'provider-picker', 'reasoning-effort-picker'],
    },
    {
      kind: 'route',
      id: 'embedding-provider',
      label: 'Embedding provider',
      detail: 'Provider used for embedding-backed Agent features.',
      currentValue: readConfig(context, 'provider.embeddingProvider') ?? null,
      settingKeys: ['provider.embeddingProvider'],
      commands: ['/settings provider.embeddingProvider'],
      uiSurfaces: ['settings'],
    },
    {
      kind: 'route',
      id: 'system-prompt',
      label: 'System prompt file',
      detail: 'Agent-owned system prompt file route for the serial conversation.',
      currentValue: readConfig(context, 'provider.systemPromptFile') || null,
      settingKeys: ['provider.systemPromptFile'],
      commands: ['/settings provider.systemPromptFile'],
      uiSurfaces: ['settings'],
    },
    {
      kind: 'route',
      id: 'helper-model',
      label: 'Helper model route',
      detail: 'Optional helper-model route for Agent-owned helper operations.',
      currentValue: {
        enabled: readConfig(context, 'helper.enabled') ?? null,
        provider: readConfig(context, 'helper.globalProvider') ?? null,
        model: readConfig(context, 'helper.globalModel') ?? null,
      },
      settingKeys: ['helper.enabled', 'helper.globalProvider', 'helper.globalModel'],
      commands: ['/settings helper.enabled', '/settings helper.globalProvider', '/settings helper.globalModel'],
      uiSurfaces: ['settings'],
    },
    {
      kind: 'route',
      id: 'tool-llm',
      label: 'Tool LLM route',
      detail: 'Optional provider/model route for tool-assist operations.',
      currentValue: {
        enabled: readConfig(context, 'tools.llmEnabled') ?? null,
        provider: readConfig(context, 'tools.llmProvider') ?? null,
        model: readConfig(context, 'tools.llmModel') ?? null,
      },
      settingKeys: ['tools.llmEnabled', 'tools.llmProvider', 'tools.llmModel'],
      commands: ['/settings tools.llmEnabled', '/settings tools.llmProvider', '/settings tools.llmModel'],
      uiSurfaces: ['settings'],
    },
    {
      kind: 'route',
      id: 'catalog-refresh',
      label: 'Model catalog refresh',
      detail: 'Provider catalog, benchmark, and token-limit refresh route.',
      currentValue: 'available',
      settingKeys: [],
      commands: ['/refresh-models'],
      uiSurfaces: ['model-picker'],
    },
    {
      kind: 'route',
      id: 'local-model-cookbook',
      label: 'Local model cookbook',
      detail: 'Hardware-aware recommendations for Ollama, llama.cpp, vLLM, and local OpenAI-compatible servers.',
      currentValue: {
        detected: localModelDetection(context),
        hardwareProfile: localHardwareProfile(),
        localServerHealth: localModelServerHealthMap(context, false),
      },
      settingKeys: [],
      commands: ['/provider add <name> <baseURL> [apiKey] --yes', '/refresh-models', '/model'],
      uiSurfaces: ['provider-picker', 'model-picker', 'settings'],
    },
    {
      kind: 'route',
      id: 'pinned-models',
      label: 'Pinned model favorites',
      detail: 'Local model favorites used by the model picker.',
      currentValue: 'see model entries where pinned is true',
      settingKeys: [],
      commands: ['/pin', '/unpin'],
      uiSurfaces: ['model-picker'],
    },
    {
      kind: 'route',
      id: 'custom-providers',
      label: 'Custom provider files',
      detail: 'Agent-local OpenAI-compatible provider add/remove route.',
      currentValue: 'workspace controlled',
      settingKeys: [],
      commands: ['/provider add <name> <baseURL> [apiKey] --yes', '/provider remove <name> --yes'],
      uiSurfaces: ['settings', 'provider-picker'],
    },
  ];
}

function lookupFromArgs(args: AgentHarnessModelRoutingArgs): { readonly source: ModelRouteLookupSource; readonly input: string } | null {
  const modelRouteId = readString(args.modelRouteId);
  if (modelRouteId) return { source: 'modelRouteId', input: modelRouteId };
  const target = readString(args.target);
  if (target) return { source: 'target', input: target };
  const query = readString(args.query);
  return query ? { source: 'query', input: query } : null;
}

function routeSearchText(route: RouteCandidate): string {
  return [
    route.id,
    route.label,
    route.detail,
    ...route.settingKeys,
    ...route.commands,
    ...route.uiSurfaces,
    JSON.stringify(route.currentValue),
  ].join('\n').toLowerCase();
}

function modelSearchText(model: ModelCandidate): string {
  return [
    model.registryKey,
    model.modelId,
    model.providerId,
    model.displayName,
    model.current ? 'current selected active' : '',
    model.pinned ? 'pinned favorite' : '',
    ...model.reasoningEffort,
    JSON.stringify(model.capabilities),
  ].join('\n').toLowerCase();
}

function localEndpointSearchText(endpoint: LocalModelServerEndpoint): string {
  return [
    endpoint.id,
    endpoint.providerId ?? '',
    endpoint.stack ?? '',
    endpoint.baseUrl,
    endpoint.modelsUrl,
    endpoint.diagnosticStatus,
    ...endpoint.sources,
    ...endpoint.sourceDetails,
    ...endpoint.modelRoutes,
    ...endpoint.notes,
  ].join('\n').toLowerCase();
}

function describeLocalServerEndpointRoute(endpoint: LocalModelServerEndpoint, lookup?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...endpoint,
    ...(lookup ? { lookup } : {}),
    modelRouteId: endpoint.id,
    label: `Local model server ${endpoint.baseUrl}`,
    modelRoute: endpoint.inspectRoute,
    modelAccess: {
      smoke: endpoint.smokeRoute,
      refresh: endpoint.refreshRoute,
      addProvider: endpoint.addProviderRoute,
      cookbook: 'agent_harness mode:"model_routing" query:"local" includeParameters:true',
    },
    policy: endpoint.diagnostics?.policy ?? 'Read-only local model endpoint inspection. The smoke test, refresh, provider add, benchmark, and route changes remain separate visible confirmed actions.',
  };
}

function describeRoute(route: RouteCandidate, options: { readonly context: CommandContext; readonly includeParameters?: boolean; readonly lookup?: Record<string, unknown> }): Record<string, unknown> {
  return {
    kind: 'route',
    modelRouteId: route.id,
    label: route.label,
    ...(options.includeParameters ? { detail: route.detail } : { summary: previewHarnessText(route.detail) }),
    currentValue: route.currentValue,
    settingKeys: route.settingKeys,
    modelRoute: modelRoutingModelRoute(),
    ...(options.includeParameters ? {
      commands: route.commands,
      uiSurfaces: route.uiSurfaces,
    } : {}),
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(route.id === 'local-model-cookbook' && options.includeParameters === true ? { localCookbook: localModelCookbook(options.context, true) } : {}),
    ...(options.includeParameters ? {
      policy: {
        effect: 'read-only',
        values: 'Model routing posture returns model ids, provider ids, route state, capabilities, and safe setting keys only; provider credentials are never returned.',
        mutation: 'Model/provider selection, catalog refresh, favorites, custom provider edits, and route setting changes stay explicit user-facing picker, settings, workspace, or slash-command flows.',
      },
      modelAccess: {
        inspectRouting: 'agent_harness mode:"model_routing"',
        inspectRoute: 'agent_harness mode:"model_route"',
        settingRead: 'agent_harness mode:"get_setting"',
        settingMutation: 'agent_harness mode:"set_setting" confirm:true explicitUserRequest:"..."',
        openModelPicker: 'agent_harness mode:"open_ui_surface" surfaceId:"model-picker" confirm:true explicitUserRequest:"..."',
        openProviderPicker: 'agent_harness mode:"open_ui_surface" surfaceId:"provider-picker" confirm:true explicitUserRequest:"..."',
      },
    } : {}),
  };
}

function describeModel(model: ModelCandidate, options: { readonly includeParameters?: boolean; readonly lookup?: Record<string, unknown> } = {}): Record<string, unknown> {
  const readiness = modelReadinessScore(model);
  return {
    kind: 'model',
    modelRouteId: model.registryKey,
    registryKey: model.registryKey,
    modelId: model.modelId,
    providerId: model.providerId,
    displayName: model.displayName,
    current: model.current,
    pinned: model.pinned,
    contextWindow: model.contextWindow,
    reasoningEffort: model.reasoningEffort,
    tier: model.tier ?? null,
    benchmarkCompositeScore: model.benchmarkCompositeScore ?? null,
    benchmarkQualityTier: model.benchmarkQualityTier ?? null,
    readinessScore: readiness.score,
    readinessLevel: readiness.level,
    readiness: options.includeParameters
      ? readiness
      : {
        score: readiness.score,
        level: readiness.level,
        confidence: readiness.confidence,
        nextStep: readiness.nextStep,
      },
    modelRoute: modelCandidateModelRoute(),
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(options.includeParameters ? {
      capabilities: model.capabilities,
      policy: {
        effect: 'read-only',
        mutation: 'Selecting this model stays a visible picker, settings, workspace, or slash-command flow with explicit user request.',
      },
      modelAccess: {
        selectModelCommand: `/model ${model.registryKey}`,
        selectProviderCommand: `/provider ${model.providerId}`,
        pinCommand: `/pin ${model.registryKey}`,
        unpinCommand: `/unpin ${model.registryKey}`,
        setMainModel: `agent_harness mode:"set_setting" key:"provider.model" value:"${model.registryKey}" confirm:true explicitUserRequest:"..."`,
      },
    } : {}),
  };
}

function describeCandidate(entry: RouteCandidate | ModelCandidate): Record<string, unknown> {
  if (entry.kind === 'route') {
    return {
      kind: 'route',
      modelRouteId: entry.id,
      label: entry.label,
      modelRoute: modelRoutingModelRoute(),
    };
  }
  return {
    kind: 'model',
    modelRouteId: entry.registryKey,
    providerId: entry.providerId,
    displayName: entry.displayName,
    current: entry.current,
    pinned: entry.pinned,
    modelRoute: modelCandidateModelRoute(),
  };
}

function describeEndpointCandidate(endpoint: LocalModelServerEndpoint): Record<string, unknown> {
  return {
    kind: endpoint.kind,
    modelRouteId: endpoint.id,
    baseUrl: endpoint.baseUrl,
    stack: endpoint.stack,
    diagnosticStatus: endpoint.diagnosticStatus,
    modelRoute: endpoint.inspectRoute,
  };
}

function modelRoutingModelRoute(): string {
  return 'agent_harness mode:"model_route" or mode:"run_command"';
}

function modelCandidateModelRoute(): string {
  return 'agent_harness mode:"run_command" command:"/model"';
}

export async function modelRoutingCatalogStatus(context: CommandContext): Promise<Record<string, unknown>> {
  const [models, providerIds] = await Promise.all([
    loadModels(context),
    Promise.resolve(listProviderIds(context)),
  ]);
  return {
    modes: ['model_routing', 'model_route'],
    status: readProviderApi(context) ? 'available' : 'degraded',
    routes: routeCandidates(context).length,
    providers: providerIds.length,
    models: models.length,
    currentModel: context.session.runtime.model,
    currentProvider: context.session.runtime.provider,
    readOnly: true,
  };
}

export async function modelRoutingSummary(context: CommandContext, args: AgentHarnessModelRoutingArgs): Promise<Record<string, unknown>> {
  const query = readString(args.query).toLowerCase();
  const includeParameters = args.includeParameters === true;
  const [models, providerIds, currentModel] = await Promise.all([
    loadModels(context),
    Promise.resolve(listProviderIds(context)),
    readCurrentModel(context),
  ]);
  const routes = routeCandidates(context);
  const filteredRoutes = routes.filter((route) => !query || routeSearchText(route).includes(query));
  const filteredModels = models.filter((model) => !query || modelSearchText(model).includes(query));
  const limit = readLimit(args.limit, 100);
  return {
    status: readProviderApi(context) ? 'available' : 'degraded',
    current: {
      provider: context.session.runtime.provider,
      model: context.session.runtime.model,
      reasoningEffort: context.session.runtime.reasoningEffort || readConfig(context, 'provider.reasoningEffort') || null,
      currentModel: currentModel ? describeModel({
        kind: 'model',
        id: modelRegistryKey(currentModel),
        registryKey: modelRegistryKey(currentModel),
        modelId: modelModelId(currentModel),
        providerId: modelProviderId(currentModel),
        displayName: modelDisplayName(currentModel),
        current: true,
        contextWindow: contextWindowFor(context, currentModel),
        reasoningEffort: modelReasoning(currentModel),
        capabilities: modelCapabilities(currentModel),
        tier: modelTier(currentModel),
        benchmarkCompositeScore: modelBenchmarkCompositeScore(currentModel),
        benchmarkQualityTier: modelBenchmarkQualityTier(currentModel),
        pinned: false,
      }, { includeParameters }) : null,
    },
    providers: providerIds,
    localCookbook: localModelCookbook(context, includeParameters),
    routes: filteredRoutes.slice(0, limit).map((route) => describeRoute(route, { context, includeParameters })),
    models: filteredModels.slice(0, limit).map((model) => describeModel(model, { includeParameters })),
    returned: {
      routes: Math.min(filteredRoutes.length, limit),
      models: Math.min(filteredModels.length, limit),
    },
    total: {
      routes: routes.length,
      providers: providerIds.length,
      models: models.length,
    },
    issues: readProviderApi(context) ? [] : [{
      severity: 'warning',
      message: 'Provider API is unavailable in this runtime; static model route posture is still inspectable.',
    }],
    policy: 'Read-only provider/model routing posture. Route changes, model selection, provider add/remove, refresh, pin, and unpin remain visible picker, settings, workspace, or slash-command flows.',
  };
}

export async function describeHarnessModelRoute(context: CommandContext, args: AgentHarnessModelRoutingArgs): Promise<ModelRouteResolution> {
  const lookup = lookupFromArgs(args);
  if (!lookup) {
    return {
      status: 'missing_lookup',
      usage: 'model_route requires modelRouteId, target, or query. Use mode:"model_routing" to inspect route, model, and local endpoint ids.',
    };
  }
  const [models] = await Promise.all([loadModels(context)]);
  const routes = routeCandidates(context);
  const endpoints = collectLocalServerEndpointCandidates(context).map((endpoint) => describeLocalServerEndpoint(endpoint, true));
  const normalized = lookup.input.toLowerCase();
  const exactRoute = routes.find((route) => route.id === lookup.input);
  if (exactRoute) return { status: 'found', route: describeRoute(exactRoute, { context, includeParameters: true, lookup: { ...lookup, resolvedBy: 'route-id' } }) };
  const exactModel = models.find((model) => model.registryKey === lookup.input || model.modelId === lookup.input);
  if (exactModel) return { status: 'found', route: describeModel(exactModel, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'model-id' } }) };
  const exactEndpoint = endpoints.find((endpoint) => endpoint.id === lookup.input || endpoint.baseUrl === lookup.input || endpoint.modelsUrl === lookup.input);
  if (exactEndpoint) return { status: 'found', route: describeLocalServerEndpointRoute(exactEndpoint, { ...lookup, resolvedBy: 'local-endpoint-id' }) };
  const insensitiveRoute = routes.find((route) => route.id.toLowerCase() === normalized);
  if (insensitiveRoute) return { status: 'found', route: describeRoute(insensitiveRoute, { context, includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-route-id' } }) };
  const insensitiveModel = models.find((model) => model.registryKey.toLowerCase() === normalized || model.modelId.toLowerCase() === normalized);
  if (insensitiveModel) return { status: 'found', route: describeModel(insensitiveModel, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-model-id' } }) };
  const insensitiveEndpoint = endpoints.find((endpoint) => endpoint.id.toLowerCase() === normalized || endpoint.baseUrl.toLowerCase() === normalized || endpoint.modelsUrl.toLowerCase() === normalized);
  if (insensitiveEndpoint) return { status: 'found', route: describeLocalServerEndpointRoute(insensitiveEndpoint, { ...lookup, resolvedBy: 'case-insensitive-local-endpoint-id' }) };
  const searched = [
    ...routes.filter((route) => routeSearchText(route).includes(normalized)),
    ...models.filter((model) => modelSearchText(model).includes(normalized)),
  ];
  const searchedEndpoints = endpoints.filter((endpoint) => localEndpointSearchText(endpoint).includes(normalized));
  if (searched.length === 0 && searchedEndpoints.length === 1) {
    return {
      status: 'found',
      route: describeLocalServerEndpointRoute(searchedEndpoints[0]!, { ...lookup, resolvedBy: 'local-endpoint-search' }),
    };
  }
  if (searched.length === 1 && searchedEndpoints.length === 0) {
    const found = searched[0]!;
    return {
      status: 'found',
      route: found.kind === 'route'
        ? describeRoute(found, { context, includeParameters: true, lookup: { ...lookup, resolvedBy: 'search' } })
        : describeModel(found, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'search' } }),
    };
  }
  if (searched.length + searchedEndpoints.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: [
        ...searched.slice(0, 8).map(describeCandidate),
        ...searchedEndpoints.slice(0, Math.max(0, 8 - searched.length)).map(describeEndpointCandidate),
      ],
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown model route ${lookup.input}. Use mode:"model_routing" to inspect route, model, and local endpoint ids.`,
  };
}
