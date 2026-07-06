import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { MemoryEmbeddingProviderRegistry, MemoryRegistry, MemoryStore } from '@pellux/goodvibes-sdk/platform/state';
import { buildReviewedMemoryPrompt, describeMemoryPromptEligibility, isPromptActiveMemory, MIN_PROMPT_MEMORY_CONFIDENCE } from '../../agent/memory-prompt.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';

async function withMemoryRegistry<T>(fn: (registry: MemoryRegistry) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-memory-prompt-'));
  const configManager = new ConfigManager({
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    configDir: join(root, '.goodvibes', GOODVIBES_AGENT_SURFACE_ROOT),
    workingDir: root,
  });
  const embeddingRegistry = new MemoryEmbeddingProviderRegistry({ configManager });
  const store = new MemoryStore(join(root, 'memory.sqlite'), { embeddingRegistry });
  await store.init();
  const registry = new MemoryRegistry(store);
  try {
    return await fn(registry);
  } finally {
    await store.save();
    store.close();
  }
}

describe('MIN_PROMPT_MEMORY_CONFIDENCE', () => {
  test('matches the SDK MemoryStore store-time default confidence (60), not an arbitrary higher floor', () => {
    // This is the crux of the W4-A1 fix: the SDK stores every new record at confidence
    // 60 by default. A floor above that (the old value was 70) makes fresh recall
    // structurally impossible without an explicit confidence bump — starvation, not a
    // trust filter.
    expect(MIN_PROMPT_MEMORY_CONFIDENCE).toBe(60);
  });
});

describe('buildReviewedMemoryPrompt', () => {
  test('renders reviewed Agent-local memory in confidence order', async () => {
    await withMemoryRegistry(async (registry) => {
      const low = await registry.add({
        scope: 'project',
        cls: 'fact',
        summary: 'User likes short checklists.',
        provenance: [{ kind: 'event', ref: 'test-low' }],
      });
      const high = await registry.add({
        scope: 'project',
        cls: 'constraint',
        summary: 'Never use non-Agent knowledge routes.',
        tags: ['knowledge'],
        provenance: [{ kind: 'event', ref: 'test-high' }],
      });
      registry.review(low.id, { state: 'reviewed', confidence: 70, reviewedBy: 'test' });
      registry.review(high.id, { state: 'reviewed', confidence: 95, reviewedBy: 'test' });

      const prompt = buildReviewedMemoryPrompt(registry);

      expect(prompt).toContain('Reviewed GoodVibes Agent Memory');
      expect(prompt).toContain('[project/constraint 95% tags=knowledge source=event:test-high] Never use non-Agent knowledge routes.');
      expect(prompt).toContain('[project/fact 70% source=event:test-low] User likes short checklists.');
      expect(prompt!.indexOf('Never use non-Agent')).toBeLessThan(prompt!.indexOf('short checklists'));
    });
  });

  test('a genuinely-stored fresh fact (store-default confidence, never reviewed) recalls in a fresh session', async () => {
    // The dogfood repro from the W4-A1 brief: store a fact with no explicit confidence
    // (so it lands at the SDK's own default of 60, reviewState 'fresh'), then build a
    // brand-new prompt (as a fresh session would) and confirm it shows up. Before this
    // fix, a fresh record's confidence (60) could never clear a 70 floor, so a fact
    // stored in one session silently never recalled in the next.
    await withMemoryRegistry(async (registry) => {
      const fact = await registry.add({
        scope: 'project',
        cls: 'fact',
        summary: 'User prefers dark mode in the editor.',
        provenance: [{ kind: 'event', ref: 'fresh-session-repro' }],
      });
      expect(fact.reviewState).toBe('fresh');
      expect(fact.confidence).toBe(60);

      const prompt = buildReviewedMemoryPrompt(registry);

      expect(prompt).not.toBeNull();
      expect(prompt).toContain('User prefers dark mode in the editor.');
      expect(isPromptActiveMemory(fact)).toBe(true);
    });
  });

  test('excludes stale and contradicted memory regardless of confidence, and explicitly low-confidence memory', async () => {
    await withMemoryRegistry(async (registry) => {
      const stale = await registry.add({
        scope: 'project',
        cls: 'fact',
        summary: 'Stale records should stay out no matter how confident they once were.',
        provenance: [{ kind: 'event', ref: 'stale' }],
      });
      const low = await registry.add({
        scope: 'project',
        cls: 'fact',
        summary: 'Explicitly low-confidence records should stay out.',
        provenance: [{ kind: 'event', ref: 'low' }],
      });
      registry.review(stale.id, { state: 'stale', staleReason: 'Outdated', confidence: 95 });
      registry.review(low.id, { state: 'reviewed', confidence: 40, reviewedBy: 'test' });

      const prompt = buildReviewedMemoryPrompt(registry);

      expect(prompt).toBeNull();
      const staleEligibility = describeMemoryPromptEligibility({ ...stale, reviewState: 'stale', confidence: 95 });
      expect(staleEligibility.eligible).toBe(false);
      expect(staleEligibility.reason).toContain('stale');
      const lowEligibility = describeMemoryPromptEligibility({ ...low, reviewState: 'reviewed', confidence: 40 });
      expect(lowEligibility.eligible).toBe(false);
      expect(lowEligibility.reason).toContain('confidence');
    });
  });
});

describe('describeMemoryPromptEligibility', () => {
  test('never returns a blanket-boosted confidence — the reported reason always reflects the record’s own stored confidence and reviewState', async () => {
    await withMemoryRegistry(async (registry) => {
      const record = await registry.add({
        scope: 'project',
        cls: 'fact',
        summary: 'Some fact.',
        provenance: [{ kind: 'session', ref: 'session-123' }],
      });
      const decision = describeMemoryPromptEligibility(record);
      expect(decision.eligible).toBe(true);
      expect(decision.reason).toContain('60%');
      expect(decision.reason).toContain('fresh');
      expect(decision.reason).toContain('session:session-123');
    });
  });

  test('surfaces "no provenance recorded" honestly instead of hiding it', () => {
    const decision = describeMemoryPromptEligibility({
      id: 'mem-no-provenance',
      scope: 'project',
      cls: 'fact',
      summary: 'No provenance.',
      tags: [],
      provenance: [],
      reviewState: 'fresh',
      confidence: 60,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toContain('no provenance recorded');
  });
});
