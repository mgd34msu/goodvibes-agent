import type { AgentBehaviorDiscoverySummary } from '../agent/behavior-discovery-summary.ts';

export type AgentWorkspaceSetupStatus = 'ready' | 'recommended' | 'optional' | 'blocked';

export interface AgentWorkspaceSetupChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly status: AgentWorkspaceSetupStatus;
  readonly detail: string;
  readonly command?: string;
}

export interface AgentWorkspaceSetupChecklistInput {
  readonly provider: string;
  readonly model: string;
  readonly runtimeBaseUrl: string;
  readonly sessionMemoryCount: number;
  readonly localMemoryCount: number;
  readonly localMemoryReviewQueueCount: number;
  readonly routineCount: number;
  readonly enabledRoutineCount: number;
  readonly skillCount: number;
  readonly enabledSkillCount: number;
  readonly skillBundleCount: number;
  readonly enabledSkillBundleCount: number;
  readonly activePersonaName: string;
  readonly discoveredPersonas: AgentBehaviorDiscoverySummary;
  readonly discoveredSkills: AgentBehaviorDiscoverySummary;
  readonly discoveredRoutines: AgentBehaviorDiscoverySummary;
  readonly readyChannelCount: number;
  readonly voiceProviderCount: number;
  readonly mediaProviderCount: number;
  readonly runtimeProfileCount: number;
  readonly runtimeStarterTemplateCount: number;
}

function setupStatusForCount(count: number, ready: AgentWorkspaceSetupStatus, empty: AgentWorkspaceSetupStatus): AgentWorkspaceSetupStatus {
  return count > 0 ? ready : empty;
}

function sampleNames(summary: AgentBehaviorDiscoverySummary): string {
  if (summary.names.length === 0) return '';
  const suffix = summary.count > summary.names.length ? `, +${summary.count - summary.names.length} more` : '';
  return ` Found: ${summary.names.join(', ')}${suffix}.`;
}

