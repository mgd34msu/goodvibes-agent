import type { OnboardingApplyOperation, OnboardingApplyRequest } from '../../runtime/onboarding/index.ts';
import { formatProviderModel } from '../../config/provider-model.ts';
import type { OnboardingWizardController } from './onboarding-wizard.ts';

export function buildOnboardingApplyRequest(controller: OnboardingWizardController): OnboardingApplyRequest {
    const operations: OnboardingApplyOperation[] = [];
    const setConfig = (
      key: Extract<OnboardingApplyOperation, { kind: 'set-config' }>['key'],
      value: unknown,
    ): void => {
      operations.push({ kind: 'set-config', key, value });
    };
    const setSecret = (key: string, value: string): void => {
      if (value.length === 0) return;
      const medium = controller.getSelectedSecretMedium();
      operations.push({
        kind: 'set-secret',
        key,
        value,
        scope: 'project',
        medium,
      });
    };

    // GoodVibes Agent onboarding owns only Agent-local setup and provider
    // routing. Server lifecycle, non-Agent entrypoints, and non-Agent knowledge
    // segments are managed elsewhere.

    const defaultModel = controller.modelSelectionState.get('main');
    if (defaultModel && defaultModel.enabled !== false && defaultModel.providerId.length > 0 && defaultModel.modelId.length > 0) {
      setConfig('provider.model', formatProviderModel(defaultModel.providerId, defaultModel.modelId));
    }
    setConfig('provider.reasoningEffort', controller.getStringFieldValue('default-model.reasoning', controller.runtimeSnapshot?.providerRouting.primaryReasoningEffort ?? 'medium'));
    setConfig('behavior.hitlMode', controller.getStringFieldValue('experience.hitl', controller.runtimeSnapshot?.runtimeDefaults.behavior.hitlMode ?? 'balanced'));
    setConfig('behavior.guidanceMode', controller.getStringFieldValue('experience.guidance', controller.runtimeSnapshot?.runtimeDefaults.behavior.guidanceMode ?? 'minimal'));
    setConfig('permissions.mode', controller.getStringFieldValue('experience.permissions', controller.runtimeSnapshot?.runtimeDefaults.permissionsMode ?? 'prompt'));
    setConfig('storage.secretPolicy', controller.getStringFieldValue('agent-setup.secret-policy', controller.runtimeSnapshot?.runtimeDefaults.secretStoragePolicy ?? 'preferred_secure'));

    setSecret('OPENAI_API_KEY', controller.getStringFieldValue('providers.openai-api-key', ''));

    return {
      mode: controller.mode,
      source: 'wizard',
      operations,
    };
  }
