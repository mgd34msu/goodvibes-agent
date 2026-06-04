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

function describeRoute(route: RouteCandidate, options: { readonly includeParameters?: boolean; readonly lookup?: Record<string, unknown> } = {}): Record<string, unknown> {
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
    routes: filteredRoutes.slice(0, limit).map((route) => describeRoute(route, { includeParameters })),
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
  if (exactRoute) return { status: 'found', route: describeRoute(exactRoute, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'route-id' } }) };
  const exactModel = models.find((model) => model.registryKey === lookup.input || model.modelId === lookup.input);
  if (exactModel) return { status: 'found', route: describeModel(exactModel, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'model-id' } }) };
  const insensitiveRoute = routes.find((route) => route.id.toLowerCase() === normalized);
  if (insensitiveRoute) return { status: 'found', route: describeRoute(insensitiveRoute, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'case-insensitive-route-id' } }) };
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
        ? describeRoute(found, { includeParameters: true, lookup: { ...lookup, resolvedBy: 'search' } })
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
