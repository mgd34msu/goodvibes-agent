import { join } from 'node:path';
import { agentHomeDir } from '../config.js';
import { JsonStore } from './json-store.js';

export interface AssistantProfileState {
  readonly activePersona: string;
  readonly activeSkills: readonly string[];
  readonly updatedAt: number;
}

const defaultState: AssistantProfileState = {
  activePersona: 'operator',
  activeSkills: [],
  updatedAt: 0,
};

export class AssistantProfileStore {
  private readonly store: JsonStore<AssistantProfileState>;

  constructor(path = join(agentHomeDir(), 'profile.json')) {
    this.store = new JsonStore(path, defaultState);
  }

  current(): AssistantProfileState {
    return this.store.read();
  }

  setActivePersona(idOrName: string): AssistantProfileState {
    const activePersona = idOrName.trim();
    if (!activePersona) throw new Error('Active persona cannot be empty.');
    return this.store.update((state) => ({
      ...state,
      activePersona,
      updatedAt: Date.now(),
    }));
  }

  enableSkill(idOrName: string): AssistantProfileState {
    const skill = idOrName.trim();
    if (!skill) throw new Error('Active skill cannot be empty.');
    return this.store.update((state) => ({
      ...state,
      activeSkills: state.activeSkills.includes(skill)
        ? state.activeSkills
        : [...state.activeSkills, skill],
      updatedAt: Date.now(),
    }));
  }

  disableSkill(idOrName: string): AssistantProfileState {
    const skill = idOrName.trim();
    if (!skill) throw new Error('Active skill cannot be empty.');
    return this.store.update((state) => ({
      ...state,
      activeSkills: state.activeSkills.filter((active) => active !== skill),
      updatedAt: Date.now(),
    }));
  }

  clearSkills(): AssistantProfileState {
    return this.store.update((state) => ({
      ...state,
      activeSkills: [],
      updatedAt: Date.now(),
    }));
  }
}
