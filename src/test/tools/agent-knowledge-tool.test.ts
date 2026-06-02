import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { ConfigManager } from '../../config/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { createShellPathService } from '@/runtime/index.ts';
import {
  createAgentKnowledgeTool,
  registerAgentKnowledgeTool,
} from '../../tools/agent-knowledge-tool.ts';

type ShellPaths = ReturnType<typeof shellPaths>;

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
}

function shellPaths(withToken = true): ShellPaths {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-knowledge-tool-'));
  if (withToken) {
    mkdirSync(join(root, '.goodvibes', 'daemon'), { recursive: true });
    writeFileSync(join(root, '.goodvibes', 'daemon', 'operator-tokens.json'), JSON.stringify({ token: 'agent-knowledge-tool-token' }));
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

function statusResponse(): Response {
  return new Response(JSON.stringify({
    ready: true,
    sourceCount: 0,
    nodeCount: 0,
    edgeCount: 0,
    issueCount: 0,
    storagePath: 'knowledge-agent.sqlite',
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function askResponse(): Response {
  return new Response(JSON.stringify({
    query: 'What is GoodVibes Agent?',
    answer: {
      text: 'No Agent-owned knowledge has been ingested yet.',
      mode: 'standard',
      confidence: 0,
      synthesized: false,
      sources: [],
      facts: [],
      linkedObjects: [],
      gaps: [],
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function searchResponse(): Response {
  return new Response(JSON.stringify({
    query: 'GoodVibes Agent',
    results: [],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('agent_knowledge tool', () => {
  test('status uses only the isolated Agent Knowledge status route', async () => {
    const paths = shellPaths();
    const tool = createAgentKnowledgeTool(paths, configManager(paths));
    const requests: CapturedRequest[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: inputUrl(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return statusResponse();
    }) satisfies typeof fetch;

    try {
      const result = await tool.execute({ action: 'status' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Agent Knowledge status');
      expect(requests.map((request) => request.url)).toEqual([
        'http://127.0.0.1:3421/api/goodvibes-agent/knowledge/status',
      ]);
      expect(requests.some((request) => request.url.includes('/api/knowledge'))).toBe(false);
      expect(requests.some((request) => request.url.includes('homeGraph'))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ask uses only the isolated Agent Knowledge ask route', async () => {
    const paths = shellPaths();
    const tool = createAgentKnowledgeTool(paths, configManager(paths));
    const requests: CapturedRequest[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: inputUrl(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return askResponse();
    }) satisfies typeof fetch;

    try {
      const result = await tool.execute({
        action: 'ask',
        query: 'What is GoodVibes Agent?',
        mode: 'standard',
        limit: 4,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No Agent-owned knowledge has been ingested yet.');
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe('http://127.0.0.1:3421/api/goodvibes-agent/knowledge/ask');
      expect(requests[0]?.url).not.toContain('/api/knowledge');
      expect(requests[0]?.url).not.toContain('homeGraph');
      expect(requests[0]?.method).toBe('POST');
      expect(requests[0]?.body).toContain('"query":"What is GoodVibes Agent?"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('search uses only the isolated Agent Knowledge search route', async () => {
    const paths = shellPaths();
    const tool = createAgentKnowledgeTool(paths, configManager(paths));
    const requests: CapturedRequest[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: inputUrl(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });
      return searchResponse();
    }) satisfies typeof fetch;

    try {
      const result = await tool.execute({
        action: 'search',
        query: 'GoodVibes Agent',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Agent Knowledge search');
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe('http://127.0.0.1:3421/api/goodvibes-agent/knowledge/search');
      expect(requests[0]?.url).not.toContain('/api/knowledge');
      expect(requests[0]?.url).not.toContain('homeGraph');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fails closed without token and does not call default wiki routes', async () => {
    const paths = shellPaths(false);
    const tool = createAgentKnowledgeTool(paths, configManager(paths));
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return statusResponse();
    }) satisfies typeof fetch;

    try {
      const result = await tool.execute({ action: 'ask', query: 'What is GoodVibes Agent?' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('auth_required');
      expect(result.error).toContain('/api/goodvibes-agent/knowledge/*');
      expect(result.error).not.toContain('/api/knowledge');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('is registered in the model tool registry', () => {
    const paths = shellPaths();
    const registry = new ToolRegistry();

    registerAgentKnowledgeTool(registry, paths, configManager(paths));

    expect(registry.has('agent_knowledge')).toBe(true);
  });
});
