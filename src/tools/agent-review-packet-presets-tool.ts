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

type AgentReviewPacketPresetArtifactStore = Pick<ArtifactStore, 'create'> & Partial<Pick<ArtifactStore, 'get' | 'list' | 'readContent'>>;

type AgentReviewPacketPresetMode = 'list' | 'show' | 'save' | 'refresh';
type ReviewPacketArtifactRole =
  | 'documentExport'
  | 'comparison'
  | 'judgment'
  | 'revealedJudgment'
  | 'routeDecision'
  | 'handoff'
  | 'handoffArchive'
  | 'related';

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
  readonly refresh?: {
    readonly sourceArtifactId: string;
    readonly sourcePresetId?: string;
    readonly missingCount: number;
    readonly supersededCount: number;
    readonly unresolvedCount: number;
  };
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

interface ReviewPacketArtifactReference {
  readonly role: ReviewPacketArtifactRole;
  readonly label: string;
  readonly id: string;
}

interface ReviewPacketFreshnessMissing {
  readonly role: ReviewPacketArtifactRole;
  readonly label: string;
  readonly id: string;
  readonly replacementId?: string;
  readonly reason?: string;
}

interface ReviewPacketFreshnessSuperseded {
  readonly role: ReviewPacketArtifactRole;
  readonly label: string;
  readonly id: string;
  readonly replacementId: string;
  readonly reason: string;
}

interface ReviewPacketFreshnessAudit {
  readonly available: boolean;
  readonly scannedArtifacts: number;
  readonly status: 'current' | 'needs-review' | 'unchecked';
  readonly missing: readonly ReviewPacketFreshnessMissing[];
  readonly superseded: readonly ReviewPacketFreshnessSuperseded[];
  readonly recommendedPacket: ReviewPacketPresetPacket;
}

const REVIEW_PACKET_PRESET_PURPOSE = 'agent-review-packet-preset';
const REVIEW_PACKET_PRESET_SCHEMA = 'goodvibes-agent.review-packet-preset';
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const MAX_RELATED_ARTIFACTS = 30;
const MAX_FRESHNESS_ARTIFACT_SCAN = 500;
const PURPOSE_DOCUMENT_EXPORT = 'agent-document-export';
const PURPOSE_MODEL_COMPARE = 'agent-model-compare';
const PURPOSE_MODEL_COMPARE_JUDGMENT = 'agent-model-compare-judgment';
const PURPOSE_MODEL_COMPARE_ROUTE_DECISION = 'agent-model-compare-route-decision';
const PURPOSE_MODEL_COMPARE_HANDOFF = 'agent-model-compare-handoff';
const PURPOSE_MODEL_COMPARE_HANDOFF_ARCHIVE = 'agent-model-compare-handoff-archive';

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
  if (mode === 'refresh' || mode === 'update') return 'refresh';
  throw new Error(`Unknown agent_review_packet_presets mode: ${mode}. Use mode:"list", mode:"show", mode:"save", or mode:"refresh".`);
}

function defaultPacketSummary(input: {
  readonly documentId?: string;
  readonly documentExportArtifactId?: string;
  readonly comparisonArtifactId?: string;
  readonly judgmentArtifactId?: string;
  readonly revealedJudgmentArtifactId?: string;
  readonly handoffArtifactId?: string;
  readonly handoffArchiveArtifactId?: string;
  readonly relatedArtifactIds?: readonly string[];
}): string {
  const sourceArtifactId = input.revealedJudgmentArtifactId
    || input.judgmentArtifactId
    || input.comparisonArtifactId
    || input.documentExportArtifactId;
  const relatedArtifactIds = input.relatedArtifactIds ?? [];
  return [
    input.documentId ? `document ${input.documentId}` : '',
    sourceArtifactId ? `source ${sourceArtifactId}` : '',
    input.handoffArtifactId ? `handoff ${input.handoffArtifactId}` : '',
    input.handoffArchiveArtifactId ? `archive ${input.handoffArchiveArtifactId}` : '',
    relatedArtifactIds.length > 0 ? `${relatedArtifactIds.length} related` : '',
  ].filter(Boolean).join('; ') || 'review packet preset';
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
  const summary = explicitSummary || defaultPacketSummary({
    documentId,
    documentExportArtifactId,
    comparisonArtifactId,
    judgmentArtifactId,
    revealedJudgmentArtifactId,
    handoffArtifactId,
    handoffArchiveArtifactId,
    relatedArtifactIds,
  });

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
    refreshOfArtifactId: metadataValue(record.refresh?.sourceArtifactId),
    refreshOfPresetId: metadataValue(record.refresh?.sourcePresetId),
    freshnessMissingCount: record.refresh?.missingCount,
    freshnessSupersededCount: record.refresh?.supersededCount,
    freshnessUnresolvedCount: record.refresh?.unresolvedCount,
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

function artifactPurpose(artifact: ArtifactDescriptor): string {
  return readMetadataString(artifact.metadata, 'purpose');
}

function hasPurpose(artifact: ArtifactDescriptor, purpose: string): boolean {
  return artifactPurpose(artifact) === purpose;
}

function isRevealedJudgmentArtifact(artifact: ArtifactDescriptor): boolean {
  return hasPurpose(artifact, PURPOSE_MODEL_COMPARE_JUDGMENT)
    && artifact.metadata.revealIncludedInJudgment === true
    && readMetadataString(artifact.metadata, 'winnerModel').length > 0;
}

function artifactIndex(artifacts: readonly ArtifactDescriptor[]): Map<string, ArtifactDescriptor> {
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]));
}

