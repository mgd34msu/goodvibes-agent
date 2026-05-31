import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertValidAgentRuntimeProfileId,
  createAgentRuntimeProfile,
  deleteAgentRuntimeProfile,
  exportAgentRuntimeProfileTemplate,
  getAgentRuntimeProfilesRoot,
  importAgentRuntimeProfileTemplate,
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

  test('exports edits imports and uses a local starter template', () => {
    const home = makeHome();
    const exportedPath = join(home, 'research-starter.json');
    const exported = exportAgentRuntimeProfileTemplate(home, 'research', exportedPath);
    expect(exported.path).toBe(exportedPath);

    const raw = JSON.parse(readFileSync(exportedPath, 'utf-8')) as {
      template: {
        id: string;
        name: string;
        persona: { name: string };
        skills: Array<{ name: string }>;
        routines: Array<{ name: string }>;
      };
    };
    raw.template.id = 'lab-operator';
    raw.template.name = 'Lab Operator';
    raw.template.persona.name = 'Lab Operator';
    raw.template.skills[0]!.name = 'Lab Source Brief';
    raw.template.routines[0]!.name = 'Lab Review';
    writeFileSync(exportedPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8');

    const imported = importAgentRuntimeProfileTemplate(home, exportedPath);
    expect(imported.id).toBe('lab-operator');
    expect(imported.source).toBe('local');
    expect(listAgentRuntimeProfileTemplates(home).map((template) => template.id)).toContain('lab-operator');

    const profile = createAgentRuntimeProfile(home, 'lab', { templateId: 'lab-operator' });
    const persona = new AgentPersonaRegistry(join(profile.homeDirectory, '.goodvibes', 'agent', 'personas', 'personas.json')).snapshot();
    expect(persona.activePersona?.name).toBe('Lab Operator');
  });
});
