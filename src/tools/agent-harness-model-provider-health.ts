import type { CommandContext } from '../input/command-registry.ts';
import { previewHarnessText } from './agent-harness-text.ts';
import type { ModelProviderHealthSignal } from './agent-harness-model-routing-types.ts';
import { readBoolean, readFiniteNumber, readRecord, readString, safeIso } from './agent-harness-model-routing-utils.ts';

function readPotentialProviderHealthSnapshot(source: unknown): unknown {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  const directSnapshot = typeof record.getSnapshot === 'function'
    ? (record.getSnapshot as () => unknown)()
    : null;
  return directSnapshot ?? record.snapshot ?? record.data ?? record.state ?? source;
}

function providerHealthCandidatesFromSnapshot(snapshot: unknown): readonly Record<string, unknown>[] {
  if (!snapshot || typeof snapshot !== 'object') return [];
  if (snapshot instanceof Map) {
    return [...snapshot.entries()].map(([key, entry]) => {
      const record = readRecord(entry);
      return { ...record, providerId: readString(record.providerId) || readString(key) };
    });
  }
  const record = readRecord(snapshot);
  const providers = record.providers;
  const entries = record.entries;
  if (providers instanceof Map) {
    return [...providers.entries()].map(([key, entry]) => {
      const providerRecord = readRecord(entry);
      return { ...providerRecord, providerId: readString(providerRecord.providerId) || readString(key) };
    });
  }
  if (Array.isArray(providers)) {
    return providers.map((entry) => readRecord(entry));
  }
  if (providers && typeof providers === 'object') {
    return Object.entries(providers as Record<string, unknown>).map(([key, entry]) => {
      const providerRecord = readRecord(entry);
      return { ...providerRecord, providerId: readString(providerRecord.providerId) || key };
    });
  }
  if (entries instanceof Map) {
    return [...entries.entries()].map(([key, entry]) => {
      const entryRecord = readRecord(entry);
      return { ...entryRecord, providerId: readString(entryRecord.providerId) || readString(key) };
    });
  }
  if (Array.isArray(entries)) {
    return entries.map((entry) => readRecord(entry));
  }
  return [];
}

function providerHealthCandidateId(candidate: Record<string, unknown>): string {
  return readString(candidate.providerId)
    || readString(candidate.id)
    || readString(candidate.provider)
    || readString(candidate.name);
}

function providerHealthRecordStats(candidate: Record<string, unknown>): Record<string, unknown> {
  return readRecord(candidate.stats);
}

function providerHealthTimestamp(candidate: Record<string, unknown>, stats: Record<string, unknown>, key: string): string | null {
  return safeIso(readFiniteNumber(candidate[key]) ?? readFiniteNumber(stats[key]));
}

