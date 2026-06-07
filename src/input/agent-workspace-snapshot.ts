import { basename, sep } from 'node:path';
import { listAvailableSubscriptionProviders } from '@pellux/goodvibes-sdk/platform/config';
import type { ArtifactDescriptor } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { MemoryRecord } from '@pellux/goodvibes-sdk/platform/state';
import type { CommandContext } from './command-registry.ts';
import { AgentNoteRegistry, type AgentNoteRecord } from '../agent/note-registry.ts';
import { AgentDocumentRegistry, type AgentDocumentRecord } from '../agent/document-registry.ts';
import { AgentPersonaRegistry, type AgentPersonaRecord } from '../agent/persona-registry.ts';
import { formatAgentRecordOrigin } from '../agent/record-labels.ts';
import { AgentRoutineRegistry, evaluateAgentRoutineReadiness, type AgentRoutineRecord } from '../agent/routine-registry.ts';
import { AgentResearchRunRegistry, researchRunLogTail } from '../agent/research-run-registry.ts';
import { AgentResearchSourceRegistry } from '../agent/research-source-registry.ts';
import {
  AgentSkillRegistry,
  evaluateAgentSkillBundleReadiness,
  evaluateAgentSkillReadiness,
  formatAgentSkillRequirement,
  type AgentSkillBundleRecord,
  type AgentSkillRecord,
} from '../agent/skill-registry.ts';
import { summarizeAgentBehaviorDiscovery } from '../agent/behavior-discovery-summary.ts';
import { isPromptActiveMemory } from '../agent/memory-prompt.ts';
import { getAgentRuntimeProfilesRoot, listAgentRuntimeProfiles, listAgentRuntimeProfileTemplates, readAgentRuntimeProfileSelection } from '../agent/runtime-profile.ts';
import { RoutineScheduleReceiptStore } from '../agent/routine-schedule-receipts.ts';
import { readSetupWizardCheckpoint } from '../agent/setup-wizard-checkpoint.ts';
import {
  DEFAULT_AGENT_SETUP_WIZARD_CLEAR_CHECKPOINT_ROUTE,
  DEFAULT_AGENT_SETUP_WIZARD_INSPECT_CHECKPOINT_ROUTE,
  DEFAULT_AGENT_SETUP_WIZARD_MARK_CHECKPOINT_ROUTE,
  DEFAULT_AGENT_SETUP_WIZARD_RERUN_SMOKE_ROUTE,
  DEFAULT_AGENT_SETUP_WIZARD_SAVE_SMOKE_ROUTE,
  buildAgentSetupWizard,
  emptyAgentSetupSmokeHistory,
  emptyAgentSetupWizardCheckpoint,
  type AgentSetupWizard,
  type AgentSetupWizardBlockedCheckFrequency,
  type AgentSetupWizardCheckpoint,
  type AgentSetupWizardSmokeHistory,
  type AgentSetupWizardSourceItem,
} from '../agent/setup-wizard.ts';
import { GOODVIBES_AGENT_PAIRING_SURFACE } from '../config/surface.ts';
import { connectedHostOperatorTokenFingerprint, readConnectedHostOperatorToken, type ConnectedHostOperatorToken } from '../runtime/connected-host-auth.ts';
import { buildAgentWorkspaceChannelSetupGuide, buildAgentWorkspaceChannels } from './agent-workspace-channels.ts';
import { getAgentWorkspaceConfigReader } from './agent-workspace-config-reader.ts';
import { buildAgentWorkspaceSetupChecklist, type AgentWorkspaceSetupChecklistItem } from './agent-workspace-setup.ts';
import { buildAgentWorkspaceVoiceMediaReadiness, type AgentWorkspaceVoiceMediaProviderDescriptor } from './agent-workspace-voice-media.ts';
import type {
  AgentWorkspaceLocalLibraryItem,
  AgentWorkspaceRecentReviewerHandoffArtifact,
  AgentWorkspaceResearchRunSummary,
  AgentWorkspaceReviewPacketDefaults,
  AgentWorkspaceReviewPacketPresetLineage,
  AgentWorkspaceReviewPacketTimeline,
  AgentWorkspaceReviewPacketTimelineEvent,
  AgentWorkspaceReviewPacketWizard,
  AgentWorkspaceReviewPacketWizardStep,
  AgentWorkspaceReviewPacketWizardStepStatus,
  AgentWorkspaceReviewerReadinessBadge,
  AgentWorkspaceRoutineScheduleReceiptSummary,
  AgentWorkspaceRuntimeProfileItem,
  AgentWorkspaceRuntimeSnapshot,
  AgentWorkspaceRuntimeStarterTemplateItem,
} from './agent-workspace-types.ts';

function readConfigString(context: CommandContext, key: string, fallback: string): string {
  try {
    const configManager = getAgentWorkspaceConfigReader(context);
    const value = configManager?.get(key);
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
  } catch {
    return fallback;
  }
}

function readConfigNumber(context: CommandContext, key: string, fallback: number): number {
  try {
    const configManager = getAgentWorkspaceConfigReader(context);
    const value = configManager?.get(key);
    const numberValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
  } catch {
    return fallback;
  }
}

