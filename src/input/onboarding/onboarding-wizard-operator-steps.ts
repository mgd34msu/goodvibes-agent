import type { OnboardingWizardStepDefinition } from './onboarding-wizard-types.ts';
import type { AgentBehaviorDiscoverySnapshot } from '../../agent/behavior-discovery-summary.ts';

function discoveryCount(discovery: AgentBehaviorDiscoverySnapshot | undefined): number {
  if (!discovery) return 0;
  return discovery.personas.count + discovery.skills.count + discovery.routines.count;
}

function discoverySummary(discovery: AgentBehaviorDiscoverySnapshot | undefined): string {
  if (!discovery || discoveryCount(discovery) === 0) return 'No importable local behavior files found yet';
  return [
    `${discovery.personas.count} persona file(s)`,
    `${discovery.skills.count} skill file(s)`,
    `${discovery.routines.count} routine file(s)`,
  ].join('; ');
}

function discoverySample(discovery: AgentBehaviorDiscoverySnapshot | undefined): string {
  if (!discovery) return '';
  const names = [
    ...discovery.personas.names,
    ...discovery.skills.names,
    ...discovery.routines.names,
  ].slice(0, 4);
  if (names.length === 0) return 'Open the Memory & Skills workspace after setup to rescan and import local behavior files.';
  const remaining = discoveryCount(discovery) > names.length ? `, +${discoveryCount(discovery) - names.length} more` : '';
  return `Import candidates: ${names.join(', ')}${remaining}.`;
}

export function buildCommunicationStep(): OnboardingWizardStepDefinition {
  return {
    id: 'agent-communication',
    title: 'Channels and notifications',
    shortLabel: 'Channels',
    description: 'Prepare companion pairing, messaging-channel readiness, notification delivery, and safe outbound communication for day-one Agent use.',
    summaryTitle: 'Communication posture',
    summaryLines: [
      'Companion chat: paired through the connected GoodVibes host',
      'Channel accounts: inspect readiness before using them',
      'Outbound messages: explicit user action only',
    ],
    fields: [
      {
        kind: 'action',
        id: 'agent-communication.companion',
        action: 'open-agent-workspace:channels',
        label: 'Companion pairing',
        hint: 'Open the Channels workspace to pair companion clients and review channel readiness and delivery safety.',
        defaultValue: 'Open Channels',
      },
      {
        kind: 'status',
        id: 'agent-communication.channels',
        label: 'Messaging channels',
        hint: 'Use the Channels workspace to inspect account readiness, delivery posture, and recent communication without changing connection state.',
        defaultValue: 'Inspectable',
      },
      {
        kind: 'status',
        id: 'agent-communication.notifications',
        label: 'Notification delivery',
        hint: 'Routine, approval, and work-plan notifications require an explicit delivery target and command; Agent never silently sends external messages.',
        defaultValue: 'Explicit only',
      },
      {
        kind: 'status',
        id: 'agent-communication.inbound-policy',
        label: 'Inbound command policy',
        hint: 'Incoming channel commands stay constrained by Agent policy, allowlists, and account posture.',
        defaultValue: 'Policy gated',
      },
    ],
  };
}

export function buildToolsStep(): OnboardingWizardStepDefinition {
  return {
    id: 'agent-tools',
    title: 'Tools and MCP',
    shortLabel: 'Tools',
    description: 'Review tool access for the Agent operator: MCP connections, browser/media helpers, safe read-only inspection, and explicit approval before side effects.',
    summaryTitle: 'Tool posture',
    summaryLines: [
      'MCP and tools: inspect before use',
      'Read/search/summarize: safe by default',
      'Writes, installs, external sends, and account changes: require explicit user action',
    ],
    fields: [
      {
        kind: 'action',
        id: 'agent-tools.mcp',
        action: 'open-agent-workspace:tools',
        label: 'MCP connections and tools',
        hint: 'Open the Tools & MCP workspace to inspect connected MCP servers, roles, trust, and tool readiness.',
        defaultValue: 'Open Tools',
      },
      {
        kind: 'status',
        id: 'agent-tools.browser-media',
        label: 'Browser and media helpers',
        hint: 'Browser, image, audio, and file helpers are task-scoped tools. Agent uses them only when the current task needs them and policy allows it.',
        defaultValue: 'Task scoped',
      },
      {
        kind: 'status',
        id: 'agent-tools.approval-boundary',
        label: 'Power action boundary',
        hint: 'Workspace writes, package installs, external sends, and account changes require an explicit command or confirmation.',
        defaultValue: 'Approval required',
      },
      {
        kind: 'status',
        id: 'agent-tools.no-hidden-work',
        label: 'Hidden work policy',
        hint: 'Tool use stays visible in the main Agent conversation or explicit command workspace; no hidden background work is started from onboarding.',
        defaultValue: 'Visible',
      },
    ],
  };
}

