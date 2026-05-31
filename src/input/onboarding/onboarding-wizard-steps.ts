import { REASONING_OPTIONS, HITL_MODE_OPTIONS, GUIDANCE_MODE_OPTIONS, PERMISSION_MODE_OPTIONS, SECRET_POLICY_OPTIONS } from './onboarding-wizard-constants.ts';
import { modelSelectionLabel, normalizeText } from './onboarding-wizard-helpers.ts';
import type { OnboardingWizardController } from './onboarding-wizard.ts';
import type { OnboardingWizardActionFieldDefinition, OnboardingWizardFieldDefinition, OnboardingWizardModelPickerFieldDefinition, OnboardingWizardRadioFieldDefinition, OnboardingWizardStepDefinition } from './onboarding-wizard-types.ts';

export function buildOnboardingWizardSteps(controller: OnboardingWizardController): readonly OnboardingWizardStepDefinition[] {
  if (controller.hydrationPending || controller.hydrationError !== null) return [buildLoadingStep(controller)];

  return [
    buildAgentSetupStep(controller),
    buildProviderAccessStep(controller),
    buildDefaultModelStep(controller),
    buildCommunicationStep(),
    buildToolsStep(),
    buildAgentKnowledgeStep(),
    buildLocalStateStep(),
    buildAutomationStep(),
    buildVoiceMediaStep(),
    buildDelegationPolicyStep(),
    buildExperienceStep(controller),
    buildReviewStep(controller),
  ].map(addApplyAndContinueAction);
}

function buildApplyAndContinueAction(step: OnboardingWizardStepDefinition): OnboardingWizardActionFieldDefinition {
  return {
    kind: 'action',
    id: `${step.id}.apply-and-continue`,
    action: 'apply-and-continue',
    label: 'Apply & Continue To Next Section',
    hint: 'Save the current wizard selections in this onboarding session and move to the next section. Settings are persisted on the final Review apply.',
    defaultValue: 'Apply & next',
    spacerBeforeRows: 2,
  };
}

function addApplyAndContinueAction(step: OnboardingWizardStepDefinition): OnboardingWizardStepDefinition {
  if (step.id === 'loading' || step.id === 'review') return step;
  return {
    ...step,
    fields: [...step.fields, buildApplyAndContinueAction(step)],
  };
}

export function buildCommunicationStep(): OnboardingWizardStepDefinition {
  return {
    id: 'agent-communication',
    title: 'Channels and notifications',
    shortLabel: 'Channels',
    description: 'Prepare the Agent for companion pairing, messaging-channel awareness, notification delivery, and safe outbound communication without changing runtime connectivity.',
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
        defaultValue: 'External service route',
      },
      {
        kind: 'status',
        id: 'agent-communication.channels',
        label: 'Messaging channels',
        hint: 'Use the Channels workspace to inspect account readiness, delivery posture, and recent communication without changing runtime connectivity.',
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
    description: 'Review tool access for the Agent operator: MCP servers, browser/media helpers, safe read-only inspection, and explicit approval before side effects.',
    summaryTitle: 'Tool posture',
    summaryLines: [
      'MCP and tools: inspect before use',
      'Read/search/summarize: safe by default',
      'Writes, installs, external sends, and service changes: require explicit user action',
    ],
    fields: [
      {
        kind: 'status',
        id: 'agent-tools.mcp',
        label: 'MCP servers and tools',
        hint: 'Use /mcp servers and the Agent workspace Tools area to inspect connected servers, roles, and tool readiness.',
        defaultValue: 'Inspectable',
      },
      {
        kind: 'status',
        id: 'agent-tools.browser-media',
        label: 'Browser and media helpers',
        hint: 'Browser, image, audio, and file helpers are capability surfaces. Agent uses them only when the current task needs them and policy allows it.',
        defaultValue: 'Task scoped',
      },
      {
        kind: 'status',
        id: 'agent-tools.approval-boundary',
        label: 'Power action boundary',
        hint: 'Workspace writes, package installs, external sends, account changes, and service changes require an explicit command or confirmation.',
        defaultValue: 'Approval required',
      },
      {
        kind: 'status',
        id: 'agent-tools.no-hidden-work',
        label: 'Hidden work policy',
        hint: 'Tool use stays visible in the main Agent conversation or explicit command surface; no hidden background work is started from onboarding.',
        defaultValue: 'Visible',
      },
    ],
  };
}

