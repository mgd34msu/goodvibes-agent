import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleCapabilitiesCommand } from '../../cli/capabilities-command.ts';
import type { CliCommandRuntime } from '../../cli/management.ts';
import { parseGoodVibesCli } from '../../cli/parser.ts';
import { ConfigManager } from '../../config/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';

const roots: string[] = [];

function makeRuntime(args: readonly string[]): CliCommandRuntime {
  return {
    cli: parseGoodVibesCli(args),
    configManager: {} as CliCommandRuntime['configManager'],
    workingDirectory: '/tmp/goodvibes-agent-workspace',
    homeDirectory: '/tmp/goodvibes-agent-home',
  };
}

function makeDaemonRuntime(args: readonly string[]): CliCommandRuntime {
  const root = mkdtempSync(join(tmpdir(), 'gv-agent-capabilities-cli-'));
  roots.push(root);
  const workingDirectory = join(root, 'workspace');
  const homeDirectory = join(root, 'home');
  mkdirSync(join(homeDirectory, '.goodvibes', 'daemon'), { recursive: true });
  mkdirSync(workingDirectory, { recursive: true });
  writeFileSync(
    join(homeDirectory, '.goodvibes', 'daemon', 'operator-tokens.json'),
    JSON.stringify({ token: 'test-token' }),
  );
  const configManager = new ConfigManager({
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    workingDir: workingDirectory,
    homeDir: homeDirectory,
  });
  return {
    cli: parseGoodVibesCli(args),
    configManager,
    workingDirectory,
    homeDirectory,
  };
}

function inputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CLI capabilities command', () => {
  test('renders competitor benchmark text', async () => {
    const result = await handleCapabilitiesCommand(makeRuntime(['capabilities']));

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('GoodVibes Agent capability benchmark');
    expect(result.output).toContain('OpenClaw/Hermes');
    expect(result.output).toContain('Isolated Agent Knowledge / Wiki');
  });

  test('returns structured JSON with filtered capability rows', async () => {
    const result = await handleCapabilitiesCommand(makeRuntime(['capabilities', 'hermes', '--json']));
    const parsed = JSON.parse(result.output) as {
      readonly packageName?: string;
      readonly capabilities?: readonly { readonly competitors?: readonly string[] }[];
    };

    expect(result.exitCode).toBe(0);
    expect(parsed.packageName).toBe('@pellux/goodvibes-agent');
    expect(parsed.capabilities?.length).toBeGreaterThan(0);
    expect(parsed.capabilities?.every((capability) => capability.competitors?.includes('hermes'))).toBe(true);
  });

  test('audits live daemon method catalog and isolated Agent Knowledge route', async () => {
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = inputUrl(input);
      requests.push(url);
      if (url.endsWith('/api/goodvibes-agent/knowledge/status')) {
        return new Response(JSON.stringify({ sourceCount: 0, nodeCount: 0, issueCount: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify({ version: '0.33.35' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/control-plane/methods')) {
        return new Response(JSON.stringify({
          methods: [
            { id: 'control.status' },
            { id: 'control.auth.current' },
            { id: 'control.methods.list' },
            { id: 'control.contract' },
            { id: 'control.snapshot' },
            { id: 'channels.status' },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected route' }), { status: 404 });
    }) satisfies typeof fetch;

    try {
      const result = await handleCapabilitiesCommand(makeDaemonRuntime(['capabilities', 'daemon', '--json']));
      const parsed = JSON.parse(result.output) as {
        readonly ok?: boolean;
        readonly kind?: string;
        readonly agentKnowledgeRoute?: string;
        readonly defaultKnowledgeFallback?: boolean;
        readonly homeGraphFallback?: boolean;
        readonly areas?: readonly { readonly id?: string; readonly coverage?: string }[];
      };

      expect(result.exitCode).toBe(0);
      expect(parsed.ok).toBe(true);
      expect(parsed.kind).toBe('daemon.capabilities.audit');
      expect(parsed.agentKnowledgeRoute).toBe('/api/goodvibes-agent/knowledge/status');
      expect(parsed.defaultKnowledgeFallback).toBe(false);
      expect(parsed.homeGraphFallback).toBe(false);
      expect(parsed.areas?.some((area) => area.id === 'gateway-control' && area.coverage === 'ready')).toBe(true);
      expect(requests.some((url) => url.includes('/api/knowledge'))).toBe(false);
      expect(requests.some((url) => url.includes('/api/homegraph'))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('daemon audit returns structured auth failure without token leakage', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = inputUrl(input);
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify({ version: '0.33.35' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }) satisfies typeof fetch;

    try {
      const result = await handleCapabilitiesCommand(makeDaemonRuntime(['capabilities', 'daemon', '--json']));
      const parsed = JSON.parse(result.output) as {
        readonly ok?: boolean;
        readonly kind?: string;
        readonly route?: string;
        readonly error?: string;
      };

      expect(result.exitCode).toBe(1);
      expect(parsed.ok).toBe(false);
      expect(parsed.kind).toBe('auth_required');
      expect(parsed.route).toBe('/api/control-plane/methods');
      expect(parsed.error).not.toContain('test-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('daemon audit reports missing isolated Agent Knowledge route as coverage warning', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = inputUrl(input);
      if (url.endsWith('/api/goodvibes-agent/knowledge/status')) {
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify({ version: '0.33.30' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/control-plane/methods')) {
        return new Response(JSON.stringify({ methods: [{ id: 'control.status' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected route' }), { status: 404 });
    }) satisfies typeof fetch;

    try {
      const result = await handleCapabilitiesCommand(makeDaemonRuntime(['capabilities', 'daemon', '--json']));
      const parsed = JSON.parse(result.output) as {
        readonly ok?: boolean;
        readonly daemonCompatible?: boolean;
        readonly agentKnowledgeRouteReady?: boolean;
        readonly warnings?: readonly string[];
      };

      expect(result.exitCode).toBe(0);
      expect(parsed.ok).toBe(true);
      expect(parsed.daemonCompatible).toBe(false);
      expect(parsed.agentKnowledgeRouteReady).toBe(false);
      expect(parsed.warnings?.some((warning) => warning.includes('0.33.30'))).toBe(true);
      expect(parsed.warnings?.some((warning) => warning.includes('/api/goodvibes-agent/knowledge/status'))).toBe(true);
      expect(result.output).not.toContain('/api/knowledge/status');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('daemon gap report classifies live coverage without default knowledge fallback', async () => {
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = inputUrl(input);
      requests.push(url);
      if (url.endsWith('/api/goodvibes-agent/knowledge/status')) {
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify({ version: '0.33.30' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/control-plane/methods')) {
        return new Response(JSON.stringify({
          methods: [
            {
              id: 'automation.integration.snapshot',
              access: 'authenticated',
              http: { method: 'GET', path: '/api/automation' },
            },
            {
              id: 'schedules.delete',
              access: 'authenticated',
              dangerous: true,
              http: { method: 'DELETE', path: '/api/automation/schedules/{scheduleId}' },
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected route' }), { status: 404 });
    }) satisfies typeof fetch;

    try {
      const result = await handleCapabilitiesCommand(makeDaemonRuntime(['capabilities', 'daemon', 'gaps', '--json']));
      const parsed = JSON.parse(result.output) as {
        readonly ok?: boolean;
        readonly kind?: string;
        readonly defaultKnowledgeFallback?: boolean;
        readonly homeGraphFallback?: boolean;
        readonly gaps?: readonly {
          readonly kind?: string;
          readonly severity?: string;
          readonly detail?: string;
        }[];
      };

      expect(result.exitCode).toBe(0);
      expect(parsed.ok).toBe(true);
      expect(parsed.kind).toBe('daemon.capabilities.gaps');
      expect(parsed.defaultKnowledgeFallback).toBe(false);
      expect(parsed.homeGraphFallback).toBe(false);
      expect(parsed.gaps?.some((gap) => gap.kind === 'version_mismatch' && gap.severity === 'blocker')).toBe(true);
      expect(parsed.gaps?.some((gap) => gap.kind === 'agent_route_missing' && gap.detail === '/api/goodvibes-agent/knowledge/status')).toBe(true);
      expect(parsed.gaps?.some((gap) => gap.kind === 'route_risk_review' && gap.detail?.includes('schedules.delete'))).toBe(true);
      expect(requests.some((url) => url.includes('/api/knowledge'))).toBe(false);
      expect(requests.some((url) => url.includes('/api/homegraph'))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('daemon route risk report uses catalog metadata without default knowledge fallback', async () => {
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = inputUrl(input);
      requests.push(url);
      if (url.endsWith('/api/goodvibes-agent/knowledge/status')) {
        return new Response(JSON.stringify({ sourceCount: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify({ version: '0.33.35' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/api/control-plane/methods')) {
        return new Response(JSON.stringify({
          methods: [
            {
              id: 'approvals.list',
              access: 'authenticated',
              http: { method: 'GET', path: '/api/approvals' },
            },
            {
              id: 'approvals.approve',
              access: 'authenticated',
              http: { method: 'POST', path: '/api/approvals/{id}/approve' },
            },
            {
              id: 'channels.policies.audit',
              access: 'authenticated',
              dangerous: true,
              http: { method: 'POST', path: '/api/channels/policies/audit' },
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected route' }), { status: 404 });
    }) satisfies typeof fetch;

    try {
      const result = await handleCapabilitiesCommand(makeDaemonRuntime(['capabilities', 'daemon', 'risk', '--json']));
      const parsed = JSON.parse(result.output) as {
        readonly ok?: boolean;
        readonly kind?: string;
        readonly defaultKnowledgeFallback?: boolean;
        readonly homeGraphFallback?: boolean;
        readonly totalMutatingMethodCount?: number;
        readonly totalDangerousMethodCount?: number;
        readonly areas?: readonly { readonly dangerousMethodIds?: readonly string[] }[];
      };

      expect(result.exitCode).toBe(0);
      expect(parsed.ok).toBe(true);
      expect(parsed.kind).toBe('daemon.capabilities.route_risk');
      expect(parsed.defaultKnowledgeFallback).toBe(false);
      expect(parsed.homeGraphFallback).toBe(false);
      expect(parsed.totalMutatingMethodCount).toBe(2);
      expect(parsed.totalDangerousMethodCount).toBe(1);
      expect(parsed.areas?.some((area) => area.dangerousMethodIds?.includes('channels.policies.audit'))).toBe(true);
      expect(requests.some((url) => url.includes('/api/knowledge'))).toBe(false);
      expect(requests.some((url) => url.includes('/api/homegraph'))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
