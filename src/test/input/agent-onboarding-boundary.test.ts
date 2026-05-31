import { describe, expect, test } from 'bun:test';
import { OnboardingWizardController } from '../../input/onboarding/onboarding-wizard.ts';

describe('Agent onboarding product boundary', () => {
  test('exposes only Agent-owned wizard actions', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');

    const actions = wizard.steps.flatMap((step) => (
      step.fields
        .filter((field) => field.kind === 'action')
        .map((field) => field.action)
    ));

    expect(new Set(actions)).toEqual(new Set([
      'apply',
      'apply-and-continue',
      'start-openai-subscription',
    ]));
  });
});
