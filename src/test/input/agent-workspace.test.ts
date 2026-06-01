import { describe, expect, test } from 'bun:test';
import type { InputToken } from '@pellux/goodvibes-sdk/platform/core';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandRegistry, type CommandContext } from '../../input/command-registry.ts';
import { AgentWorkspace, buildAgentWorkspaceRuntimeSnapshot, handleAgentWorkspaceToken } from '../../input/agent-workspace.ts';
import { registerAgentWorkspaceRuntimeCommands } from '../../input/commands/agent-workspace-runtime.ts';
import { registerAgentRuntimeProfileRuntimeCommands } from '../../input/commands/agent-runtime-profile-runtime.ts';
import { AgentPersonaRegistry } from '../../agent/persona-registry.ts';
import { AgentRoutineRegistry } from '../../agent/routine-registry.ts';
import { AgentSkillRegistry } from '../../agent/skill-registry.ts';
import { createAgentRuntimeProfile } from '../../agent/runtime-profile.ts';
import { renderAgentWorkspace } from '../../renderer/agent-workspace.ts';
import { createShellPathService } from '@/runtime/index.ts';
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

describe('AgentWorkspace', () => {
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
    workspace.selectedActionIndex = 1;

    workspace.activateSelected();

    expect(dispatched).toEqual(['/model']);
    expect(workspace.status).toContain('/model');
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
    expect(routine?.startCount).toBe(1);
    expect(dispatched).toEqual([]);
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
    expect(workspace.selectedCategory.detail).toContain('/api/goodvibes-agent/knowledge');
    expect(workspace.selectedCategory.detail).toContain('Default regular wiki and non-Agent knowledge segments are not');
  });

  test('does not dispatch Agent Knowledge ingest templates without real target values', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'knowledge');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'knowledge-ingest-url');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.lastActionResult?.kind).toBe('guidance');
    expect(workspace.status).toContain('Placeholder command not dispatched');
  });

  test('summarizes voice and media provider coverage in the runtime snapshot', () => {
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
    expect(snapshot.browserSurfaceEnabled).toBe(true);
    expect(snapshot.browserSurfacePublicBaseUrl).toBe('https://agent.example.test');
  });

  test('does not dispatch voice media command templates without real target values', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'voice-media');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'tts-speak');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.lastActionResult?.kind).toBe('guidance');
    expect(workspace.status).toContain('Placeholder command not dispatched');
  });

  test('summarizes runtime and config profile posture', () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-workspace-profiles-'));
    createAgentRuntimeProfile(root, 'household');
    const snapshot = buildAgentWorkspaceRuntimeSnapshot({
      ...commandContext(),
      workspace: {
        shellPaths: {
          workingDirectory: root,
          homeDirectory: root,
        },
        profileManager: {
          list: () => [
            { name: 'operator', timestamp: Date.now() },
            { name: 'travel', timestamp: Date.now() - 1000 },
          ],
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
    expect(snapshot.configProfileCount).toBe(2);
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

  test('does not dispatch profile export templates without real target values', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'profiles');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'profile-sync-export');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.lastActionResult?.kind).toBe('guidance');
    expect(workspace.status).toContain('Placeholder command not dispatched');
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

  test('blocks copied TUI-only blocked commands inside the workspace', () => {
    const dispatched: string[] = [];
    const workspace = new AgentWorkspace();
    workspace.open(commandContext(), (command) => dispatched.push(command));
    workspace.selectedCategoryIndex = workspace.categories.findIndex((category) => category.id === 'delegate');
    workspace.selectedActionIndex = workspace.actions.findIndex((action) => action.id === 'remote-policy');

    workspace.activateSelected();

    expect(dispatched).toEqual([]);
    expect(workspace.status).toContain('Blocked here');
    expect(workspace.lastActionResult?.kind).toBe('blocked');
    expect(workspace.lastActionResult?.command).toBe('/remote dispatch');
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
