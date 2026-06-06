import type { ArtifactDescriptor, ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';

export interface AgentResearchReportToolArgs {
  readonly title?: unknown;
  readonly question?: unknown;
  readonly summary?: unknown;
  readonly reportMarkdown?: unknown;
  readonly sources?: unknown;
  readonly findings?: unknown;
  readonly gaps?: unknown;
  readonly recommendations?: unknown;
  readonly methodology?: unknown;
  readonly confidence?: unknown;
  readonly tags?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

type AgentResearchReportArtifactStore = Pick<ArtifactStore, 'create'>;

interface ResearchSource {
  readonly title: string;
  readonly url?: string;
  readonly publisher?: string;
  readonly publishedAt?: string;
  readonly accessedAt?: string;
  readonly credibility: string;
  readonly note?: string;
}

const MAX_REPORT_CHARS = 80_000;
const MAX_SOURCE_COUNT = 50;
const SECRETISH = /token|secret|password|authorization|credential|api[-_]?key/i;

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes';
}

function readList(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map(readString).filter(Boolean);
  return readString(value)
    .split(/\n/)
    .map((entry) => entry.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function readTags(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map(readString).filter(Boolean);
  return readString(value).split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean);
}

function readSource(value: unknown): ResearchSource | null {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    const parts = text.split('|').map((part) => part.trim()).filter(Boolean);
    const maybeUrlIndex = parts.findIndex((part) => /^https?:\/\//i.test(part));
    const maybeUrl = maybeUrlIndex >= 0 ? parts[maybeUrlIndex] : '';
    const detailStart = maybeUrlIndex >= 0 ? maybeUrlIndex + 1 : 1;
    const noteParts = parts.slice(detailStart + 1);
    const nonUrlParts = parts.filter((_, index) => index !== maybeUrlIndex);
    const title = maybeUrlIndex === 0 ? (nonUrlParts.length > 1 ? nonUrlParts[0] : maybeUrl) : (parts[0] ?? maybeUrl ?? text);
    return {
      title: title || text,
      ...(maybeUrl ? { url: sanitizeSourceUrl(maybeUrl) } : {}),
      credibility: parts[detailStart] ?? 'unreviewed',
      ...(noteParts.length > 0 ? { note: noteParts.join(' | ') } : {}),
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = readString(record.title) || readString(record.name) || readString(record.url);
  if (!title) return null;
  return {
    title,
    ...(readString(record.url) ? { url: sanitizeSourceUrl(readString(record.url)) } : {}),
    ...(readString(record.publisher) ? { publisher: readString(record.publisher) } : {}),
    ...(readString(record.publishedAt) ? { publishedAt: readString(record.publishedAt) } : {}),
    ...(readString(record.accessedAt) ? { accessedAt: readString(record.accessedAt) } : {}),
    credibility: readString(record.credibility) || 'unreviewed',
    ...(readString(record.note) ? { note: readString(record.note) } : {}),
  };
}

function readSources(value: unknown): readonly ResearchSource[] {
  const raw = Array.isArray(value) ? value : readList(value);
  const sources: ResearchSource[] = [];
  for (const entry of raw) {
    const source = readSource(entry);
    if (!source) continue;
    sources.push(source);
    if (sources.length >= MAX_SOURCE_COUNT) break;
  }
  return sources;
}

function sanitizeSourceUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SECRETISH.test(key)) url.searchParams.set(key, '<redacted>');
    }
    return url.toString();
  } catch {
    return value.replace(/([?&\s](?:token|secret|password|authorization|credential|api[-_]?key)=)[^\s&]+/gi, '$1<redacted>');
  }
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 64) || 'research-report';
}

function failure(error: string): { readonly success: false; readonly error: string } {
  return { success: false, error };
}

function output(text: string): { readonly success: true; readonly output: string } {
  return { success: true, output: text };
}

function preview(args: AgentResearchReportToolArgs, sources: readonly ResearchSource[]): string {
  return [
    'Agent research report preview',
    `  title ${readString(args.title) || '(missing)'}`,
    `  question ${readString(args.question) || '(missing)'}`,
    `  sources ${sources.length}`,
    `  confidence ${readString(args.confidence) || '(unspecified)'}`,
    '  policy saving a sourced report artifact requires confirm:true',
  ].join('\n');
}

function listSection(title: string, items: readonly string[]): string {
  if (items.length === 0) return '';
  return [`## ${title}`, '', ...items.map((item) => `- ${item}`), ''].join('\n');
}

function sourceMapSection(sources: readonly ResearchSource[]): string {
  const lines = ['## Source Map', ''];
  sources.forEach((source, index) => {
    const id = `S${index + 1}`;
    lines.push(`- [${id}] ${source.title}`);
    if (source.url) lines.push(`  - URL: ${source.url}`);
    if (source.publisher) lines.push(`  - Publisher: ${source.publisher}`);
    if (source.publishedAt) lines.push(`  - Published: ${source.publishedAt}`);
    if (source.accessedAt) lines.push(`  - Accessed: ${source.accessedAt}`);
    lines.push(`  - Credibility: ${source.credibility}`);
    if (source.note) lines.push(`  - Note: ${source.note}`);
  });
  lines.push('');
  return lines.join('\n');
}

