import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ShellPathService } from '@/runtime/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../config/surface.ts';
import { assertNoSecretLikeText } from './persona-registry.ts';

export type AgentDocumentStatus = 'draft' | 'reviewed' | 'archived';

export interface AgentDocumentVersion {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly summary: string;
  readonly createdAt: string;
}

export interface AgentDocumentRecord {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly status: AgentDocumentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly versions: readonly AgentDocumentVersion[];
  readonly lastArtifactId?: string;
}

export interface AgentDocumentCreateInput {
  readonly title: string;
  readonly body: string;
  readonly tags?: readonly string[];
  readonly summary?: string;
}

export interface AgentDocumentUpdateInput {
  readonly title?: string;
  readonly body?: string;
  readonly tags?: readonly string[];
  readonly summary?: string;
  readonly status?: AgentDocumentStatus;
  readonly lastArtifactId?: string;
}

export interface AgentDocumentSnapshot {
  readonly path: string;
  readonly documents: readonly AgentDocumentRecord[];
}

interface DocumentStoreFile {
  readonly version: 1;
  readonly documents: readonly AgentDocumentRecord[];
}

type AgentDocumentStorePaths = Pick<ShellPathService, 'resolveProjectPath'>;

const STORE_VERSION = 1;
const MAX_VERSIONS = 50;

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

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
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
  return slug || 'document';
}

function nowIso(): string {
  return new Date().toISOString();
}

function documentStatus(value: unknown): AgentDocumentStatus {
  if (value === 'reviewed' || value === 'archived') return value;
  return 'draft';
}

function assertDocumentContentSafe(fields: readonly string[]): void {
  try {
    assertNoSecretLikeText(fields);
  } catch {
    throw new Error('Documents cannot store secret-looking values. Store a secret reference or remove the sensitive text.');
  }
}

function parseVersion(value: unknown): AgentDocumentVersion | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id).trim();
  const title = normalizeTitle(readString(value.title));
  const body = readString(value.body).trim();
  const summary = readString(value.summary).trim();
  if (!id || !title || !body) return null;
  return {
    id,
    title,
    body,
    summary,
    createdAt: readString(value.createdAt, nowIso()),
  };
}

function parseDocument(value: unknown): AgentDocumentRecord | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id).trim();
  const title = normalizeTitle(readString(value.title));
  const body = readString(value.body).trim();
  if (!id || !title || !body) return null;
  const createdAt = readString(value.createdAt, nowIso());
  const versions = Array.isArray(value.versions)
    ? value.versions.map(parseVersion).filter((entry): entry is AgentDocumentVersion => entry !== null)
    : [];
  const lastArtifactId = readString(value.lastArtifactId).trim();
  return {
    id,
    title,
    body,
    tags: readStringArray(value.tags),
    status: documentStatus(value.status),
    createdAt,
    updatedAt: readString(value.updatedAt, createdAt),
    versions,
    lastArtifactId: lastArtifactId || undefined,
  };
}

function parseStore(raw: string): DocumentStoreFile {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return { version: STORE_VERSION, documents: [] };
  return {
    version: STORE_VERSION,
    documents: Array.isArray(parsed.documents)
      ? parsed.documents.map(parseDocument).filter((entry): entry is AgentDocumentRecord => entry !== null)
      : [],
  };
}

function formatStore(store: DocumentStoreFile): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

export function documentStorePath(shellPaths: AgentDocumentStorePaths): string {
  return shellPaths.resolveProjectPath(GOODVIBES_AGENT_SURFACE_ROOT, 'documents', 'documents.json');
}

export function renderAgentDocumentMarkdown(document: AgentDocumentRecord): string {
  const tags = document.tags.length > 0 ? `\nTags: ${document.tags.join(', ')}` : '';
  return [
    `# ${document.title}`,
    '',
    `Document ID: ${document.id}`,
    `Version: ${document.versions.at(-1)?.id ?? 'v1'}`,
    `Status: ${document.status}`,
    `Updated: ${document.updatedAt}${tags}`,
    '',
    document.body,
    '',
  ].join('\n');
}

export class AgentDocumentRegistry {
  public constructor(private readonly storePath: string) {}

  public static fromShellPaths(shellPaths: AgentDocumentStorePaths): AgentDocumentRegistry {
    return new AgentDocumentRegistry(documentStorePath(shellPaths));
  }

