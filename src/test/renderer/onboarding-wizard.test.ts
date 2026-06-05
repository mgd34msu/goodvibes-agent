import { describe, expect, test } from 'bun:test';
import {
  OnboardingWizardController,
  getOnboardingWizardVisibleFieldCount,
} from '../../input/onboarding/onboarding-wizard.ts';
import { renderOnboardingWizard } from '../../renderer/onboarding/onboarding-wizard.ts';
import { DEFAULT_CONFIG } from '../../config/index.ts';
import { EMPTY_AGENT_BEHAVIOR_DISCOVERY_SNAPSHOT, type AgentBehaviorDiscoverySnapshot } from '../../agent/behavior-discovery-summary.ts';
import type { OnboardingSnapshotState, OnboardingStepDerivationState } from '../../runtime/onboarding/index.ts';
import { linesToText } from '../setup.ts';

function onboardingSnapshotWithDiscovery(discovery: AgentBehaviorDiscoverySnapshot): OnboardingSnapshotState {
  return {
    capturedAt: 0,
    config: {
      display: structuredClone(DEFAULT_CONFIG.display),
      provider: structuredClone(DEFAULT_CONFIG.provider),
      behavior: structuredClone(DEFAULT_CONFIG.behavior),
      storage: structuredClone(DEFAULT_CONFIG.storage),
      permissions: structuredClone(DEFAULT_CONFIG.permissions),
      helper: structuredClone(DEFAULT_CONFIG.helper),
      tools: {
        llmEnabled: DEFAULT_CONFIG.tools.llmEnabled,
        llmProvider: DEFAULT_CONFIG.tools.llmProvider,
        llmModel: DEFAULT_CONFIG.tools.llmModel,
      },
      surfaces: structuredClone(DEFAULT_CONFIG.surfaces),
    },
    providerRouting: {
      primaryProviderId: DEFAULT_CONFIG.provider.provider,
      primaryModelId: DEFAULT_CONFIG.provider.model,
      primaryReasoningEffort: DEFAULT_CONFIG.provider.reasoningEffort,
      embeddingProviderId: DEFAULT_CONFIG.provider.embeddingProvider,
      systemPromptFile: DEFAULT_CONFIG.provider.systemPromptFile,
      helperEnabled: DEFAULT_CONFIG.helper.enabled,
      helperProviderId: DEFAULT_CONFIG.helper.globalProvider,
      helperModelId: DEFAULT_CONFIG.helper.globalModel,
      toolLlmEnabled: DEFAULT_CONFIG.tools.llmEnabled,
      toolProviderId: DEFAULT_CONFIG.tools.llmProvider,
      toolModelId: DEFAULT_CONFIG.tools.llmModel,
    },
    runtimeDefaults: {
      providerReasoningEffort: DEFAULT_CONFIG.provider.reasoningEffort,
      permissionsMode: DEFAULT_CONFIG.permissions.mode,
      behavior: structuredClone(DEFAULT_CONFIG.behavior),
      display: structuredClone(DEFAULT_CONFIG.display),
      secretStoragePolicy: DEFAULT_CONFIG.storage.secretPolicy,
    },
    acknowledgements: {
      scope: 'project',
      exists: false,
      updatedAt: null,
      source: null,
      accepted: {},
    },
    services: {
      total: 0,
      oauthProviderIds: [],
      services: [],
    },
    subscriptions: {
      active: [],
      pending: [],
      activeProviderIds: [],
      pendingProviderIds: [],
    },
    secrets: {
      review: {
        policy: 'preferred_secure',
        secureAvailable: false,
        storedKeys: 0,
        envBackedKeys: 0,
        secureKeys: 0,
        plaintextKeys: 0,
        warnings: [],
        locations: [],
      },
      records: [],
    },
    auth: {
      snapshot: {
        userStorePath: '/tmp/auth-users.json',
        bootstrapCredentialPath: '/tmp/auth-bootstrap.txt',
        persisted: true,
        bootstrapCredentialPresent: false,
        userCount: 0,
        sessionCount: 0,
        users: [],
        sessions: [],
      },
    },
    surfaces: {
      configuredEnabledKinds: [],
      records: [],
    },
    providerAccounts: null,
    localBehaviorDiscovery: discovery,
    collectionIssues: [],
  };
}

function emptyDerivedState(): OnboardingStepDerivationState {
  return {
    step1Capabilities: [],
    step1_5NetworkMode: 'local-network-default',
    reopenEditAcknowledgements: {
      providers: { required: false, accepted: true, reason: 'not-needed', detail: '' },
      subscriptions: { required: false, accepted: true, reason: 'not-needed', detail: '' },
      auth: { required: false, accepted: true, reason: 'not-needed', detail: '' },
    },
  };
}

