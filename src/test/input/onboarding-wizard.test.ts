import { afterEach, describe, expect, test } from 'bun:test';
import { InfiniteBuffer } from '../../core/history.ts';
import { OnboardingWizardController } from '../../input/onboarding/onboarding-wizard.ts';
import { handleOnboardingWizardToken } from '../../input/onboarding/handler-onboarding-routes.ts';
import { InputHandler } from '../../input/handler.ts';
import { SelectionManager } from '../../input/selection.ts';
import { DEFAULT_CONFIG } from '../../config/index.ts';
import { getProviderIdFromModel } from '../../config/provider-model.ts';
import type { OnboardingApplyOperation, OnboardingSnapshotState } from '../../runtime/onboarding/index.ts';
import { createDefaultUiRuntimeServices } from '../helpers/ui-services.ts';
import { resetTestRuntimeServices } from '../helpers/runtime-services.ts';
import type { InputToken } from '@pellux/goodvibes-sdk/platform/core';

afterEach(() => {
  resetTestRuntimeServices();
});

function makeInput(): InputHandler {
  const history = new InfiniteBuffer();
  const input = new InputHandler(
    () => {},
    new SelectionManager(),
    () => 0,
    () => 20,
    () => history,
    () => {},
    () => {},
    createDefaultUiRuntimeServices(),
  );
  input.setContentWidth(100);
  return input;
}

function makeOnboardingSnapshot(
  overrides: Partial<OnboardingSnapshotState> = {},
): OnboardingSnapshotState {
  const config = {
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
    danger: structuredClone(DEFAULT_CONFIG.danger),
    controlPlane: structuredClone(DEFAULT_CONFIG.controlPlane),
    httpListener: structuredClone(DEFAULT_CONFIG.httpListener),
    web: structuredClone(DEFAULT_CONFIG.web),
    network: structuredClone(DEFAULT_CONFIG.network),
    surfaces: structuredClone(DEFAULT_CONFIG.surfaces),
    service: structuredClone(DEFAULT_CONFIG.service),
    featureFlags: structuredClone(DEFAULT_CONFIG.featureFlags),
    batch: structuredClone(DEFAULT_CONFIG.batch),
  };

  return {
    capturedAt: 1,
    config,
    providerRouting: {
      primaryProviderId: getProviderIdFromModel(config.provider.model),
      primaryModelId: config.provider.model,
      primaryReasoningEffort: config.provider.reasoningEffort,
      embeddingProviderId: config.provider.embeddingProvider,
      systemPromptFile: config.provider.systemPromptFile,
      helperEnabled: config.helper.enabled,
      helperProviderId: config.helper.globalProvider,
      helperModelId: config.helper.globalModel,
      toolLlmEnabled: config.tools.llmEnabled,
      toolProviderId: config.tools.llmProvider,
      toolModelId: config.tools.llmModel,
    },
    runtimeDefaults: {
      providerReasoningEffort: config.provider.reasoningEffort,
      permissionsMode: config.permissions.mode,
      behavior: config.behavior,
      display: config.display,
      secretStoragePolicy: config.storage.secretPolicy,
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
        policy: config.storage.secretPolicy,
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
        userStorePath: '',
        bootstrapCredentialPath: '',
        persisted: false,
        bootstrapCredentialPresent: false,
        userCount: 0,
        sessionCount: 0,
        users: [],
        sessions: [],
      },
    },
    bindSettings: {
      daemonEnabled: false,
      httpListenerEnabled: false,
      controlPlane: config.controlPlane,
      httpListener: config.httpListener,
      web: config.web,
    },
    surfaces: {
      configuredEnabledKinds: [],
      records: [],
    },
    providerAccounts: null,
    collectionIssues: [],
    ...overrides,
  };
}

function collectSetConfigOperations(operations: readonly OnboardingApplyOperation[]): Map<string, unknown> {
  const values = new Map<string, unknown>();
  for (const operation of operations) {
    if (operation.kind === 'set-config') values.set(operation.key, operation.value);
  }
  return values;
}

function expectNoCopiedSetupOperations(operations: readonly OnboardingApplyOperation[]): void {
  const forbiddenConfigPrefixes = [
    'surfaces.',
    `${'cloud'}${'flare'}.`,
    'batch.',
    'controlPlane.',
    'httpListener.',
    'web.',
    'danger.',
    'service.',
    'featureFlags.',
  ];
  for (const operation of operations) {
    if (operation.kind === 'set-config') {
      for (const prefix of forbiddenConfigPrefixes) {
        expect(operation.key.startsWith(prefix)).toBe(false);
      }
    }
    expect(operation.kind).not.toBe('ensure-auth-user');
    expect(operation.kind).not.toBe('acknowledge');
  }
}

