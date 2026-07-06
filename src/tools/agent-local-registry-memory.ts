/**
 * Agent-local memory domain handler (memory honesty).
 *
 * Split out of agent-local-registry-tool.ts to stay under the 800-line
 * architecture cap. Owns the `memory` domain of the agent_local_registry
 * tool: list/search/get/create/update/review/stale/delete.
 *
 * The `search` action defaults to semantic recall (registry.searchSemantic)
 * instead of the old literal LIKE-scan default — natural-language recall must
 * not depend on the query text appearing as a literal substring in the
 * stored summary/detail. Index health is checked before every semantic
 * search so an unavailable index degrades honestly (stated reason, literal
 * fallback) instead of silently returning zero matches that read as "nothing
 * was ever stored."
 */
import {
  HASHED_MEMORY_EMBEDDING_PROVIDER,
  MemoryRegistry,
  type MemoryClass,
  type MemoryRecord,
  type MemoryScope,
  type MemorySemanticSearchResult,
  type MemoryVectorStats,
} from '@pellux/goodvibes-sdk/platform/state';
import { assertNoSecretLikeMemoryText } from '../agent/memory-safety.ts';
import { formatAgentRecordReference, formatAgentRecordReviewState } from '../agent/record-labels.ts';
import {
  AGENT_TOOL_PROVENANCE,
  type AgentLocalRegistryToolArgs,
  readOptionalConfidence,
  readString,
  readStringList,
  requireConfirmedDelete,
  requireId,
  requireSummary,
} from './agent-local-registry-args.ts';
// `import type` is erased at compile time, so this does not create a runtime
// circular dependency even though agent-local-registry-tool.ts imports
// handleMemory (below) from this module.
import type { AgentLocalRegistryAction } from './agent-local-registry-tool.ts';

export const MEMORY_CLASSES: readonly MemoryClass[] = ['decision', 'constraint', 'incident', 'pattern', 'fact', 'risk', 'runbook', 'architecture', 'ownership'];
export const MEMORY_SCOPES: readonly MemoryScope[] = ['session', 'project', 'team'];

function isMemoryClass(value: unknown): value is MemoryClass {
  return typeof value === 'string' && MEMORY_CLASSES.includes(value as MemoryClass);
}

function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === 'string' && MEMORY_SCOPES.includes(value as MemoryScope);
}

function requireMemoryClass(args: AgentLocalRegistryToolArgs): MemoryClass {
  const cls = args.cls || 'fact';
  if (!isMemoryClass(cls)) throw new Error(`Invalid memory class. Valid values ${MEMORY_CLASSES.join(', ')}.`);
  return cls;
}

function readMemoryScope(args: AgentLocalRegistryToolArgs): MemoryScope {
  const scope = args.scope || 'project';
  if (!isMemoryScope(scope)) throw new Error(`Invalid memory scope. Valid values ${MEMORY_SCOPES.join(', ')}.`);
  return scope;
}

export function formatMemory(record: MemoryRecord): string {
  const tags = record.tags.length > 0 ? ` tags ${record.tags.join(', ')}` : '';
  return `${record.id}  ${record.scope}/${record.cls}  ${formatAgentRecordReviewState(record.reviewState)}  ${record.confidence}%${tags}  ${record.summary}`;
}

function formatMemoryMatch(entry: MemorySemanticSearchResult): string {
  const matchLabel = entry.similarity > 0 ? `  match ${Math.round(entry.similarity * 100)}% (score ${Math.round(entry.score)})` : '';
  return `${formatMemory(entry.record)}${matchLabel}`;
}

/**
 * A HARD unavailable reason: the semantic index cannot be consulted at all, so the
 * search action must fall back to a literal LIKE-scan and say so — never a silent
 * empty result that reads as "no memory matches" when the index was never asked.
 */
function describeMemoryIndexUnavailable(stats: MemoryVectorStats): string | null {
  if (!stats.enabled) return 'the semantic memory index is disabled for this store';
  if (!stats.available) return `the semantic memory index is unavailable${stats.error ? `: ${stats.error}` : ''}`;
  if (stats.indexedRecords === 0) return 'the semantic memory index has no indexed records yet';
  return null;
}

/**
 * A SOFT caveat: the index is up and consulted, but it is running on the built-in
 * hashed-only fallback embedding provider (bag-of-words/token hashing) rather than a
 * real embedding model. That still ranks real matches meaningfully better than a
 * literal substring scan, but it is not a modeled semantic understanding — say so
 * rather than presenting it as equivalent to a configured semantic provider.
 */
function describeMemoryIndexCaveat(stats: MemoryVectorStats): string | null {
  if (stats.embeddingProviderId === HASHED_MEMORY_EMBEDDING_PROVIDER.id) {
    return 'running on the hashed-only fallback embedding provider (no dedicated semantic model configured) — ranking is approximate, not modeled semantic understanding';
  }
  return null;
}

function renderMemorySearch(mode: string, query: string, lines: readonly string[]): string {
  if (lines.length === 0) {
    return `Agent-local memory search (${mode})\nNo Agent-local memory records matched "${query}".`;
  }
  return [`Agent-local memory search (${mode})`, `query ${query || '(all)'}`, ...lines].join('\n');
}

