import { basename, sep } from 'node:path';
import { listAvailableSubscriptionProviders } from '@pellux/goodvibes-sdk/platform/config';
import type { ArtifactDescriptor } from '@pellux/goodvibes-sdk/platform/artifacts';
import type { MemoryRecord } from '@pellux/goodvibes-sdk/platform/state';
import type { CommandContext } from './command-registry.ts';
import { AgentNoteRegistry, type AgentNoteRecord } from '../agent/note-registry.ts';
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
import { GOODVIBES_AGENT_PAIRING_SURFACE } from '../config/surface.ts';
import { connectedHostOperatorTokenFingerprint, readConnectedHostOperatorToken, type ConnectedHostOperatorToken } from '../runtime/connected-host-auth.ts';
import { buildAgentWorkspaceChannels } from './agent-workspace-channels.ts';
import { getAgentWorkspaceConfigReader } from './agent-workspace-config-reader.ts';
import { buildAgentWorkspaceSetupChecklist } from './agent-workspace-setup.ts';
import { buildAgentWorkspaceVoiceMediaReadiness, type AgentWorkspaceVoiceMediaProviderDescriptor } from './agent-workspace-voice-media.ts';
import type {
  AgentWorkspaceLocalLibraryItem,
  AgentWorkspaceRecentReviewerHandoffArtifact,
  AgentWorkspaceResearchRunSummary,
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

function isReviewerHandoffArtifact(artifact: ArtifactDescriptor): boolean {
  const purpose = readArtifactMetadataString(artifact.metadata, 'purpose');
  if (purpose === 'agent-model-compare-handoff') return true;
  if (purpose.length > 0) return false;
  return (artifact.filename ?? '').startsWith('blind-model-comparison-handoff-');
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
  const recentReviewerHandoffs = (() => {
    try {
      const artifacts = [...(context.platform?.artifactStore?.list?.(50) ?? [])];
      const handoffs = artifacts
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
    warnings,
  };
}