function artifactFromIndex(
  store: AgentReviewPacketPresetArtifactStore | undefined,
  index: ReadonlyMap<string, ArtifactDescriptor>,
  id: string | undefined,
): ArtifactDescriptor | null {
  if (!id) return null;
  const indexed = index.get(id);
  if (indexed) return indexed;
  try {
    return store?.get?.(id) ?? null;
  } catch {
    return null;
  }
}

function latestArtifact(
  artifacts: readonly ArtifactDescriptor[],
  predicate: (artifact: ArtifactDescriptor) => boolean,
): ArtifactDescriptor | null {
  return artifacts
    .filter(predicate)
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))[0] ?? null;
}

function firstMetadataString(
  store: AgentReviewPacketPresetArtifactStore | undefined,
  index: ReadonlyMap<string, ArtifactDescriptor>,
  ids: readonly (string | undefined)[],
  keys: readonly string[],
): string {
  for (const id of ids) {
    const artifact = artifactFromIndex(store, index, id);
    if (!artifact) continue;
    for (const key of keys) {
      const value = readMetadataString(artifact.metadata, key);
      if (value) return value;
    }
  }
  return '';
}

function packetDocumentId(
  packet: ReviewPacketPresetPacket,
  store: AgentReviewPacketPresetArtifactStore | undefined,
  index: ReadonlyMap<string, ArtifactDescriptor>,
): string {
  return packet.documentId
    || firstMetadataString(store, index, [
      packet.documentExportArtifactId,
      packet.comparisonArtifactId,
      packet.judgmentArtifactId,
      packet.revealedJudgmentArtifactId,
      packet.routeDecisionArtifactId,
      packet.handoffArtifactId,
      packet.handoffArchiveArtifactId,
    ], ['documentId', 'sourceDocumentId']);
}

function packetComparisonId(
  packet: ReviewPacketPresetPacket,
  store: AgentReviewPacketPresetArtifactStore | undefined,
  index: ReadonlyMap<string, ArtifactDescriptor>,
): string {
  return firstMetadataString(store, index, [
    packet.routeDecisionArtifactId,
    packet.handoffArchiveArtifactId,
    packet.handoffArtifactId,
    packet.revealedJudgmentArtifactId,
    packet.judgmentArtifactId,
    packet.comparisonArtifactId,
  ], ['comparisonId']);
}

function packetRunSourceArtifactId(
  packet: ReviewPacketPresetPacket,
  store: AgentReviewPacketPresetArtifactStore | undefined,
  index: ReadonlyMap<string, ArtifactDescriptor>,
): string {
  return firstMetadataString(store, index, [
    packet.comparisonArtifactId,
    packet.judgmentArtifactId,
    packet.revealedJudgmentArtifactId,
    packet.handoffArtifactId,
    packet.handoffArchiveArtifactId,
  ], ['sourceArtifactId']) || packet.documentExportArtifactId || '';
}

function packetJudgmentArtifactId(
  packet: ReviewPacketPresetPacket,
  store: AgentReviewPacketPresetArtifactStore | undefined,
  index: ReadonlyMap<string, ArtifactDescriptor>,
): string {
  return packet.revealedJudgmentArtifactId
    || packet.judgmentArtifactId
    || firstMetadataString(store, index, [packet.routeDecisionArtifactId], ['judgmentArtifactId']);
}

