import type { CommandContext } from '../input/command-registry.ts';
import type { AgentHarnessModelRoutingArgs, LocalModelDetection, LocalModelEndpointSource, LocalModelServerDefaultEndpoint, LocalModelServerEndpoint, LocalModelServerHealthMap, LocalModelSmokeTarget, MutableLocalModelServerEndpoint } from './agent-harness-model-routing-types.ts';
import { listProviderIds, listProviderRegistryProviders, listRegistryModels, modelDisplayName, modelModelId, modelProviderId, modelRegistryKey, readProviderModels } from './agent-harness-model-catalog.ts';
import { previewHarnessText } from './agent-harness-text.ts';
import { readLimit, readRecord, readString } from './agent-harness-model-routing-utils.ts';

export function localStackFor(value: string): string | null {
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

export function cleanUrlCandidate(value: string): string {
  return value.trim().replace(/[),.;]+$/g, '');
}

export function extractUrls(value: string): readonly string[] {
  const matches = value.match(/https?:\/\/[^\s"'`<>]+/gi) ?? [];
  return [...new Set(matches.map(cleanUrlCandidate).filter(Boolean))];
}

export function parseUrlCandidate(raw: string): URL | null {
  const trimmed = cleanUrlCandidate(raw);
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

export function isPrivateOrLocalHost(hostname: string): boolean {
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

export function isPrivateOrLocalUrl(raw: string): boolean {
  const url = parseUrlCandidate(raw);
  if (!url || !/^https?:$/.test(url.protocol)) return false;
  return isPrivateOrLocalHost(url.hostname);
}

export function normalizeLocalBaseUrl(raw: string, stackHint?: string | null): string | null {
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

export function modelsUrlFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/g, '')}/models`;
}

export function localProviderNameFor(providerId: string | null, stack: string | null, fallback: string): string {
  const seed = providerId || stack || fallback;
  const normalized = seed.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'local-openai';
}

export function localProviderAddRoute(providerId: string | null, stack: string | null, baseUrl: string): string {
  const name = localProviderNameFor(providerId, stack, 'local-openai');
  return `agent_harness mode:"run_command" command:"/provider add ${name} ${baseUrl} local --yes" confirm:true explicitUserRequest:"Add this local provider after the server is running."`;
}

export function localEndpointId(baseUrl: string): string {
  return `local-${baseUrl.toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

export function localEndpointInspectRoute(endpointId: string): string {
  return `agent_harness mode:"model_route" modelRouteId:"${endpointId}"`;
}

export function localEndpointSmokeRoute(endpointId?: string): string {
  const target = endpointId ? ` modelRouteId:"${endpointId}"` : '';
  return `models action:"smoke"${target} confirm:true explicitUserRequest:"Check local model servers."`;
}

export function localEndpointDiagnostics(endpoint: MutableLocalModelServerEndpoint, providerExists: boolean): NonNullable<LocalModelServerEndpoint['diagnostics']> {
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
    policy: 'Diagnostics are read-only criteria and confirmed route hints. Agent probes local model-list endpoints only through models action:"smoke" after explicit confirmation; provider add, refresh, benchmark, and route changes remain separate actions.',
  };
}

export function localModelServerDefaults(): readonly LocalModelServerDefaultEndpoint[] {
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

export function localModelDetection(context: CommandContext): LocalModelDetection {
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

export function addLocalServerEndpoint(
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

export function collectLocalServerEndpointCandidates(context: CommandContext): readonly MutableLocalModelServerEndpoint[] {
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

export function describeLocalServerEndpoint(endpoint: MutableLocalModelServerEndpoint, includeParameters = false): LocalModelServerEndpoint {
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
    smokeRoute: localEndpointSmokeRoute(id),
    refreshRoute: 'agent_harness mode:"run_command" command:"/refresh-models" confirm:true explicitUserRequest:"Refresh models after verifying the local server."',
    addProviderRoute: providerExists ? null : localProviderAddRoute(endpoint.providerId, endpoint.stack, endpoint.baseUrl),
    notes: [...notes],
    ...(includeParameters ? { diagnostics: localEndpointDiagnostics(endpoint, providerExists) } : {}),
  };
}

export function localModelServerHealthMap(
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

function localModelSmokeTargetFromEndpoint(endpoint: LocalModelServerEndpoint): LocalModelSmokeTarget {
  return {
    kind: endpoint.kind,
    id: endpoint.id,
    label: `Local model server ${endpoint.baseUrl}`,
    providerId: endpoint.providerId,
    stack: endpoint.stack,
    baseUrl: endpoint.baseUrl,
    modelsUrl: endpoint.modelsUrl,
    smokeCommand: endpoint.smokeCommand,
    smokeRoute: endpoint.smokeRoute,
    refreshRoute: endpoint.refreshRoute,
    addProviderRoute: endpoint.addProviderRoute,
    source: endpoint.sources.join(', ') || 'local-endpoint',
    notes: endpoint.notes,
  };
}

function localModelSmokeTargetFromDefault(endpoint: LocalModelServerDefaultEndpoint): LocalModelSmokeTarget {
  return {
    kind: 'suggested-local-server',
    id: endpoint.id,
    label: endpoint.label,
    providerId: null,
    stack: endpoint.stack,
    baseUrl: endpoint.baseUrl,
    modelsUrl: endpoint.modelsUrl,
    smokeCommand: endpoint.smokeCommand,
    smokeRoute: localEndpointSmokeRoute(endpoint.id),
    refreshRoute: 'agent_harness mode:"run_command" command:"/refresh-models" confirm:true explicitUserRequest:"Refresh models after verifying the local server."',
    addProviderRoute: endpoint.addProviderRoute,
    source: 'suggested-default',
    notes: [endpoint.startHint],
  };
}

function localSmokeTargetSearchText(target: LocalModelSmokeTarget): string {
  return [
    target.kind,
    target.id,
    target.label,
    target.providerId ?? '',
    target.stack ?? '',
    target.baseUrl,
    target.modelsUrl,
    target.source,
    ...target.notes,
  ].join('\n').toLowerCase();
}

function localModelSmokeLookup(args: AgentHarnessModelRoutingArgs): string {
  const fields = readRecord(args.fields);
  return readString(args.modelRouteId)
    || readString(args.target)
    || readString(args.query)
    || readString(fields.endpointId)
    || readString(fields.modelRouteId)
    || readString(fields.baseUrl)
    || readString(fields.modelsUrl);
}

function localModelSmokeTargets(context: CommandContext, args: AgentHarnessModelRoutingArgs): Record<string, unknown> | readonly LocalModelSmokeTarget[] {
  const endpoints = collectLocalServerEndpointCandidates(context)
    .map((endpoint) => localModelSmokeTargetFromEndpoint(describeLocalServerEndpoint(endpoint, true)));
  const defaults = localModelServerDefaults().map(localModelSmokeTargetFromDefault);
  const lookup = localModelSmokeLookup(args);
  const allTargets = [...endpoints, ...defaults];
  if (lookup) {
    const normalized = lookup.toLowerCase();
    const exact = allTargets.filter((target) => target.id === lookup || target.baseUrl === lookup || target.modelsUrl === lookup);
    if (exact.length === 1) return exact;
    if (exact.length > 1) {
      return {
        status: 'ambiguous',
        input: lookup,
        candidates: exact.slice(0, 8).map((target) => ({
          kind: target.kind,
          id: target.id,
          label: target.label,
          baseUrl: target.baseUrl,
          modelsUrl: target.modelsUrl,
        })),
      };
    }
    const searched = allTargets.filter((target) => localSmokeTargetSearchText(target).includes(normalized));
    if (searched.length === 1) return searched;
    if (searched.length > 1) {
      return {
        status: 'ambiguous',
        input: lookup,
        candidates: searched.slice(0, 8).map((target) => ({
          kind: target.kind,
          id: target.id,
          label: target.label,
          baseUrl: target.baseUrl,
          modelsUrl: target.modelsUrl,
        })),
      };
    }
    return {
      status: 'missing_lookup',
      input: lookup,
      usage: 'Unknown local model endpoint. Use models action:"local" includeParameters:true to inspect local endpoint ids, or omit the lookup to check detected/default local servers.',
    };
  }
  const pool = endpoints.length ? endpoints : defaults;
  return pool.slice(0, readLimit(args.limit, 4));
}

function readSmokeTimeoutMs(value: unknown): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return 1500;
  return Math.max(250, Math.min(10000, Math.trunc(parsed)));
}

function localSmokeNetworkScope(modelsUrl: string): { readonly allowed: boolean; readonly scope: string; readonly reason?: string } {
  const url = parseUrlCandidate(modelsUrl);
  if (!url || !/^https?:$/.test(url.protocol)) return { allowed: false, scope: 'invalid-url', reason: 'The model-list URL is not a valid HTTP(S) URL.' };
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '0.0.0.0') {
    return { allowed: false, scope: 'bind-all-host', reason: '0.0.0.0 is a bind address, not a client URL. Use 127.0.0.1 or the intended LAN host.' };
  }
  if (!isPrivateOrLocalUrl(url.href)) {
    return { allowed: false, scope: 'non-local-host', reason: 'Local model smoke only probes loopback, local-name, or private LAN endpoints.' };
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return { allowed: true, scope: 'loopback' };
  if (host.endsWith('.local') || !host.includes('.')) return { allowed: true, scope: 'local-name' };
  return { allowed: true, scope: 'private-lan' };
}

function extractModelIdsFromPayload(payload: unknown): readonly string[] {
  const record = readRecord(payload);
  const candidates = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : Array.isArray(payload)
        ? payload
        : [];
  const ids = candidates.map((entry) => {
    if (typeof entry === 'string') return entry;
    const item = readRecord(entry);
    return readString(item.id) || readString(item.name) || readString(item.model);
  }).filter(Boolean);
  return [...new Set(ids)].slice(0, 12);
}

function safeSmokeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return previewHarnessText(message.replace(/https?:\/\/\S+/g, '[redacted-url]'), 180);
}

async function smokeOneLocalModelTarget(target: LocalModelSmokeTarget, timeoutMs: number): Promise<Record<string, unknown>> {
  const network = localSmokeNetworkScope(target.modelsUrl);
  if (!network.allowed) {
    return {
      ...target,
      status: 'blocked',
      liveProbe: 'confirmed',
      networkScope: network.scope,
      failure: network.reason,
      nextActions: ['Inspect the endpoint route and correct the base URL before running smoke again.'],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(target.modelsUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    let payload: unknown = null;
    let jsonValid = false;
    try {
      payload = text ? JSON.parse(text) : null;
      jsonValid = true;
    } catch {
      jsonValid = false;
    }
    const modelIds = jsonValid ? extractModelIdsFromPayload(payload) : [];
    const status = !response.ok
      ? 'http-error'
      : !jsonValid
        ? 'invalid-json'
        : modelIds.length === 0
          ? 'no-models'
          : 'passed';
    return {
      ...target,
      status,
      liveProbe: 'confirmed',
      networkScope: network.scope,
      httpStatus: response.status,
      contentType,
      elapsedMs,
      jsonValid,
      modelCount: modelIds.length,
      sampleModelIds: modelIds.slice(0, 5),
      success: status === 'passed',
      nextActions: status === 'passed'
        ? ['Refresh the model catalog, then run a local benchmark before changing the default model.']
        : ['Start or fix the local server, confirm /v1/models returns model ids, then retry this smoke check.'],
    };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const aborted = controller.signal.aborted;
    return {
      ...target,
      status: aborted ? 'timeout' : 'unreachable',
      liveProbe: 'confirmed',
      networkScope: network.scope,
      elapsedMs,
      timeoutMs,
      success: false,
      failure: aborted ? `Timed out after ${timeoutMs}ms.` : safeSmokeError(error),
      nextActions: ['Start the local server, load at least one model, verify the base URL, then retry this smoke check.'],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runLocalModelServerSmoke(context: CommandContext, args: AgentHarnessModelRoutingArgs): Promise<Record<string, unknown>> {
  const targets = localModelSmokeTargets(context, args);
  if (!Array.isArray(targets)) {
    return {
      kind: 'local-model-smoke',
      liveProbe: 'not-run',
      ...targets,
      policy: 'No local model endpoint was probed because the requested endpoint lookup did not resolve exactly.',
    };
  }
  if (targets.length === 0) {
    return {
      kind: 'local-model-smoke',
      status: 'no-candidates',
      liveProbe: 'not-run',
      endpoints: [],
      nextActions: ['Use the local model cookbook to start a local server or configure a local provider endpoint.'],
      cookbookRoute: 'models action:"local" includeParameters:true',
      policy: 'No local model endpoint was probed because no candidate endpoints were available.',
    };
  }
  const timeoutMs = readSmokeTimeoutMs(args.timeoutMs);
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(targets.map((target) => smokeOneLocalModelTarget(target, timeoutMs)));
  const passed = results.filter((result) => result.success === true);
  const blocked = results.filter((result) => result.status === 'blocked');
  return {
    kind: 'local-model-smoke',
    status: passed.length > 0 ? 'ready' : blocked.length === results.length ? 'blocked' : 'needs-attention',
    liveProbe: 'confirmed',
    checkedAt,
    timeoutMs,
    endpointCount: results.length,
    passedCount: passed.length,
    failedCount: results.length - passed.length,
    endpoints: results,
    nextActions: passed.length > 0
      ? ['Refresh the model catalog and run the local benchmark action before changing the default route.']
      : ['Start a local model server, load one model, and rerun this confirmed smoke check.'],
    cookbookRoute: 'models action:"local" includeParameters:true',
    policy: 'Confirmed read-only local model smoke. Agent only sends bounded GET requests to discovered or suggested local/private model-list endpoints; it does not add providers, refresh catalogs, benchmark, download models, or change routes.',
  };
}
