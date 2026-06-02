import { basename, sep } from 'node:path';
import type { MemoryRecord } from '@pellux/goodvibes-sdk/platform/state';
import type { CommandContext } from './command-registry.ts';
import { AgentNoteRegistry, type AgentNoteRecord } from '../agent/note-registry.ts';
import { AgentPersonaRegistry, type AgentPersonaRecord } from '../agent/persona-registry.ts';
import { AgentRoutineRegistry, evaluateAgentRoutineReadiness, type AgentRoutineRecord } from '../agent/routine-registry.ts';
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
import { buildAgentWorkspaceSetupChecklist } from './agent-workspace-setup.ts';
import { buildAgentWorkspaceVoiceMediaReadiness, type AgentWorkspaceVoiceMediaProviderDescriptor } from './agent-workspace-voice-media.ts';
import type {
  AgentWorkspaceLocalLibraryItem,
  AgentWorkspaceRoutineScheduleReceiptSummary,
  AgentWorkspaceRuntimeProfileItem,
  AgentWorkspaceRuntimeSnapshot,
  AgentWorkspaceRuntimeStarterTemplateItem,
} from './agent-workspace-types.ts';

type AgentWorkspaceConfigReader = {
  get(key: string): unknown;
};

function readConfigString(context: CommandContext, key: string, fallback: string): string {
  try {
    const configManager = context.platform?.configManager as unknown as AgentWorkspaceConfigReader | undefined;
    const value = configManager?.get(key);
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
  } catch {
    return fallback;
  }
}

function readConfigNumber(context: CommandContext, key: string, fallback: number): number {
  try {
    const configManager = context.platform?.configManager as unknown as AgentWorkspaceConfigReader | undefined;
    const value = configManager?.get(key);
    const numberValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
  } catch {
    return fallback;
  }
}

function readConfigBoolean(context: CommandContext, key: string, fallback: boolean): boolean {
  try {
    const configManager = context.platform?.configManager as unknown as AgentWorkspaceConfigReader | undefined;
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
    source: persona.source,
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
    source: skill.source,
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
    source: bundle.source,
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
    source: routine.source,
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

function summarizeMemoryItem(record: MemoryRecord): AgentWorkspaceLocalLibraryItem {
  const detail = record.detail?.trim();
  return {
    id: record.id,
    name: record.summary,
    description: detail && detail.length > 0 ? detail : `${record.scope}/${record.cls}`,
    reviewState: record.reviewState,
    source: 'agent-memory',
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
    ? `${preview.slice(0, 160)}${preview.length > 160 ? '...' : ''} Source: ${note.sourceUrl}`
    : preview;
  return {
    id: note.id,
    name: note.title,
    description,
    reviewState: note.reviewState,
    source: note.source,
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
    sessionId: context.session?.runtime?.sessionId ?? 'unknown',
    workingDirectory: context.workspace?.shellPaths?.workingDirectory ?? 'unavailable',
    homeDirectory: context.workspace?.shellPaths?.homeDirectory ?? 'unavailable',
    runtimeBaseUrl,
    runtimeOwnership: 'external',
    sessionMemoryCount,
    localMemoryCount: memorySnapshot.count,
    localMemoryReviewQueueCount: memorySnapshot.reviewQueueCount,
    localMemoryPromptActiveCount: memorySnapshot.promptActiveCount,
    localMemories: memorySnapshot.items,
    localNoteCount: noteSnapshot.count,
    localNoteReviewQueueCount: noteSnapshot.reviewQueueCount,
    localNotes: noteSnapshot.items,
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
    wrfcPolicy: 'explicit-build-delegation-only',
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
