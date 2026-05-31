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

function shellPaths() {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-local-registry-tool-'));
  return createShellPathService({ workingDirectory: root, homeDirectory: root });
}

describe('agent_local_registry tool', () => {
  test('creates and enables an Agent-local skill without daemon side effects', async () => {
    const paths = shellPaths();
    const tool = createAgentLocalRegistryTool(paths);

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

  test('creates and uses an Agent-local persona', async () => {
    const paths = shellPaths();
    const tool = createAgentLocalRegistryTool(paths);

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
    const paths = shellPaths();
    const tool = createAgentLocalRegistryTool(paths);
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
    const paths = shellPaths();
    const tool = createAgentLocalRegistryTool(paths);

    const deleted = await tool.execute({ domain: 'skill', action: 'delete', id: 'anything' });
    const scheduled = await tool.execute({ domain: 'routine', action: 'schedule', id: 'anything' });

    expect(deleted.success).toBe(false);
    expect(deleted.error).toContain('Unknown action');
    expect(scheduled.success).toBe(false);
    expect(scheduled.error).toContain('Unknown action');
  });

  test('is registered in the tool registry for model use', async () => {
    const registry = new ToolRegistry();
    registerAgentLocalRegistryTool(registry, shellPaths());

    expect(registry.has('agent_local_registry')).toBe(true);
    const result = await registry.execute('call-1', 'agent_local_registry', {
      domain: 'skill',
      action: 'list',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Agent-local skills');
  });
});