describe('OnboardingWizardController', () => {
  test('uses Agent-specific onboarding screens instead of copied service setup screens', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');

    expect(wizard.steps.map((step) => step.id)).toEqual([
      'agent-setup',
      'provider-access',
      'default-model',
      'agent-communication',
      'agent-tools',
      'agent-knowledge',
      'agent-local-state',
      'agent-automation',
      'agent-voice-media',
      'agent-delegation',
      'experience',
      'review',
    ]);
    expect(wizard.steps.map((step) => step.id)).not.toContain('network');
    expect(wizard.steps.map((step) => step.id)).not.toContain('external-services');
    expect(wizard.steps.map((step) => step.id)).not.toContain(`${'cloud'}${'flare'}`);
    expect(wizard.steps.map((step) => step.id)).not.toContain('access');
  });

  test('tracks dirty state for Agent-owned editable fields', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('edit');

    wizard.moveSelection(2, 4);
    wizard.activateSelected();

    expect(wizard.getSelectedField()?.id).toBe('agent-setup.secret-policy');
    expect(wizard.dirty).toBe(true);
    expect(wizard.isStepDirty(0)).toBe(true);
  });

  test('adds a separated apply-and-continue action to every non-final editable step', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');

    for (const step of wizard.steps) {
      const applyAndContinue = step.fields.find((field) => field.kind === 'action' && field.action === 'apply-and-continue');
      if (step.id === 'review') {
        expect(applyAndContinue).toBeUndefined();
        continue;
      }

      expect(applyAndContinue).toBeDefined();
      expect(applyAndContinue?.label).toBe('Apply & Continue To Next Section');
      expect(applyAndContinue?.spacerBeforeRows).toBe(2);
      expect(step.fields.at(-1)).toBe(applyAndContinue);
    }
  });

  test('maps only Agent-owned setup values to apply operations', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');
    wizard.hydrateRuntimeState({ snapshot: makeOnboardingSnapshot() }, { resetValues: true });
    wizard.applyModelSelection('main', { providerId: 'openai', modelId: 'gpt-5-test' });
    wizard.setFieldValue('default-model.reasoning', 'high');
    wizard.setFieldValue('experience.hitl', 'operator');
    wizard.setFieldValue('experience.guidance', 'guided');
    wizard.setFieldValue('experience.permissions', 'allow-all');
    wizard.setFieldValue('agent-setup.secret-policy', 'plaintext_allowed');
    wizard.setFieldValue('providers.openai-api-key', 'sk-test-openai');

    const request = wizard.buildApplyRequest();
    const configValues = collectSetConfigOperations(request.operations);

    expectNoCopiedSetupOperations(request.operations);
    expect(configValues.get('provider.model')).toBe('openai:gpt-5-test');
    expect(configValues.get('provider.reasoningEffort')).toBe('high');
    expect(configValues.get('behavior.hitlMode')).toBe('operator');
    expect(configValues.get('behavior.guidanceMode')).toBe('guided');
    expect(configValues.get('permissions.mode')).toBe('allow-all');
    expect(configValues.get('storage.secretPolicy')).toBe('plaintext_allowed');
    expect(request.operations).toContainEqual({
      kind: 'set-secret',
      key: 'OPENAI_API_KEY',
      value: 'sk-test-openai',
      scope: 'project',
      medium: 'plaintext',
    });
  });

  test('does not expose copied service, surface, or network fields in Agent onboarding text', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');

    const text = wizard.steps
      .flatMap((step) => [
        step.id,
        step.title,
        step.shortLabel,
        step.description,
        step.summaryTitle,
        ...step.summaryLines,
        ...step.fields.flatMap((field) => [field.id, field.label, field.hint]),
      ])
      .join('\n');

    expect(text).not.toContain('external-services');
    expect(text).not.toContain('Slack');
    expect(text).not.toContain('Discord');
    expect(text).not.toContain('Home Assistant');
    expect(text).not.toContain('HomeGraph');
    expect(text).not.toContain(`${'Cloud'}${'flare'}`);
    expect(text).not.toContain('non-Agent product setup');
    expect(text).not.toContain('HTTP listener');
    expect(text).not.toContain('control-plane');
    expect(text).not.toContain('network setup');
  });

  test('onboards day-one personal operator surfaces without daemon ownership', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');

    const byId = new Map(wizard.steps.map((step) => [step.id, step]));
    expect(byId.get('agent-communication')?.summaryLines).toContain('Outbound messages: explicit user action only');
    expect(byId.get('agent-tools')?.summaryLines).toContain('MCP and tools: inspect before use');
    expect(byId.get('agent-automation')?.summaryLines).toContain('Local routines: reusable main-conversation workflows');
    expect(byId.get('agent-voice-media')?.summaryLines).toContain('Voice and speech: optional operator surfaces');

    const text = wizard.steps
      .flatMap((step) => [
        step.id,
        step.title,
        step.description,
        ...step.summaryLines,
        ...step.fields.flatMap((field) => [field.id, field.label, field.hint, field.defaultValue]),
      ])
      .join('\n');

    expect(text).toContain('companion clients');
    expect(text).toContain('MCP servers');
    expect(text).toContain('local routines');
    expect(text).toContain('image');
    expect(text).toContain('Agent Knowledge');
    expect(text).not.toContain('Default Knowledge/Wiki fallback: enabled');
    expect(text).not.toContain('start services');
  });

  test('clears selected Agent onboarding text fields with Delete', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');
    wizard.setStep(1);
    wizard.moveSelection(2, 6);
    wizard.setFieldValue('providers.openai-api-key', 'sk-secret');

    handleOnboardingWizardToken({
      onboardingWizard: wizard,
      getViewportHeight: () => 20,
      requestRender: () => {},
      handleEscape: () => {},
    }, { type: 'key', logicalName: 'delete', ctrl: false, shift: false, meta: false } as InputToken);

    expect(wizard.getSelectedField()?.id).toBe('providers.openai-api-key');
    expect(wizard.getTextFieldValue('providers.openai-api-key')).toBe('');
  });

  test('printable key tokens edit selected Agent onboarding inputs before shortcut handling', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');
    wizard.setStep(1);
    wizard.moveSelection(2, 6);

    const routeState = {
      onboardingWizard: wizard,
      getViewportHeight: () => 20,
      requestRender: () => {},
      handleEscape: () => {},
    };

    handleOnboardingWizardToken(routeState, { type: 'text', value: 'j' });
    handleOnboardingWizardToken(routeState, { type: 'text', value: 'k' });
    handleOnboardingWizardToken(routeState, { type: 'key', logicalName: 'return' } as InputToken);

    expect(wizard.getSelectedField()?.id).toBe('providers.openai-api-key');
    expect(wizard.getTextFieldValue('providers.openai-api-key')).toBe('jk');
  });
});

