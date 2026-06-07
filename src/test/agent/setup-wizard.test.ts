import { describe, expect, test } from 'bun:test';
import { buildAgentSetupWizard, emptyAgentSetupSmokeHistory, type AgentSetupWizardCheckpoint, type AgentSetupWizardSourceItem } from '../../agent/setup-wizard.ts';

const baseItems: readonly AgentSetupWizardSourceItem[] = [
  {
    id: 'runtime',
    label: 'Connected host',
    status: 'ready',
    detail: 'Host route is configured.',
    userRoute: 'Start -> Connected host',
    modelRoute: 'agent_harness mode:"connected_host_status"',
  },
  {
    id: 'provider-model',
    label: 'Provider and model',
    status: 'recommended',
    detail: 'Choose a model.',
    userRoute: 'Start -> Provider and model',
    modelRoute: 'agent_harness mode:"model_routing"',
  },
  {
    id: 'install-smoke',
    label: 'Install smoke',
    status: 'recommended',
    detail: 'Run setup smoke.',
    userRoute: 'Start -> Install smoke',
    modelRoute: 'agent_harness mode:"run_setup_smoke"',
  },
];

function checkpoint(stepId = 'install-smoke'): AgentSetupWizardCheckpoint {
  return {
    status: 'available',
    currentStepId: stepId,
    currentStepLabel: stepId === 'install-smoke' ? 'Install smoke' : 'Provider and model',
    savedAt: '2026-06-06T12:00:00.000Z',
    source: 'harness',
    resumed: false,
    summary: 'Saved setup checkpoint.',
    path: '/tmp/wizard-checkpoint.json',
    markCurrentRoute: 'agent_harness mode:"mark_setup_checkpoint"',
    clearRoute: 'agent_harness mode:"clear_setup_checkpoint"',
    inspectRoute: 'agent_harness mode:"setup_checkpoint"',
  };
}

describe('Agent setup wizard checkpoints', () => {
  test('resumes a saved non-ready checkpoint when no live blocker takes priority', () => {
    const wizard = buildAgentSetupWizard({
      items: baseItems,
      smokeHistory: emptyAgentSetupSmokeHistory(),
      checkpoint: checkpoint(),
    });

    expect(wizard.currentStepId).toBe('install-smoke');
    expect(wizard.currentStepLabel).toBe('Install smoke');
    expect(wizard.checkpoint.status).toBe('available');
    expect(wizard.checkpoint.resumed).toBe(true);
    expect(wizard.checkpoint.summary).toContain('Resuming Install smoke');
    expect(wizard.steps.find((step) => step.id === 'install-smoke')?.status).toBe('current');
  });

  test('keeps a valid saved checkpoint but focuses an earlier live blocker', () => {
    const wizard = buildAgentSetupWizard({
      items: baseItems.map((item) => item.id === 'provider-model' ? { ...item, status: 'blocked' as const } : item),
      smokeHistory: emptyAgentSetupSmokeHistory(),
      checkpoint: checkpoint(),
    });

    expect(wizard.status).toBe('blocked');
    expect(wizard.currentStepId).toBe('provider-model');
    expect(wizard.checkpoint.status).toBe('available');
    expect(wizard.checkpoint.resumed).toBe(false);
    expect(wizard.checkpoint.summary).toContain('live blocker Provider and model is taking priority');
    expect(wizard.steps.find((step) => step.id === 'install-smoke')?.status).toBe('pending');
  });

  test('marks a checkpoint stale after the saved step becomes ready', () => {
    const wizard = buildAgentSetupWizard({
      items: baseItems.map((item) => item.id === 'install-smoke' ? { ...item, status: 'ready' as const } : item),
      smokeHistory: emptyAgentSetupSmokeHistory(),
      checkpoint: checkpoint(),
    });

    expect(wizard.currentStepId).toBe('provider-model');
    expect(wizard.checkpoint.status).toBe('stale');
    expect(wizard.checkpoint.resumed).toBe(false);
    expect(wizard.checkpoint.summary).toContain('already ready');
  });
});
