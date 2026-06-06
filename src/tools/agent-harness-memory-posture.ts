import type { MemoryDoctorReport, MemoryEmbeddingProviderStatus, MemoryVectorStats } from '@pellux/goodvibes-sdk/platform/state';
import type { CommandContext } from '../input/command-registry.ts';
import { buildAgentWorkspaceRuntimeSnapshot } from '../input/agent-workspace-snapshot.ts';
import { previewHarnessText } from './agent-harness-text.ts';

type MemoryPostureStatus = 'ready' | 'needs-review' | 'empty' | 'unavailable';
type MemoryVectorPostureStatus = 'ready' | 'attention' | 'disabled' | 'unavailable';
type MemoryExternalProviderStatus = 'not-published' | 'available';

interface AgentHarnessMemoryPostureArgs {
  readonly providerId?: unknown;
  readonly target?: unknown;
  readonly query?: unknown;
  readonly includeParameters?: unknown;
  readonly limit?: unknown;
}

interface MemoryPostureProvider {
  readonly id: string;
  readonly label: string;
  readonly kind: 'embedding' | 'external-memory';
  readonly status: string;
  readonly summary: string;
  readonly modelRoute: string;
  readonly setupRoute?: string;
  readonly configured?: boolean;
  readonly active?: boolean;
  readonly dimensions?: number;
  readonly deterministic?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type MemoryProviderResolution =
  | { readonly status: 'found'; readonly provider: Record<string, unknown> }
  | { readonly status: 'ambiguous'; readonly input: string; readonly candidates: readonly Record<string, unknown>[] }
  | { readonly status: 'missing_lookup'; readonly usage: string };

const EXTERNAL_MEMORY_PROVIDERS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'honcho', label: 'Honcho' },
  { id: 'openviking', label: 'OpenViking' },
  { id: 'mem0', label: 'Mem0' },
  { id: 'hindsight', label: 'Hindsight' },
  { id: 'holographic', label: 'Holographic' },
  { id: 'retaindb', label: 'RetainDB' },
  { id: 'byterover', label: 'ByteRover' },
  { id: 'supermemory', label: 'Supermemory' },
];

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, Math.trunc(parsed)));
}

function memoryApi(context: CommandContext): {
  readonly vectorStats?: () => MemoryVectorStats;
  readonly doctor?: () => Promise<MemoryDoctorReport>;
} | null {
  return context.clients?.agentKnowledgeApi?.memory ?? null;
}

async function readMemoryDoctor(context: CommandContext): Promise<MemoryDoctorReport | null> {
  const memory = memoryApi(context);
  if (!memory || typeof memory.doctor !== 'function') return null;
  try {
    return await memory.doctor();
  } catch {
    return null;
  }
}

function readVectorStats(context: CommandContext, doctor: MemoryDoctorReport | null): MemoryVectorStats | null {
  if (doctor?.vector) return doctor.vector;
  const memory = memoryApi(context);
  if (!memory || typeof memory.vectorStats !== 'function') return null;
  try {
    return memory.vectorStats();
  } catch {
    return null;
  }
}

function memoryStatus(snapshot: ReturnType<typeof buildAgentWorkspaceRuntimeSnapshot>, memoryAvailable: boolean): MemoryPostureStatus {
  if (!memoryAvailable) return 'unavailable';
  if (snapshot.localMemoryCount === 0) return 'empty';
  if (snapshot.localMemoryPromptActiveCount > 0) return 'ready';
  return 'needs-review';
}

function vectorStatus(vector: MemoryVectorStats | null): MemoryVectorPostureStatus {
  if (!vector) return 'unavailable';
  if (!vector.enabled) return 'disabled';
  if (vector.available && !vector.error) return 'ready';
  return 'attention';
}

function describeEmbeddingProvider(
  provider: MemoryEmbeddingProviderStatus,
  activeProviderId: string | undefined,
  includeParameters: boolean,
): MemoryPostureProvider {
  return {
    id: provider.id,
    label: provider.label,
    kind: 'embedding',
    status: provider.state,
    summary: previewHarnessText(provider.detail ?? `${provider.configured ? 'configured' : 'not configured'} memory embedding provider`, includeParameters ? 180 : 96),
    modelRoute: `agent_harness mode:"memory_provider" providerId:"${provider.id}"`,
    setupRoute: `agent_harness mode:"set_setting" key:"provider.embeddingProvider" value:"${provider.id}" confirm:true explicitUserRequest:"..."`,
    configured: provider.configured,
    active: provider.id === activeProviderId,
    dimensions: provider.dimensions,
    ...(typeof provider.deterministic === 'boolean' ? { deterministic: provider.deterministic } : {}),
    ...(includeParameters ? { metadata: provider.metadata } : {}),
  };
}