describe('InputHandler onboarding integration', () => {
  test('apply-and-continue advances through Agent setup without persisting runtime settings', async () => {
    const input = makeInput();
    input.openOnboardingWizard('new');
    input.onboardingWizard.finishRuntimeHydration();

    expect(input.onboardingWizard.currentStep.id).toBe('agent-setup');
    await (input as unknown as { handleOnboardingAction(action: 'apply-and-continue'): Promise<void> }).handleOnboardingAction('apply-and-continue');

    expect(input.onboardingWizard.active).toBe(true);
    expect(input.onboardingWizard.currentStep.id).toBe('provider-access');
  });

  test('keeps external service lifecycle untouched when completing Agent setup', async () => {
    const input = makeInput();
    input.openOnboardingWizard('new');
    input.onboardingWizard.hydrateRuntimeState({ snapshot: makeOnboardingSnapshot() }, { resetValues: true });

    await (input as unknown as { handleOnboardingAction(action: 'apply'): Promise<void> }).handleOnboardingAction('apply');

    expect(input.onboardingWizard.active).toBe(false);
    const serviceConfig = input.uiServices.platform.configManager.get('service.enabled');
    const daemonConfig = input.uiServices.platform.configManager.get('danger.daemon');
    const listenerConfig = input.uiServices.platform.configManager.get('danger.httpListener');
    expect(serviceConfig).toBe(DEFAULT_CONFIG.service.enabled);
    expect(daemonConfig).toBe(DEFAULT_CONFIG.danger.daemon);
    expect(listenerConfig).toBe(DEFAULT_CONFIG.danger.httpListener);
  });
});
