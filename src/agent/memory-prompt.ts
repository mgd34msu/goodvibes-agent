import type { MemoryRecord, MemoryRegistry, MemoryVectorStats } from '@pellux/goodvibes-sdk/platform/state';

const DEFAULT_LIMIT = 10;

/**
 * Recall-prompt confidence floor.
 *
 * GROUNDING (Wave-4 W4-A1): this used to be 70. The SDK's MemoryStore stores every
 * new record at confidence 60 by default (dist/platform/state/memory-store.js:
 * `confidence: clampConfidence(opts.review?.confidence ?? 60)`) unless the caller
 * passes an explicit confidence. A floor of 70 meant a freshly-learned fact could
 * NEVER clear prompt recall on its own — the gate was starving every honestly-stored
 * memory, not filtering out low-trust ones. That is not a "1% confidence" bug, it is
 * a floor set eight points above the store's own declared baseline trust level.
 *
 * The fix is to trust a memory exactly as much as the store already vouches for it at
 * creation time — no more. 60 is that baseline: it is not a number chosen to make
 * things pass (that would be the "blanket-boost to 70" move this brief explicitly
 * rejects), it is the number the SDK itself already uses to mean "this is a real,
 * usable fact." Anything explicitly stored BELOW that baseline (the author marked it
 * as less certain than a normal fact) still does not qualify.
 */
export const MIN_PROMPT_MEMORY_CONFIDENCE = 60;

export interface MemoryPromptEligibility {
  readonly eligible: boolean;
  /** Why this record did or did not clear the recall floor — confidence, review state, and provenance, never silent. */
  readonly reason: string;
}

function provenanceSummary(record: MemoryRecord): string {
  if (record.provenance.length === 0) return 'no provenance recorded';
  return `provenance ${record.provenance.slice(0, 2).map((entry) => `${entry.kind}:${entry.ref}`).join(', ')}`;
}

/**
 * Score/provenance-based recall-eligibility decision for one record, with an honest,
 * human-readable reason attached (never a silent yes/no).
 *
 * Flagged records (stale/contradicted) are excluded outright regardless of confidence:
 * the agent already knows these are wrong or superseded, so no confidence number
 * should be able to buy them back into the prompt. Everything else is judged on its
 * own stored confidence against MIN_PROMPT_MEMORY_CONFIDENCE — the store's own
 * baseline — so a genuinely-stored fact (default confidence 60, reviewState 'fresh')
 * now honestly clears recall, while an explicitly low-confidence or flagged record
 * still does not. Nothing is blanket-boosted to clear the floor.
 */
export function describeMemoryPromptEligibility(record: MemoryRecord): MemoryPromptEligibility {
  const provenance = provenanceSummary(record);
  if (record.reviewState === 'stale' || record.reviewState === 'contradicted') {
    return {
      eligible: false,
      reason: `reviewState is ${record.reviewState} — flagged memory is never injected regardless of confidence (${provenance})`,
    };
  }
  if (record.confidence < MIN_PROMPT_MEMORY_CONFIDENCE) {
    return {
      eligible: false,
      reason: `confidence ${record.confidence}% is below the ${MIN_PROMPT_MEMORY_CONFIDENCE}% recall floor (${provenance})`,
    };
  }
  return {
    eligible: true,
    reason: `confidence ${record.confidence}% clears the ${MIN_PROMPT_MEMORY_CONFIDENCE}% recall floor, reviewState ${record.reviewState} (${provenance})`,
  };
}

export function isPromptActiveMemory(record: MemoryRecord): boolean {
  return describeMemoryPromptEligibility(record).eligible;
}

function sortMemoryForPrompt(left: MemoryRecord, right: MemoryRecord): number {
  if (right.confidence !== left.confidence) return right.confidence - left.confidence;
  return right.updatedAt - left.updatedAt;
}

function formatMemoryLine(record: MemoryRecord): string {
  const tags = record.tags.length > 0 ? ` tags=${record.tags.join(',')}` : '';
  const provenance = record.provenance.length > 0
    ? ` source=${record.provenance.slice(0, 2).map((entry) => `${entry.kind}:${entry.ref}`).join(',')}`
    : '';
  return `- [${record.scope}/${record.cls} ${record.confidence}%${tags}${provenance}] ${record.summary}`;
}

/**
 * Per-turn semantic ranking of an already-eligible memory set (Wave-4 W4-A1B).
 *
 * W4-A1 shipped eligibility (confidence + reviewState + provenance) as the hard trust
 * gate but had no per-turn query to rank WITHIN that eligible set — records were only
 * ever ordered by stored confidence/recency, regardless of whether they had anything to
 * do with what the user actually just asked. `rankMemoryForTurn` never touches the gate
 * itself: it only reorders the records that already cleared describeMemoryPromptEligibility,
 * so a budget-limited cut (the top-N prompt slice) drops the least relevant record to
 * THIS turn instead of an arbitrary one.
 *
 * Degrades honestly and says why whenever it can't score: no turn text supplied, the
 * semantic index disabled/unavailable/empty, or a real query that the index has zero
 * vector matches for. In every degraded case the eligible set still gets the prior
 * confidence/recency order — never silently dropped, never silently reordered on data
 * that isn't there.
 */
