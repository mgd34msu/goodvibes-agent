import type { OnboardingStepDerivationState } from '../../runtime/onboarding/index.ts';
import type { OnboardingWizardAcknowledgementFieldDefinition, OnboardingWizardModelSelection, OnboardingWizardRuntimeHydration } from './onboarding-wizard-types.ts';
export {
  buildGoodVibesSecretKey,
  buildGoodVibesSecretRef,
  isMalformedGoodVibesSecretReferenceValue,
  isSecretReferenceValue,
  normalizeSecretKeyPart,
} from '../../config/secret-config.ts';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function makeNotNeededAcknowledgement(detail: string): OnboardingWizardAcknowledgementFieldDefinition {
  return {
    kind: 'acknowledgement',
    id: 'ack.placeholder',
    label: 'Acknowledgement not required',
    hint: detail,
    defaultValue: false,
    required: false,
    reason: 'not-needed',
  };
}

export function buildDefaultDerivedState(): OnboardingStepDerivationState {
  return {
    step1Capabilities: [],
    step1_5NetworkMode: 'local-network-default',
    reopenEditAcknowledgements: {
      providers: {
        required: false,
        accepted: false,
        reason: 'not-needed',
        detail: 'No existing provider routing needs confirmation.',
      },
      subscriptions: {
        required: false,
        accepted: false,
        reason: 'not-needed',
        detail: 'No stored subscription sessions need confirmation.',
      },
      auth: {
        required: false,
        accepted: false,
        reason: 'not-needed',
        detail: 'No local auth state needs confirmation.',
      },
    },
  };
}

export function maskValue(value: string): string {
  if (value.length === 0) return 'unset';
  if (value.length <= 3) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.max(0, value.length - 2))}${value.slice(-2)}`;
}

export function areSelectionsEqual(
  left: OnboardingWizardModelSelection | undefined,
  right: OnboardingWizardModelSelection | undefined,
): boolean {
  return (left?.providerId ?? '') === (right?.providerId ?? '')
    && (left?.modelId ?? '') === (right?.modelId ?? '')
    && (left?.enabled ?? true) === (right?.enabled ?? true);
}

export function cloneSelection(selection: OnboardingWizardModelSelection): OnboardingWizardModelSelection {
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
    enabled: selection.enabled,
  };
}

export function modelSelectionLabel(selection: OnboardingWizardModelSelection | undefined): string {
  if (!selection) return 'Choose model';
  if (selection.enabled === false && selection.providerId.length === 0 && selection.modelId.length === 0) {
    return 'Disabled';
  }

  const provider = selection.providerId.length > 0 ? selection.providerId : 'provider';
  const model = selection.modelId.length > 0 ? selection.modelId : 'model';
  if (selection.enabled === false) return `Off (${provider}/${model})`;
  return `${provider}/${model}`;
}

export function getRuntimeDerivedState(hydration: OnboardingWizardRuntimeHydration): OnboardingStepDerivationState {
  if (hydration.derived) {
    const fallback = buildDefaultDerivedState();
    return {
      step1Capabilities: hydration.derived.step1Capabilities ?? fallback.step1Capabilities,
      step1_5NetworkMode: hydration.derived.step1_5NetworkMode ?? fallback.step1_5NetworkMode,
      reopenEditAcknowledgements: {
        providers: hydration.derived.reopenEditAcknowledgements?.providers ?? fallback.reopenEditAcknowledgements.providers,
        subscriptions: hydration.derived.reopenEditAcknowledgements?.subscriptions ?? fallback.reopenEditAcknowledgements.subscriptions,
        auth: hydration.derived.reopenEditAcknowledgements?.auth ?? fallback.reopenEditAcknowledgements.auth,
      },
    };
  }

  return buildDefaultDerivedState();
}

export function getOnboardingWizardBodyRows(viewportHeight: number): number {
  return Math.max(6, viewportHeight - 5);
}

export function getOnboardingWizardVisibleFieldCount(viewportHeight: number): number {
  return Math.max(1, getOnboardingWizardBodyRows(viewportHeight) - 6);
}