export function buildLoadingStep(controller: OnboardingWizardController): OnboardingWizardStepDefinition {
  const failed = controller.hydrationError !== null;
  return {
    id: 'loading',
    title: failed ? 'Current settings unavailable' : 'Loading Agent setup',
    shortLabel: 'Loading',
    description: failed
      ? 'The wizard is locked because current Agent settings could not be collected. Close and reopen onboarding after fixing the reported issue.'
      : 'Collecting current Agent settings before the setup workspace becomes editable.',
    summaryTitle: failed ? 'Preload failed' : 'Preload required',
    summaryLines: [
      failed ? controller.hydrationError ?? 'Unknown snapshot failure.' : 'Editable fields are locked until Agent settings are loaded.',
      failed ? 'No setup values were changed.' : 'This prevents the wizard from applying defaults over existing Agent configuration.',
    ],
    fields: [
      {
        kind: 'status',
        id: 'loading.runtime-snapshot',
        label: failed ? 'Agent settings snapshot failed' : 'Agent settings snapshot',
        hint: failed ? controller.hydrationError ?? 'The setup snapshot did not complete.' : 'Waiting for current Agent account, provider, and local setup state.',
        defaultValue: failed ? 'Locked' : 'Loading',
      },
    ],
  };
}

export function buildAgentSetupStep(controller: OnboardingWizardController): OnboardingWizardStepDefinition {
  const collectionIssues = controller.runtimeSnapshot?.collectionIssues.length ?? 0;
  const secretPolicy = controller.runtimeSnapshot?.runtimeDefaults.secretStoragePolicy ?? 'preferred_secure';
  return {
    id: 'agent-setup',
    title: 'Agent setup',
    shortLabel: 'Agent',
    description: 'Set up the Agent operator workspace: local identity, provider access, isolated Agent Knowledge, reusable local behavior, and explicit build delegation.',
    summaryTitle: 'Agent setup posture',
    summaryLines: [
      'Agent owns the operator TUI and local behavior registry.',
      'GoodVibes runtime lifecycle is external to this product.',
      `Secret policy: ${controller.getStringFieldValue('agent-setup.secret-policy', secretPolicy)}`,
      collectionIssues > 0 ? `${collectionIssues} setup snapshot issue(s)` : 'Setup snapshot collected cleanly',
    ],
    fields: [
      {
        kind: 'status',
        id: 'agent-setup.identity',
        label: 'Product identity',
        hint: 'GoodVibes Agent is a personal operator TUI with Agent-local profiles, memory, skills, personas, routines, and isolated Agent Knowledge.',
        defaultValue: 'Agent operator',
      },
      {
        kind: 'status',
        id: 'agent-setup.connection',
        label: 'GoodVibes runtime connection',
        hint: collectionIssues > 0
          ? `${collectionIssues} setup snapshot issue(s) were reported. Status and doctor commands show connection details.`
          : 'Agent connects to an already-running GoodVibes runtime for companion chat, work plans, approvals, automation, and Agent Knowledge.',
        defaultValue: collectionIssues > 0 ? `${collectionIssues} issue(s)` : 'External service',
      },
      {
        kind: 'radio',
        id: 'agent-setup.secret-policy',
        label: 'Secret storage policy',
        hint: 'Choose how Agent setup should store provider keys. Secret values are never shown in the wizard.',
        options: SECRET_POLICY_OPTIONS,
        defaultValue: secretPolicy,
      },
      {
        kind: 'status',
        id: 'agent-setup.profile-guide',
        label: 'Runtime profiles',
        hint: 'Use /agent-profile guide after setup to create household, research, travel, operations, or custom Agent profiles.',
        defaultValue: 'Local profiles',
      },
    ],
  };
}

