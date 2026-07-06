import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { MemoryEmbeddingProviderRegistry, MemoryRegistry, MemoryStore } from '@pellux/goodvibes-sdk/platform/state';
import { AgentPromptContextReceiptStore, composeRuntimePromptWithReceipt } from '../../agent/prompt-context-receipts.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { createShellPathService } from '@/runtime/index.ts';

async function withReceiptFixture<T>(
  fn: (fixture: {
    readonly root: string;
    readonly shellPaths: ReturnType<typeof createShellPathService>;
    readonly memoryRegistry: MemoryRegistry;
  }) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-prompt-receipts-'));
  const home = join(root, 'home');
  const workspace = join(root, 'workspace');
  mkdirSync(home, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const shellPaths = createShellPathService({ workingDirectory: workspace, homeDirectory: home });
  const configManager = new ConfigManager({
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    configDir: join(home, '.goodvibes', GOODVIBES_AGENT_SURFACE_ROOT),
    workingDir: workspace,
  });
  const embeddingRegistry = new MemoryEmbeddingProviderRegistry({ configManager });
  const store = new MemoryStore(join(root, 'memory.sqlite'), { embeddingRegistry });
  await store.init();
  const memoryRegistry = new MemoryRegistry(store);
  try {
    return await fn({ root, shellPaths, memoryRegistry });
  } finally {
    await store.save();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

describe('prompt context receipts', () => {
  test('composes the runtime prompt and records sanitized selected context', async () => {
    await withReceiptFixture(async ({ root, shellPaths, memoryRegistry }) => {
      writeFileSync(join(shellPaths.workingDirectory, 'VIBE.md'), [
        '---',
        'name: Project Vibe',
        '---',
        'Be direct and make the next user action obvious.',
      ].join('\n'));
      writeFileSync(join(shellPaths.workingDirectory, 'AGENTS.md'), 'Prefer visible autonomous work and reviewable local records.');

      const reviewed = await memoryRegistry.add({
        scope: 'project',
        cls: 'constraint',
        summary: 'Use only Agent-local knowledge routes.',
        provenance: [{ kind: 'event', ref: 'receipt-test' }],
      });
      const lowConfidence = await memoryRegistry.add({
        scope: 'project',
        cls: 'fact',
        summary: 'Low-confidence records should not enter the prompt.',
        provenance: [{ kind: 'event', ref: 'receipt-low-confidence' }],
      });
      memoryRegistry.review(reviewed.id, { state: 'reviewed', confidence: 94, reviewedBy: 'test' });
      memoryRegistry.review(lowConfidence.id, { state: 'reviewed', confidence: 25, reviewedBy: 'test' });

      const composed = composeRuntimePromptWithReceipt({
        sessionId: 'session-receipts',
        turnId: 'turn-receipts',
        source: 'turn',
        provider: 'openai',
        model: { registryKey: 'openai:gpt-4.1', id: 'gpt-4.1' },
        contextWindow: 128_000,
        runtimePrompt: 'Base runtime prompt.',
        operatorPolicy: 'Operator policy prompt.',
        shellPaths,
        memoryRegistry,
      });

      expect(composed.prompt).toContain('Base runtime prompt.');
      expect(composed.prompt).toContain('GoodVibes Agent VIBE.md');
      expect(composed.prompt).toContain('Project Context Files');
      expect(composed.prompt).toContain('Operator policy prompt.');
      expect(composed.prompt).toContain('Reviewed GoodVibes Agent Memory');

      const receipt = composed.receipt;
      expect(receipt.turnId).toBe('turn-receipts');
      expect(receipt.model).toBe('openai:gpt-4.1');
      expect(receipt.promptHash).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.promptChars).toBe(composed.prompt.length);
      expect(receipt.activeRecords).toBeGreaterThan(3);
      expect(receipt.suppressedRecords).toBeGreaterThan(0);

      const memorySegment = receipt.segments.find((segment) => segment.id === 'memory');
      expect(memorySegment?.status).toBe('attention');
      expect(memorySegment?.selected?.some((entry) => entry.id === reviewed.id)).toBe(true);
      expect(memorySegment?.suppressed?.some((entry) => entry.id === lowConfidence.id && String(entry.reason).includes('confidence'))).toBe(true);
      expect(String(memorySegment?.selected?.[0]?.summary ?? '')).toBe('');

      const receiptPath = join(root, 'prompt-context-receipts.jsonl');
      const store = new AgentPromptContextReceiptStore(receiptPath);
      const stored = store.record(receipt);
      const outcome = store.recordTurnOutcome({
        turnId: 'turn-receipts',
        status: 'completed',
        terminalEvent: 'TURN_COMPLETED',
        stopReason: 'completed',
        completedAt: 1_700_000_000_000,
      });
      const reloaded = new AgentPromptContextReceiptStore(receiptPath);

      expect(outcome?.receiptIds).toContain(stored.receiptId);
      expect(store.latest()?.receiptId).toBe(stored.receiptId);
      expect(store.latest()?.turnOutcome?.status).toBe('completed');
      expect(reloaded.latest()?.receiptId).toBe(stored.receiptId);
      expect(reloaded.latest()?.promptHash).toBe(receipt.promptHash);
      expect(reloaded.latest()?.turnOutcome?.terminalEvent).toBe('TURN_COMPLETED');
    });
  });

  test('ranks the memory segment by relevance to the current turn text, with honest per-record wording (W4-A1B)', async () => {
    await withReceiptFixture(async ({ shellPaths, memoryRegistry }) => {
      const onTopic = await memoryRegistry.add({
        scope: 'project',
        cls: 'fact',
        summary: 'The deploy pipeline requires a green typecheck before merge.',
        provenance: [{ kind: 'event', ref: 'on-topic' }],
      });
      const offTopic = await memoryRegistry.add({
        scope: 'project',
        cls: 'fact',
        summary: 'User prefers herbal tea over coffee in the afternoon.',
        provenance: [{ kind: 'event', ref: 'off-topic' }],
      });
      memoryRegistry.review(onTopic.id, { state: 'reviewed', confidence: 61, reviewedBy: 'test' });
      memoryRegistry.review(offTopic.id, { state: 'reviewed', confidence: 95, reviewedBy: 'test' });

      const composed = composeRuntimePromptWithReceipt({
        sessionId: 'session-relevance',
        turnId: 'turn-relevance',
        source: 'turn',
        provider: 'openai',
        model: { registryKey: 'openai:gpt-4.1', id: 'gpt-4.1' },
        contextWindow: 128_000,
        runtimePrompt: 'Base runtime prompt.',
        operatorPolicy: 'Operator policy prompt.',
        shellPaths,
        memoryRegistry,
        turnText: 'what does the deploy pipeline require before merge',
      });

      const memorySegment = composed.receipt.segments.find((segment) => segment.id === 'memory');
      expect(memorySegment?.note).toBeUndefined();
      const onTopicSelected = memorySegment?.selected?.find((entry) => entry.id === onTopic.id);
      const offTopicSelected = memorySegment?.selected?.find((entry) => entry.id === offTopic.id);
      expect(String(onTopicSelected?.relevance ?? '')).toMatch(/^relevance to this turn: \d+%$/);
      expect(String(offTopicSelected?.relevance ?? '')).toMatch(/^relevance to this turn: \d+%$/);
      const onTopicPercent = Number(String(onTopicSelected?.relevance).match(/(\d+)%/)?.[1] ?? '0');
      const offTopicPercent = Number(String(offTopicSelected?.relevance).match(/(\d+)%/)?.[1] ?? '0');
      expect(onTopicPercent).toBeGreaterThan(offTopicPercent);

      // The actual injected prompt (not just the receipt) is ranked the same way — the
      // real seam this closes is the injected content, not only what gets reported.
      expect(composed.prompt.indexOf('deploy pipeline')).toBeLessThan(composed.prompt.indexOf('herbal tea'));
    });
  });

  test('degrades the memory segment honestly (stated reason, no relevance field) when no turn text is supplied', async () => {
    await withReceiptFixture(async ({ shellPaths, memoryRegistry }) => {
      const fact = await memoryRegistry.add({
        scope: 'project',
        cls: 'fact',
        summary: 'A fact recorded with no active turn to rank against.',
        provenance: [{ kind: 'event', ref: 'no-turn' }],
      });
      memoryRegistry.review(fact.id, { state: 'reviewed', confidence: 80, reviewedBy: 'test' });

      const composed = composeRuntimePromptWithReceipt({
        sessionId: 'session-no-turn-text',
        turnId: null,
        source: 'follow_up',
        provider: 'openai',
        model: 'openai:gpt-4.1',
        contextWindow: 128_000,
        runtimePrompt: 'Base runtime prompt.',
        operatorPolicy: 'Operator policy prompt.',
        shellPaths,
        memoryRegistry,
      });

      const memorySegment = composed.receipt.segments.find((segment) => segment.id === 'memory');
      expect(memorySegment?.note).toContain('no current-turn text');
      const selected = memorySegment?.selected?.find((entry) => entry.id === fact.id);
      expect(selected).toBeDefined();
      expect(selected?.relevance).toBeUndefined();
    });
  });
});
