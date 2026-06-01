import type { OnboardingWizardStepDefinition } from './onboarding-wizard-types.ts';

export function buildCommunicationStep(): OnboardingWizardStepDefinition {
  return {
    id: 'agent-communication',
    title: 'Channels and notifications',
    shortLabel: 'Channels',
    description: 'Prepare the Agent for companion pairing, messaging-channel awareness, notification delivery, and safe outbound communication without changing the GoodVibes runtime connection.',
    summaryTitle: 'Communication posture',
    summaryLines: [
      'Companion chat: paired through the GoodVibes runtime',
      'Channel accounts: inspect readiness before using them',
      'Outbound messages: explicit user action only',
    ],
    fields: [
      {
        kind: 'status',
        id: 'agent-communication.companion',
        label: 'Companion pairing',
        hint: 'Use /pair from the Agent workspace to pair companion clients through the already-running GoodVibes runtime.',
        defaultValue: 'External runtime route',
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
        hint: 'Incoming channel commands stay constrained by runtime policy, allowlists, and account posture.',
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
        kind: 'status',
        id: 'agent-tools.mcp',
        label: 'MCP connections and tools',
        hint: 'Use /mcp servers and the Agent workspace Tools area to inspect connected MCP endpoints, roles, and tool readiness.',
        defaultValue: 'Inspectable',
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
        kind: 'status',
        id: 'agent-knowledge.route',
        label: 'Isolated Agent Knowledge route',
        hint: 'Ask, search, status, and ingest use /api/goodvibes-agent/knowledge/* only.',
        defaultValue: 'Isolated',
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

export function buildLocalStateStep(): OnboardingWizardStepDefinition {
  return {
    id: 'agent-local-state',
    title: 'Local memory and behavior',
    shortLabel: 'Memory',
    description: 'Review the Agent-local behavior model. Memory, personas, skills, routines, and Agent profiles stay local until a stable shared registry exists.',
    summaryTitle: 'Local Agent state',
    summaryLines: [
      'Memory/personas/skills/routines: local Agent registries',
      'Secrets: rejected or stored by secret reference',
      'Profiles: isolated Agent homes',
    ],
    fields: [
      {
        kind: 'status',
        id: 'agent-local-state.memory',
        label: 'Local memory',
        hint: 'Use /memory to create, review, stale, search, and delete Agent-local memory records.',
        defaultValue: 'Local registry',
      },
      {
        kind: 'status',
        id: 'agent-local-state.personas',
        label: 'Personas',
        hint: 'Use /personas to create and activate serial operating modes for the main conversation.',
        defaultValue: 'Local registry',
      },
      {
        kind: 'status',
        id: 'agent-local-state.skills',
        label: 'Skills',
        hint: 'Use /agent-skills and /skills local to manage reusable Agent procedures.',
        defaultValue: 'Local registry',
      },
      {
        kind: 'status',
        id: 'agent-local-state.routines',
        label: 'Routines',
        hint: 'Use /routines for reusable local procedures. Starting a routine prints steps in the main conversation and does not spawn hidden work.',
        defaultValue: 'Local registry',
      },
    ],
  };
}

export function buildAutomationStep(): OnboardingWizardStepDefinition {
  return {
    id: 'agent-automation',
    title: 'Routines and automation',
    shortLabel: 'Routines',
    description: 'Set the Agent automation posture: local routines run in the main conversation, while external schedules remain explicit.',
    summaryTitle: 'Routine and schedule posture',
    summaryLines: [
      'Local routines: reusable main-conversation workflows',
      'External schedules: explicit promotion only',
      'Runs/cancels/retries: command-confirmed side effects',
    ],
    fields: [
      {
        kind: 'status',
        id: 'agent-automation.local-routines',
        label: 'Local routine library',
        hint: 'Use /routines or the Agent workspace to create, review, enable, and start local routines without spawning hidden jobs.',
        defaultValue: 'Local registry',
      },
      {
        kind: 'status',
        id: 'agent-automation.schedule-observability',
        label: 'Schedule observability',
        hint: 'Use /schedule list, /schedule reconcile, and automation views to inspect externally owned jobs and runs.',
        defaultValue: 'Read first',
      },
      {
        kind: 'status',
        id: 'agent-automation.schedule-promotion',
        label: 'Routine-to-schedule promotion',
        hint: 'Creating external schedules from routines requires a reviewed routine, a real timing expression, optional delivery target, and explicit confirmation.',
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
    description: 'Prepare voice, speech, image input, and media understanding as Agent operator tools rather than runtime lifecycle features.',
    summaryTitle: 'Voice and media posture',
    summaryLines: [
      'Voice and speech: optional operator tools',
      'Image/audio inputs: explicit attachment workflows',
      'Media generation and playback: provider-backed and policy-gated',
    ],
    fields: [
      {
        kind: 'status',
        id: 'agent-voice-media.voice',
        label: 'Voice interaction',
        hint: 'Use the voice/media workspace and TTS settings to configure spoken responses for the Agent conversation.',
        defaultValue: 'Optional',
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
        kind: 'status',
        id: 'agent-delegation.build-work',
        label: 'Build/fix/review work',
        hint: 'Use /delegate with the full original task. GoodVibes TUI owns coding execution and WRFC chains.',
        defaultValue: 'Explicit delegation',
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
