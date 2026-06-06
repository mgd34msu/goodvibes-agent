import { existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import type { ArtifactDescriptor, ArtifactRecord, ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';
import { resolveAndValidatePath } from '@pellux/goodvibes-sdk/platform/utils';

export interface AgentArtifactsToolArgs {
  readonly mode?: unknown;
  readonly artifactId?: unknown;
  readonly artifactIds?: unknown;
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

interface ArtifactPackageEntry {
  readonly path: string;
  readonly buffer: Buffer;
}

interface ArtifactPackagePayload {
  readonly artifactCount: number;
  readonly totalBytes: number;
  readonly entries: readonly ArtifactPackageEntry[];
}

const DEFAULT_LIST_LIMIT = 25;
const DEFAULT_PREVIEW_BYTES = 2_048;
const MAX_PREVIEW_BYTES = 20_000;
const MAX_PACKAGE_ARTIFACTS = 100;
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

function readStringList(value: unknown): readonly string[] {
  const values = Array.isArray(value)
    ? value
    : readString(value)
      .split(/[,\n]/)
      .map((entry) => entry.trim());
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of values) {
    const text = readString(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
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

function sanitizeSourceUri(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_METADATA_KEY.test(key)) url.searchParams.set(key, '<redacted>');
    }
    return url.toString();
  } catch {
    return value.replace(/([?&\s](?:token|secret|password|authorization|credential|api[-_]?key)=)[^\s&]+/gi, '$1<redacted>');
  }
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

function safePackagePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .replace(/[\\/]+/g, '-')
    .replace(/[<>:"|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '');
  const normalized = sanitized || fallback;
  return normalized.length > 128 ? normalized.slice(0, 128).trimEnd() : normalized;
}

function packageArtifactFilename(
  artifact: ArtifactDescriptor,
  index: number,
  used: Set<string>,
): string {
  const ordinal = String(index + 1).padStart(2, '0');
  const id = safePackagePathSegment(artifact.id, `artifact-${ordinal}`);
  const filename = safePackagePathSegment(safeExportFilename(artifact), id);
  const base = `${ordinal}-${id}-${filename}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = createCrc32Table();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date = new Date()): { readonly time: number; readonly date: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function createZipArchive(entries: readonly ArtifactPackageEntry[]): Buffer {
  if (entries.length > 0xffff) throw new Error('Artifact archive has too many files for ZIP output.');
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const timestamp = dosTimestamp();
  let offset = 0;

  for (const entry of entries) {
    const safePath = entry.path.replace(/\\/g, '/');
    const name = Buffer.from(safePath, 'utf-8');
    const compressed = deflateRawSync(entry.buffer);
    if (name.byteLength > 0xffff) throw new Error(`Artifact archive entry path is too long: ${safePath}`);
    if (entry.buffer.byteLength > 0xffffffff || compressed.byteLength > 0xffffffff) {
      throw new Error(`Artifact archive entry is too large for ZIP output: ${safePath}`);
    }
    const checksum = crc32(entry.buffer);
    const method = 8;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(timestamp.time, 10);
    localHeader.writeUInt16LE(timestamp.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.byteLength, 18);
    localHeader.writeUInt32LE(entry.buffer.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(timestamp.time, 12);
    centralHeader.writeUInt16LE(timestamp.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.byteLength, 20);
    centralHeader.writeUInt32LE(entry.buffer.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.byteLength + name.byteLength + compressed.byteLength;
    if (offset > 0xffffffff) throw new Error('Artifact archive is too large for ZIP output.');
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  if (centralDirectory.byteLength > 0xffffffff) throw new Error('Artifact archive central directory is too large for ZIP output.');

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.byteLength, 12);
  endOfCentralDirectory.writeUInt32LE(centralOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
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
  if (artifacts.length > 1) {
    lines.push(
      'Package selected artifacts',
      `  package agent_artifacts mode:"package" artifactIds:${JSON.stringify(artifacts.slice(0, 5).map((artifact) => artifact.id))} destinationPath:"exports/artifact-package" confirm:true explicitUserRequest:"..."`,
      `  archive agent_artifacts mode:"archive" artifactIds:${JSON.stringify(artifacts.slice(0, 5).map((artifact) => artifact.id))} destinationPath:"exports/artifact-package.zip" confirm:true explicitUserRequest:"..."`,
    );
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

async function loadArtifactsForPackage(
  store: AgentArtifactBrowserStore,
  args: AgentArtifactsToolArgs,
  mode: 'package' | 'archive',
): Promise<readonly { readonly record: ArtifactRecord; readonly buffer: Buffer }[]> {
  if (!store.readContent) throw new Error('Artifact package export requires an artifact store with readContent support.');
  const artifactIds = readStringList(args.artifactIds);
  if (artifactIds.length === 0) throw new Error(`artifactIds is required for mode:"${mode}". Provide a comma-separated string or string array.`);
  if (artifactIds.length > MAX_PACKAGE_ARTIFACTS) throw new Error(`Artifact package export supports at most ${MAX_PACKAGE_ARTIFACTS} artifacts per package.`);
  const loaded: Array<{ readonly record: ArtifactRecord; readonly buffer: Buffer }> = [];
  for (const artifactId of artifactIds) {
    loaded.push(await store.readContent(artifactId));
  }
  return loaded;
}

function buildArtifactPackagePayload(
  loaded: readonly { readonly record: ArtifactRecord; readonly buffer: Buffer }[],
): ArtifactPackagePayload {
  const usedFilenames = new Set<string>();
  const manifestArtifacts: Array<Record<string, unknown>> = [];
  const entries: ArtifactPackageEntry[] = [];
  let totalBytes = 0;
  const fileLines: string[] = [];

  for (let index = 0; index < loaded.length; index += 1) {
    const { record, buffer } = loaded[index];
    const filename = packageArtifactFilename(record, index, usedFilenames);
    const relativePath = `artifacts/${filename}`;
    entries.push({ path: relativePath, buffer });
    totalBytes += buffer.byteLength;
    fileLines.push(`- ${record.id}: ${relativePath} (${formatBytes(buffer.byteLength)}, ${record.mimeType})`);
    manifestArtifacts.push({
      id: record.id,
      file: relativePath,
      originalFilename: record.filename ?? null,
      kind: record.kind,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      copiedBytes: buffer.byteLength,
      sha256: record.sha256,
      createdAt: isoTime(record.createdAt),
      expiresAt: record.expiresAt ? isoTime(record.expiresAt) : null,
      acquisitionMode: record.acquisitionMode,
      fetchMode: record.fetchMode,
      sourceUri: sanitizeSourceUri(record.sourceUri) ?? null,
      metadata: sanitizeMetadata(record.metadata),
    });
  }

  const createdAt = new Date().toISOString();
  const manifest = {
    version: 1,
    product: 'goodvibes-agent',
    createdAt,
    artifactCount: loaded.length,
    totalBytes,
    policy: {
      content: 'Exact saved artifact bytes copied into artifacts/.',
      transcript: 'Artifact contents are not printed by the export tool.',
      metadata: 'Secret-like metadata keys and URL query parameters are redacted in this manifest.',
      retention: 'Original saved artifacts are retained in the Agent artifact store.',
    },
    artifacts: manifestArtifacts,
  };
  entries.push({
    path: 'manifest.json',
    buffer: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf-8'),
  });
  entries.push({
    path: 'README.md',
    buffer: Buffer.from(
      [
        '# GoodVibes Agent Artifact Package',
        '',
        `Generated: ${createdAt}`,
        `Artifacts: ${loaded.length}`,
        `Total bytes: ${totalBytes}`,
        '',
        'Files',
        ...fileLines,
        '',
        'Manifest',
        '- `manifest.json` contains redacted artifact metadata and file paths.',
        '- Artifact bytes live under `artifacts/` and are copied exactly from the saved Agent artifact store.',
        '- Original artifacts remain saved in Agent; this package is a user-visible export only.',
        '',
      ].join('\n'),
      'utf-8',
    ),
  });

  return {
    artifactCount: loaded.length,
    totalBytes,
    entries,
  };
}

async function writeArtifactPackageDirectory(resolvedPath: string, payload: ArtifactPackagePayload): Promise<void> {
  for (const entry of payload.entries) {
    const target = join(resolvedPath, ...entry.path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.buffer);
  }
}

async function exportArtifactPackage(
  store: AgentArtifactBrowserStore,
  args: AgentArtifactsToolArgs,
  options: AgentArtifactsToolOptions,
): Promise<string> {
  requireConfirmed(args, 'Agent artifact package export');
  if (!options.projectRoot) throw new Error('Artifact package export requires a projectRoot for path validation.');
  const destinationPath = readString(args.destinationPath);
  if (!destinationPath) throw new Error('destinationPath is required for mode:"package".');
  const resolvedPath = resolveAndValidatePath(destinationPath, options.projectRoot);
  const overwrite = readBoolean(args.overwrite);
  if (existsSync(resolvedPath)) {
    const stats = await stat(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error(`Package target already exists and is not a directory: ${resolvedPath}. Choose a directory path.`);
    }
    if (!overwrite) {
      throw new Error(`Package target already exists: ${resolvedPath}. Pass overwrite:true only after the user confirms replacement.`);
    }
  }

  const loaded = await loadArtifactsForPackage(store, args, 'package');
  const payload = buildArtifactPackagePayload(loaded);
  await writeArtifactPackageDirectory(resolvedPath, payload);
  const artifactDir = join(resolvedPath, 'artifacts');

  return [
    'Exported Agent artifact package',
    `  path ${resolvedPath}`,
    `  artifacts ${payload.artifactCount}`,
    `  bytes ${payload.totalBytes}`,
    `  manifest ${join(resolvedPath, 'manifest.json')}`,
    `  files ${artifactDir}`,
    `  overwrite ${overwrite ? 'yes' : 'no'}`,
    '  policy exact artifact bytes copied; metadata redacted; artifacts retained; content not printed',
  ].join('\n');
}

async function exportArtifactArchive(
  store: AgentArtifactBrowserStore,
  args: AgentArtifactsToolArgs,
  options: AgentArtifactsToolOptions,
): Promise<string> {
  requireConfirmed(args, 'Agent artifact archive export');
  if (!options.projectRoot) throw new Error('Artifact archive export requires a projectRoot for path validation.');
  const destinationPath = readString(args.destinationPath);
  if (!destinationPath) throw new Error('destinationPath is required for mode:"archive".');
  const resolvedPath = resolveAndValidatePath(destinationPath, options.projectRoot);
  const overwrite = readBoolean(args.overwrite);
  if (existsSync(resolvedPath)) {
    const stats = await stat(resolvedPath);
    if (stats.isDirectory()) {
      throw new Error(`Archive target already exists and is a directory: ${resolvedPath}. Choose a .zip file path.`);
    }
    if (!overwrite) {
      throw new Error(`Archive target already exists: ${resolvedPath}. Pass overwrite:true only after the user confirms replacement.`);
    }
  }

  const loaded = await loadArtifactsForPackage(store, args, 'archive');
  const payload = buildArtifactPackagePayload(loaded);
  const archive = createZipArchive(payload.entries);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, archive);

  return [
    'Exported Agent artifact archive',
    `  path ${resolvedPath}`,
    `  artifacts ${payload.artifactCount}`,
    `  sourceBytes ${payload.totalBytes}`,
    `  archiveBytes ${archive.byteLength}`,
    '  archive zip',
    '  manifest manifest.json',
    `  overwrite ${overwrite ? 'yes' : 'no'}`,
    '  policy exact artifact bytes packaged; metadata redacted; artifacts retained; content not printed',
  ].join('\n');
}

export function createAgentArtifactsTool(
  artifactStore?: AgentArtifactBrowserStore,
  options: AgentArtifactsToolOptions = {},
): Tool {
  return {
    definition: {
      name: 'agent_artifacts',
      description: 'Browse, preview, export, package, and archive saved Agent artifacts.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['list', 'show', 'export', 'package', 'archive'],
            description: 'List, show, export one artifact, or package/archive selected ids.',
          },
          artifactId: {
            type: 'string',
            description: 'Artifact id for show or export.',
          },
          artifactIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Artifact ids for mode:"package" or mode:"archive".',
          },
          destinationPath: {
            type: 'string',
            description: 'File path for export/archive; directory path for package.',
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
            description: 'Required true for export, package, and archive writes.',
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
        if (mode === 'package') {
          return output(await exportArtifactPackage(artifactStore, args, options));
        }
        if (mode === 'archive') {
          return output(await exportArtifactArchive(artifactStore, args, options));
        }
        return failure(`Unknown agent_artifacts mode: ${mode || '<missing>'}. Use mode:"list", mode:"show", mode:"export", mode:"package", or mode:"archive".`);
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
