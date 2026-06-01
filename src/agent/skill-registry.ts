import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ShellPathService } from '@/runtime/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';
import { assertNoSecretLikeText } from './persona-registry.ts';

export type AgentSkillSource = 'user' | 'agent' | 'imported' | 'system';
export type AgentSkillReviewState = 'fresh' | 'reviewed' | 'stale';

export interface AgentSkillRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly procedure: string;
  readonly triggers: readonly string[];
  readonly tags: readonly string[];
  readonly enabled: boolean;
  readonly source: AgentSkillSource;
  readonly provenance: string;
  readonly reviewState: AgentSkillReviewState;
  readonly staleReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly reviewedAt?: string;
}

export interface AgentSkillBundleRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly skillIds: readonly string[];
  readonly enabled: boolean;
  readonly source: AgentSkillSource;
  readonly provenance: string;
  readonly reviewState: AgentSkillReviewState;
  readonly staleReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly reviewedAt?: string;
}

export interface AgentSkillCreateInput {
  readonly name: string;
  readonly description: string;
  readonly procedure: string;
  readonly triggers?: readonly string[];
  readonly tags?: readonly string[];
  readonly enabled?: boolean;
  readonly source?: AgentSkillSource;
  readonly provenance?: string;
}

export interface AgentSkillBundleCreateInput {
  readonly name: string;
  readonly description: string;
  readonly skillIds: readonly string[];
  readonly enabled?: boolean;
  readonly source?: AgentSkillSource;
  readonly provenance?: string;
}

export interface AgentSkillUpdateInput {
  readonly name?: string;
  readonly description?: string;
  readonly procedure?: string;
  readonly triggers?: readonly string[];
  readonly tags?: readonly string[];
  readonly provenance?: string;
}

export interface AgentSkillBundleUpdateInput {
  readonly name?: string;
  readonly description?: string;
  readonly skillIds?: readonly string[];
  readonly provenance?: string;
}

export interface AgentSkillSnapshot {
  readonly path: string;
  readonly skills: readonly AgentSkillRecord[];
  readonly enabledSkills: readonly AgentSkillRecord[];
  readonly bundles: readonly AgentSkillBundleRecord[];
  readonly enabledBundles: readonly AgentSkillBundleRecord[];
  readonly activeSkills: readonly AgentSkillRecord[];
}

interface SkillStoreFile {
  readonly version: 1;
  readonly skills: readonly AgentSkillRecord[];
  readonly bundles: readonly AgentSkillBundleRecord[];
}

const STORE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function normalizeList(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'skill';
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseSkill(value: unknown): AgentSkillRecord | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id).trim();
  const name = normalizeName(readString(value.name));
  const description = readString(value.description).trim();
  const procedure = readString(value.procedure).trim();
  if (!id || !name || !description || !procedure) return null;
  const reviewState = value.reviewState === 'reviewed' || value.reviewState === 'stale' ? value.reviewState : 'fresh';
  const source = value.source === 'agent' || value.source === 'imported' || value.source === 'system' ? value.source : 'user';
  const staleReason = readString(value.staleReason).trim();
  const reviewedAt = readString(value.reviewedAt).trim();
  return {
    id,
    name,
    description,
    procedure,
    triggers: readStringArray(value.triggers),
    tags: readStringArray(value.tags),
    enabled: value.enabled === true,
    source,
    provenance: readString(value.provenance, source).trim() || source,
    reviewState,
    staleReason: staleReason || undefined,
    createdAt: readString(value.createdAt, nowIso()),
    updatedAt: readString(value.updatedAt, nowIso()),
    reviewedAt: reviewedAt || undefined,
  };
}

function parseBundle(value: unknown): AgentSkillBundleRecord | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id).trim();
  const name = normalizeName(readString(value.name));
  const description = readString(value.description).trim();
  const skillIds = readStringArray(value.skillIds).map(slugify).filter(Boolean);
  if (!id || !name || !description || skillIds.length === 0) return null;
  const reviewState = value.reviewState === 'reviewed' || value.reviewState === 'stale' ? value.reviewState : 'fresh';
  const source = value.source === 'agent' || value.source === 'imported' || value.source === 'system' ? value.source : 'user';
  const staleReason = readString(value.staleReason).trim();
  const reviewedAt = readString(value.reviewedAt).trim();
  return {
    id,
    name,
    description,
    skillIds: normalizeList(skillIds).map(slugify),
    enabled: value.enabled === true,
    source,
    provenance: readString(value.provenance, source).trim() || source,
    reviewState,
    staleReason: staleReason || undefined,
    createdAt: readString(value.createdAt, nowIso()),
    updatedAt: readString(value.updatedAt, nowIso()),
    reviewedAt: reviewedAt || undefined,
  };
}