function describeExternalProvider(
  provider: typeof EXTERNAL_MEMORY_PROVIDERS[number],
  includeParameters: boolean,
): MemoryPostureProvider {
  const status: MemoryExternalProviderStatus = 'not-published';
  return {
    id: provider.id,
    label: provider.label,
    kind: 'external-memory',
    status,
    summary: previewHarnessText('External memory backend records are not published by the current GoodVibes SDK/daemon contract.', includeParameters ? 180 : 96),
    modelRoute: `agent_harness mode:"memory_provider" providerId:"${provider.id}"`,
    setupRoute: 'agent_harness mode:"connected_host_capability" query:"memory provider"',
    configured: false,
  };
}

function providerSearchText(provider: MemoryPostureProvider): string {
  return [
    provider.id,
    provider.label,
    provider.kind,
    provider.status,
    provider.summary,
    provider.modelRoute,
    provider.setupRoute ?? '',
  ].join('\n').toLowerCase();
}

function compactProvider(provider: MemoryPostureProvider, includeParameters: boolean): Record<string, unknown> {
  return {
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    status: provider.status,
    summary: provider.summary,
    modelRoute: provider.modelRoute,
    ...(provider.setupRoute ? { setupRoute: provider.setupRoute } : {}),
    ...(includeParameters && typeof provider.configured === 'boolean' ? { configured: provider.configured } : {}),
    ...(includeParameters && typeof provider.active === 'boolean' ? { active: provider.active } : {}),
    ...(includeParameters && typeof provider.dimensions === 'number' ? { dimensions: provider.dimensions } : {}),
    ...(includeParameters && typeof provider.deterministic === 'boolean' ? { deterministic: provider.deterministic } : {}),
    ...(includeParameters && provider.metadata ? { metadata: provider.metadata } : {}),
  };
}

async function buildProviderRecords(
  context: CommandContext,
  args: AgentHarnessMemoryPostureArgs,
): Promise<{
  readonly doctor: MemoryDoctorReport | null;
  readonly vector: MemoryVectorStats | null;
  readonly providers: readonly MemoryPostureProvider[];
}> {
  const includeParameters = args.includeParameters === true;
  const doctor = await readMemoryDoctor(context);
  const vector = readVectorStats(context, doctor);
  const embeddingProviders = (doctor?.embeddings.providers ?? []).map((provider) => (
    describeEmbeddingProvider(provider, doctor?.embeddings.activeProviderId, includeParameters)
  ));
  const externalProviders = EXTERNAL_MEMORY_PROVIDERS.map((provider) => describeExternalProvider(provider, includeParameters));
  return {
    doctor,
    vector,
    providers: [...embeddingProviders, ...externalProviders],
  };
}

function nextActions(
  snapshot: ReturnType<typeof buildAgentWorkspaceRuntimeSnapshot>,
  memoryStatusValue: MemoryPostureStatus,
  vectorStatusValue: MemoryVectorPostureStatus,
  doctor: MemoryDoctorReport | null,
): readonly string[] {
  const actions: string[] = [];
  if (memoryStatusValue === 'empty') actions.push('Create one durable non-secret Agent memory only after the user asks to remember it.');
  if (memoryStatusValue === 'needs-review') actions.push('Review or stale memory candidates before relying on them in the prompt.');
  if (snapshot.localMemoryReviewQueueCount > 0) actions.push('Use learning_curator or memory review routes to clear the memory review queue.');
  if (vectorStatusValue === 'attention') actions.push('Run memory vector doctor, then rebuild the vector index if the reported issue is fixed.');
  if (doctor?.embeddings.warnings.length) actions.push('Inspect the active embedding provider warning before semantic recall or rebuild work.');
  actions.push('External memory backends remain setup gaps until the SDK/daemon publishes concrete provider records.');
  return actions.slice(0, 6);
}

function compactVector(vector: MemoryVectorStats | null): Record<string, unknown> {
  if (!vector) {
    return {
      status: 'unavailable',
      summary: 'Memory vector stats are not exposed in this runtime.',
      modelRoute: 'agent_harness mode:"memory_posture"',
    };
  }
  return {
    status: vectorStatus(vector),
    backend: vector.backend,
    enabled: vector.enabled,
    available: vector.available,
    indexedRecords: vector.indexedRecords,
    dimensions: vector.dimensions,
    embeddingProviderId: vector.embeddingProviderId,
    embeddingProviderLabel: vector.embeddingProviderLabel,
    ...(vector.error ? { error: previewHarnessText(vector.error, 160) } : {}),
    modelRoute: 'agent_harness mode:"workspace_action" actionId:"memory-vector-status"',
    doctorRoute: 'agent_harness mode:"workspace_action" actionId:"memory-vector-doctor"',
    rebuildRoute: 'agent_harness mode:"run_workspace_action" actionId:"memory-vector-rebuild" confirm:true explicitUserRequest:"..."',
  };
}

export async function memoryPostureCatalogStatus(context: CommandContext): Promise<Record<string, unknown>> {
  const snapshot = buildAgentWorkspaceRuntimeSnapshot(context);
  const doctor = await readMemoryDoctor(context);
  const vector = readVectorStats(context, doctor);
  const status = memoryStatus(snapshot, Boolean(memoryApi(context)));
  const vectorState = vectorStatus(vector);
  return {
    modes: ['memory_posture', 'memory_provider'],
    status,
    localMemories: snapshot.localMemoryCount,
    reviewQueue: snapshot.localMemoryReviewQueueCount,
    promptActive: snapshot.localMemoryPromptActiveCount,
    vector: vectorState,
    embeddingProviders: doctor?.embeddings.providers.length ?? 0,
    externalProviders: EXTERNAL_MEMORY_PROVIDERS.length,
    externalProviderRecordsPublished: false,
  };
}

