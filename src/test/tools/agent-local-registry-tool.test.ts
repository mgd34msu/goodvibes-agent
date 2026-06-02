import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { createAgentLocalRegistryTool, registerAgentLocalRegistryTool } from '../../tools/agent-local-registry-tool.ts';
import { AgentPersonaRegistry } from '../../agent/persona-registry.ts';
import { AgentRoutineRegistry } from '../../agent/routine-registry.ts';
import { AgentSkillRegistry } from '../../agent/skill-registry.ts';
import { createShellPathService } from '@/runtime/index.ts';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { MemoryEmbeddingProviderRegistry, MemoryRegistry, MemoryStore } from '@pellux/goodvibes-sdk/platform/state';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { buildReviewedMemoryPrompt } from '../../agent/memory-prompt.ts';

type ShellPaths = ReturnType<typeof shellPaths>;

function shellPaths() {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-local-registry-tool-'));
  return createShellPathService({ workingDirectory: root, homeDirectory: root });
}

async function createMemoryRegistry(paths: ShellPaths): Promise<MemoryRegistry> {
  const configManager = new ConfigManager({
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    configDir: paths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT),
    workingDir: paths.workingDirectory,
  });
  const embeddingRegistry = new MemoryEmbeddingProviderRegistry({ configManager });
  const store = new MemoryStore(paths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'memory.sqlite'), { embeddingRegistry });
  await store.init();
  return new MemoryRegistry(store);
}

async function toolFixture(): Promise<{
  readonly paths: ShellPaths;
  readonly memoryRegistry: MemoryRegistry;
  readonly tool: ReturnType<typeof createAgentLocalRegistryTool>;
}> {
  const paths = shellPaths();
  const memoryRegistry = await createMemoryRegistry(paths);
  return {
    paths,
    memoryRegistry,
    tool: createAgentLocalRegistryTool(paths, memoryRegistry),
  };
}

