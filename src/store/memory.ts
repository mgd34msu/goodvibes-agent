import { join } from 'node:path';
import { agentHomeDir } from '../config.js';
import { createId } from '../utils/ids.js';
import { JsonStore } from './json-store.js';
import { RegistryNotFoundError } from './errors.js';

export type MemoryScope = 'session' | 'project' | 'team';
export type MemoryClass = 'decision' | 'constraint' | 'incident' | 'pattern' | 'fact' | 'risk' | 'runbook' | 'architecture' | 'ownership';
export type MemoryReviewState = 'fresh' | 'reviewed' | 'stale' | 'contradicted';
export type MemorySensitivity = 'public' | 'project' | 'private' | 'secret';
export type MemoryProvenanceKind = 'session' | 'turn' | 'task' | 'event' | 'file' | 'user' | 'assistant';

export interface MemoryProvenanceLink {
  readonly kind: MemoryProvenanceKind;
  readonly id: string;
  readonly label?: string | undefined;
}

export interface MemoryRecord {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly cls: MemoryClass;
  readonly summary: string;
  readonly detail: string;
  readonly tags: readonly string[];
  readonly confidence: number;
  readonly source: string;
  readonly provenance: readonly MemoryProvenanceLink[];
  readonly reviewState: MemoryReviewState;
  readonly reviewedAt?: number | undefined;
  readonly reviewedBy?: string | undefined;
  readonly staleReason?: string | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sensitivity: MemorySensitivity;
}

export interface MemoryState {
  readonly records: readonly MemoryRecord[];
}

export class MemoryStore {
  private readonly store = new JsonStore<MemoryState>(join(agentHomeDir(), 'memory.json'), { records: [] });

  list(): readonly MemoryRecord[] {
    return this.store.read().records;
  }

  remember(input: {
    readonly summary: string;
    readonly detail?: string | undefined;
    readonly scope?: MemoryScope | undefined;
    readonly cls?: MemoryClass | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly confidence?: number | undefined;
    readonly source?: string | undefined;
    readonly provenance?: readonly MemoryProvenanceLink[] | undefined;
    readonly reviewState?: MemoryReviewState | undefined;
    readonly sensitivity?: MemorySensitivity | undefined;
  }): MemoryRecord {
    const now = Date.now();
    const summary = input.summary.trim();
    if (!summary) throw new Error('Memory summary cannot be empty.');
    const sensitivity = input.sensitivity ?? inferSensitivity(summary, input.detail ?? '');
    const record: MemoryRecord = {
      id: createId('mem'),
      scope: input.scope ?? 'project',
      cls: input.cls ?? inferClass(summary),
      summary,
      detail: input.detail?.trim() ?? '',
      tags: input.tags ?? [],
      confidence: normalizeConfidence(input.confidence ?? 72),
      source: input.source ?? 'assistant',
      provenance: input.provenance ?? [{ kind: 'assistant', id: 'goodvibes-agent' }],
      reviewState: input.reviewState ?? 'fresh',
      createdAt: now,
      updatedAt: now,
      sensitivity,
    };
    if (record.sensitivity === 'secret') {
      throw new Error('Secret values must not be stored in assistant memory. Store a secret reference instead.');
    }
    this.store.update((state) => ({ records: [record, ...state.records] }));
    return record;
  }

