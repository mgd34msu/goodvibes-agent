import { randomUUID } from 'node:crypto';
import type { ArtifactCreateInput, ArtifactDescriptor, ArtifactRecord, ArtifactStore } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { Tool } from '@pellux/goodvibes-sdk/platform/types';
import type { ToolRegistry } from '@pellux/goodvibes-sdk/platform/tools';

export interface AgentReviewPacketPresetsToolArgs {
  readonly mode?: unknown;
  readonly artifactId?: unknown;
  readonly name?: unknown;
  readonly documentId?: unknown;
  readonly documentTitle?: unknown;
  readonly documentExportArtifactId?: unknown;
  readonly comparisonArtifactId?: unknown;
  readonly judgmentArtifactId?: unknown;
  readonly revealedJudgmentArtifactId?: unknown;
  readonly routeDecisionArtifactId?: unknown;
  readonly routeDecision?: unknown;
  readonly handoffArtifactId?: unknown;
  readonly handoffArchiveArtifactId?: unknown;
  readonly relatedArtifactIds?: unknown;
  readonly summary?: unknown;
  readonly limit?: unknown;
  readonly confirm?: unknown;
  readonly explicitUserRequest?: unknown;
}

type AgentReviewPacketPresetArtifactStore = Pick<ArtifactStore, 'create'> & Partial<Pick<ArtifactStore, 'list' | 'readContent'>>;

type AgentReviewPacketPresetMode = 'list' | 'show' | 'save';

interface ReviewPacketPresetPacket {
  readonly documentId?: string;
  readonly documentTitle?: string;
  readonly documentExportArtifactId?: string;
  readonly comparisonArtifactId?: string;
  readonly judgmentArtifactId?: string;
  readonly revealedJudgmentArtifactId?: string;
  readonly routeDecisionArtifactId?: string;
  readonly routeDecision?: string;
  readonly handoffArtifactId?: string;
  readonly handoffArchiveArtifactId?: string;
  readonly relatedArtifactIds: readonly string[];
  readonly summary: string;
}

interface ReviewPacketPresetRecord {
  readonly schema: 'goodvibes-agent.review-packet-preset';
  readonly schemaVersion: 1;
  readonly presetId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly explicitUserRequest: string;
  readonly packet: ReviewPacketPresetPacket;
  readonly policy: {
    readonly effect: 'save-local-preset-artifact-only';
    readonly documentsChanged: false;
    readonly modelRouteChanged: false;
    readonly handoffArchiveCreated: false;
  };
}

interface LoadedReviewPacketPreset {
  readonly descriptor: ArtifactDescriptor;
  readonly record?: ArtifactRecord;
  readonly body?: ReviewPacketPresetRecord;
}

