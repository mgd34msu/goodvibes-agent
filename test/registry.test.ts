import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { MemoryStore } from '../src/store/memory.js';
import { SkillStore } from '../src/store/skills.js';
import { PersonaStore } from '../src/store/personas.js';

let previousHome: string | undefined;
let testHome = '';

beforeEach(async () => {
  previousHome = process.env.GOODVIBES_AGENT_HOME;
  testHome = await mkdtemp(join(tmpdir(), 'goodvibes-agent-test-'));
  process.env.GOODVIBES_AGENT_HOME = testHome;
});

afterEach(async () => {
  if (previousHome === undefined) {
    delete process.env.GOODVIBES_AGENT_HOME;
  } else {
    process.env.GOODVIBES_AGENT_HOME = previousHome;
  }
  await rm(testHome, { recursive: true, force: true });
});

describe('local registries', () => {
  test('memory records have SDK-aligned review and sensitivity fields', () => {
    const store = new MemoryStore();
    const record = store.remember({
      summary: 'We use Bun for goodvibes-agent',
      cls: 'constraint',
      tags: ['runtime'],
      source: 'test',
    });

    expect(record.scope).toBe('project');
    expect(record.cls).toBe('constraint');
    expect(record.reviewState).toBe('fresh');
    expect(record.sensitivity).toBe('project');

    const reviewed = store.update(record.id, { reviewState: 'reviewed', reviewedBy: 'test' });
    expect(reviewed.reviewState).toBe('reviewed');
    expect(reviewed.reviewedBy).toBe('test');
    expect(reviewed.reviewedAt).toBeNumber();
  });

  test('memory rejects secret values', () => {
    const store = new MemoryStore();
    expect(() => store.remember({ summary: 'api key is abc123' })).toThrow('Secret values');
  });

  test('memory confidence is constrained to SDK range', () => {
    const store = new MemoryStore();
    expect(() => store.remember({ summary: 'Confidence out of range', confidence: 101 })).toThrow('between 0 and 100');
  });

  test('skills enforce unique names and delete by name', () => {
    const store = new SkillStore();
    const skill = store.create({ name: 'weekly-plan', description: 'Plan the week' });

    expect(() => store.create({ name: 'weekly-plan' })).toThrow('already exists');
    expect(store.delete(skill.name).id).toBe(skill.id);
    expect(store.list()).toHaveLength(0);
  });

  test('personas update by name and keep review metadata', () => {
    const store = new PersonaStore();
    const persona = store.create({ name: 'travel', body: 'Plan travel carefully.' });
    const reviewed = store.update(persona.name, {
      description: 'Travel planning mode.',
      reviewState: 'reviewed',
      reviewedBy: 'test',
    });

    expect(reviewed.description).toBe('Travel planning mode.');
    expect(reviewed.reviewState).toBe('reviewed');
    expect(store.find(persona.id)?.name).toBe('travel');
  });
});
