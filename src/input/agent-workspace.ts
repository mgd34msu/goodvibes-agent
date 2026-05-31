import type { InputToken } from '@pellux/goodvibes-sdk/platform/core';
import type { ShellPathService } from '@/runtime/index.ts';
import { basename, sep } from 'node:path';
import type { CommandContext } from './command-registry.ts';
import { AgentPersonaRegistry, type AgentPersonaRecord } from '../agent/persona-registry.ts';
import { AgentRoutineRegistry, type AgentRoutineRecord } from '../agent/routine-registry.ts';
import { AgentSkillRegistry, type AgentSkillRecord } from '../agent/skill-registry.ts';
import { getAgentRuntimeProfilesRoot, listAgentRuntimeProfiles, listAgentRuntimeProfileTemplates } from '../agent/runtime-profile.ts';
import {
  buildAgentWorkspaceChannels,
  type AgentWorkspaceChannelStatus,
} from './agent-workspace-channels.ts';
import {
  buildAgentWorkspaceSetupChecklist,
  type AgentWorkspaceSetupChecklistItem,
} from './agent-workspace-setup.ts';

export type { AgentWorkspaceChannelRisk, AgentWorkspaceChannelStatus } from './agent-workspace-channels.ts';

export const AGENT_WORKSPACE_MODAL_NAME = 'agentWorkspace';

export type AgentWorkspaceFocusPane = 'categories' | 'actions';

export type AgentWorkspaceActionKind = 'command' | 'guidance' | 'workspace' | 'editor' | 'local-selection' | 'local-operation';

export type AgentWorkspaceLocalEditorKind = 'persona' | 'skill' | 'routine';

export type AgentWorkspaceLocalOperation =
  | 'persona-edit'
  | 'persona-use'
  | 'persona-review'
  | 'persona-clear'
  | 'persona-delete'
  | 'skill-edit'
  | 'skill-enable'
  | 'skill-disable'
  | 'skill-review'
  | 'skill-delete'
  | 'routine-edit'
  | 'routine-start'
  | 'routine-enable'
  | 'routine-disable'
  | 'routine-review'
  | 'routine-delete';

export interface AgentWorkspaceEditorField {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly required: boolean;
  readonly multiline: boolean;
  readonly hint: string;
}

export interface AgentWorkspaceLocalEditor {
  readonly kind: AgentWorkspaceLocalEditorKind;
  readonly mode: 'create' | 'update' | 'delete';
  readonly recordId?: string;
  readonly title: string;
  readonly fields: readonly AgentWorkspaceEditorField[];
  readonly selectedFieldIndex: number;
  readonly message: string;
}

export interface AgentWorkspaceAction {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly command?: string;
  readonly targetCategoryId?: string;
  readonly editorKind?: AgentWorkspaceLocalEditorKind;
  readonly localKind?: AgentWorkspaceLocalEditorKind;
  readonly selectionDelta?: number;
  readonly localOperation?: AgentWorkspaceLocalOperation;
  readonly kind: AgentWorkspaceActionKind;
  readonly safety: 'safe' | 'read-only' | 'delegates' | 'blocked';
}

export interface AgentWorkspaceCategory {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  readonly summary: string;
  readonly detail: string;
  readonly actions: readonly AgentWorkspaceAction[];
}

export type AgentWorkspaceCommandDispatcher = (command: string) => void;

export type AgentWorkspaceActionResultKind = 'guidance' | 'blocked' | 'dispatched' | 'refreshed' | 'error';

export interface AgentWorkspaceActionResult {
  readonly kind: AgentWorkspaceActionResultKind;
  readonly title: string;
  readonly detail: string;
  readonly command?: string;
  readonly safety?: AgentWorkspaceAction['safety'];
}

export interface AgentWorkspaceLocalLibraryItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly reviewState: string;
  readonly source: string;
  readonly tags: readonly string[];
  readonly triggers: readonly string[];
  readonly active?: boolean;
  readonly enabled?: boolean;
  readonly startCount?: number;
}

type AgentWorkspaceConfigReader = {
  get(key: string): unknown;
};

export interface AgentWorkspaceRuntimeSnapshot {
  readonly provider: string;
  readonly model: string;
  readonly modelDisplayName: string;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly homeDirectory: string;
  readonly daemonBaseUrl: string;
  readonly daemonOwnership: 'external';
  readonly sessionMemoryCount: number;
  readonly localRoutineCount: number;
  readonly enabledRoutineCount: number;
  readonly localRoutines: readonly AgentWorkspaceLocalLibraryItem[];
  readonly localSkillCount: number;
  readonly enabledSkillCount: number;
  readonly localSkills: readonly AgentWorkspaceLocalLibraryItem[];
  readonly localPersonaCount: number;
  readonly activePersonaName: string;
  readonly localPersonas: readonly AgentWorkspaceLocalLibraryItem[];
  readonly knowledgeRoute: '/api/goodvibes-agent/knowledge';
  readonly knowledgeIsolation: 'agent-only';
  readonly executionPolicy: 'serial-proactive';
  readonly wrfcPolicy: 'explicit-build-delegation-only';
  readonly channels: readonly AgentWorkspaceChannelStatus[];
  readonly voiceProviderCount: number;
  readonly voiceStreamingProviderCount: number;
  readonly voiceSttProviderCount: number;
  readonly voiceRealtimeProviderCount: number;
  readonly ttsProvider: string;
  readonly ttsVoice: string;
  readonly ttsResponseModel: string;
  readonly voiceSurfaceEnabled: boolean;
  readonly mediaProviderCount: number;
  readonly mediaUnderstandingProviderCount: number;
  readonly mediaGenerationProviderCount: number;
  readonly browserSurfaceEnabled: boolean;
  readonly browserSurfacePublicBaseUrl: string;
  readonly activeRuntimeProfile: string;
  readonly runtimeProfileCount: number;
  readonly runtimeProfileRoot: string;
  readonly runtimeStarterTemplateCount: number;
  readonly localStarterTemplateCount: number;
  readonly configProfileCount: number;
  readonly setupChecklist: readonly AgentWorkspaceSetupChecklistItem[];
  readonly warnings: readonly string[];
}

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