function packetHandoffSourceArtifactId(packet: ReviewPacketPresetPacket): string {
  return sourceArtifactId(packet);
}

function freshnessReferences(packet: ReviewPacketPresetPacket): readonly ReviewPacketArtifactReference[] {
  const references: ReviewPacketArtifactReference[] = [];
  const add = (role: ReviewPacketArtifactRole, label: string, id: string | undefined): void => {
    if (id) references.push({ role, label, id });
  };
  add('documentExport', 'document export', packet.documentExportArtifactId);
  add('comparison', 'comparison', packet.comparisonArtifactId);
  add('judgment', 'judgment', packet.judgmentArtifactId);
  add('revealedJudgment', 'revealed judgment', packet.revealedJudgmentArtifactId);
  add('routeDecision', 'route decision', packet.routeDecisionArtifactId);
  add('handoff', 'reviewer handoff', packet.handoffArtifactId);
  add('handoffArchive', 'handoff archive', packet.handoffArchiveArtifactId);
  for (const id of packet.relatedArtifactIds) add('related', 'related artifact', id);
  return references;
}

function replacementForRole(input: {
  readonly role: ReviewPacketArtifactRole;
  readonly packet: ReviewPacketPresetPacket;
  readonly current: ArtifactDescriptor | null;
  readonly artifacts: readonly ArtifactDescriptor[];
  readonly store?: AgentReviewPacketPresetArtifactStore;
  readonly index: ReadonlyMap<string, ArtifactDescriptor>;
}): { readonly artifact: ArtifactDescriptor; readonly reason: string } | null {
  const documentId = packetDocumentId(input.packet, input.store, input.index);
  const comparisonId = packetComparisonId(input.packet, input.store, input.index);
  const runSourceArtifactId = packetRunSourceArtifactId(input.packet, input.store, input.index);
  const judgmentArtifactId = packetJudgmentArtifactId(input.packet, input.store, input.index);
  const handoffSourceArtifactId = packetHandoffSourceArtifactId(input.packet);
  const handoffArtifactId = input.packet.handoffArtifactId
    || firstMetadataString(input.store, input.index, [input.packet.handoffArchiveArtifactId], ['handoffArtifactId']);

  const currentCreatedAt = input.current?.createdAt ?? -1;
  const newest = (predicate: (artifact: ArtifactDescriptor) => boolean): ArtifactDescriptor | null => {
    const candidate = latestArtifact(input.artifacts, (artifact) => (
      artifact.id !== input.current?.id
      && artifact.createdAt > currentCreatedAt
      && predicate(artifact)
    ));
    return candidate;
  };

  if (input.role === 'documentExport') {
    if (!documentId) return null;
    const artifact = newest((candidate) => (
      hasPurpose(candidate, PURPOSE_DOCUMENT_EXPORT)
      && readMetadataString(candidate.metadata, 'documentId') === documentId
    ));
    return artifact ? { artifact, reason: `newer document export for ${documentId}` } : null;
  }

  if (input.role === 'comparison') {
    const artifact = newest((candidate) => {
      if (!hasPurpose(candidate, PURPOSE_MODEL_COMPARE)) return false;
      if (documentId && readMetadataString(candidate.metadata, 'documentId') === documentId) return true;
      return Boolean(runSourceArtifactId && readMetadataString(candidate.metadata, 'sourceArtifactId') === runSourceArtifactId);
    });
    return artifact ? { artifact, reason: documentId ? `newer comparison for ${documentId}` : `newer comparison for source ${runSourceArtifactId}` } : null;
  }

  if (input.role === 'judgment' || input.role === 'revealedJudgment') {
    const artifact = newest((candidate) => {
      if (!hasPurpose(candidate, PURPOSE_MODEL_COMPARE_JUDGMENT)) return false;
      if (input.role === 'revealedJudgment' && !isRevealedJudgmentArtifact(candidate)) return false;
      if (comparisonId && readMetadataString(candidate.metadata, 'comparisonId') === comparisonId) return true;
      if (documentId && readMetadataString(candidate.metadata, 'documentId') === documentId) return true;
      return Boolean(runSourceArtifactId && readMetadataString(candidate.metadata, 'sourceArtifactId') === runSourceArtifactId);
    });
    return artifact ? { artifact, reason: comparisonId ? `newer judgment for ${comparisonId}` : 'newer matching judgment' } : null;
  }

  if (input.role === 'routeDecision') {
    const artifact = newest((candidate) => (
      hasPurpose(candidate, PURPOSE_MODEL_COMPARE_ROUTE_DECISION)
      && (
        Boolean(judgmentArtifactId && readMetadataString(candidate.metadata, 'judgmentArtifactId') === judgmentArtifactId)
        || Boolean(comparisonId && readMetadataString(candidate.metadata, 'comparisonId') === comparisonId)
      )
    ));
    return artifact ? { artifact, reason: comparisonId ? `newer route decision for ${comparisonId}` : 'newer route decision for judgment' } : null;
  }

  if (input.role === 'handoff') {
    const artifact = newest((candidate) => (
      hasPurpose(candidate, PURPOSE_MODEL_COMPARE_HANDOFF)
      && (
        Boolean(handoffSourceArtifactId && readMetadataString(candidate.metadata, 'sourceArtifactId') === handoffSourceArtifactId)
        || Boolean(comparisonId && readMetadataString(candidate.metadata, 'comparisonId') === comparisonId)
      )
    ));
    return artifact ? { artifact, reason: comparisonId ? `newer reviewer handoff for ${comparisonId}` : `newer reviewer handoff for source ${handoffSourceArtifactId}` } : null;
  }

  if (input.role === 'handoffArchive') {
    const artifact = newest((candidate) => (
      hasPurpose(candidate, PURPOSE_MODEL_COMPARE_HANDOFF_ARCHIVE)
      && (
        Boolean(handoffArtifactId && readMetadataString(candidate.metadata, 'handoffArtifactId') === handoffArtifactId)
        || Boolean(comparisonId && readMetadataString(candidate.metadata, 'comparisonId') === comparisonId)
      )
    ));
    return artifact ? { artifact, reason: comparisonId ? `newer handoff archive for ${comparisonId}` : 'newer handoff archive for handoff' } : null;
  }

  return null;
}

