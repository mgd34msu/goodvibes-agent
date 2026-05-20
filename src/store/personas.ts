import { join } from 'node:path';
import { agentHomeDir } from '../config.js';
import { createId } from '../utils/ids.js';
import { RegistryConflictError, RegistryNotFoundError } from './errors.js';
import { JsonStore } from './json-store.js';

export type PersonaReviewState = 'fresh' | 'reviewed' | 'stale';

export interface PersonaRecord {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly source: string;
  readonly provenance: readonly string[];
  readonly reviewState: PersonaReviewState;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly reviewedAt?: number | undefined;
  readonly reviewedBy?: string | undefined;
}

interface PersonaState {
  readonly personas: readonly PersonaRecord[];
}

export class PersonaStore {
  private readonly store = new JsonStore<PersonaState>(join(agentHomeDir(), 'personas.json'), { personas: defaultPersonas() });

  list(): readonly PersonaRecord[] {
    return this.store.read().personas;
  }

  create(input: {
    readonly name: string;
    readonly title?: string | undefined;
    readonly description?: string | undefined;
    readonly body?: string | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly source?: string | undefined;
    readonly provenance?: readonly string[] | undefined;
    readonly reviewState?: PersonaReviewState | undefined;
  }): PersonaRecord {
    const now = Date.now();
    const name = input.name.trim();
    if (!name) throw new Error('Persona name cannot be empty.');
    this.assertUniqueName(name);
    const record: PersonaRecord = {
      id: createId('persona'),
      name,
      title: input.title?.trim() ?? name,
      description: input.description?.trim() ?? '',
      body: input.body?.trim() ?? '',
      tags: input.tags ?? [],
      source: input.source ?? 'assistant',
      provenance: input.provenance ?? ['goodvibes-agent'],
      reviewState: input.reviewState ?? 'fresh',
      createdAt: now,
      updatedAt: now,
    };
    this.store.update((state) => ({ personas: [record, ...state.personas] }));
    return record;
  }

  update(idOrName: string, patch: {
    readonly name?: string | undefined;
    readonly title?: string | undefined;
    readonly description?: string | undefined;
    readonly body?: string | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly source?: string | undefined;
    readonly provenance?: readonly string[] | undefined;
    readonly reviewState?: PersonaReviewState | undefined;
    readonly reviewedBy?: string | undefined;
  }): PersonaRecord {
    const existing = this.find(idOrName);
    if (!existing) throw new RegistryNotFoundError('persona', idOrName);
    const nextName = patch.name?.trim() ?? existing.name;
    if (!nextName) throw new Error('Persona name cannot be empty.');
    this.assertUniqueName(nextName, existing.id);
    const now = Date.now();
    let updated: PersonaRecord | null = null;
    this.store.update((state) => ({
      personas: state.personas.map((persona) => {
        if (persona.id !== existing.id) return persona;
        updated = {
          ...persona,
          name: nextName,
          title: patch.title?.trim() ?? persona.title,
          description: patch.description?.trim() ?? persona.description,
          body: patch.body?.trim() ?? persona.body,
          tags: patch.tags ?? persona.tags,
          source: patch.source ?? persona.source,
          provenance: patch.provenance ?? persona.provenance,
          reviewState: patch.reviewState ?? persona.reviewState,
          reviewedAt: patch.reviewState === 'reviewed' ? now : persona.reviewedAt,
          reviewedBy: patch.reviewedBy ?? persona.reviewedBy,
          updatedAt: now,
        };
        return updated;
      }),
    }));
    if (!updated) throw new RegistryNotFoundError('persona', idOrName);
    return updated;
  }

  delete(idOrName: string): PersonaRecord {
    const existing = this.find(idOrName);
    if (!existing) throw new RegistryNotFoundError('persona', idOrName);
    this.store.update((state) => ({ personas: state.personas.filter((persona) => persona.id !== existing.id) }));
    return existing;
  }

  find(nameOrId: string): PersonaRecord | null {
    const needle = nameOrId.toLowerCase();
    return this.list().find((persona) => (
      persona.id === nameOrId || persona.name.toLowerCase() === needle
    )) ?? null;
  }

  search(query: string): readonly PersonaRecord[] {
    const q = query.toLowerCase();
    if (!q) return this.list();
    return this.list().filter((persona) => (
      persona.name.toLowerCase().includes(q)
      || persona.title.toLowerCase().includes(q)
      || persona.description.toLowerCase().includes(q)
      || persona.body.toLowerCase().includes(q)
      || persona.tags.some((tag) => tag.toLowerCase().includes(q))
    ));
  }

  private assertUniqueName(name: string, exceptId?: string): void {
    const needle = name.toLowerCase();
    const duplicate = this.list().find((persona) => persona.id !== exceptId && persona.name.toLowerCase() === needle);
    if (duplicate) throw new RegistryConflictError('persona', name);
  }
}

function defaultPersonas(): PersonaRecord[] {
  const now = Date.now();
  return [
    {
      id: 'persona_operator',
      name: 'operator',
      title: 'Operator',
      description: 'Default proactive serial assistant/operator.',
      body: 'Act as a proactive serial GoodVibes assistant. Make ordinary safe progress, use knowledge and memory, and delegate explicit build work to GoodVibes TUI.',
      tags: ['default', 'operator'],
      source: 'built-in',
      provenance: ['goodvibes-agent'],
      reviewState: 'reviewed',
      createdAt: now,
      updatedAt: now,
      reviewedAt: now,
      reviewedBy: 'goodvibes-agent',
    },
    {
      id: 'persona_research',
      name: 'research',
      title: 'Research',
      description: 'Careful knowledge and evidence gathering mode.',
      body: 'Gather relevant context, prefer durable knowledge and primary sources, and store useful non-sensitive findings.',
      tags: ['knowledge'],
      source: 'built-in',
      provenance: ['goodvibes-agent'],
      reviewState: 'reviewed',
      createdAt: now,
      updatedAt: now,
      reviewedAt: now,
      reviewedBy: 'goodvibes-agent',
    },
  ];
}