export function buildProviderAccessStep(controller: OnboardingWizardController): OnboardingWizardStepDefinition {
  const activeSubscriptions = controller.runtimeSnapshot?.subscriptions.active ?? [];
  const pendingSubscriptions = controller.runtimeSnapshot?.subscriptions.pending ?? [];
  const openAiActive = activeSubscriptions.some((subscription) => subscription.provider === 'openai');
  const openAiPending = pendingSubscriptions.some((subscription) => subscription.provider === 'openai');
  const providerSecretCount = controller.runtimeSnapshot?.secrets.records.filter((record) => record.key.endsWith('_API_KEY') || record.key.endsWith('_TOKEN')).length ?? 0;
  const openAiApiKeyConfigured = controller.runtimeSnapshot?.secrets.records.some((record) => record.key === 'OPENAI_API_KEY') ?? false;
  const fields: OnboardingWizardFieldDefinition[] = [
    {
      kind: 'status',
      id: 'providers.openai-subscription',
      label: 'OpenAI subscription status',
      hint: openAiActive
        ? 'An OpenAI subscription session is already available.'
        : openAiPending
          ? 'An OpenAI subscription login is pending.'
          : 'No OpenAI subscription session was found in the current Agent state.',
      defaultValue: openAiActive ? 'Active' : openAiPending ? 'Pending' : 'Not detected',
    },
    {
      kind: 'status',
      id: 'providers.api-key-inventory',
      label: 'Provider API key inventory',
      hint: providerSecretCount > 0 ? `${providerSecretCount} provider credential reference(s) were found. Values stay masked.` : 'No provider API key references were detected in the current Agent state.',
      defaultValue: providerSecretCount > 0 ? `${providerSecretCount} configured` : 'None detected',
    },
    {
      kind: 'masked',
      id: 'providers.openai-api-key',
      label: 'OpenAI API key',
      hint: openAiApiKeyConfigured
        ? 'An OpenAI API key is already stored. Leave blank to keep it; enter a new key to replace it through the secret manager.'
        : 'Optional: enter an OpenAI API key now. The value is stored through the secret manager, not in config.',
      placeholder: openAiApiKeyConfigured ? 'already configured' : 'sk-...',
      defaultValue: '',
    },
    ...(openAiActive ? [] : [
      {
        kind: 'action' as const,
        id: 'providers.openai-subscription-start',
        action: 'start-openai-subscription' as const,
        label: openAiPending ? 'Restart OpenAI subscription sign-in' : 'Start OpenAI subscription sign-in',
        hint: 'Opens the OpenAI sign-in flow from the wizard and records pending login state here.',
        defaultValue: openAiPending ? 'Restart' : 'Start',
      },
      ...(openAiPending ? [
        {
          kind: 'text' as const,
          id: 'providers.openai-authorization-url',
          label: 'OpenAI authorization URL',
          hint: 'If the browser did not open, use this URL to continue sign-in without leaving the wizard.',
          placeholder: 'authorization URL appears after start',
          defaultValue: '',
        },
        {
          kind: 'text' as const,
          id: 'providers.openai-callback-code',
          label: 'OpenAI callback code or URL',
          hint: 'Paste the callback code or redirected URL after completing browser sign-in.',
          placeholder: 'code or callback URL',
          defaultValue: '',
        },
        {
          kind: 'action' as const,
          id: 'providers.openai-subscription-finish',
          action: 'finish-openai-subscription' as const,
          label: 'Finish OpenAI subscription sign-in',
          hint: 'Completes the pending OpenAI subscription login using the code above.',
          defaultValue: 'Finish',
        },
      ] : []),
    ]),
  ];

  return {
    id: 'provider-access',
    title: 'AI provider access',
    shortLabel: 'Providers',
    description: 'Review provider access for the Agent conversation. Credentials stay masked and are stored through the secret manager.',
    summaryTitle: 'Provider access summary',
    summaryLines: [
      `OpenAI subscription: ${openAiActive ? 'active' : openAiPending ? 'pending' : 'not detected'}`,
      `OpenAI API key: ${openAiApiKeyConfigured ? 'configured' : 'not detected'}`,
      `Provider credential references: ${providerSecretCount}`,
    ],
    fields,
  };
}

