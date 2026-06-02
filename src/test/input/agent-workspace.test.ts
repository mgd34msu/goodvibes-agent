import { describe, expect, test } from 'bun:test';
import type { InputToken } from '@pellux/goodvibes-sdk/platform/core';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
import { createAgentRuntimeProfile, getAgentRuntimeProfilesRoot, listAgentRuntimeProfiles, readAgentRuntimeProfileSelection, setAgentRuntimeProfileSelection } from '../../agent/runtime-profile.ts';
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

function clearEditorField(workspace: AgentWorkspace): void {
  while (workspace.localEditor?.fields[workspace.localEditor.selectedFieldIndex]?.value) {
    feedKey(workspace, 'backspace');
  }
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

  test('first-class product commands have Agent workspace access', () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry);
    const workspaceCommandRoots = new Set(AGENT_WORKSPACE_CATEGORIES.flatMap((category) => (
      category.actions.flatMap((action) => {
        const command = action.command?.trim();
        if (!command?.startsWith('/')) return [];
        const root = command.slice(1).split(/\s+/)[0];
        return root ? [root] : [];
      })
    )));
    const workspaceSubmissionFiles = [
      'src/input/agent-workspace-basic-command-editor-submission.ts',
      'src/input/agent-workspace-provider-command-editor-submission.ts',
      'src/input/agent-workspace-session-command-editor-submission.ts',
      'src/input/agent-workspace-channel-command-editor-submission.ts',
      'src/input/agent-workspace-access-command-editor-submission.ts',
      'src/input/agent-workspace-knowledge-command-editor-submission.ts',
      'src/input/agent-workspace-memory-command-editor-submission.ts',
      'src/input/agent-workspace-notify-editor-submission.ts',
      'src/input/agent-workspace-secret-editor-submission.ts',
      'src/input/agent-workspace-skill-bundle-command-editor-submission.ts',
      'src/input/agent-workspace-workplan-editor-submission.ts',
      'src/input/agent-workspace-delegation-editor-submission.ts',
      'src/input/agent-workspace-task-command-editor-submission.ts',
      'src/input/agent-workspace-operations-command-editor-submission.ts',
      'src/input/agent-workspace-mcp-command-editor-submission.ts',
      'src/input/agent-workspace-reminder-schedule-editor.ts',
      'src/input/agent-workspace-routine-schedule-editor.ts',
      'src/input/agent-workspace-library-command-editor-submission.ts',
    ];
    for (const filePath of workspaceSubmissionFiles) {
      if (!existsSync(filePath)) continue;
      const source = readFileSync(filePath, 'utf-8');
      for (const match of source.matchAll(/\/([a-z0-9-]+)/g)) {
        workspaceCommandRoots.add(match[1]!);
      }
      for (const match of source.matchAll(/\/\$\{\s*[^?}]+\?\s*'([a-z0-9-]+)'\s*:\s*'([a-z0-9-]+)'\s*\}/g)) {
        workspaceCommandRoots.add(match[1]!);
        workspaceCommandRoots.add(match[2]!);
      }
    }
    const shellOnlyCommands = new Set([
      'agent',
      'bookmarks',
      'clear',
      'collapse',
      'commands',
      'compact',
      'context',
      'expand',
      'help',
      'keybindings',
      'next-error',
      'paste',
      'prev-error',
      'quit',
      'redo',
      'reset',
      'retry',
      'shortcuts',
      'title',
      'undo',
      'welcome',
    ]);

    const missingWorkspaceAccess = registry.list()
      .filter((command) => !workspaceCommandRoots.has(command.name)
        && !(command.aliases ?? []).some((alias) => workspaceCommandRoots.has(alias)))
      .map((command) => command.name)
      .filter((name) => !shellOnlyCommands.has(name))
      .sort();

    expect(missingWorkspaceAccess).toEqual([]);
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

  test('sets interaction mode from home and setup workspace forms', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'mode-show');
    workspace.activateSelected();

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'mode-preset');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('mode-preset');
    clearEditorField(workspace);
    feedText(workspace, 'operator');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual(['/mode show']);
    expect(workspace.localEditor?.message).toContain('not confirmed');
    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'setup-effort');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('effort-level');
    clearEditorField(workspace);
    feedText(workspace, 'high');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/effort high');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'setup-mode-domain');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('mode-domain');
    feedText(workspace, 'approvals');
    feedKey(workspace, 'enter');
    clearEditorField(workspace);
    feedText(workspace, 'verbose');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/mode show',
      '/mode operator --yes',
      '/effort high',
      '/mode set-domain approvals verbose --yes',
    ]);
  });

  test('manages model favorites and catalog refresh from setup workspace actions', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'setup-model-refresh');
    workspace.activateSelected();

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'setup-model-pin');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('model-pin');
    feedText(workspace, 'openai:gpt-5.5');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'setup-model-unpin');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('model-unpin');
    feedText(workspace, 'openai:gpt-5.5');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/refresh-models',
      '/pin openai:gpt-5.5',
      '/unpin openai:gpt-5.5',
    ]);
  });

  test('opens direct Agent workspace categories and reports unknown targets', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command), 'voice-media');

    expect(workspace.active).toBe(true);
    expect(workspace.selectedCategory.id).toBe('voice-media');
    expect(workspace.focusPane).toBe('actions');
    expect(workspace.lastActionResult).toBeNull();

    workspace.open(commandContext(), (command) => dispatched.push(command), 'not-real');

    expect(workspace.selectedCategory.id).toBe('voice-media');
    expect(workspace.status).toContain('Unknown Agent workspace area: not-real');
    expect(workspace.lastActionResult).toMatchObject({
      kind: 'guidance',
      title: 'Unknown Agent workspace area',
      safety: 'safe',
    });
    expect(workspace.lastActionResult?.detail).toContain('knowledge');
    expect(workspace.lastActionResult?.detail).toContain('delegate');
    expect(dispatched).toEqual([]);
  });

  test('work workspace reviews planning work plan tasks sessions and approvals from transcript instead of opening a panel', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'work');

    const commands = workspace.actions.map((action) => action.command).filter(Boolean);
    expect(commands).not.toContain('/workplan panel');
    expect(commands).not.toContain('/plan panel');
    expect(commands).not.toContain('/plan approve --yes');
    expect(commands).not.toContain('/approval open');
    expect(workspace.actions.map((action) => action.id)).toContain('workplan-add');
    expect(workspace.actions.map((action) => action.id)).toContain('workplan-show');
    expect(workspace.actions.map((action) => action.id)).toContain('workplan-status');
    expect(workspace.actions.map((action) => action.id)).toContain('workplan-delete');
    expect(workspace.actions.map((action) => action.id)).toContain('workplan-clear-completed');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'workplan');
    workspace.activateSelected();

    expect(dispatched).toEqual(['/workplan list']);
    expect(workspace.status).toContain('/workplan list');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'workplan-show');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('workplan-show');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/workplan show');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'planning-status');
    workspace.activateSelected();

    expect(dispatched).toEqual(['/workplan list', '/workplan show', '/plan status']);
    expect(workspace.status).toContain('/plan status');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'planning-mode');
    workspace.activateSelected();

    expect(dispatched.at(-1)).toBe('/plan mode');
    expect(workspace.status).toContain('/plan mode');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'planning-explain');
    workspace.activateSelected();

    expect(dispatched.at(-1)).toBe('/plan explain');
    expect(workspace.status).toContain('/plan explain');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'planning-list');
    workspace.activateSelected();

    expect(dispatched.at(-1)).toBe('/plan list');
    expect(workspace.status).toContain('/plan list');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'plan-seed');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('plan-seed');
    feedText(workspace, 'Prepare the household assistant setup');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/plan "Prepare the household assistant setup"');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'plan-show');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('plan-show');
    feedText(workspace, 'plan-123');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/plan show plan-123');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'tasks-list');
    workspace.activateSelected();

    expect(dispatched.at(-1)).toBe('/tasks list');
    expect(workspace.status).toContain('/tasks list');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'tasks-filter');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('task-list-filter');
    feedText(workspace, 'running');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/tasks list running');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'sessions-list');
    workspace.activateSelected();

    expect(dispatched.at(-1)).toBe('/sessions');
    expect(workspace.status).toContain('/sessions');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'approvals');
    workspace.activateSelected();

    expect(dispatched.at(-1)).toBe('/approval matrix');
    expect(workspace.status).toContain('/approval matrix');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'approval-review');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('approval-review');
    clearEditorField(workspace);
    feedText(workspace, 'mcp');
    feedKey(workspace, 'enter');

    expect(dispatched.at(-1)).toBe('/approval review mcp');
    expect(workspace.lastActionResult?.safety).toBe('read-only');
  });

  test('opens runtime task inspection from workspace forms without mutating tasks', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'work');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'tasks-filter');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('task-list-filter');
    feedText(workspace, 'running');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/tasks list running');
    expect(workspace.lastActionResult?.safety).toBe('read-only');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'task-show');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('task-show');
    feedText(workspace, 'task-123');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/tasks show task-123');
    expect(workspace.lastActionResult?.safety).toBe('read-only');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'task-output');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('task-output');
    feedText(workspace, 'task-123');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/tasks output task-123');

    expect(dispatched).not.toContain('/tasks cancel task-123');
    expect(dispatched).not.toContain('/tasks retry task-123');
  });

  test('requires confirmation before planning approval override and clear workspace actions', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'work');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'plan-approve');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('plan-approve');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.message).toContain('not confirmed');
    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual(['/plan approve --yes']);

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'plan-override');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('plan-override');
    clearEditorField(workspace);
    feedText(workspace, 'serial');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/plan override serial --yes');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'plan-clear');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('plan-clear');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/plan clear --yes');
  });

  test('exports conversation and manages saved session continuity from work workspace forms', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'work');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'conversation-export');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('conversation-export');
    feedKey(workspace, 'enter');
    clearEditorField(workspace);
    feedText(workspace, './exports/session.md');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.message).toContain('not confirmed');
    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'conversation-review');
    workspace.activateSelected();
    expect(dispatched.at(-1)).toBe('/conversation review');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'conversation-hotspots');
    workspace.activateSelected();
    expect(dispatched.at(-1)).toBe('/conversation hotspots');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'conversation-events');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('conversation-events');
    feedText(workspace, 'tool_call');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/conversation events tool_call');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'conversation-groups');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('conversation-groups');
    feedText(workspace, 'assistant_output');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/conversation groups assistant_output');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'conversation-find');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('conversation-find');
    feedText(workspace, 'release');
    feedKey(workspace, 'enter');
    feedText(workspace, 'user_input');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/conversation find release user_input');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-save');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('session-save');
    feedText(workspace, 'morning-review');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-load');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('session-load');
    feedText(workspace, 'morning-review');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-rename');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('session-rename');
    feedText(workspace, 'renamed-review');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-fork');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('session-fork');
    feedText(workspace, 'forked-review');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/session fork forked-review');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-resume');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('session-resume');
    feedText(workspace, 'morning-review');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-info');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('session-info');
    feedText(workspace, 'morning-review');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-graph');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('session-graph');
    feedText(workspace, 'session-123');
    feedKey(workspace, 'enter');
    clearEditorField(workspace);
    feedText(workspace, 'json');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/session graph --session session-123 --format json');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-export-saved');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('session-export-saved');
    feedText(workspace, 'morning-review');
    feedKey(workspace, 'enter');
    clearEditorField(workspace);
    feedText(workspace, 'text');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-search');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('session-search');
    feedText(workspace, 'release');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'session-delete');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('session-delete');
    feedText(workspace, 'old-review');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(workspace.localEditor?.message).toContain('not confirmed');
    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/export markdown ./exports/session.md --yes',
      '/conversation review',
      '/conversation hotspots',
      '/conversation events tool_call',
      '/conversation groups assistant_output',
      '/conversation find release user_input',
      '/save morning-review',
      '/load morning-review',
      '/session rename renamed-review',
      '/session fork forked-review',
      '/session resume morning-review',
      '/session info morning-review',
      '/session graph --session session-123 --format json',
      '/session export morning-review text',
      '/session search release',
      '/session delete old-review --yes',
    ]);
  });

  test('creates and updates work plan items from TUI workspace forms', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'work');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'workplan-add');
    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('workplan-add');
    feedText(workspace, 'Follow up on Agent release blockers');
    feedKey(workspace, 'enter');
    feedText(workspace, 'agent');
    feedKey(workspace, 'enter');
    feedText(workspace, 'release');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Check TUI-first workspace coverage.');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/workplan add "Follow up on Agent release blockers" --owner agent --source release --notes "Check TUI-first workspace coverage."']);
    expect(workspace.lastActionResult?.safety).toBe('safe');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'workplan-status');
    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('workplan-status');
    feedText(workspace, 'wp-123');
    feedKey(workspace, 'enter');
    feedText(workspace, 'blocked');
    feedKey(workspace, 'enter');

    expect(dispatched.at(-1)).toBe('/workplan blocked wp-123');
  });

  test('requires confirmation before destructive work plan workspace actions', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'work');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'workplan-delete');
    workspace.activateSelected();
    feedText(workspace, 'wp-123');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.message).toContain('not confirmed');

    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/workplan remove wp-123 --yes']);

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'workplan-clear-completed');
    workspace.activateSelected();
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched.at(-1)).toBe('/workplan clear-completed --yes');
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

  test('setup workspace exposes compatibility accounts and subscription review without shell-only paths', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'setup-compat');
    workspace.activateSelected();
    expect(workspace.status).toContain('/compat');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'provider-accounts');
    workspace.activateSelected();
    expect(workspace.status).toContain('/accounts review');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'subscription-providers');
    workspace.activateSelected();
    expect(workspace.status).toContain('/subscription providers');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'subscription-review');
    workspace.activateSelected();
    expect(workspace.status).toContain('/subscription review');

    expect(dispatched).toEqual(['/compat', '/accounts review', '/subscription providers', '/subscription review']);
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

  test('tools workspace exposes trust and security review from the TUI', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'tools');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'trust-review');
    workspace.activateSelected();
    expect(workspace.status).toContain('/trust review');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'security-review');
    workspace.activateSelected();
    expect(workspace.status).toContain('/security review');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'security-attack-paths');
    workspace.activateSelected();
    expect(workspace.status).toContain('/security attack-paths');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'security-tokens');
    workspace.activateSelected();
    expect(workspace.status).toContain('/security tokens');

    expect(dispatched).toEqual(['/trust review', '/security review', '/security attack-paths', '/security tokens']);
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

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas-search');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('persona-search');
    feedText(workspace, 'research');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/personas search research');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas-show');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('persona-show');
    feedText(workspace, 'research-analyst');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/personas show research-analyst');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-create');
    workspace.activateSelected();
    expect(dispatched).toEqual(['/personas list', '/personas search research', '/personas show research-analyst']);
    expect(workspace.localEditor?.kind).toBe('skill');
    workspace.cancelLocalEditor();

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-search');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('skill-search');
    feedText(workspace, 'briefing');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/agent-skills search briefing');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-show');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('skill-show');
    feedText(workspace, 'briefing');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/agent-skills show briefing');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'routines');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-search');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('routine-search');
    feedText(workspace, 'daily');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/routines search daily');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-show');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('routine-show');
    feedText(workspace, 'daily-brief');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/routines show daily-brief');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-receipts');
    workspace.activateSelected();
    expect(dispatched.at(-1)).toBe('/routines receipts');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-receipt');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('routine-receipt');
    feedText(workspace, 'receipt-123');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/routines receipt receipt-123');
  });

  test('workspace editors preserve multiline paste only on multiline fields', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined);

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-create');
    workspace.activateSelected();
    feedText(workspace, 'Briefing\nAssistant');
    expect(workspace.localEditor?.fields[0]?.value).toBe('Briefing Assistant');

    feedKey(workspace, 'enter');
    feedText(workspace, 'One line\r\nTwo line');
    expect(workspace.localEditor?.fields[1]?.value).toBe('One line Two line');

    feedKey(workspace, 'enter');
    feedText(workspace, 'Step one\r\nStep two');
    feedWorkspaceToken(workspace, { type: 'key', logicalName: 'j', ctrl: true, shift: false, meta: false });
    feedText(workspace, 'Step three');
    expect(workspace.localEditor?.fields[2]?.value).toBe('Step one\nStep two\nStep three');
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
    feedText(workspace, 'Check connected-host status, work plan, approvals, and Agent Knowledge first.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'briefing,setup');
    feedKey(workspace, 'enter');
    feedText(workspace, 'ops');
    feedKey(workspace, 'enter');
    feedText(workspace, 'GOODVIBES_AGENT_TEST_MISSING_TOKEN');
    feedKey(workspace, 'enter');
    feedText(workspace, 'definitely-missing-goodvibes-agent-test-bin');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');

    const skillSnapshot = AgentSkillRegistry.fromShellPaths(shellPaths).snapshot();
    expect(skillSnapshot.enabledSkills[0]?.name).toBe('Briefing');
    expect(skillSnapshot.enabledSkills[0]?.requirements.map((requirement) => `${requirement.kind}:${requirement.name}`)).toEqual([
      'env:GOODVIBES_AGENT_TEST_MISSING_TOKEN',
      'command:definitely-missing-goodvibes-agent-test-bin',
    ]);
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
    feedText(workspace, 'GOODVIBES_AGENT_TEST_MISSING_ROUTINE_TOKEN');
    feedKey(workspace, 'enter');
    feedText(workspace, 'definitely-missing-goodvibes-agent-routine-bin');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');

    const routineSnapshot = AgentRoutineRegistry.fromShellPaths(shellPaths).snapshot();
    expect(routineSnapshot.enabledRoutines[0]?.name).toBe('Daily Brief');
    expect(routineSnapshot.enabledRoutines[0]?.requirements.map((requirement) => `${requirement.kind}:${requirement.name}`)).toEqual([
      'env:GOODVIBES_AGENT_TEST_MISSING_ROUTINE_TOKEN',
      'command:definitely-missing-goodvibes-agent-routine-bin',
    ]);
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

  test('captures learned behavior as local skill routine or persona without dispatching commands', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-learned-behavior-'));
    const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
    const ctx = {
      ...commandContext(),
      workspace: { shellPaths },
    } as unknown as CommandContext;
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(ctx, (command) => dispatched.push(command));

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'learned-behavior');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('learned-behavior');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Meeting Followup');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Follow up after meetings.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Capture decisions, owners, due dates, and unanswered questions.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'meeting,followup');
    feedKey(workspace, 'enter');
    feedText(workspace, 'learned,ops');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');

    const skill = AgentSkillRegistry.fromShellPaths(shellPaths).get('meeting-followup');
    expect(skill?.enabled).toBe(true);
    expect(skill?.source).toBe('agent');
    expect(skill?.provenance).toBe('agent-workspace-learned-behavior');
    expect(skill?.procedure).toContain('Capture decisions');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'home');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'learned-behavior-home');
    workspace.activateSelected();
    clearEditorField(workspace);
    feedText(workspace, 'routine');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Weekly Reset');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Review open loops weekly.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Review tasks, stale memory, approvals, and local routines.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'weekly,reset');
    feedKey(workspace, 'enter');
    feedText(workspace, 'learned,review');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');

    const routine = AgentRoutineRegistry.fromShellPaths(shellPaths).get('weekly-reset');
    expect(routine?.enabled).toBe(true);
    expect(routine?.source).toBe('agent');
    expect(routine?.provenance).toBe('agent-workspace-learned-behavior');
    expect(routine?.steps).toContain('stale memory');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'learned-behavior');
    workspace.activateSelected();
    clearEditorField(workspace);
    feedText(workspace, 'persona');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Concise Operator');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Prefer short action-first replies.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Answer with status first, then actions.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'status,concise');
    feedKey(workspace, 'enter');
    feedText(workspace, 'learned,style');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');

    const personaSnapshot = AgentPersonaRegistry.fromShellPaths(shellPaths).snapshot();
    expect(personaSnapshot.activePersona?.name).toBe('Concise Operator');
    expect(personaSnapshot.activePersona?.source).toBe('agent');
    expect(personaSnapshot.activePersona?.provenance).toBe('agent-workspace-learned-behavior');
    expect(personaSnapshot.activePersona?.body).toContain('status first');
    expect(dispatched).toEqual([]);
  });

  test('rejects learned behavior target outside local behavior registries', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-learned-reject-'));
    const shellPaths = createShellPathService({ workingDirectory: root, homeDirectory: root });
    const ctx = {
      ...commandContext(),
      workspace: { shellPaths },
    } as unknown as CommandContext;
    const workspace = new AgentWorkspace();
    workspace.open(ctx, () => undefined);
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'learned-behavior');

    workspace.activateSelected();
    clearEditorField(workspace);
    feedText(workspace, 'habit');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Bad Target');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Should not save.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Do not create records for unsupported targets.');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');

    expect(workspace.localEditor?.kind).toBe('learned-behavior');
    expect(workspace.localEditor?.message).toBe('Behavior type must be skill, routine, or persona.');
    expect(AgentSkillRegistry.fromShellPaths(shellPaths).snapshot().skills).toHaveLength(0);
    expect(AgentRoutineRegistry.fromShellPaths(shellPaths).snapshot().routines).toHaveLength(0);
    expect(AgentPersonaRegistry.fromShellPaths(shellPaths).snapshot().personas).toHaveLength(0);
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

  test('manages skill bundles from in-workspace lifecycle forms', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'skills');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-search-bundle');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('skill-bundle-search');
    feedText(workspace, 'daily');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-show-bundle');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('skill-bundle-show');
    feedText(workspace, 'bundle-daily');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-update-bundle');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('skill-bundle-update');
    feedText(workspace, 'bundle-daily');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Daily Ops');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Updated operations bundle');
    feedKey(workspace, 'enter');
    feedText(workspace, 'briefing,calendar-review');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([
      '/agent-skills bundle search daily',
      '/agent-skills bundle show bundle-daily',
    ]);
    expect(workspace.localEditor?.message).toContain('not confirmed');
    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-enable-bundle');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('skill-bundle-enable');
    feedText(workspace, 'bundle-daily');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-disable-bundle');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('skill-bundle-disable');
    feedText(workspace, 'bundle-daily');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-review-bundle');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('skill-bundle-review');
    feedText(workspace, 'bundle-daily');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-stale-bundle');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('skill-bundle-stale');
    feedText(workspace, 'bundle-daily');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Needs provider setup review');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'skills-delete-bundle');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('skill-bundle-delete');
    feedText(workspace, 'bundle-daily');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/agent-skills bundle search daily',
      '/agent-skills bundle show bundle-daily',
      '/agent-skills bundle update bundle-daily --name "Daily Ops" --description "Updated operations bundle" --skills briefing,calendar-review',
      '/agent-skills bundle enable bundle-daily',
      '/agent-skills bundle disable bundle-daily',
      '/agent-skills bundle review bundle-daily',
      '/agent-skills bundle stale bundle-daily "Needs provider setup review"',
      '/agent-skills bundle delete bundle-daily --yes',
    ]);
  });

  test('exposes Agent support bundle export inspect and import from the setup workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'support-bundle-export');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('support-bundle-export');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.message).toContain('not confirmed');
    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual(['/bundle export goodvibes-agent-bundle.json --yes']);
    expect(workspace.lastActionResult?.title).toBe('Opening Agent support bundle export');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'support-bundle-inspect');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('support-bundle-inspect');
    clearEditorField(workspace);
    feedText(workspace, 'support/review.json');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([
      '/bundle export goodvibes-agent-bundle.json --yes',
      '/bundle inspect support/review.json',
    ]);
    expect(workspace.lastActionResult?.title).toBe('Opening Agent support bundle inspection');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'support-bundle-import');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('support-bundle-import');
    clearEditorField(workspace);
    feedText(workspace, 'support/review.json');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([
      '/bundle export goodvibes-agent-bundle.json --yes',
      '/bundle inspect support/review.json',
    ]);
    expect(workspace.localEditor?.message).toContain('not confirmed');
    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([
      '/bundle export goodvibes-agent-bundle.json --yes',
      '/bundle inspect support/review.json',
      '/bundle import support/review.json --yes',
    ]);
    expect(workspace.lastActionResult?.title).toBe('Opening Agent support bundle import');
  });

  test('adds and removes custom providers from setup workspace forms with confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'provider-use');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('provider-use');
    feedText(workspace, 'openai-subscriber');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'provider-inspect');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('provider-inspect');
    feedText(workspace, 'openai-subscriber');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'provider-routes');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('provider-routes');
    feedText(workspace, 'openai-subscriber');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'provider-account-repair');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('provider-account-repair');
    feedText(workspace, 'openai-subscriber');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'provider-add');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('provider-add');
    feedText(workspace, 'local_llm');
    feedKey(workspace, 'enter');
    feedText(workspace, 'http://127.0.0.1:8000/v1');
    feedKey(workspace, 'enter');
    feedText(workspace, 'sk-local-provider-token');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/provider openai-subscriber',
      '/accounts show openai-subscriber',
      '/accounts routes openai-subscriber',
      '/accounts repair openai-subscriber',
    ]);
    expect(workspace.localEditor?.message).toContain('not confirmed');

    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/provider openai-subscriber',
      '/accounts show openai-subscriber',
      '/accounts routes openai-subscriber',
      '/accounts repair openai-subscriber',
      '/provider add local_llm http://127.0.0.1:8000/v1 sk-local-provider-token --yes',
    ]);
    expect(workspace.lastActionResult?.command).toBe('/provider add local_llm http://127.0.0.1:8000/v1 <redacted-api-key> --yes');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'provider-remove');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('provider-remove');
    feedText(workspace, 'local_llm');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/provider openai-subscriber',
      '/accounts show openai-subscriber',
      '/accounts routes openai-subscriber',
      '/accounts repair openai-subscriber',
      '/provider add local_llm http://127.0.0.1:8000/v1 sk-local-provider-token --yes',
      '/provider remove local_llm --yes',
    ]);
  });

  test('starts finishes inspects and logs out provider subscriptions from workspace forms', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'subscription-inspect');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('subscription-inspect');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual(['/subscription inspect openai']);

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'subscription-login-start');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('subscription-login-start');
    feedKey(workspace, 'enter');
    clearEditorField(workspace);
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual(['/subscription inspect openai']);
    expect(workspace.localEditor?.message).toContain('not confirmed');
    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([
      '/subscription inspect openai',
      '/subscription login openai start --no-browser --manual --yes',
    ]);
    expect(workspace.lastActionResult?.title).toBe('Opening provider subscription login start');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'subscription-login-finish');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('subscription-login-finish');
    feedKey(workspace, 'enter');
    feedText(workspace, 'abc-code');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([
      '/subscription inspect openai',
      '/subscription login openai start --no-browser --manual --yes',
    ]);
    expect(workspace.localEditor?.message).toContain('not confirmed');
    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([
      '/subscription inspect openai',
      '/subscription login openai start --no-browser --manual --yes',
      '/subscription login openai finish abc-code --yes',
    ]);
    expect(workspace.lastActionResult?.title).toBe('Opening provider subscription login finish');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'subscription-logout');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('subscription-logout');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([
      '/subscription inspect openai',
      '/subscription login openai start --no-browser --manual --yes',
      '/subscription login openai finish abc-code --yes',
    ]);
    expect(workspace.localEditor?.message).toContain('not confirmed');
    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([
      '/subscription inspect openai',
      '/subscription login openai start --no-browser --manual --yes',
      '/subscription login openai finish abc-code --yes',
      '/subscription logout openai --yes',
    ]);
    expect(workspace.lastActionResult?.title).toBe('Opening provider subscription logout');
  });

  test('exposes auth trust subscription and voice bundles from workspace forms', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'setup');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'auth-show');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('auth-show');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'auth-repair');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('auth-repair');
    clearEditorField(workspace);
    feedText(workspace, 'anthropic');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'auth-bundle-export');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('auth-bundle-export');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual(['/auth show openai', '/auth repair anthropic']);
    expect(workspace.localEditor?.message).toContain('not confirmed');
    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'auth-bundle-inspect');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('auth-bundle-inspect');
    clearEditorField(workspace);
    feedText(workspace, 'auth/custom.json');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'subscription-bundle-export');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('subscription-bundle-export');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'subscription-bundle-inspect');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('subscription-bundle-inspect');
    feedKey(workspace, 'enter');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'tools');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'trust-bundle-export');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('trust-bundle-export');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'trust-bundle-inspect');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('trust-bundle-inspect');
    feedKey(workspace, 'enter');

    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'voice-media');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'voice-enable');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('voice-enable');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'voice-disable');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('voice-disable');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'voice-bundle-export');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('voice-bundle-export');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'voice-bundle-inspect');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('voice-bundle-inspect');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/auth show openai',
      '/auth repair anthropic',
      '/auth bundle export auth-review-bundle.json --yes',
      '/auth bundle inspect auth/custom.json',
      '/subscription bundle export subscription-bundle.json --yes',
      '/subscription bundle inspect subscription-bundle.json',
      '/trust bundle export trust-review-bundle.json --yes',
      '/trust bundle inspect trust-review-bundle.json',
      '/voice enable --yes',
      '/voice disable --yes',
      '/voice bundle export voice-bundle.json --yes',
      '/voice bundle inspect voice-bundle.json',
    ]);
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

  test('opens MCP server-specific tools and repair guidance from workspace forms', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'tools');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'mcp-tools-server');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('mcp-tools-server');
    feedText(workspace, 'filesystem');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'mcp-repair');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('mcp-repair');
    feedText(workspace, 'browser-tools');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/mcp tools filesystem', '/mcp repair browser-tools']);
    expect(workspace.lastActionResult?.safety).toBe('read-only');
  });

  test('stores links tests and deletes secrets from confirmed workspace forms without rendering raw values', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'tools');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'secret-set');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('secret-set');
    feedText(workspace, 'OPENAI_API_KEY');
    feedKey(workspace, 'enter');
    feedText(workspace, 'sk-test-secret-value');
    feedKey(workspace, 'enter');
    feedText(workspace, 'project');
    feedKey(workspace, 'enter');
    feedText(workspace, 'secure');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.message).toContain('not confirmed');
    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual(['/secrets set OPENAI_API_KEY sk-test-secret-value --project --secure --yes']);
    expect(workspace.lastActionResult?.command).toBe('/secrets set OPENAI_API_KEY <redacted> --project --secure --yes');
    expect(workspace.lastActionResult?.command).not.toContain('sk-test-secret-value');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'secret-link');
    workspace.activateSelected();
    feedText(workspace, 'SLACK_BOT_TOKEN');
    feedKey(workspace, 'enter');
    feedText(workspace, 'goodvibes://secrets/env/SLACK_BOT_TOKEN');
    feedKey(workspace, 'enter');
    feedText(workspace, 'user');
    feedKey(workspace, 'enter');
    feedText(workspace, 'secure');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/secrets link SLACK_BOT_TOKEN goodvibes://secrets/env/SLACK_BOT_TOKEN --user --secure --yes');
    expect(workspace.lastActionResult?.command).toBe('/secrets link SLACK_BOT_TOKEN <secret-ref> --user --secure --yes');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'secret-test');
    workspace.activateSelected();
    feedText(workspace, 'goodvibes://secrets/env/SLACK_BOT_TOKEN');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/secrets test goodvibes://secrets/env/SLACK_BOT_TOKEN');
    expect(workspace.lastActionResult?.command).toBe('/secrets test <secret-ref>');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'secret-delete');
    workspace.activateSelected();
    feedText(workspace, 'OPENAI_API_KEY');
    feedKey(workspace, 'enter');
    feedText(workspace, 'project');
    feedKey(workspace, 'enter');
    feedText(workspace, 'secure');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/secrets delete OPENAI_API_KEY --project --secure --yes');
    expect(workspace.lastActionResult?.title).toBe('Opening secret deletion');
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

  test('opens channel diagnostics from workspace forms without sending messages', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'channels');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'channel-show');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('channel-show');
    feedText(workspace, 'telegram');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/channels show telegram');
    expect(workspace.lastActionResult?.safety).toBe('read-only');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'channel-doctor');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('channel-doctor');
    feedText(workspace, 'slack');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/channels doctor slack');
    expect(workspace.lastActionResult?.title).toBe('Opening channel doctor');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'channel-setup');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('channel-setup');
    feedText(workspace, 'discord');
    feedKey(workspace, 'enter');
    expect(dispatched.at(-1)).toBe('/channels setup discord');

    expect(dispatched).not.toContain('/channels send telegram');
    expect(dispatched.join('\n')).not.toContain('/notify test');
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

  test('clears notification webhook targets from the workspace only after typed confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'channels');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'notification-clear-webhooks');

    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('notify-webhook-clear');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.message).toContain('not confirmed');

    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/notify clear --yes']);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.title).toBe('Opening notification webhook clear');
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

  test('discovers and imports local persona files from the workspace after confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'personas');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas-discover');
    workspace.activateSelected();
    expect(dispatched).toEqual(['/personas discover']);

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'personas-import-discovered');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('persona-discovery-import');
    feedText(workspace, 'Travel Planner');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    expect(workspace.localEditor?.message).toContain('Confirm is required');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(workspace.localEditor?.message).toContain('not confirmed');
    expect(dispatched).toEqual(['/personas discover']);

    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/personas discover',
      '/personas import-discovered "Travel Planner" --use --yes',
    ]);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.title).toBe('Opening discovered persona import');
  });

  test('discovers and imports local routine files from the workspace after confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'routines');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-discover');
    workspace.activateSelected();
    expect(dispatched).toEqual(['/routines discover']);

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'routines-import-discovered');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('routine-discovery-import');
    feedText(workspace, 'Daily Brief');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    expect(workspace.localEditor?.message).toContain('Confirm is required');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(workspace.localEditor?.message).toContain('not confirmed');
    expect(dispatched).toEqual(['/routines discover']);

    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/routines discover',
      '/routines import-discovered "Daily Brief" --enabled --yes',
    ]);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.title).toBe('Opening discovered routine import');
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

  test('opens read-only Agent memory command forms from the workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-search');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('memory-search');
    feedText(workspace, 'release blocker');
    feedKey(workspace, 'enter');
    feedText(workspace, 'project');
    feedKey(workspace, 'enter');
    feedText(workspace, 'risk');
    feedKey(workspace, 'enter');
    feedText(workspace, '5');
    feedKey(workspace, 'enter');
    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/memory search "release blocker" --scope project --cls risk --limit 5 --semantic']);
    expect(workspace.localEditor).toBeNull();

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-get');
    workspace.activateSelected();
    feedText(workspace, 'mem-123');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-explain');
    workspace.activateSelected();
    feedText(workspace, 'Prepare release notes');
    feedKey(workspace, 'enter');
    feedText(workspace, 'project, team');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-handoff-inspect');
    workspace.activateSelected();
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-vector-status');
    workspace.activateSelected();

    expect(dispatched).toEqual([
      '/memory search "release blocker" --scope project --cls risk --limit 5 --semantic',
      '/memory get mem-123',
      '/memory explain "Prepare release notes" --scope project team',
      '/memory handoff-inspect agent-memory-handoff.json',
      '/memory vector status',
    ]);
  });

  test('requires confirmation before Agent memory maintenance workspace actions', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'memory');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-promote');
    workspace.activateSelected();
    feedText(workspace, 'mem-1');
    feedKey(workspace, 'enter');
    feedText(workspace, 'team');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.message).toContain('not confirmed');

    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-link');
    workspace.activateSelected();
    feedText(workspace, 'mem-1');
    feedKey(workspace, 'enter');
    feedText(workspace, 'mem-2');
    feedKey(workspace, 'enter');
    feedText(workspace, 'supports');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-export');
    workspace.activateSelected();
    feedKey(workspace, 'enter');
    feedText(workspace, 'project');
    feedKey(workspace, 'enter');
    feedText(workspace, 'fact');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-import');
    workspace.activateSelected();
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-handoff-export');
    workspace.activateSelected();
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-handoff-import');
    workspace.activateSelected();
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'memory-vector-rebuild');
    workspace.activateSelected();
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/memory promote mem-1 team --yes',
      '/memory link mem-1 mem-2 supports --yes',
      '/memory export agent-memory-bundle.json --scope project --cls fact --yes',
      '/memory import agent-memory-bundle.json --yes',
      '/memory handoff-export agent-memory-handoff.json --scope team --yes',
      '/memory handoff-import agent-memory-handoff.json --yes',
      '/memory vector rebuild',
    ]);
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
    expect(byId.get('agent-knowledge')?.command).toBe('/agent knowledge');
    expect(byId.get('profile')?.command).toBe('/agent profiles');
    expect(byId.get('persona')?.command).toBe('/agent personas');
    expect(byId.get('skills')?.command).toBe('/agent skills');
    expect(byId.get('routines')?.command).toBe('/agent routines');
    expect(byId.get('memory')?.command).toBe('/agent memory');
    expect(byId.get('channels')?.command).toBe('/agent channels');
    expect(byId.get('voice-media')?.command).toBe('/agent voice-media');
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

  test('imports Agent Knowledge URL lists from a confirmed workspace form', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-import-urls');

    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('knowledge-urls');
    expect(dispatched).toEqual([]);
    feedText(workspace, './agent sources.txt');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/knowledge import-urls "./agent sources.txt" --allow-private-hosts --yes']);
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

  test('reviews and maintains Agent Knowledge from workspace forms', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-get');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('knowledge-get');
    feedText(workspace, 'issue-1');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-review-issue');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('knowledge-review-issue');
    feedText(workspace, 'issue-1');
    feedKey(workspace, 'enter');
    clearEditorField(workspace);
    feedText(workspace, 'accept');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, '{"title":"Agent setup"}');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual(['/knowledge get issue-1']);
    expect(workspace.localEditor?.message).toContain('not confirmed');
    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-packet');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('knowledge-packet');
    feedText(workspace, 'Prepare a setup brief');
    feedKey(workspace, 'enter');
    feedText(workspace, 'docs,setup');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-explain');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('knowledge-explain');
    feedText(workspace, 'Explain setup memory');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-consolidate');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('knowledge-consolidate');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/knowledge get issue-1',
      '/knowledge review-issue issue-1 accept --reviewer agent --value "{\\"title\\":\\"Agent setup\\"}" --yes',
      '/knowledge packet "Prepare a setup brief" --scope docs --scope setup',
      '/knowledge explain "Explain setup memory"',
      '/knowledge consolidate light --yes',
    ]);
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

  test('reindexes Agent Knowledge only from a confirmed workspace form', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-reindex');

    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('knowledge-reindex');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.message).toContain('Confirm is required');

    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/knowledge reindex --yes']);
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
    const profile = createAgentRuntimeProfile(root, 'household');
    setAgentRuntimeProfileSelection(root, 'household');
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
    expect(snapshot.selectedRuntimeProfile).toBe('household');
    expect(snapshot.selectedRuntimeProfileExists).toBe(true);
    expect(snapshot.runtimeProfileCount).toBe(1);
    expect(snapshot.runtimeProfileRoot).toBe(getAgentRuntimeProfilesRoot(root));
    expect(snapshot.runtimeStarterTemplateCount).toBeGreaterThan(4);
    expect(snapshot.localStarterTemplateCount).toBe(0);

    const profileSnapshot = buildAgentWorkspaceRuntimeSnapshot({
      ...commandContext(),
      workspace: {
        shellPaths: {
          workingDirectory: root,
          homeDirectory: profile.homeDirectory,
        },
      },
      platform: {
        configManager: {
          get: () => undefined,
        },
      },
    } as unknown as CommandContext);

    expect(profileSnapshot.activeRuntimeProfile).toBe('household');
    expect(profileSnapshot.selectedRuntimeProfile).toBe('household');
    expect(profileSnapshot.runtimeProfileCount).toBe(1);
    expect(profileSnapshot.runtimeProfileRoot).toBe(getAgentRuntimeProfilesRoot(root));
  });

  test('agent profile command guides starter authoring and imports local starters', async () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-starter-author-'));
    const starterPath = join(root, 'starter.json');
    mkdirSync(join(root, '.goodvibes', 'agent', 'personas'), { recursive: true });
    mkdirSync(join(root, '.goodvibes', 'agent', 'skills', 'briefing'), { recursive: true });
    mkdirSync(join(root, '.goodvibes', 'agent', 'routines'), { recursive: true });
    writeFileSync(join(root, '.goodvibes', 'agent', 'personas', 'research.md'), [
      '---',
      'name: Research Operator',
      '---',
      'Prefer checked sources and clear unknowns.',
    ].join('\n'));
    writeFileSync(join(root, '.goodvibes', 'agent', 'skills', 'briefing', 'SKILL.md'), [
      '---',
      'name: Daily Brief Skill',
      '---',
      'Review work plans, approvals, routines, and Agent Knowledge before summarizing.',
    ].join('\n'));
    writeFileSync(join(root, '.goodvibes', 'agent', 'routines', 'evening.md'), [
      '---',
      'name: Evening Review',
      '---',
      'Review work plan, approvals, routines, and Agent Knowledge status.',
    ].join('\n'));
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
    expect(await registry.execute('agent-profile', ['show', 'lab'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('Agent profile: lab');
    expect(calls.at(-1)).toContain('starter: lab-operator');
    expect(await registry.execute('agent-profile', ['use', 'lab'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('without --yes');
    expect(readAgentRuntimeProfileSelection(root)).toBeNull();
    expect(await registry.execute('agent-profile', ['use', 'lab', '--yes'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('Default Agent profile selected: lab');
    expect(readAgentRuntimeProfileSelection(root)?.id).toBe('lab');
    expect(await registry.execute('agent-profile', ['default'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('Default Agent profile: lab');
    expect(await registry.execute('agent-profile', ['list'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('starter=lab-operator');
    expect(calls.at(-1)).toContain('default: lab');

    expect(await registry.execute('agent-profile', ['template', 'from-discovered', 'research-desk', '--name', 'Research Desk', '--yes'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('Agent starter template created from discovered behavior: research-desk');
    expect(await registry.execute('agent-profile', ['create', 'desk', '--template', 'research-desk', '--yes'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('starter: research-desk');

    expect(await registry.execute('agent-profile', ['create-from-discovered', 'field-desk', '--template-id', 'field-desk-starter', '--name', 'Field Desk', '--yes'], ctx)).toBe(true);
    expect(calls.at(-1)).toContain('Agent profile created from discovered behavior: field-desk');
    expect(calls.at(-1)).toContain('starter: field-desk-starter');
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

  test('previews starter templates shows profiles and deletes profiles from workspace forms', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-template-show');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('profile-template-show');
    feedText(workspace, 'operations');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-show');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('profile-show');
    feedText(workspace, 'household');
    feedKey(workspace, 'enter');

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-delete');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('profile-delete');
    feedText(workspace, 'old-profile');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([
      '/agent-profile template show operations',
      '/agent-profile show household',
    ]);
    expect(workspace.status).toContain('not confirmed');

    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/agent-profile template show operations',
      '/agent-profile show household',
      '/agent-profile delete old-profile --yes',
    ]);
    expect(workspace.lastActionResult?.title).toBe('Opening Agent profile deletion');
  });

  test('dispatches default profile selection from the workspace form after confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-default');

    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('profile-default');
    feedText(workspace, 'household');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([]);
    expect(workspace.status).toContain('not confirmed');

    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/agent-profile use household --yes']);
    expect(workspace.lastActionResult?.title).toBe('Opening default Agent profile selection');
  });

  test('dispatches default profile clearing from the workspace form after confirmation', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-clear-default');

    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('profile-default-clear');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([]);
    expect(workspace.status).toContain('not confirmed');

    clearEditorField(workspace);
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/agent-profile default clear --yes']);
    expect(workspace.lastActionResult?.title).toBe('Opening default Agent profile clear');
  });

  test('dispatches profile starter creation from discovered behavior through workspace form', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-template-from-discovered');

    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('profile-template-from-discovered');
    feedText(workspace, 'research-desk');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Research Desk');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Imported starter for research operations.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Research Operator');
    feedKey(workspace, 'enter');
    feedText(workspace, 'all');
    feedKey(workspace, 'enter');
    feedText(workspace, 'all');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/agent-profile template from-discovered research-desk --name "Research Desk" --description "Imported starter for research operations." --persona "Research Operator" --skills all --routines all --yes',
    ]);
    expect(workspace.lastActionResult?.title).toBe('Opening Agent starter-from-discovered creation');
  });

  test('dispatches profile creation from discovered behavior through workspace form', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'runtime-profile-from-discovered');

    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('profile-from-discovered');
    feedText(workspace, 'research-desk');
    feedKey(workspace, 'enter');
    feedText(workspace, 'research-desk-starter');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Research Desk');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Imported profile for research operations.');
    feedKey(workspace, 'enter');
    feedText(workspace, 'Research Operator');
    feedKey(workspace, 'enter');
    feedText(workspace, 'all');
    feedKey(workspace, 'enter');
    feedText(workspace, 'all');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual([
      '/agent-profile create-from-discovered research-desk --template-id research-desk-starter --name "Research Desk" --description "Imported profile for research operations." --persona "Research Operator" --skills all --routines all --yes',
    ]);
    expect(workspace.lastActionResult?.title).toBe('Opening Agent profile-from-discovered creation');
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

    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'schedule-receipt');
    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('schedule-receipt');
    feedText(workspace, 'receipt-456');
    feedKey(workspace, 'enter');

    expect(dispatched.at(-1)).toBe('/schedule receipt receipt-456');
    expect(workspace.lastActionResult?.safety).toBe('read-only');
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

  test('automation workspace opens health repair guidance from a domain form', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'automation');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'health-repair');

    workspace.activateSelected();
    expect(workspace.localEditor?.kind).toBe('health-repair');
    clearEditorField(workspace);
    feedText(workspace, 'accounts');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/health repair accounts']);
    expect(workspace.lastActionResult?.safety).toBe('read-only');
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
    expect(actionText).toContain('delegate-task');
    expect(actionText).toContain('Open a confirmed form');
    expect(actionText).not.toContain('remote runner');
    expect(actionText).not.toContain('/remote dispatch');
  });

  test('delegates build work from a confirmed workspace form without default WRFC', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'delegate-task');

    workspace.activateSelected();

    expect(workspace.localEditor?.kind).toBe('delegate-task');
    feedText(workspace, 'Fix the installer crash and add a regression test');
    feedKey(workspace, 'enter');
    feedKey(workspace, 'enter');
    feedText(workspace, 'no');
    feedKey(workspace, 'enter');
    expect(dispatched).toEqual([]);
    expect(workspace.localEditor?.message).toContain('not confirmed');

    feedKey(workspace, 'backspace');
    feedKey(workspace, 'backspace');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/delegate "Fix the installer crash and add a regression test"']);
    expect(workspace.localEditor).toBeNull();
    expect(workspace.lastActionResult?.safety).toBe('delegates');
  });

  test('delegation workspace requests WRFC only when explicitly selected', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'delegate-task');

    workspace.activateSelected();

    feedText(workspace, 'Review the release workflow implementation');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');
    feedText(workspace, 'yes');
    feedKey(workspace, 'enter');

    expect(dispatched).toEqual(['/delegate --wrfc "Review the release workflow implementation"']);
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
      openAgentWorkspace: (categoryId?: string) => opened.push(categoryId ? `agent:${categoryId}` : 'agent'),
      print: (text: string) => opened.push(`print:${text}`),
    } as unknown as CommandContext;

    expect(await registry.execute('agent', [], ctx)).toBe(true);
    expect(await registry.execute('home', [], ctx)).toBe(true);
    expect(await registry.execute('operator', [], ctx)).toBe(true);
    expect(opened).toEqual(['agent', 'agent', 'agent']);
  });

  test('opens the Agent workspace directly to a requested category', async () => {
    const registry = new CommandRegistry();
    registerAgentWorkspaceRuntimeCommands(registry);
    const opened: string[] = [];
    const ctx = {
      openAgentWorkspace: (categoryId?: string) => opened.push(categoryId ? `agent:${categoryId}` : 'agent'),
      print: (text: string) => opened.push(`print:${text}`),
    } as unknown as CommandContext;

    expect(await registry.execute('agent', ['voice-media'], ctx)).toBe(true);
    expect(await registry.execute('operator', ['Channels'], ctx)).toBe(true);
    expect(opened).toEqual(['agent:voice-media', 'agent:Channels']);
  });

  test('selects Agent workspace categories by id or label', () => {
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), () => undefined, 'voice-media');
    expect(workspace.selectedCategory.id).toBe('voice-media');

    expect(workspace.selectCategory('Channels')).toBe(true);
    expect(workspace.selectedCategory.id).toBe('channels');

    expect(workspace.selectCategory('not-a-category')).toBe(false);
    expect(workspace.selectedCategory.id).toBe('channels');
  });
});
