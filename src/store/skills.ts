import { join } from 'node:path';
import { agentHomeDir } from '../config.js';
import { createId } from '../utils/ids.js';
import { JsonStore } from './json-store.js';

export interface SkillRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly triggers: readonly string[];
  readonly steps: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly source: string;
}

interface SkillState {
  readonly skills: readonly SkillRecord[];
}

export class SkillStore {
  private readonly store = new JsonStore<SkillState>(join(agentHomeDir(), 'skills.json'), { skills: [] });

  list(): readonly SkillRecord[] {
    return this.store.read().skills;
  }

  create(input: {
    readonly name: string;
    readonly description?: string | undefined;
    readonly triggers?: readonly string[] | undefined;
    readonly steps?: readonly string[] | undefined;
    readonly source?: string | undefined;
  }): SkillRecord {
    const now = Date.now();
    const record: SkillRecord = {
      id: createId('skill'),
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      triggers: input.triggers ?? [],
      steps: input.steps ?? [],
      createdAt: now,
      updatedAt: now,
      source: input.source ?? 'assistant',
    };
    if (!record.name) throw new Error('Skill name cannot be empty.');
    this.store.update((state) => ({ skills: [record, ...state.skills] }));
    return record;
  }

  search(query: string): readonly SkillRecord[] {
    const q = query.toLowerCase();
    return this.list().filter((skill) => (
      skill.name.toLowerCase().includes(q)
      || skill.description.toLowerCase().includes(q)
      || skill.triggers.some((trigger) => trigger.toLowerCase().includes(q))
    ));
  }
}