export function buildAgentKnowledgeStep(): OnboardingWizardStepDefinition {
  return {
    id: 'agent-knowledge',
    title: 'Agent Knowledge',
    shortLabel: 'Knowledge',
    description: 'Agent Knowledge is isolated to the GoodVibes Agent product segment. It never falls back to default Knowledge/Wiki or any non-Agent product segment.',
    summaryTitle: 'Knowledge isolation',
    summaryLines: [
      'Route segment: /api/goodvibes-agent/knowledge/*',
      'Default wiki fallback: disabled',
      'Non-Agent route fallback: disabled',
    ],
    fields: [
      {
        kind: 'action',
        id: 'agent-knowledge.route',
        action: 'open-agent-workspace:knowledge',
        label: 'Isolated Agent Knowledge route',
        hint: 'Open the Knowledge workspace for isolated Agent ask, search, status, ingest, and review actions.',
        defaultValue: 'Open Knowledge',
      },
      {
        kind: 'status',
        id: 'agent-knowledge.no-default-wiki',
        label: 'Default Knowledge/Wiki fallback',
        hint: 'Agent setup and Agent ask/search must not query the default wiki when Agent Knowledge has no answer.',
        defaultValue: 'Blocked',
      },
      {
        kind: 'status',
        id: 'agent-knowledge.no-non-agent-routes',
        label: 'Non-Agent route fallback',
        hint: 'Other product routes are not part of Agent Knowledge.',
        defaultValue: 'Blocked',
      },
    ],
  };
}

export function buildResearchStep(): OnboardingWizardStepDefinition {
  return {
    id: 'agent-research',
    title: 'Research and source triage',
    shortLabel: 'Research',
    description: 'Prepare read-only web research and source triage. Research runs in the main Agent conversation; durable source storage uses explicit Agent Knowledge ingest.',
    summaryTitle: 'Research posture',
    summaryLines: [
      'Web research: read-only main-conversation requests',
      'URL inspection: user-directed and visible',
      'Durable sources: explicit Agent Knowledge ingest only',
    ],
    fields: [
      {
        kind: 'action',
        id: 'agent-research.workspace',
        action: 'open-agent-workspace:research',
        label: 'Research workspace',
        hint: 'Open the Research workspace to submit web research, inspect URLs, and decide what belongs in Agent Knowledge.',
        defaultValue: 'Open Research',
      },
      {
        kind: 'status',
        id: 'agent-research.read-only',
        label: 'Read-only web use',
        hint: 'Search and URL inspection are normal Agent conversation turns. They should not send messages, mutate connected-host state, or perform browser side effects.',
        defaultValue: 'Serial',
      },
      {
        kind: 'status',
        id: 'agent-research.knowledge-boundary',
        label: 'Source-to-knowledge boundary',
        hint: 'Reviewed sources become durable only through confirmed Agent Knowledge ingest actions. Default Knowledge/Wiki and non-Agent segments are not fallback stores.',
        defaultValue: 'Explicit ingest',
      },
      {
        kind: 'status',
        id: 'agent-research.context-references',
        label: 'Inline URL context',
        hint: 'Use @https://... in the composer to reference a URL for one turn without ingesting it into Agent Knowledge.',
        defaultValue: 'Available',
      },
    ],
  };
}