  public snapshot(): AgentDocumentSnapshot {
    const store = this.readStore();
    return {
      path: this.storePath,
      documents: [...store.documents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    };
  }

  public list(): readonly AgentDocumentRecord[] {
    return this.snapshot().documents;
  }

  public search(query: string): readonly AgentDocumentRecord[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return this.list();
    return this.list().filter((document) => [
      document.id,
      document.title,
      document.body,
      document.status,
      document.lastArtifactId ?? '',
      ...document.tags,
    ].some((field) => field.toLowerCase().includes(normalized)));
  }

  public get(idOrTitle: string): AgentDocumentRecord | null {
    const lookup = idOrTitle.trim().toLowerCase();
    if (!lookup) return null;
    return this.list().find((document) => (
      document.id.toLowerCase() === lookup
      || document.title.toLowerCase() === lookup
    )) ?? null;
  }

  public create(input: AgentDocumentCreateInput): AgentDocumentRecord {
    const store = this.readStore();
    const title = normalizeTitle(input.title);
    const body = input.body.trim();
    this.validateRequired(title, body);
    const tags = normalizeList(input.tags);
    const summary = input.summary?.trim() || 'Initial draft.';
    assertDocumentContentSafe([title, body, summary, ...tags]);
    const duplicate = store.documents.find((document) => document.title.toLowerCase() === title.toLowerCase());
    if (duplicate) throw new Error(`Document already exists ${duplicate.id}`);
    const timestamp = nowIso();
    const version: AgentDocumentVersion = {
      id: 'v1',
      title,
      body,
      summary,
      createdAt: timestamp,
    };
    const document: AgentDocumentRecord = {
      id: this.nextId(title, store.documents),
      title,
      body,
      tags,
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
      versions: [version],
    };
    this.writeStore({ ...store, documents: [...store.documents, document] });
    return document;
  }

  public update(idOrTitle: string, input: AgentDocumentUpdateInput): AgentDocumentRecord {
    const store = this.readStore();
    const existing = this.findInStore(store, idOrTitle);
    if (!existing) throw new Error(`Unknown document ${idOrTitle}`);
    const title = input.title === undefined ? existing.title : normalizeTitle(input.title);
    const body = input.body === undefined ? existing.body : input.body.trim();
    this.validateRequired(title, body);
    const tags = input.tags === undefined ? existing.tags : normalizeList(input.tags);
    const summary = input.summary?.trim() || 'Updated draft.';
    assertDocumentContentSafe([title, body, summary, ...tags]);
    const duplicate = store.documents.find((document) => document.id !== existing.id && document.title.toLowerCase() === title.toLowerCase());
    if (duplicate) throw new Error(`Document already exists ${duplicate.id}`);
    const timestamp = nowIso();
    const version: AgentDocumentVersion = {
      id: `v${existing.versions.length + 1}`,
      title,
      body,
      summary,
      createdAt: timestamp,
    };
    const versions = [...existing.versions, version].slice(-MAX_VERSIONS);
    const updated: AgentDocumentRecord = {
      ...existing,
      title,
      body,
      tags,
      status: input.status ?? existing.status,
      updatedAt: timestamp,
      versions,
      lastArtifactId: input.lastArtifactId === undefined ? existing.lastArtifactId : input.lastArtifactId || undefined,
    };
    this.writeStore({
      ...store,
      documents: store.documents.map((document) => document.id === existing.id ? updated : document),
    });
    return updated;
  }

  public updateArtifactId(idOrTitle: string, artifactId: string): AgentDocumentRecord {
    const store = this.readStore();
    const existing = this.findInStore(store, idOrTitle);
    if (!existing) throw new Error(`Unknown document ${idOrTitle}`);
    const updated: AgentDocumentRecord = {
      ...existing,
      lastArtifactId: artifactId,
      updatedAt: nowIso(),
    };
    this.writeStore({
      ...store,
      documents: store.documents.map((document) => document.id === existing.id ? updated : document),
    });
    return updated;
  }

  public markReviewed(idOrTitle: string): AgentDocumentRecord {
    return this.update(idOrTitle, { status: 'reviewed', summary: 'Marked reviewed.' });
  }

  public delete(idOrTitle: string): boolean {
    const store = this.readStore();
    const existing = this.findInStore(store, idOrTitle);
    if (!existing) return false;
    this.writeStore({
      ...store,
      documents: store.documents.filter((document) => document.id !== existing.id),
    });
    return true;
  }

  private readStore(): DocumentStoreFile {
    if (!existsSync(this.storePath)) return { version: STORE_VERSION, documents: [] };
    return parseStore(readFileSync(this.storePath, 'utf-8'));
  }

  private writeStore(store: DocumentStoreFile): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    const tempPath = `${this.storePath}.tmp`;
    writeFileSync(tempPath, formatStore(store), 'utf-8');
    renameSync(tempPath, this.storePath);
  }

  private validateRequired(title: string, body: string): void {
    if (!title) throw new Error('Document title is required.');
    if (!body) throw new Error('Document body is required.');
  }

  private nextId(title: string, documents: readonly AgentDocumentRecord[]): string {
    const base = slugify(title);
    const existing = new Set(documents.map((document) => document.id));
    if (!existing.has(base)) return base;
    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!existing.has(candidate)) return candidate;
    }
    throw new Error('Unable to allocate a unique document id.');
  }

  private findInStore(store: DocumentStoreFile, idOrTitle: string): AgentDocumentRecord | null {
    const lookup = idOrTitle.trim().toLowerCase();
    if (!lookup) return null;
    return store.documents.find((document) => (
      document.id.toLowerCase() === lookup
      || document.title.toLowerCase() === lookup
    )) ?? null;
  }
}