export async function handleMemory(registry: MemoryRegistry, action: AgentLocalRegistryAction, args: AgentLocalRegistryToolArgs): Promise<string> {
  if (action === 'list') {
    const records = registry.getAll();
    return records.length === 0
      ? 'Agent-local memory\nNo Agent-local memory records.'
      : ['Agent-local memory', ...records.map(formatMemory)].join('\n');
  }
  if (action === 'search') {
    const query = readString(args.query);
    const wantsLiteral = args.semantic === false;
    if (wantsLiteral) {
      const records = registry.search({ query, limit: 10 });
      return renderMemorySearch('literal — explicitly requested', query, records.map(formatMemory));
    }
    // SEMANTIC BY DEFAULT: natural-language recall must not depend on the query text
    // appearing as a literal substring in the stored summary/detail. Check index
    // health FIRST so an unavailable index degrades honestly instead of silently
    // returning zero matches that read as "nothing was ever stored."
    const stats = registry.vectorStats();
    const unavailable = describeMemoryIndexUnavailable(stats);
    if (unavailable) {
      const records = registry.search({ query, limit: 10 });
      return renderMemorySearch(`literal fallback — ${unavailable}`, query, records.map(formatMemory));
    }
    const results = registry.searchSemantic({ query, limit: 10 });
    const consultedSemanticIndex = query.length > 0 && results.some((entry) => entry.similarity > 0);
    const caveat = describeMemoryIndexCaveat(stats);
    const mode = !consultedSemanticIndex && query.length > 0
      ? 'semantic — no vector match for this query, ranked by stored confidence instead'
      : caveat
        ? `semantic — ${caveat}`
        : 'semantic';
    return renderMemorySearch(mode, query, results.map(formatMemoryMatch));
  }
  if (action === 'get') {
    const record = registry.get(requireId(args));
    if (!record) return `Unknown Agent-local memory ${readString(args.id)}`;
    return [
      formatMemory(record),
      `created ${new Date(record.createdAt).toISOString()}`,
      `updated ${new Date(record.updatedAt).toISOString()}`,
      `origin ${record.provenance.map((entry) => formatAgentRecordReference({ kind: String(entry.kind), ref: String(entry.ref) })).join(', ') || '(none)'}`,
      `provenance: ${record.provenance.map((entry) => `${String(entry.kind)}:${String(entry.ref)}`).join(',') || '(none)'}`,
      '',
      record.detail || '(no detail)',
    ].join('\n');
  }
  if (action === 'create') {
    const summary = requireSummary(args);
    const detail = readString(args.detail || args.body);
    const tags = readStringList(args.tags);
    const confidence = readOptionalConfidence(args.confidence);
    assertNoSecretLikeMemoryText([summary, detail, ...tags]);
    const record = await registry.add({
      scope: readMemoryScope(args),
      cls: requireMemoryClass(args),
      summary,
      detail,
      tags: [...tags],
      ...(confidence === undefined ? {} : { review: { state: 'fresh' as const, confidence } }),
      provenance: [{ kind: 'event', ref: readString(args.provenance) || AGENT_TOOL_PROVENANCE }],
    });
    return [
      'Created Agent-local memory',
      `  id ${record.id}`,
      `  summary ${record.summary}`,
    ].join('\n');
  }
  if (action === 'update') {
    const summary = readString(args.summary || args.description);
    const detail = readString(args.detail || args.body);
    const tags = args.tags === undefined ? undefined : [...readStringList(args.tags)];
    assertNoSecretLikeMemoryText([summary, detail, ...(tags ?? [])]);
    const record = registry.update(requireId(args), {
      summary: summary || undefined,
      detail: detail || undefined,
      tags,
      scope: args.scope === undefined ? undefined : readMemoryScope(args),
    });
    if (!record) return `Unknown Agent-local memory ${readString(args.id)}`;
    return [
      'Updated Agent-local memory',
      `  id ${record.id}`,
      `  summary ${record.summary}`,
    ].join('\n');
  }
  if (action === 'review') {
    const record = registry.review(requireId(args), {
      state: 'reviewed',
      confidence: readOptionalConfidence(args.confidence),
      reviewedBy: 'agent',
    });
    if (!record) return `Unknown Agent-local memory ${readString(args.id)}`;
    return [
      'Reviewed Agent-local memory',
      `  id ${record.id}`,
    ].join('\n');
  }
  if (action === 'stale') {
    const record = registry.review(requireId(args), {
      state: 'stale',
      staleReason: readString(args.reason) || 'Marked stale by Agent.',
    });
    if (!record) return `Unknown Agent-local memory ${readString(args.id)}`;
    return [
      'Marked Agent-local memory stale',
      `  id ${record.id}`,
    ].join('\n');
  }
  if (action === 'delete') {
    const id = requireId(args);
    requireConfirmedDelete(args, 'Agent-local memory');
    if (!registry.delete(id)) return `Unknown Agent-local memory ${id}`;
    return [
      'Deleted Agent-local memory',
      `  id ${id}`,
    ].join('\n');
  }
  throw new Error(`Action ${action} is not valid for memory.`);
}
