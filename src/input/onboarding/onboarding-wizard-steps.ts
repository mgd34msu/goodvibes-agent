import { REASONING_OPTIONS, HITL_MODE_OPTIONS, GUIDANCE_MODE_OPTIONS, PERMISSION_MODE_OPTIONS, SECRET_POLICY_OPTIONS } from './onboarding-wizard-constants.ts';
import { modelSelectionLabel, normalizeText } from './onboarding-wizard-helpers.ts';
import { buildAgentKnowledgeStep, buildAutomationStep, buildCommunicationStep, buildDelegationPolicyStep, buildLocalStateStep, buildToolsStep, buildVoiceMediaStep } from './onboarding-wizard-operator-steps.ts';
import { listAgentRuntimeProfileTemplates } from '../../agent/runtime-profile.ts';
import type { OnboardingWizardController } from './onboarding-wizard.ts';
import type { OnboardingWizardActionFieldDefinition, OnboardingWizardFieldDefinition, OnboardingWizardModelPickerFieldDefinition, OnboardingWizardRadioFieldDefinition, OnboardingWizardRadioOption, OnboardingWizardStepDefinition } from './onboarding-wizard-types.ts';
import type { OnboardingProviderAccountRecord, OnboardingStep1CapabilityId, OnboardingStep1CapabilityItem } from '../../runtime/onboarding/index.ts';

function buildStarterTemplateOptions(): readonly OnboardingWizardRadioOption[] {
  return [
    {
      id: 'none',
      label: 'No profile',
      hint: 'Keep using the current Agent home. You can create isolated profiles later from the Agent workspace.',
    },
    ...listAgentRuntimeProfileTemplates().map((template): OnboardingWizardRadioOption => ({
      id: template.id,
      label: template.name,
      hint: `${template.description} Includes persona ${template.personaName}, skills ${template.skillNames.join(', ')}, and routines ${template.routineNames.join(', ')}.`,
    })),
  ];
}

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
    label: 'Apply & Continue',
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

function findRuntimeCapability(
  controller: OnboardingWizardController,
  id: OnboardingStep1CapabilityId,
): OnboardingStep1CapabilityItem | null {
  return controller.runtimeDerived.step1Capabilities.find((capability) => capability.id === id) ?? null;
}

function currentMainModelLabel(controller: OnboardingWizardController): string {
  const routing = controller.runtimeSnapshot?.providerRouting;
  return modelSelectionLabel(controller.modelSelectionState.get('main') ?? {
    providerId: normalizeText(routing?.primaryProviderId),
    modelId: normalizeText(routing?.primaryModelId),
    enabled: true,
  });
}

function profileSetupLabel(controller: OnboardingWizardController): string {
  const profileName = normalizeText(controller.getStringFieldValue('agent-setup.profile-name', ''));
  const templateId = controller.getStringFieldValue('agent-setup.profile-template', 'none');
  if (profileName.length === 0) return 'Current home';
  return templateId === 'none' ? `Create ${profileName}` : `Create ${profileName} from ${templateId}`;
}

