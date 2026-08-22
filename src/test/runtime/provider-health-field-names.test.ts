/**
 * D1: Verify that ProviderHealthDataProvider produces maxLatencyMs (not p95LatencyMs)
 * and that ModelPickerDataProvider / health-enrichment uses maxMs (not p95Ms).
 *
 * These tests guard against the field name reverting to misleading p95 labels
 * when the underlying value is actually a maximum.
 */
import { describe, expect, test } from 'bun:test';
import { ProviderHealthDataProvider } from '@/runtime/index.ts';
import type { ProviderHealthDomainState, ModelDomainState } from '@/runtime/index.ts';

function makeHealthState(maxLatencyMs = 500): ProviderHealthDomainState {
  return {
    providers: new Map([
      ['anthropic', {
        providerId: 'anthropic',
        status: 'healthy' as const,
        displayName: 'Anthropic',
        isActive: true,
        isConfigured: true,
        lastCheckedAt: Date.now(),
        stats: {
          totalCalls: 10,
          successCalls: 10,
          errorCalls: 0,
          avgLatencyMs: 200,
          minLatencyMs: 100,
          maxLatencyMs,
          lastSuccessAt: Date.now(),
        },
        cacheMetrics: undefined,
        rateLimitResetAt: undefined,
      }],
    ]),
    revision: 0,
    lastUpdatedAt: Date.now(),
    source: 'test',
    compositeStatus: 'healthy' as const,
    degradedCount: 0,
    unavailableCount: 0,
    warnings: [],
  };
}

function makeModelState(): ModelDomainState {
  return {
    revision: 0,
    lastUpdatedAt: Date.now(),
    source: 'test',
    activeModelId: 'claude-opus-4',
    activeProviderId: 'anthropic',
    fallbackChain: [],
    displayName: 'Claude Opus 4',
    registryKey: 'anthropic:claude-opus-4',
    tier: 'premium',
    tokenLimits: { contextWindow: 200000, maxOutputTokens: 4096 },
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    reasoningEffort: 'medium',
    reasoningSummary: null,
    activeFallbackIndex: 0,
    falloverCount: 0,
  } as unknown as ModelDomainState;
}

describe('ProviderHealthDataProvider: D1 field name accuracy', () => {
  test('entry exposes maxLatencyMs (not p95LatencyMs)', () => {
    const provider = new ProviderHealthDataProvider(makeHealthState(999), makeModelState());
    const snap = provider.getSnapshot();
    const entry = snap.entries[0];
    expect(entry).toBeDefined();
    // The field must be named maxLatencyMs.
    expect(entry!.maxLatencyMs).toBe(999);
    // Verify the misleading p95 field does NOT exist on the entry.
    expect((entry as unknown as Record<string, unknown>)['p95LatencyMs']).toBeUndefined();
    provider.dispose();
  });
});

import { enrichModelEntries } from '@/runtime/index.ts';
import type { ModelDefinition } from '@pellux/goodvibes-sdk/platform/providers';

function makeModel(): ModelDefinition {
  return {
    id: 'claude-opus-4',
    displayName: 'Claude Opus 4',
    provider: 'anthropic',
    tier: 'premium',
    contextWindow: 200000,
    capabilities: { reasoning: true, toolCalling: true, multimodal: true, codeEditing: true },
  } as ModelDefinition;
}

describe('health-enrichment: D1 field name accuracy', () => {
  test('ProviderLatencyStats exposes maxMs (not p95Ms)', () => {
    const healthState = makeHealthState(750);
    const modelState = makeModelState();
    const mockBenchmarkStore = { getBenchmarks: () => undefined };
    const mockProviderRegistry = {
      getSyntheticModelInfoFromCatalog: () => null,
      getContextWindowForModel: (m: ModelDefinition) => m.contextWindow ?? 200000,
    };

    const entries = enrichModelEntries(
      [makeModel()],
      healthState,
      modelState,
      new Set(),
      mockBenchmarkStore,
      mockProviderRegistry,
    );

    const entry = entries[0];
    expect(entry).toBeDefined();
    expect(entry!.health.latency).toBeDefined();
    // The field must be named maxMs.
    expect(entry!.health.latency!.maxMs).toBe(750);
    // The misleading p95Ms field must NOT exist.
    expect((entry!.health.latency as unknown as Record<string, unknown>)['p95Ms']).toBeUndefined();
  });
});
