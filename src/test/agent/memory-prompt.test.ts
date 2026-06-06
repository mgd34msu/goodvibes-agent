import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { MemoryEmbeddingProviderRegistry, MemoryRegistry, MemoryStore } from '@pellux/goodvibes-sdk/platform/state';
import { buildReviewedMemoryPrompt } from '../../agent/memory-prompt.ts';
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

  test('excludes fresh stale and low-confidence memory', async () => {
    await withMemoryRegistry(async (registry) => {
      const fresh = await registry.add({
        scope: 'project',
        cls: 'fact',
        summary: 'Fresh records should wait for review.',
        provenance: [{ kind: 'event', ref: 'fresh' }],
      });
      const stale = await registry.add({
        scope: 'project',
        cls: 'fact',
        summary: 'Stale records should stay out.',
        provenance: [{ kind: 'event', ref: 'stale' }],
      });
      const low = await registry.add({
        scope: 'project',
        cls: 'fact',
        summary: 'Low confidence records should stay out.',
        provenance: [{ kind: 'event', ref: 'low' }],
      });
      const borderline = await registry.add({
        scope: 'project',
        cls: 'fact',
        summary: 'Borderline records should stay out too.',
        provenance: [{ kind: 'event', ref: 'borderline' }],
      });
      registry.review(stale.id, { state: 'stale', staleReason: 'Outdated' });
      registry.review(low.id, { state: 'reviewed', confidence: 49, reviewedBy: 'test' });
      registry.review(borderline.id, { state: 'reviewed', confidence: 69, reviewedBy: 'test' });

      const prompt = buildReviewedMemoryPrompt(registry);

      expect(prompt).toBeNull();
      expect(fresh.reviewState).toBe('fresh');
    });
  });
});
