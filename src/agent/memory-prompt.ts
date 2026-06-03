import type { MemoryRecord, MemoryRegistry } from '@pellux/goodvibes-sdk/platform/state';
const DEFAULT_LIMIT = 10;
export const MIN_PROMPT_MEMORY_CONFIDENCE = 50;

export function isPromptActiveMemory(record: MemoryRecord): boolean {
  return record.reviewState === 'reviewed' && record.confidence >= MIN_PROMPT_MEMORY_CONFIDENCE;
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
    'Use these local, reviewed, non-secret memory records to avoid asking repeat questions and to preserve durable user preferences, constraints, and operating facts.',
    ...records.map(formatMemoryLine),
  ].join('\n');
}
