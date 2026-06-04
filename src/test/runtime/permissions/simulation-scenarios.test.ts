import { describe, expect, test } from 'bun:test';
import { createPermissionSimulator } from '@/runtime/index.ts';
import { buildDefaultPolicySimulationScenarios, runPolicySimulationScenarios } from '@/runtime/index.ts';

describe('policy simulation scenarios', () => {
  test('builds a concrete default scenario set', () => {
    const scenarios = buildDefaultPolicySimulationScenarios();
    expect(scenarios.length).toBeGreaterThan(4);
    expect(scenarios.map((scenario) => scenario.id)).toEqual(expect.arrayContaining([
      'write-project-file',
      'spawn-agent',
    ]));
  });

  test('runs scenario simulations and returns a bounded summary', () => {
    const simulator = createPermissionSimulator(
      { mode: 'default', rules: [] },
      { mode: 'plan', rules: [] },
      'warn-on-divergence',
      { onWarning: () => {} },
    );

    const summary = runPolicySimulationScenarios(simulator);
    expect(summary.totalScenarios).toBeGreaterThan(4);
    expect(summary.results).toHaveLength(summary.totalScenarios);
    expect(summary.divergentScenarios).toBeGreaterThan(0);
    expect(summary.results.filter((result) => result.diverged)).toHaveLength(summary.divergentScenarios);
  });
});
