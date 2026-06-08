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

  test('routes browser-backed research runner wording to runner readiness', async () => {
    const body = await route('check browser-backed research runner readiness');

    expect(preferredId(body)).toBe('research-browser-runner-readiness');
    expect(body.preferred).toMatchObject({
      modelRoute: 'research action:"runner" query:"check browser-backed research runner readiness" includeParameters:true',
      inspectRoute: 'research action:"runner" includeParameters:true',
      requiresConfirmation: false,
    });
  });

  test('routes visual research report rendering to the report workflow contract', async () => {
    const body = await route('render the visual research report in the browser');

    expect(preferredId(body)).toBe('research-visual-report-workflow');
    expect(body.preferred).toMatchObject({
      modelRoute: 'research action:"plan" query:"render the visual research report in the browser" includeParameters:true',
      inspectRoute: 'research action:"reports" query:"visual report" includeParameters:true',
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

  test('routes daemon health checks to connected-host diagnostics', async () => {
    const body = await route('check daemon health');

    expect(preferredId(body)).toBe('host-runtime-diagnostics');
    expect(body.preferred).toMatchObject({
      modelRoute: 'host action:"status" includeParameters:true',
      inspectRoute: 'host action:"capabilities" includeParameters:true',
      requiresConfirmation: false,
    });
  });

  test('routes direct reminder requests through the schedule tool', async () => {
    const body = await route('remind me tomorrow to stretch');

    expect(preferredId(body)).toBe('direct-schedule-route');
    expect(body.preferred).toMatchObject({
      modelRoute: 'schedule action:"list" query:"remind me tomorrow to stretch" limit:5',
      inspectRoute: 'schedule action:"list"',
      requiresConfirmation: true,
    });
  });

  test('routes normal settings requests to the first-class settings tool', async () => {
    const body = await route('change the theme setting');

    expect(preferredId(body)).toBe('agent-settings-configuration');
    expect(body.preferred).toMatchObject({
      modelRoute: 'settings action:"list" query:"change the theme setting" includeParameters:true',
      inspectRoute: 'settings action:"list" includeParameters:true',
      requiresConfirmation: true,
    });
  });

  test('routes named external memory providers to provider posture', async () => {
    const body = await route('connect Supermemory as an external memory provider');

    expect(preferredId(body)).toBe('external-memory-provider-posture');
    expect(body.preferred).toMatchObject({
      modelRoute: 'memory action:"provider" providerId:"supermemory" includeParameters:true',
      inspectRoute: 'host action:"capability" query:"supermemory memory provider"',
      requiresConfirmation: true,
    });
  });

  test('routes generic external memory setup to the memory provider contract checklist', async () => {
    const body = await route('set up cross-session memory sync');

    expect(preferredId(body)).toBe('external-memory-provider-posture');
    expect(body.preferred).toMatchObject({
      modelRoute: 'memory action:"status" query:"external memory provider" includeParameters:true',
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

  test('routes interactive terminal and sudo requests to process capability posture first', async () => {
    const body = await route('run claude code with pty=true and handle sudo prompts');

    expect(preferredId(body)).toBe('interactive-process-capability');
    expect(body.preferred).toMatchObject({
      modelRoute: 'execution action:"process_capabilities"',
      inspectRoute: 'setup action:"item" setupItemId:"sudo-execution-posture"',
      requiresConfirmation: true,
    });
  });

  test('does not confuse process documentation wording with stdin process control', async () => {
    const body = await route('write process documentation');

    expect(preferredId(body)).not.toBe('interactive-process-capability');
  });

  test('keeps scheduled background work on visible autonomy intake', async () => {
    const body = await route('run a weekly source-backed research report in background');

    expect(preferredId(body)).toBe('autonomy-intake');
  });

  test('routes file undo requests to recovery inspection', async () => {
    const body = await route('undo the last file edit');

    expect(preferredId(body)).toBe('local-file-recovery');
    expect(body.preferred).toMatchObject({
      modelRoute: 'execution action:"recovery" includeParameters:true',
      inspectRoute: 'execution action:"history" includeParameters:true',
      requiresConfirmation: true,
    });
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

  test('routes image generation through confirmed media artifacts', async () => {
    const body = await route('generate an image of a clean product dashboard');

    expect(preferredId(body)).toBe('media-generation-artifact');
    expect(body.preferred).toMatchObject({
      modelRoute: 'device action:"provider" target:"media" includeParameters:true',
      inspectRoute: 'agent_harness mode:"media_posture" includeParameters:true',
      requiresConfirmation: true,
    });
  });

  test('routes voice workflow requests through voice posture', async () => {
    const body = await route('set up push-to-talk and voice memo transcription');

    expect(preferredId(body)).toBe('voice-workflow-posture');
    expect(body.preferred).toMatchObject({
      modelRoute: 'device action:"voice" query:"set up push-to-talk and voice memo transcription" includeParameters:true',
      inspectRoute: 'device action:"voice" includeParameters:true',
      requiresConfirmation: true,
    });
  });

  test('routes TTS provider setup through provider posture', async () => {
    const body = await route('choose a TTS provider for spoken responses');

    expect(preferredId(body)).toBe('tts-provider-posture');
    expect(body.preferred).toMatchObject({
      modelRoute: 'device action:"provider" target:"tts" includeParameters:true',
      inspectRoute: 'device action:"voice" includeParameters:true',
      requiresConfirmation: true,
    });
  });

  test('keeps plain browser-open requests on the Browser/PWA readiness route', async () => {
    const body = await route('open the browser dashboard');

    expect(preferredId(body)).toBe('browser-cockpit-readiness');
    expect(body.preferred).toMatchObject({
      modelRoute: 'computer action:"browser" includeParameters:true',
      inspectRoute: 'workspace action:"surface" surfaceId:"connected-browser-cockpit" includeParameters:true',
      requiresConfirmation: true,
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
