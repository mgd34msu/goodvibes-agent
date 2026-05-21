import { describe, expect, test } from 'bun:test';
import { formatKnowledgeAnswer, formatKnowledgeSearch } from '../src/assistant/knowledge-format.js';
import { summarizeAuth } from '../src/daemon/diagnostics-format.js';

describe('knowledge formatting', () => {
  test('renders concise answers with source and metadata lines', () => {
    const output = formatKnowledgeAnswer({
      ok: true,
      spaceId: 'default',
      query: 'what is the agent',
      answer: {
        text: 'GoodVibes Agent is a proactive operator surface.',
        mode: 'standard',
        confidence: 0.92,
        sources: [
          {
            id: 'source-1',
            connectorId: 'url',
            sourceType: 'url',
            title: 'Agent README',
            sourceUri: 'https://example.test/agent',
            summary: 'Source-backed overview of the GoodVibes Agent product.',
            tags: [],
            status: 'indexed',
            metadata: { noisy: 'metadata should not be dumped' },
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        linkedObjects: [],
        facts: [
          {
            id: 'fact-1',
            kind: 'fact',
            slug: 'agent-operator',
            title: 'Agent is operator-first',
            summary: 'It defaults to serial proactive operation.',
            aliases: [],
            status: 'active',
            confidence: 88,
            metadata: {},
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        gaps: [
          {
            id: 'gap-1',
            kind: 'gap',
            slug: 'release-gap',
            title: 'Release criteria still need validation',
            aliases: [],
            status: 'active',
            confidence: 55,
            metadata: {},
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        refinementTaskIds: ['task-1'],
      },
      results: [],
    });

    expect(output).toContain('GoodVibes Agent is a proactive operator surface.');
    expect(output).toContain('Confidence: 92%');
    expect(output).toContain('Sources');
    expect(output).toContain('Agent README');
    expect(output).toContain('https://example.test/agent');
    expect(output).toContain('Facts');
    expect(output).toContain('Gaps');
    expect(output).toContain('Refinement tasks: task-1');
    expect(output).not.toContain('metadata should not be dumped');
  });

  test('renders empty search clearly', () => {
    expect(formatKnowledgeSearch({ results: [] }, 'missing thing')).toBe('No knowledge results for "missing thing".');
  });

  test('groups search results and trims source records', () => {
    const output = formatKnowledgeSearch({
      results: [
        {
          kind: 'source',
          id: 'source-1',
          score: 72,
          reason: 'semantic match',
          source: {
            id: 'source-1',
            connectorId: 'url',
            sourceType: 'url',
            title: 'Agent Docs',
            sourceUri: 'https://example.test/docs',
            summary: 'Concise source snippet.',
            tags: [],
            status: 'indexed',
            metadata: { ignored: true },
            createdAt: 1,
            updatedAt: 2,
          },
        },
        {
          kind: 'node',
          id: 'node-1',
          score: 40,
          reason: 'node match',
          node: {
            id: 'node-1',
            kind: 'fact',
            slug: 'agent-fact',
            title: 'Agent fact',
            summary: 'Concise node snippet.',
            aliases: [],
            status: 'active',
            confidence: 90,
            metadata: {},
            createdAt: 1,
            updatedAt: 2,
          },
        },
      ],
    }, 'agent');

    expect(output).toContain('Found 2 knowledge results.');
    expect(output).toContain('Sources');
    expect(output).toContain('Agent Docs [url] (source-1) score 72');
    expect(output).toContain('Nodes');
    expect(output).toContain('Agent fact [fact] (node-1) score 40');
    expect(output).not.toContain('ignored');
  });
});

describe('auth formatting', () => {
  test('summarizes auth without carrying token fields forward', () => {
    const summary = summarizeAuth({
      authenticated: true,
      authMode: 'shared-token',
      tokenPresent: true,
      authorizationHeaderPresent: true,
      sessionCookiePresent: false,
      principalId: 'shared-token',
      principalKind: 'token',
      admin: true,
      token: 'super-secret-token',
      accessToken: 'another-secret',
      scopes: ['read:knowledge', 'write:knowledge', 'read:auth'],
      roles: ['operator'],
    });
    const serialized = JSON.stringify(summary);

    expect(summary.scopesCount).toBe(3);
    expect(summary.readScopesCount).toBe(2);
    expect(summary.writeScopesCount).toBe(1);
    expect(serialized).not.toContain('super-secret-token');
    expect(serialized).not.toContain('another-secret');
  });
});
