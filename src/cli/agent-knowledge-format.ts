type JsonRecord = Record<string, unknown>;

export interface AgentKnowledgeFailureLike {
  readonly ok: false;
  readonly kind: string;
  readonly error: string;
  readonly baseUrl: string;
  readonly route: string;
  readonly daemonVersion?: string;
  readonly expectedSdkVersion?: string;
}

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readString(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(record: JsonRecord | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(record: JsonRecord | null, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : null;
}

function readArray(record: JsonRecord | null, key: string): readonly unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

function cleanInline(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function sourceLine(value: unknown): string {
  const record = isRecord(value) ? value : {};
  const title = cleanInline(record.title)
    || cleanInline(record.canonicalUri)
    || cleanInline(record.sourceUri)
    || cleanInline(record.url)
    || cleanInline(record.id)
    || 'untitled';
  const type = cleanInline(record.sourceType) || cleanInline(record.type) || 'source';
  const url = cleanInline(record.canonicalUri) || cleanInline(record.sourceUri) || cleanInline(record.url);
  return url && url !== title ? `[${type}] ${title} (${url})` : `[${type}] ${title}`;
}

function resultLine(value: unknown): string {
  const record = isRecord(value) ? value : {};
  const title = cleanInline(record.title) || cleanInline(record.id) || 'untitled';
  const id = cleanInline(record.id);
  const type = cleanInline(record.type) || cleanInline(record.kind) || cleanInline(record.sourceType) || 'result';
  const score = readNumber(record, 'score');
  const url = cleanInline(record.url) || cleanInline(record.canonicalUri) || cleanInline(record.sourceUri);
  const snippet = cleanInline(record.snippet) || cleanInline(record.summary) || cleanInline(record.text);
  const parts = [
    `[${type}] ${title}`,
    id && id !== title ? `id=${id}` : '',
    score !== null ? `score=${score.toFixed(3)}` : '',
    url ? `url=${url}` : '',
  ].filter((part) => part.length > 0);
  return snippet ? `${parts.join('  ')}\n    ${snippet}` : parts.join('  ');
}

function nodeLine(value: unknown): string {
  const record = isRecord(value) ? value : {};
  const id = cleanInline(record.id);
  const kind = cleanInline(record.kind) || 'node';
  const title = cleanInline(record.title) || id || 'untitled';
  const confidence = readNumber(record, 'confidence');
  const status = cleanInline(record.status);
  const summary = cleanInline(record.summary);
  const parts = [
    `[${kind}] ${title}`,
    id && id !== title ? `id=${id}` : '',
    status ? `status=${status}` : '',
    confidence !== null ? `confidence=${confidence}` : '',
  ].filter((part) => part.length > 0);
  return summary ? `${parts.join('  ')}\n    ${summary}` : parts.join('  ');
}

function issueLine(value: unknown): string {
  const record = isRecord(value) ? value : {};
  const id = cleanInline(record.id) || 'issue';
  const severity = cleanInline(record.severity) || 'unknown';
  const code = cleanInline(record.code) || 'issue';
  const status = cleanInline(record.status);
  const message = cleanInline(record.message);
  const suffix = status ? ` status=${status}` : '';
  return `  - ${id} [${severity}] ${code}${suffix}${message ? ` - ${message}` : ''}`;
}

function connectorLine(value: unknown): string {
  const record = isRecord(value) ? value : {};
  const id = cleanInline(record.id) || 'connector';
  const name = cleanInline(record.displayName) || id;
  const sourceType = cleanInline(record.sourceType);
  const description = cleanInline(record.description);
  const suffix = sourceType ? ` sourceType=${sourceType}` : '';
  return description ? `  - ${id}  ${name}${suffix}\n    ${description}` : `  - ${id}  ${name}${suffix}`;
}

export function formatStatus(data: unknown): string {
  const record = isRecord(data) ? data : {};
  const ready = readBoolean(record, 'ready');
  const sourceCount = readNumber(record, 'sourceCount');
  const nodeCount = readNumber(record, 'nodeCount');
  const issueCount = readNumber(record, 'issueCount');
  const edgeCount = readNumber(record, 'edgeCount');
  const storagePath = readString(record, 'storagePath');
  return [
    'Agent Knowledge status',
    `  ready: ${ready === null ? 'unknown' : yesNo(ready)}`,
    `  sources: ${sourceCount ?? 'unknown'}`,
    `  nodes: ${nodeCount ?? 'unknown'}`,
    `  edges: ${edgeCount ?? 'unknown'}`,
    `  issues: ${issueCount ?? 'unknown'}`,
    storagePath ? `  storage: ${storagePath}` : null,
    '  route: /api/goodvibes-agent/knowledge/status',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function formatEntityList(data: unknown, kind: 'sources' | 'nodes' | 'issues', limit: number): string {
  const record = isRecord(data) ? data : {};
  const values = readArray(record, kind);
  if (values.length === 0) {
    return [
      `Agent Knowledge ${kind}`,
      '  no records',
      `  route: /api/goodvibes-agent/knowledge/${kind}`,
    ].join('\n');
  }
  const format = kind === 'sources'
    ? sourceLine
    : kind === 'nodes'
      ? nodeLine
      : issueLine;
  return [
    `Agent Knowledge ${kind} (${values.length}, limit ${limit})`,
    ...values.slice(0, limit).map((value, index) => (
      kind === 'issues' ? format(value) : `  ${index + 1}. ${format(value)}`
    )),
  ].join('\n');
}

export function formatItem(data: unknown, id: string): string {
  const record = isRecord(data) ? data : {};
  const source = record.source;
  const node = record.node;
  const issue = record.issue;
  const relatedEdges = readArray(record, 'relatedEdges').length;
  const linkedSources = readArray(record, 'linkedSources').length;
  const linkedNodes = readArray(record, 'linkedNodes').length;
  if (source) {
    return [
      `Agent Knowledge item: ${id}`,
      `  ${sourceLine(source)}`,
      `  relatedEdges=${relatedEdges} linkedSources=${linkedSources} linkedNodes=${linkedNodes}`,
    ].join('\n');
  }
  if (node) {
    return [
      `Agent Knowledge item: ${id}`,
      `  ${nodeLine(node)}`,
      `  relatedEdges=${relatedEdges} linkedSources=${linkedSources} linkedNodes=${linkedNodes}`,
    ].join('\n');
  }
  if (issue) {
    return [
      `Agent Knowledge item: ${id}`,
      issueLine(issue),
      `  relatedEdges=${relatedEdges} linkedSources=${linkedSources} linkedNodes=${linkedNodes}`,
    ].join('\n');
  }
  return [
    `Agent Knowledge item: ${id}`,
    '  not found',
    '  route: /api/goodvibes-agent/knowledge/items/{id}',
  ].join('\n');
}

export function formatMap(data: unknown): string {
  const record = isRecord(data) ? data : {};
  const sources = readArray(record, 'sources');
  const nodes = readArray(record, 'nodes');
  const edges = readArray(record, 'edges');
  const issues = readArray(record, 'issues');
  return [
    'Agent Knowledge map',
    `  sources: ${sources.length}`,
    `  nodes: ${nodes.length}`,
    `  edges: ${edges.length}`,
    `  issues: ${issues.length}`,
    '  route: /api/goodvibes-agent/knowledge/map',
  ].join('\n');
}

export function formatConnectors(data: unknown): string {
  const record = isRecord(data) ? data : {};
  const connectors = readArray(record, 'connectors');
  if (connectors.length === 0) {
    return [
      'Agent Knowledge connectors',
      '  no connectors',
      '  route: /api/goodvibes-agent/knowledge/connectors',
    ].join('\n');
  }
  return [
    `Agent Knowledge connectors (${connectors.length})`,
    ...connectors.map(connectorLine),
  ].join('\n');
}

export function formatAsk(data: unknown, query: string): string {
  const record = isRecord(data) ? data : {};
  const answer = isRecord(record.answer) ? record.answer : record;
  const text = cleanInline(answer.text) || cleanInline(record.answer) || 'No answer returned.';
  const confidence = readNumber(answer, 'confidence') ?? readNumber(record, 'confidence');
  const synthesized = readBoolean(answer, 'synthesized');
  const sources = readArray(answer, 'sources');
  const facts = readArray(answer, 'facts');
  const gaps = readArray(answer, 'gaps');
  const lines = [
    `Agent Knowledge answer: ${query}`,
    text,
    '',
    `confidence: ${confidence ?? 'unknown'}${synthesized === null ? '' : `  synthesized: ${yesNo(synthesized)}`}`,
  ];
  if (sources.length > 0) {
    lines.push('', 'Sources:', ...sources.slice(0, 8).map((source) => `  - ${sourceLine(source)}`));
  }
  if (facts.length > 0) lines.push('', `Facts: ${facts.length}`);
  if (gaps.length > 0) lines.push('', `Gaps: ${gaps.length}`);
  return lines.join('\n');
}

export function formatSearch(data: unknown, query: string): string {
  const record = isRecord(data) ? data : {};
  const items = readArray(record, 'items');
  const results = items.length > 0 ? items : readArray(record, 'results');
  if (results.length === 0) {
    return [
      `Agent Knowledge search: ${query}`,
      '  no results',
      '  route: /api/goodvibes-agent/knowledge/search',
    ].join('\n');
  }
  return [
    `Agent Knowledge search: ${query}`,
    ...results.slice(0, 10).map((result, index) => `  ${index + 1}. ${resultLine(result)}`),
  ].join('\n');
}

export function formatIngest(data: unknown, url: string): string {
  const record = isRecord(data) ? data : {};
  const source = isRecord(record.source) ? record.source : record;
  const sourceId = cleanInline(source.id);
  const canonicalUri = cleanInline(source.canonicalUri) || cleanInline(source.sourceUri) || url;
  const artifactId = cleanInline(record.artifactId);
  return [
    'Agent Knowledge ingest-url accepted',
    `  source: ${sourceId || '(pending)'}`,
    `  url: ${canonicalUri}`,
    artifactId ? `  artifact: ${artifactId}` : null,
    '  route: /api/goodvibes-agent/knowledge/ingest/url',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function formatBatchIngest(data: unknown, label: string): string {
  const record = isRecord(data) ? data : {};
  const imported = readNumber(record, 'imported');
  const failed = readNumber(record, 'failed');
  const sources = readArray(record, 'sources');
  const errors = readArray(record, 'errors');
  return [
    `Agent Knowledge ${label} accepted`,
    `  imported: ${imported ?? sources.length}`,
    `  failed: ${failed ?? errors.length}`,
    `  sources: ${sources.length}`,
    ...sources.slice(0, 5).map((source) => `  - ${sourceLine(source)}`),
    ...(errors.length > 0 ? ['  errors:', ...errors.slice(0, 5).map((error) => `  - ${cleanInline(error)}`)] : []),
  ].join('\n');
}

export function formatReindex(data: unknown): string {
  const record = isRecord(data) ? data : {};
  const status = isRecord(record.status) ? record.status : {};
  return [
    'Agent Knowledge reindex complete',
    `  sources: ${readNumber(status, 'sourceCount') ?? 'unknown'}`,
    `  nodes: ${readNumber(status, 'nodeCount') ?? 'unknown'}`,
    `  edges: ${readNumber(status, 'edgeCount') ?? 'unknown'}`,
    `  issues: ${readNumber(status, 'issueCount') ?? 'unknown'}`,
    '  route: /api/goodvibes-agent/knowledge/reindex',
  ].join('\n');
}

export function formatFailure(failure: AgentKnowledgeFailureLike, json: boolean): string {
  if (json) return JSON.stringify(failure, null, 2);
  return [
    `Agent Knowledge error: ${failure.kind}`,
    `  ${failure.error}`,
    `  runtime: ${failure.baseUrl}`,
    `  route: ${failure.route}`,
    failure.kind === 'version_mismatch' && failure.daemonVersion && failure.expectedSdkVersion
      ? `  versions: runtime=${failure.daemonVersion} expected=${failure.expectedSdkVersion}`
      : null,
    failure.kind === 'version_mismatch'
      ? '  next: update connected GoodVibes services so /status matches the Agent SDK pin.'
      : null,
    failure.kind === 'daemon_route_unavailable'
      ? '  next: update connected GoodVibes services to the SDK version required by this Agent package.'
      : null,
  ].filter((line): line is string => Boolean(line)).join('\n');
}