function readConfigBoolean(context: CommandContext, key: string, fallback: boolean): boolean {
  try {
    const configManager = getAgentWorkspaceConfigReader(context);
    const value = configManager?.get(key);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function inferActiveRuntimeProfile(homeDirectory: string): string {
  const marker = `${sep}.goodvibes${sep}agent${sep}profile-homes${sep}`;
  return homeDirectory.includes(marker) ? basename(homeDirectory) : '(default home)';
}

function inferRuntimeProfileBaseHome(homeDirectory: string): string {
  const marker = `${sep}.goodvibes${sep}agent${sep}profile-homes${sep}`;
  const markerIndex = homeDirectory.indexOf(marker);
  return markerIndex >= 0 ? homeDirectory.slice(0, markerIndex) : homeDirectory;
}

function summarizePersonaItem(persona: AgentPersonaRecord, activePersonaId: string | null): AgentWorkspaceLocalLibraryItem {
  return {
    id: persona.id,
    name: persona.name,
    description: persona.description,
    reviewState: persona.reviewState,
    source: formatAgentRecordOrigin(persona.source, persona.provenance),
    tags: persona.tags,
    triggers: persona.triggers,
    active: persona.id === activePersonaId,
  };
}

function summarizeSkillItem(skill: AgentSkillRecord): AgentWorkspaceLocalLibraryItem {
  const readiness = evaluateAgentSkillReadiness(skill);
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    reviewState: skill.reviewState,
    source: formatAgentRecordOrigin(skill.source, skill.provenance),
    tags: skill.tags,
    triggers: skill.triggers,
    enabled: skill.enabled,
    requirementCount: skill.requirements.length,
    missingRequirementCount: readiness.missing.length,
    missingRequirements: readiness.missing.map(formatAgentSkillRequirement),
  };
}

function summarizeSkillBundleItem(bundle: AgentSkillBundleRecord, skills: readonly AgentSkillRecord[]): AgentWorkspaceLocalLibraryItem {
  const readiness = evaluateAgentSkillBundleReadiness(bundle, skills);
  const missing = [
    ...readiness.missingRequirements.map(formatAgentSkillRequirement),
    ...readiness.missingSkillIds.map((skillId) => `skill:${skillId}`),
  ];
  return {
    id: bundle.id,
    name: bundle.name,
    description: `${bundle.description} Skills: ${bundle.skillIds.join(', ')}`,
    reviewState: bundle.reviewState,
    source: formatAgentRecordOrigin(bundle.source, bundle.provenance),
    tags: bundle.skillIds,
    triggers: [],
    enabled: bundle.enabled,
    requirementCount: readiness.includedSkills.reduce((total, skill) => total + skill.requirements.length, 0) + readiness.missingSkillIds.length,
    missingRequirementCount: missing.length,
    missingRequirements: missing,
  };
}

function summarizeRoutineItem(routine: AgentRoutineRecord): AgentWorkspaceLocalLibraryItem {
  const readiness = evaluateAgentRoutineReadiness(routine);
  return {
    id: routine.id,
    name: routine.name,
    description: routine.description,
    reviewState: routine.reviewState,
    source: formatAgentRecordOrigin(routine.source, routine.provenance),
    tags: routine.tags,
    triggers: routine.triggers,
    enabled: routine.enabled,
    requirementCount: routine.requirements.length,
    missingRequirementCount: readiness.missing.length,
    missingRequirements: readiness.missing.map(formatAgentSkillRequirement),
    startCount: routine.startCount,
  };
}

function summarizeRoutineScheduleReceipt(
  receipt: ReturnType<RoutineScheduleReceiptStore['snapshot']>['receipts'][number],
): AgentWorkspaceRoutineScheduleReceiptSummary {
  return {
    id: receipt.id,
    status: receipt.status,
    routineId: receipt.routineId,
    routineName: receipt.routineName,
    scheduleName: receipt.scheduleName,
    scheduleKind: receipt.scheduleKind,
    scheduleValue: receipt.scheduleValue,
    createdAt: receipt.createdAt,
  };
}

function summarizeResearchRunItem(
  run: ReturnType<AgentResearchRunRegistry['snapshot']>['runs'][number],
): AgentWorkspaceResearchRunSummary {
  return {
    id: run.id,
    title: run.title,
    status: run.status,
    phase: run.phase,
    progress: run.progress,
    sourceIds: run.sourceIds,
    nextSteps: run.nextSteps,
    checkpointCount: run.checkpoints.length,
    logTail: researchRunLogTail(run, 4),
    updatedAt: run.updatedAt,
    ...(run.note ? { note: run.note } : {}),
    ...(run.reportArtifactId ? { reportArtifactId: run.reportArtifactId } : {}),
  };
}

function readArtifactMetadataString(metadata: Readonly<Record<string, unknown>>, key: string): string {
  const value = metadata[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readArtifactMetadataStringList(metadata: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function readArtifactMetadataNumber(metadata: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isSetupSmokeEvidenceArtifact(artifact: ArtifactDescriptor): boolean {
  return readArtifactMetadataString(artifact.metadata, 'purpose') === 'agent-setup-smoke-evidence';
}

function setupSmokeEvidenceScore(artifact: ArtifactDescriptor): number {
  const result = readArtifactMetadataString(artifact.metadata, 'result');
  if (result === 'ready-for-user-run') return 2;
  if (result === 'blocked') return 0;
  return 1;
}

function setupSmokeEvidenceTrend(artifacts: readonly ArtifactDescriptor[]): string {
  if (artifacts.length === 0) return 'none';
  if (artifacts.length === 1) return 'first-run';
  const latest = setupSmokeEvidenceScore(artifacts[0]!);
  const previous = setupSmokeEvidenceScore(artifacts[1]!);
  if (latest > previous) return 'improving';
  if (latest < previous) return 'regressing';
  const result = readArtifactMetadataString(artifacts[0]!.metadata, 'result');
  if (result === 'ready-for-user-run') return 'unchanged-ready';
  if (result === 'blocked') return 'unchanged-blocked';
  return 'unchanged';
}

function setupSmokeBlockedCheckFrequency(artifacts: readonly ArtifactDescriptor[]): readonly AgentSetupWizardBlockedCheckFrequency[] {
  const counts = new Map<string, number>();
  for (const artifact of artifacts) {
    for (const checkId of readArtifactMetadataStringList(artifact.metadata, 'blockedChecks')) {
      counts.set(checkId, (counts.get(checkId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([checkId, count]) => ({ checkId, count }));
}

function buildSetupSmokeHistory(artifacts: readonly ArtifactDescriptor[], artifactListAvailable: boolean): AgentSetupWizardSmokeHistory {
  if (!artifactListAvailable) {
    return {
      ...emptyAgentSetupSmokeHistory('Artifact list support is unavailable in this runtime.'),
      status: 'unavailable',
    };
  }
  const setupSmokeArtifacts = artifacts
    .filter(isSetupSmokeEvidenceArtifact)
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
  if (setupSmokeArtifacts.length === 0) return emptyAgentSetupSmokeHistory();
  const resultCounts = setupSmokeArtifacts.reduce<Record<string, number>>((counts, artifact) => {
    const result = readArtifactMetadataString(artifact.metadata, 'result') || 'unknown';
    counts[result] = (counts[result] ?? 0) + 1;
    return counts;
  }, {});
  const latest = setupSmokeArtifacts[0]!;
  const previous = setupSmokeArtifacts[1] ?? null;
  return {
    status: 'available',
    total: setupSmokeArtifacts.length,
    trend: setupSmokeEvidenceTrend(setupSmokeArtifacts),
    latestResult: readArtifactMetadataString(latest.metadata, 'result') || 'unknown',
    previousResult: previous ? readArtifactMetadataString(previous.metadata, 'result') || 'unknown' : null,
    resultCounts,
    blockedCheckFrequency: setupSmokeBlockedCheckFrequency(setupSmokeArtifacts),
    inspectLatestRoute: `agent_artifacts show artifactId:"${latest.id}" includeContent:false`,
    rerunRoute: DEFAULT_AGENT_SETUP_WIZARD_RERUN_SMOKE_ROUTE,
    saveRoute: DEFAULT_AGENT_SETUP_WIZARD_SAVE_SMOKE_ROUTE,
  };
}

function buildSetupWizardCheckpoint(context: CommandContext): AgentSetupWizardCheckpoint {
  const shellPaths = context.workspace?.shellPaths;
  if (!shellPaths || typeof shellPaths.resolveUserPath !== 'function') {
    return {
      ...emptyAgentSetupWizardCheckpoint('Agent shell paths are unavailable; setup wizard checkpoint storage cannot be inspected.'),
      status: 'unavailable',
    };
  }
  const snapshot = readSetupWizardCheckpoint(shellPaths);
  const routes = {
    markCurrentRoute: DEFAULT_AGENT_SETUP_WIZARD_MARK_CHECKPOINT_ROUTE,
    clearRoute: DEFAULT_AGENT_SETUP_WIZARD_CLEAR_CHECKPOINT_ROUTE,
    inspectRoute: DEFAULT_AGENT_SETUP_WIZARD_INSPECT_CHECKPOINT_ROUTE,
  };
  if (!snapshot.exists) {
    return {
      ...emptyAgentSetupWizardCheckpoint(),
      ...routes,
      path: snapshot.path,
    };
  }
  if (!snapshot.checkpoint) {
    return {
      ...emptyAgentSetupWizardCheckpoint(snapshot.parseError ?? 'Saved setup wizard checkpoint could not be read.'),
      ...routes,
      status: 'unavailable',
      path: snapshot.path,
      ...(snapshot.parseError ? { parseError: snapshot.parseError } : {}),
    };
  }
  return {
    status: 'available',
    currentStepId: snapshot.checkpoint.currentStepId,
    currentStepLabel: snapshot.checkpoint.currentStepLabel,
    savedAt: snapshot.checkpoint.savedAt,
    source: snapshot.checkpoint.source,
    resumed: false,
    summary: `Saved setup checkpoint for ${snapshot.checkpoint.currentStepLabel}.`,
    path: snapshot.path,
    ...(snapshot.checkpoint.note ? { note: snapshot.checkpoint.note } : {}),
    ...routes,
  };
}

function isoToEpoch(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compactTimelineText(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function uniqueStrings(values: readonly (string | null | undefined)[], limit: number): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
}

function isReviewerHandoffArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = readArtifactMetadataString(artifact.metadata, 'purpose');
  if (purpose === 'agent-model-compare-handoff') return true;
  if (purpose.length > 0) return false;
  return (artifact.filename ?? '').startsWith('blind-model-comparison-handoff-');
}

function isModelCompareArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = readArtifactMetadataString(artifact.metadata, 'purpose');
  if (purpose === 'agent-model-compare') return true;
  if (purpose.length > 0) return false;
  return (artifact.filename ?? '').startsWith('blind-model-comparison-cmp_');
}

function isModelCompareJudgmentArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = readArtifactMetadataString(artifact.metadata, 'purpose');
  if (purpose === 'agent-model-compare-judgment') return true;
  if (purpose.length > 0) return false;
  return (artifact.filename ?? '').startsWith('blind-model-comparison-judgment-');
}

function isDocumentExportArtifact(artifact: ArtifactDescriptor): boolean {
  return readArtifactMetadataString(artifact.metadata, 'purpose') === 'agent-document-export';
}

function isModelCompareExportArtifact(artifact: ArtifactDescriptor): boolean {
  return readArtifactMetadataString(artifact.metadata, 'purpose') === 'agent-model-compare-export';
}

function isReviewerHandoffArchiveArtifact(artifact: ArtifactDescriptor): boolean {
  return readArtifactMetadataString(artifact.metadata, 'purpose') === 'agent-model-compare-handoff-archive';
}

function isModelCompareRouteDecisionArtifact(artifact: ArtifactDescriptor): boolean {
  return readArtifactMetadataString(artifact.metadata, 'purpose') === 'agent-model-compare-route-decision';
}

function isReviewPacketPresetArtifact(artifact: ArtifactDescriptor): boolean {
  return readArtifactMetadataString(artifact.metadata, 'purpose') === 'agent-review-packet-preset';
}

function artifactById(artifacts: readonly ArtifactDescriptor[], artifactId: string): ArtifactDescriptor | null {
  return artifacts.find((artifact) => artifact.id === artifactId) ?? null;
}

function firstArtifactMetadataString(
  artifacts: readonly ArtifactDescriptor[],
  artifactIds: readonly string[],
  keys: readonly string[],
): string {
  for (const artifactId of artifactIds) {
    const artifact = artifactById(artifacts, artifactId);
    if (!artifact) continue;
    for (const key of keys) {
      const value = readArtifactMetadataString(artifact.metadata, key);
      if (value) return value;
    }
  }
  return '';
}

function latestMatchingArtifact(
  artifacts: readonly ArtifactDescriptor[],
  currentArtifactId: string,
  predicate: (artifact: ArtifactDescriptor) => boolean,
): ArtifactDescriptor | null {
  const current = artifactById(artifacts, currentArtifactId);
  const currentCreatedAt = current?.createdAt ?? -1;
  return artifacts
    .filter((artifact) => artifact.id !== currentArtifactId && artifact.createdAt > currentCreatedAt && predicate(artifact))
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))[0] ?? null;
}

function reviewPacketPresetFreshness(
  preset: ArtifactDescriptor,
  artifacts: readonly ArtifactDescriptor[],
): { readonly missingCount: number; readonly newerCount: number; readonly summary: string; readonly status: 'info' | 'attention' } {
  const metadata = preset.metadata;
  const primaryIds = [
    readArtifactMetadataString(metadata, 'documentExportArtifactId'),
    readArtifactMetadataString(metadata, 'comparisonArtifactId'),
    readArtifactMetadataString(metadata, 'judgmentArtifactId'),
    readArtifactMetadataString(metadata, 'revealedJudgmentArtifactId'),
    readArtifactMetadataString(metadata, 'routeDecisionArtifactId'),
    readArtifactMetadataString(metadata, 'handoffArtifactId'),
    readArtifactMetadataString(metadata, 'handoffArchiveArtifactId'),
  ].filter(Boolean);
  const relatedIds = readArtifactMetadataStringList(metadata, 'relatedArtifactIds');
  const referencedIds = uniqueStrings([...primaryIds, ...relatedIds], 40);
  const missingCount = referencedIds.filter((artifactId) => !artifactById(artifacts, artifactId)).length;
  const documentId = readArtifactMetadataString(metadata, 'documentId')
    || firstArtifactMetadataString(artifacts, primaryIds, ['documentId', 'sourceDocumentId']);
  const comparisonId = firstArtifactMetadataString(artifacts, primaryIds, ['comparisonId']);
  const sourceArtifactId = firstArtifactMetadataString(artifacts, primaryIds, ['sourceArtifactId'])
    || readArtifactMetadataString(metadata, 'documentExportArtifactId');
  const handoffSourceArtifactId = readArtifactMetadataString(metadata, 'revealedJudgmentArtifactId')
    || readArtifactMetadataString(metadata, 'judgmentArtifactId')
    || readArtifactMetadataString(metadata, 'comparisonArtifactId')
    || readArtifactMetadataString(metadata, 'documentExportArtifactId');
  const judgmentArtifactId = readArtifactMetadataString(metadata, 'revealedJudgmentArtifactId')
    || readArtifactMetadataString(metadata, 'judgmentArtifactId')
    || firstArtifactMetadataString(artifacts, [readArtifactMetadataString(metadata, 'routeDecisionArtifactId')], ['judgmentArtifactId']);
  const handoffArtifactId = readArtifactMetadataString(metadata, 'handoffArtifactId')
    || firstArtifactMetadataString(artifacts, [readArtifactMetadataString(metadata, 'handoffArchiveArtifactId')], ['handoffArtifactId']);
  const documentExportArtifactId = readArtifactMetadataString(metadata, 'documentExportArtifactId');
  const comparisonArtifactId = readArtifactMetadataString(metadata, 'comparisonArtifactId');
  const judgmentPresetArtifactId = readArtifactMetadataString(metadata, 'judgmentArtifactId');
  const revealedJudgmentArtifactId = readArtifactMetadataString(metadata, 'revealedJudgmentArtifactId');
  const routeDecisionArtifactId = readArtifactMetadataString(metadata, 'routeDecisionArtifactId');
  const handoffPresetArtifactId = readArtifactMetadataString(metadata, 'handoffArtifactId');
  const handoffArchiveArtifactId = readArtifactMetadataString(metadata, 'handoffArchiveArtifactId');
  const freshnessChecks: Array<ArtifactDescriptor | null> = [
    documentId && documentExportArtifactId
      ? latestMatchingArtifact(artifacts, documentExportArtifactId, (artifact) => (
        isDocumentExportArtifact(artifact) && readArtifactMetadataString(artifact.metadata, 'documentId') === documentId
      ))
      : null,
    comparisonArtifactId && (documentId || sourceArtifactId)
      ? latestMatchingArtifact(artifacts, comparisonArtifactId, (artifact) => (
        isModelCompareArtifact(artifact)
        && (
          Boolean(documentId && readArtifactMetadataString(artifact.metadata, 'documentId') === documentId)
          || Boolean(sourceArtifactId && readArtifactMetadataString(artifact.metadata, 'sourceArtifactId') === sourceArtifactId)
        )
      ))
      : null,
    judgmentPresetArtifactId && (comparisonId || sourceArtifactId || documentId)
      ? latestMatchingArtifact(artifacts, judgmentPresetArtifactId, (artifact) => (
        isModelCompareJudgmentArtifact(artifact)
        && (
          Boolean(comparisonId && readArtifactMetadataString(artifact.metadata, 'comparisonId') === comparisonId)
          || Boolean(documentId && readArtifactMetadataString(artifact.metadata, 'documentId') === documentId)
          || Boolean(sourceArtifactId && readArtifactMetadataString(artifact.metadata, 'sourceArtifactId') === sourceArtifactId)
        )
      ))
      : null,
    revealedJudgmentArtifactId && (comparisonId || sourceArtifactId || documentId)
      ? latestMatchingArtifact(artifacts, revealedJudgmentArtifactId, (artifact) => (
        isModelCompareJudgmentArtifact(artifact)
        && artifact.metadata.revealIncludedInJudgment === true
        && readArtifactMetadataString(artifact.metadata, 'winnerModel').length > 0
        && (
          Boolean(comparisonId && readArtifactMetadataString(artifact.metadata, 'comparisonId') === comparisonId)
          || Boolean(documentId && readArtifactMetadataString(artifact.metadata, 'documentId') === documentId)
          || Boolean(sourceArtifactId && readArtifactMetadataString(artifact.metadata, 'sourceArtifactId') === sourceArtifactId)
        )
      ))
      : null,
    routeDecisionArtifactId && (comparisonId || judgmentArtifactId)
      ? latestMatchingArtifact(artifacts, routeDecisionArtifactId, (artifact) => (
        isModelCompareRouteDecisionArtifact(artifact)
        && (
          Boolean(judgmentArtifactId && readArtifactMetadataString(artifact.metadata, 'judgmentArtifactId') === judgmentArtifactId)
          || Boolean(comparisonId && readArtifactMetadataString(artifact.metadata, 'comparisonId') === comparisonId)
        )
      ))
      : null,
    handoffPresetArtifactId && (comparisonId || handoffSourceArtifactId)
      ? latestMatchingArtifact(artifacts, handoffPresetArtifactId, (artifact) => (
        isReviewerHandoffArtifact(artifact)
        && (
          Boolean(handoffSourceArtifactId && readArtifactMetadataString(artifact.metadata, 'sourceArtifactId') === handoffSourceArtifactId)
          || Boolean(comparisonId && readArtifactMetadataString(artifact.metadata, 'comparisonId') === comparisonId)
        )
      ))
      : null,
    handoffArchiveArtifactId && (comparisonId || handoffArtifactId)
      ? latestMatchingArtifact(artifacts, handoffArchiveArtifactId, (artifact) => (
        isReviewerHandoffArchiveArtifact(artifact)
        && (
          Boolean(handoffArtifactId && readArtifactMetadataString(artifact.metadata, 'handoffArtifactId') === handoffArtifactId)
          || Boolean(comparisonId && readArtifactMetadataString(artifact.metadata, 'comparisonId') === comparisonId)
        )
      ))
      : null,
  ];
  const newerCount = new Set(freshnessChecks.filter((artifact): artifact is ArtifactDescriptor => artifact !== null).map((artifact) => artifact.id)).size;
  const needsReview = missingCount > 0 || newerCount > 0;
  return {
    missingCount,
    newerCount,
    summary: needsReview ? `freshness needs review: ${missingCount} missing, ${newerCount} newer` : 'freshness current',
    status: needsReview ? 'attention' : 'info',
  };
}

function buildReviewPacketPresetLineage(preset: ArtifactDescriptor | null): AgentWorkspaceReviewPacketPresetLineage | null {
  if (!preset) return null;
  const metadata = preset.metadata;
  const refreshedFromArtifactId = readArtifactMetadataString(metadata, 'refreshOfArtifactId') || null;
  const refreshedFromPresetId = readArtifactMetadataString(metadata, 'refreshOfPresetId') || null;
  const freshnessMissingCount = readArtifactMetadataNumber(metadata, 'freshnessMissingCount');
  const freshnessSupersededCount = readArtifactMetadataNumber(metadata, 'freshnessSupersededCount');
  const freshnessUnresolvedCount = readArtifactMetadataNumber(metadata, 'freshnessUnresolvedCount');
  const repairedCount = (freshnessMissingCount ?? 0) + (freshnessSupersededCount ?? 0);
  const name = readArtifactMetadataString(metadata, 'name') || null;
  const presetId = readArtifactMetadataString(metadata, 'presetId') || null;
  const displayName = name ?? preset.filename ?? preset.id;
  const summary = refreshedFromArtifactId
    ? [
      `${displayName} refreshed from ${refreshedFromArtifactId}`,
      refreshedFromPresetId ? `source preset ${refreshedFromPresetId}` : '',
      `repaired ${repairedCount}`,
      `unresolved ${freshnessUnresolvedCount ?? 0}`,
    ].filter(Boolean).join('; ')
    : [
      `${displayName} has no refresh lineage`,
      presetId ? `preset ${presetId}` : '',
    ].filter(Boolean).join('; ');
  return {
    artifactId: preset.id,
    presetId,
    name,
    refreshed: Boolean(refreshedFromArtifactId),
    refreshedFromArtifactId,
    refreshedFromPresetId,
    freshnessMissingCount,
    freshnessSupersededCount,
    freshnessUnresolvedCount,
    summary,
    inspectRoute: `agent_review_packet_presets show artifactId:"${preset.id}"`,
  };
}

function summarizeReviewerHandoffArtifact(artifact: ArtifactDescriptor): AgentWorkspaceRecentReviewerHandoffArtifact {
  const metadata = artifact.metadata;
  return {
    id: artifact.id,
    filename: artifact.filename ?? '(unnamed handoff artifact)',
    createdAt: artifact.createdAt,
    handoffId: readArtifactMetadataString(metadata, 'handoffId') || 'unknown-handoff',
    comparisonId: readArtifactMetadataString(metadata, 'comparisonId') || 'unknown-comparison',
    sourceArtifactId: readArtifactMetadataString(metadata, 'sourceArtifactId') || '(missing source)',
    sourceKind: readArtifactMetadataString(metadata, 'sourceKind') || 'unknown',
    relatedArtifactCount: readArtifactMetadataStringList(metadata, 'relatedArtifactIds').length,
  };
}

function readDocumentDrafts(context: CommandContext): readonly AgentDocumentRecord[] {
  try {
    const shellPaths = context.workspace?.shellPaths;
    if (!shellPaths) return [];
    return AgentDocumentRegistry.fromShellPaths(shellPaths).list();
  } catch {
    return [];
  }
}

function buildReviewPacketTimeline(
  documents: readonly AgentDocumentRecord[],
  artifacts: readonly ArtifactDescriptor[],
  artifactListAvailable: boolean,
): AgentWorkspaceReviewPacketTimeline {
  const events: AgentWorkspaceReviewPacketTimelineEvent[] = [];
  for (const document of documents) {
    const openComments = document.comments.filter((comment) => comment.status === 'open').length;
    const proposedSuggestions = document.suggestions.filter((suggestion) => suggestion.status === 'proposed').length;
    events.push({
      id: `document:${document.id}`,
      kind: 'document',
      at: isoToEpoch(document.updatedAt),
      label: `Document ${document.status}: ${document.title}`,
      detail: `${document.versions.length} version(s), ${openComments} open comment(s), ${proposedSuggestions} proposed suggestion(s), ${document.attachments.length} attachment(s), last artifact ${document.lastArtifactId ?? 'none'}`,
      status: openComments + proposedSuggestions > 0 ? 'attention' : document.status === 'reviewed' ? 'ready' : 'info',
      route: `agent_documents show documentId:"${document.id}" includeVersions:true`,
      sourceId: document.id,
    });
    for (const comment of document.comments) {
      events.push({
        id: `comment:${document.id}:${comment.id}`,
        kind: 'comment',
        at: isoToEpoch(comment.resolvedAt ?? comment.updatedAt ?? comment.createdAt),
        label: `${comment.status === 'open' ? 'Open' : 'Resolved'} comment: ${document.title}`,
        detail: compactTimelineText(comment.body),
        status: comment.status === 'open' ? 'attention' : 'complete',
        route: comment.status === 'open'
          ? `agent_documents resolveComment documentId:"${document.id}" commentId:"${comment.id}" confirm:true explicitUserRequest:"..."`
          : `agent_documents show documentId:"${document.id}" includeVersions:true`,
        sourceId: comment.id,
      });
    }
    for (const suggestion of document.suggestions) {
      events.push({
        id: `suggestion:${document.id}:${suggestion.id}`,
        kind: 'suggestion',
        at: isoToEpoch(suggestion.resolvedAt ?? suggestion.updatedAt ?? suggestion.createdAt),
        label: `${suggestion.status === 'proposed' ? 'Proposed' : suggestion.status === 'accepted' ? 'Accepted' : 'Rejected'} suggestion: ${suggestion.title}`,
        detail: compactTimelineText(`${document.title}: ${suggestion.summary}`),
        status: suggestion.status === 'proposed' ? 'attention' : 'complete',
        route: suggestion.status === 'proposed'
          ? `agent_documents acceptSuggestion documentId:"${document.id}" suggestionId:"${suggestion.id}" confirm:true explicitUserRequest:"..." or agent_documents rejectSuggestion documentId:"${document.id}" suggestionId:"${suggestion.id}" confirm:true explicitUserRequest:"..."`
          : `agent_documents show documentId:"${document.id}" includeVersions:true`,
        sourceId: suggestion.id,
      });
    }
    for (const attachment of document.attachments) {
      events.push({
        id: `attachment:${document.id}:${attachment.id}`,
        kind: 'attachment',
        at: isoToEpoch(attachment.updatedAt ?? attachment.createdAt),
        label: `Attached artifact: ${attachment.label}`,
        detail: `${document.title}: ${attachment.artifactId}${attachment.note ? ` - ${compactTimelineText(attachment.note, 64)}` : ''}`,
        status: 'complete',
        route: `agent_artifacts show artifactId:"${attachment.artifactId}"`,
        sourceId: attachment.artifactId,
      });
    }
  }

  for (const artifact of artifacts) {
    const metadata = artifact.metadata;
    if (isDocumentExportArtifact(artifact)) {
      const documentId = readArtifactMetadataString(metadata, 'documentId') || 'unknown-document';
      const versionId = readArtifactMetadataString(metadata, 'versionId') || 'unknown-version';
      events.push({
        id: `document-export:${artifact.id}`,
        kind: 'document-export',
        at: artifact.createdAt,
        label: `Document export: ${documentId}`,
        detail: `version ${versionId}; artifact ${artifact.id}`,
        status: 'complete',
        route: `agent_artifacts show artifactId:"${artifact.id}"`,
        sourceId: artifact.id,
      });
      continue;
    }
    if (isModelCompareArtifact(artifact)) {
      const comparisonId = readArtifactMetadataString(metadata, 'comparisonId') || artifact.id;
      const completed = readArtifactMetadataNumber(metadata, 'completedCandidates');
      const candidates = readArtifactMetadataNumber(metadata, 'candidateCount');
      const source = readArtifactMetadataString(metadata, 'sourceArtifactId') || readArtifactMetadataString(metadata, 'documentId') || 'none';
      const revealed = metadata.revealIncludedInTranscript === true;
      events.push({
        id: `compare:${artifact.id}`,
        kind: 'compare',
        at: artifact.createdAt,
        label: `Blind compare ${revealed ? 'revealed' : 'hidden'}: ${comparisonId}`,
        detail: `${completed ?? '?'}/${candidates ?? '?'} candidate(s) complete; source ${source}`,
        status: revealed ? 'ready' : 'attention',
        route: revealed ? `agent_model_compare review artifactId:"${artifact.id}" reveal:true` : `agent_model_compare reveal artifactId:"${artifact.id}"`,
        sourceId: artifact.id,
      });
      continue;
    }
    if (isModelCompareJudgmentArtifact(artifact)) {
      const comparisonId = readArtifactMetadataString(metadata, 'comparisonId') || 'unknown-comparison';
      const winnerBlindId = readArtifactMetadataString(metadata, 'winnerBlindId') || 'unknown-winner';
      const winnerModel = readArtifactMetadataString(metadata, 'winnerModel');
      const revealed = metadata.revealIncludedInJudgment === true && winnerModel.length > 0;
      events.push({
        id: `judgment:${artifact.id}`,
        kind: 'judgment',
        at: artifact.createdAt,
        label: `Comparison judgment ${revealed ? 'revealed' : 'hidden'}: ${comparisonId}`,
        detail: revealed ? `winner ${winnerModel}; blind slot ${winnerBlindId}` : `winner blind slot ${winnerBlindId}; reveal needed before route decisions`,
        status: 'attention',
        route: revealed
          ? `agent_model_compare apply artifactId:"${artifact.id}" confirm:true explicitUserRequest:"..."`
          : `agent_model_compare review artifactId:"${artifact.id}"`,
        sourceId: artifact.id,
      });
      continue;
    }
    if (isModelCompareRouteDecisionArtifact(artifact)) {
      const comparisonId = readArtifactMetadataString(metadata, 'comparisonId') || 'unknown-comparison';
      const decisionId = readArtifactMetadataString(metadata, 'decisionId') || artifact.id;
      const decision = readArtifactMetadataString(metadata, 'decision') || 'unknown-decision';
      const judgmentArtifactId = readArtifactMetadataString(metadata, 'judgmentArtifactId') || 'unknown-judgment';
      const selectedModel = readArtifactMetadataString(metadata, 'selectedModel') || readArtifactMetadataString(metadata, 'currentModel') || 'unknown-model';
      events.push({
        id: `route-decision:${artifact.id}`,
        kind: 'route-decision',
        at: artifact.createdAt,
        label: `Route decision: ${decisionId}`,
        detail: `${comparisonId}; ${decision}; judgment ${judgmentArtifactId}; selected ${selectedModel}`,
        status: 'complete',
        route: `agent_artifacts show artifactId:"${artifact.id}"`,
        sourceId: artifact.id,
      });
      continue;
    }
    if (isReviewPacketPresetArtifact(artifact)) {
      const name = readArtifactMetadataString(metadata, 'name') || artifact.filename || artifact.id;
      const summary = readArtifactMetadataString(metadata, 'summary') || 'review packet preset';
      const freshness = reviewPacketPresetFreshness(artifact, artifacts);
      const sourceArtifactId = readArtifactMetadataString(metadata, 'revealedJudgmentArtifactId')
        || readArtifactMetadataString(metadata, 'judgmentArtifactId')
        || readArtifactMetadataString(metadata, 'comparisonArtifactId')
        || readArtifactMetadataString(metadata, 'documentExportArtifactId')
        || 'none';
      const handoffArtifactId = readArtifactMetadataString(metadata, 'handoffArtifactId') || 'none';
      const relatedCount = readArtifactMetadataStringList(metadata, 'relatedArtifactIds').length;
      events.push({
        id: `packet-preset:${artifact.id}`,
        kind: 'packet-preset',
        at: artifact.createdAt,
        label: `Packet preset: ${name}`,
        detail: `${compactTimelineText(summary, 72)}; source ${sourceArtifactId}; handoff ${handoffArtifactId}; ${relatedCount} related artifact(s); ${freshness.summary}`,
        status: freshness.status,
        route: `agent_review_packet_presets show artifactId:"${artifact.id}"`,
        sourceId: artifact.id,
      });
      continue;
    }
    if (isModelCompareExportArtifact(artifact)) {
      const comparisonId = readArtifactMetadataString(metadata, 'comparisonId') || 'unknown-comparison';
      const sourceKind = readArtifactMetadataString(metadata, 'sourceKind') || 'unknown';
      events.push({
        id: `compare-export:${artifact.id}`,
        kind: 'compare-export',
        at: artifact.createdAt,
        label: `Compare report: ${comparisonId}`,
        detail: `${sourceKind} report artifact ${artifact.id}`,
        status: 'complete',
        route: `agent_artifacts show artifactId:"${artifact.id}"`,
        sourceId: artifact.id,
      });
      continue;
    }
    if (isReviewerHandoffArtifact(artifact)) {
      const handoffId = readArtifactMetadataString(metadata, 'handoffId') || artifact.id;
      const comparisonId = readArtifactMetadataString(metadata, 'comparisonId') || 'unknown-comparison';
      const sourceKind = readArtifactMetadataString(metadata, 'sourceKind') || 'unknown';
      const relatedCount = readArtifactMetadataStringList(metadata, 'relatedArtifactIds').length;
      events.push({
        id: `handoff:${artifact.id}`,
        kind: 'handoff',
        at: artifact.createdAt,
        label: `Reviewer handoff: ${handoffId}`,
        detail: `${comparisonId}; source ${sourceKind}; ${relatedCount} related artifact(s)`,
        status: relatedCount > 0 ? 'ready' : 'attention',
        route: relatedCount > 0
          ? `agent_model_compare handoffDiff leftArtifactId:"${artifact.id}" rightArtifactId:"..."`
          : `agent_model_compare handoff artifactId:"${readArtifactMetadataString(metadata, 'sourceArtifactId') || artifact.id}" relatedArtifactIds:"..." confirm:true explicitUserRequest:"..."`,
        sourceId: artifact.id,
      });
      continue;
    }
    if (isReviewerHandoffArchiveArtifact(artifact)) {
      const archiveId = readArtifactMetadataString(metadata, 'archiveId') || artifact.id;
      const comparisonId = readArtifactMetadataString(metadata, 'comparisonId') || 'unknown-comparison';
      const artifactCount = readArtifactMetadataNumber(metadata, 'artifactCount');
      events.push({
        id: `handoff-archive:${artifact.id}`,
        kind: 'handoff-archive',
        at: artifact.createdAt,
        label: `Handoff archive: ${archiveId}`,
        detail: `${comparisonId}; ${artifactCount ?? '?'} artifact(s) packaged`,
        status: 'complete',
        route: `agent_artifacts show artifactId:"${artifact.id}"`,
        sourceId: artifact.id,
      });
    }
  }

  const ordered = events
    .filter((event) => Number.isFinite(event.at))
    .sort((left, right) => right.at - left.at || left.id.localeCompare(right.id));
  const attention = ordered.find((event) => event.status === 'attention');
  return {
    available: artifactListAvailable,
    count: ordered.length,
    next: !artifactListAvailable
      ? 'Artifact listing is unavailable; timeline shows document-local events only.'
      : attention
        ? `${attention.label}: ${attention.detail}`
        : ordered.length > 0
          ? 'Review packet timeline is clear; export, handoff, archive, or route decisions can use the visible readiness checks.'
          : 'Create or attach a document, source artifact, comparison, judgment, handoff, or archive to start a review packet timeline.',
    items: ordered.slice(0, 8),
  };
}

function buildReviewPacketDefaults(
  documents: readonly AgentDocumentRecord[],
  artifacts: readonly ArtifactDescriptor[],
): AgentWorkspaceReviewPacketDefaults {
  const latestDocument = [...documents]
    .filter((document) => document.status !== 'archived')
    .sort((left, right) => isoToEpoch(right.updatedAt) - isoToEpoch(left.updatedAt) || left.id.localeCompare(right.id))[0] ?? null;
  const latestDocumentExport = artifacts.filter(isDocumentExportArtifact).sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  const latestComparison = artifacts.filter(isModelCompareArtifact).sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  const latestJudgment = artifacts.filter(isModelCompareJudgmentArtifact).sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  const latestRevealedJudgment = artifacts
    .filter((artifact) => (
      isModelCompareJudgmentArtifact(artifact)
      && artifact.metadata.revealIncludedInJudgment === true
      && readArtifactMetadataString(artifact.metadata, 'winnerModel').length > 0
    ))
    .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  const latestHandoff = artifacts.filter(isReviewerHandoffArtifact).sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  const latestHandoffArchive = artifacts.filter(isReviewerHandoffArchiveArtifact).sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  const latestPreset = artifacts.filter(isReviewPacketPresetArtifact).sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  const presetMetadata = latestPreset?.metadata ?? {};
  const latestRevealedJudgmentComparisonId = readArtifactMetadataString(latestRevealedJudgment?.metadata ?? {}, 'comparisonId');
  const latestRouteDecision = artifacts
    .filter(isModelCompareRouteDecisionArtifact)
    .filter((artifact) => {
      if (!latestRevealedJudgment) return true;
      const judgmentArtifactId = readArtifactMetadataString(artifact.metadata, 'judgmentArtifactId');
      const comparisonId = readArtifactMetadataString(artifact.metadata, 'comparisonId');
      return judgmentArtifactId === latestRevealedJudgment.id || (latestRevealedJudgmentComparisonId.length > 0 && comparisonId === latestRevealedJudgmentComparisonId);
    })
    .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  const liveRelatedArtifactIds = uniqueStrings([
    latestDocumentExport?.id,
    latestDocument?.lastArtifactId,
    ...(latestDocument?.attachments.map((attachment) => attachment.artifactId) ?? []),
    readArtifactMetadataString(latestComparison?.metadata ?? {}, 'sourceArtifactId'),
    ...readArtifactMetadataStringList(latestHandoff?.metadata ?? {}, 'relatedArtifactIds'),
  ], 8);
  const presetRelatedArtifactIds = readArtifactMetadataStringList(presetMetadata, 'relatedArtifactIds').slice(0, 8);
  const relatedArtifactIds = liveRelatedArtifactIds.length > 0 ? liveRelatedArtifactIds : presetRelatedArtifactIds;
  const documentId = (latestDocument?.id ?? readArtifactMetadataString(presetMetadata, 'documentId')) || null;
  const documentTitle = (latestDocument?.title ?? readArtifactMetadataString(presetMetadata, 'documentTitle')) || null;
  const documentExportArtifactId = (latestDocumentExport?.id ?? readArtifactMetadataString(presetMetadata, 'documentExportArtifactId')) || null;
  const comparisonArtifactId = (latestComparison?.id ?? readArtifactMetadataString(presetMetadata, 'comparisonArtifactId')) || null;
  const judgmentArtifactId = (latestJudgment?.id ?? readArtifactMetadataString(presetMetadata, 'judgmentArtifactId')) || null;
  const revealedJudgmentArtifactId = (latestRevealedJudgment?.id ?? readArtifactMetadataString(presetMetadata, 'revealedJudgmentArtifactId')) || null;
  const routeDecisionArtifactId = (latestRouteDecision?.id ?? readArtifactMetadataString(presetMetadata, 'routeDecisionArtifactId')) || null;
  const routeDecision = latestRouteDecision
    ? readArtifactMetadataString(latestRouteDecision.metadata, 'decision') || null
    : readArtifactMetadataString(presetMetadata, 'routeDecision') || null;
  const handoffArtifactId = (latestHandoff?.id ?? readArtifactMetadataString(presetMetadata, 'handoffArtifactId')) || null;
  const handoffArchiveArtifactId = (latestHandoffArchive?.id ?? readArtifactMetadataString(presetMetadata, 'handoffArchiveArtifactId')) || null;
  const sourceArtifactId = revealedJudgmentArtifactId ?? judgmentArtifactId ?? comparisonArtifactId ?? null;
  const reviewPacketPresetName = readArtifactMetadataString(presetMetadata, 'name') || null;
  const reviewPacketPresetLineage = buildReviewPacketPresetLineage(latestPreset);
  const summary = [
    documentId ? `document ${documentId}` : '',
    sourceArtifactId ? `source ${sourceArtifactId}` : '',
    handoffArtifactId ? `handoff ${handoffArtifactId}` : '',
    relatedArtifactIds.length > 0 ? `${relatedArtifactIds.length} related` : '',
    latestPreset ? `preset ${latestPreset.id}` : '',
  ].filter(Boolean).join('; ') || 'no packet defaults yet';
  return {
    documentId,
    documentTitle,
    documentExportArtifactId,
    comparisonArtifactId,
    judgmentArtifactId,
    revealedJudgmentArtifactId,
    routeDecisionArtifactId,
    routeDecision,
    handoffArtifactId,
    handoffArchiveArtifactId,
    reviewPacketPresetArtifactId: latestPreset?.id ?? null,
    reviewPacketPresetName,
    reviewPacketPresetLineage,
    relatedArtifactIds,
    summary,
  };
}

function packetStepStatus(done: boolean, priorDone: boolean): AgentWorkspaceReviewPacketWizardStepStatus {
  if (done) return 'done';
  return priorDone ? 'current' : 'blocked';
}

function buildReviewPacketWizardStep(input: {
  readonly id: string;
  readonly label: string;
  readonly status: AgentWorkspaceReviewPacketWizardStepStatus;
  readonly detail: string;
  readonly userRoute: string;
  readonly modelRoute: string;
  readonly actionId: string;
  readonly backtrackRoute?: string | null;
}): AgentWorkspaceReviewPacketWizardStep {
  return {
    id: input.id,
    label: input.label,
    status: input.status,
    detail: input.detail,
    userRoute: input.userRoute,
    modelRoute: input.modelRoute,
    actionId: input.actionId,
    backtrackRoute: input.backtrackRoute ?? (input.status === 'done' ? input.modelRoute : null),
  };
}

function buildReviewPacketWizard(
  documents: readonly AgentDocumentRecord[],
  artifactListAvailable: boolean,
  defaults: AgentWorkspaceReviewPacketDefaults,
): AgentWorkspaceReviewPacketWizard {
  const latestDocument = [...documents]
    .filter((document) => document.status !== 'archived')
    .sort((left, right) => isoToEpoch(right.updatedAt) - isoToEpoch(left.updatedAt) || left.id.localeCompare(right.id))[0] ?? null;
  const openComments = latestDocument?.comments.filter((comment) => comment.status === 'open').length ?? 0;
  const proposedSuggestions = latestDocument?.suggestions.filter((suggestion) => suggestion.status === 'proposed').length ?? 0;
  const documentReviewed = Boolean(latestDocument && openComments === 0 && proposedSuggestions === 0);
  const documentExported = Boolean(defaults.documentExportArtifactId || latestDocument?.lastArtifactId);
  const judgmentReady = Boolean(defaults.revealedJudgmentArtifactId);
  const handoffReady = Boolean(defaults.handoffArtifactId && defaults.relatedArtifactIds.length > 0);
  const archiveReady = Boolean(defaults.handoffArchiveArtifactId);
  const routeDecisionDone = Boolean(defaults.routeDecisionArtifactId || archiveReady);
  const presetLineage = defaults.reviewPacketPresetLineage;
  const finalArchiveReview = archiveReady
    ? [
      `Inspect final archive ${defaults.handoffArchiveArtifactId}.`,
      presetLineage?.refreshed
        ? `Verify refreshed preset lineage: ${presetLineage.summary}.`
        : presetLineage
          ? `Preset lineage: ${presetLineage.summary}.`
          : 'No saved packet preset lineage is attached.',
      'Use Documents & Compare -> Share review packet only after the user confirms the delivery target.',
    ].join(' ')
    : 'Final evidence review stays pending until a reviewer handoff ZIP archive exists.';
  const documentRoute = latestDocument
    ? `agent_documents show documentId:"${latestDocument.id}" includeVersions:true`
    : 'agent_documents list';
  const steps: AgentWorkspaceReviewPacketWizardStep[] = [];
  steps.push(buildReviewPacketWizardStep({
    id: 'draft-review',
    label: 'Draft review',
    status: documentReviewed ? 'done' : 'current',
    detail: latestDocument
      ? documentReviewed
        ? `${latestDocument.title} has no open comments or proposed suggestions.`
        : `${latestDocument.title} has ${openComments} open comment(s) and ${proposedSuggestions} proposed suggestion(s) to resolve before export.`
      : 'Create or select a document draft before building a reviewer packet.',
    userRoute: latestDocument ? 'Documents & Compare -> Show document draft' : 'Documents & Compare -> Create document draft',
    modelRoute: latestDocument
      ? documentRoute
      : 'agent_harness mode:"workspace_action" actionId:"document-create-draft"',
    actionId: latestDocument ? 'document-show-draft' : 'document-create-draft',
  }));
  steps.push(buildReviewPacketWizardStep({
    id: 'document-export',
    label: 'Document export',
    status: packetStepStatus(documentExported, documentReviewed),
    detail: documentExported
      ? `Document evidence is exported as ${defaults.documentExportArtifactId ?? latestDocument?.lastArtifactId}.`
      : documentReviewed
        ? 'Export the reviewed draft as a saved artifact for comparison and handoff evidence.'
        : 'Resolve draft review items before exporting reviewer evidence.',
    userRoute: 'Documents & Compare -> Export document artifact',
    modelRoute: latestDocument
      ? `agent_documents export documentId:"${latestDocument.id}" confirm:true explicitUserRequest:"..."`
      : 'agent_harness mode:"workspace_action" actionId:"document-export-draft"',
    actionId: 'document-export-draft',
    backtrackRoute: defaults.documentExportArtifactId
      ? `agent_artifacts show artifactId:"${defaults.documentExportArtifactId}"`
      : null,
  }));
  steps.push(buildReviewPacketWizardStep({
    id: 'compare-judgment',
    label: 'Compare judgment',
    status: packetStepStatus(judgmentReady, documentExported),
    detail: judgmentReady
      ? `Revealed judgment ${defaults.revealedJudgmentArtifactId} is ready for route review.`
      : defaults.judgmentArtifactId
        ? `Judgment ${defaults.judgmentArtifactId} exists, but winner identity is not revealed for route decisions.`
        : defaults.comparisonArtifactId
          ? `Comparison ${defaults.comparisonArtifactId} is available; save or reveal a judgment before handoff.`
          : documentExported
            ? 'Run a blind comparison from the exported document evidence, then save a revealed judgment.'
            : 'Export document evidence before comparing models.',
    userRoute: defaults.comparisonArtifactId ? 'Documents & Compare -> Review saved compare' : 'Documents & Compare -> Run blind compare',
    modelRoute: defaults.revealedJudgmentArtifactId
      ? `agent_model_compare review artifactId:"${defaults.revealedJudgmentArtifactId}" reveal:true`
      : defaults.judgmentArtifactId
        ? `agent_model_compare review artifactId:"${defaults.judgmentArtifactId}"`
        : defaults.comparisonArtifactId
          ? `agent_model_compare review artifactId:"${defaults.comparisonArtifactId}"`
          : 'agent_harness mode:"workspace_action" actionId:"document-run-compare"',
    actionId: defaults.comparisonArtifactId ? 'document-review-compare' : 'document-run-compare',
  }));
  steps.push(buildReviewPacketWizardStep({
    id: 'reviewer-handoff',
    label: 'Reviewer handoff',
    status: packetStepStatus(handoffReady, judgmentReady),
    detail: handoffReady
      ? `Reviewer handoff ${defaults.handoffArtifactId} includes ${defaults.relatedArtifactIds.length} related evidence artifact(s).`
      : judgmentReady
        ? 'Create a reviewer handoff from the revealed judgment and related document/export evidence.'
        : 'Save a revealed comparison judgment before creating reviewer handoff evidence.',
    userRoute: 'Documents & Compare -> Export compare report',
    modelRoute: defaults.revealedJudgmentArtifactId
      ? `agent_model_compare handoff artifactId:"${defaults.revealedJudgmentArtifactId}" relatedArtifactIds:${JSON.stringify(defaults.relatedArtifactIds)} confirm:true explicitUserRequest:"..."`
      : 'agent_harness mode:"workspace_action" actionId:"document-export-compare"',
    actionId: 'document-export-compare',
    backtrackRoute: defaults.handoffArtifactId
      ? `agent_artifacts show artifactId:"${defaults.handoffArtifactId}"`
      : null,
  }));
  steps.push(buildReviewPacketWizardStep({
    id: 'route-decision',
    label: 'Route decision',
    status: routeDecisionDone ? 'done' : handoffReady ? 'current' : judgmentReady ? 'pending' : 'blocked',
    detail: routeDecisionDone
      ? defaults.routeDecisionArtifactId
        ? `Route decision ${defaults.routeDecisionArtifactId} records ${defaults.routeDecision ?? 'a saved decision'}.`
        : 'Final packet evidence exists; route-decision review has been carried to archive/final review.'
      : handoffReady
        ? 'Apply the revealed winner or explicitly leave the current model unchanged before final archive review.'
        : judgmentReady
          ? 'Create reviewer handoff evidence before applying or leaving the revealed winning route.'
          : 'A revealed judgment is required before deciding whether to update the selected model route.',
    userRoute: 'Documents & Compare -> Apply compare winner or Record route decision',
    modelRoute: defaults.revealedJudgmentArtifactId
      ? `agent_model_compare apply artifactId:"${defaults.revealedJudgmentArtifactId}" confirm:true explicitUserRequest:"..." or agent_model_compare routeDecision artifactId:"${defaults.revealedJudgmentArtifactId}" decision:"left-unchanged" confirm:true explicitUserRequest:"..."`
      : 'agent_harness mode:"workspace_action" actionId:"document-apply-compare"',
    actionId: 'document-apply-compare',
    backtrackRoute: defaults.routeDecisionArtifactId
      ? `agent_artifacts show artifactId:"${defaults.routeDecisionArtifactId}"`
      : null,
  }));
  steps.push(buildReviewPacketWizardStep({
    id: 'final-archive-review',
    label: 'Final archive review',
    status: archiveReady ? 'done' : routeDecisionDone && handoffReady ? 'current' : handoffReady ? 'pending' : 'blocked',
    detail: archiveReady
      ? `Reviewer packet archive ${defaults.handoffArchiveArtifactId} is ready for final evidence review.`
      : handoffReady
        ? 'Archive the reviewer handoff as one ZIP artifact after route-decision review.'
        : 'Create a reviewer handoff with related evidence before archiving the packet.',
    userRoute: 'Documents & Compare -> Export compare report',
    modelRoute: defaults.handoffArtifactId
      ? `agent_model_compare handoffArchive artifactId:"${defaults.handoffArtifactId}" confirm:true explicitUserRequest:"..."`
      : 'agent_harness mode:"workspace_action" actionId:"document-export-compare"',
    actionId: 'document-export-compare',
    backtrackRoute: defaults.handoffArchiveArtifactId
      ? `agent_artifacts show artifactId:"${defaults.handoffArchiveArtifactId}"`
      : null,
  }));
  const completedSteps = steps.filter((step) => step.status === 'done').length;
  const current = steps.find((step) => step.status === 'current') ?? steps.find((step) => step.status === 'pending') ?? null;
  const status = !artifactListAvailable && steps.length > 0
    ? 'blocked'
    : completedSteps === steps.length
      ? 'complete'
      : latestDocument
        ? 'active'
        : 'empty';
  return {
    available: artifactListAvailable,
    status,
    completedSteps,
    totalSteps: steps.length,
    currentStepId: current?.id ?? null,
    currentStepLabel: current?.label ?? null,
    next: current
      ? `${current.label}: ${current.detail}`
      : 'Review packet wizard is complete; inspect the final archive and saved packet evidence.',
    finalReview: finalArchiveReview,
    presetLineage,
    steps,
  };
}

function reviewerReadinessBadge(
  documents: readonly AgentDocumentRecord[],
  artifacts: readonly ArtifactDescriptor[],
  artifactListAvailable: boolean,
): AgentWorkspaceReviewerReadinessBadge {
  const reviewDocuments = documents.filter((document) => document.status !== 'archived');
  const openComments = reviewDocuments.reduce((total, document) => total + document.comments.filter((comment) => comment.status === 'open').length, 0);
  const proposedSuggestions = reviewDocuments.reduce((total, document) => total + document.suggestions.filter((suggestion) => suggestion.status === 'proposed').length, 0);
  const documentsMissingSourceArtifacts = reviewDocuments.filter((document) => document.attachments.length === 0 && !document.lastArtifactId).length;
  const comparisons = artifacts.filter(isModelCompareArtifact);
  const judgments = artifacts.filter(isModelCompareJudgmentArtifact);
  const routeDecisions = artifacts.filter(isModelCompareRouteDecisionArtifact);
  const handoffs = artifacts.filter(isReviewerHandoffArtifact);
  const revealedJudgments = judgments.filter((artifact) => (
    artifact.metadata.revealIncludedInJudgment === true
    && readArtifactMetadataString(artifact.metadata, 'winnerModel').length > 0
  ));
  const hiddenJudgments = judgments.filter((artifact) => (
    artifact.metadata.revealIncludedInJudgment !== true
    || readArtifactMetadataString(artifact.metadata, 'winnerModel').length === 0
  ));
  const routeDecisionComparisonIds = new Set(routeDecisions.map((artifact) => readArtifactMetadataString(artifact.metadata, 'comparisonId')).filter(Boolean));
  const routeDecisionJudgmentArtifactIds = new Set(routeDecisions.map((artifact) => readArtifactMetadataString(artifact.metadata, 'judgmentArtifactId')).filter(Boolean));
  const revealedJudgmentsWaitingOnRouteDecision = revealedJudgments.filter((artifact) => {
    const comparisonId = readArtifactMetadataString(artifact.metadata, 'comparisonId');
    return !routeDecisionJudgmentArtifactIds.has(artifact.id) && (!comparisonId || !routeDecisionComparisonIds.has(comparisonId));
  });
  const revealedComparisonIds = new Set(revealedJudgments.map((artifact) => readArtifactMetadataString(artifact.metadata, 'comparisonId')).filter(Boolean));
  const unrevealedComparisons = comparisons.filter((artifact) => {
    const comparisonId = readArtifactMetadataString(artifact.metadata, 'comparisonId');
    return artifact.metadata.revealIncludedInTranscript !== true && (!comparisonId || !revealedComparisonIds.has(comparisonId));
  });
  const comparisonSourceMissing = comparisons.filter((artifact) => (
    !readArtifactMetadataString(artifact.metadata, 'sourceArtifactId')
    && !readArtifactMetadataString(artifact.metadata, 'documentId')
  )).length;
  const missingSourceArtifacts = documentsMissingSourceArtifacts + comparisonSourceMissing;
  const handoffsMissingRelatedArtifacts = handoffs.filter((artifact) => readArtifactMetadataStringList(artifact.metadata, 'relatedArtifactIds').length === 0).length;
  const issueCount = openComments
    + proposedSuggestions
    + missingSourceArtifacts
    + unrevealedComparisons.length
    + hiddenJudgments.length
    + revealedJudgmentsWaitingOnRouteDecision.length
    + handoffsMissingRelatedArtifacts;
  const next = !artifactListAvailable
    ? 'Artifact listing is unavailable; run Review readiness preflight before export, archive, or route update.'
    : openComments + proposedSuggestions > 0
      ? 'Resolve open comments or accept/reject proposed suggestions before exporting reviewer packets.'
      : missingSourceArtifacts > 0
        ? 'Attach source artifacts or related evidence before export, handoff, or archive.'
        : unrevealedComparisons.length + hiddenJudgments.length > 0
          ? 'Reveal comparison/judgment identity before applying a model route or final reviewer handoff.'
          : revealedJudgmentsWaitingOnRouteDecision.length > 0
            ? 'Apply the revealed winner or explicitly leave routing unchanged before archiving.'
            : handoffsMissingRelatedArtifacts > 0
              ? 'Recreate reviewer handoffs with related evidence before ZIP archive.'
              : 'Reviewer readiness preflight is clear for export, handoff archive, or route update.';
  return {
    status: !artifactListAvailable ? 'needs-setup' : issueCount > 0 ? 'attention' : 'ready',
    summary: `${issueCount} issue(s): ${openComments} comment(s), ${proposedSuggestions} suggestion(s), ${missingSourceArtifacts} source/evidence gap(s), ${unrevealedComparisons.length + hiddenJudgments.length} hidden comparison item(s), ${revealedJudgmentsWaitingOnRouteDecision.length} route decision(s), ${handoffsMissingRelatedArtifacts} handoff evidence gap(s).`,
    next,
    issueCount,
    openComments,
    proposedSuggestions,
    missingSourceArtifacts,
    unrevealedComparisons: unrevealedComparisons.length,
    hiddenJudgments: hiddenJudgments.length,
    revealedJudgments: revealedJudgmentsWaitingOnRouteDecision.length,
    handoffsMissingRelatedArtifacts,
  };
}

function summarizeMemoryItem(record: MemoryRecord): AgentWorkspaceLocalLibraryItem {
  const detail = record.detail?.trim();
  return {
    id: record.id,
    name: record.summary,
    description: detail && detail.length > 0 ? detail : `${record.scope}/${record.cls}`,
    reviewState: record.reviewState,
    source: 'Agent memory',
    tags: record.tags,
    triggers: [],
    scope: record.scope,
    cls: record.cls,
    confidence: record.confidence,
  };
}

function summarizeNoteItem(note: AgentNoteRecord): AgentWorkspaceLocalLibraryItem {
  const preview = note.body.replace(/\s+/g, ' ').trim();
  const description = note.sourceUrl
    ? `${preview.slice(0, 160)}${preview.length > 160 ? '...' : ''} Origin URL ${note.sourceUrl}`
    : preview;
  return {
    id: note.id,
    name: note.title,
    description,
    reviewState: note.reviewState,
    source: formatAgentRecordOrigin(note.source, note.provenance),
    tags: note.tags,
    triggers: [],
  };
}

function summarizeRuntimeProfile(profile: ReturnType<typeof listAgentRuntimeProfiles>[number]): AgentWorkspaceRuntimeProfileItem {
  return {
    id: profile.id,
    homeDirectory: profile.homeDirectory,
    createdAt: profile.createdAt,
    starterTemplateId: profile.starterTemplateId,
    starterTemplateName: profile.starterTemplateName,
  };
}

function summarizeStarterTemplate(template: ReturnType<typeof listAgentRuntimeProfileTemplates>[number]): AgentWorkspaceRuntimeStarterTemplateItem {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    personaName: template.personaName,
    skillNames: template.skillNames,
    routineNames: template.routineNames,
    source: template.source,
  };
}

function setupChecklistUserRoute(item: AgentWorkspaceSetupChecklistItem): string {
  return item.command ?? 'Start';
}

function setupChecklistModelRoute(item: AgentWorkspaceSetupChecklistItem): string {
  if (item.id === 'runtime') return 'agent_harness mode:"setup_item" setupItemId:"connected-host-readiness"';
  if (item.id === 'provider-model') return 'agent_harness mode:"model_routing"';
  if (item.id === 'install-smoke') return DEFAULT_AGENT_SETUP_WIZARD_RERUN_SMOKE_ROUTE;
  if (item.id === 'subscriptions') return 'agent_harness mode:"provider_accounts"';
  if (item.id === 'agent-knowledge') return 'agent_knowledge mode:"status"';
  if (item.id === 'profile') return 'agent_harness mode:"workspace_action" actionId:"profile-template-show"';
  if (item.id === 'persona') return 'agent_harness mode:"workspace" target:"personas"';
  if (item.id === 'skills') return 'agent_harness mode:"workspace" target:"skills"';
  if (item.id === 'routines') return 'agent_harness mode:"workspace" target:"routines"';
  if (item.id === 'memory') return 'agent_harness mode:"memory_posture"';
  if (item.id === 'notes') return 'agent_harness mode:"personal_ops_lane" laneId:"notes"';
  if (item.id === 'channels') return 'agent_harness mode:"channels"';
  if (item.id === 'voice-media') return 'agent_harness mode:"media_posture"';
  return `agent_harness mode:"setup_item" setupItemId:"${item.id}"`;
}

function setupChecklistActionId(item: AgentWorkspaceSetupChecklistItem): string {
  if (item.id === 'provider-model') return 'setup-provider-model';
  if (item.id === 'subscriptions') return 'subscription-login-start';
  if (item.id === 'agent-knowledge') return 'knowledge-status';
  if (item.id === 'profile') return 'profile-template-show';
  if (item.id === 'persona') return 'persona-search';
  if (item.id === 'skills') return 'skill-search';
  if (item.id === 'routines') return 'routine-search';
  if (item.id === 'channels') return 'channel-show';
  if (item.id === 'voice-media') return 'voice-enable';
  return item.id;
}

const SETUP_WIZARD_SNAPSHOT_BLOCKER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'agent-binary': ['runtime', 'install-smoke'],
  'connected-host-status': ['runtime'],
  'connected-host-auth': ['connected-host-auth'],
  'provider-model': ['provider-model'],
  'setup-posture': ['install-smoke'],
  'first-assistant-turn': ['install-smoke'],
};

function buildWorkspaceSetupWizard(
  checklist: readonly AgentWorkspaceSetupChecklistItem[],
  smokeHistory: AgentSetupWizardSmokeHistory,
  checkpoint: AgentSetupWizardCheckpoint,
): AgentSetupWizard {
  const items: AgentSetupWizardSourceItem[] = checklist.map((item) => ({
    id: item.id,
    label: item.label,
    status: item.status,
    detail: item.detail,
    userRoute: setupChecklistUserRoute(item),
    modelRoute: setupChecklistModelRoute(item),
    actionId: setupChecklistActionId(item),
  }));
  return buildAgentSetupWizard({
    items,
    smokeHistory,
    checkpoint,
    repeatedBlockerAliases: SETUP_WIZARD_SNAPSHOT_BLOCKER_ALIASES,
  });
}

export function buildAgentWorkspaceRuntimeSnapshot(context: CommandContext): AgentWorkspaceRuntimeSnapshot {
  const host = readConfigString(context, 'controlPlane.host', '127.0.0.1');
  const port = readConfigNumber(context, 'controlPlane.port', 3421);
  const model = context.session?.runtime?.model ?? 'unknown';
  const provider = context.session?.runtime?.provider ?? 'unknown';
  const currentModel = (() => {
    try {
      return context.provider?.providerRegistry?.getCurrentModel?.();
    } catch {
      return null;
    }
  })();
  const sessionMemoryCount = (() => {
    try {
      return context.session?.sessionMemoryStore?.list?.().length ?? 0;
    } catch {
      return 0;
    }
  })();
  const memorySnapshot = (() => {
    try {
      const memory = context.clients?.agentKnowledgeApi?.memory;
      if (!memory) return { count: 0, reviewQueueCount: 0, promptActiveCount: 0, items: [] };
      const records = [...memory.getAll()].sort((left, right) => right.updatedAt - left.updatedAt);
      return {
        count: records.length,
        reviewQueueCount: memory.reviewQueue(100).length,
        promptActiveCount: records.filter(isPromptActiveMemory).length,
        items: records.map(summarizeMemoryItem),
      };
    } catch {
      return { count: 0, reviewQueueCount: 0, promptActiveCount: 0, items: [] };
    }
  })();
  const personaSnapshot = (() => {
    try {
      const shellPaths = context.workspace?.shellPaths;
      if (!shellPaths) return { count: 0, activeName: '(none)', items: [] };
      const snapshot = AgentPersonaRegistry.fromShellPaths(shellPaths).snapshot();
      return {
        count: snapshot.personas.length,
        activeName: snapshot.activePersona?.name ?? '(none)',
        items: snapshot.personas.map((persona) => summarizePersonaItem(persona, snapshot.activePersonaId)),
      };
    } catch {
      return { count: 0, activeName: '(unavailable)', items: [] };
    }
  })();
  const noteSnapshot = (() => {
    try {
      const shellPaths = context.workspace?.shellPaths;
      if (!shellPaths) return { count: 0, reviewQueueCount: 0, items: [] };
      const snapshot = AgentNoteRegistry.fromShellPaths(shellPaths).snapshot();
      return {
        count: snapshot.notes.length,
        reviewQueueCount: snapshot.reviewQueue.length,
        items: snapshot.notes.map(summarizeNoteItem),
      };
    } catch {
      return { count: 0, reviewQueueCount: 0, items: [] };
    }
  })();
  const skillSnapshot = (() => {
    try {
      const shellPaths = context.workspace?.shellPaths;
      if (!shellPaths) return { count: 0, enabled: 0, active: 0, bundleCount: 0, enabledBundleCount: 0, items: [], bundleItems: [] };
      const snapshot = AgentSkillRegistry.fromShellPaths(shellPaths).snapshot();
      return {
        count: snapshot.skills.length,
        enabled: snapshot.enabledSkills.length,
        active: snapshot.activeSkills.length,
        bundleCount: snapshot.bundles.length,
        enabledBundleCount: snapshot.enabledBundles.length,
        items: snapshot.skills.map(summarizeSkillItem),
        bundleItems: snapshot.bundles.map((bundle) => summarizeSkillBundleItem(bundle, snapshot.skills)),
      };
    } catch {
      return { count: 0, enabled: 0, active: 0, bundleCount: 0, enabledBundleCount: 0, items: [], bundleItems: [] };
    }
  })();
  const routineSnapshot = (() => {
    try {
      const shellPaths = context.workspace?.shellPaths;
      if (!shellPaths) return { count: 0, enabled: 0, items: [] };
      const snapshot = AgentRoutineRegistry.fromShellPaths(shellPaths).snapshot();
      return {
        count: snapshot.routines.length,
        enabled: snapshot.enabledRoutines.length,
        items: snapshot.routines.map(summarizeRoutineItem),
      };
    } catch {
      return { count: 0, enabled: 0, items: [] };
    }
  })();
  const routineScheduleReceipts = (() => {
    try {
      const shellPaths = context.workspace?.shellPaths;
      if (!shellPaths) return { count: 0, successful: 0, failed: 0, latest: null };
      const receipts = RoutineScheduleReceiptStore.fromShellPaths(shellPaths).snapshot().receipts;
      return {
        count: receipts.length,
        successful: receipts.filter((receipt) => receipt.status === 'created').length,
        failed: receipts.filter((receipt) => receipt.status === 'failed').length,
        latest: receipts[0] ? summarizeRoutineScheduleReceipt(receipts[0]) : null,
      };
    } catch {
      return { count: 0, successful: 0, failed: 0, latest: null };
    }
  })();
  const researchSourceSnapshot = (() => {
    try {
      const shellPaths = context.workspace?.shellPaths;
      if (!shellPaths) return { count: 0, candidate: 0, reviewed: 0, rejected: 0, used: 0 };
      const snapshot = AgentResearchSourceRegistry.fromShellPaths(shellPaths).snapshot();
      return {
        count: snapshot.sources.length,
        candidate: snapshot.candidates.length,
        reviewed: snapshot.reviewed.length,
        rejected: snapshot.rejected.length,
        used: snapshot.used.length,
      };
    } catch {
      return { count: 0, candidate: 0, reviewed: 0, rejected: 0, used: 0 };
    }
  })();
  const researchRunSnapshot = (() => {
    try {
      const shellPaths = context.workspace?.shellPaths;
      if (!shellPaths) return { count: 0, planned: 0, running: 0, paused: 0, blocked: 0, terminal: 0, items: [] };
      const snapshot = AgentResearchRunRegistry.fromShellPaths(shellPaths).snapshot();
      const actionable = [
        ...snapshot.blocked,
        ...snapshot.running,
        ...snapshot.paused,
        ...snapshot.planned,
        ...snapshot.failed,
        ...snapshot.completed,
        ...snapshot.cancelled,
      ];
      return {
        count: snapshot.runs.length,
        planned: snapshot.planned.length,
        running: snapshot.running.length,
        paused: snapshot.paused.length,
        blocked: snapshot.blocked.length,
        terminal: snapshot.cancelled.length + snapshot.completed.length + snapshot.failed.length,
        items: actionable.slice(0, 8).map(summarizeResearchRunItem),
      };
    } catch {
      return { count: 0, planned: 0, running: 0, paused: 0, blocked: 0, terminal: 0, items: [] };
    }
  })();
  const artifactListSnapshot = (() => {
    try {
      const list = context.platform?.artifactStore?.list;
      return {
        available: Boolean(list),
        items: [...(list?.(100) ?? [])],
      };
    } catch {
      return { available: false, items: [] };
    }
  })();
  const recentReviewerHandoffs = (() => {
    try {
      const handoffs = artifactListSnapshot.items
        .filter(isReviewerHandoffArtifact)
        .sort((left, right) => right.createdAt - left.createdAt);
      return {
        count: handoffs.length,
        items: handoffs.slice(0, 6).map(summarizeReviewerHandoffArtifact),
      };
    } catch {
      return { count: 0, items: [] };
    }
  })();
  const documentDrafts = readDocumentDrafts(context);
  const reviewerBadge = reviewerReadinessBadge(
    documentDrafts,
    artifactListSnapshot.items,
    artifactListSnapshot.available,
  );
  const reviewPacketTimeline = buildReviewPacketTimeline(
    documentDrafts,
    artifactListSnapshot.items,
    artifactListSnapshot.available,
  );
  const reviewPacketDefaults = buildReviewPacketDefaults(
    documentDrafts,
    artifactListSnapshot.items,
  );
  const reviewPacketWizard = buildReviewPacketWizard(
    documentDrafts,
    artifactListSnapshot.available,
    reviewPacketDefaults,
  );
  const discoveredBehavior = summarizeAgentBehaviorDiscovery(context.workspace?.shellPaths);
  const profileBaseHome = inferRuntimeProfileBaseHome(context.workspace?.shellPaths?.homeDirectory ?? '');
  const runtimeProfiles = (() => {
    try {
      return listAgentRuntimeProfiles(profileBaseHome);
    } catch {
      return [];
    }
  })();
  const runtimeStarterTemplates = (() => {
    try {
      return listAgentRuntimeProfileTemplates(profileBaseHome);
    } catch {
      return [];
    }
  })();
  const selectedRuntimeProfile = (() => {
    try {
      return readAgentRuntimeProfileSelection(profileBaseHome);
    } catch {
      return null;
    }
  })();
  const voiceProviders = (() => {
    try {
      return context.platform?.voiceProviderRegistry?.list?.() ?? [];
    } catch {
      return [];
    }
  })();
  const mediaProviders = (() => {
    try {
      return context.platform?.mediaProviderRegistry?.list?.() ?? [];
    } catch {
      return [];
    }
  })();
  const mcpSnapshot = (() => {
    try {
      const servers = context.clients?.mcpApi?.listServerSecurity?.() ?? context.extensions?.mcpRegistry?.listServerSecurity?.() ?? [];
      return {
        serverCount: servers.length,
        connectedCount: servers.filter((server) => server.connected).length,
        quarantinedCount: servers.filter((server) => server.schemaFreshness === 'quarantined').length,
        allowAllCount: servers.filter((server) => server.trustMode === 'allow-all').length,
      };
    } catch {
      return {
        serverCount: 0,
        connectedCount: 0,
        quarantinedCount: 0,
        allowAllCount: 0,
      };
    }
  })();
  const voiceProviderDescriptors: readonly AgentWorkspaceVoiceMediaProviderDescriptor[] = voiceProviders.map((provider) => ({
    id: provider.id,
    label: provider.label,
    capabilities: provider.capabilities,
  }));
  const mediaProviderDescriptors: readonly AgentWorkspaceVoiceMediaProviderDescriptor[] = mediaProviders.map((provider) => ({
    id: provider.id,
    label: provider.label,
    capabilities: provider.capabilities,
  }));
  const warnings: string[] = [];
  if (provider === 'unknown' || model === 'unknown') warnings.push('Provider/model unavailable in this runtime context.');
  if (!context.executeCommand) warnings.push('Command dispatch is unavailable; workspace actions will show guidance only.');
  const ttsProvider = readConfigString(context, 'tts.provider', '(provider default)');
  const ttsVoice = readConfigString(context, 'tts.voice', '(voice default)');
  const ttsLlmProvider = readConfigString(context, 'tts.llmProvider', '');
  const ttsLlmModel = readConfigString(context, 'tts.llmModel', '');
  const embeddingProvider = readConfigString(context, 'provider.embeddingProvider', '(provider default)');
  const reasoningEffort = readConfigString(context, 'provider.reasoningEffort', '(default)');
  const helperEnabled = readConfigBoolean(context, 'helper.enabled', false);
  const toolLlmEnabled = readConfigBoolean(context, 'tools.llmEnabled', false);
  const providerFailureHints = readConfigBoolean(context, 'behavior.suggestAlternativeOnProviderFail', false);
  const cacheEnabled = readConfigBoolean(context, 'cache.enabled', true);
  const cacheStableTtl = readConfigString(context, 'cache.stableTtl', '(default)');
  const cacheMonitorHitRate = readConfigBoolean(context, 'cache.monitorHitRate', true);
  const cacheHitRateWarningThreshold = readConfigNumber(context, 'cache.hitRateWarningThreshold', 0.3);
  const hitlMode = readConfigString(context, 'behavior.hitlMode', '(default)');
  const guidanceMode = readConfigString(context, 'behavior.guidanceMode', '(default)');
  const saveHistory = readConfigBoolean(context, 'behavior.saveHistory', true);
  const autoApprove = readConfigBoolean(context, 'behavior.autoApprove', false);
  const autoCompactThreshold = readConfigNumber(context, 'behavior.autoCompactThreshold', 0);
  const staleContextWarnings = readConfigBoolean(context, 'behavior.staleContextWarnings', false);
  const showThinking = readConfigBoolean(context, 'display.showThinking', false);
  const showReasoningSummary = readConfigBoolean(context, 'display.showReasoningSummary', false);
  const theme = readConfigString(context, 'display.theme', '(default)');
  const stream = readConfigBoolean(context, 'display.stream', true);
  const lineNumbers = readConfigString(context, 'display.lineNumbers', '(default)');
  const operationalMessages = readConfigString(context, 'ui.operationalMessages', '(default)');
  const systemMessages = readConfigString(context, 'ui.systemMessages', '(default)');
  const releaseChannel = readConfigString(context, 'release.channel', '(default)');
  const permissionMode = readConfigString(context, 'permissions.mode', '(default)');
  const toolAutoHeal = readConfigBoolean(context, 'tools.autoHeal', false);
  const toolsDefaultTokenBudget = readConfigNumber(context, 'tools.defaultTokenBudget', 5000);
  const artifactMaxBytes = readConfigNumber(context, 'storage.artifacts.maxBytes', 512 * 1024 * 1024);
  const rawPromptTelemetry = readConfigBoolean(context, 'telemetry.includeRawPrompts', false);
  const automationEnabled = readConfigBoolean(context, 'automation.enabled', false);
  const automationMaxConcurrentRuns = readConfigNumber(context, 'automation.maxConcurrentRuns', 4);
  const automationRunHistoryLimit = readConfigNumber(context, 'automation.runHistoryLimit', 100);
  const automationDefaultTimeoutMs = readConfigNumber(context, 'automation.defaultTimeoutMs', 15 * 60 * 1000);
  const automationCatchUpWindowMinutes = readConfigNumber(context, 'automation.catchUpWindowMinutes', 30);
  const automationFailureCooldownMs = readConfigNumber(context, 'automation.failureCooldownMs', 5 * 60 * 1000);
  const automationDeleteAfterRun = readConfigBoolean(context, 'automation.deleteAfterRun', false);
  const runtimeBaseUrl = `http://${host}:${port}`;
  const companionAccess = (() => {
    const homeDirectory = context.workspace?.shellPaths?.homeDirectory ?? '';
    const tokenRecord: ConnectedHostOperatorToken = homeDirectory.length > 0
      ? readConnectedHostOperatorToken(homeDirectory)
      : { path: '(Agent home unavailable)', present: false, token: null };
    const tokenFingerprint = tokenRecord.token ? connectedHostOperatorTokenFingerprint(tokenRecord.token) : null;
    const pairingReady = Boolean(tokenRecord.token);
    const nextStep = tokenRecord.error
      ? 'Repair the connected-host operator token file through the owning GoodVibes host, then rerun /pair.'
      : pairingReady
        ? 'Use /pair to scan the QR code. Manual token display stays hidden unless /pair --show-token --yes is used.'
        : 'Pair or provision connected-host access through the owning GoodVibes host, then rerun /pair.';
    return {
      surface: GOODVIBES_AGENT_PAIRING_SURFACE,
      hostUrl: runtimeBaseUrl,
      tokenPath: tokenRecord.path,
      tokenPresent: tokenRecord.present,
      tokenReadable: Boolean(tokenRecord.token),
      tokenFingerprint,
      tokenError: tokenRecord.error ?? null,
      pairingReady,
      qrCommand: '/pair',
      manualTokenCommand: '/pair --show-token --yes',
      nextStep,
    } as const;
  })();
  const subscriptionSnapshot = (() => {
    try {
      const manager = context.platform?.subscriptionManager;
      const services = context.platform?.serviceRegistry;
      const active = manager?.list?.().length ?? 0;
      const pending = manager?.listPending?.().length ?? 0;
      const available = services ? listAvailableSubscriptionProviders(services.getAll()).length : 0;
      return { active, pending, available };
    } catch {
      return { active: 0, pending: 0, available: 0 };
    }
  })();
  const channels = buildAgentWorkspaceChannels(context);
  const channelSetupGuide = buildAgentWorkspaceChannelSetupGuide(channels);
  const voiceMediaReadiness = buildAgentWorkspaceVoiceMediaReadiness({
    context,
    voiceProviders: voiceProviderDescriptors,
    mediaProviders: mediaProviderDescriptors,
  });
  const setupChecklist = buildAgentWorkspaceSetupChecklist({
    provider,
    model,
    runtimeBaseUrl,
    connectedHostTokenPresent: companionAccess.tokenPresent,
    connectedHostTokenReadable: companionAccess.tokenReadable,
    connectedHostTokenPath: companionAccess.tokenPath,
    connectedHostTokenError: companionAccess.tokenError,
    activeSubscriptionCount: subscriptionSnapshot.active,
    pendingSubscriptionCount: subscriptionSnapshot.pending,
    availableSubscriptionProviderCount: subscriptionSnapshot.available,
    sessionMemoryCount,
    localMemoryCount: memorySnapshot.count,
    localMemoryReviewQueueCount: memorySnapshot.reviewQueueCount,
    localNoteCount: noteSnapshot.count,
    localNoteReviewQueueCount: noteSnapshot.reviewQueueCount,
    routineCount: routineSnapshot.count,
    enabledRoutineCount: routineSnapshot.enabled,
    missingRoutineRequirementCount: routineSnapshot.items.reduce((total, item) => total + (item.missingRequirementCount ?? 0), 0),
    skillCount: skillSnapshot.count,
    enabledSkillCount: skillSnapshot.enabled,
    skillBundleCount: skillSnapshot.bundleCount,
    enabledSkillBundleCount: skillSnapshot.enabledBundleCount,
    missingSkillRequirementCount: skillSnapshot.items.reduce((total, item) => total + (item.missingRequirementCount ?? 0), 0),
    activePersonaName: personaSnapshot.activeName,
    discoveredPersonas: discoveredBehavior.personas,
    discoveredSkills: discoveredBehavior.skills,
    discoveredRoutines: discoveredBehavior.routines,
    readyChannelCount: channels.filter((channel) => channel.ready).length,
    voiceProviderCount: voiceProviders.length,
    mediaProviderCount: mediaProviders.length,
    runtimeProfileCount: runtimeProfiles.length,
    runtimeStarterTemplateCount: runtimeStarterTemplates.length,
  });
  const setupWizard = buildWorkspaceSetupWizard(
    setupChecklist,
    buildSetupSmokeHistory(artifactListSnapshot.items, artifactListSnapshot.available),
    buildSetupWizardCheckpoint(context),
  );

  return {
    provider,
    model,
    modelDisplayName: currentModel?.displayName ?? model,
    embeddingProvider,
    reasoningEffort,
    helperEnabled,
    toolLlmEnabled,
    providerFailureHints,
    cacheEnabled,
    cacheStableTtl,
    cacheMonitorHitRate,
    cacheHitRateWarningThreshold,
    hitlMode,
    guidanceMode,
    saveHistory,
    autoApprove,
    autoCompactThreshold,
    staleContextWarnings,
    showThinking,
    showReasoningSummary,
    theme,
    stream,
    lineNumbers,
    operationalMessages,
    systemMessages,
    releaseChannel,
    permissionMode,
    toolAutoHeal,
    toolsDefaultTokenBudget,
    artifactMaxBytes,
    rawPromptTelemetry,
    automationEnabled,
    automationMaxConcurrentRuns,
    automationRunHistoryLimit,
    automationDefaultTimeoutMs,
    automationCatchUpWindowMinutes,
    automationFailureCooldownMs,
    automationDeleteAfterRun,
    sessionId: context.session?.runtime?.sessionId ?? 'unknown',
    workingDirectory: context.workspace?.shellPaths?.workingDirectory ?? 'unavailable',
    homeDirectory: context.workspace?.shellPaths?.homeDirectory ?? 'unavailable',
    runtimeBaseUrl,
    runtimeOwnership: 'external',
    activeSubscriptionCount: subscriptionSnapshot.active,
    pendingSubscriptionCount: subscriptionSnapshot.pending,
    availableSubscriptionProviderCount: subscriptionSnapshot.available,
    sessionMemoryCount,
    localMemoryCount: memorySnapshot.count,
    localMemoryReviewQueueCount: memorySnapshot.reviewQueueCount,
    localMemoryPromptActiveCount: memorySnapshot.promptActiveCount,
    localMemories: memorySnapshot.items,
    localNoteCount: noteSnapshot.count,
    localNoteReviewQueueCount: noteSnapshot.reviewQueueCount,
    localNotes: noteSnapshot.items,
    researchSourceCount: researchSourceSnapshot.count,
    researchSourceCandidateCount: researchSourceSnapshot.candidate,
    researchSourceReviewedCount: researchSourceSnapshot.reviewed,
    researchSourceRejectedCount: researchSourceSnapshot.rejected,
    researchSourceUsedCount: researchSourceSnapshot.used,
    researchRunCount: researchRunSnapshot.count,
    researchRunPlannedCount: researchRunSnapshot.planned,
    researchRunRunningCount: researchRunSnapshot.running,
    researchRunPausedCount: researchRunSnapshot.paused,
    researchRunBlockedCount: researchRunSnapshot.blocked,
    researchRunTerminalCount: researchRunSnapshot.terminal,
    researchRuns: researchRunSnapshot.items,
    recentReviewerHandoffArtifactCount: recentReviewerHandoffs.count,
    recentReviewerHandoffArtifacts: recentReviewerHandoffs.items,
    reviewerReadinessBadge: reviewerBadge,
    reviewPacketTimeline,
    reviewPacketDefaults,
    reviewPacketWizard,
    localRoutineCount: routineSnapshot.count,
    enabledRoutineCount: routineSnapshot.enabled,
    localRoutines: routineSnapshot.items,
    routineScheduleReceiptCount: routineScheduleReceipts.count,
    successfulRoutineScheduleReceiptCount: routineScheduleReceipts.successful,
    failedRoutineScheduleReceiptCount: routineScheduleReceipts.failed,
    latestRoutineScheduleReceipt: routineScheduleReceipts.latest,
    localSkillCount: skillSnapshot.count,
    enabledSkillCount: skillSnapshot.enabled,
    localSkillBundleCount: skillSnapshot.bundleCount,
    enabledSkillBundleCount: skillSnapshot.enabledBundleCount,
    activeSkillCount: skillSnapshot.active,
    localSkillBundles: skillSnapshot.bundleItems,
    localSkills: skillSnapshot.items,
    localPersonaCount: personaSnapshot.count,
    activePersonaName: personaSnapshot.activeName,
    localPersonas: personaSnapshot.items,
    discoveredBehavior,
    knowledgeRoute: '/api/goodvibes-agent/knowledge',
    knowledgeIsolation: 'agent-only',
    executionPolicy: 'serial-proactive',
    delegatedReviewPolicy: 'explicit-build-delegation-only',
    companionAccess,
    channels,
    channelSetupGuide,
    voiceProviderCount: voiceProviders.length,
    voiceStreamingProviderCount: voiceProviders.filter((entry) => entry.capabilities.includes('tts-stream')).length,
    voiceSttProviderCount: voiceProviders.filter((entry) => entry.capabilities.includes('stt')).length,
    voiceRealtimeProviderCount: voiceProviders.filter((entry) => entry.capabilities.includes('realtime')).length,
    ttsProvider,
    ttsVoice,
    ttsResponseModel: ttsLlmProvider && ttsLlmModel ? `${ttsLlmProvider}/${ttsLlmModel}` : '(chat route)',
    voiceSurfaceEnabled: readConfigBoolean(context, 'ui.voiceEnabled', false),
    mediaProviderCount: mediaProviders.length,
    mediaUnderstandingProviderCount: mediaProviders.filter((entry) => entry.capabilities.includes('understand')).length,
    mediaGenerationProviderCount: mediaProviders.filter((entry) => entry.capabilities.includes('generate')).length,
    voiceMediaReadiness,
    mcpServerCount: mcpSnapshot.serverCount,
    mcpConnectedServerCount: mcpSnapshot.connectedCount,
    mcpQuarantinedServerCount: mcpSnapshot.quarantinedCount,
    mcpAllowAllServerCount: mcpSnapshot.allowAllCount,
    browserToolExposureEnabled: readConfigBoolean(context, 'web.enabled', false),
    browserToolPublicBaseUrl: readConfigString(context, 'web.publicBaseUrl', '(not configured)'),
    activeRuntimeProfile: inferActiveRuntimeProfile(context.workspace?.shellPaths?.homeDirectory ?? ''),
    selectedRuntimeProfile: selectedRuntimeProfile?.id ?? null,
    selectedRuntimeProfileExists: selectedRuntimeProfile?.exists ?? false,
    selectedRuntimeProfileSelectedAt: selectedRuntimeProfile?.selectedAt ?? null,
    runtimeProfileCount: runtimeProfiles.length,
    runtimeProfiles: runtimeProfiles.map(summarizeRuntimeProfile),
    runtimeProfileRoot: getAgentRuntimeProfilesRoot(profileBaseHome),
    runtimeStarterTemplateCount: runtimeStarterTemplates.length,
    localStarterTemplateCount: runtimeStarterTemplates.filter((template) => template.source === 'local').length,
    runtimeStarterTemplates: runtimeStarterTemplates.map(summarizeStarterTemplate),
    setupChecklist,
    setupWizard,
    warnings,
  };
}