function parseStore(raw: string): SkillStoreFile {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return { version: STORE_VERSION, skills: [], bundles: [] };
  return {
    version: STORE_VERSION,
    skills: Array.isArray(parsed.skills)
      ? parsed.skills.map(parseSkill).filter((entry): entry is AgentSkillRecord => entry !== null)
      : [],
    bundles: Array.isArray(parsed.bundles)
      ? parsed.bundles.map(parseBundle).filter((entry): entry is AgentSkillBundleRecord => entry !== null)
      : [],
  };
}

function formatStore(store: SkillStoreFile): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

export function skillStorePath(shellPaths: ShellPathService): string {
  return shellPaths.resolveUserPath(GOODVIBES_AGENT_SURFACE_ROOT, 'skills', 'skills.json');
}

export class AgentSkillRegistry {
  public constructor(private readonly storePath: string) {}

  public static fromShellPaths(shellPaths: ShellPathService): AgentSkillRegistry {
    return new AgentSkillRegistry(skillStorePath(shellPaths));
  }

  public snapshot(): AgentSkillSnapshot {
    const store = this.readStore();
    const enabledBundles = store.bundles.filter((bundle) => bundle.enabled);
    const activeSkillIds = new Set<string>(store.skills.filter((skill) => skill.enabled).map((skill) => skill.id));
    for (const bundle of enabledBundles) {
      for (const skillId of bundle.skillIds) activeSkillIds.add(skillId);
    }
    return {
      path: this.storePath,
      skills: [...store.skills],
      enabledSkills: store.skills.filter((skill) => skill.enabled),
      bundles: [...store.bundles],
      enabledBundles,
      activeSkills: store.skills.filter((skill) => activeSkillIds.has(skill.id)),
    };
  }

  public list(): readonly AgentSkillRecord[] {
    return this.snapshot().skills;
  }

  public search(query: string): readonly AgentSkillRecord[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return this.list();
    return this.list().filter((skill) => [
      skill.id,
      skill.name,
      skill.description,
      skill.procedure,
      ...skill.tags,
      ...skill.triggers,
    ].some((field) => field.toLowerCase().includes(normalized)));
  }

  public listBundles(): readonly AgentSkillBundleRecord[] {
    return this.snapshot().bundles;
  }

  public searchBundles(query: string): readonly AgentSkillBundleRecord[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return this.listBundles();
    return this.listBundles().filter((bundle) => [
      bundle.id,
      bundle.name,
      bundle.description,
      ...bundle.skillIds,
    ].some((field) => field.toLowerCase().includes(normalized)));
  }

  public get(idOrName: string): AgentSkillRecord | null {
    const lookup = idOrName.trim().toLowerCase();
    if (!lookup) return null;
    return this.list().find((skill) => skill.id.toLowerCase() === lookup || skill.name.toLowerCase() === lookup) ?? null;
  }

  public getBundle(idOrName: string): AgentSkillBundleRecord | null {
    const lookup = idOrName.trim().toLowerCase();
    if (!lookup) return null;
    return this.listBundles().find((bundle) => bundle.id.toLowerCase() === lookup || bundle.name.toLowerCase() === lookup) ?? null;
  }