export function buildLocalStateStep(discovery?: AgentBehaviorDiscoverySnapshot): OnboardingWizardStepDefinition {
  const discoveredCount = discoveryCount(discovery);
  return {
    id: 'agent-local-state',
    title: 'Local memory and behavior',
    shortLabel: 'Behavior',
    description: discoveredCount > 0
      ? 'Review importable Agent-local behavior files, then create an isolated profile from them or import individual records.'
      : 'Review the Agent-local behavior model. Memory, personas, skills, routines, and Agent profiles stay local until a stable shared registry exists.',
    summaryTitle: 'Local Agent state',
    summaryLines: [
      'Memory/personas/skills/routines: local Agent registries',
      `Discovered behavior files: ${discoverySummary(discovery)}`,
      'Secrets: rejected or stored by secret reference',
      'Profiles: isolated Agent homes',
    ],
    fields: [
      {
        kind: 'action',
        id: 'agent-local-state.memory',
        action: 'open-agent-workspace:memory',
        label: 'Local memory',
        hint: 'Open the Memory & Skills workspace to create, review, stale, search, and delete Agent-local memory records.',
        defaultValue: 'Open Memory',
      },
      {
        kind: 'action',
        id: 'agent-local-state.personas',
        action: 'open-agent-workspace:personas',
        label: 'Personas',
        hint: discovery?.personas.count && discovery.personas.count > 0
          ? `${discovery.personas.count} persona file(s) are available. Open the Personas workspace to review, import, activate, or create a profile from discovered behavior.`
          : 'Open the Personas workspace to create and activate serial operating modes for the main conversation.',
        defaultValue: discovery?.personas.count && discovery.personas.count > 0 ? `${discovery.personas.count} discovered` : 'Open Personas',
      },
      {
        kind: 'action',
        id: 'agent-local-state.skills',
        action: 'open-agent-workspace:skills',
        label: 'Skills',
        hint: discovery?.skills.count && discovery.skills.count > 0
          ? `${discovery.skills.count} skill file(s) are available. Open the Skills workspace to review, import, bundle, enable reusable procedures, or create a profile from discovered behavior.`
          : 'Open the Skills workspace to manage reusable Agent procedures.',
        defaultValue: discovery?.skills.count && discovery.skills.count > 0 ? `${discovery.skills.count} discovered` : 'Open Skills',
      },
      {
        kind: 'action',
        id: 'agent-local-state.routines',
        action: 'open-agent-workspace:routines',
        label: 'Routines',
        hint: discovery?.routines.count && discovery.routines.count > 0
          ? `${discovery.routines.count} routine file(s) are available. Open the Routines workspace to review, import, start, promote reviewed routines, or create a profile from discovered behavior. ${discoverySample(discovery)}`
          : 'Open the Routines workspace for reusable local procedures. Starting a routine prints steps in the main conversation and does not launch local workers.',
        defaultValue: discovery?.routines.count && discovery.routines.count > 0 ? `${discovery.routines.count} discovered` : 'Open Routines',
      },
      {
        kind: 'text',
        id: 'agent-local-state.persona-name',
        label: 'Initial persona name',
        hint: 'Optional: create and activate a serial Agent persona during setup. Leave persona fields blank to skip.',
        placeholder: 'Household Operator',
        defaultValue: '',
        spacerBeforeRows: 1,
      },
      {
        kind: 'text',
        id: 'agent-local-state.persona-description',
        label: 'Initial persona description',
        hint: 'Describe when this persona should shape the main conversation.',
        placeholder: 'Handles day-to-day planning, reminders, device checks, and household coordination.',
        defaultValue: '',
      },
      {
        kind: 'text',
        id: 'agent-local-state.persona-body',
        label: 'Initial persona instructions',
        hint: 'Tell Agent how to behave when this persona is active.',
        placeholder: 'Be concise, proactive, and use safe local actions before asking for follow-up details.',
        defaultValue: '',
        multiline: true,
      },
      {
        kind: 'text',
        id: 'agent-local-state.skill-name',
        label: 'Initial skill name',
        hint: 'Optional: create and enable a reusable local procedure during setup.',
        placeholder: 'Daily Briefing',
        defaultValue: '',
        spacerBeforeRows: 1,
      },
      {
        kind: 'text',
        id: 'agent-local-state.skill-description',
        label: 'Initial skill description',
        hint: 'Describe when Agent should use this skill.',
        placeholder: 'Prepares a concise morning briefing from calendar, tasks, and current priorities.',
        defaultValue: '',
      },
      {
        kind: 'text',
        id: 'agent-local-state.skill-procedure',
        label: 'Initial skill procedure',
        hint: 'Write the procedure Agent should reuse in the main conversation.',
        placeholder: 'Check tasks, summarize important events, identify blockers, and ask only for missing critical inputs.',
        defaultValue: '',
        multiline: true,
      },
      {
        kind: 'text',
        id: 'agent-local-state.routine-name',
        label: 'Initial routine name',
        hint: 'Optional: create and enable a local routine. Routines print steps in the main conversation and do not launch hidden jobs.',
        placeholder: 'Evening Reset',
        defaultValue: '',
        spacerBeforeRows: 1,
      },
      {
        kind: 'text',
        id: 'agent-local-state.routine-description',
        label: 'Initial routine description',
        hint: 'Describe when the routine should be suggested or started.',
        placeholder: 'Reviews open tasks, tomorrow priorities, and pending approvals before the day ends.',
        defaultValue: '',
      },
      {
        kind: 'text',
        id: 'agent-local-state.routine-steps',
        label: 'Initial routine steps',
        hint: 'Write the local routine steps. This stays in Agent-local state only.',
        placeholder: 'Review open tasks; summarize unresolved approvals; list tomorrow priorities; ask what to defer.',
        defaultValue: '',
        multiline: true,
      },
    ],
  };
}

