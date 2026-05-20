import { join } from 'node:path';
import { agentHomeDir } from '../config.js';
import { createId } from '../utils/ids.js';
import { RegistryConflictError, RegistryNotFoundError } from './errors.js';
import { JsonStore } from './json-store.js';

export type SkillReviewState = 'fresh' | 'reviewed' | 'stale';

export interface SkillRecord {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly triggers: readonly string[];
  readonly tags: readonly string[];
  readonly body: string;
  readonly steps: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly source: string;
  readonly provenance: readonly string[];
  readonly reviewState: SkillReviewState;
  readonly reviewedAt?: number | undefined;
  readonly reviewedBy?: string | undefined;
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
    readonly title?: string | undefined;
    readonly description?: string | undefined;
    readonly triggers?: readonly string[] | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly body?: string | undefined;
    readonly steps?: readonly string[] | undefined;
    readonly source?: string | undefined;
    readonly provenance?: readonly string[] | undefined;
    readonly reviewState?: SkillReviewState | undefined;
  }): SkillRecord {
    const now = Date.now();
    const name = input.name.trim();
    if (!name) throw new Error('Skill name cannot be empty.');
    this.assertUniqueName(name);
    const record: SkillRecord = {
      id: createId('skill'),
      name,
      title: input.title?.trim() ?? name,
      description: input.description?.trim() ?? '',
      body: input.body?.trim() ?? '',
      triggers: input.triggers ?? [],
      tags: input.tags ?? [],
      steps: input.steps ?? [],
      createdAt: now,
      updatedAt: now,
      source: input.source ?? 'assistant',
      provenance: input.provenance ?? ['goodvibes-agent'],
      reviewState: input.reviewState ?? 'fresh',
    };
    this.store.update((state) => ({ skills: [record, ...state.skills] }));
    return record;
  }

  update(idOrName: string, patch: {
    readonly name?: string | undefined;
    readonly title?: string | undefined;
    readonly description?: string | undefined;
    readonly triggers?: readonly string[] | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly body?: string | undefined;
    readonly steps?: readonly string[] | undefined;
    readonly source?: string | undefined;
    readonly provenance?: readonly string[] | undefined;
    readonly reviewState?: SkillReviewState | undefined;
    readonly reviewedBy?: string | undefined;
  }): SkillRecord {
    const existing = this.find(idOrName);
    if (!existing) throw new RegistryNotFoundError('skill', idOrName);
    const nextName = patch.name?.trim() ?? existing.name;
    if (!nextName) throw new Error('Skill name cannot be empty.');
    this.assertUniqueName(nextName, existing.id);
    const now = Date.now();
    let updated: SkillRecord | null = null;
    this.store.update((state) => ({
      skills: state.skills.map((skill) => {
        if (skill.id !== existing.id) return skill;
        updated = {
          ...skill,
          name: nextName,
          title: patch.title?.trim() ?? skill.title,
          description: patch.description?.trim() ?? skill.description,
          triggers: patch.triggers ?? skill.triggers,
          tags: patch.tags ?? skill.tags,
          body: patch.body?.trim() ?? skill.body,
          steps: patch.steps ?? skill.steps,
          source: patch.source ?? skill.source,
          provenance: patch.provenance ?? skill.provenance,
          reviewState: patch.reviewState ?? skill.reviewState,
          reviewedAt: patch.reviewState === 'reviewed' ? now : skill.reviewedAt,
          reviewedBy: patch.reviewedBy ?? skill.reviewedBy,
          updatedAt: now,
        };
        return updated;
      }),
    }));
    if (!updated) throw new RegistryNotFoundError('skill', idOrName);
    return updated;
  }

  delete(idOrName: string): SkillRecord {
    const existing = this.find(idOrName);
    if (!existing) throw new RegistryNotFoundError('skill', idOrName);
    this.store.update((state) => ({ skills: state.skills.filter((skill) => skill.id !== existing.id) }));
    return existing;
  }

  find(idOrName: string): SkillRecord | null {
    const needle = idOrName.toLowerCase();
    return this.list().find((skill) => (
      skill.id === idOrName || skill.name.toLowerCase() === needle
    )) ?? null;
  }

  search(query: string): readonly SkillRecord[] {
    const q = query.toLowerCase();
    if (!q) return this.list();
    return this.list().filter((skill) => (
      skill.name.toLowerCase().includes(q)
      || skill.title.toLowerCase().includes(q)
      || skill.description.toLowerCase().includes(q)
      || skill.body.toLowerCase().includes(q)
      || skill.triggers.some((trigger) => trigger.toLowerCase().includes(q))
      || skill.tags.some((tag) => tag.toLowerCase().includes(q))
    ));
  }

  private assertUniqueName(name: string, exceptId?: string): void {
    const needle = name.toLowerCase();
    const duplicate = this.list().find((skill) => skill.id !== exceptId && skill.name.toLowerCase() === needle);
    if (duplicate) throw new RegistryConflictError('skill', name);
  }
}