function applyFreshnessReplacements(
  packet: ReviewPacketPresetPacket,
  replacements: ReadonlyMap<string, string>,
  roleReplacements: ReadonlyMap<ReviewPacketArtifactRole, string>,
): ReviewPacketPresetPacket {
  const replace = (value: string | undefined, role: ReviewPacketArtifactRole): string | undefined => {
    if (!value) return undefined;
    return roleReplacements.get(role) ?? replacements.get(value) ?? value;
  };
  const relatedArtifactIds = readStringList(packet.relatedArtifactIds.map((id) => replacements.get(id) ?? id));
  return {
    ...packet,
    ...(replace(packet.documentExportArtifactId, 'documentExport') ? { documentExportArtifactId: replace(packet.documentExportArtifactId, 'documentExport') } : {}),
    ...(replace(packet.comparisonArtifactId, 'comparison') ? { comparisonArtifactId: replace(packet.comparisonArtifactId, 'comparison') } : {}),
    ...(replace(packet.judgmentArtifactId, 'judgment') ? { judgmentArtifactId: replace(packet.judgmentArtifactId, 'judgment') } : {}),
    ...(replace(packet.revealedJudgmentArtifactId, 'revealedJudgment') ? { revealedJudgmentArtifactId: replace(packet.revealedJudgmentArtifactId, 'revealedJudgment') } : {}),
    ...(replace(packet.routeDecisionArtifactId, 'routeDecision') ? { routeDecisionArtifactId: replace(packet.routeDecisionArtifactId, 'routeDecision') } : {}),
    ...(replace(packet.handoffArtifactId, 'handoff') ? { handoffArtifactId: replace(packet.handoffArtifactId, 'handoff') } : {}),
    ...(replace(packet.handoffArchiveArtifactId, 'handoffArchive') ? { handoffArchiveArtifactId: replace(packet.handoffArchiveArtifactId, 'handoffArchive') } : {}),
    relatedArtifactIds,
  };
}

