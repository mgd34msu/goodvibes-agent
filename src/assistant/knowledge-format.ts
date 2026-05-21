import { firstString, isRecord } from '../types.js';

type ReadonlyUnknownRecord = Readonly<Record<string, unknown>>;

export function formatKnowledgeAnswer(data: unknown): string {
  const root = recordOrEmpty(data);
  const answer = recordValue(root, 'answer') ?? root;
  const text = firstString(answer, ['text', 'summary', 'response', 'answer']);
  const lines: string[] = [text || 'No answer text returned by knowledge.ask.'];

  const confidence = numberValue(answer, 'confidence') ?? numberValue(root, 'confidence');
  if (confidence !== undefined) lines.push('', `Confidence: ${formatConfidence(confidence)}`);

  const sources = recordsValue(answer, 'sources').length > 0
    ? recordsValue(answer, 'sources')
    : recordsValue(root, 'sources');
  lines.push(...formatSources(sources));

  const facts = firstNonEmptyRecords([
    recordsValue(answer, 'facts'),
    recordsValue(root, 'facts'),
  ]);
  lines.push(...formatKnowledgeNodes('Facts', facts));

  const gaps = firstNonEmptyRecords([
    recordsValue(answer, 'gaps'),
    recordsValue(root, 'gaps'),
  ]);
  lines.push(...formatKnowledgeNodes('Gaps', gaps));

  const refinementTaskIds = firstNonEmptyStrings([
    stringsValue(answer, 'refinementTaskIds'),
    stringsValue(root, 'refinementTaskIds'),
    recordsValue(answer, 'refinementTasks').map((record) => firstString(record, ['id', 'taskId'])).filter(Boolean),
    recordsValue(root, 'refinementTasks').map((record) => firstString(record, ['id', 'taskId'])).filter(Boolean),
  ]);
  if (refinementTaskIds.length > 0) {
    lines.push('', `Refinement tasks: ${refinementTaskIds.slice(0, 8).join(', ')}${refinementTaskIds.length > 8 ? ` (+${refinementTaskIds.length - 8} more)` : ''}`);
  }

  return trimBlankLines(lines).join('\n');
}

export function formatKnowledgeSearch(data: unknown, query?: string | undefined): string {
  const root = recordOrEmpty(data);
  const results = recordsValue(root, 'results');
  if (results.length === 0) {
    return query?.trim()
      ? `No knowledge results for "${query.trim()}".`
      : 'No knowledge results.';
  }

  const groups = new Map<string, string[]>();
  for (const result of results.slice(0, 12)) {
    const group = groupTitle(firstString(result, ['kind']) || 'result');
    const existing = groups.get(group) ?? [];
    existing.push(formatSearchResult(result, existing.length + 1));
    groups.set(group, existing);
  }

  const lines = [`Found ${results.length} knowledge result${results.length === 1 ? '' : 's'}.`];
  for (const [group, entries] of groups) {
    lines.push('', group, ...entries);
  }
  if (results.length > 12) lines.push('', `Showing 12 of ${results.length} results.`);
  return lines.join('\n');
}

function formatSources(sources: readonly ReadonlyUnknownRecord[]): readonly string[] {
  if (sources.length === 0) return [];
  const lines = ['', 'Sources'];
  for (const [index, source] of sources.slice(0, 5).entries()) {
    const id = firstString(source, ['id', 'sourceId']);
    const title = firstString(source, ['title', 'name']) || id || 'Untitled source';
    const url = firstString(source, ['sourceUri', 'canonicalUri', 'url', 'uri']);
    const sourceType = firstString(source, ['sourceType', 'connectorId', 'kind']);
    const summary = firstString(source, ['summary', 'description', 'excerpt']);
    lines.push(`${index + 1}. ${title}${sourceType ? ` [${sourceType}]` : ''}${id ? ` (${id})` : ''}`);
    if (url) lines.push(`   ${url}`);
    if (summary) lines.push(`   ${truncate(summary, 180)}`);
  }
  if (sources.length > 5) lines.push(`   +${sources.length - 5} more sources`);
  return lines;
}

function formatKnowledgeNodes(title: string, records: readonly ReadonlyUnknownRecord[]): readonly string[] {
  if (records.length === 0) return [];
  const lines = ['', title];
  for (const record of records.slice(0, 5)) {
    const id = firstString(record, ['id']);
    const kind = firstString(record, ['kind']);
    const label = firstString(record, ['title', 'summary', 'slug']) || id || 'Untitled item';
    const summary = firstString(record, ['summary']);
    lines.push(`- ${label}${kind ? ` [${kind}]` : ''}${id ? ` (${id})` : ''}`);
    if (summary && summary !== label) lines.push(`  ${truncate(summary, 160)}`);
  }
  if (records.length > 5) lines.push(`  +${records.length - 5} more`);
  return lines;
}

function formatSearchResult(result: ReadonlyUnknownRecord, index: number): string {
  const source = recordValue(result, 'source');
  const node = recordValue(result, 'node');
  const subject = source ?? node ?? result;
  const id = firstString(result, ['id']) || firstString(subject, ['id']);
  const title = firstString(subject, ['title', 'name', 'summary', 'slug']) || id || 'Untitled result';
  const subjectKind = source
    ? firstString(source, ['sourceType', 'connectorId']) || 'source'
    : firstString(node, ['kind']) || firstString(result, ['kind']) || 'result';
  const score = numberValue(result, 'score');
  const reason = firstString(result, ['reason']);
  const url = firstString(subject, ['sourceUri', 'canonicalUri', 'url', 'uri']);
  const snippet = firstString(subject, ['summary', 'description', 'excerpt']);
  const lines = [
    `${index}. ${title} [${subjectKind}]${id ? ` (${id})` : ''}${score !== undefined ? ` score ${formatScore(score)}` : ''}`,
  ];
  if (url) lines.push(`   ${url}`);
  if (snippet) lines.push(`   ${truncate(snippet, 180)}`);
  if (reason) lines.push(`   ${truncate(reason, 120)}`);
  return lines.join('\n');
}

function groupTitle(kind: string): string {
  if (kind === 'source') return 'Sources';
  if (kind === 'node') return 'Nodes';
  return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}s`;
}

function recordOrEmpty(value: unknown): ReadonlyUnknownRecord {
  return isRecord(value) ? value : {};
}

function recordValue(record: ReadonlyUnknownRecord | undefined, key: string): ReadonlyUnknownRecord | undefined {
  if (!record) return undefined;
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function recordsValue(record: ReadonlyUnknownRecord | undefined, key: string): readonly ReadonlyUnknownRecord[] {
  if (!record) return [];
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function stringsValue(record: ReadonlyUnknownRecord | undefined, key: string): readonly string[] {
  if (!record) return [];
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

function numberValue(record: ReadonlyUnknownRecord | undefined, key: string): number | undefined {
  if (!record) return undefined;
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstNonEmptyRecords(groups: readonly (readonly ReadonlyUnknownRecord[])[]): readonly ReadonlyUnknownRecord[] {
  return groups.find((group) => group.length > 0) ?? [];
}

function firstNonEmptyStrings(groups: readonly (readonly string[])[]): readonly string[] {
  return groups.find((group) => group.length > 0) ?? [];
}

function formatConfidence(value: number): string {
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function truncate(value: string, maxLength: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function trimBlankLines(lines: readonly string[]): readonly string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start += 1;
  while (end > start && lines[end - 1] === '') end -= 1;
  return lines.slice(start, end);
}