export interface MemoryTurnRankingResult {
  /** The eligible records, ranked — by relevance when `scored` is true, else by the prior confidence/recency order. */
  readonly records: readonly MemoryRecord[];
  /** Relevance percent (0-100) per record id. Only populated when `scored` is true. */
  readonly relevanceById: ReadonlyMap<string, number>;
  /** True when semantic relevance to the current turn actually drove the ranking above. */
  readonly scored: boolean;
  /** Honest reason for the degrade when `scored` is false; null when scoring succeeded or there was nothing to rank. */
  readonly degradedReason: string | null;
}

function describeTurnRelevanceIndexUnavailable(stats: MemoryVectorStats): string | null {
  if (!stats.enabled) return 'the semantic memory index is disabled for this store';
  if (!stats.available) return `the semantic memory index is unavailable${stats.error ? `: ${stats.error}` : ''}`;
  if (stats.indexedRecords === 0) return 'the semantic memory index has no indexed records yet';
  return null;
}

/**
 * Qualitative band for a 0-100 relevance-to-turn percent (F7a).
 *
 * A raw cosine-similarity percent like "28%" reads as misleadingly low out of
 * context — it can still be the single best match among the eligible set, or
 * a genuinely useful match on an absolute basis, but a bare number invites
 * "only 28%? that's barely relevant." Choice made here: add a qualitative
 * band NEXT TO the raw percent rather than normalizing against the turn's
 * top score. Normalizing would make every record but the single best one
 * read as comparatively weak even when several are strong matches in
 * absolute terms, and would make a genuinely weak top match look like a
 * confident 100%. A fixed absolute band keeps the number honest while
 * making it readable at a glance.
 */
export function relevanceBand(percent: number): 'high match' | 'moderate match' | 'low match' {
  if (percent >= 60) return 'high match';
  if (percent >= 35) return 'moderate match';
  return 'low match';
}

export function rankMemoryForTurn(
  memoryRegistry: MemoryRegistry,
  eligible: readonly MemoryRecord[],
  turnText: string | null | undefined,
): MemoryTurnRankingResult {
  const fallbackOrder = (): readonly MemoryRecord[] => [...eligible].sort(sortMemoryForPrompt);
  if (eligible.length === 0) {
    return { records: [], relevanceById: new Map(), scored: false, degradedReason: null };
  }
  const trimmedTurnText = turnText?.trim() ?? '';
  if (!trimmedTurnText) {
    return {
      records: fallbackOrder(),
      relevanceById: new Map(),
      scored: false,
      degradedReason: 'no current-turn text available for this composition — using stored confidence/recency order',
    };
  }
  const stats = memoryRegistry.vectorStats();
  const indexUnavailable = describeTurnRelevanceIndexUnavailable(stats);
  if (indexUnavailable) {
    return {
      records: fallbackOrder(),
      relevanceById: new Map(),
      scored: false,
      degradedReason: `semantic index unavailable (${indexUnavailable}) — using stored confidence/recency order`,
    };
  }
  // Request enough candidates back that every eligible record has a real chance to
  // appear with its similarity score (searchSemantic slices its return to this limit
  // after scoring, not before) — the SDK's vector store caps the underlying KNN search
  // at 500 candidates regardless, so there is no point asking for more than that.
  const requestLimit = Math.min(500, Math.max(eligible.length, 50));
  const results = memoryRegistry.searchSemantic({ query: trimmedTurnText, limit: requestLimit });
  const consultedSemanticIndex = results.some((entry) => entry.similarity > 0);
  if (!consultedSemanticIndex) {
    return {
      records: fallbackOrder(),
      relevanceById: new Map(),
      scored: false,
      degradedReason: "no semantic match for this turn's text — using stored confidence/recency order",
    };
  }
  const eligibleIds = new Set(eligible.map((record) => record.id));
  const relevanceById = new Map<string, number>();
  for (const entry of results) {
    if (!eligibleIds.has(entry.record.id)) continue;
    relevanceById.set(entry.record.id, Math.round(Math.max(0, Math.min(1, entry.similarity)) * 100));
  }
  const ranked = [...eligible].sort((left, right) => {
    const rightScore = relevanceById.get(right.id) ?? 0;
    const leftScore = relevanceById.get(left.id) ?? 0;
    if (rightScore !== leftScore) return rightScore - leftScore;
    return sortMemoryForPrompt(left, right);
  });
  return { records: ranked, relevanceById, scored: true, degradedReason: null };
}

export interface BuildReviewedMemoryPromptOptions {
  readonly limit?: number;
  /** The current turn's raw text (the seam this comes from: TURN_SUBMITTED's `prompt`).
   *  Used only to RANK the already-eligible set — never to admit an otherwise-ineligible record. */
  readonly turnText?: string | null;
}

export function buildReviewedMemoryPrompt(memoryRegistry: MemoryRegistry, options: BuildReviewedMemoryPromptOptions = {}): string | null {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const eligible = memoryRegistry.getAll().filter(isPromptActiveMemory);
  const ranking = rankMemoryForTurn(memoryRegistry, eligible, options.turnText);
  const records = ranking.records.slice(0, Math.max(0, limit));

  if (records.length === 0) return null;
  return [
    '## Reviewed GoodVibes Agent Memory',
    `Use these local, reviewed, non-secret memory records with confidence >= ${MIN_PROMPT_MEMORY_CONFIDENCE}% to avoid asking repeat questions and to preserve durable user preferences, constraints, and operating facts.`,
    ...records.map(formatMemoryLine),
  ].join('\n');
}