function auditPresetFreshness(input: {
  readonly packet: ReviewPacketPresetPacket;
  readonly descriptor: ArtifactDescriptor;
  readonly artifacts: readonly ArtifactDescriptor[] | null;
  readonly store?: AgentReviewPacketPresetArtifactStore;
}): ReviewPacketFreshnessAudit {
  if (!input.artifacts) {
    return {
      available: false,
      scannedArtifacts: 0,
      status: 'unchecked',
      missing: [],
      superseded: [],
      recommendedPacket: input.packet,
    };
  }
  const allArtifacts = input.artifacts.some((artifact) => artifact.id === input.descriptor.id)
    ? input.artifacts
    : [input.descriptor, ...input.artifacts];
  const index = artifactIndex(allArtifacts);
  const missing: ReviewPacketFreshnessMissing[] = [];
  const superseded: ReviewPacketFreshnessSuperseded[] = [];
  const replacements = new Map<string, string>();
  const roleReplacements = new Map<ReviewPacketArtifactRole, string>();
  const seenReferences = new Set<string>();

  for (const reference of freshnessReferences(input.packet)) {
    const key = `${reference.role}:${reference.id}`;
    if (seenReferences.has(key)) continue;
    seenReferences.add(key);
    const current = artifactFromIndex(input.store, index, reference.id);
    const replacement = reference.role === 'related'
      ? null
      : replacementForRole({
        role: reference.role,
        packet: input.packet,
        current,
        artifacts: allArtifacts,
        store: input.store,
        index,
      });
    if (!current) {
      missing.push({
        role: reference.role,
        label: reference.label,
        id: reference.id,
        ...(replacement ? { replacementId: replacement.artifact.id, reason: replacement.reason } : {}),
      });
      if (replacement) {
        replacements.set(reference.id, replacement.artifact.id);
        roleReplacements.set(reference.role, replacement.artifact.id);
      }
      continue;
    }
    if (replacement) {
      superseded.push({
        role: reference.role,
        label: reference.label,
        id: reference.id,
        replacementId: replacement.artifact.id,
        reason: replacement.reason,
      });
      replacements.set(reference.id, replacement.artifact.id);
      roleReplacements.set(reference.role, replacement.artifact.id);
    }
  }

  return {
    available: true,
    scannedArtifacts: allArtifacts.length,
    status: missing.length > 0 || superseded.length > 0 ? 'needs-review' : 'current',
    missing,
    superseded,
    recommendedPacket: applyFreshnessReplacements(input.packet, replacements, roleReplacements),
  };
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
    const refresh = parsed.refresh && typeof parsed.refresh === 'object'
      ? parsed.refresh as Record<string, unknown>
      : null;
    return {
      schema: REVIEW_PACKET_PRESET_SCHEMA,
      schemaVersion: 1,
      presetId: readString(parsed.presetId),
      name: readString(parsed.name) || 'Reviewer packet preset',
      createdAt: readString(parsed.createdAt),
      explicitUserRequest: readString(parsed.explicitUserRequest),
      ...(refresh
        ? {
          refresh: {
            sourceArtifactId: readString(refresh.sourceArtifactId),
            ...(readString(refresh.sourcePresetId)
              ? { sourcePresetId: readString(refresh.sourcePresetId) }
              : {}),
            missingCount: readNumber(refresh.missingCount, 0),
            supersededCount: readNumber(refresh.supersededCount, 0),
            unresolvedCount: readNumber(refresh.unresolvedCount, 0),
          },
        }
        : {}),
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

function packetReferenceFingerprint(packet: ReviewPacketPresetPacket): string {
  return JSON.stringify({
    documentId: packet.documentId ?? '',
    documentTitle: packet.documentTitle ?? '',
    documentExportArtifactId: packet.documentExportArtifactId ?? '',
    comparisonArtifactId: packet.comparisonArtifactId ?? '',
    judgmentArtifactId: packet.judgmentArtifactId ?? '',
    revealedJudgmentArtifactId: packet.revealedJudgmentArtifactId ?? '',
    routeDecisionArtifactId: packet.routeDecisionArtifactId ?? '',
    routeDecision: packet.routeDecision ?? '',
    handoffArtifactId: packet.handoffArtifactId ?? '',
    handoffArchiveArtifactId: packet.handoffArchiveArtifactId ?? '',
    relatedArtifactIds: packet.relatedArtifactIds,
  });
}

function hasRefreshableReplacements(audit: ReviewPacketFreshnessAudit): boolean {
  return audit.missing.some((missing) => Boolean(missing.replacementId)) || audit.superseded.length > 0;
}

function unresolvedFreshnessCount(audit: ReviewPacketFreshnessAudit): number {
  return audit.missing.filter((missing) => !missing.replacementId).length;
}

function updateSummaryReferences(summary: string, audit: ReviewPacketFreshnessAudit): string {
  let updated = summary;
  const replace = (from: string, to: string | undefined): void => {
    if (!to || !from || from === to) return;
    updated = updated.split(from).join(to);
  };
  for (const missing of audit.missing) replace(missing.id, missing.replacementId);
  for (const superseded of audit.superseded) replace(superseded.id, superseded.replacementId);
  return updated.trim();
}

function refreshedPacket(
  original: ReviewPacketPresetPacket,
  audit: ReviewPacketFreshnessAudit,
  explicitSummary: string,
): ReviewPacketPresetPacket {
  const recommended = audit.recommendedPacket;
  const summary = explicitSummary
    || updateSummaryReferences(original.summary, audit)
    || defaultPacketSummary(recommended);
  return { ...recommended, summary };
}

function buildRefreshRecord(input: {
  readonly args: AgentReviewPacketPresetsToolArgs;
  readonly loaded: LoadedReviewPacketPreset;
  readonly audit: ReviewPacketFreshnessAudit;
  readonly packet: ReviewPacketPresetPacket;
}): ReviewPacketPresetRecord {
  const explicitUserRequest = readString(input.args.explicitUserRequest);
  if (!explicitUserRequest) {
    throw new Error('explicitUserRequest is required so refreshed packet presets stay tied to a direct user request.');
  }
  const oldName = input.loaded.body?.name
    || readMetadataString(input.loaded.descriptor.metadata, 'name')
    || input.loaded.descriptor.filename
    || input.loaded.descriptor.id;
  const oldPresetId = input.loaded.body?.presetId || readMetadataString(input.loaded.descriptor.metadata, 'presetId');
  const requestedName = readString(input.args.name);
  return {
    schema: REVIEW_PACKET_PRESET_SCHEMA,
    schemaVersion: 1,
    presetId: `packet_preset_${randomUUID()}`,
    name: requestedName || `${oldName} refreshed`,
    createdAt: new Date().toISOString(),
    explicitUserRequest,
    packet: refreshedPacket(input.packet, input.audit, readString(input.args.summary)),
    refresh: {
      sourceArtifactId: input.loaded.descriptor.id,
      ...(oldPresetId ? { sourcePresetId: oldPresetId } : {}),
      missingCount: input.audit.missing.length,
      supersededCount: input.audit.superseded.length,
      unresolvedCount: unresolvedFreshnessCount(input.audit),
    },
    policy: {
      effect: 'save-local-preset-artifact-only',
      documentsChanged: false,
      modelRouteChanged: false,
      handoffArchiveCreated: false,
    },
  };
}

function formatRefreshPreview(
  source: LoadedReviewPacketPreset,
  audit: ReviewPacketFreshnessAudit,
  record: ReviewPacketPresetRecord,
): string {
  return [
    'Agent review packet preset refresh preview',
    `  refreshOf ${source.descriptor.id}`,
    `  name ${record.name}`,
    ...formatFreshnessLines(audit),
    '  refreshed packet',
    ...formatPacketLines(record.packet),
    '  policy save one new local preset artifact only; source preset, documents, model routing, handoffs, and archives are unchanged',
  ].join('\n');
}

function formatRefreshResult(
  descriptor: ArtifactDescriptor,
  source: LoadedReviewPacketPreset,
  audit: ReviewPacketFreshnessAudit,
  record: ReviewPacketPresetRecord,
): string {
  return [
    'Review packet preset refreshed',
    `  artifact ${descriptor.id}`,
    `  refreshedFrom ${source.descriptor.id}`,
    `  preset ${record.presetId}`,
    `  name ${record.name}`,
    ...formatPacketLines(record.packet),
    `  freshness repaired ${audit.missing.filter((missing) => Boolean(missing.replacementId)).length + audit.superseded.length}; unresolved ${unresolvedFreshnessCount(audit)}`,
    `  inspect agent_review_packet_presets mode:"show" artifactId:"${descriptor.id}"`,
    '  policy local preset artifact only; source preset, documents, model routing, handoffs, and archives unchanged',
  ].join('\n');
}

function formatAlreadyCurrent(source: LoadedReviewPacketPreset, audit: ReviewPacketFreshnessAudit): string {
  return [
    'Review packet preset already current',
    `  artifact ${source.descriptor.id}`,
    `  ${formatFreshnessSummary(audit)}`,
    '  no new preset artifact created',
    '  policy documents, model routing, handoffs, and archives unchanged',
  ].join('\n');
}

function formatFreshnessSummary(audit: ReviewPacketFreshnessAudit): string {
  if (!audit.available) return 'freshness unchecked; artifact list unavailable';
  if (audit.status === 'current') return `freshness current; checked ${audit.scannedArtifacts} artifact(s)`;
  return `freshness needs-review; missing ${audit.missing.length}; newer ${audit.superseded.length}; checked ${audit.scannedArtifacts} artifact(s)`;
}

function formatFreshnessLines(audit: ReviewPacketFreshnessAudit): readonly string[] {
  if (!audit.available) return ['  freshness unchecked; artifact list unavailable'];
  const lines = [`  ${formatFreshnessSummary(audit)}`];
  for (const missing of audit.missing.slice(0, 8)) {
    lines.push(
      `  missing ${missing.label} ${missing.id}${missing.replacementId ? `; recommended ${missing.replacementId} (${missing.reason ?? 'matching artifact'})` : ''}`,
    );
  }
  for (const superseded of audit.superseded.slice(0, 8)) {
    lines.push(`  newer ${superseded.label} ${superseded.id} -> ${superseded.replacementId} (${superseded.reason})`);
  }
  const shownMissing = Math.min(audit.missing.length, 8);
  const shownSuperseded = Math.min(audit.superseded.length, 8);
  const hidden = Math.max(0, audit.missing.length + audit.superseded.length - shownMissing - shownSuperseded);
  if (hidden > 0) lines.push(`  freshness omitted ${hidden} additional issue(s)`);
  if (audit.status === 'needs-review') {
    lines.push('  policy inspect freshness before reuse; recommended routes below use newer ids when a safe replacement was found');
  }
  return lines;
}

function formatList(
  artifacts: readonly ArtifactDescriptor[],
  total: number,
  allArtifacts: readonly ArtifactDescriptor[] | null,
  store?: AgentReviewPacketPresetArtifactStore,
): string {
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
      const audit = auditPresetFreshness({ packet, descriptor: artifact, artifacts: allArtifacts, store });
      const name = readMetadataString(artifact.metadata, 'name') || artifact.filename || artifact.id;
      const source = sourceArtifactId(packet) || '(no source)';
      return [
        `  - ${artifact.id}: ${name}`,
        `    summary ${compactText(packet.summary, 120)}`,
        `    document ${packet.documentId ?? '(none)'}; source ${source}; handoff ${packet.handoffArtifactId ?? '(none)'}; archive ${packet.handoffArchiveArtifactId ?? '(none)'}; related ${packet.relatedArtifactIds.length}`,
        `    ${formatFreshnessSummary(audit)}`,
        audit.status === 'needs-review' && hasRefreshableReplacements(audit)
          ? `    refresh agent_review_packet_presets mode:"refresh" artifactId:"${artifact.id}" confirm:true explicitUserRequest:"..."`
          : '',
        `    inspect agent_review_packet_presets mode:"show" artifactId:"${artifact.id}"`,
      ].filter(Boolean);
    }),
  ].join('\n');
}

