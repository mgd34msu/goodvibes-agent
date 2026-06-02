import { describe, expect, test } from 'bun:test';
import {
  OnboardingWizardController,
  type OnboardingWizardFieldDefinition,
  type OnboardingWizardStepDefinition,
} from '../../input/onboarding/onboarding-wizard.ts';

function collectFieldStrings(field: OnboardingWizardFieldDefinition): readonly string[] {
  const strings: string[] = [
    field.id,
    field.label,
    field.hint,
    String(field.defaultValue),
  ];
  if (field.kind === 'text' || field.kind === 'masked') strings.push(field.placeholder);
  if (field.kind === 'radio') {
    for (const option of field.options) strings.push(option.id, option.label, option.hint);
  }
  if (field.kind === 'modelPicker') strings.push(field.target);
  if (field.kind === 'action') strings.push(field.action);
  return strings;
}

function collectStepStrings(step: OnboardingWizardStepDefinition): readonly string[] {
  return [
    step.id,
    step.title,
    step.shortLabel,
    step.description,
    step.summaryTitle,
    ...step.summaryLines,
    ...step.fields.flatMap(collectFieldStrings),
  ];
}

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

  test('keeps first-run onboarding focused on Agent setup instead of host lifecycle terms', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');

    const text = wizard.steps.flatMap(collectStepStrings).join('\n');

    expect(text).toContain('Connected GoodVibes host');
    expect(text).toContain('Connected host snapshot');
    expect(text).not.toContain('GoodVibes runtime connection');
    expect(text).not.toContain('Runtime connection snapshot');
    expect(text).not.toContain('external GoodVibes runtime');
    expect(text).not.toContain('External runtime route');
    expect(text).not.toContain('runtime lifecycle');
    expect(text).not.toContain('MCP endpoints');
  });
});
