import { describe, expect, test } from 'bun:test';
import type { InputToken } from '@pellux/goodvibes-sdk/platform/core';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { AgentWorkspace, buildAgentWorkspaceRuntimeSnapshot, handleAgentWorkspaceToken } from '../../input/agent-workspace.ts';
import { AGENT_WORKSPACE_CATEGORIES } from '../../input/agent-workspace-categories.ts';
import { registerBuiltinCommands } from '../../input/commands.ts';
import { registerAgentWorkspaceRuntimeCommands } from '../../input/commands/agent-workspace-runtime.ts';
import { registerAgentRuntimeProfileRuntimeCommands } from '../../input/commands/agent-runtime-profile-runtime.ts';
import { AgentPersonaRegistry } from '../../agent/persona-registry.ts';
import { AgentRoutineRegistry } from '../../agent/routine-registry.ts';
import { AgentSkillRegistry } from '../../agent/skill-registry.ts';
import { createAgentRuntimeProfile, listAgentRuntimeProfiles } from '../../agent/runtime-profile.ts';
import { renderAgentWorkspace } from '../../renderer/agent-workspace.ts';
import { parseSlashCommand } from '../../input/slash-command-parser.ts';
import { createShellPathService } from '@/runtime/index.ts';
import type { MemoryApi } from '@pellux/goodvibes-sdk/platform/knowledge';
import type { MemoryRecord } from '@pellux/goodvibes-sdk/platform/state';
import type { Line } from '../../types/grid.ts';

function linesText(lines: readonly Line[]): string {
  return lines.map((line) => line.map((cell) => cell.char).join('')).join('\n');
}

function feedWorkspaceToken(workspace: AgentWorkspace, token: InputToken): void {
  handleAgentWorkspaceToken(workspace, token, () => undefined, () => undefined);
}

function feedText(workspace: AgentWorkspace, value: string): void {
  feedWorkspaceToken(workspace, { type: 'text', value });
}

function feedKey(workspace: AgentWorkspace, logicalName: string): void {
  feedWorkspaceToken(workspace, { type: 'key', logicalName, ctrl: false, shift: false, meta: false });
}

function commandContext(calls: string[] = []): CommandContext {
  return {
    executeCommand: async (name: string, args: string[]) => {
      calls.push([name, ...args].join(' '));
      return true;
    },
    print: (text: string) => {
      calls.push(`print:${text}`);
    },
  } as unknown as CommandContext;
}

function routineWorkspaceContext(): CommandContext {
  const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-routine-form-'));
  const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
  AgentRoutineRegistry.fromShellPaths(shellPaths).create({
    name: 'Daily Brief',
    description: 'Summarize operator state.',
    steps: 'Review current tasks, approvals, and Agent Knowledge status first.',
    enabled: true,
  });
  return {
    ...commandContext(),
    workspace: { shellPaths },
  } as unknown as CommandContext;
}

function memoryRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = Date.now();
  return {
    id: 'mem-preference',
    scope: 'project',
    cls: 'fact',
    summary: 'Prefers concise operator briefings',
    detail: 'Use short summaries before action.',
    tags: ['preference'],
    provenance: [],
    reviewState: 'fresh',
    confidence: 82,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function vectorStats() {
  return {
    backend: 'sqlite-vec' as const,
    enabled: false,
    available: false,
    path: '',
    dimensions: 0,
    indexedRecords: 0,
    embeddingProviderId: 'none',
    embeddingProviderLabel: 'None',
  };
}

function memoryApi(records: MemoryRecord[] = [memoryRecord()]): MemoryApi {
  return {
    add: async (input) => {
      const record = memoryRecord({
        id: `mem-${records.length + 1}`,
        scope: input.scope ?? 'project',
        cls: input.cls,
        summary: input.summary,
        detail: input.detail,
        tags: [...(input.tags ?? [])],
        provenance: [...(input.provenance ?? [])],
        reviewState: input.review?.state ?? 'fresh',
        confidence: input.review?.confidence ?? 80,
      });
      records.unshift(record);
      return record;
    },
    search: () => records,
    searchSemantic: () => [],
    vectorStats,
    rebuildVectors: vectorStats,
    rebuildVectorsAsync: async () => vectorStats(),
    doctor: async () => ({
      vector: vectorStats(),
      embeddings: {
        activeProviderId: 'none',
        providers: [],
        asyncProviders: [],
        syncProviders: [],
        warnings: [],
      },
      checkedAt: Date.now(),
    }),
    reviewQueue: () => records.filter((record) => record.reviewState !== 'reviewed'),
    exportBundle: () => ({
      schemaVersion: 'v1',
      exportedAt: Date.now(),
      scope: 'all',
      recordCount: records.length,
      linkCount: 0,
      records,
      links: [],
    }),
    importBundle: async () => ({ importedRecords: 0, skippedRecords: 0, importedLinks: 0 }),
    get: (id) => records.find((record) => record.id === id) ?? null,
    getAll: () => records,
    link: async () => null,
    linksFor: () => [],
    update: (id, patch) => {
      const index = records.findIndex((record) => record.id === id);
      const current = records[index];
      if (!current) return null;
      const updated: MemoryRecord = {
        ...current,
        ...patch,
        updatedAt: Date.now(),
      };
      records[index] = updated;
      return updated;
    },
    review: (id, patch) => {
      const index = records.findIndex((record) => record.id === id);
      const current = records[index];
      if (!current) return null;
      const updated: MemoryRecord = {
        ...current,
        reviewState: patch.state ?? current.reviewState,
        confidence: patch.confidence ?? current.confidence,
        reviewedBy: patch.reviewedBy ?? current.reviewedBy,
        reviewedAt: Date.now(),
        staleReason: patch.staleReason,
        updatedAt: Date.now(),
      };
      records[index] = updated;
      return updated;
    },
    delete: (id) => {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return false;
      records.splice(index, 1);
      return true;
    },
    explain: () => ({ injections: [], prompt: null }),
  };
}

describe('AgentWorkspace', () => {
  test('parses quoted workspace slash commands for schedule promotion', () => {
    const parsed = parseSlashCommand('/schedule promote-routine daily-brief --cron "0 9 * * *" --delivery-channel "slack:ops alerts" --yes');

    expect(parsed.name).toBe('schedule');
    expect(parsed.args).toEqual([
      'promote-routine',
      'daily-brief',
      '--cron',
      '0 9 * * *',
      '--delivery-channel',
      'slack:ops alerts',
      '--yes',
    ]);
  });

  test('all workspace slash command actions resolve through the Agent command registry', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    const missingCommands = AGENT_WORKSPACE_CATEGORIES.flatMap((category) => (
      category.actions.flatMap((action) => {
        const command = action.command?.trim();
        if (!command?.startsWith('/')) return [];
        const root = command.slice(1).split(/\s+/)[0];
        return root && !registry.get(root)
          ? [`${category.id}/${action.id}: ${command}`]
          : [];
      })
    ));

    expect(missingCommands).toEqual([]);
  });

  test('opens as an operator workspace and keeps guidance actions local', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));

    expect(workspace.active).toBe(true);
    expect(workspace.selectedCategory.label).toBe('Home');
    expect(workspace.selectedAction?.label).toBe('Continue assistant chat');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.status).toContain('main conversation');
  });

  test('dispatches command actions through the shell-owned callback', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'model');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/model']);
    expect(workspace.status).toContain('/model');
  });

  test('dispatches operator briefing from the home workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'brief');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/brief']);
    expect(workspace.status).toContain('/brief');
  });

  test('work workspace reviews work plan from transcript instead of opening a panel', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'work');

    const commands = workspace.actions.map((action) => action.command).filter(Boolean);
    expect(commands).not.toContain('/workplan panel');
    expect(commands).not.toContain('/approval open');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'workplan');
    workspace.activateSelected();

    expect(dispatched).toEqual(['/workplan list']);
    expect(workspace.status).toContain('/workplan list');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'approvals');
    workspace.activateSelected();

    expect(dispatched).toEqual(['/workplan list', '/approval matrix']);
    expect(workspace.status).toContain('/approval matrix');
  });

  test('opens local persona library workspace from memory', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.selectedCategory.id).toBe('personas');
    expect(workspace.status).toContain('Opened Personas');
  });

  test('opens local skill library workspace from memory', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.selectedCategory.id).toBe('skills');
    expect(workspace.status).toContain('Opened Skills');
  });

  test('opens local routine library workspace from memory', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.selectedCategory.id).toBe('routines');
    expect(workspace.status).toContain('Opened Routines');
  });

  test('dispatches channel pairing through the command router', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'channels');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'pair');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/pair']);
    expect(workspace.status).toContain('/pair');
  });

  test('home workspace jumps directly into setup without dispatching a command', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'setup-home');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.selectedCategory.id).toBe('setup');
    expect(workspace.focusPane).toBe('actions');
    expect(workspace.lastActionResult?.kind).toBe('refreshed');
    expect(workspace.status).toContain('Opened Setup');
  });

  test('setup workspace keeps personas skills and routines as direct workspaces', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'setup-personas');
    workspace.activateSelected();
    expect(workspace.selectedCategory.id).toBe('personas');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'setup-skills');
    workspace.activateSelected();
    expect(workspace.selectedCategory.id).toBe('skills');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'setup-routines');
    workspace.activateSelected();
    expect(workspace.selectedCategory.id).toBe('routines');
    expect(dispatched).toEqual([]);
  });

  test('home and setup workspaces jump to Tools and MCP without dispatching commands', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'tools-home');
    workspace.activateSelected();
    expect(workspace.selectedCategory.id).toBe('tools');
    expect(workspace.status).toContain('Opened Tools & MCP');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'setup-tools');
    workspace.activateSelected();
    expect(workspace.selectedCategory.id).toBe('tools');
    expect(dispatched).toEqual([]);
  });

  test('opens the fullscreen MCP workspace from Tools and MCP through the shell command router', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'tools');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'mcp-workspace');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/mcp']);
    expect(workspace.lastActionResult?.title).toBe('Opening Open MCP workspace');
  });

  test('renders local persona skill and routine library workspaces from live Agent state', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-local-libraries-'));
    const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
    const persona = AgentPersonaRegistry.fromShellPaths(shellPaths).create({
      name: 'Household Operator',
      description: 'Coordinates home, schedule, and device requests.',
      body: 'Prefer concise proactive execution with explicit approval for external sends.',
      tags: ['home'],
    });
    AgentPersonaRegistry.fromShellPaths(shellPaths).setActive(persona.id);
    AgentSkillRegistry.fromShellPaths(shellPaths).create({
      name: 'Trip Prep',
      description: 'Prepare reusable travel checklists and reminders.',
      procedure: 'Gather dates, destination, reservations, packing, and reminders.',
      tags: ['travel'],
      enabled: true,
    });
    AgentRoutineRegistry.fromShellPaths(shellPaths).create({
      name: 'Morning Brief',
      description: 'Review calendar, weather, work plan, and pending approvals.',
      steps: 'Check calendar, weather, work plan, approvals, and reminders.',
      triggers: ['weekday'],
      enabled: true,
    });
    const ctx = {
      ...commandContext(),
      workspace: { shellPaths },
    } as unknown as CommandContext;
    const snapshot = buildAgentWorkspaceRuntimeSnapshot(ctx);

    expect(snapshot.localPersonas[0]?.name).toBe('Household Operator');
    expect(snapshot.localPersonas[0]?.active).toBe(true);
    expect(snapshot.localSkills[0]?.enabled).toBe(true);
    expect(snapshot.localRoutines[0]?.name).toBe('Morning Brief');

    const workspace = new AgentWorkspace();
    workspace.open(ctx, () => undefined);

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'personas');
    expect(linesText(renderAgentWorkspace(workspace, 140, 34))).toContain('Household Operator');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');
    expect(linesText(renderAgentWorkspace(workspace, 140, 34))).toContain('Trip Prep');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'routines');
    expect(linesText(renderAgentWorkspace(workspace, 140, 34))).toContain('Morning Brief');
  });

  test('renders Agent-owned memory in the workspace without default knowledge fallback', () => {
    const ctx = {
      ...commandContext(),
      clients: {
        agentKnowledgeApi: {
          memory: memoryApi([
            memoryRecord({
              id: 'mem-source-policy',
              cls: 'constraint',
              scope: 'project',
              summary: 'Never fallback to non-Agent knowledge segments',
              detail: 'Agent Knowledge and local memory are separate Agent-owned surfaces.',
              reviewState: 'reviewed',
              confidence: 100,
            }),
          ]),
        },
      },
    } as unknown as CommandContext;
    const workspace = new AgentWorkspace();
    workspace.open(ctx, () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');

    const output = linesText(renderAgentWorkspace(workspace, 150, 42));

    expect(workspace.runtimeSnapshot?.localMemoryCount).toBe(1);
    expect(workspace.runtimeSnapshot?.localMemoryPromptActiveCount).toBe(1);
    expect(output).toContain('Agent memory: 1; prompt-active: 1; review queue: 0');
    expect(output).toContain('Never fallback to non-Agent knowledge segments');
    expect(output).toContain('project/constraint');
    expect(output).not.toContain('default Knowledge/Wiki');
  });

  test('library workspace actions open editors and dispatch only concrete commands', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'personas');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas-list');
    workspace.activateSelected();
    expect(dispatched).toEqual(['/personas list']);

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-create');
    workspace.activateSelected();
    expect(dispatched).toEqual(['/personas list']);
    expect(workspace.localEditor?.kind).toBe('skill');
    workspace.cancelLocalEditor();

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'routines');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-receipts');
    workspace.activateSelected();
    expect(dispatched).toEqual(['/personas list', '/routines receipts']);
  });

  test('creates local skill routine and persona records from workspace editors', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-editor-'));
    const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
    const ctx = {
      ...commandContext(),
      workspace: { shellPaths },
    } as unknown as CommandContext;
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(ctx, (command) => dispatched.push(command));

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-create');
    workspace.activateSelected();
    feedText(workspace, 'Briefing');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Summarize state before action.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Check daemon status, work plan, approvals, and Agent Knowledge first.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'briefing,setup');
    feedKey(workspace, 'enter');
    feedText(workspace, 'ops');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');

    expect(AgentSkillRegistry.fromShellPaths(shellPaths).snapshot().enabledSkills[0]?.name).toBe('Briefing');
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.title).toBe('Created skill');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'routines');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-create');
    workspace.activateSelected();
    feedText(workspace, 'Daily Brief');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Review the operator state.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Check calendar, tasks, approvals, and channels.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'weekday');
    feedKey(workspace, 'enter');
    feedText(workspace, 'home');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');

    expect(AgentRoutineRegistry.fromShellPaths(shellPaths).snapshot().enabledRoutines[0]?.name).toBe('Daily Brief');
    expect(workspace.lastActionResult?.title).toBe('Created routine');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'personas');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas-create');
    workspace.activateSelected();
    feedText(workspace, 'Research Analyst');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Source-backed answers.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Prefer checked sources and clear unknowns.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'research');
    feedKey(workspace, 'enter');
    feedText(workspace, 'research');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');

    const personaSnapshot = AgentPersonaRegistry.fromShellPaths(shellPaths).snapshot();
    expect(personaSnapshot.activePersona?.name).toBe('Research Analyst');
    expect(workspace.lastActionResult?.title).toBe('Created persona');
    expect(dispatched).toEqual([]);
  });

  test('creates skill bundles from an in-workspace form with concrete skill ids', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-create-bundle');

    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('skill-bundle');
    feedText(workspace, 'Daily Ops');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Daily operations bundle');
    feedKey(workspace, 'enter');
    feedText(workspace, 'briefing,calendar-review');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/agent-skills bundle create --name "Daily Ops" --description "Daily operations bundle" --skills briefing,calendar-review --enabled',
    ]);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.title).toBe('Opening skill bundle creation');
  });

  test('adds MCP servers from the workspace only after typed confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'tools');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'mcp-add-server');

    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('mcp-server');
    feedText(workspace, 'filesystem');
    feedKey(workspace, 'enter');
    feedText(workspace, 'bunx');
    feedKey(workspace, 'enter');
    feedText(workspace, '-y @modelcontextprotocol/server-filesystem .');
    feedKey(workspace, 'enter');
    feedText(workspace, 'project');
    feedKey(workspace, 'enter');
    feedText(workspace, 'filesystem');
    feedKey(workspace, 'enter');
    feedText(workspace, 'constrained');
    feedKey(workspace, 'enter');
    feedText(workspace, 'FS_TOKEN=goodvibes://secrets/mcp/FS_TOKEN');
    feedKey(workspace, 'enter');
    feedText(workspace, '/home/buzzkill/Projects');
    feedKey(workspace, 'enter');
    feedText(workspace, 'docs.example.test');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.message).toContain('not confirmed');

    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/mcp add filesystem bunx -y @modelcontextprotocol/server-filesystem . --scope project --role filesystem --trust constrained --env FS_TOKEN=goodvibes://secrets/mcp/FS_TOKEN --path /home/buzzkill/Projects --host docs.example.test --yes',
    ]);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.title).toBe('Opening MCP server add/update');
  });

  test('adds notification webhook targets from the workspace only after typed confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'channels');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'notification-add-webhook');

    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('notify-webhook');
    feedText(workspace, 'https://ntfy.sh/goodvibes-agent-alerts');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.message).toContain('not confirmed');

    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/notify add https://ntfy.sh/goodvibes-agent-alerts --yes']);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.title).toBe('Opening notification webhook add');
  });

  test('removes notification webhook targets from the workspace only after typed confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'channels');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'notification-remove-webhook');

    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('notify-webhook-remove');
    feedText(workspace, 'https://ntfy.sh/goodvibes-agent-alerts');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.message).toContain('not confirmed');

    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/notify remove https://ntfy.sh/goodvibes-agent-alerts --yes']);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.title).toBe('Opening notification webhook remove');
  });

  test('tests notification webhook targets from the workspace only after typed confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'channels');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'notification-test-webhooks');

    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('notify-webhook-test');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.message).toContain('not confirmed');

    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/notify test --yes']);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.title).toBe('Opening notification webhook test');
  });

  test('discovers and imports local skill files from the workspace after confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-discover');
    workspace.activateSelected();
    expect(dispatched).toEqual(['/agent-skills discover']);

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-import-discovered');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('skill-discovery-import');
    feedText(workspace, 'Travel Planner');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    expect(workspace.localEditor?.message).toContain('Confirm is required');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(workspace.localEditor?.message).toContain('not confirmed');
    expect(dispatched).toEqual(['/agent-skills discover']);

    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/agent-skills discover',
      '/agent-skills import-discovered "Travel Planner" --enabled --yes',
    ]);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.title).toBe('Opening discovered skill import');
  });

  test('creates reviews marks stale and deletes Agent memory from workspace editors', async () => {
    const records: MemoryRecord[] = [];
    const ctx = {
      ...commandContext(),
      workspace: {
        shellPaths: createShellPathService({
          workingDirectory: mkdtempSync(join(tmpdir(), 'goodvibes-agent-memory-workspace-')),
          homeDirectory: mkdtempSync(join(tmpdir(), 'goodvibes-agent-memory-home-')),
        }),
      },
      clients: {
        agentKnowledgeApi: {
          memory: memoryApi(records),
        },
      },
    } as unknown as CommandContext;
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(ctx, (command) => dispatched.push(command));

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-create');
    workspace.activateSelected();
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Prefers concise briefings');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Summarize before action.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'preference');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    await Promise.resolve();
    await Promise.resolve();

    expect(records[0]?.summary).toBe('Prefers concise briefings');
    expect(records[0]?.confidence).toBe(80);
    expect(workspace.lastActionResult?.title).toBe('Created memory');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-review');
    workspace.activateSelected();
    expect(records[0]?.reviewState).toBe('reviewed');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-stale');
    workspace.activateSelected();
    expect(records[0]?.reviewState).toBe('stale');
    expect(records[0]?.staleReason).toContain('Agent workspace');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-delete');
    workspace.activateSelected();
    expect(workspace.localEditor?.title).toBe('Delete Memory');
    feedText(workspace, records[0]?.id ?? '');
    feedKey(workspace, 'enter');

    expect(records).toHaveLength(0);
    expect(dispatched).toEqual([]);
  });

  test('rejects secret-looking Agent memory from the workspace editor', async () => {
    const records: MemoryRecord[] = [];
    const ctx = {
      ...commandContext(),
      clients: {
        agentKnowledgeApi: {
          memory: memoryApi(records),
        },
      },
    } as unknown as CommandContext;
    const workspace = new AgentWorkspace();
    workspace.open(ctx, () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-create');
    workspace.activateSelected();
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, 'api_key=sk-secretsecretsecretsecret');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    await Promise.resolve();

    expect(records).toHaveLength(0);
    expect(workspace.localEditor?.message).toContain('cannot store secret-looking values');
  });

  test('operates on selected local library records without dispatching commands', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-selected-library-'));
    const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
    const personaRegistry = AgentPersonaRegistry.fromShellPaths(shellPaths);
    personaRegistry.create({
      name: 'Home Operator',
      description: 'Home posture.',
      body: 'Coordinate home tasks.',
    });
    personaRegistry.create({
      name: 'Research Analyst',
      description: 'Research posture.',
      body: 'Check sources.',
    });
    const skillRegistry = AgentSkillRegistry.fromShellPaths(shellPaths);
    skillRegistry.create({
      name: 'Briefing',
      description: 'Summarize before action.',
      procedure: 'Inspect state first.',
    });
    skillRegistry.create({
      name: 'Travel Prep',
      description: 'Prepare travel workflow.',
      procedure: 'Check itinerary and packing.',
    });
    const routineRegistry = AgentRoutineRegistry.fromShellPaths(shellPaths);
    routineRegistry.create({
      name: 'Daily Brief',
      description: 'Daily operator summary.',
      steps: 'Review current state.',
    });
    const ctx = {
      ...commandContext(),
      workspace: { shellPaths },
    } as unknown as CommandContext;
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(ctx, (command) => dispatched.push(command));

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'personas');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas-next');
    workspace.activateSelected();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas-use');
    workspace.activateSelected();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas-review');
    workspace.activateSelected();

    expect(AgentPersonaRegistry.fromShellPaths(shellPaths).snapshot().activePersona?.name).toBe('Research Analyst');
    expect(AgentPersonaRegistry.fromShellPaths(shellPaths).get('research-analyst')?.reviewState).toBe('reviewed');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-next');
    workspace.activateSelected();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-enable');
    workspace.activateSelected();
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-review');
    workspace.activateSelected();

    expect(AgentSkillRegistry.fromShellPaths(shellPaths).get('travel-prep')?.enabled).toBe(true);
    expect(AgentSkillRegistry.fromShellPaths(shellPaths).get('travel-prep')?.reviewState).toBe('reviewed');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'routines');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-start');
    workspace.activateSelected();

    const routine = AgentRoutineRegistry.fromShellPaths(shellPaths).get('daily-brief');
    expect(routine?.startCount).toBe(0);
    expect(dispatched).toEqual(['/routines start daily-brief']);
    expect(workspace.lastActionResult?.title).toBe('Opening routine Daily Brief');
  });

  test('edits selected local library records from workspace editors without dispatching commands', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-edit-library-'));
    const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
    const personaRegistry = AgentPersonaRegistry.fromShellPaths(shellPaths);
    const persona = personaRegistry.create({
      name: 'Home Operator',
      description: 'Home posture.',
      body: 'Coordinate home tasks.',
      tags: ['home'],
      triggers: ['house'],
    });
    personaRegistry.setActive(persona.id);
    const skillRegistry = AgentSkillRegistry.fromShellPaths(shellPaths);
    const skill = skillRegistry.create({
      name: 'Briefing',
      description: 'Summarize before action.',
      procedure: 'Inspect state first.',
      enabled: true,
    });
    const routineRegistry = AgentRoutineRegistry.fromShellPaths(shellPaths);
    const routine = routineRegistry.create({
      name: 'Daily Brief',
      description: 'Daily operator summary.',
      steps: 'Review current state.',
      enabled: true,
    });
    const ctx = {
      ...commandContext(),
      workspace: { shellPaths },
    } as unknown as CommandContext;
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(ctx, (command) => dispatched.push(command));

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'personas');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas-edit');
    workspace.activateSelected();
    expect(workspace.localEditor?.title).toBe('Edit Persona');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, ' Include errands.');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    const updatedPersona = AgentPersonaRegistry.fromShellPaths(shellPaths).get(persona.id);
    expect(updatedPersona?.body).toContain('Include errands.');
    expect(updatedPersona?.reviewState).toBe('fresh');
    expect(AgentPersonaRegistry.fromShellPaths(shellPaths).snapshot().activePersonaId).toBe(persona.id);

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-edit');
    workspace.activateSelected();
    expect(workspace.localEditor?.recordId).toBe(skill.id);
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, ' Then summarize risks.');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    const updatedSkill = AgentSkillRegistry.fromShellPaths(shellPaths).get(skill.id);
    expect(updatedSkill?.procedure).toContain('Then summarize risks.');
    expect(updatedSkill?.enabled).toBe(true);

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'routines');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-edit');
    workspace.activateSelected();
    expect(workspace.localEditor?.recordId).toBe(routine.id);
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, ' Report blockers.');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    const updatedRoutine = AgentRoutineRegistry.fromShellPaths(shellPaths).get(routine.id);
    expect(updatedRoutine?.steps).toContain('Report blockers.');
    expect(updatedRoutine?.enabled).toBe(true);
    expect(dispatched).toEqual([]);
  });

  test('deletes selected local library records only after exact typed confirmation', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-delete-library-'));
    const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
    const personaRegistry = AgentPersonaRegistry.fromShellPaths(shellPaths);
    const persona = personaRegistry.create({
      name: 'Temporary Persona',
      description: 'Temporary posture.',
      body: 'Temporary guidance.',
    });
    personaRegistry.setActive(persona.id);
    const skill = AgentSkillRegistry.fromShellPaths(shellPaths).create({
      name: 'Temporary Skill',
      description: 'Temporary procedure.',
      procedure: 'Temporary steps.',
    });
    const routine = AgentRoutineRegistry.fromShellPaths(shellPaths).create({
      name: 'Temporary Routine',
      description: 'Temporary workflow.',
      steps: 'Temporary routine steps.',
    });
    const ctx = {
      ...commandContext(),
      workspace: { shellPaths },
    } as unknown as CommandContext;
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(ctx, (command) => dispatched.push(command));

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'personas');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas-delete');
    workspace.activateSelected();
    feedText(workspace, 'wrong-id');
    feedKey(workspace, 'enter');
    expect(AgentPersonaRegistry.fromShellPaths(shellPaths).get(persona.id)).not.toBeNull();
    expect(workspace.localEditor?.message).toContain('Deletion not confirmed');
    while (workspace.localEditor?.fields[0]?.value) feedKey(workspace, 'backspace');
    feedText(workspace, persona.id);
    feedKey(workspace, 'enter');
    expect(AgentPersonaRegistry.fromShellPaths(shellPaths).get(persona.id)).toBeNull();
    expect(AgentPersonaRegistry.fromShellPaths(shellPaths).snapshot().activePersonaId).toBeNull();

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-delete');
    workspace.activateSelected();
    feedText(workspace, skill.id);
    feedKey(workspace, 'enter');
    expect(AgentSkillRegistry.fromShellPaths(shellPaths).get(skill.id)).toBeNull();

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'routines');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-delete');
    workspace.activateSelected();
    feedText(workspace, routine.id);
    feedKey(workspace, 'enter');
    expect(AgentRoutineRegistry.fromShellPaths(shellPaths).get(routine.id)).toBeNull();
    expect(dispatched).toEqual([]);
  });

  test('keeps channel delivery safety guidance local', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'channels');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'channel-safety');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.lastActionResult?.kind).toBe('guidance');
    expect(workspace.status).toContain('will not silently send');
  });

  test('summarizes channel readiness without exposing secret config values', () => {
    const configValues = new Map<string, unknown>([
      ['surfaces.slack.enabled', true],
      ['surfaces.slack.botToken', 'goodvibes://secrets/goodvibes/SLACK_BOT_TOKEN'],
      ['surfaces.slack.signingSecret', 'goodvibes://secrets/goodvibes/SLACK_SIGNING_SECRET'],
      ['surfaces.slack.defaultChannel', '#ops'],
      ['surfaces.discord.enabled', true],
      ['surfaces.discord.botToken', 'goodvibes://secrets/goodvibes/DISCORD_BOT_TOKEN'],
    ]);
    const snapshot = buildAgentWorkspaceRuntimeSnapshot({
      ...commandContext(),
      platform: {
        configManager: {
          get: (key: string) => configValues.get(key),
        },
      },
    } as unknown as CommandContext);

    const slack = snapshot.channels.find((channel) => channel.id === 'slack');
    const discord = snapshot.channels.find((channel) => channel.id === 'discord');

    expect(snapshot.channels).toHaveLength(13);
    expect(slack?.ready).toBe(true);
    expect(slack?.defaultTarget).toBe('configured');
    expect(slack?.delivery).toBe('default-ready');
    expect(discord?.ready).toBe(false);
    expect(discord?.missingConfigCount).toBe(2);
    expect(JSON.stringify(snapshot.channels)).not.toContain('SLACK_BOT_TOKEN');
    expect(JSON.stringify(snapshot.channels)).not.toContain('DISCORD_BOT_TOKEN');
  });

  test('channels command prints read-only readiness without secret values', async () => {
    const printed: string[] = [];
    const configValues = new Map<string, unknown>([
      ['surfaces.slack.enabled', true],
      ['surfaces.slack.botToken', 'goodvibes://secrets/goodvibes/SLACK_BOT_TOKEN'],
      ['surfaces.slack.signingSecret', 'goodvibes://secrets/goodvibes/SLACK_SIGNING_SECRET'],
      ['surfaces.slack.defaultChannel', '#ops'],
      ['surfaces.telegram.enabled', true],
      ['surfaces.telegram.botToken', 'goodvibes://secrets/goodvibes/TELEGRAM_BOT_TOKEN'],
    ]);
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);

    await registry.execute('channels', [], {
      ...commandContext(),
      print: (text: string) => printed.push(text),
      platform: {
        configManager: {
          get: (key: string) => configValues.get(key),
        },
      },
    } as unknown as CommandContext);

    const output = printed.join('\n');
    expect(output).toContain('Channel Readiness');
    expect(output).toContain('ready: 2/13');
    expect(output).toContain('Slack: ready ready=yes delivery=default-ready risk=group');
    expect(output).toContain('Telegram: needs-target ready=yes delivery=explicit-target risk=dm');
    expect(output).toContain('policy: read-only inspection');
    expect(output).toContain('sends require explicit user action');
    expect(output).not.toContain('SLACK_BOT_TOKEN');
    expect(output).not.toContain('TELEGRAM_BOT_TOKEN');
  });

  test('builds a first-run setup checklist from live Agent state', () => {
    const configValues = new Map<string, unknown>([
      ['controlPlane.host', '127.0.0.1'],
      ['controlPlane.port', 3421],
      ['surfaces.slack.enabled', true],
      ['surfaces.slack.botToken', 'goodvibes://secrets/goodvibes/SLACK_BOT_TOKEN'],
      ['surfaces.slack.signingSecret', 'goodvibes://secrets/goodvibes/SLACK_SIGNING_SECRET'],
      ['surfaces.slack.defaultChannel', '#ops'],
    ]);
    const snapshot = buildAgentWorkspaceRuntimeSnapshot({
      ...commandContext(),
      session: {
        runtime: {
          model: 'openai:gpt-5.5',
          provider: 'openai-subscriber',
          sessionId: 'agent-session-1',
        },
        sessionMemoryStore: { list: () => [{ id: 'mem-1' }] },
      },
      platform: {
        configManager: {
          get: (key: string) => configValues.get(key),
        },
      },
      clients: {
        agentKnowledgeApi: {
          memory: memoryApi([
            memoryRecord({
              id: 'mem-setup',
              summary: 'Configured durable Agent memory',
              reviewState: 'reviewed',
            }),
          ]),
        },
      },
    } as unknown as CommandContext);
    const byId = new Map(snapshot.setupChecklist.map((item) => [item.id, item]));

    expect(byId.get('runtime')?.status).toBe('ready');
    expect(byId.get('provider-model')?.status).toBe('ready');
    expect(byId.get('agent-knowledge')?.status).toBe('recommended');
    expect(byId.get('memory')?.status).toBe('ready');
    expect(byId.get('channels')?.status).toBe('ready');
    expect(JSON.stringify(snapshot.setupChecklist)).not.toContain('SLACK_BOT_TOKEN');
  });

  test('exposes Agent Knowledge review queue without default wiki fallback', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-review-queue');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/knowledge queue']);
    expect(workspace.status).toContain('/knowledge queue');
    expect(workspace.selectedCategory.detail).toContain('isolated Agent Knowledge route family only');
    expect(workspace.selectedCategory.detail).toContain('Default regular wiki and non-Agent knowledge segments are not');
  });

  test('ingests Agent Knowledge URLs from a confirmed workspace form', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-ingest-url');

    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('knowledge-url');
    expect(dispatched).toEqual([]);
    feedText(workspace, 'https://example.com/agent-guide');
    feedKey(workspace, 'enter');
    feedText(workspace, 'docs,agent');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/knowledge ingest-url https://example.com/agent-guide --tags docs,agent --yes']);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.kind).toBe('dispatched');
  });

  test('ingests Agent Knowledge files from a confirmed workspace form', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-ingest-file');

    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('knowledge-file');
    expect(dispatched).toEqual([]);
    feedText(workspace, './docs/agent-guide.md');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Agent Guide');
    feedKey(workspace, 'enter');
    feedText(workspace, 'docs,agent');
    feedKey(workspace, 'enter');
    feedText(workspace, 'guides');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/knowledge ingest-file ./docs/agent-guide.md --title "Agent Guide" --tags docs,agent --folder guides --yes']);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.kind).toBe('dispatched');
  });

  test('imports browser history into Agent Knowledge from a confirmed workspace form', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-import-browser-history');

    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('knowledge-browser-history');
    expect(dispatched).toEqual([]);
    feedText(workspace, 'chrome,firefox');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, '100');
    feedKey(workspace, 'enter');
    feedText(workspace, '30');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/knowledge import-browser-history --browsers chrome,firefox --sources history,bookmark --limit 100 --since-days 30 --yes']);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.kind).toBe('dispatched');
  });

  test('ingests connector input into Agent Knowledge from a confirmed workspace form', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-ingest-connector');

    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('knowledge-connector-ingest');
    expect(dispatched).toEqual([]);
    feedText(workspace, 'url');
    feedKey(workspace, 'enter');
    feedText(workspace, 'https://example.com/reference');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/knowledge ingest-connector url --input https://example.com/reference --yes']);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.kind).toBe('dispatched');
  });

  test('queries Agent Knowledge from workspace forms without placeholder commands', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-search');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('knowledge-search');
    feedText(workspace, 'GoodVibes Agent setup');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual(['/knowledge search "GoodVibes Agent setup"']);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.safety).toBe('read-only');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-ask');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('knowledge-ask');
    feedText(workspace, 'What should Agent remember?');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([
      '/knowledge search "GoodVibes Agent setup"',
      '/knowledge ask "What should Agent remember?"',
    ]);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.status).toBe('Opening Agent Knowledge ask.');
  });

  test('imports Agent Knowledge bookmarks from a confirmed workspace form', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-import-bookmarks');

    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('knowledge-bookmarks');
    feedText(workspace, './exports/browser bookmarks.html');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/knowledge import-bookmarks "./exports/browser bookmarks.html" --yes']);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.kind).toBe('dispatched');
  });

  test('does not import Agent Knowledge bookmarks without typed confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-import-bookmarks');

    workspace.activateSelected();
    feedText(workspace, './exports/bookmarks.html');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.kind).toBe('knowledge-bookmarks');
    expect(workspace.status).toBe('Agent Knowledge bookmark import not confirmed.');
  });

  test('summarizes voice and media provider coverage in the runtime snapshot', () => {
    const keys = ['ELEVENLABS_API_KEY', 'XI_API_KEY', 'FAL_KEY', 'FAL_API_KEY'] as const;
    const previous = new Map(keys.map((key) => [key, process.env[key]] as const));
    for (const key of keys) delete process.env[key];
    try {
      const snapshot = buildAgentWorkspaceRuntimeSnapshot({
        ...commandContext(),
        platform: {
          configManager: {
            get: (key: string) => new Map<string, unknown>([
              ['tts.provider', 'elevenlabs'],
              ['tts.voice', 'voice-operator'],
              ['tts.llmProvider', 'openai-subscriber'],
              ['tts.llmModel', 'gpt-5.5'],
              ['ui.voiceEnabled', true],
              ['web.enabled', true],
              ['web.publicBaseUrl', 'https://agent.example.test'],
            ]).get(key),
          },
          voiceProviderRegistry: {
            list: () => [
              { id: 'elevenlabs', label: 'ElevenLabs', capabilities: ['tts-stream', 'stt', 'realtime'] },
              { id: 'deepgram', label: 'Deepgram', capabilities: ['stt'] },
            ],
          },
          mediaProviderRegistry: {
            list: () => [
              { id: 'builtin:image-understanding', label: 'Image Understanding', capabilities: ['understand'] },
              { id: 'fal', label: 'Fal', capabilities: ['generate'] },
            ],
          },
        },
      } as unknown as CommandContext);

      expect(snapshot.voiceProviderCount).toBe(2);
      expect(snapshot.voiceStreamingProviderCount).toBe(1);
      expect(snapshot.voiceSttProviderCount).toBe(2);
      expect(snapshot.voiceRealtimeProviderCount).toBe(1);
      expect(snapshot.ttsProvider).toBe('elevenlabs');
      expect(snapshot.ttsVoice).toBe('voice-operator');
      expect(snapshot.ttsResponseModel).toBe('openai-subscriber/gpt-5.5');
      expect(snapshot.voiceSurfaceEnabled).toBe(true);
      expect(snapshot.mediaProviderCount).toBe(2);
      expect(snapshot.mediaUnderstandingProviderCount).toBe(1);
      expect(snapshot.mediaGenerationProviderCount).toBe(1);
      expect(snapshot.voiceMediaReadiness.readyVoiceProviderCount).toBe(0);
      expect(snapshot.voiceMediaReadiness.readyMediaProviderCount).toBe(1);
      expect(snapshot.voiceMediaReadiness.selectedTtsProviderStatus).toBe('needs-secret');
      expect(snapshot.voiceMediaReadiness.selectedTtsProviderLabel).toBe('ElevenLabs');
      expect(snapshot.voiceMediaReadiness.ttsVoiceConfigured).toBe(true);
      expect(snapshot.voiceMediaReadiness.ttsResponseRouteConfigured).toBe(true);
      expect(snapshot.voiceMediaReadiness.browserToolState).toBe('public-url');
      expect(snapshot.voiceMediaReadiness.voiceProviders[0]?.missingSecretKeyOptions).toEqual(['ELEVENLABS_API_KEY', 'XI_API_KEY']);
      expect(snapshot.voiceMediaReadiness.mediaProviders[1]?.missingSecretKeyOptions).toEqual(['FAL_KEY', 'FAL_API_KEY']);
      expect(snapshot.browserToolExposureEnabled).toBe(true);
      expect(snapshot.browserToolPublicBaseUrl).toBe('https://agent.example.test');
    } finally {
      for (const key of keys) {
        const value = previous.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('opens voice media forms and dispatches concrete commands', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'voice-media');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'tts-speak');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('tts-prompt');
    feedText(workspace, 'Read the morning brief');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual(['/tts "Read the morning brief"']);

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'image-attach');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('image-input');
    feedText(workspace, './screenshots/dashboard.png');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Summarize the visible errors');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/tts "Read the morning brief"',
      '/image ./screenshots/dashboard.png "Summarize the visible errors"',
    ]);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.title).toBe('Opening image input');
  });

  test('summarizes isolated Agent profile posture', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-profiles-'));
    createAgentRuntimeProfile(root, 'household');
    const snapshot = buildAgentWorkspaceRuntimeSnapshot({
      ...commandContext(),
      workspace: {
        shellPaths: {
          workingDirectory: root,
          homeDirectory: root,
        },
      },
      platform: {
        configManager: {
          get: () => undefined,
        },
      },
    } as unknown as CommandContext);

    expect(snapshot.activeRuntimeProfile).toBe('(default home)');
    expect(snapshot.runtimeProfileCount).toBe(1);
    expect(snapshot.runtimeProfileRoot).toContain('profile-homes');
    expect(snapshot.runtimeStarterTemplateCount).toBeGreaterThan(4);
    expect(snapshot.localStarterTemplateCount).toBe(0);
  });

  test('agent profile command guides starter authoring and imports local starters', async () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-starter-author-'));
    const starterPath = join(root, 'starter.json');
    const calls: string[] = [];
    const registry = new CommandRegistry();
    registerAgentRuntimeProfileRuntimeCommands(registry);
    const ctx = {
      ...commandContext(),
      print: (text: string) => calls.push(text),
      workspace: {
        shellPaths: createShellPathService({ workingDirectory: root, homeDirectory: root }),
      },
    } as unknown as CommandContext;

    expect(await registry.execute('agent-profile', ['guide'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('Agent Starter Authoring Guide');
    expect(calls.at(-1)).toContain('/agent-profile template export research');

    expect(await registry.execute('agent-profile', ['template', 'export', 'research', './starter.json', '--yes'], ctx)).toBe(true);
    const exported = JSON.parse(readFileSync(starterPath, 'utf-8')) as {
      template: {
        id: string;
        name: string;
        description: string;
      };
    };
    exported.template.id = 'lab-operator';
    exported.template.name = 'Lab Operator';
    exported.template.description = 'Custom lab operator profile starter.';
    writeFileSync(starterPath, `${JSON.stringify(exported, null, 2)}\n`, 'utf-8');

    expect(await registry.execute('agent-profile', ['template', 'import', './starter.json', '--yes'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('Agent starter template imported: lab-operator');
    expect(await registry.execute('agent-profile', ['templates'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('lab-operator');
    expect(calls.at(-1)).toContain('[local');

    expect(await registry.execute('agent-profile', ['create', 'lab', '--template', 'lab-operator', '--yes'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('Agent profile created: lab');
    expect(calls.at(-1)).toContain('starter: lab-operator');
    expect(await registry.execute('agent-profile', ['list'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('starter=lab-operator');
  });

  test('exports and imports profile starter templates from in-workspace forms', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-template-export');

    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('profile-template-export');
    feedText(workspace, 'operations');
    feedKey(workspace, 'enter');
    feedText(workspace, './ops-starter.json');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/agent-profile template export operations ./ops-starter.json --yes']);
    expect(workspace.lastActionResult?.title).toBe('Opening Agent starter template export');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-template-import');
    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('profile-template-import');
    feedText(workspace, './ops-starter.json');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/agent-profile template export operations ./ops-starter.json --yes',
      '/agent-profile template import ./ops-starter.json --yes',
    ]);
    expect(workspace.lastActionResult?.title).toBe('Opening Agent starter template import');
  });

  test('keeps profile starter template forms local until typed confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-template-import');

    workspace.activateSelected();
    feedText(workspace, './starter.json');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.kind).toBe('profile-template-import');
    expect(workspace.status).toContain('not confirmed');
  });

  test('dispatches starter authoring guide from the workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-guide');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/agent-profile guide']);
    expect(workspace.status).toContain('/agent-profile guide');
  });

  test('creates an isolated Agent profile from the workspace form', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-profile-form-'));
    const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open({
      ...commandContext(),
      workspace: { shellPaths },
    } as unknown as CommandContext, (command) => dispatched.push(command));

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-create');
    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('profile');
    expect(workspace.localEditor?.fields.find((field) => field.id === 'template')?.value).toBe('research');

    feedText(workspace, 'research desk');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');

    const profiles = listAgentRuntimeProfiles(root);
    expect(dispatched).toEqual([]);
    expect(profiles.map((profile) => profile.id)).toContain('research-desk');
    expect(profiles.find((profile) => profile.id === 'research-desk')?.starterTemplateId).toBe('research');
    expect(workspace.lastActionResult?.detail).toContain('goodvibes-agent --agent-profile research-desk');
    expect(workspace.runtimeSnapshot?.runtimeProfileCount).toBe(1);
  });

  test('refuses to overwrite an existing Agent profile from the workspace form', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-profile-duplicate-'));
    const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
    createAgentRuntimeProfile(root, 'research-desk', { templateId: 'research' });
    const workspace = new AgentWorkspace();
    workspace.open({
      ...commandContext(),
      workspace: { shellPaths },
    } as unknown as CommandContext, () => undefined);

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-create');
    workspace.activateSelected();
    feedText(workspace, 'research-desk');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');

    expect(workspace.localEditor?.kind).toBe('profile');
    expect(workspace.localEditor?.message).toContain('Agent profile already exists: research-desk');
    expect(workspace.lastActionResult?.kind).toBe('error');
    expect(listAgentRuntimeProfiles(root)).toHaveLength(1);
  });

  test('automation workspace dispatches routine promotion receipt review', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'automation');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'schedule-receipts');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/schedule receipts']);
    expect(workspace.status).toContain('/schedule receipts');
  });

  test('automation workspace dispatches routine schedule reconciliation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'automation');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'schedule-reconcile');

    workspace.activateSelected();

    expect(dispatched).toEqual(['/schedule reconcile']);
    expect(workspace.status).toContain('/schedule reconcile');
  });

  test('automation workspace creates a confirmed reminder schedule through a form', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'automation');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'schedule-reminder');

    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('reminder-schedule');

    feedText(workspace, 'Follow up on the report');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, '2026-06-01T09:00:00-05:00');
    feedKey(workspace, 'enter');
    feedText(workspace, 'America/Chicago');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Report follow-up');
    feedKey(workspace, 'enter');
    feedText(workspace, 'slack:ops-alerts:Ops');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/schedule remind --message "Follow up on the report" --at 2026-06-01T09:00:00-05:00 --timezone America/Chicago --name "Report follow-up" --delivery-channel slack:ops-alerts:Ops --yes',
    ]);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.kind).toBe('dispatched');
  });

  test('automation workspace does not create reminder schedule without confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'automation');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'schedule-reminder');

    workspace.activateSelected();
    feedText(workspace, 'Follow up on the report');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, '2026-06-01T09:00:00-05:00');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.kind).toBe('reminder-schedule');
    expect(workspace.status).toContain('not confirmed');
  });

  test('automation workspace promotes selected routine through a confirmed form', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(routineWorkspaceContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'automation');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'schedule-promote-routine');

    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('routine-schedule');
    expect(workspace.localEditor?.fields.find((field) => field.id === 'routineId')?.value).toBe('daily-brief');

    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, '0 9 * * *');
    feedKey(workspace, 'enter');
    feedText(workspace, 'America/Chicago');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, 'slack:ops-alerts:Ops');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/schedule promote-routine daily-brief --cron "0 9 * * *" --timezone America/Chicago --name "Daily Brief" --delivery-channel slack:ops-alerts:Ops --yes',
    ]);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.kind).toBe('dispatched');
  });

  test('automation workspace does not dispatch routine schedule promotion without confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(routineWorkspaceContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'automation');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'schedule-promote-routine');

    workspace.activateSelected();
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, '0 9 * * *');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.kind).toBe('routine-schedule');
    expect(workspace.status).toContain('not confirmed');
  });

  test('keeps copied runner controls out of the build delegation workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');

    const actionText = workspace.actions
      .map((action) => `${action.id} ${action.label} ${action.detail} ${action.command ?? ''}`)
      .join('\n');

    expect(dispatched).toEqual([]);
    expect(actionText).toContain('delegation-status');
    expect(actionText).toContain('/delegate status');
    expect(actionText).not.toContain('remote runner');
    expect(actionText).not.toContain('/remote dispatch');
  });

  test('does not dispatch template delegation commands from the workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'review-command');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.lastActionResult?.kind).toBe('guidance');
    expect(workspace.status).toContain('actual task text');
  });

  test('refresh key rereads the live runtime snapshot', () => {
    const workspace = new AgentWorkspace();
    const runtime = {
      model: 'openai:gpt-5.5',
      provider: 'openai-subscriber',
      sessionId: 'session-1',
      debugMode: false,
      systemPrompt: '',
      reasoningEffort: 'medium',
    };
    const ctx = {
      executeCommand: async () => true,
      print: () => undefined,
      session: {
        runtime,
        sessionMemoryStore: { list: () => [] },
      },
      provider: {
        providerRegistry: {
          getCurrentModel: () => ({
            id: 'gpt-5.5',
            provider: runtime.provider,
            displayName: runtime.model,
            registryKey: runtime.model,
            contextWindow: 256000,
          }),
        },
      },
    } as unknown as CommandContext;

    workspace.open(ctx, () => undefined);
    expect(workspace.runtimeSnapshot?.model).toBe('openai:gpt-5.5');

    runtime.model = 'anthropic:claude-sonnet-4.5';
    handleAgentWorkspaceToken(workspace, { type: 'text', value: 'r' }, () => undefined, () => undefined);

    expect(workspace.runtimeSnapshot?.model).toBe('anthropic:claude-sonnet-4.5');
    expect(workspace.status).toContain('refreshed');
    expect(workspace.lastActionResult?.kind).toBe('refreshed');
  });

  test('token routing supports pane focus and navigation', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined);

    handleAgentWorkspaceToken(workspace, { type: 'key', logicalName: 'left', ctrl: false, meta: false, shift: false, alt: false }, () => undefined, () => undefined);
    expect(workspace.focusPane).toBe('categories');

    handleAgentWorkspaceToken(workspace, { type: 'key', logicalName: 'down', ctrl: false, meta: false, shift: false, alt: false }, () => undefined, () => undefined);
    expect(workspace.selectedCategory.label).toBe('Setup');

    handleAgentWorkspaceToken(workspace, { type: 'key', logicalName: 'right', ctrl: false, meta: false, shift: false, alt: false }, () => undefined, () => undefined);
    expect(workspace.focusPane).toBe('actions');
  });

  test('registers /agent, /home, and /operator aliases', async () => {
    const registry = new CommandRegistry();
    registerAgentWorkspaceRuntimeCommands(registry);
    const opened: string[] = [];
    const ctx = {
      openAgentWorkspace: () => opened.push('agent'),
      print: (text: string) => opened.push(`print:${text}`),
    } as unknown as CommandContext;

    expect(await registry.execute('agent', [], ctx)).toBe(true);
    expect(await registry.execute('home', [], ctx)).toBe(true);
    expect(await registry.execute('operator', [], ctx)).toBe(true);
    expect(opened).toEqual(['agent', 'agent', 'agent']);
  });
});
