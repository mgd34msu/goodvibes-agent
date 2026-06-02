import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { ConfigManager } from '../../config/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { createShellPathService } from '@/runtime/index.ts';
import {
  createAgentKnowledgeIngestTool,
  registerAgentKnowledgeIngestTool,
} from '../../tools/agent-knowledge-ingest-tool.ts';

type ShellPaths = ReturnType<typeof shellPaths>;

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
}

interface IngestPayload {
  readonly url?: string;
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly connectorId?: string;
  readonly metadata?: {
    readonly originSurface?: string;
    readonly explicitUserRequest?: string;
  };
}

function shellPaths(withToken = true): ShellPaths {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-knowledge-ingest-tool-'));
  if (withToken) {
    mkdirSync(join(root, '.goodvibes', 'daemon'), { recursive: true });
    writeFileSync(join(root, '.goodvibes', 'daemon', 'operator-tokens.json'), JSON.stringify({ token: 'agent-knowledge-ingest-token' }));
  }
  return createShellPathService({ workingDirectory: root, homeDirectory: root });
}

function configManager(paths: ShellPaths): ConfigManager {
  return new ConfigManager({
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    configDir: paths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT),
    workingDir: paths.workingDirectory,
    homeDir: paths.homeDirectory,
  });
}

function inputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function ingestResponse(): Response {
  return Response.json({
    source: {
      id: 'source-agent-docs',
      canonicalUri: 'https://example.com/agent-docs',
    },
  });
}

describe('agent_knowledge_ingest tool', () => {
  test('previews without calling the connected host when confirmation is missing', async () => {
    const paths = shellPaths();
    const tool = createAgentKnowledgeIngestTool(paths, configManager(paths));
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return ingestResponse();
    }) satisfies typeof fetch;

    try {
      const result = await tool.execute({
        url: 'https://example.com/agent-docs',
        tags: ['docs', 'agent'],
        confirm: false,
        explicitUserRequest: 'Add this docs URL to your Agent wiki.',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent Knowledge URL ingest preview');
      expect(result.error).toContain('/api/goodvibes-agent/knowledge/ingest/url');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('requires explicit user request provenance before ingesting', async () => {
    const paths = shellPaths();
    const tool = createAgentKnowledgeIngestTool(paths, configManager(paths));
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return ingestResponse();
    }) satisfies typeof fetch;

    try {
      const result = await tool.execute({
        url: 'https://example.com/agent-docs',
        confirm: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('explicitUserRequest is required');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ingests URL through only the isolated Agent Knowledge route after explicit confirmation', async () => {
    const paths = shellPaths();
    const tool = createAgentKnowledgeIngestTool(paths, configManager(paths));
    const requests: CapturedRequest[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: inputUrl(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return ingestResponse();
    }) satisfies typeof fetch;

    try {
      const result = await tool.execute({
        url: 'https://example.com/agent-docs',
        title: 'Agent docs',
        tags: ['docs', 'agent'],
        confirm: true,
        explicitUserRequest: 'Add this docs URL to your Agent wiki.',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Agent Knowledge ingest-url accepted');
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe('http://127.0.0.1:3421/api/goodvibes-agent/knowledge/ingest/url');
      expect(requests[0]?.url).not.toContain('/api/knowledge');
      expect(requests[0]?.url).not.toContain('homeGraph');
      expect(requests[0]?.method).toBe('POST');
      const payload = JSON.parse(requests[0]?.body ?? '{}') as IngestPayload;
      expect(payload.url).toBe('https://example.com/agent-docs');
      expect(payload.title).toBe('Agent docs');
      expect(payload.tags).toEqual(['docs', 'agent']);
      expect(payload.connectorId).toBe('goodvibes-agent-main-conversation');
      expect(payload.metadata?.originSurface).toBe('goodvibes-agent');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fails closed without token and does not call default wiki routes', async () => {
    const paths = shellPaths(false);
    const tool = createAgentKnowledgeIngestTool(paths, configManager(paths));
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return ingestResponse();
    }) satisfies typeof fetch;

    try {
      const result = await tool.execute({
        url: 'https://example.com/agent-docs',
        confirm: true,
        explicitUserRequest: 'Add this docs URL to your Agent wiki.',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('auth_required');
      expect(result.error).toContain('/api/goodvibes-agent/knowledge/ingest/url');
      expect(result.error).not.toContain('/api/knowledge');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('is registered in the model tool registry', () => {
    const paths = shellPaths();
    const registry = new ToolRegistry();

    registerAgentKnowledgeIngestTool(registry, paths, configManager(paths));

    expect(registry.has('agent_knowledge_ingest')).toBe(true);
  });
});