  public create(input: AgentSkillCreateInput): AgentSkillRecord {
    const store = this.readStore();
    const name = normalizeName(input.name);
    const description = input.description.trim();
    const procedure = input.procedure.trim();
    this.validateRequired(name, description, procedure);
    assertNoSecretLikeText([name, description, procedure, ...(input.tags ?? []), ...(input.triggers ?? [])]);
    const duplicate = store.skills.find((skill) => skill.name.toLowerCase() === name.toLowerCase());
    if (duplicate) throw new Error(`Skill already exists: ${duplicate.id}`);
    const timestamp = nowIso();
    const skill: AgentSkillRecord = {
      id: this.nextId(name, store.skills),
      name,
      description,
      procedure,
      triggers: normalizeList(input.triggers),
      tags: normalizeList(input.tags),
      enabled: input.enabled === true,
      source: input.source ?? 'user',
      provenance: input.provenance?.trim() || input.source || 'user',
      reviewState: 'fresh',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.writeStore({ ...store, skills: [...store.skills, skill] });
    return skill;
  }

  public createBundle(input: AgentSkillBundleCreateInput): AgentSkillBundleRecord {
    const store = this.readStore();
    const name = normalizeName(input.name);
    const description = input.description.trim();
    const skillIds = this.normalizeExistingSkillIds(store, input.skillIds);
    this.validateBundleRequired(name, description, skillIds);
    assertNoSecretLikeText([name, description, ...skillIds]);
    const duplicate = store.bundles.find((bundle) => bundle.name.toLowerCase() === name.toLowerCase());
    if (duplicate) throw new Error(`Skill bundle already exists: ${duplicate.id}`);
    const timestamp = nowIso();
    const bundle: AgentSkillBundleRecord = {
      id: this.nextBundleId(name, store.bundles),
      name,
      description,
      skillIds,
      enabled: input.enabled === true,
      source: input.source ?? 'user',
      provenance: input.provenance?.trim() || input.source || 'user',
      reviewState: 'fresh',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.writeStore({ ...store, bundles: [...store.bundles, bundle] });
    return bundle;
  }

  public update(idOrName: string, input: AgentSkillUpdateInput): AgentSkillRecord {
    const store = this.readStore();
    const existing = this.findInStore(store, idOrName);
    if (!existing) throw new Error(`Unknown skill: ${idOrName}`);
    const name = input.name === undefined ? existing.name : normalizeName(input.name);
    const description = input.description === undefined ? existing.description : input.description.trim();
    const procedure = input.procedure === undefined ? existing.procedure : input.procedure.trim();
    this.validateRequired(name, description, procedure);
    assertNoSecretLikeText([name, description, procedure, ...(input.tags ?? []), ...(input.triggers ?? [])]);
    const duplicate = store.skills.find((skill) => skill.id !== existing.id && skill.name.toLowerCase() === name.toLowerCase());
    if (duplicate) throw new Error(`Skill already exists: ${duplicate.id}`);
    const updated: AgentSkillRecord = {
      ...existing,
      name,
      description,
      procedure,
      triggers: input.triggers === undefined ? existing.triggers : normalizeList(input.triggers),
      tags: input.tags === undefined ? existing.tags : normalizeList(input.tags),
      provenance: input.provenance === undefined ? existing.provenance : input.provenance.trim() || existing.provenance,
      reviewState: 'fresh',
      staleReason: undefined,
      reviewedAt: undefined,
      updatedAt: nowIso(),
    };
    this.writeStore({
      ...store,
      skills: store.skills.map((skill) => skill.id === existing.id ? updated : skill),
    });
    return updated;
  }

  public updateBundle(idOrName: string, input: AgentSkillBundleUpdateInput): AgentSkillBundleRecord {
    const store = this.readStore();
    const existing = this.findBundleInStore(store, idOrName);
    if (!existing) throw new Error(`Unknown skill bundle: ${idOrName}`);
    const name = input.name === undefined ? existing.name : normalizeName(input.name);
    const description = input.description === undefined ? existing.description : input.description.trim();
    const skillIds = input.skillIds === undefined ? existing.skillIds : this.normalizeExistingSkillIds(store, input.skillIds);
    this.validateBundleRequired(name, description, skillIds);
    assertNoSecretLikeText([name, description, ...skillIds]);
    const duplicate = store.bundles.find((bundle) => bundle.id !== existing.id && bundle.name.toLowerCase() === name.toLowerCase());
    if (duplicate) throw new Error(`Skill bundle already exists: ${duplicate.id}`);
    const updated: AgentSkillBundleRecord = {
      ...existing,
      name,
      description,
      skillIds,
      provenance: input.provenance === undefined ? existing.provenance : input.provenance.trim() || existing.provenance,
      reviewState: 'fresh',
      staleReason: undefined,
      reviewedAt: undefined,
      updatedAt: nowIso(),
    };
    this.writeStore({
      ...store,
      bundles: store.bundles.map((bundle) => bundle.id === existing.id ? updated : bundle),
    });
    return updated;
  }

  public setEnabled(idOrName: string, enabled: boolean): AgentSkillRecord {
    const store = this.readStore();
    const existing = this.findInStore(store, idOrName);
    if (!existing) throw new Error(`Unknown skill: ${idOrName}`);
    const updated: AgentSkillRecord = { ...existing, enabled, updatedAt: nowIso() };
    this.writeStore({
      ...store,
      skills: store.skills.map((skill) => skill.id === existing.id ? updated : skill),
    });
    return updated;
  }

  public setBundleEnabled(idOrName: string, enabled: boolean): AgentSkillBundleRecord {
    const store = this.readStore();
    const existing = this.findBundleInStore(store, idOrName);
    if (!existing) throw new Error(`Unknown skill bundle: ${idOrName}`);
    const updated: AgentSkillBundleRecord = { ...existing, enabled, updatedAt: nowIso() };
    this.writeStore({
      ...store,
      bundles: store.bundles.map((bundle) => bundle.id === existing.id ? updated : bundle),
    });
    return updated;
  }

  public markReviewed(idOrName: string): AgentSkillRecord {
    const store = this.readStore();
    const existing = this.findInStore(store, idOrName);
    if (!existing) throw new Error(`Unknown skill: ${idOrName}`);
    const updated: AgentSkillRecord = {
      ...existing,
      reviewState: 'reviewed',
      staleReason: undefined,
      reviewedAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.writeStore({
      ...store,
      skills: store.skills.map((skill) => skill.id === existing.id ? updated : skill),
    });
    return updated;
  }

  public markBundleReviewed(idOrName: string): AgentSkillBundleRecord {
    const store = this.readStore();
    const existing = this.findBundleInStore(store, idOrName);
    if (!existing) throw new Error(`Unknown skill bundle: ${idOrName}`);
    const updated: AgentSkillBundleRecord = {
      ...existing,
      reviewState: 'reviewed',
      staleReason: undefined,
      reviewedAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.writeStore({
      ...store,
      bundles: store.bundles.map((bundle) => bundle.id === existing.id ? updated : bundle),
    });
    return updated;
  }

  public markStale(idOrName: string, reason: string): AgentSkillRecord {
    const store = this.readStore();
    const existing = this.findInStore(store, idOrName);
    if (!existing) throw new Error(`Unknown skill: ${idOrName}`);
    const updated: AgentSkillRecord = {
      ...existing,
      reviewState: 'stale',
      staleReason: reason.trim() || 'Marked stale by user.',
      updatedAt: nowIso(),
    };
    this.writeStore({
      ...store,
      skills: store.skills.map((skill) => skill.id === existing.id ? updated : skill),
    });
    return updated;
  }

  public markBundleStale(idOrName: string, reason: string): AgentSkillBundleRecord {
    const store = this.readStore();
    const existing = this.findBundleInStore(store, idOrName);
    if (!existing) throw new Error(`Unknown skill bundle: ${idOrName}`);
    const updated: AgentSkillBundleRecord = {
      ...existing,
      reviewState: 'stale',
      staleReason: reason.trim() || 'Marked stale by user.',
      updatedAt: nowIso(),
    };
    this.writeStore({
      ...store,
      bundles: store.bundles.map((bundle) => bundle.id === existing.id ? updated : bundle),
    });
    return updated;
  }

  public deleteSkill(idOrName: string): AgentSkillRecord {
    const store = this.readStore();
    const existing = this.findInStore(store, idOrName);
    if (!existing) throw new Error(`Unknown skill: ${idOrName}`);
    this.writeStore({
      ...store,
      skills: store.skills.filter((skill) => skill.id !== existing.id),
      bundles: store.bundles
        .map((bundle) => ({ ...bundle, skillIds: bundle.skillIds.filter((skillId) => skillId !== existing.id) }))
        .filter((bundle) => bundle.skillIds.length > 0),
    });
    return existing;
  }

  public deleteBundle(idOrName: string): AgentSkillBundleRecord {
    const store = this.readStore();
    const existing = this.findBundleInStore(store, idOrName);
    if (!existing) throw new Error(`Unknown skill bundle: ${idOrName}`);
    this.writeStore({
      ...store,
      bundles: store.bundles.filter((bundle) => bundle.id !== existing.id),
    });
    return existing;
  }

  private validateRequired(name: string, description: string, procedure: string): void {
    if (!name) throw new Error('Skill name is required.');
    if (!description) throw new Error('Skill description is required.');
    if (!procedure) throw new Error('Skill procedure is required.');
  }

  private validateBundleRequired(name: string, description: string, skillIds: readonly string[]): void {
    if (!name) throw new Error('Skill bundle name is required.');
    if (!description) throw new Error('Skill bundle description is required.');
    if (skillIds.length === 0) throw new Error('Skill bundle must include at least one existing skill.');
  }

  private nextId(name: string, skills: readonly AgentSkillRecord[]): string {
    const base = slugify(name);
    const ids = new Set(skills.map((skill) => skill.id));
    if (!ids.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!ids.has(candidate)) return candidate;
    }
    throw new Error(`Could not allocate skill id for ${name}.`);
  }

  private nextBundleId(name: string, bundles: readonly AgentSkillBundleRecord[]): string {
    const base = slugify(name);
    const ids = new Set(bundles.map((bundle) => bundle.id));
    if (!ids.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!ids.has(candidate)) return candidate;
    }
    throw new Error(`Could not allocate skill bundle id for ${name}.`);
  }

  private findInStore(store: SkillStoreFile, idOrName: string): AgentSkillRecord | null {
    const lookup = idOrName.trim().toLowerCase();
    if (!lookup) return null;
    return store.skills.find((skill) => skill.id.toLowerCase() === lookup || skill.name.toLowerCase() === lookup) ?? null;
  }

  private findBundleInStore(store: SkillStoreFile, idOrName: string): AgentSkillBundleRecord | null {
    const lookup = idOrName.trim().toLowerCase();
    if (!lookup) return null;
    return store.bundles.find((bundle) => bundle.id.toLowerCase() === lookup || bundle.name.toLowerCase() === lookup) ?? null;
  }

  private normalizeExistingSkillIds(store: SkillStoreFile, skillIds: readonly string[]): readonly string[] {
    const normalized = normalizeList(skillIds).map(slugify);
    const known = new Set(store.skills.map((skill) => skill.id));
    for (const skillId of normalized) {
      if (!known.has(skillId)) throw new Error(`Unknown skill for bundle: ${skillId}`);
    }
    return normalized;
  }

  private readStore(): SkillStoreFile {
    if (!existsSync(this.storePath)) return { version: STORE_VERSION, skills: [], bundles: [] };
    try {
      return parseStore(readFileSync(this.storePath, 'utf-8'));
    } catch (error) {
      throw new Error(`Could not read Agent skill store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private writeStore(store: SkillStoreFile): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    const tmpPath = `${this.storePath}.tmp`;
    writeFileSync(tmpPath, formatStore(store), 'utf-8');
    renameSync(tmpPath, this.storePath);
  }
}

export function buildEnabledSkillsPrompt(shellPaths: ShellPathService): string | null {
  const snapshot = AgentSkillRegistry.fromShellPaths(shellPaths).snapshot();
  const active = snapshot.activeSkills;
  if (active.length === 0 && snapshot.enabledBundles.length === 0) return null;
  return [
    '## Enabled GoodVibes Agent Skills',
    'Use these local reusable procedures inside the same serial assistant conversation when they fit the user request.',
    '',
    ...snapshot.enabledBundles.slice(0, 4).flatMap((bundle) => [
      `### Skill Bundle: ${bundle.name}`,
      `Description: ${bundle.description}`,
      `Review state: ${bundle.reviewState}`,
      `Included skills: ${bundle.skillIds.join(', ')}`,
      '',
    ]),
    ...active.slice(0, 8).flatMap((skill) => [
      `### ${skill.name}`,
      `Description: ${skill.description}`,
      `Review state: ${skill.reviewState}`,
      `Triggers: ${skill.triggers.join(', ') || '(manual)'}`,
      skill.procedure,
      '',
    ]),
  ].join('\n').trim();
}