const REVIEW_PACKET_PRESET_PURPOSE = 'agent-review-packet-preset';
const REVIEW_PACKET_PRESET_SCHEMA = 'goodvibes-agent.review-packet-preset';
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const MAX_RELATED_ARTIFACTS = 30;

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
  for (const valueEntry of values) {
    const entry = readString(valueEntry);
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
    if (result.length >= MAX_RELATED_ARTIFACTS) break;
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function compactText(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function filenamePart(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || 'review-packet';
}

function parseMode(value: unknown): AgentReviewPacketPresetMode {
  const mode = readString(value).toLowerCase();
  if (!mode || mode === 'list') return 'list';
  if (mode === 'show' || mode === 'get') return 'show';
  if (mode === 'save' || mode === 'create') return 'save';
  throw new Error(`Unknown agent_review_packet_presets mode: ${mode}. Use mode:"list", mode:"show", or mode:"save".`);
}

function readPresetPacket(args: AgentReviewPacketPresetsToolArgs): ReviewPacketPresetPacket {
  const documentId = readString(args.documentId);
  const documentTitle = readString(args.documentTitle);
  const documentExportArtifactId = readString(args.documentExportArtifactId);
  const comparisonArtifactId = readString(args.comparisonArtifactId);
  const judgmentArtifactId = readString(args.judgmentArtifactId);
  const revealedJudgmentArtifactId = readString(args.revealedJudgmentArtifactId);
  const routeDecisionArtifactId = readString(args.routeDecisionArtifactId);
  const routeDecision = readString(args.routeDecision);
  const handoffArtifactId = readString(args.handoffArtifactId);
  const handoffArchiveArtifactId = readString(args.handoffArchiveArtifactId);
  const relatedArtifactIds = readStringList(args.relatedArtifactIds);
  const explicitSummary = readString(args.summary);
  const sourceArtifactId = revealedJudgmentArtifactId || judgmentArtifactId || comparisonArtifactId || documentExportArtifactId;
  const summary = explicitSummary || [
    documentId ? `document ${documentId}` : '',
    sourceArtifactId ? `source ${sourceArtifactId}` : '',
    handoffArtifactId ? `handoff ${handoffArtifactId}` : '',
    handoffArchiveArtifactId ? `archive ${handoffArchiveArtifactId}` : '',
    relatedArtifactIds.length > 0 ? `${relatedArtifactIds.length} related` : '',
  ].filter(Boolean).join('; ') || 'review packet preset';

  if (!documentId
    && !documentExportArtifactId
    && !comparisonArtifactId
    && !judgmentArtifactId
    && !revealedJudgmentArtifactId
    && !routeDecisionArtifactId
    && !handoffArtifactId
    && !handoffArchiveArtifactId
    && relatedArtifactIds.length === 0
  ) {
    throw new Error('save mode requires at least one document, comparison, judgment, handoff, archive, route-decision, or related artifact id.');
  }

  return {
    ...(documentId ? { documentId } : {}),
    ...(documentTitle ? { documentTitle } : {}),
    ...(documentExportArtifactId ? { documentExportArtifactId } : {}),
    ...(comparisonArtifactId ? { comparisonArtifactId } : {}),
    ...(judgmentArtifactId ? { judgmentArtifactId } : {}),
    ...(revealedJudgmentArtifactId ? { revealedJudgmentArtifactId } : {}),
    ...(routeDecisionArtifactId ? { routeDecisionArtifactId } : {}),
    ...(routeDecision ? { routeDecision } : {}),
    ...(handoffArtifactId ? { handoffArtifactId } : {}),
    ...(handoffArchiveArtifactId ? { handoffArchiveArtifactId } : {}),
    relatedArtifactIds,
    summary,
  };
}

function presetName(args: AgentReviewPacketPresetsToolArgs, packet: ReviewPacketPresetPacket): string {
  const requested = readString(args.name);
  if (requested) return requested;
  if (packet.documentTitle) return `${packet.documentTitle} reviewer packet`;
  if (packet.documentId) return `${packet.documentId} reviewer packet`;
  if (packet.handoffArtifactId) return `${packet.handoffArtifactId} reviewer packet`;
  return 'Reviewer packet preset';
}

function buildPresetRecord(args: AgentReviewPacketPresetsToolArgs): ReviewPacketPresetRecord {
  const explicitUserRequest = readString(args.explicitUserRequest);
  if (!explicitUserRequest) {
    throw new Error('explicitUserRequest is required so saved packet presets stay tied to a direct user request.');
  }
  const packet = readPresetPacket(args);
  return {
    schema: REVIEW_PACKET_PRESET_SCHEMA,
    schemaVersion: 1,
    presetId: `packet_preset_${randomUUID()}`,
    name: presetName(args, packet),
    createdAt: new Date().toISOString(),
    explicitUserRequest,
    packet,
    policy: {
      effect: 'save-local-preset-artifact-only',
      documentsChanged: false,
      modelRouteChanged: false,
      handoffArchiveCreated: false,
    },
  };
}

function metadataValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function presetMetadata(record: ReviewPacketPresetRecord): Record<string, unknown> {
  return {
    purpose: REVIEW_PACKET_PRESET_PURPOSE,
    schema: REVIEW_PACKET_PRESET_SCHEMA,
    schemaVersion: record.schemaVersion,
    presetId: record.presetId,
    name: record.name,
    summary: record.packet.summary,
    documentId: metadataValue(record.packet.documentId),
    documentTitle: metadataValue(record.packet.documentTitle),
    documentExportArtifactId: metadataValue(record.packet.documentExportArtifactId),
    comparisonArtifactId: metadataValue(record.packet.comparisonArtifactId),
    judgmentArtifactId: metadataValue(record.packet.judgmentArtifactId),
    revealedJudgmentArtifactId: metadataValue(record.packet.revealedJudgmentArtifactId),
    routeDecisionArtifactId: metadataValue(record.packet.routeDecisionArtifactId),
    routeDecision: metadataValue(record.packet.routeDecision),
    handoffArtifactId: metadataValue(record.packet.handoffArtifactId),
    handoffArchiveArtifactId: metadataValue(record.packet.handoffArchiveArtifactId),
    relatedArtifactIds: record.packet.relatedArtifactIds,
    source: 'agent-review-packet-presets',
    createdAt: record.createdAt,
    explicitUserRequest: record.explicitUserRequest,
  };
}

function presetCreateInput(record: ReviewPacketPresetRecord): ArtifactCreateInput {
  return {
    kind: 'data',
    mimeType: 'application/json',
    filename: `review-packet-preset-${filenamePart(record.name)}.json`,
    text: `${JSON.stringify(record, null, 2)}\n`,
    metadata: presetMetadata(record),
  };
}

function readMetadataString(metadata: Readonly<Record<string, unknown>>, key: string): string {
  const value = metadata[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readMetadataStringList(metadata: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function isPresetArtifact(artifact: ArtifactDescriptor): boolean {
  return readMetadataString(artifact.metadata, 'purpose') === REVIEW_PACKET_PRESET_PURPOSE;
}

function packetFromMetadata(artifact: ArtifactDescriptor): ReviewPacketPresetPacket {
  return {
    ...(readMetadataString(artifact.metadata, 'documentId') ? { documentId: readMetadataString(artifact.metadata, 'documentId') } : {}),
    ...(readMetadataString(artifact.metadata, 'documentTitle') ? { documentTitle: readMetadataString(artifact.metadata, 'documentTitle') } : {}),
    ...(readMetadataString(artifact.metadata, 'documentExportArtifactId') ? { documentExportArtifactId: readMetadataString(artifact.metadata, 'documentExportArtifactId') } : {}),
    ...(readMetadataString(artifact.metadata, 'comparisonArtifactId') ? { comparisonArtifactId: readMetadataString(artifact.metadata, 'comparisonArtifactId') } : {}),
    ...(readMetadataString(artifact.metadata, 'judgmentArtifactId') ? { judgmentArtifactId: readMetadataString(artifact.metadata, 'judgmentArtifactId') } : {}),
    ...(readMetadataString(artifact.metadata, 'revealedJudgmentArtifactId') ? { revealedJudgmentArtifactId: readMetadataString(artifact.metadata, 'revealedJudgmentArtifactId') } : {}),
    ...(readMetadataString(artifact.metadata, 'routeDecisionArtifactId') ? { routeDecisionArtifactId: readMetadataString(artifact.metadata, 'routeDecisionArtifactId') } : {}),
    ...(readMetadataString(artifact.metadata, 'routeDecision') ? { routeDecision: readMetadataString(artifact.metadata, 'routeDecision') } : {}),
    ...(readMetadataString(artifact.metadata, 'handoffArtifactId') ? { handoffArtifactId: readMetadataString(artifact.metadata, 'handoffArtifactId') } : {}),
    ...(readMetadataString(artifact.metadata, 'handoffArchiveArtifactId') ? { handoffArchiveArtifactId: readMetadataString(artifact.metadata, 'handoffArchiveArtifactId') } : {}),
    relatedArtifactIds: readMetadataStringList(artifact.metadata, 'relatedArtifactIds'),
    summary: readMetadataString(artifact.metadata, 'summary') || 'review packet preset',
  };
}

function parsePresetBody(buffer: Buffer): ReviewPacketPresetRecord | null {
  try {
    const parsed = JSON.parse(buffer.toString('utf-8')) as Partial<ReviewPacketPresetRecord>;
    if (parsed.schema !== REVIEW_PACKET_PRESET_SCHEMA || parsed.schemaVersion !== 1 || !parsed.packet) return null;
    const packet = parsed.packet as Partial<ReviewPacketPresetPacket>;
    return {
      schema: REVIEW_PACKET_PRESET_SCHEMA,
      schemaVersion: 1,
      presetId: readString(parsed.presetId),
      name: readString(parsed.name) || 'Reviewer packet preset',
      createdAt: readString(parsed.createdAt),
      explicitUserRequest: readString(parsed.explicitUserRequest),
      packet: {
        ...(readString(packet.documentId) ? { documentId: readString(packet.documentId) } : {}),
        ...(readString(packet.documentTitle) ? { documentTitle: readString(packet.documentTitle) } : {}),
        ...(readString(packet.documentExportArtifactId) ? { documentExportArtifactId: readString(packet.documentExportArtifactId) } : {}),
        ...(readString(packet.comparisonArtifactId) ? { comparisonArtifactId: readString(packet.comparisonArtifactId) } : {}),
        ...(readString(packet.judgmentArtifactId) ? { judgmentArtifactId: readString(packet.judgmentArtifactId) } : {}),
        ...(readString(packet.revealedJudgmentArtifactId) ? { revealedJudgmentArtifactId: readString(packet.revealedJudgmentArtifactId) } : {}),
        ...(readString(packet.routeDecisionArtifactId) ? { routeDecisionArtifactId: readString(packet.routeDecisionArtifactId) } : {}),
        ...(readString(packet.routeDecision) ? { routeDecision: readString(packet.routeDecision) } : {}),
        ...(readString(packet.handoffArtifactId) ? { handoffArtifactId: readString(packet.handoffArtifactId) } : {}),
        ...(readString(packet.handoffArchiveArtifactId) ? { handoffArchiveArtifactId: readString(packet.handoffArchiveArtifactId) } : {}),
        relatedArtifactIds: readStringList(packet.relatedArtifactIds),
        summary: readString(packet.summary) || 'review packet preset',
      },
      policy: {
        effect: 'save-local-preset-artifact-only',
        documentsChanged: false,
        modelRouteChanged: false,
        handoffArchiveCreated: false,
      },
    };
  } catch {
    return null;
  }
}

function sourceArtifactId(packet: ReviewPacketPresetPacket): string {
  return packet.revealedJudgmentArtifactId
    || packet.judgmentArtifactId
    || packet.comparisonArtifactId
    || packet.documentExportArtifactId
    || '';
}

function formatPacketLines(packet: ReviewPacketPresetPacket): readonly string[] {
  return [
    `  summary ${packet.summary}`,
    packet.documentId ? `  document ${packet.documentId}${packet.documentTitle ? ` (${packet.documentTitle})` : ''}` : '',
    packet.documentExportArtifactId ? `  documentExport ${packet.documentExportArtifactId}` : '',
    packet.comparisonArtifactId ? `  comparison ${packet.comparisonArtifactId}` : '',
    packet.judgmentArtifactId ? `  judgment ${packet.judgmentArtifactId}` : '',
    packet.revealedJudgmentArtifactId ? `  revealedJudgment ${packet.revealedJudgmentArtifactId}` : '',
    packet.routeDecisionArtifactId ? `  routeDecision ${packet.routeDecisionArtifactId}${packet.routeDecision ? ` (${packet.routeDecision})` : ''}` : '',
    packet.handoffArtifactId ? `  handoff ${packet.handoffArtifactId}` : '',
    packet.handoffArchiveArtifactId ? `  handoffArchive ${packet.handoffArchiveArtifactId}` : '',
    `  related ${packet.relatedArtifactIds.length > 0 ? packet.relatedArtifactIds.join(', ') : '(none)'}`,
  ].filter(Boolean);
}

function formatPresetPreview(record: ReviewPacketPresetRecord): string {
  return [
    'Agent review packet preset preview',
    `  name ${record.name}`,
    `  preset ${record.presetId}`,
    ...formatPacketLines(record.packet),
    '  policy save one local preset artifact only; documents, model routing, handoffs, and archives are unchanged',
  ].join('\n');
}

function formatSaveResult(descriptor: ArtifactDescriptor, record: ReviewPacketPresetRecord): string {
  return [
    'Review packet preset saved',
    `  artifact ${descriptor.id}`,
    `  preset ${record.presetId}`,
    `  name ${record.name}`,
    ...formatPacketLines(record.packet),
    `  inspect agent_review_packet_presets mode:"show" artifactId:"${descriptor.id}"`,
    '  list agent_review_packet_presets mode:"list"',
    '  policy local preset artifact only; documents, model routing, handoffs, and archives unchanged',
  ].join('\n');
}

function formatList(artifacts: readonly ArtifactDescriptor[], total: number): string {
  if (artifacts.length === 0) {
    return [
      'Saved review packet presets',
      '  none found',
      '  save agent_review_packet_presets mode:"save" name:"..." confirm:true explicitUserRequest:"..."',
    ].join('\n');
  }
  return [
    'Saved review packet presets',
    `  shown ${artifacts.length}/${total}`,
    ...artifacts.flatMap((artifact) => {
      const packet = packetFromMetadata(artifact);
      const name = readMetadataString(artifact.metadata, 'name') || artifact.filename || artifact.id;
      const source = sourceArtifactId(packet) || '(no source)';
      return [
        `  - ${artifact.id}: ${name}`,
        `    summary ${compactText(packet.summary, 120)}`,
        `    document ${packet.documentId ?? '(none)'}; source ${source}; handoff ${packet.handoffArtifactId ?? '(none)'}; archive ${packet.handoffArchiveArtifactId ?? '(none)'}; related ${packet.relatedArtifactIds.length}`,
        `    inspect agent_review_packet_presets mode:"show" artifactId:"${artifact.id}"`,
      ];
    }),
  ].join('\n');
}

function formatShow(loaded: LoadedReviewPacketPreset): string {
  const packet = loaded.body?.packet ?? packetFromMetadata(loaded.descriptor);
  const name = loaded.body?.name || readMetadataString(loaded.descriptor.metadata, 'name') || loaded.descriptor.filename || loaded.descriptor.id;
  const presetId = loaded.body?.presetId || readMetadataString(loaded.descriptor.metadata, 'presetId') || loaded.descriptor.id;
  const sourceId = sourceArtifactId(packet);
  const related = JSON.stringify(packet.relatedArtifactIds);
  return [
    'Saved review packet preset',
    `  artifact ${loaded.descriptor.id}`,
    `  preset ${presetId}`,
    `  name ${name}`,
    ...formatPacketLines(packet),
    loaded.body?.explicitUserRequest ? `  explicitUserRequest ${compactText(loaded.body.explicitUserRequest, 140)}` : '',
    sourceId ? `  sideBySide agent_model_compare mode:"sideBySide" artifactId:"${sourceId}" relatedArtifactIds:${related}` : '',
    sourceId ? `  handoff agent_model_compare mode:"handoff" artifactId:"${sourceId}" relatedArtifactIds:${related} confirm:true explicitUserRequest:"..."` : '',
    packet.revealedJudgmentArtifactId ? `  routeDecision agent_model_compare mode:"routeDecision" artifactId:"${packet.revealedJudgmentArtifactId}" decision:"left-unchanged" confirm:true explicitUserRequest:"..."` : '',
    packet.handoffArtifactId ? `  archive agent_model_compare mode:"handoffArchive" artifactId:"${packet.handoffArtifactId}" confirm:true explicitUserRequest:"..."` : '',
    packet.handoffArchiveArtifactId ? `  inspectArchive agent_artifacts mode:"show" artifactId:"${packet.handoffArchiveArtifactId}"` : '',
    '  policy read-only inspection; reuse routes still require explicit confirmation where shown',
  ].filter(Boolean).join('\n');
}

async function loadPresetArtifact(
  store: AgentReviewPacketPresetArtifactStore,
  artifactId: string,
): Promise<LoadedReviewPacketPreset | null> {
  if (store.readContent) {
    const { record, buffer } = await store.readContent(artifactId);
    if (!isPresetArtifact(record)) return null;
    return { descriptor: record, record, body: parsePresetBody(buffer) ?? undefined };
  }
  const descriptor = store.list?.(200).find((artifact) => artifact.id === artifactId) ?? null;
  if (!descriptor || !isPresetArtifact(descriptor)) return null;
  return { descriptor };
}

export function createAgentReviewPacketPresetsTool(
  artifactStore?: AgentReviewPacketPresetArtifactStore,
): Tool {
  return {
    definition: {
      name: 'agent_review_packet_presets',
      description: 'Save and inspect reusable Document Ops review packet presets.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['list', 'show', 'save'],
            description: 'List, show, or save one review packet preset.',
          },
          artifactId: {
            type: 'string',
            description: 'Saved preset artifact id for show mode.',
          },
          name: {
            type: 'string',
            description: 'Human-friendly preset name for save mode.',
          },
          documentId: {
            type: 'string',
            description: 'Agent document draft id captured by the preset.',
          },
          documentTitle: {
            type: 'string',
            description: 'Optional document title captured by the preset.',
          },
          documentExportArtifactId: {
            type: 'string',
            description: 'Exported document evidence artifact id.',
          },
          comparisonArtifactId: {
            type: 'string',
            description: 'Saved blind comparison artifact id.',
          },
          judgmentArtifactId: {
            type: 'string',
            description: 'Saved comparison judgment artifact id.',
          },
          revealedJudgmentArtifactId: {
            type: 'string',
            description: 'Revealed judgment artifact id for route decisions.',
          },
          routeDecisionArtifactId: {
            type: 'string',
            description: 'Saved route-decision receipt artifact id.',
          },
          routeDecision: {
            type: 'string',
            description: 'Route decision label such as left-unchanged.',
          },
          handoffArtifactId: {
            type: 'string',
            description: 'Reviewer handoff artifact id.',
          },
          handoffArchiveArtifactId: {
            type: 'string',
            description: 'Final reviewer handoff ZIP artifact id.',
          },
          relatedArtifactIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Related evidence artifact ids to reuse.',
          },
          summary: {
            type: 'string',
            description: 'Short preset summary.',
          },
          limit: {
            type: 'number',
            description: 'Maximum presets to list.',
          },
          confirm: {
            type: 'boolean',
            description: 'Required true for save mode.',
          },
          explicitUserRequest: {
            type: 'string',
            description: 'User request authorizing preset save.',
          },
        },
        required: ['mode'],
        additionalProperties: false,
      },
      sideEffects: ['state'],
      concurrency: 'serial',
    },
    execute: async (rawArgs: Record<string, unknown>) => {
      const args = rawArgs as AgentReviewPacketPresetsToolArgs;
      try {
        const mode = parseMode(args.mode);
        if (mode === 'list') {
          if (!artifactStore?.list) return failure('Review packet preset list is unavailable because this runtime cannot list artifacts.');
          const limit = clamp(readNumber(args.limit, DEFAULT_LIST_LIMIT), 1, MAX_LIST_LIMIT);
          const source = artifactStore.list(Math.max(limit * 4, limit)).filter(isPresetArtifact);
          const ordered = source.sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
          return output(formatList(ordered.slice(0, limit), source.length));
        }
        if (mode === 'show') {
          const artifactId = readString(args.artifactId);
          if (!artifactId) return failure('artifactId is required for mode:"show".');
          if (!artifactStore?.readContent && !artifactStore?.list) return failure('Review packet preset show is unavailable because this runtime cannot read or list artifacts.');
          const loaded = await loadPresetArtifact(artifactStore, artifactId);
          if (!loaded) return failure(`Unknown review packet preset artifact ${artifactId}. Use agent_review_packet_presets mode:"list" first.`);
          return output(formatShow(loaded));
        }
        if (!artifactStore?.create) return failure('Review packet preset save is unavailable because this runtime did not provide an artifact store.');
        const record = buildPresetRecord(args);
        if (!readBoolean(args.confirm)) {
          return failure([
            formatPresetPreview(record),
            '',
            'Preset confirmation required. Call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to save this reviewer packet preset.',
          ].join('\n'));
        }
        const descriptor = await artifactStore.create(presetCreateInput(record));
        return output(formatSaveResult(descriptor, record));
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

function output(text: string): { readonly success: true; readonly output: string } {
  return { success: true, output: text };
}

function failure(error: string): { readonly success: false; readonly error: string } {
  return { success: false, error };
}

export function registerAgentReviewPacketPresetsTool(
  registry: ToolRegistry,
  artifactStore?: AgentReviewPacketPresetArtifactStore,
): void {
  registry.register(createAgentReviewPacketPresetsTool(artifactStore));
}