export function buildAutomationStep(): OnboardingWizardStepDefinition {
  return {
    id: 'agent-automation',
    title: 'Routines and automation',
    shortLabel: 'Routines',
    description: 'Set the Agent automation posture: local routines run in the main conversation, while connected schedules remain explicit.',
    summaryTitle: 'Routine and schedule posture',
    summaryLines: [
      'Local routines: reusable main-conversation workflows',
      'Connected schedules: explicit promotion only',
      'Runs/cancels/retries: command-confirmed side effects',
    ],
    fields: [
      {
        kind: 'action',
        id: 'agent-automation.local-routines',
        action: 'open-agent-workspace:routines',
        label: 'Local routine library',
        hint: 'Open the Routines workspace to create, review, enable, and start local routines without hidden jobs.',
        defaultValue: 'Open Routines',
      },
      {
        kind: 'action',
        id: 'agent-automation.schedule-observability',
        action: 'open-agent-workspace:automation',
        label: 'Schedule observability',
        hint: 'Open the Automation workspace to inspect schedules, receipts, reconciliation, externally owned jobs, and runs.',
        defaultValue: 'Open Automation',
      },
      {
        kind: 'status',
        id: 'agent-automation.schedule-promotion',
        label: 'Routine-to-schedule promotion',
        hint: 'Creating connected schedules from routines requires a reviewed routine, a real timing expression, optional delivery target, and explicit confirmation.',
        defaultValue: 'Explicit command',
      },
      {
        kind: 'status',
        id: 'agent-automation.mutations',
        label: 'Automation mutations',
        hint: 'Run, pause, resume, cancel, retry, approve, and deny actions are never inferred from chat; they require exact commands and confirmation.',
        defaultValue: 'Confirmed only',
      },
    ],
  };
}

export function buildVoiceMediaStep(): OnboardingWizardStepDefinition {
  return {
    id: 'agent-voice-media',
    title: 'Voice and media',
    shortLabel: 'Voice',
    description: 'Prepare voice, speech, image input, and media understanding as optional Agent operator tools.',
    summaryTitle: 'Voice and media posture',
    summaryLines: [
      'Voice and speech: optional operator tools',
      'Image/audio inputs: explicit attachment workflows',
      'Media generation and playback: provider-backed and policy-gated',
    ],
    fields: [
      {
        kind: 'action',
        id: 'agent-voice-media.voice',
        action: 'open-agent-workspace:voice-media',
        label: 'Voice interaction',
        hint: 'Open the Voice & Media workspace and TTS settings to configure spoken responses for the Agent conversation.',
        defaultValue: 'Open Voice',
      },
      {
        kind: 'status',
        id: 'agent-voice-media.attachments',
        label: 'Image and audio input',
        hint: 'Attach files explicitly to a prompt or command. Agent does not ingest media into Knowledge without an Agent Knowledge ingest action.',
        defaultValue: 'Explicit input',
      },
      {
        kind: 'status',
        id: 'agent-voice-media.output',
        label: 'Generated media and playback',
        hint: 'Media output uses configured providers and visible command/turn flow; external publication still requires explicit approval.',
        defaultValue: 'Policy gated',
      },
    ],
  };
}

export function buildDelegationPolicyStep(): OnboardingWizardStepDefinition {
  return {
    id: 'agent-delegation',
    title: 'Build delegation',
    shortLabel: 'Delegate',
    description: 'GoodVibes Agent is not the coding TUI. Explicit build, fix, review, or implementation work is delegated to GoodVibes TUI; ordinary assistant work stays serial in this conversation.',
    summaryTitle: 'Delegation policy',
    summaryLines: [
      'Normal chat: main Agent conversation',
      'Build/fix/review: explicit GoodVibes TUI delegation',
      'WRFC: only when explicitly requested for build/fix/review',
    ],
    fields: [
      {
        kind: 'status',
        id: 'agent-delegation.normal-chat',
        label: 'Normal assistant work',
        hint: 'Planning, research, summaries, local memory updates, and safe read-only checks stay in the main Agent conversation.',
        defaultValue: 'Serial',
      },
      {
        kind: 'action',
        id: 'agent-delegation.build-work',
        action: 'open-agent-workspace:delegate',
        label: 'Build/fix/review work',
        hint: 'Open the Delegation workspace for explicit build/fix/review handoff. GoodVibes TUI owns coding execution and WRFC chains.',
        defaultValue: 'Open Delegation',
      },
      {
        kind: 'status',
        id: 'agent-delegation.wrfc',
        label: 'WRFC policy',
        hint: 'Agent never uses WRFC by default; request it only for explicit build, fix, review, or implementation work.',
        defaultValue: 'Explicit only',
      },
    ],
  };
}
