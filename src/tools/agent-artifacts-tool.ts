import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ArtifactDescriptor, ArtifactRecord, ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { resolveAndValidatePath } from '@pellux/goodvibes-sdk/platform/utils';

export interface AgentArtifactsToolArgs {
  readonly mode?: unknown;
  readonly artifactId?: unknown;
  readonly destinationPath?: unknown;
  readonly overwrite?: unknown;
  readonly query?: unknown;
  readonly kind?: unknown;
  readonly mimeType?: unknown;
  readonly purpose?: unknown;
  readonly source?: unknown;
  readonly limit?: unknown;
  readonly includeContent?: unknown;
  readonly previewBytes?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

type AgentArtifactBrowserStore = Partial<Pick<ArtifactStore, 'get' | 'list' | 'readContent'>>;

export interface AgentArtifactsToolOptions {
  readonly projectRoot?: string;
}

interface LoadedArtifact {
  readonly descriptor: ArtifactDescriptor;
  readonly record?: ArtifactRecord;
  readonly buffer?: Buffer;
}

const DEFAULT_LIST_LIMIT = 25;
const DEFAULT_PREVIEW_BYTES = 2_048;
const MAX_PREVIEW_BYTES = 20_000;
const SENSITIVE_METADATA_KEY = /token|secret|password|authorization|credential|api[-_]?key/i;

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes';
}

function readNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function output(text: string): { readonly success: true; readonly output: string } {
  return { success: true, output: text };
}

function failure(error: string): { readonly success: false; readonly error: string } {
  return { success: false, error };
}

function isoTime(value: number): string {
  if (!Number.isFinite(value)) return '(unknown)';
  return new Date(value).toISOString();
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '(unknown)';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    SENSITIVE_METADATA_KEY.test(key) ? '<redacted>' : sanitizeMetadata(entry),
  ]));
}

function metadataText(metadata: Record<string, unknown>): string {
  return JSON.stringify(sanitizeMetadata(metadata));
}

