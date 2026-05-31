import { basename, sep } from 'node:path';
import type { CommandContext } from './command-registry.ts';
import { AgentPersonaRegistry, type AgentPersonaRecord } from '../agent/persona-registry.ts';
import { AgentRoutineRegistry, type AgentRoutineRecord } from '../agent/routine-registry.ts';
import { AgentSkillRegistry, type AgentSkillRecord } from '../agent/skill-registry.ts';
import { getAgentRuntimeProfilesRoot, listAgentRuntimeProfiles, listAgentRuntimeProfileTemplates } from '../agent/runtime-profile.ts';
import { buildAgentWorkspaceChannels } from './agent-workspace-channels.ts';
import { buildAgentWorkspaceSetupChecklist } from './agent-workspace-setup.ts';
import type { AgentWorkspaceLocalLibraryItem, AgentWorkspaceRuntimeSnapshot } from './agent-workspace-types.ts';

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
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    reviewState: skill.reviewState,
    source: skill.source,
    tags: skill.tags,
    triggers: skill.triggers,
    enabled: skill.enabled,
  };
}

function summarizeRoutineItem(routine: AgentRoutineRecord): AgentWorkspaceLocalLibraryItem {
  return {
    id: routine.id,
    name: routine.name,
    description: routine.description,
    reviewState: routine.reviewState,
    source: routine.source,
    tags: routine.tags,
    triggers: routine.triggers,
    enabled: routine.enabled,
    startCount: routine.startCount,
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
  const skillSnapshot = (() => {
    try {
      const shellPaths = context.workspace?.shellPaths;
      if (!shellPaths) return { count: 0, enabled: 0, items: [] };
      const snapshot = AgentSkillRegistry.fromShellPaths(shellPaths).snapshot();
      return {
        count: snapshot.skills.length,
        enabled: snapshot.enabledSkills.length,
        items: snapshot.skills.map(summarizeSkillItem),
      };
    } catch {
      return { count: 0, enabled: 0, items: [] };
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
  const runtimeProfiles = (() => {
    try {
      return listAgentRuntimeProfiles(context.workspace?.shellPaths?.homeDirectory ?? '');
    } catch {
      return [];
    }
  })();
  const configProfileCount = (() => {
    try {
      return context.workspace?.profileManager?.list?.().length ?? 0;
    } catch {
      return 0;
    }
  })();
  const runtimeStarterTemplates = (() => {
    try {
      return listAgentRuntimeProfileTemplates(context.workspace?.shellPaths?.homeDirectory ?? '');
    } catch {
      return [];
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
  const warnings: string[] = [];
  if (provider === 'unknown' || model === 'unknown') warnings.push('Provider/model unavailable in this runtime context.');
  if (!context.executeCommand) warnings.push('Command dispatch is unavailable; workspace actions will show guidance only.');
  const ttsProvider = readConfigString(context, 'tts.provider', '(provider default)');
  const ttsVoice = readConfigString(context, 'tts.voice', '(voice default)');
  const ttsLlmProvider = readConfigString(context, 'tts.llmProvider', '');
  const ttsLlmModel = readConfigString(context, 'tts.llmModel', '');
  const daemonBaseUrl = `http://${host}:${port}`;
  const channels = buildAgentWorkspaceChannels(context);
  const setupChecklist = buildAgentWorkspaceSetupChecklist({
    provider,
    model,
    daemonBaseUrl,
    sessionMemoryCount,
    routineCount: routineSnapshot.count,
    enabledRoutineCount: routineSnapshot.enabled,
    skillCount: skillSnapshot.count,
    enabledSkillCount: skillSnapshot.enabled,
    activePersonaName: personaSnapshot.activeName,
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
    daemonBaseUrl,
    daemonOwnership: 'external',
    sessionMemoryCount,
    localRoutineCount: routineSnapshot.count,
    enabledRoutineCount: routineSnapshot.enabled,
    localRoutines: routineSnapshot.items,
    localSkillCount: skillSnapshot.count,
    enabledSkillCount: skillSnapshot.enabled,
    localSkills: skillSnapshot.items,
    localPersonaCount: personaSnapshot.count,
    activePersonaName: personaSnapshot.activeName,
    localPersonas: personaSnapshot.items,
    knowledgeRoute: '/api/goodvibes-agent/knowledge',
    knowledgeIsolation: 'agent-only',
    executionPolicy: 'serial-proactive',
    wrfcPolicy: 'explicit-build-delegation-only',
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
    browserSurfaceEnabled: readConfigBoolean(context, 'web.enabled', false),
    browserSurfacePublicBaseUrl: readConfigString(context, 'web.publicBaseUrl', '(not configured)'),
    activeRuntimeProfile: inferActiveRuntimeProfile(context.workspace?.shellPaths?.homeDirectory ?? ''),
    runtimeProfileCount: runtimeProfiles.length,
    runtimeProfileRoot: getAgentRuntimeProfilesRoot(context.workspace?.shellPaths?.homeDirectory ?? ''),
    runtimeStarterTemplateCount: runtimeStarterTemplates.length,
    localStarterTemplateCount: runtimeStarterTemplates.filter((template) => template.source === 'local').length,
    configProfileCount,
    setupChecklist,
    warnings,
  };
}
