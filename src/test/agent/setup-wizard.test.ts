import { describe, expect, test } from 'bun:test';
import { buildAgentSetupWizard, emptyAgentSetupSmokeHistory, type AgentSetupWizardCheckpoint, type AgentSetupWizardSmokeHistory, type AgentSetupWizardSourceItem } from '../../agent/setup-wizard.ts';

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
    modelRoute: 'models action:"status"',
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

function readySmokeHistory(): AgentSetupWizardSmokeHistory {
  return {
    status: 'available',
    total: 1,
    trend: 'first-run',
    latestResult: 'ready-for-user-run',
    previousResult: null,
    resultCounts: { 'ready-for-user-run': 1 },
    blockedCheckFrequency: [],
    inspectLatestRoute: 'agent_artifacts show artifactId:"artifact-1" includeContent:false',
    rerunRoute: 'agent_harness mode:"run_setup_smoke"',
    saveRoute: 'agent_harness mode:"run_setup_smoke" fields:{...}',
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

  test('blocks closeout on critical blocked setup rows', () => {
    const wizard = buildAgentSetupWizard({
      items: baseItems.map((item) => item.id === 'provider-model' ? { ...item, status: 'blocked' as const } : item),
      smokeHistory: readySmokeHistory(),
      closeoutCriticalStepIds: ['provider-model'],
      setupMarkerExists: false,
    });

    expect(wizard.closeout.status).toBe('blocked');
    expect(wizard.closeout.primaryStepId).toBe('provider-model');
    expect(wizard.closeout.modelRoute).toContain('models action:"status"');
    expect(wizard.closeout.evidence.join('\n')).toContain('critical setup blockers: Provider and model');
  });

  test('asks for setup smoke before finish when critical setup is ready', () => {
    const wizard = buildAgentSetupWizard({
      items: baseItems.map((item) => item.id === 'provider-model' ? { ...item, status: 'ready' as const } : item),
      smokeHistory: emptyAgentSetupSmokeHistory(),
      closeoutCriticalStepIds: ['runtime', 'provider-model'],
      setupMarkerExists: false,
    });

    expect(wizard.closeout.status).toBe('needs-smoke-evidence');
    expect(wizard.closeout.primaryStepId).toBe('install-smoke');
    expect(wizard.closeout.requiresConfirmation).toBe(true);
    expect(wizard.closeout.modelRoute).toContain('setup action:"smoke"');
  });

  test('routes ready setup to finish and marks complete after the user marker exists', () => {
    const readyItems = baseItems.map((item) => item.id === 'provider-model' ? { ...item, status: 'ready' as const } : item);
    const readyToFinish = buildAgentSetupWizard({
      items: readyItems,
      smokeHistory: readySmokeHistory(),
      closeoutCriticalStepIds: ['runtime', 'provider-model'],
      setupMarkerExists: false,
    });
    expect(readyToFinish.closeout.status).toBe('ready-to-finish');
    expect(readyToFinish.closeout.modelRoute).toContain('setup action:"finish"');
    expect(readyToFinish.closeout.requiresConfirmation).toBe(true);

    const complete = buildAgentSetupWizard({
      items: readyItems,
      smokeHistory: readySmokeHistory(),
      closeoutCriticalStepIds: ['runtime', 'provider-model'],
      setupMarkerExists: true,
    });
    expect(complete.closeout.status).toBe('complete');
    expect(complete.closeout.requiresConfirmation).toBe(false);
    expect(complete.closeout.primaryStepId).toBeNull();
  });
});