  update(id: string, patch: {
    readonly summary?: string | undefined;
    readonly detail?: string | undefined;
    readonly scope?: MemoryScope | undefined;
    readonly cls?: MemoryClass | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly confidence?: number | undefined;
    readonly source?: string | undefined;
    readonly provenance?: readonly MemoryProvenanceLink[] | undefined;
    readonly reviewState?: MemoryReviewState | undefined;
    readonly reviewedBy?: string | undefined;
    readonly staleReason?: string | undefined;
    readonly sensitivity?: MemorySensitivity | undefined;
  }): MemoryRecord {
    const now = Date.now();
    let updated: MemoryRecord | null = null;
    this.store.update((state) => ({
      records: state.records.map((record) => {
        if (record.id !== id) return record;
        const summary = patch.summary?.trim() ?? record.summary;
        const detail = patch.detail?.trim() ?? record.detail;
        const sensitivity = patch.sensitivity ?? inferSensitivity(summary, detail);
        if (sensitivity === 'secret') {
          throw new Error('Secret values must not be stored in assistant memory. Store a secret reference instead.');
        }
        updated = {
          ...record,
          summary,
          detail,
          scope: patch.scope ?? record.scope,
          cls: patch.cls ?? record.cls,
          tags: patch.tags ?? record.tags,
          confidence: normalizeConfidence(patch.confidence ?? record.confidence),
          source: patch.source ?? record.source,
          provenance: patch.provenance ?? record.provenance,
          reviewState: patch.reviewState ?? record.reviewState,
          reviewedAt: patch.reviewState === 'reviewed' ? now : record.reviewedAt,
          reviewedBy: patch.reviewedBy ?? record.reviewedBy,
          staleReason: patch.staleReason ?? record.staleReason,
          sensitivity,
          updatedAt: now,
        };
        return updated;
      }),
    }));
    if (!updated) throw new RegistryNotFoundError('memory', id);
    return updated;
  }

  delete(id: string): MemoryRecord {
    let deleted: MemoryRecord | null = null;
    this.store.update((state) => ({
      records: state.records.filter((record) => {
        if (record.id !== id) return true;
        deleted = record;
        return false;
      }),
    }));
    if (!deleted) throw new RegistryNotFoundError('memory', id);
    return deleted;
  }

  search(query: string, limit = 12): readonly MemoryRecord[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return this.list().slice(0, limit);
    return this.list()
      .map((record) => ({ record, score: scoreRecord(record, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((entry) => entry.record);
  }

  autoCaptureFromUserText(text: string): MemoryRecord | null {
    const normalized = text.trim();
    if (!normalized || inferSensitivity(normalized, '') === 'secret') return null;
    const rememberMatch = normalized.match(/^remember(?: that)?\s+(.+)$/i);
    if (rememberMatch?.[1]) return this.remember({ summary: rememberMatch[1], source: 'user-directive', provenance: [{ kind: 'user', id: 'direct-memory-command' }] });
    if (/\b(i prefer|my default|we use|our default|my .* is|the .* is)\b/i.test(normalized)) {
      return this.remember({ summary: normalized, source: 'user-stated', provenance: [{ kind: 'user', id: 'conversation' }] });
    }
    return null;
  }
}

function inferClass(text: string): MemoryClass {
  if (/\b(prefer|default|like|avoid|must|require|always|never)\b/i.test(text)) return 'constraint';
  if (/\b(when|procedure|workflow|steps|checklist|runbook)\b/i.test(text)) return 'runbook';
  if (/\b(owns|owner|ownership|maintainer)\b/i.test(text)) return 'ownership';
  if (/\b(decided|decision|choose|chosen)\b/i.test(text)) return 'decision';
  if (/\b(architecture|design|boundary)\b/i.test(text)) return 'architecture';
  if (/\b(risk|danger|hazard)\b/i.test(text)) return 'risk';
  if (/\b(incident|outage|failure)\b/i.test(text)) return 'incident';
  if (/\b(pattern|usually|repeated)\b/i.test(text)) return 'pattern';
  return 'fact';
}

function inferSensitivity(summary: string, detail: string): MemorySensitivity {
  const text = `${summary} ${detail}`;
  if (/\b(api[_ -]?key|token|password|secret|private key|ssh key|credential)\b/i.test(text)) return 'secret';
  if (/\b(private|personal|home address|phone number)\b/i.test(text)) return 'private';
  return 'project';
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Memory confidence must be between 0 and 100: ${value}`);
  }
  return value;
}

function scoreRecord(record: MemoryRecord, terms: readonly string[]): number {
  const haystack = `${record.summary} ${record.detail} ${record.cls} ${record.scope} ${record.reviewState} ${record.tags.join(' ')}`.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}