export function readProviderHealthSignal(context: CommandContext, providerId: string): ModelProviderHealthSignal {
  const base: Omit<ModelProviderHealthSignal, 'status' | 'daemonPublication' | 'agentConsumption' | 'missingSignals' | 'policy'> = {
    providerId,
    sdkContract: {
      providerHealthTypes: 'available',
      importSurface: '@pellux/goodvibes-sdk/platform/runtime/ui',
      note: 'The SDK publishes provider-health domain and UI enrichment types; types alone do not prove live connected-host health.',
    },
  };
  const policy = 'Provider health is live route-condition evidence. Local benchmark artifacts remain separate task-fit evidence and must not be treated as provider-health publication.';
  const platform = context.platform as unknown as Record<string, unknown>;
  const readModels = readRecord(platform.readModels);
  const sourceEntries: readonly { readonly path: string; readonly source: unknown }[] = [
    { path: 'context.platform.readModels.providerHealth', source: readModels.providerHealth },
    { path: 'context.platform.readModels.providersHealth', source: readModels.providersHealth },
    { path: 'context.platform.providerHealth', source: platform.providerHealth },
  ];

  for (const entry of sourceEntries) {
    if (entry.source === undefined || entry.source === null) continue;
    try {
      const snapshot = readPotentialProviderHealthSnapshot(entry.source);
      const candidates = providerHealthCandidatesFromSnapshot(snapshot);
      const candidate = candidates.find((item) => providerHealthCandidateId(item) === providerId);
      if (!candidate) {
        return {
          ...base,
          status: 'read-model-empty',
          daemonPublication: {
            status: 'published-read-model',
            requiredPath: entry.path,
            evidence: 'A provider-health read model path exists, but no matching provider record was returned.',
          },
          agentConsumption: {
            status: 'waiting-for-published-feed',
            readModelPath: entry.path,
            evidence: `No provider-health record matched provider "${providerId}".`,
          },
          missingSignals: [`No daemon-published provider-health record matched provider "${providerId}" in ${entry.path}.`],
          policy,
        };
      }

      const stats = providerHealthRecordStats(candidate);
      const avgLatencyMs = readFiniteNumber(candidate.avgLatencyMs) ?? readFiniteNumber(stats.avgLatencyMs);
      const minLatencyMs = readFiniteNumber(candidate.minLatencyMs) ?? readFiniteNumber(stats.minLatencyMs);
      const maxLatencyMs = readFiniteNumber(candidate.maxLatencyMs) ?? readFiniteNumber(candidate.p95LatencyMs) ?? readFiniteNumber(stats.maxLatencyMs);
      const healthStatus = readString(candidate.status) || 'unknown';
      return {
        ...base,
        status: 'record-found',
        daemonPublication: {
          status: 'published-read-model',
          requiredPath: entry.path,
          evidence: `Provider-health record found for provider "${providerId}".`,
        },
        agentConsumption: {
          status: 'consumed',
          readModelPath: entry.path,
          evidence: 'Agent consumed the published provider-health record for exact model-route readiness.',
        },
        healthStatus,
        isConfigured: readBoolean(candidate.isConfigured),
        isActive: readBoolean(candidate.isActive),
        avgLatencyMs,
        minLatencyMs,
        maxLatencyMs,
        lastSuccessAt: providerHealthTimestamp(candidate, stats, 'lastSuccessAt'),
        lastErrorAt: providerHealthTimestamp(candidate, stats, 'lastErrorAt'),
        lastErrorMessage: readString(candidate.lastErrorMessage) || readString(stats.lastErrorMessage) || undefined,
        lastCheckedAt: providerHealthTimestamp(candidate, stats, 'lastCheckedAt'),
        rateLimitResetAt: providerHealthTimestamp(candidate, stats, 'rateLimitResetAt'),
        missingSignals: [
          ...(avgLatencyMs === undefined ? ['Provider-health record did not include average latency.'] : []),
          ...(minLatencyMs === undefined ? ['Provider-health record did not include minimum latency.'] : []),
          ...(maxLatencyMs === undefined ? ['Provider-health record did not include maximum or p95 latency.'] : []),
        ],
        policy,
      };
    } catch (error) {
      return {
        ...base,
        status: 'read-model-error',
        daemonPublication: {
          status: 'published-read-model',
          requiredPath: entry.path,
          evidence: `Provider-health read model exists but failed while reading: ${previewHarnessText(error instanceof Error ? error.message : String(error), 120)}`,
        },
        agentConsumption: {
          status: 'waiting-for-published-feed',
          readModelPath: entry.path,
          evidence: 'Agent could not safely consume this provider-health read model.',
        },
        missingSignals: ['Provider-health read model exists but failed while Agent was reading it.'],
        policy,
      };
    }
  }

  return {
    ...base,
    status: 'not-reachable-in-command-context',
    daemonPublication: {
      status: 'not-published',
      requiredPath: 'context.platform.readModels.providerHealth',
      evidence: 'No daemon-published provider-health read model is reachable from Agent CommandContext.',
    },
    agentConsumption: {
      status: 'waiting-for-published-feed',
      readModelPath: null,
      evidence: 'Agent cannot attach provider status or latency to exact routes until the connected host publishes a stable feed.',
    },
    missingSignals: [
      'SDK provider-health types are available, but no daemon-published provider.health feed is reachable in Agent CommandContext.',
      'Agent has not consumed provider status, configured state, live latency, rate-limit posture, or last error for this route.',
    ],
    policy,
  };
}