function metadataValue(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function artifactSearchText(artifact: ArtifactDescriptor): string {
  return [
    artifact.id,
    artifact.kind,
    artifact.mimeType,
    artifact.filename ?? '',
    artifact.sourceUri ?? '',
    artifact.sha256,
    metadataText(artifact.metadata),
  ].join('\n').toLowerCase();
}

function matchesFilter(artifact: ArtifactDescriptor, args: AgentArtifactsToolArgs): boolean {
  const query = readString(args.query).toLowerCase();
  const kind = readString(args.kind).toLowerCase();
  const mimeType = readString(args.mimeType).toLowerCase();
  const purpose = readString(args.purpose).toLowerCase();
  const source = readString(args.source).toLowerCase();
  if (query && !artifactSearchText(artifact).includes(query)) return false;
  if (kind && artifact.kind.toLowerCase() !== kind) return false;
  if (mimeType && !artifact.mimeType.toLowerCase().includes(mimeType)) return false;
  if (purpose && !metadataValue(artifact.metadata, 'purpose').toLowerCase().includes(purpose)) return false;
  if (source) {
    const sourceText = [
      artifact.sourceUri ?? '',
      metadataValue(artifact.metadata, 'source'),
      metadataValue(artifact.metadata, 'sourceKind'),
      metadataValue(artifact.metadata, 'purpose'),
    ].join('\n').toLowerCase();
    if (!sourceText.includes(source)) return false;
  }
  return true;
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

function contentPreview(artifact: ArtifactDescriptor, buffer: Buffer | undefined, previewBytes: number): string {
  if (!buffer) return 'Content preview not loaded. Pass includeContent:true to preview text-like artifacts.';
  if (!isTextLike(artifact.mimeType)) {
    return `Content preview omitted for non-text MIME type ${artifact.mimeType}.`;
  }
  const sliced = buffer.subarray(0, Math.min(buffer.byteLength, previewBytes));
  const text = sliced.toString('utf-8').replace(/\0/g, '').trimEnd();
  if (!text) return '(empty text artifact)';
  return buffer.byteLength > sliced.byteLength ? `${text}\n... (${formatBytes(buffer.byteLength - sliced.byteLength)} more)` : text;
}

function safeExportFilename(artifact: ArtifactDescriptor): string {
  const filename = (artifact.filename || artifact.id).trim() || artifact.id;
  return filename.replace(/[\\/]+/g, '-').replace(/^\.+$/, artifact.id);
}

function describeArtifact(artifact: ArtifactDescriptor, options: { readonly includeRoute: boolean }): readonly string[] {
  const purpose = metadataValue(artifact.metadata, 'purpose');
  const source = metadataValue(artifact.metadata, 'source') || metadataValue(artifact.metadata, 'sourceKind');
  const exportPath = `exports/${safeExportFilename(artifact)}`;
  return [
    `${artifact.id}  ${artifact.kind}  ${artifact.mimeType}  ${formatBytes(artifact.sizeBytes)}`,
    `  filename ${artifact.filename ?? '(none)'}`,
    `  created ${isoTime(artifact.createdAt)}`,
    `  purpose ${purpose || '(none)'}`,
    `  source ${source || artifact.sourceUri || '(none)'}`,
    `  sha256 ${artifact.sha256}`,
    ...(options.includeRoute ? [`  inspect agent_artifacts mode:"show" artifactId:"${artifact.id}" includeContent:true`] : []),
    ...(options.includeRoute ? [`  export agent_artifacts mode:"export" artifactId:"${artifact.id}" destinationPath:"${exportPath}" confirm:true explicitUserRequest:"..."`] : []),
  ];
}

function formatList(artifacts: readonly ArtifactDescriptor[], total: number, args: AgentArtifactsToolArgs): string {
  if (artifacts.length === 0) {
    return [
      'Agent artifact browser',
      'No artifacts matched the requested filters.',
      'Try agent_artifacts mode:"list" without filters, or create an upload/export/media/compare artifact first.',
    ].join('\n');
  }
  const lines = [
    'Agent artifact browser',
    `  returned ${artifacts.length}/${total}`,
    `  query ${readString(args.query) || '(none)'}`,
    `  kind ${readString(args.kind) || '(any)'}`,
    `  mime ${readString(args.mimeType) || '(any)'}`,
    `  purpose ${readString(args.purpose) || '(any)'}`,
    '',
  ];
  for (const artifact of artifacts) {
    lines.push(...describeArtifact(artifact, { includeRoute: true }), '');
  }
  return lines.join('\n').trimEnd();
}

async function loadArtifact(store: AgentArtifactBrowserStore, artifactId: string, includeContent: boolean): Promise<LoadedArtifact | null> {
  if (includeContent && store.readContent) {
    const { record, buffer } = await store.readContent(artifactId);
    return { descriptor: record, record, buffer };
  }
  const descriptor = store.get?.(artifactId)
    ?? store.list?.(500).find((artifact) => artifact.id === artifactId)
    ?? null;
  return descriptor ? { descriptor } : null;
}

function formatShow(loaded: LoadedArtifact, args: AgentArtifactsToolArgs): string {
  const previewBytes = clamp(readNumber(args.previewBytes, DEFAULT_PREVIEW_BYTES), 1, MAX_PREVIEW_BYTES);
  const lines = [
    'Agent artifact',
    ...describeArtifact(loaded.descriptor, { includeRoute: false }),
    `  expires ${loaded.descriptor.expiresAt ? isoTime(loaded.descriptor.expiresAt) : '(none)'}`,
    `  acquisition ${loaded.descriptor.acquisitionMode}`,
    `  fetch ${loaded.descriptor.fetchMode}`,
    `  sourceUri ${loaded.descriptor.sourceUri ?? '(none)'}`,
    '  metadata',
    JSON.stringify(sanitizeMetadata(loaded.descriptor.metadata), null, 2).split('\n').map((line) => `    ${line}`).join('\n'),
    '',
    'Content',
    contentPreview(loaded.descriptor, loaded.buffer, previewBytes).split('\n').map((line) => `  ${line}`).join('\n'),
  ];
  if (readBoolean(args.includeContent) && !loaded.buffer) {
    lines.push('', 'Warning: artifact content could not be read in this runtime.');
  }
  return lines.join('\n');
}

function requireConfirmed(args: AgentArtifactsToolArgs, action: string): void {
  const explicitUserRequest = readString(args.explicitUserRequest);
  if (!explicitUserRequest) throw new Error(`${action} requires explicitUserRequest with the user's exact request or a short faithful summary.`);
  if (args.confirm !== true) throw new Error(`${action} requires confirm:true after an explicit user request.`);
}

async function exportArtifactToFile(
  store: AgentArtifactBrowserStore,
  args: AgentArtifactsToolArgs,
  options: AgentArtifactsToolOptions,
): Promise<string> {
  requireConfirmed(args, 'Agent artifact export');
  if (!store.readContent) throw new Error('Artifact export requires an artifact store with readContent support.');
  if (!options.projectRoot) throw new Error('Artifact export requires a projectRoot for path validation.');
  const artifactId = readString(args.artifactId);
  if (!artifactId) throw new Error('artifactId is required for mode:"export".');
  const destinationPath = readString(args.destinationPath);
  if (!destinationPath) throw new Error('destinationPath is required for mode:"export".');
  const resolvedPath = resolveAndValidatePath(destinationPath, options.projectRoot);
  const { record, buffer } = await store.readContent(artifactId);
  const overwrite = readBoolean(args.overwrite);
  if (existsSync(resolvedPath) && !overwrite) {
    throw new Error(`Export target already exists: ${resolvedPath}. Pass overwrite:true only after the user confirms replacement.`);
  }
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, buffer);
  return [
    'Exported Agent artifact',
    `  artifact ${record.id}`,
    `  path ${resolvedPath}`,
    `  bytes ${record.sizeBytes}`,
    `  mime ${record.mimeType}`,
    `  filename ${record.filename ?? '(none)'}`,
    `  sha256 ${record.sha256}`,
    `  overwrite ${overwrite ? 'yes' : 'no'}`,
    '  policy exact artifact bytes copied; artifact retained; content not printed',
  ].join('\n');
}

export function createAgentArtifactsTool(
  artifactStore?: AgentArtifactBrowserStore,
  options: AgentArtifactsToolOptions = {},
): Tool {
  return {
    definition: {
      name: 'agent_artifacts',
      description: 'Browse, preview, and export saved Agent artifacts.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['list', 'show', 'export'],
            description: 'List, show, or export one saved artifact.',
          },
          artifactId: {
            type: 'string',
            description: 'Artifact id for show or export.',
          },
          destinationPath: {
            type: 'string',
            description: 'Workspace path for mode:"export".',
          },
          overwrite: {
            type: 'boolean',
            description: 'Allow export to replace an existing file.',
          },
          query: {
            type: 'string',
            description: 'Search id, filename, MIME, source URI, sha256, and metadata.',
          },
          kind: {
            type: 'string',
            description: 'Exact kind filter: file, image, audio, video, document, archive, data.',
          },
          mimeType: {
            type: 'string',
            description: 'Optional MIME type substring filter.',
          },
          purpose: {
            type: 'string',
            description: 'Optional metadata.purpose filter.',
          },
          source: {
            type: 'string',
            description: 'Optional source URI or metadata source filter.',
          },
          limit: {
            type: 'number',
            description: 'Maximum artifacts to return in list mode.',
          },
          includeContent: {
            type: 'boolean',
            description: 'For mode:"show", include a bounded text preview when possible.',
          },
          previewBytes: {
            type: 'number',
            description: 'Maximum text bytes to preview for mode:"show".',
          },
          confirm: {
            type: 'boolean',
            description: 'Required true for mode:"export".',
          },
          explicitUserRequest: {
            type: 'string',
            description: 'User request authorizing export.',
          },
        },
        required: ['mode'],
        additionalProperties: false,
      },
      sideEffects: ['write_fs'],
      concurrency: 'serial',
    },
    execute: async (rawArgs: Record<string, unknown>) => {
      const args = rawArgs as AgentArtifactsToolArgs;
      const mode = readString(args.mode);
      if (!artifactStore?.list && !artifactStore?.get && !artifactStore?.readContent) {
        return failure('Artifact browsing is unavailable because this runtime did not provide the SDK artifact store.');
      }
      try {
        if (mode === 'list') {
          if (!artifactStore.list) return failure('Artifact list is unavailable in this runtime.');
          const limit = clamp(readNumber(args.limit, DEFAULT_LIST_LIMIT), 1, 100);
          const source = artifactStore.list(Math.max(limit * 4, limit));
          const filtered = source.filter((artifact) => matchesFilter(artifact, args));
          return output(formatList(filtered.slice(0, limit), filtered.length, args));
        }
        if (mode === 'show') {
          const artifactId = readString(args.artifactId);
          if (!artifactId) return failure('artifactId is required for mode:"show".');
          const loaded = await loadArtifact(artifactStore, artifactId, readBoolean(args.includeContent));
          if (!loaded) return failure(`Unknown artifact ${artifactId}. Use agent_artifacts mode:"list" to inspect available artifacts.`);
          return output(formatShow(loaded, args));
        }
        if (mode === 'export') {
          return output(await exportArtifactToFile(artifactStore, args, options));
        }
        return failure(`Unknown agent_artifacts mode: ${mode || '<missing>'}. Use mode:"list", mode:"show", or mode:"export".`);
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function registerAgentArtifactsTool(
  registry: ToolRegistry,
  artifactStore?: AgentArtifactBrowserStore,
  options: AgentArtifactsToolOptions = {},
): void {
  registry.register(createAgentArtifactsTool(artifactStore, options));
}