export async function memoryPostureSummary(context: CommandContext, args: AgentHarnessMemoryPostureArgs): Promise<Record<string, unknown>> {
  const includeParameters = args.includeParameters === true;
  const limit = readLimit(args.limit, 100);
  const query = readString(args.query).toLowerCase();
  const snapshot = buildAgentWorkspaceRuntimeSnapshot(context);
  const { doctor, vector, providers } = await buildProviderRecords(context, args);
  const status = memoryStatus(snapshot, Boolean(memoryApi(context)));
  const vectorState = vectorStatus(vector);
  const filteredProviders = providers
    .filter((provider) => !query || providerSearchText(provider).includes(query))
    .slice(0, limit)
    .map((provider) => compactProvider(provider, includeParameters));
  return {
    status,
    localMemory: {
      total: snapshot.localMemoryCount,
      reviewQueue: snapshot.localMemoryReviewQueueCount,
      promptActive: snapshot.localMemoryPromptActiveCount,
      sessionMemory: snapshot.sessionMemoryCount,
      policy: 'Only reviewed, high-confidence Agent-local memories are prompt-active. Fresh/stale/setup-blocked behavior stays visible for review.',
      routes: {
        list: 'agent_harness mode:"workspace_action" actionId:"memory-list"',
        search: 'agent_harness mode:"workspace_action" actionId:"memory-search"',
        reviewQueue: 'agent_harness mode:"workspace_action" actionId:"memory-queue"',
        create: 'agent_harness mode:"run_workspace_action" actionId:"memory-create" confirm:true explicitUserRequest:"..."',
        curator: 'agent_harness mode:"learning_curator"',
      },
    },
    vector: compactVector(vector),
    embeddings: {
      activeProviderId: doctor?.embeddings.activeProviderId ?? vector?.embeddingProviderId ?? snapshot.embeddingProvider,
      warnings: doctor?.embeddings.warnings.map((warning) => previewHarnessText(warning, includeParameters ? 180 : 96)) ?? [],
      syncProviders: doctor?.embeddings.syncProviders ?? [],
      asyncProviders: doctor?.embeddings.asyncProviders ?? [],
    },
    providers: filteredProviders,
    returned: filteredProviders.length,
    totalProviders: providers.length,
    externalMemory: {
      status: 'not-published',
      providerRecordsPublished: false,
      checkedProviders: EXTERNAL_MEMORY_PROVIDERS.map((provider) => provider.id),
      next: 'Use Agent-local memory now. Add external memory-provider posture only when the connected host or SDK publishes concrete provider records and setup routes.',
      inspectRoute: 'agent_harness mode:"connected_host_capability" query:"memory provider"',
    },
    nextActions: nextActions(snapshot, status, vectorState, doctor),
    policy: 'Memory posture is read-only. Memory edits, vector rebuilds, and embedding-provider changes stay on existing confirmed Agent-local routes.',
    ...(includeParameters ? {
      checkedAt: doctor?.checkedAt ?? null,
      providerLookup: 'agent_harness mode:"memory_provider" providerId:"<id>"',
    } : {}),
  };
}

export async function describeMemoryProvider(context: CommandContext, args: AgentHarnessMemoryPostureArgs): Promise<MemoryProviderResolution> {
  const input = readString(args.providerId) || readString(args.target) || readString(args.query);
  if (!input) {
    return {
      status: 'missing_lookup',
      usage: 'memory_provider requires providerId, target, or query. Use mode:"memory_posture" to inspect available provider ids.',
    };
  }
  const includeParameters = args.includeParameters !== false;
  const { providers } = await buildProviderRecords(context, { ...args, includeParameters });
  const normalized = input.toLowerCase();
  const exact = providers.find((provider) => provider.id === input || provider.id.toLowerCase() === normalized);
  if (exact) return { status: 'found', provider: compactProvider(exact, true) };
  const label = providers.find((provider) => provider.label.toLowerCase() === normalized);
  if (label) return { status: 'found', provider: compactProvider(label, true) };
  const matches = providers.filter((provider) => providerSearchText(provider).includes(normalized));
  if (matches.length === 1) return { status: 'found', provider: compactProvider(matches[0]!, true) };
  if (matches.length > 1) {
    return {
      status: 'ambiguous',
      input,
      candidates: matches.slice(0, 10).map((provider) => ({
        providerId: provider.id,
        label: provider.label,
        kind: provider.kind,
        status: provider.status,
        modelRoute: provider.modelRoute,
      })),
    };
  }
  return {
    status: 'missing_lookup',
    usage: `Unknown memory provider ${input}. Use mode:"memory_posture" to inspect available provider ids.`,
  };
}
