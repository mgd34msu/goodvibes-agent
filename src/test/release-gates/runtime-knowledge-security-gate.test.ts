import { describe, expect, test } from 'bun:test';

import { buildKnowledgeInjectionPrompt } from '@pellux/goodvibes-sdk/platform/state';
import { buildMcpAttackPathReview } from '@/runtime/index.ts';

describe('runtime knowledge and security gate', () => {
  test('knowledge prompt includes reviewed project knowledge with an explainable source trail', () => {
    const knowledgeInjections: Parameters<typeof buildKnowledgeInjectionPrompt>[0] = [{
      id: 'mem-gate-1',
      cls: 'runbook',
      summary: 'Use targeted runtime edits for orchestration store changes',
      reason: 'matched write scope "src/runtime/store"',
      confidence: 95,
      reviewState: 'reviewed',
      trustTier: 'reviewed',
      useAs: 'reference-material',
      retention: 'task-only',
      provenance: {
        source: 'project-memory',
        links: [{ kind: 'file', ref: 'src/runtime/store' }],
      },
      ingestMode: 'keyword-ranked',
    }];
    const knowledgePrompt = buildKnowledgeInjectionPrompt(knowledgeInjections);

    expect(knowledgePrompt).toContain('Injected Project Knowledge');
    expect(knowledgePrompt).toContain('trust reviewed');
    expect(knowledgePrompt).toContain('retention task-only');
    expect(knowledgeInjections[0]?.summary).toContain('orchestration store');
    expect(knowledgeInjections[0]?.reason).toContain('matched');
  });

  test('MCP security review produces programmatic attack-path findings for incoherent servers', () => {
    const review = buildMcpAttackPathReview({
      servers: [{
        name: 'docs',
        role: 'docs',
        trustMode: 'ask-on-risk',
        allowedPaths: [],
        allowedHosts: ['docs.example.com'],
        schemaFreshness: 'quarantined',
        quarantineReason: 'incompatible',
        connected: true,
      }],
      recentDecisions: [{
        serverName: 'docs',
        toolName: 'write_file',
        verdict: 'deny',
        riskLevel: 'critical',
        capability: 'write_fs',
        incoherent: true,
        reason: 'docs server attempted filesystem mutation',
        profileMode: 'ask-on-risk',
        evaluatedAt: Date.now(),
      }],
    });

    expect(review.criticalFindings).toBeGreaterThan(0);
    expect(review.incoherentFindings).toBeGreaterThan(0);
    expect(review.findings[0]?.serverName).toBe('docs');
    expect(review.findings[0]?.reason).toContain('docs');
  });
});