function formatShow(loaded: LoadedReviewPacketPreset, audit: ReviewPacketFreshnessAudit): string {
  const packet = loaded.body?.packet ?? packetFromMetadata(loaded.descriptor);
  const routePacket = audit.recommendedPacket;
  const name = loaded.body?.name || readMetadataString(loaded.descriptor.metadata, 'name') || loaded.descriptor.filename || loaded.descriptor.id;
  const presetId = loaded.body?.presetId || readMetadataString(loaded.descriptor.metadata, 'presetId') || loaded.descriptor.id;
  const sourceId = sourceArtifactId(routePacket);
  const related = JSON.stringify(routePacket.relatedArtifactIds);
  return [
    'Saved review packet preset',
    `  artifact ${loaded.descriptor.id}`,
    `  preset ${presetId}`,
    `  name ${name}`,
    ...formatPacketLines(packet),
    ...formatFreshnessLines(audit),
    loaded.body?.explicitUserRequest ? `  explicitUserRequest ${compactText(loaded.body.explicitUserRequest, 140)}` : '',
    sourceId ? `  sideBySide agent_model_compare mode:"sideBySide" artifactId:"${sourceId}" relatedArtifactIds:${related}` : '',
    sourceId ? `  handoff agent_model_compare mode:"handoff" artifactId:"${sourceId}" relatedArtifactIds:${related} confirm:true explicitUserRequest:"..."` : '',
    routePacket.revealedJudgmentArtifactId ? `  routeDecision agent_model_compare mode:"routeDecision" artifactId:"${routePacket.revealedJudgmentArtifactId}" decision:"left-unchanged" confirm:true explicitUserRequest:"..."` : '',
    routePacket.handoffArtifactId ? `  archive agent_model_compare mode:"handoffArchive" artifactId:"${routePacket.handoffArtifactId}" confirm:true explicitUserRequest:"..."` : '',
    routePacket.handoffArchiveArtifactId ? `  inspectArchive agent_artifacts mode:"show" artifactId:"${routePacket.handoffArchiveArtifactId}"` : '',
    audit.status === 'needs-review' && hasRefreshableReplacements(audit)
      ? `  refreshPreset agent_review_packet_presets mode:"refresh" artifactId:"${loaded.descriptor.id}" confirm:true explicitUserRequest:"..."`
      : '',
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
      description: 'Save and refresh reusable Document Ops packet presets.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['list', 'show', 'save', 'refresh'],
            description: 'List, show, save, or refresh one review packet preset.',
          },
          artifactId: {
            type: 'string',
            description: 'Saved preset artifact id for show or refresh mode.',
          },
          name: {
            type: 'string',
            description: 'Human-friendly preset name for save or refresh mode.',
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
            description: 'Required true for save or refresh mode.',
          },
          explicitUserRequest: {
            type: 'string',
            description: 'User request authorizing preset save or refresh.',
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
          const allArtifacts = artifactStore.list(Math.max(MAX_FRESHNESS_ARTIFACT_SCAN, limit * 4));
          const source = allArtifacts.filter(isPresetArtifact);
          const ordered = source.sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
          return output(formatList(ordered.slice(0, limit), source.length, allArtifacts, artifactStore));
        }
        if (mode === 'show') {
          const artifactId = readString(args.artifactId);
          if (!artifactId) return failure('artifactId is required for mode:"show".');
          if (!artifactStore?.readContent && !artifactStore?.list) return failure('Review packet preset show is unavailable because this runtime cannot read or list artifacts.');
          const loaded = await loadPresetArtifact(artifactStore, artifactId);
          if (!loaded) return failure(`Unknown review packet preset artifact ${artifactId}. Use agent_review_packet_presets mode:"list" first.`);
          const allArtifacts = artifactStore.list?.(MAX_FRESHNESS_ARTIFACT_SCAN) ?? null;
          const packet = loaded.body?.packet ?? packetFromMetadata(loaded.descriptor);
          return output(formatShow(loaded, auditPresetFreshness({
            packet,
            descriptor: loaded.descriptor,
            artifacts: allArtifacts,
            store: artifactStore,
          })));
        }
        if (mode === 'refresh') {
          const artifactId = readString(args.artifactId);
          if (!artifactId) return failure('artifactId is required for mode:"refresh".');
          if (!artifactStore?.create) return failure('Review packet preset refresh is unavailable because this runtime did not provide an artifact store.');
          if (!artifactStore.readContent && !artifactStore.list) return failure('Review packet preset refresh is unavailable because this runtime cannot read or list artifacts.');
          if (!artifactStore.list) return failure('Review packet preset refresh is unavailable because this runtime cannot list artifacts for freshness checks.');
          const loaded = await loadPresetArtifact(artifactStore, artifactId);
          if (!loaded) return failure(`Unknown review packet preset artifact ${artifactId}. Use agent_review_packet_presets mode:"list" first.`);
          const allArtifacts = artifactStore.list(MAX_FRESHNESS_ARTIFACT_SCAN);
          const packet = loaded.body?.packet ?? packetFromMetadata(loaded.descriptor);
          const audit = auditPresetFreshness({
            packet,
            descriptor: loaded.descriptor,
            artifacts: allArtifacts,
            store: artifactStore,
          });
          if (audit.status === 'current') return output(formatAlreadyCurrent(loaded, audit));
          const record = buildRefreshRecord({ args, loaded, audit, packet });
          if (
            !hasRefreshableReplacements(audit)
            || packetReferenceFingerprint(packet) === packetReferenceFingerprint(record.packet)
          ) {
            return failure([
              'Review packet preset refresh could not find a safe replacement to save.',
              ...formatFreshnessLines(audit),
              'Inspect the preset and repair missing evidence manually before saving a new preset.',
            ].join('\n'));
          }
          if (!readBoolean(args.confirm)) {
            return failure([
              formatRefreshPreview(loaded, audit, record),
              '',
              'Refresh confirmation required. Call this tool with confirm:true only when the user explicitly asked GoodVibes Agent to refresh this reviewer packet preset.',
            ].join('\n'));
          }
          const descriptor = await artifactStore.create(presetCreateInput(record));
          return output(formatRefreshResult(descriptor, loaded, audit, record));
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
