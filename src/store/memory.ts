import { join } from 'node:path';
import { agentHomeDir } from '../config.js';
import { createId } from '../utils/ids.js';
import { JsonStore } from './json-store.js';

export type MemoryKind = 'fact' | 'preference' | 'procedure' | 'context' | 'gap';

export interface MemoryRecord {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly text: string;
  readonly tags: readonly string[];
  readonly confidence: number;
  readonly source: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sensitive: boolean;
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
    readonly text: string;
    readonly kind?: MemoryKind | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly confidence?: number | undefined;
    readonly source?: string | undefined;
    readonly sensitive?: boolean | undefined;
  }): MemoryRecord {
    const now = Date.now();
    const text = input.text.trim();
    if (!text) throw new Error('Memory text cannot be empty.');
    const record: MemoryRecord = {
      id: createId('mem'),
      kind: input.kind ?? inferKind(text),
      text,
      tags: input.tags ?? [],
      confidence: input.confidence ?? 0.72,
      source: input.source ?? 'assistant',
      createdAt: now,
      updatedAt: now,
      sensitive: input.sensitive ?? looksSensitive(text),
    };
    this.store.update((state) => ({ records: [record, ...state.records] }));
    return record;
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
    if (!normalized || looksSensitive(normalized)) return null;
    const rememberMatch = normalized.match(/^remember(?: that)?\s+(.+)$/i);
    if (rememberMatch?.[1]) return this.remember({ text: rememberMatch[1], source: 'user-directive' });
    if (/\b(i prefer|my default|we use|our default|my .* is|the .* is)\b/i.test(normalized)) {
      return this.remember({ text: normalized, source: 'user-stated' });
    }
    return null;
  }
}

function inferKind(text: string): MemoryKind {
  if (/\b(prefer|default|like|avoid)\b/i.test(text)) return 'preference';
  if (/\b(when|procedure|workflow|steps|checklist)\b/i.test(text)) return 'procedure';
  if (/\b(unknown|gap|need to find|needs research)\b/i.test(text)) return 'gap';
  return 'fact';
}

function looksSensitive(text: string): boolean {
  return /\b(api[_ -]?key|token|password|secret|private key|ssh key|credential)\b/i.test(text);
}

function scoreRecord(record: MemoryRecord, terms: readonly string[]): number {
  const haystack = `${record.text} ${record.kind} ${record.tags.join(' ')}`.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}