export function buildAgentWorkspaceSetupChecklist(input: AgentWorkspaceSetupChecklistInput): readonly AgentWorkspaceSetupChecklistItem[] {
  const providerReady = input.provider !== 'unknown' && input.model !== 'unknown';
  const hasActivePersona = input.activePersonaName !== '(none)' && input.activePersonaName !== '(unavailable)';
  const discoveredBehaviorCount = input.discoveredPersonas.count + input.discoveredSkills.count + input.discoveredRoutines.count;
  return [
    {
      id: 'runtime',
      label: 'Connected services',
      status: 'ready',
      detail: `Agent will connect to ${input.runtimeBaseUrl}; service ownership stays outside this product.`,
      command: '/health',
    },
    {
      id: 'provider-model',
      label: 'Provider and model',
      status: providerReady ? 'ready' : 'blocked',
      detail: providerReady
        ? `Current chat route is ${input.provider} / ${input.model}.`
        : 'Choose a provider and model before relying on assistant turns.',
      command: '/model',
    },
    {
      id: 'agent-knowledge',
      label: 'Agent Knowledge',
      status: 'recommended',
      detail: 'Check isolated Agent Knowledge status, then ingest source-backed material into the Agent segment only.',
      command: '/knowledge status',
    },
    {
      id: 'profile',
      label: 'Agent profile',
      status: input.runtimeProfileCount > 0 ? 'ready' : discoveredBehaviorCount > 0 ? 'recommended' : 'optional',
      detail: input.runtimeProfileCount > 0
        ? `${input.runtimeProfileCount} isolated Agent profile(s) are available.`
        : discoveredBehaviorCount > 0
          ? `${discoveredBehaviorCount} discovered behavior file(s) can seed an isolated Agent profile from the Profiles workspace.`
        : `${input.runtimeStarterTemplateCount} starter template(s) are available if this machine needs separate operator identities.`,
      command: discoveredBehaviorCount > 0 && input.runtimeProfileCount === 0 ? '/agent-profile guide' : '/agent-profile templates',
    },
    {
      id: 'persona',
      label: 'Persona',
      status: hasActivePersona ? 'ready' : 'recommended',
      detail: hasActivePersona
        ? `Active persona: ${input.activePersonaName}.${input.discoveredPersonas.count > 0 ? ` ${input.discoveredPersonas.count} discovered persona file(s) are still available to import.` : ''}`
        : input.discoveredPersonas.count > 0
          ? `${input.discoveredPersonas.count} discovered persona file(s) can be imported into the Agent-local registry.${sampleNames(input.discoveredPersonas)}`
          : 'Create or choose a persona to make the assistant voice and policy explicit.',
      command: input.discoveredPersonas.count > 0 ? '/personas discover' : '/personas',
    },
    {
      id: 'skills',
      label: 'Skills',
      status: input.enabledSkillCount > 0 || input.enabledSkillBundleCount > 0 ? 'ready' : input.skillCount > 0 || input.skillBundleCount > 0 || input.discoveredSkills.count > 0 ? 'recommended' : 'optional',
      detail: input.skillCount > 0 || input.skillBundleCount > 0
        ? `${input.enabledSkillCount}/${input.skillCount} local skill(s) enabled; ${input.enabledSkillBundleCount}/${input.skillBundleCount} bundle(s) enabled.${input.discoveredSkills.count > 0 ? ` ${input.discoveredSkills.count} discovered skill file(s) are still available to import.` : ''}`
        : input.discoveredSkills.count > 0
          ? `${input.discoveredSkills.count} discovered skill file(s) can be imported as local reusable procedures.${sampleNames(input.discoveredSkills)}`
          : 'Create reusable local skills and bundles for repeated workflows.',
      command: input.discoveredSkills.count > 0 ? '/agent-skills discover' : '/agent-skills',
    },
    {
      id: 'routines',
      label: 'Routines',
      status: setupStatusForCount(input.enabledRoutineCount, 'ready', input.routineCount > 0 || input.discoveredRoutines.count > 0 ? 'recommended' : 'optional'),
      detail: input.routineCount > 0
        ? `${input.enabledRoutineCount}/${input.routineCount} local routine(s) enabled.${input.discoveredRoutines.count > 0 ? ` ${input.discoveredRoutines.count} discovered routine file(s) are still available to import.` : ''}`
        : input.discoveredRoutines.count > 0
          ? `${input.discoveredRoutines.count} discovered routine file(s) can be imported as main-conversation workflows.${sampleNames(input.discoveredRoutines)}`
          : 'Create local routines first; promote schedules only with explicit confirmation.',
      command: input.discoveredRoutines.count > 0 ? '/routines discover' : '/routines',
    },
    {
      id: 'memory',
      label: 'Local memory',
      status: setupStatusForCount(input.localMemoryCount, 'ready', 'optional'),
      detail: input.localMemoryCount > 0
        ? `${input.localMemoryCount} Agent memory record(s) are available; ${input.localMemoryReviewQueueCount} need review.`
        : 'Memory starts empty; durable facts should be stored deliberately and never include secrets.',
      command: '/memory',
    },
    {
      id: 'channels',
      label: 'Channels',
      status: setupStatusForCount(input.readyChannelCount, 'ready', 'optional'),
      detail: input.readyChannelCount > 0
        ? `${input.readyChannelCount} external channel(s) are ready.`
        : 'Pair or review channels only when you want the assistant reachable outside this terminal.',
      command: '/pair',
    },
    {
      id: 'voice-media',
      label: 'Voice and media',
      status: input.voiceProviderCount > 0 || input.mediaProviderCount > 0 ? 'ready' : 'optional',
      detail: `${input.voiceProviderCount} voice provider(s), ${input.mediaProviderCount} media provider(s). Configure these only when useful.`,
      command: '/config tts',
    },
  ];
}
