import type { MemoryRecord, MemoryRegistry } from '@pellux/goodvibes-sdk/platform/state';

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

export function buildReviewedMemoryPrompt(memoryRegistry: MemoryRegistry, limit = DEFAULT_LIMIT): string | null {
  const records = memoryRegistry.getAll()
    .filter(isPromptActiveMemory)
    .sort(sortMemoryForPrompt)
    .slice(0, Math.max(0, limit));

  if (records.length === 0) return null;
  return [
    '## Reviewed GoodVibes Agent Memory',
    `Use these local, reviewed, non-secret memory records with confidence >= ${MIN_PROMPT_MEMORY_CONFIDENCE}% to avoid asking repeat questions and to preserve durable user preferences, constraints, and operating facts.`,
    ...records.map(formatMemoryLine),
  ].join('\n');
}
