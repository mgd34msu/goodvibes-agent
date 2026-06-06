import { arch, cpus, freemem, platform, totalmem } from 'node:os';
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

function readConfig(context: CommandContext, key: string): unknown {
  try {
    return (context.platform.configManager as { get(settingKey: string): unknown }).get(key);
  } catch {
    return undefined;
  }
}

function contextWindowFor(context: CommandContext, model: unknown): number | null {
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

function scoreLocalModelRecipe(
  recipe: LocalModelRecipe,
  hardware: LocalModelHardwareProfile,
  detection: LocalModelDetection,
): LocalModelRecipeFit {
  const stackId = recipe.id === 'openai-compatible-local' ? 'openai-compatible' : recipe.id === 'llama-cpp' ? 'llama.cpp' : recipe.id;
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
  includeParameters: boolean,
): Record<string, unknown> {
  const stackId = recipe.id === 'openai-compatible-local' ? 'openai-compatible' : recipe.id === 'llama-cpp' ? 'llama.cpp' : recipe.id;
  const detected = detection.stacks.includes(stackId);
  const fit = scoreLocalModelRecipe(recipe, hardware, detection);
  return {
    id: recipe.id,
    label: recipe.label,
    fit: recipe.fit,
    fitScore: fit.score,
    fitLevel: fit.level,
    bestFor: recipe.bestFor,
    hardware: previewHarnessText(recipe.hardware, includeParameters ? 180 : 96),
    hardwareMatched: fit.reasons.slice(0, includeParameters ? 6 : 3),
    detected,
    modelRoute: 'agent_harness mode:"model_routing" or mode:"open_ui_surface"',
    ...(includeParameters ? {
      setup: recipe.setup,
      modelExamples: recipe.modelExamples,
      cautions: recipe.cautions,
    } : {}),
  };
}

function localModelCookbook(context: CommandContext, includeParameters: boolean): Record<string, unknown> {
  const detection = localModelDetection(context);
  const hardwareProfile = localHardwareProfile();
  const recipes = localModelRecipes()
    .map((recipe) => describeLocalModelRecipe(recipe, detection, hardwareProfile, includeParameters))
    .sort((left, right) => Number(readRecord(right).fitScore ?? 0) - Number(readRecord(left).fitScore ?? 0));
  const topRecipe = readRecord(recipes[0]);
  const topLabel = readString(topRecipe.label) || 'Ollama';
  return {
    status: detection.stacks.length > 0 ? 'detected-local-route' : 'recommendations-only',
    recommendation: detection.stacks.includes('ollama')
      ? 'Use the discovered Ollama route first unless throughput requirements point to vLLM.'
      : `Best current fit: ${topLabel}. Ollama remains the easiest first local route; use llama.cpp for offline GGUF files or vLLM for GPU throughput.`,
    hardwareProfile,
    detected: detection,
    recipes,
    modelRoute: 'agent_harness mode:"model_routing" query:"local"',
    policy: 'Read-only hardware-aware cookbook. Installs, downloads, live benchmarks, provider edits, and route changes stay separate visible user actions.',
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
      usage: 'model_route requires modelRouteId, target, or query. Use mode:"model_routing" to inspect route and model ids.',
    };
  }
  const [models] = await Promise.all([loadModels(context)]);
  const routes = routeCandidates(context);
  const normalized = lookup.input.toLowerCase();
  const exactRoute = routes.find((route) => route.id === lookup.input);
  if (exactRoute) return { status: 'found', route: describeRoute(exactRoute, { context, includeParameters: true, lookup: { ...lookup, resolvedBy: 'route-id' } }) };
  const exactModel = models.find((model) => model.registryKey === lookup.input || model.modelId === lookup.input);
  if (exactModel) return { status: 'found', route: describeModel(exactModel, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'model-id' } }) };
  const insensitiveRoute = routes.find((route) => route.id.toLowerCase() === normalized);
  if (insensitiveRoute) return { status: 'found', route: describeRoute(insensitiveRoute, { context, includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-route-id' } }) };
  const insensitiveModel = models.find((model) => model.registryKey.toLowerCase() === normalized || model.modelId.toLowerCase() === normalized);
  if (insensitiveModel) return { status: 'found', route: describeModel(insensitiveModel, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-model-id' } }) };
  const searched = [
    ...routes.filter((route) => routeSearchText(route).includes(normalized)),
    ...models.filter((model) => modelSearchText(model).includes(normalized)),
  ];
  if (searched.length === 1) {
    const found = searched[0]!;
    return {
      status: 'found',
      route: found.kind === 'route'
        ? describeRoute(found, { context, includeParameters: true, lookup: { ...lookup, resolvedBy: 'search' } })
        : describeModel(found, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'search' } }),
    };
  }
  if (searched.length > 1) {
    return {
      status: 'ambiguous',
      input: lookup.input,
      candidates: searched.slice(0, 8).map(describeCandidate),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown model route ${lookup.input}. Use mode:"model_routing" to inspect route and model ids.`,
  };
}