export function buildDefaultModelStep(controller: OnboardingWizardController): OnboardingWizardStepDefinition {
  const routing = controller.runtimeSnapshot?.providerRouting;
  const primarySelectionField: OnboardingWizardModelPickerFieldDefinition = {
    kind: 'modelPicker',
    id: 'default-model.primary-model',
    label: 'Default provider + model',
    hint: 'Open the model picker for the Agent conversation route.',
    target: 'main',
    defaultSelection: {
      providerId: normalizeText(routing?.primaryProviderId),
      modelId: normalizeText(routing?.primaryModelId),
      enabled: true,
    },
  };
  const reasoningField: OnboardingWizardRadioFieldDefinition = {
    kind: 'radio',
    id: 'default-model.reasoning',
    label: 'Reasoning effort',
    hint: 'Choose the default reasoning effort for the serial Agent conversation.',
    options: REASONING_OPTIONS,
    defaultValue: normalizeText(routing?.primaryReasoningEffort) || 'medium',
  };

  return {
    id: 'default-model',
    title: 'Default model',
    shortLabel: 'Model',
    description: 'Choose the default provider, model, and reasoning posture for normal Agent conversation.',
    summaryTitle: 'Default model summary',
    summaryLines: [
      `Main: ${modelSelectionLabel(controller.modelSelectionState.get('main') ?? primarySelectionField.defaultSelection)}`,
      `Reasoning: ${controller.getFieldValueLabel(reasoningField)}`,
    ],
    fields: [primarySelectionField, reasoningField],
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
    description: 'Review the Agent-local behavior model. Memory, personas, skills, routines, and runtime profiles stay local until a stable shared registry exists.',
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
    description: 'Prepare voice, speech, image input, and media understanding as Agent operator surfaces rather than runtime lifecycle features.',
    summaryTitle: 'Voice and media posture',
    summaryLines: [
      'Voice and speech: optional operator surfaces',
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
      {
        kind: 'status',
        id: 'agent-voice-media.nodes',
        label: 'Node and device posture',
        hint: 'Remote devices and nodes are inspected as capability surfaces. Agent does not own runner topology or launch service processes from onboarding.',
        defaultValue: 'External',
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

export function buildExperienceStep(controller: OnboardingWizardController): OnboardingWizardStepDefinition {
  return {
    id: 'experience',
    title: 'Assistant experience',
    shortLabel: 'Behavior',
    description: 'Tune the Agent conversation style and approval posture for day-to-day operator use.',
    summaryTitle: 'Experience posture',
    summaryLines: [
      `Human-in-the-Loop (HITL): ${controller.getStringFieldValue('experience.hitl', controller.runtimeSnapshot?.runtimeDefaults.behavior.hitlMode ?? 'balanced')}`,
      `Guidance: ${controller.getStringFieldValue('experience.guidance', controller.runtimeSnapshot?.runtimeDefaults.behavior.guidanceMode ?? 'minimal')}`,
      `Permissions: ${controller.getStringFieldValue('experience.permissions', controller.runtimeSnapshot?.runtimeDefaults.permissionsMode ?? 'prompt')}`,
    ],
    fields: [
      {
        kind: 'radio',
        id: 'experience.hitl',
        label: 'Human-in-the-Loop (HITL) mode',
        hint: 'Choose how much operational activity should be shown.',
        options: HITL_MODE_OPTIONS,
        defaultValue: controller.runtimeSnapshot?.runtimeDefaults.behavior.hitlMode ?? 'balanced',
      },
      {
        kind: 'radio',
        id: 'experience.guidance',
        label: 'Guidance verbosity',
        hint: 'Choose how much explanation the Agent should provide while working.',
        options: GUIDANCE_MODE_OPTIONS,
        defaultValue: controller.runtimeSnapshot?.runtimeDefaults.behavior.guidanceMode ?? 'minimal',
      },
      {
        kind: 'radio',
        id: 'experience.permissions',
        label: 'Permission posture',
        hint: 'Choose how aggressively the Agent should ask before powerful actions.',
        options: PERMISSION_MODE_OPTIONS,
        defaultValue: controller.runtimeSnapshot?.runtimeDefaults.permissionsMode ?? 'prompt',
      },
    ],
  };
}

export function buildReviewStep(controller: OnboardingWizardController): OnboardingWizardStepDefinition {
  const feedback = controller.applyFeedback;
  const feedbackFields: OnboardingWizardFieldDefinition[] = feedback
    ? [
        {
          kind: 'status',
          id: 'review.feedback',
          label: feedback.title,
          hint: feedback.summary,
          defaultValue: feedback.severity === 'error' ? 'Needs attention' : feedback.severity === 'warning' ? 'Warning' : 'Info',
        },
        ...feedback.messages.slice(0, 8).map((message, index): OnboardingWizardFieldDefinition => ({
          kind: 'status',
          id: `review.feedback.${index}`,
          label: message,
          hint: message,
          defaultValue: feedback.severity === 'error' ? 'Error' : feedback.severity === 'warning' ? 'Warning' : 'Info',
        })),
      ]
    : [];
  const unsavedLabel = controller.dirtyStepCount === 1
    ? '1 screen has unapplied changes'
    : `${controller.dirtyStepCount} screens have unapplied changes`;

  return {
    id: 'review',
    title: 'Review and apply',
    shortLabel: 'Review',
    description: 'Review Agent-owned settings and apply them directly from the wizard.',
    summaryTitle: 'Review posture',
    summaryLines: [
      unsavedLabel,
      `${controller.buildApplyRequest().operations.length} Agent setting change(s) ready to apply`,
      feedback ? `Last apply: ${feedback.title}` : 'No apply errors reported',
      controller.isEditingTextField() ? `Editing: ${controller.editingFieldId}` : 'Ready to apply',
    ],
    fields: [
      ...feedbackFields,
      {
        kind: 'status',
        id: 'review.global-marker',
        label: 'Agent setup check',
        hint: 'Opening this wizard marks Agent setup as shown for this user account, so it does not reopen automatically.',
        defaultValue: 'Already marked as shown',
      },
      {
        kind: 'action',
        id: 'review.apply',
        action: 'apply',
        label: 'Apply Agent settings and verify',
        hint: 'Persist the Agent-owned settings and verify that no runtime lifecycle, non-Agent entrypoint, default wiki, or non-Agent knowledge setup was requested.',
        defaultValue: 'Ready',
      },
    ],
  };
}