export const AGENT_WORKSPACE_CATEGORIES: readonly AgentWorkspaceCategory[] = [
  {
    id: 'home',
    group: 'OPERATE',
    label: 'Home',
    summary: 'Main operator surface for normal assistant work.',
    detail: 'Use this as the Agent front door: chat in the main conversation, inspect state, choose model/provider, and open setup surfaces without switching into coding-TUI behavior.',
    actions: [
      { id: 'chat', label: 'Continue assistant chat', detail: 'Close this workspace and type a normal message. Agent work stays serial in the main conversation.', kind: 'guidance', safety: 'safe' },
      { id: 'model', label: 'Choose model', detail: 'Open the model/provider workspace for the Agent chat route.', command: '/model', kind: 'command', safety: 'safe' },
      { id: 'setup-home', label: 'Setup checklist', detail: 'Jump to the first-run checklist for provider, knowledge, personas, skills, routines, memory, channels, and voice/media.', targetCategoryId: 'setup', kind: 'workspace', safety: 'safe' },
      { id: 'knowledge-home', label: 'Agent Knowledge', detail: 'Jump to isolated Agent Knowledge status, ingest, search, and review flows.', targetCategoryId: 'knowledge', kind: 'workspace', safety: 'read-only' },
      { id: 'memory-home', label: 'Memory, skills, routines', detail: 'Jump to local memory, persona, skill, and routine setup. These are core Agent product features.', targetCategoryId: 'memory', kind: 'workspace', safety: 'safe' },
      { id: 'channels-home', label: 'Channels', detail: 'Jump to companion pairing and channel readiness without changing daemon lifecycle.', targetCategoryId: 'channels', kind: 'workspace', safety: 'read-only' },
      { id: 'voice-home', label: 'Voice and media', detail: 'Jump to voice, TTS, image input, browser, and node posture setup.', targetCategoryId: 'voice-media', kind: 'workspace', safety: 'safe' },
      { id: 'help', label: 'Browse commands', detail: 'Open registry-driven command help.', command: '/help', kind: 'command', safety: 'safe' },
      { id: 'health', label: 'Review health', detail: 'Show the local health review surface without starting or mutating daemon services.', command: '/health review', kind: 'command', safety: 'read-only' },
    ],
  },
  {
    id: 'setup',
    group: 'SETUP',
    label: 'Setup',
    summary: 'Configuration, auth, provider, and onboarding surfaces.',
    detail: 'Agent connects to an external daemon and owns local assistant configuration only. Daemon lifecycle and listener posture remain external.',
    actions: [
      { id: 'config', label: 'Open config workspace', detail: 'Use the TUI-derived fullscreen settings workspace.', command: '/config', kind: 'command', safety: 'safe' },
      { id: 'onboarding', label: 'Open setup wizard', detail: 'Review Agent runtime settings in the fullscreen setup flow.', command: '/onboarding', kind: 'command', safety: 'safe' },
      { id: 'setup-provider-model', label: 'Provider and model', detail: 'Choose the provider/model route for normal assistant chat.', command: '/model', kind: 'command', safety: 'safe' },
      { id: 'setup-agent-knowledge', label: 'Agent Knowledge', detail: 'Inspect the isolated Agent Knowledge store before ingesting source-backed material.', command: '/knowledge status', kind: 'command', safety: 'read-only' },
      { id: 'setup-runtime-profiles', label: 'Runtime profiles', detail: 'Browse starter templates for isolated Agent homes and operator identities.', command: '/agent-profile templates', kind: 'command', safety: 'read-only' },
      { id: 'setup-personas', label: 'Personas', detail: 'Create or select the active local Agent persona.', targetCategoryId: 'personas', kind: 'workspace', safety: 'safe' },
      { id: 'setup-skills', label: 'Skills', detail: 'Create, review, and enable reusable local Agent skills.', targetCategoryId: 'skills', kind: 'workspace', safety: 'safe' },
      { id: 'setup-routines', label: 'Routines', detail: 'Create, review, and enable local Agent routines before any explicit schedule promotion.', targetCategoryId: 'routines', kind: 'workspace', safety: 'safe' },
      { id: 'setup-memory', label: 'Local memory', detail: 'Inspect local/session memory; secrets stay rejected or redacted.', command: '/memory', kind: 'command', safety: 'read-only' },
      { id: 'setup-channels', label: 'Channels', detail: 'Open companion pairing and channel readiness setup.', command: '/pair', kind: 'command', safety: 'safe' },
      { id: 'setup-voice-media', label: 'Voice and media', detail: 'Open TTS/media settings for voice and image-capable Agent flows.', command: '/config tts', kind: 'command', safety: 'safe' },
      { id: 'provider', label: 'Provider status', detail: 'Review provider/model posture.', command: '/provider', kind: 'command', safety: 'read-only' },
      { id: 'auth', label: 'Auth review', detail: 'Review authentication posture without printing token values.', command: '/auth review', kind: 'command', safety: 'read-only' },
    ],
  },
  {
    id: 'channels',
    group: 'SETUP',
    label: 'Channels',
    summary: 'Companion pairing, channel posture, and delivery safety.',
    detail: 'Agent uses externally owned daemon channel surfaces. Pairing, account inspection, and readiness checks are visible here; inbound delivery and public channel exposure stay policy-gated.',
    actions: [
      { id: 'pair', label: 'Pair companion', detail: 'Open the TUI-derived QR pairing surface for companion app setup.', command: '/pair', kind: 'command', safety: 'safe' },
      { id: 'communication', label: 'Communication routes', detail: 'Inspect structured communication routes and recent activity.', command: '/communication', kind: 'command', safety: 'read-only' },
      { id: 'setup-review', label: 'Channel setup review', detail: 'Review setup posture without starting listeners or mutating daemon surface state.', command: '/setup review', kind: 'command', safety: 'read-only' },
      { id: 'channel-safety', label: 'Delivery safety', detail: 'External messages, channel DMs, and public delivery targets require explicit user action and daemon-side policy. Agent will not silently send or expose channels from this workspace.', kind: 'guidance', safety: 'blocked' },
    ],
  },
  {
    id: 'knowledge',
    group: 'KNOW',
    label: 'Knowledge',
    summary: 'Agent Knowledge/Wiki and source-backed lookup.',
    detail: 'Agent knowledge calls must use the isolated /api/goodvibes-agent/knowledge routes. Default regular wiki and HomeGraph are not the Agent knowledge environment.',
    actions: [
      { id: 'knowledge-status', label: 'Knowledge status', detail: 'Inspect Agent knowledge readiness and counts.', command: '/knowledge status', kind: 'command', safety: 'read-only' },
      { id: 'knowledge-search', label: 'Search Agent knowledge', detail: 'Search the isolated Agent Knowledge index. Close this workspace and provide an actual query.', command: '/knowledge search <query>', kind: 'command', safety: 'read-only' },
      { id: 'knowledge-ingest-url', label: 'Ingest URL', detail: 'Ingest a URL into Agent Knowledge only. Requires an explicit --yes command with a real URL.', command: '/knowledge ingest-url <url> --yes', kind: 'command', safety: 'safe' },
      { id: 'knowledge-import-bookmarks', label: 'Import bookmarks', detail: 'Import a browser bookmark export into Agent Knowledge only. Requires an explicit --yes command with a real path.', command: '/knowledge import-bookmarks <path> --yes', kind: 'command', safety: 'safe' },
      { id: 'knowledge-review-queue', label: 'Review queue', detail: 'Inspect source/node/issue review work before accepting, rejecting, or resolving anything.', command: '/knowledge queue', kind: 'command', safety: 'read-only' },
      { id: 'knowledge-consolidation', label: 'Consolidation review', detail: 'Inspect consolidation candidates and reports before running Agent Knowledge mutations.', command: '/knowledge candidates', kind: 'command', safety: 'read-only' },
      { id: 'knowledge-ask', label: 'Ask Agent knowledge', detail: 'Close this workspace and run /knowledge ask <question> or ask normally in chat.', kind: 'guidance', safety: 'read-only' },
    ],
  },
  {
    id: 'voice-media',
    group: 'SETUP',
    label: 'Voice, Media & Nodes',
    summary: 'Voice, TTS, image input, browser surface, and node/remote posture.',
    detail: 'Voice, media, browser, and node surfaces are first-class operator surfaces. Agent uses the GoodVibes voice/media/provider/browser/remote bones while keeping daemon ownership external and side effects explicit.',
    actions: [
      { id: 'tts-config', label: 'Configure live TTS', detail: 'Open the TUI-derived config workspace at the TTS settings group.', command: '/config tts', kind: 'command', safety: 'safe' },
      { id: 'tts-provider', label: 'Choose TTS provider', detail: 'Open provider/model routing for spoken responses through the settings flow.', command: '/config tts.provider', kind: 'command', safety: 'safe' },
      { id: 'tts-speak', label: 'Speak a prompt', detail: 'Submit a normal assistant turn and play the reply through configured live TTS. Close this workspace and provide real prompt text.', command: '/tts <prompt>', kind: 'command', safety: 'safe' },
      { id: 'image-attach', label: 'Attach image input', detail: 'Attach an image to the next assistant turn. Close this workspace and provide a real path and prompt.', command: '/image <path> <prompt>', kind: 'command', safety: 'safe' },
      { id: 'browser-surface', label: 'Browser surface status', detail: 'Inspect browser/web posture through setup diagnostics without starting listeners or daemon services.', command: '/setup services', kind: 'command', safety: 'read-only' },
      { id: 'mcp-browser', label: 'Browser MCP tools', detail: 'Inspect MCP servers and tools, including browser/automation roles, without mutating server setup.', command: '/mcp servers', kind: 'command', safety: 'read-only' },
      { id: 'node-posture', label: 'Node/remote posture', detail: 'Inspect remote runner/node posture. Dispatch remains blocked unless the task is explicit build delegation to TUI.', command: '/remote list', kind: 'command', safety: 'read-only' },
    ],
  },
  {
    id: 'profiles',
    group: 'SETUP',
    label: 'Profiles & Portability',
    summary: 'Isolated Agent homes, config profiles, and setup bundles.',
    detail: 'Profiles isolate agent state. GoodVibes Agent exposes named runtime homes, config profile pickers, profile-sync bundles, setup transfer bundles, and support bundles while keeping the daemon external.',
    actions: [
      { id: 'profiles-open', label: 'Open config profiles', detail: 'Open the TUI-derived config profile picker for display/provider/behavior profile files.', command: '/profiles', kind: 'command', safety: 'safe' },
      { id: 'runtime-profile-guide', label: 'Starter authoring guide', detail: 'Open the Agent-local starter authoring flow inside the TUI command surface.', command: '/agent-profile guide', kind: 'command', safety: 'safe' },
      { id: 'runtime-profile-templates', label: 'Browse starter templates', detail: 'List built-in and local Agent starter templates with persona, skill, routine, and source details.', command: '/agent-profile templates', kind: 'command', safety: 'read-only' },
      { id: 'profile-sync-list', label: 'Profile sync list', detail: 'Inspect saved config profiles available for export/import.', command: '/profilesync list', kind: 'command', safety: 'read-only' },
      { id: 'profile-sync-export', label: 'Export profile sync', detail: 'Export config profiles to a portable bundle. Requires a real path and explicit --yes.', command: '/profilesync export <path> --yes', kind: 'command', safety: 'safe' },
      { id: 'setup-transfer-export', label: 'Export setup transfer', detail: 'Export Agent setup transfer data from the current home. Requires a real path and explicit --yes.', command: '/setup transfer export <path> --yes', kind: 'command', safety: 'safe' },
      { id: 'runtime-profile-create', label: 'Create runtime profile', detail: 'Create an isolated Agent runtime profile from a built-in or local starter. Requires a real name and explicit --yes.', command: '/agent-profile create <name> --template <id> --yes', kind: 'command', safety: 'safe' },
      { id: 'runtime-profile-template-edit', label: 'Customize starter', detail: 'Export a starter JSON file, edit it, import it as a local starter, then create a profile from it.', command: '/agent-profile template export <id> <path> --yes', kind: 'command', safety: 'safe' },
      { id: 'runtime-profile-switch', label: 'Switch runtime profile', detail: 'Launch goodvibes-agent --agent-profile <name> to use that isolated Agent home. This workspace cannot switch the current process home after startup.', kind: 'guidance', safety: 'safe' },
    ],
  },
  {
    id: 'memory',
    group: 'LEARN',
    label: 'Memory & Skills',
    summary: 'Local assistant memory, routines, skills, and reusable behavior.',
    detail: 'Memory, routines, skills, and personas stay Agent-local until stable shared daemon registry contracts exist. Secrets must not be stored as memory.',
    actions: [
      { id: 'memory', label: 'Open memory', detail: 'Inspect local/session memory commands and surfaces.', command: '/memory', kind: 'command', safety: 'read-only' },
      { id: 'personas', label: 'Persona library', detail: 'Open the local persona workspace for active role selection and review.', targetCategoryId: 'personas', kind: 'workspace', safety: 'safe' },
      { id: 'skills', label: 'Local skill library', detail: 'Open the local skill workspace for reusable procedures and review.', targetCategoryId: 'skills', kind: 'workspace', safety: 'safe' },
      { id: 'routines', label: 'Routine library', detail: 'Open the local routine workspace for repeatable workflows and schedule promotion review.', targetCategoryId: 'routines', kind: 'workspace', safety: 'safe' },
    ],
  },
  {
    id: 'personas',
    group: 'LEARN',
    label: 'Personas',
    summary: 'Local behavior profiles for the main assistant.',
    detail: 'Personas shape the serial Agent in the main conversation. They are not background agents and they never spawn specialist roots.',
    actions: [
      { id: 'personas-list', label: 'List personas', detail: 'Print the full local persona library.', command: '/personas list', kind: 'command', safety: 'read-only' },
      { id: 'personas-active', label: 'Show active persona', detail: 'Inspect the active local persona applied to new turns.', command: '/personas active', kind: 'command', safety: 'read-only' },
      { id: 'personas-prev', label: 'Previous persona', detail: 'Move the local persona selection up without changing active state.', localKind: 'persona', selectionDelta: -1, kind: 'local-selection', safety: 'safe' },
      { id: 'personas-next', label: 'Next persona', detail: 'Move the local persona selection down without changing active state.', localKind: 'persona', selectionDelta: 1, kind: 'local-selection', safety: 'safe' },
      { id: 'personas-create', label: 'Create persona', detail: 'Open an in-workspace form for a local persona. No placeholder command is dispatched.', editorKind: 'persona', kind: 'editor', safety: 'safe' },
      { id: 'personas-edit', label: 'Edit selected', detail: 'Open the selected local persona in an in-workspace editor.', localKind: 'persona', localOperation: 'persona-edit', kind: 'local-operation', safety: 'safe' },
      { id: 'personas-use', label: 'Use selected', detail: 'Activate the selected local persona for future main-conversation turns.', localKind: 'persona', localOperation: 'persona-use', kind: 'local-operation', safety: 'safe' },
      { id: 'personas-review', label: 'Review selected', detail: 'Mark the selected local persona reviewed after inspecting it.', localKind: 'persona', localOperation: 'persona-review', kind: 'local-operation', safety: 'safe' },
      { id: 'personas-clear', label: 'Clear active persona', detail: 'Return to the default Agent policy without deleting any persona.', localKind: 'persona', localOperation: 'persona-clear', kind: 'local-operation', safety: 'safe' },
      { id: 'personas-delete', label: 'Delete selected', detail: 'Open a confirmation form before deleting the selected local persona.', localKind: 'persona', localOperation: 'persona-delete', kind: 'local-operation', safety: 'safe' },
    ],
  },
  {
    id: 'skills',
    group: 'LEARN',
    label: 'Skills',
    summary: 'Reusable local procedures the assistant can apply on demand.',
    detail: 'Skills are local, reviewable procedures. Enabled skills inform the main conversation; secret-looking content is rejected.',
    actions: [
      { id: 'skills-list', label: 'List skills', detail: 'Print the full local Agent skill library.', command: '/agent-skills list', kind: 'command', safety: 'read-only' },
      { id: 'skills-enabled', label: 'Enabled skills', detail: 'Show only skills currently injected into Agent guidance.', command: '/agent-skills enabled', kind: 'command', safety: 'read-only' },
      { id: 'skills-prev', label: 'Previous skill', detail: 'Move the local skill selection up without changing enabled state.', localKind: 'skill', selectionDelta: -1, kind: 'local-selection', safety: 'safe' },
      { id: 'skills-next', label: 'Next skill', detail: 'Move the local skill selection down without changing enabled state.', localKind: 'skill', selectionDelta: 1, kind: 'local-selection', safety: 'safe' },
      { id: 'skills-create', label: 'Create skill', detail: 'Open an in-workspace form for a reusable local procedure. No placeholder command is dispatched.', editorKind: 'skill', kind: 'editor', safety: 'safe' },
      { id: 'skills-edit', label: 'Edit selected', detail: 'Open the selected local Agent skill in an in-workspace editor.', localKind: 'skill', localOperation: 'skill-edit', kind: 'local-operation', safety: 'safe' },
      { id: 'skills-enable', label: 'Enable selected', detail: 'Enable the selected local Agent skill for future main-conversation guidance.', localKind: 'skill', localOperation: 'skill-enable', kind: 'local-operation', safety: 'safe' },
      { id: 'skills-disable', label: 'Disable selected', detail: 'Disable the selected local Agent skill without deleting it.', localKind: 'skill', localOperation: 'skill-disable', kind: 'local-operation', safety: 'safe' },
      { id: 'skills-review', label: 'Review selected', detail: 'Mark the selected local skill reviewed after inspecting it.', localKind: 'skill', localOperation: 'skill-review', kind: 'local-operation', safety: 'safe' },
      { id: 'skills-delete', label: 'Delete selected', detail: 'Open a confirmation form before deleting the selected local Agent skill.', localKind: 'skill', localOperation: 'skill-delete', kind: 'local-operation', safety: 'safe' },
    ],
  },
  {
    id: 'routines',
    group: 'LEARN',
    label: 'Routines',
    summary: 'Repeatable workflows for the main conversation.',
    detail: 'Routines run in the main conversation by default. Promotion to an external daemon schedule requires a real schedule command and --yes.',
    actions: [
      { id: 'routines-list', label: 'List routines', detail: 'Print the full local Agent routine library.', command: '/routines list', kind: 'command', safety: 'read-only' },
      { id: 'routines-enabled', label: 'Enabled routines', detail: 'Show routines available for direct use.', command: '/routines enabled', kind: 'command', safety: 'read-only' },
      { id: 'routines-prev', label: 'Previous routine', detail: 'Move the local routine selection up without changing enabled state.', localKind: 'routine', selectionDelta: -1, kind: 'local-selection', safety: 'safe' },
      { id: 'routines-next', label: 'Next routine', detail: 'Move the local routine selection down without changing enabled state.', localKind: 'routine', selectionDelta: 1, kind: 'local-selection', safety: 'safe' },
      { id: 'routines-create', label: 'Create routine', detail: 'Open an in-workspace form for a repeatable local workflow. No placeholder command is dispatched.', editorKind: 'routine', kind: 'editor', safety: 'safe' },
      { id: 'routines-edit', label: 'Edit selected', detail: 'Open the selected local Agent routine in an in-workspace editor.', localKind: 'routine', localOperation: 'routine-edit', kind: 'local-operation', safety: 'safe' },
      { id: 'routines-start', label: 'Start selected', detail: 'Mark the selected routine started and show it as a main-conversation workflow. This creates no hidden job.', localKind: 'routine', localOperation: 'routine-start', kind: 'local-operation', safety: 'safe' },
      { id: 'routines-enable', label: 'Enable selected', detail: 'Enable the selected routine for future main-conversation guidance.', localKind: 'routine', localOperation: 'routine-enable', kind: 'local-operation', safety: 'safe' },
      { id: 'routines-disable', label: 'Disable selected', detail: 'Disable the selected routine without deleting it.', localKind: 'routine', localOperation: 'routine-disable', kind: 'local-operation', safety: 'safe' },
      { id: 'routines-review', label: 'Review selected', detail: 'Mark the selected local routine reviewed after inspecting it.', localKind: 'routine', localOperation: 'routine-review', kind: 'local-operation', safety: 'safe' },
      { id: 'routines-delete', label: 'Delete selected', detail: 'Open a confirmation form before deleting the selected local Agent routine.', localKind: 'routine', localOperation: 'routine-delete', kind: 'local-operation', safety: 'safe' },
      { id: 'routines-promote', label: 'Promote to schedule', detail: 'Create an external daemon schedule from a reviewed routine only with real timing and --yes.', command: '/routines promote <id> --cron <expr> --yes', kind: 'command', safety: 'safe' },
      { id: 'routines-receipts', label: 'Promotion receipts', detail: 'Inspect local redacted routine schedule promotion receipts.', command: '/routines receipts', kind: 'command', safety: 'read-only' },
    ],
  },
  {
    id: 'work',
    group: 'TRACK',
    label: 'Work & Approvals',
    summary: 'Visible task state, work plan, and approval posture.',
    detail: 'Use these surfaces to inspect active operator state. Side-effecting approval decisions require explicit commands and confirmation outside this workspace.',
    actions: [
      { id: 'workplan', label: 'Open work plan', detail: 'Open the workspace-scoped work plan panel.', command: '/workplan panel', kind: 'command', safety: 'read-only' },
      { id: 'workplan-list', label: 'List work plan', detail: 'Print a concise work plan summary.', command: '/workplan list', kind: 'command', safety: 'read-only' },
      { id: 'approvals', label: 'Review approvals', detail: 'Open/read approval posture. This workspace does not approve or deny requests.', command: '/approval open', kind: 'command', safety: 'read-only' },
    ],
  },
  {
    id: 'automation',
    group: 'WATCH',
    label: 'Automation',
    summary: 'Automation and schedule observability with explicit routine promotion.',
    detail: 'Agent does not create local automation jobs or hidden scheduler spawns. Reviewed local routines can be promoted into externally owned daemon schedules only through an explicit schedules.create command with --yes, optional delivery targets, and a redacted local receipt.',
    actions: [
      { id: 'schedule-list', label: 'List schedules', detail: 'Inspect configured jobs and history without running or mutating them.', command: '/schedule list', kind: 'command', safety: 'read-only' },
      { id: 'schedule-promote-routine', label: 'Promote routine', detail: 'Create an external daemon schedule from a local Agent routine. Requires a real routine id, schedule expression, optional delivery target, and explicit --yes.', command: '/schedule promote-routine <routine-id> --cron <expr> [--delivery-surface slack] --yes', kind: 'command', safety: 'safe' },
      { id: 'schedule-receipts', label: 'Promotion receipts', detail: 'Review local redacted receipt history for routine-to-daemon schedule promotion attempts.', command: '/schedule receipts', kind: 'command', safety: 'read-only' },
      { id: 'schedule-reconcile', label: 'Reconcile schedules', detail: 'Compare local promotion receipts with live externally owned daemon schedules using schedules.list.', command: '/schedule reconcile', kind: 'command', safety: 'read-only' },
      { id: 'schedule-policy', label: 'Local scheduler blocked', detail: 'Local schedule add/run/remove/enable/disable remain blocked; only explicit external daemon schedule promotion is allowed here.', kind: 'guidance', safety: 'blocked' },
      { id: 'health-services', label: 'Service health', detail: 'Inspect service readiness without starting, stopping, or restarting daemon services.', command: '/health services', kind: 'command', safety: 'read-only' },
    ],
  },
  {
    id: 'delegate',
    group: 'BUILD',
    label: 'Build Delegation',
    summary: 'Explicit handoff to GoodVibes TUI for code work.',
    detail: 'Agent does not become the coding TUI. Build, implement, fix, patch, and review work must be handed to GoodVibes TUI with the full original ask and WRFC only when explicitly requested.',
    actions: [
      { id: 'delegate-guidance', label: 'Delegation rule', detail: 'For build/fix/review work, delegate one request to GoodVibes TUI instead of spawning local Engineer/Reviewer/Tester roots.', kind: 'guidance', safety: 'delegates' },
      { id: 'review-command', label: 'Review delegation command', detail: 'Use /delegate --wrfc <task> only when the user explicitly asks for code review/build execution. Close this workspace and include the actual task text.', kind: 'guidance', safety: 'delegates' },
      { id: 'remote-policy', label: 'Remote runner policy', detail: 'Remote dispatch/rerun is blocked in Agent; TUI owns runner topology for delegated build work.', command: '/remote dispatch', kind: 'command', safety: 'blocked' },
    ],
  },
];

