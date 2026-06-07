import { describe, expect, test } from 'bun:test';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { CommandContext, CommandRegistry } from '../../input/command-registry.ts';
import { createAgentHarnessTool } from '../../tools/agent-harness-tool.ts';
import { createAgentRouteTool, registerAgentRouteTool } from '../../tools/agent-route-tool.ts';

function fakeContext(): CommandContext {
  return {
    workspace: {},
    platform: {
      config: {
        behavior: { autoApprove: false },
        permissions: { mode: 'prompt', tools: {} },
      },
    },
    session: { runtime: {} },
  } as CommandContext;
}

async function route(query: string, includeParameters = false): Promise<Record<string, unknown>> {
  const tool = createAgentRouteTool(fakeContext());
  const result = await tool.execute({ action: 'plan', query, includeParameters });
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.error);
  return JSON.parse(result.output) as Record<string, unknown>;
}

function preferredId(body: Record<string, unknown>): string {
  const preferred = body.preferred as { readonly id?: unknown };
  return typeof preferred?.id === 'string' ? preferred.id : '';
}

describe('route adapter', () => {
  test('returns usage without making a routing guess when no task is supplied', async () => {
    const tool = createAgentRouteTool(fakeContext());
    const result = await tool.execute({});

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const body = JSON.parse(result.output) as { readonly status: string; readonly usage: string };
    expect(body.status).toBe('ready');
    expect(body.usage).toContain('route action:"plan"');
  });

  test('routes inbox and reply work to Personal Ops intake', async () => {
    const body = await route('triage my inbox and draft replies');

    expect(preferredId(body)).toBe('personal-ops-request');
    expect(body.preferred).toMatchObject({
      modelRoute: 'personal_ops action:"intake" query:"triage my inbox and draft replies"',
      userSurface: 'Personal Ops workspace',
    });
  });

  test('routes one-off deep research to the research planner', async () => {
    const body = await route('do deep research on the market map and cite sources');

    expect(preferredId(body)).toBe('deep-research-workflow');
    expect(body.preferred).toMatchObject({
      inspectRoute: 'research action:"briefing"',
      userSurface: 'Research workspace',
    });
  });

  test('routes recurring research reports through visible autonomy intake', async () => {
    const body = await route('run a weekly source-backed research report');

    expect(preferredId(body)).toBe('autonomy-intake');
    expect(body.preferred).toMatchObject({
      modelRoute: 'autonomy action:"intake" query:"run a weekly source-backed research report" includeParameters:true',
      requiresConfirmation: true,
    });
  });

  test('routes parallel coding work to delegated build posture', async () => {
    const body = await route('fix the failing tests in parallel');

    expect(preferredId(body)).toBe('delegated-build-work');
    expect(body.preferred).toMatchObject({
      modelRoute: 'delegation action:"status" includeParameters:true',
      requiresConfirmation: true,
    });
  });

  test('routes command-shaped background work to local process controls', async () => {
    const body = await route('run pytest -v tests/ in background');

    expect(preferredId(body)).toBe('local-background-process');
    expect(body.preferred).toMatchObject({
      modelRoute: 'execution action:"processes" includeParameters:true',
      inspectRoute: 'execution action:"capabilities"',
      requiresConfirmation: true,
    });
  });

  test('keeps scheduled background work on visible autonomy intake', async () => {
    const body = await route('run a weekly source-backed research report in background');

    expect(preferredId(body)).toBe('autonomy-intake');
  });

  test('routes screenshot and browser-control tasks through the computer planner', async () => {
    const body = await route('take a screenshot of the logged-in browser dashboard');

    expect(preferredId(body)).toBe('browser-control-workflow-plan');
    expect(body.preferred).toMatchObject({
      modelRoute: 'computer action:"plan" query:"take a screenshot of the logged-in browser dashboard" includeParameters:true',
      inspectRoute: 'computer action:"control" includeParameters:true',
      requiresConfirmation: true,
    });
  });

  test('keeps plain browser-open requests on the Browser/PWA readiness route', async () => {
    const body = await route('open the browser dashboard');

    expect(preferredId(body)).toBe('browser-computer-capability');
    expect(body.preferred).toMatchObject({
      modelRoute: 'computer action:"status" includeParameters:true',
      inspectRoute: 'computer action:"browser" includeParameters:true',
    });
  });

  test('returns catalog matches and scores only when parameters are requested', async () => {
    const compact = await route('compare models for this document');
    const compactPreferred = compact.preferred as { readonly score?: number };
    expect(compactPreferred.score).toBeUndefined();

    const detailed = await route('compare models for this document', true);
    const detailedPreferred = detailed.preferred as { readonly score?: number };
    expect(detailedPreferred.score).toBeGreaterThan(0);
    expect((detailed.workspaceMatches as readonly unknown[]).length).toBeGreaterThan(0);
    expect((detailed.harnessModeMatches as readonly unknown[]).length).toBeGreaterThan(0);
  });

  test('exposes the same planner through agent_harness route_decision', async () => {
    const harness = createAgentHarnessTool({
      commandRegistry: {} as CommandRegistry,
      commandContext: fakeContext(),
      toolRegistry: new ToolRegistry(),
    });
    const result = await harness.execute({ mode: 'route_decision', query: 'set up ollama local model' });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    const body = JSON.parse(result.output) as Record<string, unknown>;
    expect(preferredId(body)).toBe('model-provider-routing');
  });

  test('registers the direct route adapter once', () => {
    const registry = new ToolRegistry();

    registerAgentRouteTool(registry, fakeContext());
    registerAgentRouteTool(registry, fakeContext());

    expect(registry.has('route')).toBe(true);
    expect(registry.getToolDefinitions().filter((definition) => definition.name === 'route')).toHaveLength(1);
  });
});
