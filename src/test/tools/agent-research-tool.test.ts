import { describe, expect, test } from 'bun:test';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { CommandContext, CommandRegistry } from '../../input/command-registry.ts';
import { createAgentResearchTool, registerAgentResearchTool } from '../../tools/agent-research-tool.ts';

function fakeTool(name: string, calls: Record<string, unknown>[]): Tool {
  return {
    definition: {
      name,
      description: 'Fake tool',
      parameters: { type: 'object', additionalProperties: true },
    },
    execute: async (args: Record<string, unknown>) => {
      calls.push({ tool: name, ...args });
      return { success: true, output: JSON.stringify({ name, args }) };
    },
  };
}

function makeTool(calls: Record<string, unknown>[] = []): Tool {
  return createAgentResearchTool({
    commandRegistry: {} as CommandRegistry,
    commandContext: { workspace: {}, platform: {} } as CommandContext,
    toolRegistry: new ToolRegistry(),
    harnessTool: fakeTool('agent_harness', calls),
    runsTool: fakeTool('agent_research_runs', calls),
    sourcesTool: fakeTool('agent_research_sources', calls),
    reportTool: fakeTool('agent_research_report', calls),
    artifactTool: fakeTool('agent_artifacts', calls),
  });
}

describe('research adapter', () => {
  test('routes plan, run, and source reads to research harness modes', async () => {
    const calls: Record<string, unknown>[] = [];
    const tool = makeTool(calls);

    await tool.execute({ action: 'plan', query: 'Compare local agent products.', includeParameters: true });
    await tool.execute({ action: 'runs', query: 'agent products', limit: 5 });
    await tool.execute({ action: 'run', runId: 'run_123' });
    await tool.execute({ action: 'sources', query: 'odysseus' });
    await tool.execute({ action: 'source', sourceId: 'src_123' });

    expect(calls).toEqual([
      { tool: 'agent_harness', mode: 'research_workflow', query: 'Compare local agent products.', includeParameters: true },
      { tool: 'agent_harness', mode: 'research_runs', query: 'agent products', limit: 5 },
      { tool: 'agent_harness', mode: 'research_run', runId: 'run_123' },
      { tool: 'agent_harness', mode: 'research_queue', query: 'odysseus' },
      { tool: 'agent_harness', mode: 'research_source', sourceId: 'src_123' },
    ]);
  });

  test('infers a research plan from plain query input', async () => {
    const calls: Record<string, unknown>[] = [];
    const tool = makeTool(calls);

    await tool.execute({ query: 'Find sources on local browser agents.' });

    expect(calls).toEqual([
      { tool: 'agent_harness', mode: 'research_workflow', query: 'Find sources on local browser agents.' },
    ]);
  });

  test('routes browser-backed runner readiness to the detailed research workflow contract', async () => {
    const calls: Record<string, unknown>[] = [];
    const tool = makeTool(calls);

    await tool.execute({ action: 'runner' });
    await tool.execute({ action: 'browser', query: 'authenticated market research', includeParameters: false });

    expect(calls).toEqual([
      { tool: 'agent_harness', mode: 'research_workflow', query: 'browser-backed research runner', includeParameters: true },
      { tool: 'agent_harness', mode: 'research_workflow', query: 'authenticated market research', includeParameters: false },
    ]);
  });

  test('routes saved research report artifact reads to the artifact browser', async () => {
    const calls: Record<string, unknown>[] = [];
    const tool = makeTool(calls);

    await tool.execute({ action: 'reports', query: 'browser agents', limit: 3 });
    await tool.execute({ action: 'report_artifact', artifactId: 'artifact_123', previewBytes: 4096 });
    await tool.execute({ action: 'show_report', reportArtifactId: 'artifact_456', includeContent: false });

    expect(calls).toEqual([
      { tool: 'agent_artifacts', mode: 'list', purpose: 'agent-research-report', query: 'browser agents', limit: 3 },
      { tool: 'agent_artifacts', mode: 'show', artifactId: 'artifact_123', includeContent: true, previewBytes: 4096 },
      { tool: 'agent_artifacts', mode: 'show', artifactId: 'artifact_456', includeContent: false },
    ]);
  });

  test('routes source bundle and confirmed writes to existing research tools', async () => {
    const calls: Record<string, unknown>[] = [];
    const tool = makeTool(calls);

    await tool.execute({ action: 'bundle', query: 'browser agents', limit: 4 });
    await tool.execute({
      action: 'create_run',
      title: 'Browser agent comparison',
      question: 'Which local browser agents are strongest?',
      plan: ['Search', 'Review', 'Report'],
      confirm: true,
      explicitUserRequest: 'Start a visible research run.',
    });
    await tool.execute({
      action: 'add_source',
      question: 'Which local browser agents are strongest?',
      title: 'Odysseus README',
      url: 'https://example.test/odysseus',
      summary: 'Local-first browser agent notes.',
      confirm: true,
      explicitUserRequest: 'Capture this source.',
    });
    await tool.execute({
      action: 'review_source',
      sourceId: 'src_123',
      credibility: 'high',
      score: 90,
      note: 'Primary project source.',
      confirm: true,
      explicitUserRequest: 'Review this source.',
    });
    await tool.execute({
      action: 'report',
      title: 'Browser agent comparison report',
      question: 'Which local browser agents are strongest?',
      sources: [{ title: 'Odysseus README', credibility: 'high' }],
      visualReport: true,
      confirm: true,
      explicitUserRequest: 'Save this sourced report.',
    });

    expect(calls).toEqual([
      { tool: 'agent_research_sources', mode: 'bundle', query: 'browser agents', limit: 4, includeReportLines: true },
      {
        tool: 'agent_research_runs',
        mode: 'create',
        title: 'Browser agent comparison',
        question: 'Which local browser agents are strongest?',
        plan: ['Search', 'Review', 'Report'],
        confirm: true,
        explicitUserRequest: 'Start a visible research run.',
      },
      {
        tool: 'agent_research_sources',
        mode: 'add',
        question: 'Which local browser agents are strongest?',
        title: 'Odysseus README',
        url: 'https://example.test/odysseus',
        summary: 'Local-first browser agent notes.',
        confirm: true,
        explicitUserRequest: 'Capture this source.',
      },
      {
        tool: 'agent_research_sources',
        mode: 'review',
        id: 'src_123',
        credibility: 'high',
        score: 90,
        note: 'Primary project source.',
        confirm: true,
        explicitUserRequest: 'Review this source.',
      },
      {
        tool: 'agent_research_report',
        title: 'Browser agent comparison report',
        question: 'Which local browser agents are strongest?',
        sources: [{ title: 'Odysseus README', credibility: 'high' }],
        visualReport: true,
        confirm: true,
        explicitUserRequest: 'Save this sourced report.',
      },
    ]);
  });

  test('routes confirmed run lifecycle and source status changes', async () => {
    const calls: Record<string, unknown>[] = [];
    const tool = makeTool(calls);

    await tool.execute({
      action: 'checkpoint',
      runId: 'run_123',
      phase: 'reading',
      progress: 45,
      sourceIds: ['src_123'],
      confirm: true,
      explicitUserRequest: 'Checkpoint this research run.',
    });
    await tool.execute({
      action: 'pause',
      id: 'run_123',
      note: 'Waiting for user review.',
      confirm: true,
      explicitUserRequest: 'Pause the research run.',
    });
    await tool.execute({
      action: 'complete',
      id: 'run_123',
      reportArtifactId: 'artifact_123',
      confirm: true,
      explicitUserRequest: 'Complete the research run.',
    });
    await tool.execute({
      action: 'reject_source',
      sourceId: 'src_123',
      note: 'Outdated secondary source.',
      confirm: true,
      explicitUserRequest: 'Reject this source.',
    });
    await tool.execute({
      action: 'use_source',
      sourceId: 'src_456',
      reportArtifactId: 'artifact_123',
      confirm: true,
      explicitUserRequest: 'Mark this source used.',
    });

    expect(calls).toEqual([
      {
        tool: 'agent_research_runs',
        mode: 'checkpoint',
        id: 'run_123',
        phase: 'reading',
        progress: 45,
        sourceIds: ['src_123'],
        confirm: true,
        explicitUserRequest: 'Checkpoint this research run.',
      },
      {
        tool: 'agent_research_runs',
        mode: 'pause',
        id: 'run_123',
        note: 'Waiting for user review.',
        confirm: true,
        explicitUserRequest: 'Pause the research run.',
      },
      {
        tool: 'agent_research_runs',
        mode: 'complete',
        id: 'run_123',
        reportArtifactId: 'artifact_123',
        confirm: true,
        explicitUserRequest: 'Complete the research run.',
      },
      {
        tool: 'agent_research_sources',
        mode: 'reject',
        id: 'src_123',
        note: 'Outdated secondary source.',
        confirm: true,
        explicitUserRequest: 'Reject this source.',
      },
      {
        tool: 'agent_research_sources',
        mode: 'use',
        id: 'src_456',
        reportArtifactId: 'artifact_123',
        confirm: true,
        explicitUserRequest: 'Mark this source used.',
      },
    ]);
  });

  test('registers the direct research adapter', () => {
    const registry = new ToolRegistry();

    registerAgentResearchTool(registry, {} as CommandRegistry, { workspace: {}, platform: {} } as CommandContext);

    expect(registry.has('research')).toBe(true);
  });
});