describe('agent_local_registry tool', () => {
  test('creates and reviews Agent-local memory without external side effects', async () => {
    const { memoryRegistry, tool } = await toolFixture();

    const created = await tool.execute({
      domain: 'memory',
      action: 'create',
      cls: 'fact',
      scope: 'project',
      summary: 'User prefers concise morning operator briefings.',
      detail: 'Keep routine briefings under five bullets unless the user asks for detail.',
      tags: ['preference', 'briefing'],
      provenance: 'test-turn',
    });

    expect(created.success).toBe(true);
    expect(created.output).toContain('Created Agent-local memory');
    let records = memoryRegistry.getAll();
    expect(records).toHaveLength(1);
    expect(records[0]?.summary).toBe('User prefers concise morning operator briefings.');
    expect(records[0]?.scope).toBe('project');
    expect(records[0]?.cls).toBe('fact');

    const reviewed = await tool.execute({
      domain: 'memory',
      action: 'review',
      id: records[0]?.id,
      confidence: 92,
    });

    expect(reviewed.success).toBe(true);
    records = memoryRegistry.getAll();
    expect(records[0]?.reviewState).toBe('reviewed');
    expect(records[0]?.confidence).toBe(92);
    expect(buildReviewedMemoryPrompt(memoryRegistry)).toContain('User prefers concise morning operator briefings.');
  });

  test('searches and shows Agent-local memory from the model-visible tool', async () => {
    const { memoryRegistry, tool } = await toolFixture();
    await tool.execute({
      domain: 'memory',
      action: 'create',
      cls: 'constraint',
      summary: 'Never fallback to non-Agent knowledge routes.',
      tags: ['knowledge', 'policy'],
    });

    const searched = await tool.execute({ domain: 'memory', action: 'search', query: 'fallback' });

    expect(searched.success).toBe(true);
    expect(searched.output).toContain('Never fallback');
    const [record] = memoryRegistry.getAll();
    const shown = await tool.execute({ domain: 'memory', action: 'get', id: record?.id });
    expect(shown.success).toBe(true);
    expect(shown.output).toContain('provenance:');
  });

  test('rejects secret-looking Agent memory from the model-visible tool', async () => {
    const { memoryRegistry, tool } = await toolFixture();

    const result = await tool.execute({
      domain: 'memory',
      action: 'create',
      cls: 'fact',
      summary: 'api_key=super-secret-value',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Agent memory cannot store secret-looking values');
    expect(memoryRegistry.getAll()).toHaveLength(0);
  });

  test('creates and enables an Agent-local skill without external side effects', async () => {
    const { paths, tool } = await toolFixture();

    const created = await tool.execute({
      domain: 'skill',
      action: 'create',
      name: 'Inbox triage',
      description: 'Classify and summarize incoming requests.',
      procedure: 'Read the request, classify urgency, summarize the next action.',
      tags: ['mail', 'triage'],
      triggers: ['inbox', 'email'],
      enabled: true,
    });

    expect(created.success).toBe(true);
    expect(created.output).toContain('Created Agent-local skill inbox-triage');
    const snapshot = AgentSkillRegistry.fromShellPaths(paths).snapshot();
    expect(snapshot.skills).toHaveLength(1);
    expect(snapshot.enabledSkills[0]?.source).toBe('agent');
    expect(snapshot.enabledSkills[0]?.provenance).toBe('agent-local-registry-tool');
  });

  test('rejects blank self-created behavior records from the model-visible tool', async () => {
    const { paths, tool } = await toolFixture();

    const persona = await tool.execute({
      domain: 'persona',
      action: 'create',
      name: 'Blank persona',
      description: 'Should be rejected.',
    });
    const skill = await tool.execute({
      domain: 'skill',
      action: 'create',
      name: 'Blank skill',
      description: 'Should be rejected.',
    });
    const routine = await tool.execute({
      domain: 'routine',
      action: 'create',
      name: 'Blank routine',
      description: 'Should be rejected.',
    });

    expect(persona.success).toBe(false);
    expect(persona.error).toContain('body is required');
    expect(skill.success).toBe(false);
    expect(skill.error).toContain('procedure is required');
    expect(routine.success).toBe(false);
    expect(routine.error).toContain('steps is required');
    expect(AgentPersonaRegistry.fromShellPaths(paths).list()).toHaveLength(0);
    expect(AgentSkillRegistry.fromShellPaths(paths).list()).toHaveLength(0);
    expect(AgentRoutineRegistry.fromShellPaths(paths).list()).toHaveLength(0);
  });

  test('creates and enables Agent-local skill bundles from the model-visible tool', async () => {
    const { paths, tool } = await toolFixture();
    await tool.execute({
      domain: 'skill',
      action: 'create',
      name: 'Research brief',
      description: 'Build concise source-backed research summaries.',
      procedure: 'Search sources, extract key facts, cite provenance, and summarize tradeoffs.',
      enabled: true,
    });
    await tool.execute({
      domain: 'skill',
      action: 'create',
      name: 'Action checklist',
      description: 'Turn findings into a short execution checklist.',
      procedure: 'Create a bounded checklist with owners, risks, and next actions.',
      enabled: false,
    });

    const created = await tool.execute({
      domain: 'skill_bundle',
      action: 'create',
      name: 'Research operator',
      description: 'Source-backed research followed by action planning.',
      skills: ['research-brief', 'action-checklist'],
      enabled: true,
    });

    expect(created.success).toBe(true);
    expect(created.output).toContain('Created Agent-local skill bundle research-operator');
    let snapshot = AgentSkillRegistry.fromShellPaths(paths).snapshot();
    expect(snapshot.bundles).toHaveLength(1);
    expect(snapshot.enabledBundles[0]?.skillIds).toEqual(['research-brief', 'action-checklist']);
    expect(snapshot.activeSkills.map((skill) => skill.id)).toEqual(['research-brief', 'action-checklist']);

    const reviewed = await tool.execute({ domain: 'skill_bundle', action: 'review', id: 'research-operator' });
    expect(reviewed.success).toBe(true);
    snapshot = AgentSkillRegistry.fromShellPaths(paths).snapshot();
    expect(snapshot.bundles[0]?.reviewState).toBe('reviewed');

    const searched = await tool.execute({ domain: 'skill_bundle', action: 'search', query: 'research' });
    expect(searched.success).toBe(true);
    expect(searched.output).toContain('research-operator');
  });

  test('rejects Agent-local skill bundles with unknown skill ids', async () => {
    const { paths, tool } = await toolFixture();

    const created = await tool.execute({
      domain: 'skill_bundle',
      action: 'create',
      name: 'Missing bundle',
      description: 'Should not create against missing skills.',
      skillIds: ['missing-skill'],
    });

    expect(created.success).toBe(false);
    expect(created.error).toContain('Unknown skill for bundle');
    expect(AgentSkillRegistry.fromShellPaths(paths).snapshot().bundles).toHaveLength(0);
  });

  test('creates and uses an Agent-local persona', async () => {
    const { paths, tool } = await toolFixture();

    const created = await tool.execute({
      domain: 'persona',
      action: 'create',
      name: 'Travel planner',
      description: 'Plan trips with constraints and clear tradeoffs.',
      body: 'Ask only for missing constraints, then build a practical itinerary.',
      tags: ['travel'],
    });
    expect(created.success).toBe(true);

    const used = await tool.execute({ domain: 'persona', action: 'use', id: 'travel-planner' });
    expect(used.success).toBe(true);
    expect(used.output).toContain('Active Agent-local persona set');
    expect(AgentPersonaRegistry.fromShellPaths(paths).snapshot().activePersona?.id).toBe('travel-planner');
  });

  test('starts a routine only in the same serial conversation', async () => {
    const { paths, tool } = await toolFixture();
    await tool.execute({
      domain: 'routine',
      action: 'create',
      name: 'Morning brief',
      description: 'Review operator state before the day starts.',
      steps: 'Check local memory, work plan, approvals, and Agent Knowledge status.',
      enabled: true,
    });

    const started = await tool.execute({ domain: 'routine', action: 'start', id: 'morning-brief' });

    expect(started.success).toBe(true);
    expect(started.output).toContain('same main conversation');
    expect(started.output).toContain('no hidden background job');
    expect(AgentRoutineRegistry.fromShellPaths(paths).get('morning-brief')?.startCount).toBe(1);
  });

  test('rejects destructive or external actions instead of inventing behavior', async () => {
    const { tool } = await toolFixture();

    const deleted = await tool.execute({ domain: 'skill', action: 'delete', id: 'anything' });
    const deletedBundle = await tool.execute({ domain: 'skill_bundle', action: 'delete', id: 'anything' });
    const deletedMemory = await tool.execute({ domain: 'memory', action: 'delete', id: 'anything' });
    const scheduled = await tool.execute({ domain: 'routine', action: 'schedule', id: 'anything' });

    expect(deleted.success).toBe(false);
    expect(deleted.error).toContain('Unknown action');
    expect(deletedBundle.success).toBe(false);
    expect(deletedBundle.error).toContain('Unknown action');
    expect(deletedMemory.success).toBe(false);
    expect(deletedMemory.error).toContain('Unknown action');
    expect(scheduled.success).toBe(false);
    expect(scheduled.error).toContain('Unknown action');
  });

  test('is registered in the tool registry for model use', async () => {
    const registry = new ToolRegistry();
    const paths = shellPaths();
    const memoryRegistry = await createMemoryRegistry(paths);
    registerAgentLocalRegistryTool(registry, paths, memoryRegistry);

    expect(registry.has('agent_local_registry')).toBe(true);
    const result = await registry.execute('call-1', 'agent_local_registry', {
      domain: 'memory',
      action: 'list',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Agent-local memory');
  });
});
