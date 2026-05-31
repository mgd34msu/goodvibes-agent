import { normalizeText } from './onboarding-wizard-helpers.ts';
import type { OnboardingWizardController } from './onboarding-wizard.ts';

export function getSelectedSecretMedium(controller: OnboardingWizardController): 'secure' | 'plaintext' {
    const policy = controller.getStringFieldValue(
      'agent-setup.secret-policy',
      controller.runtimeSnapshot?.runtimeDefaults.secretStoragePolicy ?? 'preferred_secure',
    );
    if (policy === 'require_secure') return 'secure';
    if (policy === 'plaintext_allowed') return 'plaintext';
    if (controller.runtimeSnapshot?.secrets.review.secureAvailable) return 'secure';
    return 'plaintext';
  }

export function getBooleanFieldValue(controller: OnboardingWizardController, fieldId: string, fallback: boolean): boolean {
    return controller.toggleState.get(fieldId) ?? fallback;
  }

export function getStringFieldValue(controller: OnboardingWizardController, fieldId: string, fallback: string): string {
    const value = controller.textState.get(fieldId) ?? controller.radioState.get(fieldId);
    return normalizeText(value ?? fallback);
  }