function parseCommand(command: string): { readonly name: string; readonly args: readonly string[] } {
  const trimmed = command.trim().replace(/^\//, '');
  if (!trimmed) return { name: '', args: [] };
  const parts = trimmed.split(/\s+/);
  return { name: parts[0] ?? '', args: parts.slice(1) };
}

function createLocalEditor(kind: AgentWorkspaceLocalEditorKind): AgentWorkspaceLocalEditor {
  if (kind === 'persona') {
    return {
      kind,
      mode: 'create',
      title: 'Create Persona',
      selectedFieldIndex: 0,
      message: 'Enter a local behavior profile for the serial main-conversation assistant.',
      fields: [
        { id: 'name', label: 'Name', value: '', required: true, multiline: false, hint: 'Short persona name.' },
        { id: 'description', label: 'Description', value: '', required: true, multiline: false, hint: 'One-line summary of when to use it.' },
        { id: 'body', label: 'Instructions', value: '', required: true, multiline: true, hint: 'Operating guidance. Ctrl-J inserts a new line.' },
        { id: 'tags', label: 'Tags', value: '', required: false, multiline: false, hint: 'Comma-separated optional tags.' },
        { id: 'triggers', label: 'Triggers', value: '', required: false, multiline: false, hint: 'Comma-separated words that suggest this persona.' },
        { id: 'activate', label: 'Activate now', value: 'yes', required: false, multiline: false, hint: 'yes/no.' },
      ],
    };
  }
  if (kind === 'skill') {
    return {
      kind,
      mode: 'create',
      title: 'Create Skill',
      selectedFieldIndex: 0,
      message: 'Enter a reusable local procedure the assistant can apply from the main conversation.',
      fields: [
        { id: 'name', label: 'Name', value: '', required: true, multiline: false, hint: 'Short skill name.' },
        { id: 'description', label: 'Description', value: '', required: true, multiline: false, hint: 'One-line summary of the procedure.' },
        { id: 'procedure', label: 'Procedure', value: '', required: true, multiline: true, hint: 'Reusable steps. Ctrl-J inserts a new line.' },
        { id: 'triggers', label: 'Triggers', value: '', required: false, multiline: false, hint: 'Comma-separated words that suggest this skill.' },
        { id: 'tags', label: 'Tags', value: '', required: false, multiline: false, hint: 'Comma-separated optional tags.' },
        { id: 'enabled', label: 'Enable now', value: 'yes', required: false, multiline: false, hint: 'yes/no.' },
      ],
    };
  }
  return {
    kind,
    mode: 'create',
    title: 'Create Routine',
    selectedFieldIndex: 0,
    message: 'Enter a repeatable workflow. It runs in the main conversation unless explicitly promoted to a daemon schedule.',
    fields: [
      { id: 'name', label: 'Name', value: '', required: true, multiline: false, hint: 'Short routine name.' },
      { id: 'description', label: 'Description', value: '', required: true, multiline: false, hint: 'One-line summary of the workflow.' },
      { id: 'steps', label: 'Steps', value: '', required: true, multiline: true, hint: 'Workflow steps. Ctrl-J inserts a new line.' },
      { id: 'triggers', label: 'Triggers', value: '', required: false, multiline: false, hint: 'Comma-separated words that suggest this routine.' },
      { id: 'tags', label: 'Tags', value: '', required: false, multiline: false, hint: 'Comma-separated optional tags.' },
      { id: 'enabled', label: 'Enable now', value: 'yes', required: false, multiline: false, hint: 'yes/no.' },
    ],
  };
}

function createPersonaUpdateEditor(record: AgentPersonaRecord, active: boolean): AgentWorkspaceLocalEditor {
  return {
    kind: 'persona',
    mode: 'update',
    recordId: record.id,
    title: 'Edit Persona',
    selectedFieldIndex: 0,
    message: `Editing ${record.name}. Saving marks it fresh for review.`,
    fields: [
      { id: 'name', label: 'Name', value: record.name, required: true, multiline: false, hint: 'Short persona name.' },
      { id: 'description', label: 'Description', value: record.description, required: true, multiline: false, hint: 'One-line summary of when to use it.' },
      { id: 'body', label: 'Instructions', value: record.body, required: true, multiline: true, hint: 'Operating guidance. Ctrl-J inserts a new line.' },
      { id: 'tags', label: 'Tags', value: record.tags.join(', '), required: false, multiline: false, hint: 'Comma-separated optional tags.' },
      { id: 'triggers', label: 'Triggers', value: record.triggers.join(', '), required: false, multiline: false, hint: 'Comma-separated words that suggest this persona.' },
      { id: 'activate', label: 'Active', value: active ? 'yes' : 'no', required: false, multiline: false, hint: 'yes/no. Setting no clears this persona only if it is currently active.' },
    ],
  };
}

function createSkillUpdateEditor(record: AgentSkillRecord): AgentWorkspaceLocalEditor {
  return {
    kind: 'skill',
    mode: 'update',
    recordId: record.id,
    title: 'Edit Skill',
    selectedFieldIndex: 0,
    message: `Editing ${record.name}. Saving marks it fresh for review.`,
    fields: [
      { id: 'name', label: 'Name', value: record.name, required: true, multiline: false, hint: 'Short skill name.' },
      { id: 'description', label: 'Description', value: record.description, required: true, multiline: false, hint: 'One-line summary of the procedure.' },
      { id: 'procedure', label: 'Procedure', value: record.procedure, required: true, multiline: true, hint: 'Reusable steps. Ctrl-J inserts a new line.' },
      { id: 'triggers', label: 'Triggers', value: record.triggers.join(', '), required: false, multiline: false, hint: 'Comma-separated words that suggest this skill.' },
      { id: 'tags', label: 'Tags', value: record.tags.join(', '), required: false, multiline: false, hint: 'Comma-separated optional tags.' },
      { id: 'enabled', label: 'Enabled', value: record.enabled ? 'yes' : 'no', required: false, multiline: false, hint: 'yes/no.' },
    ],
  };
}

function createRoutineUpdateEditor(record: AgentRoutineRecord): AgentWorkspaceLocalEditor {
  return {
    kind: 'routine',
    mode: 'update',
    recordId: record.id,
    title: 'Edit Routine',
    selectedFieldIndex: 0,
    message: `Editing ${record.name}. Saving marks it fresh for review.`,
    fields: [
      { id: 'name', label: 'Name', value: record.name, required: true, multiline: false, hint: 'Short routine name.' },
      { id: 'description', label: 'Description', value: record.description, required: true, multiline: false, hint: 'One-line summary of the workflow.' },
      { id: 'steps', label: 'Steps', value: record.steps, required: true, multiline: true, hint: 'Workflow steps. Ctrl-J inserts a new line.' },
      { id: 'triggers', label: 'Triggers', value: record.triggers.join(', '), required: false, multiline: false, hint: 'Comma-separated words that suggest this routine.' },
      { id: 'tags', label: 'Tags', value: record.tags.join(', '), required: false, multiline: false, hint: 'Comma-separated optional tags.' },
      { id: 'enabled', label: 'Enabled', value: record.enabled ? 'yes' : 'no', required: false, multiline: false, hint: 'yes/no.' },
    ],
  };
}

function createDeleteEditor(kind: AgentWorkspaceLocalEditorKind, item: AgentWorkspaceLocalLibraryItem): AgentWorkspaceLocalEditor {
  const label = kind[0]!.toUpperCase() + kind.slice(1);
  return {
    kind,
    mode: 'delete',
    recordId: item.id,
    title: `Delete ${label}`,
    selectedFieldIndex: 0,
    message: `Type ${item.id} exactly to delete ${item.name}. This only changes the Agent-local registry.`,
    fields: [
      { id: 'confirm', label: 'Confirm id', value: '', required: true, multiline: false, hint: `Type ${item.id} exactly.` },
    ],
  };
}

function splitList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function isAffirmative(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === '' || normalized === 'yes' || normalized === 'y' || normalized === 'true' || normalized === 'enabled' || normalized === 'on';
}

function editorCategoryId(kind: AgentWorkspaceLocalEditorKind): string {
  if (kind === 'persona') return 'personas';
  if (kind === 'skill') return 'skills';
  return 'routines';
}

export class AgentWorkspace {
  public active = false;
  public focusPane: AgentWorkspaceFocusPane = 'actions';
  public selectedCategoryIndex = 0;
  public selectedActionIndex = 0;
  public status = 'Ready. Choose an operator flow; ordinary assistant work stays in the main conversation.';
  public runtimeSnapshot: AgentWorkspaceRuntimeSnapshot | null = null;
  public lastActionResult: AgentWorkspaceActionResult | null = null;
  public localEditor: AgentWorkspaceLocalEditor | null = null;
  private readonly selectedLibraryItemIndexes: Record<AgentWorkspaceLocalEditorKind, number> = {
    persona: 0,
    skill: 0,
    routine: 0,
  };
  private context: CommandContext | null = null;
  private dispatchCommand: AgentWorkspaceCommandDispatcher | null = null;

  open(context: CommandContext, dispatchCommand: AgentWorkspaceCommandDispatcher): void {
    this.context = context;
    this.dispatchCommand = dispatchCommand;
    this.runtimeSnapshot = buildAgentWorkspaceRuntimeSnapshot(context);
    this.active = true;
    this.focusPane = 'actions';
    this.status = 'Ready. Choose an operator flow; ordinary assistant work stays in the main conversation.';
    this.lastActionResult = null;
    this.localEditor = null;
    this.clampSelection();
  }

  reopen(): void {
    this.active = true;
    this.clampSelection();
  }

  close(): void {
    this.active = false;
    this.localEditor = null;
  }

  get categories(): readonly AgentWorkspaceCategory[] {
    return AGENT_WORKSPACE_CATEGORIES;
  }

  get selectedCategory(): AgentWorkspaceCategory {
    return this.categories[this.selectedCategoryIndex] ?? this.categories[0]!;
  }

  get actions(): readonly AgentWorkspaceAction[] {
    return this.selectedCategory.actions;
  }

  get selectedAction(): AgentWorkspaceAction | null {
    return this.actions[this.selectedActionIndex] ?? null;
  }

  selectedLocalLibraryItem(kind: AgentWorkspaceLocalEditorKind): AgentWorkspaceLocalLibraryItem | null {
    const items = this.localLibraryItems(kind);
    if (items.length === 0) return null;
    const index = Math.max(0, Math.min(this.selectedLibraryItemIndexes[kind], items.length - 1));
    return items[index] ?? null;
  }

  focusCategories(): void {
    this.focusPane = 'categories';
  }

  focusActions(): void {
    this.focusPane = 'actions';
  }

  toggleFocusPane(): void {
    this.focusPane = this.focusPane === 'categories' ? 'actions' : 'categories';
  }

  moveUp(): void {
    if (this.focusPane === 'categories') {
      this.selectedCategoryIndex = Math.max(0, this.selectedCategoryIndex - 1);
      this.selectedActionIndex = 0;
    } else {
      this.selectedActionIndex = Math.max(0, this.selectedActionIndex - 1);
    }
    this.clampSelection();
  }

  moveDown(): void {
    if (this.focusPane === 'categories') {
      this.selectedCategoryIndex = Math.min(this.categories.length - 1, this.selectedCategoryIndex + 1);
      this.selectedActionIndex = 0;
    } else {
      this.selectedActionIndex = Math.min(this.actions.length - 1, this.selectedActionIndex + 1);
    }
    this.clampSelection();
  }

  jumpHome(): void {
    if (this.focusPane === 'categories') this.selectedCategoryIndex = 0;
    else this.selectedActionIndex = 0;
    this.clampSelection();
  }

  jumpEnd(): void {
    if (this.focusPane === 'categories') this.selectedCategoryIndex = this.categories.length - 1;
    else this.selectedActionIndex = this.actions.length - 1;
    this.clampSelection();
  }

  refreshRuntimeSnapshot(): void {
    if (!this.context) {
      this.status = 'Runtime context is unavailable.';
      this.lastActionResult = {
        kind: 'error',
        title: 'Context refresh failed',
        detail: 'The Agent workspace has no command context to inspect.',
      };
      return;
    }
    this.runtimeSnapshot = buildAgentWorkspaceRuntimeSnapshot(this.context);
    this.status = 'Runtime context refreshed.';
    this.lastActionResult = {
      kind: 'refreshed',
      title: 'Runtime context refreshed',
      detail: 'Provider, model, session, local memory, daemon URL, and Agent knowledge route posture were re-read from the live command context.',
    };
  }

  cancelLocalEditor(): void {
    if (!this.localEditor) return;
    const title = this.localEditor.title;
    this.localEditor = null;
    this.status = `${title} cancelled.`;
    this.lastActionResult = {
      kind: 'guidance',
      title: `${title} cancelled`,
      detail: 'No local Agent registry changes were written.',
    };
  }

  moveEditorField(delta: number): void {
    const editor = this.localEditor;
    if (!editor) return;
    const nextIndex = Math.max(0, Math.min(editor.fields.length - 1, editor.selectedFieldIndex + delta));
    this.localEditor = { ...editor, selectedFieldIndex: nextIndex };
  }

  appendEditorText(text: string): void {
    const editor = this.localEditor;
    if (!editor || text.length === 0) return;
    const field = editor.fields[editor.selectedFieldIndex];
    if (!field) return;
    this.replaceEditorField(editor.selectedFieldIndex, `${field.value}${text}`, editor.message);
  }

  appendEditorNewline(): void {
    const editor = this.localEditor;
    if (!editor) return;
    const field = editor.fields[editor.selectedFieldIndex];
    if (!field || !field.multiline) {
      this.moveEditorField(1);
      return;
    }
    this.replaceEditorField(editor.selectedFieldIndex, `${field.value}\n`, editor.message);
  }

  editorBackspace(): void {
    const editor = this.localEditor;
    if (!editor) return;
    const field = editor.fields[editor.selectedFieldIndex];
    if (!field || field.value.length === 0) return;
    const characters = Array.from(field.value);
    characters.pop();
    this.replaceEditorField(editor.selectedFieldIndex, characters.join(''), editor.message);
  }

  submitEditorFieldOrForm(): void {
    const editor = this.localEditor;
    if (!editor) return;
    if (editor.selectedFieldIndex < editor.fields.length - 1) {
      this.moveEditorField(1);
      return;
    }
    this.submitLocalEditor();
  }

  activateSelected(): void {
    if (this.localEditor) {
      this.submitEditorFieldOrForm();
      return;
    }
    if (this.focusPane === 'categories') {
      this.focusActions();
      return;
    }
    const action = this.selectedAction;
    if (!action) return;
    if (action.kind === 'editor' && action.editorKind) {
      this.localEditor = createLocalEditor(action.editorKind);
      this.status = `Editing ${this.localEditor.title}.`;
      this.lastActionResult = {
        kind: 'guidance',
        title: this.localEditor.title,
        detail: this.localEditor.message,
        safety: action.safety,
      };
      return;
    }
    if (action.kind === 'local-selection' && action.localKind) {
      this.moveLocalLibraryItemSelection(action.localKind, action.selectionDelta ?? 0);
      return;
    }
    if (action.kind === 'local-operation' && action.localOperation) {
      this.applyLocalLibraryOperation(action.localOperation);
      return;
    }
    if (action.kind === 'guidance' || !action.command) {
      if (action.kind === 'workspace' && action.targetCategoryId) {
        const targetIndex = this.categories.findIndex((category) => category.id === action.targetCategoryId);
        if (targetIndex >= 0) {
          this.selectedCategoryIndex = targetIndex;
          this.selectedActionIndex = 0;
          this.focusActions();
          this.status = `Opened ${this.selectedCategory.label}.`;
          this.lastActionResult = {
            kind: 'refreshed',
            title: `Opened ${this.selectedCategory.label}`,
            detail: action.detail,
            safety: action.safety,
          };
          this.clampSelection();
          return;
        }
        this.status = `Workspace area unavailable: ${action.targetCategoryId}.`;
        this.lastActionResult = {
          kind: 'error',
          title: 'Workspace area unavailable',
          detail: `No Agent workspace category exists for ${action.targetCategoryId}.`,
          safety: action.safety,
        };
        return;
      }
      this.status = action.detail;
      this.lastActionResult = {
        kind: 'guidance',
        title: action.label,
        detail: action.detail,
        safety: action.safety,
      };
      return;
    }
    if (action.safety === 'blocked') {
      this.status = `Blocked here: ${action.label}.`;
      this.lastActionResult = {
        kind: 'blocked',
        title: `${action.label} is blocked in Agent`,
        detail: action.detail,
        command: action.command,
        safety: action.safety,
      };
      return;
    }
    const parsed = parseCommand(action.command);
    if (!parsed.name) {
      this.status = `No command is configured for ${action.label}.`;
      this.lastActionResult = {
        kind: 'error',
        title: 'Command unavailable',
        detail: `No command is configured for ${action.label}.`,
        safety: action.safety,
      };
      return;
    }
    if (/<[^>\s]+(?:\s+[^>]*)?>/.test(action.command)) {
      this.status = `Placeholder command not dispatched: ${action.command}.`;
      this.lastActionResult = {
        kind: 'guidance',
        title: `${action.label} needs details`,
        detail: 'This action is a command template. Close the workspace and run it with real task text instead of placeholder values.',
        command: action.command,
        safety: action.safety,
      };
      return;
    }
    if (!this.context?.executeCommand || !this.dispatchCommand) {
      this.status = `Command dispatch is not available for ${action.command}.`;
      this.lastActionResult = {
        kind: 'error',
        title: 'Command dispatch unavailable',
        detail: `The command ${action.command} cannot be opened from this runtime.`,
        command: action.command,
        safety: action.safety,
      };
      return;
    }
    this.status = `Opening ${action.command}.`;
    this.lastActionResult = {
      kind: 'dispatched',
      title: `Opening ${action.label}`,
      detail: 'The workspace handed this safe or read-only command to the shell-owned command router.',
      command: action.command,
      safety: action.safety,
    };
    this.dispatchCommand(action.command);
  }

  private clampSelection(): void {
    this.selectedCategoryIndex = Math.max(0, Math.min(this.selectedCategoryIndex, this.categories.length - 1));
    this.selectedActionIndex = Math.max(0, Math.min(this.selectedActionIndex, this.actions.length - 1));
    this.clampLocalLibrarySelection('persona');
    this.clampLocalLibrarySelection('skill');
    this.clampLocalLibrarySelection('routine');
  }

  private localLibraryItems(kind: AgentWorkspaceLocalEditorKind): readonly AgentWorkspaceLocalLibraryItem[] {
    if (kind === 'persona') return this.runtimeSnapshot?.localPersonas ?? [];
    if (kind === 'skill') return this.runtimeSnapshot?.localSkills ?? [];
    return this.runtimeSnapshot?.localRoutines ?? [];
  }

  private clampLocalLibrarySelection(kind: AgentWorkspaceLocalEditorKind): void {
    const length = this.localLibraryItems(kind).length;
    this.selectedLibraryItemIndexes[kind] = length === 0
      ? 0
      : Math.max(0, Math.min(this.selectedLibraryItemIndexes[kind], length - 1));
  }

  private moveLocalLibraryItemSelection(kind: AgentWorkspaceLocalEditorKind, delta: number): void {
    const items = this.localLibraryItems(kind);
    if (items.length === 0) {
      this.status = `No local ${kind} records to select.`;
      this.lastActionResult = {
        kind: 'guidance',
        title: `No ${kind} records`,
        detail: `Create a local ${kind} before using selection actions.`,
        safety: 'safe',
      };
      return;
    }
    this.selectedLibraryItemIndexes[kind] = Math.max(0, Math.min(items.length - 1, this.selectedLibraryItemIndexes[kind] + delta));
    const selected = this.selectedLocalLibraryItem(kind);
    this.status = selected ? `Selected ${kind}: ${selected.name}.` : `Selected ${kind} updated.`;
    this.lastActionResult = {
      kind: 'guidance',
      title: selected ? `Selected ${selected.name}` : `Selected ${kind}`,
      detail: selected ? `${selected.name} (${selected.id}) is now the selected local ${kind}.` : `Selection changed for ${kind}.`,
      safety: 'safe',
    };
  }

  private applyLocalLibraryOperation(operation: AgentWorkspaceLocalOperation): void {
    const shellPaths = this.context?.workspace?.shellPaths;
    if (!shellPaths) {
      this.status = 'Local Agent registry files are unavailable.';
      this.lastActionResult = {
        kind: 'error',
        title: 'Local registry unavailable',
        detail: 'The Agent workspace cannot locate the Agent-local registry files for this runtime.',
      };
      return;
    }
    try {
      if (operation === 'persona-clear') {
        AgentPersonaRegistry.fromShellPaths(shellPaths).clearActive();
        this.finishLocalOperation('persona', 'Cleared active persona', 'The default Agent policy will apply to future turns.');
        return;
      }
      const selected = this.selectedItemForOperation(operation);
      if (!selected) {
        this.status = 'No selected local registry item.';
        this.lastActionResult = {
          kind: 'guidance',
          title: 'Nothing selected',
          detail: 'Create or select a local library item before running this action.',
          safety: 'safe',
        };
        return;
      }
      if (operation === 'persona-edit') {
        const registry = AgentPersonaRegistry.fromShellPaths(shellPaths);
        const persona = registry.get(selected.id);
        if (!persona) throw new Error(`Unknown persona: ${selected.id}`);
        this.localEditor = createPersonaUpdateEditor(persona, registry.snapshot().activePersonaId === persona.id);
        this.status = `Editing persona: ${persona.name}.`;
        this.lastActionResult = {
          kind: 'guidance',
          title: this.localEditor.title,
          detail: this.localEditor.message,
          safety: 'safe',
        };
      } else if (operation === 'persona-use') {
        AgentPersonaRegistry.fromShellPaths(shellPaths).setActive(selected.id);
        this.finishLocalOperation('persona', `Using persona ${selected.name}`, `${selected.name} will shape future main-conversation turns.`);
      } else if (operation === 'persona-review') {
        AgentPersonaRegistry.fromShellPaths(shellPaths).markReviewed(selected.id);
        this.finishLocalOperation('persona', `Reviewed persona ${selected.name}`, `${selected.name} is marked reviewed.`);
      } else if (operation === 'persona-delete') {
        this.openDeleteEditor('persona', selected);
      } else if (operation === 'skill-edit') {
        const skill = AgentSkillRegistry.fromShellPaths(shellPaths).get(selected.id);
        if (!skill) throw new Error(`Unknown skill: ${selected.id}`);
        this.localEditor = createSkillUpdateEditor(skill);
        this.status = `Editing skill: ${skill.name}.`;
        this.lastActionResult = {
          kind: 'guidance',
          title: this.localEditor.title,
          detail: this.localEditor.message,
          safety: 'safe',
        };
      } else if (operation === 'skill-enable') {
        AgentSkillRegistry.fromShellPaths(shellPaths).setEnabled(selected.id, true);
        this.finishLocalOperation('skill', `Enabled skill ${selected.name}`, `${selected.name} can now inform main-conversation turns.`);
      } else if (operation === 'skill-disable') {
        AgentSkillRegistry.fromShellPaths(shellPaths).setEnabled(selected.id, false);
        this.finishLocalOperation('skill', `Disabled skill ${selected.name}`, `${selected.name} remains saved but is no longer injected into guidance.`);
      } else if (operation === 'skill-review') {
        AgentSkillRegistry.fromShellPaths(shellPaths).markReviewed(selected.id);
        this.finishLocalOperation('skill', `Reviewed skill ${selected.name}`, `${selected.name} is marked reviewed.`);
      } else if (operation === 'skill-delete') {
        this.openDeleteEditor('skill', selected);
      } else if (operation === 'routine-edit') {
        const routine = AgentRoutineRegistry.fromShellPaths(shellPaths).get(selected.id);
        if (!routine) throw new Error(`Unknown routine: ${selected.id}`);
        this.localEditor = createRoutineUpdateEditor(routine);
        this.status = `Editing routine: ${routine.name}.`;
        this.lastActionResult = {
          kind: 'guidance',
          title: this.localEditor.title,
          detail: this.localEditor.message,
          safety: 'safe',
        };
      } else if (operation === 'routine-start') {
        AgentRoutineRegistry.fromShellPaths(shellPaths).markStarted(selected.id);
        this.finishLocalOperation('routine', `Started routine ${selected.name}`, `${selected.name} was marked started for this main-conversation workflow. No hidden job was created.`);
      } else if (operation === 'routine-enable') {
        AgentRoutineRegistry.fromShellPaths(shellPaths).setEnabled(selected.id, true);
        this.finishLocalOperation('routine', `Enabled routine ${selected.name}`, `${selected.name} can now inform main-conversation turns.`);
      } else if (operation === 'routine-disable') {
        AgentRoutineRegistry.fromShellPaths(shellPaths).setEnabled(selected.id, false);
        this.finishLocalOperation('routine', `Disabled routine ${selected.name}`, `${selected.name} remains saved but is no longer injected into guidance.`);
      } else if (operation === 'routine-review') {
        AgentRoutineRegistry.fromShellPaths(shellPaths).markReviewed(selected.id);
        this.finishLocalOperation('routine', `Reviewed routine ${selected.name}`, `${selected.name} is marked reviewed.`);
      } else {
        this.openDeleteEditor('routine', selected);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.status = detail;
      this.lastActionResult = {
        kind: 'error',
        title: 'Local registry action failed',
        detail,
      };
    }
  }

  private selectedItemForOperation(operation: AgentWorkspaceLocalOperation): AgentWorkspaceLocalLibraryItem | null {
    if (operation.startsWith('persona-')) return this.selectedLocalLibraryItem('persona');
    if (operation.startsWith('skill-')) return this.selectedLocalLibraryItem('skill');
    return this.selectedLocalLibraryItem('routine');
  }

  private finishLocalOperation(kind: AgentWorkspaceLocalEditorKind, title: string, detail: string): void {
    this.runtimeSnapshot = this.context ? buildAgentWorkspaceRuntimeSnapshot(this.context) : this.runtimeSnapshot;
    this.clampLocalLibrarySelection(kind);
    this.status = title;
    this.lastActionResult = {
      kind: 'refreshed',
      title,
      detail,
      safety: 'safe',
    };
  }

  private openDeleteEditor(kind: AgentWorkspaceLocalEditorKind, selected: AgentWorkspaceLocalLibraryItem): void {
    this.localEditor = createDeleteEditor(kind, selected);
    this.status = `Confirm deletion for ${selected.name}.`;
    this.lastActionResult = {
      kind: 'guidance',
      title: this.localEditor.title,
      detail: this.localEditor.message,
      safety: 'safe',
    };
  }

  private replaceEditorField(index: number, value: string, message: string): void {
    const editor = this.localEditor;
    if (!editor) return;
    const fields = editor.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, value } : field);
    this.localEditor = { ...editor, fields, message };
  }

  private editorField(id: string): string {
    const editor = this.localEditor;
    return editor?.fields.find((field) => field.id === id)?.value.trim() ?? '';
  }

  private missingEditorField(): AgentWorkspaceEditorField | null {
    const editor = this.localEditor;
    if (!editor) return null;
    return editor.fields.find((field) => field.required && field.value.trim().length === 0) ?? null;
  }

  private submitLocalEditor(): void {
    const editor = this.localEditor;
    if (!editor) return;
    const missing = this.missingEditorField();
    if (missing) {
      const missingIndex = editor.fields.findIndex((field) => field.id === missing.id);
      this.localEditor = {
        ...editor,
        selectedFieldIndex: Math.max(0, missingIndex),
        message: `${missing.label} is required before saving.`,
      };
      this.status = `${missing.label} is required.`;
      return;
    }
    const shellPaths = this.context?.workspace?.shellPaths;
    if (!shellPaths) {
      this.localEditor = { ...editor, message: 'Cannot save because Agent shell paths are unavailable.' };
      this.status = 'Cannot save local Agent registry item without shell paths.';
      this.lastActionResult = {
        kind: 'error',
        title: 'Local registry unavailable',
        detail: 'The Agent workspace cannot locate the Agent-local registry files for this runtime.',
      };
      return;
    }
    try {
      if (editor.mode === 'delete') {
        this.submitLocalDeleteEditor(shellPaths, editor);
        return;
      }
      if (editor.kind === 'persona') {
        const registry = AgentPersonaRegistry.fromShellPaths(shellPaths);
        if (editor.mode === 'update' && editor.recordId) {
          const wasActive = registry.snapshot().activePersonaId === editor.recordId;
          const updated = registry.update(editor.recordId, {
            name: this.editorField('name'),
            description: this.editorField('description'),
            body: this.editorField('body'),
            tags: splitList(this.editorField('tags')),
            triggers: splitList(this.editorField('triggers')),
            provenance: 'agent-workspace',
          });
          if (isAffirmative(this.editorField('activate'))) registry.setActive(updated.id);
          else if (wasActive) registry.clearActive();
          this.finishLocalEditor(editor.kind, updated.id, updated.name, 'Updated');
          return;
        }
        const created = registry.create({
          name: this.editorField('name'),
          description: this.editorField('description'),
          body: this.editorField('body'),
          tags: splitList(this.editorField('tags')),
          triggers: splitList(this.editorField('triggers')),
          source: 'user',
          provenance: 'agent-workspace',
        });
        if (isAffirmative(this.editorField('activate'))) registry.setActive(created.id);
        this.finishLocalEditor(editor.kind, created.id, created.name, 'Created');
      } else if (editor.kind === 'skill') {
        const registry = AgentSkillRegistry.fromShellPaths(shellPaths);
        if (editor.mode === 'update' && editor.recordId) {
          const updated = registry.update(editor.recordId, {
            name: this.editorField('name'),
            description: this.editorField('description'),
            procedure: this.editorField('procedure'),
            triggers: splitList(this.editorField('triggers')),
            tags: splitList(this.editorField('tags')),
            provenance: 'agent-workspace',
          });
          registry.setEnabled(updated.id, isAffirmative(this.editorField('enabled')));
          this.finishLocalEditor(editor.kind, updated.id, updated.name, 'Updated');
          return;
        }
        const created = registry.create({
          name: this.editorField('name'),
          description: this.editorField('description'),
          procedure: this.editorField('procedure'),
          triggers: splitList(this.editorField('triggers')),
          tags: splitList(this.editorField('tags')),
          enabled: isAffirmative(this.editorField('enabled')),
          source: 'user',
          provenance: 'agent-workspace',
        });
        this.finishLocalEditor(editor.kind, created.id, created.name, 'Created');
      } else {
        const registry = AgentRoutineRegistry.fromShellPaths(shellPaths);
        if (editor.mode === 'update' && editor.recordId) {
          const updated = registry.update(editor.recordId, {
            name: this.editorField('name'),
            description: this.editorField('description'),
            steps: this.editorField('steps'),
            triggers: splitList(this.editorField('triggers')),
            tags: splitList(this.editorField('tags')),
            provenance: 'agent-workspace',
          });
          registry.setEnabled(updated.id, isAffirmative(this.editorField('enabled')));
          this.finishLocalEditor(editor.kind, updated.id, updated.name, 'Updated');
          return;
        }
        const created = registry.create({
          name: this.editorField('name'),
          description: this.editorField('description'),
          steps: this.editorField('steps'),
          triggers: splitList(this.editorField('triggers')),
          tags: splitList(this.editorField('tags')),
          enabled: isAffirmative(this.editorField('enabled')),
          source: 'user',
          provenance: 'agent-workspace',
        });
        this.finishLocalEditor(editor.kind, created.id, created.name, 'Created');
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.localEditor = { ...editor, message: detail };
      this.status = detail;
      this.lastActionResult = {
        kind: 'error',
        title: `${editor.title} failed`,
        detail,
      };
    }
  }

  private submitLocalDeleteEditor(shellPaths: ShellPathService, editor: AgentWorkspaceLocalEditor): void {
    const expectedId = editor.recordId ?? '';
    const confirmedId = this.editorField('confirm');
    if (!expectedId || confirmedId !== expectedId) {
      this.localEditor = {
        ...editor,
        message: `Deletion not confirmed. Type ${expectedId} exactly, then press Enter.`,
      };
      this.status = 'Deletion not confirmed.';
      return;
    }
    if (editor.kind === 'persona') {
      const removed = AgentPersonaRegistry.fromShellPaths(shellPaths).deletePersona(expectedId);
      this.finishLocalDelete(editor.kind, removed.id, removed.name);
    } else if (editor.kind === 'skill') {
      const removed = AgentSkillRegistry.fromShellPaths(shellPaths).deleteSkill(expectedId);
      this.finishLocalDelete(editor.kind, removed.id, removed.name);
    } else {
      const removed = AgentRoutineRegistry.fromShellPaths(shellPaths).deleteRoutine(expectedId);
      this.finishLocalDelete(editor.kind, removed.id, removed.name);
    }
  }

  private finishLocalEditor(kind: AgentWorkspaceLocalEditorKind, id: string, name: string, verb: 'Created' | 'Updated'): void {
    this.localEditor = null;
    const categoryId = editorCategoryId(kind);
    const categoryIndex = this.categories.findIndex((category) => category.id === categoryId);
    if (categoryIndex >= 0) {
      this.selectedCategoryIndex = categoryIndex;
      this.selectedActionIndex = 0;
    }
    this.runtimeSnapshot = this.context ? buildAgentWorkspaceRuntimeSnapshot(this.context) : this.runtimeSnapshot;
    this.status = `${verb} ${kind}: ${name}.`;
    this.lastActionResult = {
      kind: 'refreshed',
      title: `${verb} ${kind}`,
      detail: `${name} (${id}) was saved to the Agent-local ${categoryId} registry.`,
      safety: 'safe',
    };
    this.clampSelection();
  }

  private finishLocalDelete(kind: AgentWorkspaceLocalEditorKind, id: string, name: string): void {
    this.localEditor = null;
    const categoryId = editorCategoryId(kind);
    const categoryIndex = this.categories.findIndex((category) => category.id === categoryId);
    if (categoryIndex >= 0) {
      this.selectedCategoryIndex = categoryIndex;
      this.selectedActionIndex = 0;
    }
    this.runtimeSnapshot = this.context ? buildAgentWorkspaceRuntimeSnapshot(this.context) : this.runtimeSnapshot;
    this.status = `Deleted ${kind}: ${name}.`;
    this.lastActionResult = {
      kind: 'refreshed',
      title: `Deleted ${kind}`,
      detail: `${name} (${id}) was removed from the Agent-local ${categoryId} registry.`,
      safety: 'safe',
    };
    this.clampSelection();
  }
}

export function handleAgentWorkspaceToken(
  workspace: AgentWorkspace,
  token: InputToken,
  handleEscape: () => void,
  requestRender: () => void,
): boolean {
  if (!workspace.active) return false;

  if (workspace.localEditor) {
    if (token.type === 'text') {
      workspace.appendEditorText(token.value);
    } else if (token.type === 'key') {
      if (token.logicalName === 'escape') workspace.cancelLocalEditor();
      else if (token.logicalName === 'enter') workspace.submitEditorFieldOrForm();
      else if (token.logicalName === 'tab' || token.logicalName === 'down') workspace.moveEditorField(1);
      else if (token.logicalName === 'up') workspace.moveEditorField(-1);
      else if (token.logicalName === 'backspace' || token.logicalName === 'delete') workspace.editorBackspace();
      else if (token.logicalName === 'j' && token.ctrl === true) workspace.appendEditorNewline();
    }
    requestRender();
    return true;
  }

  if (token.type === 'key') {
    if (token.logicalName === 'escape') {
      handleEscape();
      return true;
    }
    if (token.logicalName === 'enter' || token.logicalName === 'space') workspace.activateSelected();
    else if (token.logicalName === 'left') workspace.focusCategories();
    else if (token.logicalName === 'right') workspace.focusActions();
    else if (token.logicalName === 'up') workspace.moveUp();
    else if (token.logicalName === 'down') workspace.moveDown();
    else if (token.logicalName === 'tab') workspace.toggleFocusPane();
    else if (token.logicalName === 'home') workspace.jumpHome();
    else if (token.logicalName === 'end') workspace.jumpEnd();
  } else if (token.type === 'text') {
    if (token.value === 'h') workspace.focusCategories();
    else if (token.value === 'l') workspace.focusActions();
    else if (token.value === 'j') workspace.moveDown();
    else if (token.value === 'k') workspace.moveUp();
    else if (token.value === 'r' || token.value === 'R') workspace.refreshRuntimeSnapshot();
    else if (token.value === ' ') workspace.activateSelected();
  }

  requestRender();
  return true;
}
