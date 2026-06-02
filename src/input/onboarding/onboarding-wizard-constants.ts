import type { OnboardingWizardRadioOption, OnboardingWizardStepId } from './onboarding-wizard-types.ts';

export const STEP_ORDER: readonly OnboardingWizardStepId[] = [
  'agent-setup',
  'provider-access',
  'default-model',
  'agent-communication',
  'agent-tools',
  'agent-research',
  'agent-knowledge',
  'agent-local-state',
  'agent-automation',
  'agent-voice-media',
  'agent-delegation',
  'experience',
  'review',
];

export const REASONING_OPTIONS: readonly OnboardingWizardRadioOption[] = [
  { id: 'instant', label: 'Instant', hint: 'Lowest-latency routing.' },
  { id: 'low', label: 'Low', hint: 'Compact reasoning for quick work.' },
  { id: 'medium', label: 'Medium', hint: 'Balanced latency and quality.' },
  { id: 'high', label: 'High', hint: 'Deeper reasoning for complex tasks.' },
];

export const HITL_MODE_OPTIONS: readonly OnboardingWizardRadioOption[] = [
  { id: 'quiet', label: 'Quiet', hint: 'Only interrupt for important attention requests.' },
  { id: 'balanced', label: 'Balanced', hint: 'Show important activity without turning Agent into a log stream.' },
  { id: 'operator', label: 'Operator', hint: 'Keep operational activity visible for hands-on supervision.' },
];

export const GUIDANCE_MODE_OPTIONS: readonly OnboardingWizardRadioOption[] = [
  { id: 'minimal', label: 'Minimal', hint: 'Use compact guidance and repair suggestions.' },
  { id: 'guided', label: 'Guided', hint: 'Show more explanation while working.' },
  { id: 'off', label: 'Off', hint: 'Disable proactive guidance.' },
];

export const PERMISSION_MODE_OPTIONS: readonly OnboardingWizardRadioOption[] = [
  { id: 'prompt', label: 'Ask first', hint: 'Prompt before write, edit, network, and execution tools.' },
  { id: 'allow-all', label: 'Allow all', hint: 'Allow tools without approval prompts.' },
  { id: 'custom', label: 'Custom', hint: 'Use tool-specific permission rules.' },
];

export const SECRET_POLICY_OPTIONS: readonly OnboardingWizardRadioOption[] = [
  { id: 'preferred_secure', label: 'Secure', hint: 'Prefer the secure secret backend and fall back only when needed.' },
  { id: 'require_secure', label: 'Require secure', hint: 'Refuse plaintext secret persistence.' },
  { id: 'plaintext_allowed', label: 'Plaintext allowed', hint: 'Permit local plaintext secret storage.' },
];