function buildMarkdown(args: AgentResearchReportToolArgs, sources: readonly ResearchSource[]): string {
  const title = readString(args.title);
  const question = readString(args.question);
  const summary = readString(args.summary);
  const reportMarkdown = readString(args.reportMarkdown);
  const findings = readList(args.findings);
  const gaps = readList(args.gaps);
  const recommendations = readList(args.recommendations);
  const methodology = readString(args.methodology);
  const confidence = readString(args.confidence);
  const generatedAt = new Date().toISOString();
  const lines = [
    `# ${title}`,
    '',
    `Question: ${question}`,
    `Generated: ${generatedAt}`,
    `Confidence: ${confidence || 'unspecified'}`,
    '',
  ];
  if (summary) lines.push('## Summary', '', summary, '');
  if (reportMarkdown) lines.push('## Report', '', reportMarkdown, '');
  const findingSection = listSection('Findings', findings);
  if (findingSection) lines.push(findingSection);
  const gapSection = listSection('Gaps And Caveats', gaps);
  if (gapSection) lines.push(gapSection);
  const recommendationSection = listSection('Recommendations', recommendations);
  if (recommendationSection) lines.push(recommendationSection);
  if (methodology) lines.push('## Method', '', methodology, '');
  lines.push(sourceMapSection(sources));
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
}

function sourceMetadata(sources: readonly ResearchSource[]): readonly Record<string, unknown>[] {
  return sources.map((source, index) => ({
    id: `S${index + 1}`,
    title: source.title,
    ...(source.url ? { url: source.url } : {}),
    ...(source.publisher ? { publisher: source.publisher } : {}),
    ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
    ...(source.accessedAt ? { accessedAt: source.accessedAt } : {}),
    credibility: source.credibility,
    ...(source.note ? { note: source.note } : {}),
  }));
}

async function saveResearchReport(
  artifactStore: AgentResearchReportArtifactStore,
  args: AgentResearchReportToolArgs,
): Promise<ArtifactDescriptor> {
  const title = readString(args.title);
  const question = readString(args.question);
  if (!title) throw new Error('title is required.');
  if (!question) throw new Error('question is required.');
  const sources = readSources(args.sources);
  if (sources.length === 0) throw new Error('At least one reviewed source is required for a research report artifact.');
  if (!readString(args.summary) && !readString(args.reportMarkdown) && readList(args.findings).length === 0) {
    throw new Error('summary, reportMarkdown, or findings are required.');
  }
  const explicitUserRequest = readString(args.explicitUserRequest);
  if (!explicitUserRequest) throw new Error('explicitUserRequest is required so report export stays user-directed.');
  if (!readBoolean(args.confirm)) {
    throw new Error([
      preview(args, sources),
      '',
      'Model tool confirmation required. Call this tool with confirm:true only after the user explicitly asked GoodVibes Agent to save this research report.',
    ].join('\n'));
  }
  const markdown = buildMarkdown(args, sources);
  if (markdown.length > MAX_REPORT_CHARS) throw new Error(`Research report is too large (${markdown.length} chars). Keep it under ${MAX_REPORT_CHARS}.`);
  return artifactStore.create({
    kind: 'document',
    mimeType: 'text/markdown',
    filename: `${slug(title)}.md`,
    text: markdown,
    metadata: {
      purpose: 'agent-research-report',
      source: 'agent-research-report',
      title,
      question,
      confidence: readString(args.confidence) || 'unspecified',
      tags: readTags(args.tags),
      sourceCount: sources.length,
      sources: sourceMetadata(sources),
      explicitUserRequest,
    },
  });
}

export function createAgentResearchReportTool(
  artifactStore?: AgentResearchReportArtifactStore,
): Tool {
  return {
    definition: {
      name: 'agent_research_report',
      description: 'Save one confirmed sourced research report artifact.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Report title.' },
          question: { type: 'string', description: 'Research question answered by the report.' },
          summary: { type: 'string', description: 'Short executive summary.' },
          reportMarkdown: { type: 'string', description: 'Full report markdown.' },
          sources: {
            type: 'array',
            items: { type: 'object' },
            description: 'Reviewed sources with title, url, and credibility.',
          },
          findings: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key findings.',
          },
          gaps: {
            type: 'array',
            items: { type: 'string' },
            description: 'Open questions or caveats.',
          },
          recommendations: {
            type: 'array',
            items: { type: 'string' },
            description: 'Recommended next actions.',
          },
          methodology: { type: 'string', description: 'How sources were selected and judged.' },
          confidence: { type: 'string', description: 'Overall confidence label.' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional report tags.',
          },
          confirm: { type: 'boolean', description: 'Required true to save the report.' },
          explicitUserRequest: { type: 'string', description: 'User request authorizing report save.' },
        },
        required: ['title', 'question', 'sources', 'confirm', 'explicitUserRequest'],
        additionalProperties: false,
      },
      sideEffects: ['state'],
      concurrency: 'serial',
    },
    execute: async (rawArgs: Record<string, unknown>) => {
      if (!artifactStore?.create) return failure('Research report export is unavailable because this runtime did not provide an artifact store.');
      const args = rawArgs as AgentResearchReportToolArgs;
      try {
        const descriptor = await saveResearchReport(artifactStore, args);
        return output([
          'Saved Agent research report artifact',
          `  artifact ${descriptor.id}`,
          `  filename ${descriptor.filename ?? '(none)'}`,
          `  bytes ${descriptor.sizeBytes}`,
          `  mime ${descriptor.mimeType}`,
          `  sources ${readSources(args.sources).length}`,
          `  sha256 ${descriptor.sha256}`,
          '  policy sourced markdown saved as artifact; content not printed',
          `  inspect agent_artifacts mode:"show" artifactId:"${descriptor.id}" includeContent:true`,
        ].join('\n'));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function registerAgentResearchReportTool(
  registry: ToolRegistry,
  artifactStore?: AgentResearchReportArtifactStore,
): void {
  registry.register(createAgentResearchReportTool(artifactStore));
}
