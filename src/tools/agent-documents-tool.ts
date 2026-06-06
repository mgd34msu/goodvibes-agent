import type { ArtifactDescriptor, ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import type { ShellPathService } from '@/runtime/index.ts';
import {
  AgentDocumentRegistry,
  renderAgentDocumentMarkdown,
  type AgentDocumentRecord,
  type AgentDocumentStatus,
} from '../agent/document-registry.ts';

export type AgentDocumentsToolMode = 'list' | 'show' | 'create' | 'update' | 'review' | 'export' | 'insertArtifact';

export interface AgentDocumentsToolArgs {
  readonly mode?: unknown;
  readonly documentId?: unknown;
  readonly query?: unknown;
  readonly title?: unknown;
  readonly body?: unknown;
  readonly tags?: unknown;
  readonly status?: unknown;
  readonly artifactId?: unknown;
  readonly placement?: unknown;
  readonly sectionTitle?: unknown;
  readonly includeContent?: unknown;
  readonly changeSummary?: unknown;
  readonly includeVersions?: unknown;
  readonly limit?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

type AgentDocumentArtifactStore = Partial<Pick<ArtifactStore, 'create' | 'get' | 'readContent'>>;

const MODES: readonly AgentDocumentsToolMode[] = ['list', 'show', 'create', 'update', 'review', 'export', 'insertArtifact'];
const MAX_INSERT_TEXT_BYTES = 40_000;

function isMode(value: unknown): value is AgentDocumentsToolMode {
  return typeof value === 'string' && MODES.includes(value as AgentDocumentsToolMode);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringList(value: unknown): readonly string[] {
  if (typeof value === 'string') return value.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
}

function readBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || readString(value) === '') return fallback;
  return value === true || value === 'true' || value === 'yes';
}

function readLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

function readStatus(value: unknown): AgentDocumentStatus | undefined {
  if (value === 'draft' || value === 'reviewed' || value === 'archived') return value;
  if (value === undefined || value === null || readString(value) === '') return undefined;
  throw new Error('status must be draft, reviewed, or archived.');
}

function readPlacement(value: unknown): 'append' | 'prepend' | 'replace' {
  const placement = readString(value).toLowerCase();
  if (!placement || placement === 'append') return 'append';
  if (placement === 'prepend' || placement === 'replace') return placement;
  throw new Error('placement must be append, prepend, or replace.');
}

function output(text: string): { readonly success: true; readonly output: string } {
  return { success: true, output: text };
}

function failure(error: string): { readonly success: false; readonly error: string } {
  return { success: false, error };
}

function requireDocumentId(args: AgentDocumentsToolArgs): string {
  const id = readString(args.documentId);
  if (!id) throw new Error('documentId is required.');
  return id;
}

function requireArtifactId(args: AgentDocumentsToolArgs): string {
  const id = readString(args.artifactId);
  if (!id) throw new Error('artifactId is required.');
  return id;
}

function requireConfirmed(args: AgentDocumentsToolArgs, action: string): void {
  const explicitUserRequest = readString(args.explicitUserRequest);
  if (!explicitUserRequest) throw new Error(`${action} requires explicitUserRequest with the user's exact request or a short faithful summary.`);
  if (args.confirm !== true) throw new Error(`${action} requires confirm:true after an explicit user request.`);
}

function formatDocumentSummary(document: AgentDocumentRecord): string {
  const tags = document.tags.length > 0 ? ` tags ${document.tags.join(', ')}` : '';
  const artifact = document.lastArtifactId ? ` artifact ${document.lastArtifactId}` : '';
  return `${document.id}  ${document.status}  versions ${document.versions.length}  updated ${document.updatedAt}${tags}${artifact}  ${document.title}`;
}

function formatList(documents: readonly AgentDocumentRecord[], total: number, query: string): string {
  if (documents.length === 0) {
    return [
      'Agent documents',
      `  query ${query || '(all)'}`,
      'No Agent document drafts matched.',
    ].join('\n');
  }
  return [
    'Agent documents',
    `  returned ${documents.length}/${total}`,
    `  query ${query || '(all)'}`,
    ...documents.map((document) => `  - ${formatDocumentSummary(document)}`),
  ].join('\n');
}

function formatShow(document: AgentDocumentRecord, includeVersions: boolean): string {
  const lines = [
    'Agent document',
    `  id ${document.id}`,
    `  title ${document.title}`,
    `  status ${document.status}`,
    `  tags ${document.tags.join(', ') || '(none)'}`,
    `  versions ${document.versions.length}`,
    `  created ${document.createdAt}`,
    `  updated ${document.updatedAt}`,
    `  lastArtifact ${document.lastArtifactId ?? '(none)'}`,
    '',
    document.body,
  ];
  if (includeVersions) {
    lines.push(
      '',
      'Versions',
      ...document.versions.map((version) => `  - ${version.id}  ${version.createdAt}  ${version.summary}`),
    );
  }
  return lines.join('\n');
}

function exportedVersionId(document: AgentDocumentRecord): string {
  return document.versions.at(-1)?.id ?? 'v1';
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '(unknown)';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function isTextLike(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith('text/')
    || normalized.includes('json')
    || normalized.includes('xml')
    || normalized.includes('yaml')
    || normalized.includes('csv')
    || normalized.includes('javascript')
    || normalized.includes('typescript');
}

function artifactSectionTitle(artifact: ArtifactDescriptor, explicitTitle: string): string {
  return explicitTitle || artifact.filename || artifact.id;
}

async function loadArtifactForInsert(
  artifactStore: AgentDocumentArtifactStore | undefined,
  artifactId: string,
  includeContent: boolean,
): Promise<{ readonly descriptor: ArtifactDescriptor; readonly buffer?: Buffer }> {
  if (!artifactStore?.get && !artifactStore?.readContent) {
    throw new Error('Artifact insertion requires an artifact store with get or readContent support.');
  }
  if (includeContent && artifactStore.readContent) {
    const { record, buffer } = await artifactStore.readContent(artifactId);
    return { descriptor: record, buffer };
  }
  const descriptor = artifactStore.get?.(artifactId) ?? null;
  if (descriptor) return { descriptor };
  if (artifactStore.readContent) {
    const { record, buffer } = await artifactStore.readContent(artifactId);
    return { descriptor: record, buffer: includeContent ? buffer : undefined };
  }
  throw new Error(`Unknown artifact ${artifactId}. Use agent_artifacts mode:"list" to inspect available artifacts.`);
}

function renderArtifactDocumentBlock(
  artifact: ArtifactDescriptor,
  buffer: Buffer | undefined,
  options: {
    readonly sectionTitle: string;
    readonly includeContent: boolean;
  },
): string {
  const heading = artifactSectionTitle(artifact, options.sectionTitle);
  const lines = [
    `## ${heading}`,
    '',
    `Artifact ID: ${artifact.id}`,
    `Filename: ${artifact.filename ?? '(none)'}`,
    `MIME: ${artifact.mimeType}`,
    `Size: ${formatBytes(artifact.sizeBytes)}`,
  ];

  if (!options.includeContent) {
    lines.push('', '_Content omitted by request; use the artifact id above to inspect or attach it._');
    return lines.join('\n');
  }

  if (!isTextLike(artifact.mimeType)) {
    lines.push('', `_Content omitted for non-text artifact ${artifact.mimeType}; binary/base64 bytes were not inserted._`);
    return lines.join('\n');
  }

  if (!buffer) {
    lines.push('', '_Text content could not be read in this runtime._');
    return lines.join('\n');
  }

  const sliced = buffer.subarray(0, Math.min(buffer.byteLength, MAX_INSERT_TEXT_BYTES));
  const text = sliced.toString('utf-8').replace(/\0/g, '').trim();
  lines.push('', text || '_Empty text artifact._');
  if (buffer.byteLength > sliced.byteLength) {
    lines.push('', `_Truncated ${formatBytes(buffer.byteLength - sliced.byteLength)} from the inserted artifact preview._`);
  }
  return lines.join('\n');
}

function insertBlock(body: string, block: string, placement: 'append' | 'prepend' | 'replace'): string {
  if (placement === 'replace') return block;
  if (placement === 'prepend') return `${block}\n\n${body}`;
  return `${body}\n\n${block}`;
}

function formatExport(document: AgentDocumentRecord, artifact: ArtifactDescriptor): string {
  return [
    'Exported Agent document',
    `  document ${document.id}`,
    `  version ${exportedVersionId(document)}`,
    `  artifact ${artifact.id}`,
    `  filename ${artifact.filename ?? '(none)'}`,
    `  route agent_artifacts mode:"show" artifactId:"${artifact.id}" includeContent:true`,
  ].join('\n');
}

async function exportDocument(
  registry: AgentDocumentRegistry,
  artifactStore: AgentDocumentArtifactStore | undefined,
  document: AgentDocumentRecord,
): Promise<string> {
  if (!artifactStore?.create) throw new Error('Agent document export requires an artifact store with create support.');
  const versionId = exportedVersionId(document);
  const artifact = await artifactStore.create({
    kind: 'document',
    mimeType: 'text/markdown',
    filename: `${document.id}-${versionId}.md`,
    text: renderAgentDocumentMarkdown(document),
    metadata: {
      purpose: 'agent-document-export',
      source: 'agent-documents',
      documentId: document.id,
      versionId,
      status: document.status,
    },
  });
  registry.updateArtifactId(document.id, artifact.id);
  return formatExport({ ...document, lastArtifactId: artifact.id }, artifact);
}

async function insertArtifactIntoDocument(
  registry: AgentDocumentRegistry,
  artifactStore: AgentDocumentArtifactStore | undefined,
  args: AgentDocumentsToolArgs,
): Promise<string> {
  const documentId = requireDocumentId(args);
  const artifactId = requireArtifactId(args);
  const document = registry.get(documentId);
  if (!document) throw new Error(`Unknown Agent document ${documentId}.`);
  const includeContent = readBoolean(args.includeContent, true);
  const placement = readPlacement(args.placement);
  const loaded = await loadArtifactForInsert(artifactStore, artifactId, includeContent);
  const block = renderArtifactDocumentBlock(loaded.descriptor, loaded.buffer, {
    sectionTitle: readString(args.sectionTitle),
    includeContent,
  });
  const updated = registry.update(document.id, {
    body: insertBlock(document.body, block, placement),
    summary: readString(args.changeSummary) || `Inserted artifact ${artifactId}.`,
  });
  return [
    'Inserted artifact into Agent document',
    `  document ${updated.id}`,
    `  artifact ${loaded.descriptor.id}`,
    `  placement ${placement}`,
    `  versions ${updated.versions.length}`,
    `  inserted ${isTextLike(loaded.descriptor.mimeType) && includeContent ? 'bounded text content' : 'safe artifact reference'}`,
  ].join('\n');
}

export function createAgentDocumentsTool(
  shellPaths: ShellPathService,
  artifactStore?: AgentDocumentArtifactStore,
): Tool {
  return {
    definition: {
      name: 'agent_documents',
      description: 'Create, revise, insert artifacts into, and export Agent document drafts.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: [...MODES],
            description: 'Document action. Defaults to list.',
          },
          documentId: {
            type: 'string',
            description: 'Document id or exact title for show, update, review, or export.',
          },
          query: {
            type: 'string',
            description: 'Search query for list mode.',
          },
          title: {
            type: 'string',
            description: 'Document title for create or update.',
          },
          body: {
            type: 'string',
            description: 'Markdown body for create or update.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional document tags.',
          },
          status: {
            type: 'string',
            enum: ['draft', 'reviewed', 'archived'],
            description: 'Optional document status for update.',
          },
          artifactId: {
            type: 'string',
            description: 'Saved artifact id for mode:"insertArtifact".',
          },
          placement: {
            type: 'string',
            enum: ['append', 'prepend', 'replace'],
            description: 'Where to place inserted artifact content in the document body.',
          },
          sectionTitle: {
            type: 'string',
            description: 'Optional markdown heading for inserted artifact content.',
          },
          includeContent: {
            type: 'boolean',
            description: 'Insert bounded text for text artifacts; reference non-text artifacts.',
          },
          changeSummary: {
            type: 'string',
            description: 'Short version note for create or update.',
          },
          includeVersions: {
            type: 'boolean',
            description: 'Include version history in show mode.',
          },
          limit: {
            type: 'number',
            description: 'Maximum list rows.',
          },
          confirm: {
            type: 'boolean',
            description: 'Required true for document writes and export.',
          },
          explicitUserRequest: {
            type: 'string',
            description: 'User request authorizing the document mutation.',
          },
        },
        additionalProperties: false,
      },
      sideEffects: ['state'],
    },
    execute: async (rawArgs: unknown) => {
      const args = rawArgs as AgentDocumentsToolArgs;
      const mode = args.mode === undefined || readString(args.mode) === ''
        ? 'list'
        : isMode(args.mode)
          ? args.mode
          : null;
      if (mode === null) return failure(`mode must be one of ${MODES.join(', ')}.`);

      const registry = AgentDocumentRegistry.fromShellPaths(shellPaths);
      try {
        if (mode === 'list') {
          const query = readString(args.query);
          const matches = query ? registry.search(query) : registry.list();
          const limit = readLimit(args.limit, 20);
          return output(formatList(matches.slice(0, limit), matches.length, query));
        }
        if (mode === 'show') {
          const document = registry.get(requireDocumentId(args));
          if (!document) return failure(`Unknown Agent document ${readString(args.documentId)}.`);
          return output(formatShow(document, readBoolean(args.includeVersions, true)));
        }
        if (mode === 'create') {
          requireConfirmed(args, 'Agent document creation');
          const title = readString(args.title);
          const body = readString(args.body);
          const document = registry.create({
            title,
            body,
            tags: readStringList(args.tags),
            summary: readString(args.changeSummary) || 'Initial draft.',
          });
          return output([
            'Created Agent document',
            `  id ${document.id}`,
            `  title ${document.title}`,
            `  versions ${document.versions.length}`,
          ].join('\n'));
        }
        if (mode === 'update') {
          requireConfirmed(args, 'Agent document update');
          const id = requireDocumentId(args);
          const document = registry.update(id, {
            title: args.title === undefined ? undefined : readString(args.title),
            body: args.body === undefined ? undefined : readString(args.body),
            tags: args.tags === undefined ? undefined : readStringList(args.tags),
            status: readStatus(args.status),
            summary: readString(args.changeSummary) || 'Updated draft.',
          });
          return output([
            'Updated Agent document',
            `  id ${document.id}`,
            `  title ${document.title}`,
            `  versions ${document.versions.length}`,
          ].join('\n'));
        }
        if (mode === 'review') {
          requireConfirmed(args, 'Agent document review');
          const document = registry.markReviewed(requireDocumentId(args));
          return output([
            'Reviewed Agent document',
            `  id ${document.id}`,
            `  status ${document.status}`,
            `  versions ${document.versions.length}`,
          ].join('\n'));
        }
        if (mode === 'insertArtifact') {
          requireConfirmed(args, 'Agent document artifact insertion');
          return output(await insertArtifactIntoDocument(registry, artifactStore, args));
        }
        requireConfirmed(args, 'Agent document export');
        const document = registry.get(requireDocumentId(args));
        if (!document) return failure(`Unknown Agent document ${readString(args.documentId)}.`);
        return output(await exportDocument(registry, artifactStore, document));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function registerAgentDocumentsTool(
  registry: ToolRegistry,
  shellPaths: ShellPathService,
  artifactStore?: AgentDocumentArtifactStore,
): void {
  registry.register(createAgentDocumentsTool(shellPaths, artifactStore));
}
