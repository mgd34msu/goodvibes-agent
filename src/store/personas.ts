import { join } from 'node:path';
import { agentHomeDir } from '../config.js';
import { createId } from '../utils/ids.js';
import { JsonStore } from './json-store.js';

export interface PersonaRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly tags: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
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
    readonly description?: string | undefined;
    readonly systemPrompt?: string | undefined;
    readonly tags?: readonly string[] | undefined;
  }): PersonaRecord {
    const now = Date.now();
    const record: PersonaRecord = {
      id: createId('persona'),
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      systemPrompt: input.systemPrompt?.trim() ?? '',
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    if (!record.name) throw new Error('Persona name cannot be empty.');
    this.store.update((state) => ({ personas: [record, ...state.personas] }));
    return record;
  }

  find(nameOrId: string): PersonaRecord | null {
    const needle = nameOrId.toLowerCase();
    return this.list().find((persona) => (
      persona.id === nameOrId || persona.name.toLowerCase() === needle
    )) ?? null;
  }
}

function defaultPersonas(): PersonaRecord[] {
  const now = Date.now();
  return [
    {
      id: 'persona_operator',
      name: 'operator',
      description: 'Default proactive serial assistant/operator.',
      systemPrompt: 'Act as a proactive serial GoodVibes assistant. Make ordinary safe progress, use knowledge and memory, and delegate explicit build work to GoodVibes TUI.',
      tags: ['default', 'operator'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'persona_research',
      name: 'research',
      description: 'Careful knowledge and evidence gathering mode.',
      systemPrompt: 'Gather relevant context, prefer durable knowledge and primary sources, and store useful non-sensitive findings.',
      tags: ['knowledge'],
      createdAt: now,
      updatedAt: now,
    },
  ];
}