describe('renderOnboardingWizard', () => {
  test('renders a viewport-sized onboarding shell with stable chrome', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('edit');

    const width = 100;
    const height = 20;
    const lines = renderOnboardingWizard(wizard, width, height);

    expect(lines).toHaveLength(height);
    for (const line of lines) {
      expect(line.length).toBe(width);
    }

    const textLines = linesToText(lines);
    const text = textLines.join('\n');
    expect(textLines[0]?.startsWith('┌')).toBe(true);
    expect(textLines[0]?.endsWith('┐')).toBe(true);
    expect(textLines.at(-1)?.startsWith('└')).toBe(true);
    expect(textLines.at(-1)?.endsWith('┘')).toBe(true);
    expect(text).toContain('Onboarding Wizard');
    expect(text).toContain('Summary');
    expect(text).toContain('Steps');
    expect(text).toContain('Controls:');
    expect(text).toContain('Esc');
    expect(linesToText(lines).at(-1)).toContain('[Enter]');
  });

  test('uses visible frame chrome and readable rail labels on wide terminals', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');

    const text = linesToText(renderOnboardingWizard(wizard, 188, 42)).join('\n');

    expect(text).toContain('┌─Onboarding Wizard');
    expect(text).toContain('1. Agent');
    expect(text).toContain('Agent setup');
    expect(text).toContain('Create starter profile');
    expect(text).toContain('Set up the Agent operator workspace');
    expect(text).not.toContain('1. Surfaces');
    expect(text).not.toContain('External network setup');
  });

  test('keeps first-run setup focused on Agent features instead of runner internals', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');
    wizard.setStep(wizard.steps.findIndex((step) => step.id === 'agent-voice-media'));

    const text = linesToText(renderOnboardingWizard(wizard, 188, 42)).join('\n');

    expect(text).toContain('Voice and media');
    expect(text).toContain('Image and audio input');
    expect(text).not.toContain('Node and device posture');
    expect(text).not.toContain('remote runner');
    expect(text).not.toContain('background service processes');
  });

  test('shows discovered behavior imports in first-run local setup', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');
    wizard.hydrateRuntimeState({
      snapshot: onboardingSnapshotWithDiscovery({
          ...EMPTY_AGENT_BEHAVIOR_DISCOVERY_SNAPSHOT,
          personas: { count: 1, projectLocalCount: 1, globalCount: 0, names: ['Research Operator'] },
          skills: { count: 1, projectLocalCount: 1, globalCount: 0, names: ['Daily Brief Skill'] },
          routines: { count: 1, projectLocalCount: 1, globalCount: 0, names: ['Evening Review'] },
        }),
      derived: emptyDerivedState(),
    });
    wizard.setStep(wizard.steps.findIndex((step) => step.id === 'agent-local-state'));
    wizard.moveSelection(7, getOnboardingWizardVisibleFieldCount(42));

    const text = linesToText(renderOnboardingWizard(wizard, 188, 42)).join('\n');

    expect(text).toContain('Local memory and behavior');
    expect(text).toContain('Routines');
    expect(text).toContain('1 discovered');
    expect(text).toContain('profile from discovered behavior');
    expect(text).toContain('Import');
    expect(text).toContain('candidates: Research Operator');
    expect(text).toContain('Research Operator');
    expect(text).toContain('Daily Brief Skill');
    expect(text).toMatch(/Import candidates: Research Operator, Daily Brief Skill, Evening[\s\S]*Review\./);
  });

  test('renders an Agent day-one readiness checklist on the review step', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');
    wizard.setFieldValue('agent-setup.profile-name', 'household');
    wizard.setFieldValue('agent-setup.profile-template', 'household');
    wizard.setStep(wizard.steps.findIndex((step) => step.id === 'review'));

    const text = linesToText(renderOnboardingWizard(wizard, 188, 44)).join('\n');

    expect(text).toContain('Agent day-one readiness');
    expect(text).toContain('Connected host snapshot');
    expect(text).not.toContain('Connected services snapshot');
    expect(text).toContain('Default model route');
    expect(text).toContain('Create household from household');
    expect(text).toContain('Agent Knowledge segment');
    expect(text).toContain('Channels and notifications');
    expect(text).toContain('Build delegation');
    expect(text).not.toContain('Runtime connection snapshot');
    expect(text).not.toContain('GoodVibes runtime connection');
    expect(text).not.toContain(['Home', 'Graph'].join(''));
    expect(text).not.toContain('Default knowledge fallback: enabled');
  });

  test('shows scroll affordances for the field body when the current step exceeds the visible window', () => {
    const wizard = new OnboardingWizardController();
    wizard.open();
    wizard.selectLast(getOnboardingWizardVisibleFieldCount(18));

    const text = linesToText(renderOnboardingWizard(wizard, 100, 18)).join('\n');

    expect(text).toContain('more above');
    expect(text).toContain('Apply & Continue');
  });

  test('separates the apply-and-continue action from normal fields', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');

    const textLines = linesToText(renderOnboardingWizard(wizard, 188, 42));
    const applyLine = textLines.findIndex((line) => line.includes('Apply & Continue'));
    let previousActionLine = -1;
    for (let index = 0; index < applyLine; index += 1) {
      if (textLines[index]?.includes('Profile guidance')) previousActionLine = index;
    }

    expect(applyLine).toBeGreaterThan(0);
    expect(previousActionLine).toBeGreaterThan(0);
    expect(applyLine - previousActionLine).toBe(3);
  });

  test('does not render raw masked edit buffers', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('edit');
    wizard.setStep(wizard.steps.findIndex((step) => step.id === 'provider-access'));
    wizard.moveSelection(2, getOnboardingWizardVisibleFieldCount(24));
    wizard.beginEdit('providers.openai-api-key');
    wizard.editBuffer = 'sk-secret-value';

    const text = linesToText(renderOnboardingWizard(wizard, 140, 24)).join('\n');

    expect(text).not.toContain('sk-secret-value');
    expect(text).toContain('Editing:');
  });
});
