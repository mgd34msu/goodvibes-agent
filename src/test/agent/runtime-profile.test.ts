import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertValidAgentRuntimeProfileId,
  createAgentRuntimeProfile,
  deleteAgentRuntimeProfile,
  getAgentRuntimeProfilesRoot,
  listAgentRuntimeProfileTemplates,
  listAgentRuntimeProfiles,
  normalizeAgentRuntimeProfileId,
  resolveAgentRuntimeProfileHome,
} from '../../agent/runtime-profile.ts';
import { AgentPersonaRegistry } from '../../agent/persona-registry.ts';
import { AgentRoutineRegistry } from '../../agent/routine-registry.ts';
import { AgentSkillRegistry } from '../../agent/skill-registry.ts';

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'goodvibes-agent-profile-home-'));
}

describe('Agent runtime profiles', () => {
  test('normalizes profile names into stable launch ids', () => {
    expect(normalizeAgentRuntimeProfileId('Household Ops')).toBe('household-ops');
    expect(normalizeAgentRuntimeProfileId('  ops.prod  ')).toBe('ops.prod');
  });

  test('rejects path traversal and empty profile names', () => {
    expect(() => assertValidAgentRuntimeProfileId('../default')).toThrow('path traversal');
    expect(() => assertValidAgentRuntimeProfileId('!!!')).toThrow('Agent profile names');
  });

  test('resolves isolated profile home below the Agent profile root', () => {
    const home = makeHome();
    const resolved = resolveAgentRuntimeProfileHome(home, 'Household Ops');
    expect(resolved.id).toBe('household-ops');
    expect(resolved.homeDirectory).toBe(join(getAgentRuntimeProfilesRoot(home), 'household-ops'));
  });

  test('creates, lists, and deletes isolated profile homes', () => {
    const home = makeHome();
    const created = createAgentRuntimeProfile(home, 'Household');
    expect(created.id).toBe('household');
    expect(existsSync(created.homeDirectory)).toBe(true);

    const profiles = listAgentRuntimeProfiles(home);
    expect(profiles.map((profile) => profile.id)).toEqual(['household']);
    expect(typeof profiles[0]?.createdAt).toBe('string');

    expect(deleteAgentRuntimeProfile(home, 'household')).toBe(true);
    expect(deleteAgentRuntimeProfile(home, 'household')).toBe(false);
    expect(listAgentRuntimeProfiles(home)).toEqual([]);
  });

  test('lists curated starter profile templates', () => {
    const ids = listAgentRuntimeProfileTemplates().map((template) => template.id);
    expect(ids).toEqual(['household', 'research', 'travel', 'operations', 'personal-productivity']);
  });

  test('creates a profile from a starter template with local persona skills and routine', () => {
    const home = makeHome();
    const created = createAgentRuntimeProfile(home, 'Ops', { templateId: 'operations' });
    expect(created.id).toBe('ops');
    expect(created.starterTemplateId).toBe('operations');
    expect(created.starterTemplateApplication?.personaIds).toEqual(['operations-lead']);
    expect(created.starterTemplateApplication?.skillIds).toContain('incident-intake');
    expect(created.starterTemplateApplication?.routineIds).toEqual(['daily-operations-sweep']);

    const persona = new AgentPersonaRegistry(join(created.homeDirectory, '.goodvibes', 'agent', 'personas', 'personas.json')).snapshot();
    const skills = new AgentSkillRegistry(join(created.homeDirectory, '.goodvibes', 'agent', 'skills', 'skills.json')).snapshot();
    const routines = new AgentRoutineRegistry(join(created.homeDirectory, '.goodvibes', 'agent', 'routines', 'routines.json')).snapshot();
    expect(persona.activePersona?.name).toBe('Operations Lead');
    expect(skills.enabledSkills.map((skill) => skill.name)).toContain('Incident Intake');
    expect(routines.enabledRoutines.map((routine) => routine.name)).toContain('Daily Operations Sweep');

    const listed = listAgentRuntimeProfiles(home);
    expect(listed[0]?.starterTemplateId).toBe('operations');
  });
});