function formatBoundedList(values: readonly string[], empty: string): string {
  const unique = [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
  if (unique.length === 0) return empty;
  if (unique.length <= 4) return unique.join(', ');
  return `${unique.slice(0, 4).join(', ')} +${unique.length - 4} more`;
}

function providerAccountLabel(provider: OnboardingProviderAccountRecord): string {
  const route = provider.activeRoute && provider.activeRoute !== 'unconfigured'
    ? provider.activeRoute
    : provider.oauthReady
      ? 'oauth-ready'
      : provider.pendingLogin
        ? 'pending-login'
        : provider.configured
          ? 'configured'
          : 'unconfigured';
  return `${provider.providerId}:${route}`;
}

function buildReviewReadinessFields(controller: OnboardingWizardController): readonly OnboardingWizardFieldDefinition[] {
  const localBehavior = findRuntimeCapability(controller, 'local-behavior');
  const channels = findRuntimeCapability(controller, 'communication-channels');
  const automation = findRuntimeCapability(controller, 'automation-review');
  const collectionIssues = controller.runtimeSnapshot?.collectionIssues.length ?? 0;

  return [
    {
      kind: 'status',
      id: 'review.readiness.connection',
      label: 'Connected services snapshot',
      hint: collectionIssues > 0
        ? `${collectionIssues} setup snapshot issue(s) need attention before this Agent is day-one ready.`
        : 'The setup snapshot loaded cleanly from connected GoodVibes services.',
      defaultValue: collectionIssues > 0 ? 'Needs attention' : 'Ready',
      spacerBeforeRows: 1,
    },
    {
      kind: 'status',
      id: 'review.readiness.model',
      label: 'Default model route',
      hint: 'Normal assistant turns use this selected provider/model route unless changed later from the model picker.',
      defaultValue: currentMainModelLabel(controller),
    },
    {
      kind: 'status',
      id: 'review.readiness.profile',
      label: 'Agent profile',
      hint: 'Profiles isolate Agent-local config, sessions, memory, personas, skills, routines, and setup state.',
      defaultValue: profileSetupLabel(controller),
    },
    {
      kind: 'status',
      id: 'review.readiness.knowledge',
      label: 'Agent Knowledge segment',
      hint: 'Ask, search, status, and ingest stay on /api/goodvibes-agent/knowledge/* with no default wiki or non-Agent fallback.',
      defaultValue: 'Isolated',
    },
    {
      kind: 'status',
      id: 'review.readiness.local-behavior',
      label: 'Local behavior library',
      hint: localBehavior?.detail ?? 'Agent-local memory, routines, skills, and personas remain local until a stable shared registry exists.',
      defaultValue: localBehavior?.selected ? 'Customized' : 'Starter ready',
    },
    {
      kind: 'status',
      id: 'review.readiness.channels',
      label: 'Channels and notifications',
      hint: channels?.detail ?? 'Connect only the channels the Agent should use, and keep outbound delivery explicit.',
      defaultValue: channels?.selected ? 'Review configured' : 'Optional setup',
    },
    {
      kind: 'status',
      id: 'review.readiness.automation',
      label: 'Routines and schedules',
      hint: automation?.detail ?? 'Local routines run in the main conversation; external schedules require explicit promotion and confirmation.',
      defaultValue: automation?.selected ? 'Review configured' : 'Local first',
    },
    {
      kind: 'status',
      id: 'review.readiness.delegation',
      label: 'Build delegation',
      hint: 'Build, fix, implementation, and review work is handed to GoodVibes TUI only when explicitly requested.',
      defaultValue: 'Explicit only',
    },
  ];
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
      'Optional starter profile: create an isolated Agent home from setup.',
      'Setup here changes only Agent-owned settings and local state.',
      `Secret policy: ${controller.getStringFieldValue('agent-setup.secret-policy', secretPolicy)}`,
      collectionIssues > 0 ? `${collectionIssues} setup snapshot issue(s)` : 'Setup snapshot collected cleanly',
    ],
    fields: [
      {
        kind: 'status',
        id: 'agent-setup.identity',
        label: 'Product identity',
        hint: 'GoodVibes Agent is a personal operator TUI with Agent-local profiles, memory, skills, personas, routines, and isolated Agent Knowledge.',
        defaultValue: 'Operator',
      },
      {
        kind: 'status',
        id: 'agent-setup.connection',
        label: 'Connected GoodVibes services',
        hint: collectionIssues > 0
          ? `${collectionIssues} setup snapshot issue(s) were reported. Status and doctor commands show connection details.`
          : 'Agent uses connected GoodVibes services for companion chat, work plans, approvals, automation, and Agent Knowledge.',
        defaultValue: collectionIssues > 0 ? `${collectionIssues} issue(s)` : 'Connected',
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
        kind: 'text',
        id: 'agent-setup.profile-name',
        label: 'Create starter profile',
        hint: 'Optional: enter a new Agent profile name to create an isolated home during setup. Leave blank to keep the current home.',
        placeholder: 'research-desk',
        defaultValue: '',
      },
      {
        kind: 'radio',
        id: 'agent-setup.profile-template',
        label: 'Starter profile template',
        hint: 'Choose the persona, skills, and routine bundle to seed into the optional new Agent profile.',
        options: buildStarterTemplateOptions(),
        defaultValue: 'none',
      },
      {
        kind: 'status',
        id: 'agent-setup.profile-guide',
        label: 'Profile guidance',
        hint: 'Use /agent-profile guide after setup to export, customize, import, and launch Agent profiles.',
        defaultValue: 'Available',
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
  const routing = controller.runtimeSnapshot?.providerRouting;
  const accountProviders = controller.runtimeSnapshot?.providerAccounts?.providers ?? [];
  const configuredAccounts = accountProviders.filter((provider) =>
    provider.configured || provider.active || provider.oauthReady || provider.pendingLogin || provider.activeRoute !== 'unconfigured',
  );
  const providerRouteLabel = routing
    ? `${routing.primaryProviderId}/${routing.primaryModelId}`
    : 'Not loaded';
  const activeSubscriptionProviders = activeSubscriptions.map((subscription) => subscription.provider);
  const pendingSubscriptionProviders = pendingSubscriptions.map((subscription) => subscription.provider);
  const fields: OnboardingWizardFieldDefinition[] = [
    {
      kind: 'status',
      id: 'providers.default-route',
      label: 'Current conversation route',
      hint: 'Normal Agent turns use this provider/model until you change the default model route.',
      defaultValue: providerRouteLabel,
    },
    {
      kind: 'status',
      id: 'providers.account-routes',
      label: 'Provider account routes',
      hint: configuredAccounts.length > 0
        ? formatBoundedList(configuredAccounts.map(providerAccountLabel), 'No provider account routes detected.')
        : 'No provider account routes were detected in the current Agent state.',
      defaultValue: configuredAccounts.length > 0 ? `${configuredAccounts.length} route(s)` : 'None detected',
    },
    {
      kind: 'status',
      id: 'providers.subscription-sessions',
      label: 'Subscription sessions',
      hint: [
        `active: ${formatBoundedList(activeSubscriptionProviders, 'none')}`,
        `pending: ${formatBoundedList(pendingSubscriptionProviders, 'none')}`,
      ].join('  '),
      defaultValue: `${activeSubscriptions.length} active / ${pendingSubscriptions.length} pending`,
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
      label: 'OpenAI API key quick start',
      hint: openAiApiKeyConfigured
        ? 'Optional quick start: an OpenAI API key is already stored. Leave blank to keep it; enter a new key to replace it through the secret manager.'
        : 'Optional quick start: enter an OpenAI API key now. Other providers can be configured from /secrets, /provider, and the model picker.',
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
    description: 'Review provider and model access for the Agent conversation. Credentials stay masked and provider-specific setup remains configurable.',
    summaryTitle: 'Provider access summary',
    summaryLines: [
      `Default route: ${providerRouteLabel}`,
      `Provider account routes: ${configuredAccounts.length}`,
      `Subscription sessions: ${activeSubscriptions.length} active / ${pendingSubscriptions.length} pending`,
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
  const collectionIssues = controller.runtimeSnapshot?.collectionIssues.length ?? 0;
  const dayOneReadiness = collectionIssues > 0 ? `${collectionIssues} connection issue(s) before day-one ready` : 'operator checklist ready';

  return {
    id: 'review',
    title: 'Review and apply',
    shortLabel: 'Review',
    description: 'Review the Agent day-one checklist and apply setup directly from the wizard.',
    summaryTitle: 'Agent day-one readiness',
    summaryLines: [
      `Day-one readiness: ${dayOneReadiness}`,
      unsavedLabel,
      `${controller.buildApplyRequest().operations.length} Agent setting change(s) ready to apply`,
      feedback ? `Last apply: ${feedback.title}` : 'No apply errors reported',
      controller.isEditingTextField() ? `Editing: ${controller.editingFieldId}` : 'Ready to apply',
    ],
    fields: [
      ...feedbackFields,
      ...buildReviewReadinessFields(controller),
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
        hint: 'Persist Agent-owned settings and verify that setup did not request non-Agent entrypoints, default wiki access, or non-Agent knowledge setup.',
        defaultValue: 'Ready',
      },
    ],
  };
}
