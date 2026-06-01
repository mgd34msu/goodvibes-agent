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
  readonly daemonBaseUrl: string;
  readonly sessionMemoryCount: number;
  readonly routineCount: number;
  readonly enabledRoutineCount: number;
  readonly skillCount: number;
  readonly enabledSkillCount: number;
  readonly activePersonaName: string;
  readonly readyChannelCount: number;
  readonly voiceProviderCount: number;
  readonly mediaProviderCount: number;
  readonly runtimeProfileCount: number;
  readonly runtimeStarterTemplateCount: number;
}

function setupStatusForCount(count: number, ready: AgentWorkspaceSetupStatus, empty: AgentWorkspaceSetupStatus): AgentWorkspaceSetupStatus {
  return count > 0 ? ready : empty;
}

export function buildAgentWorkspaceSetupChecklist(input: AgentWorkspaceSetupChecklistInput): readonly AgentWorkspaceSetupChecklistItem[] {
  const providerReady = input.provider !== 'unknown' && input.model !== 'unknown';
  const hasActivePersona = input.activePersonaName !== '(none)' && input.activePersonaName !== '(unavailable)';
  return [
    {
      id: 'runtime',
      label: 'External runtime',
      status: 'ready',
      detail: `Agent will connect to ${input.daemonBaseUrl}; runtime ownership stays outside this TUI.`,
      command: '/status',
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
      label: 'Runtime profile',
      status: setupStatusForCount(input.runtimeProfileCount, 'ready', 'optional'),
      detail: input.runtimeProfileCount > 0
        ? `${input.runtimeProfileCount} isolated runtime profile(s) are available.`
        : `${input.runtimeStarterTemplateCount} starter template(s) are available if this machine needs separate operator identities.`,
      command: '/agent-profile templates',
    },
    {
      id: 'persona',
      label: 'Persona',
      status: hasActivePersona ? 'ready' : 'recommended',
      detail: hasActivePersona
        ? `Active persona: ${input.activePersonaName}.`
        : 'Create or choose a persona to make the assistant voice and policy explicit.',
      command: '/personas',
    },
    {
      id: 'skills',
      label: 'Skills',
      status: setupStatusForCount(input.enabledSkillCount, 'ready', input.skillCount > 0 ? 'recommended' : 'optional'),
      detail: input.skillCount > 0
        ? `${input.enabledSkillCount}/${input.skillCount} local skill(s) enabled.`
        : 'Create reusable local skills for repeated workflows.',
      command: '/agent-skills',
    },
    {
      id: 'routines',
      label: 'Routines',
      status: setupStatusForCount(input.enabledRoutineCount, 'ready', input.routineCount > 0 ? 'recommended' : 'optional'),
      detail: input.routineCount > 0
        ? `${input.enabledRoutineCount}/${input.routineCount} local routine(s) enabled.`
        : 'Create local routines first; promote schedules only with explicit confirmation.',
      command: '/routines',
    },
    {
      id: 'memory',
      label: 'Local memory',
      status: setupStatusForCount(input.sessionMemoryCount, 'ready', 'optional'),
      detail: input.sessionMemoryCount > 0
        ? `${input.sessionMemoryCount} session memory record(s) are available.`
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
