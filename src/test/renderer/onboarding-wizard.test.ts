import { describe, expect, test } from 'bun:test';
import {
  OnboardingWizardController,
  getOnboardingWizardVisibleFieldCount,
} from '../../input/onboarding/onboarding-wizard.ts';
import { renderOnboardingWizard } from '../../renderer/onboarding/onboarding-wizard.ts';
import { linesToText } from '../setup.ts';

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

    const text = linesToText(lines).join('\n');
    expect(text).toContain('Onboarding Wizard');
    expect(text).toContain('Summary');
    expect(text).toContain('Steps');
    expect(text).toContain('Controls:');
    expect(text).toContain('Esc');
  });

  test('uses visible frame chrome and readable rail labels on wide terminals', () => {
    const wizard = new OnboardingWizardController();
    wizard.open('new');

    const text = linesToText(renderOnboardingWizard(wizard, 188, 42)).join('\n');

    expect(text).toContain('┌─Onboarding Wizard');
    expect(text).toContain('1. Agent');
    expect(text).toContain('Agent setup');
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
      if (textLines[index]?.includes('Agent profiles')) previousActionLine = index;
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
