import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentPersonaRegistry } from '../../agent/persona-registry.ts';
import { AgentRoutineRegistry } from '../../agent/routine-registry.ts';
import { AgentSkillRegistry } from '../../agent/skill-registry.ts';
import { AgentWorkspace } from '../../input/agent-workspace.ts';
import type { CommandContext } from '../../input/command-registry.ts';
import { renderAgentWorkspace } from '../../renderer/agent-workspace.ts';
import type { Line } from '../../types/grid.ts';
import { createShellPathService } from '@/runtime/index.ts';

function text(lines: readonly Line[]): string {
  return lines.map((line) => line.map((cell) => cell.char ?? ' ').join('').trimEnd()).join('\n');
}

function commandContext(): CommandContext {
  return {
    executeCommand: async () => true,
    print: () => undefined,
  } as unknown as CommandContext;
}

function liveCommandContext(): CommandContext {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-render-'));
  const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
  const personas = AgentPersonaRegistry.fromShellPaths(shellPaths);
  personas.create({
    name: 'Research Analyst',
    description: 'Source-backed research posture.',
    body: 'Prefer checked sources and clear unknowns.',
  });
  personas.setActive('research-analyst');
  const skills = AgentSkillRegistry.fromShellPaths(shellPaths);
  skills.create({
    name: 'Briefing',
    description: 'Summarize state before action.',
    procedure: 'Review current daemon, tasks, and approvals first.',
    enabled: true,
  });
  const routines = AgentRoutineRegistry.fromShellPaths(shellPaths);
  routines.create({
    name: 'Daily Brief',
    description: 'Summarize operator state.',
    steps: 'Review current daemon, tasks, approvals, and Agent Knowledge status first.',
    enabled: true,
  });
  return {
    executeCommand: async () => true,
    print: () => undefined,
    session: {
      runtime: {
        model: 'openai:gpt-5.5',
        provider: 'openai-subscriber',
        sessionId: 'agent-session-1',
        debugMode: false,
        systemPrompt: '',
        reasoningEffort: 'medium',
      },
      sessionMemoryStore: { list: () => [{ id: 'mem-1', text: 'remembered preference' }] },
    },
    provider: {
      providerRegistry: {
        getCurrentModel: () => ({
          id: 'gpt-5.5',
          provider: 'openai-subscriber',
          displayName: 'GPT-5.5',
          registryKey: 'openai:gpt-5.5',
          contextWindow: 256000,
        }),
      },
    },
    workspace: {
      shellPaths,
    },
    platform: {
      configManager: {
        get: (key: string) => key === 'controlPlane.port' ? 3421 : key === 'controlPlane.host' ? '127.0.0.1' : undefined,
      },
    },
  } as unknown as CommandContext;
}

describe('renderAgentWorkspace', () => {
  test('renders the operator workspace with categories, actions, and footer controls', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined);

    const output = text(renderAgentWorkspace(workspace, 120, 32));

    expect(output).toContain('GoodVibes Agent / Operator Workspace');
    expect(output).toContain('Operator Areas');
    expect(output).toContain('Home');
    expect(output).toContain('Choose model');
    expect(output).toContain('/model');
    expect(output).toContain('Agent workspace');
    expect(output).toContain('Enter open/action');
  });

  test('renders build delegation as an explicit TUI handoff area', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');

    const output = text(renderAgentWorkspace(workspace, 130, 34));

    expect(output).toContain('Build Delegation');
    expect(output).toContain('GoodVibes TUI');
    expect(output).toContain('WRFC only when explicitly requested');
    expect(output).not.toContain('coding transcript');
  });

  test('renders live Agent context from the command runtime', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);

    const output = text(renderAgentWorkspace(workspace, 132, 34));

    expect(output).toContain('Live Agent Context');
    expect(output).toContain('openai-subscriber / GPT-5.5');
    expect(output).toContain('agent-session-1');
    expect(output).toContain('serial-proactive');
  });

  test('renders local persona posture in the memory workspace', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');

    const output = text(renderAgentWorkspace(workspace, 132, 34));

    expect(output).toContain('Local routines: 1; enabled: 1');
    expect(output).toContain('Local skills: 1; enabled: 1');
    expect(output).toContain('Local personas: 1; active: Research Analyst');
    expect(output).toContain('/routines');
    expect(output).toContain('/agent-skills');
    expect(output).toContain('/personas');
  });

  test('renders action feedback and refresh affordance', () => {
    const workspace = new AgentWorkspace();
    workspace.open(liveCommandContext(), () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'remote-policy');
    workspace.activateSelected();

    const output = text(renderAgentWorkspace(workspace, 132, 34));

    expect(output).toContain('Action Result');
    expect(output).toContain('Remote runner policy is blocked in Agent');
    expect(output).toContain('/remote dispatch');
    expect(output).toContain('R refresh');
  });
});
