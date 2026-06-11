import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import { AgentManager } from '@pellux/goodvibes-sdk/platform/tools';
import {
  exportRemoteArtifactForAgent,
  importRemoteArtifact,
} from '@/runtime/index.ts';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import {
  getTestAgentManager,
  getTestHookDispatcher,
  getTestHookWorkbench,
  getTestRemoteRunnerRegistry,
  resetAllTestServiceState,
} from '../helpers/runtime-services.ts';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

describe('remote and hooks authoring gate', () => {
  let originalHooksFile: string;
  let configManager: ConfigManager;

  beforeEach(() => {
    // resetAllTestServiceState() is also auto-registered by importing runtime-services.ts.
    // Calling it explicitly here ensures this file's beforeEach runs the full reset
    // even if the auto-registration order changes.
    resetAllTestServiceState();
    configManager = new ConfigManager({ surfaceRoot: 'tui', configDir: makeProjectTempDir('gv-remote-hooks') });
    originalHooksFile = configManager.get('tools.hooksFile') as string;
    getTestHookDispatcher().clear();
  });

  afterEach(() => {
    getTestAgentManager().clear();
    configManager.set('tools.hooksFile', originalHooksFile);
    getTestHookDispatcher().clear();
    resetAllTestServiceState();
  });

  test('remote runner execution can be exported into a portable review artifact', async () => {
    const manager = getTestAgentManager();
    const agent = manager.spawn({
      mode: 'spawn',
      task: 'Produce portable remote evidence',
      template: 'engineer',
      tools: ['read', 'edit'],
      dangerously_disable_wrfc: true,
    });
    agent.status = 'completed';
    agent.fullOutput = 'Portable remote evidence is available for review.';
    agent.completedAt = Date.now();

    const store = createRuntimeStore();
    store.setState((state) => ({
      ...state,
      acp: {
        ...state.acp,
        activeConnectionIds: [agent.id],
        connections: new Map([
          [agent.id, {
            agentId: agent.id,
            label: 'remote certifier',
            transportState: 'connected',
            connectedAt: Date.now(),
            completing: false,
            messageCount: 5,
            errorCount: 0,
            taskId: 'task-remote-gate',
          }],
        ]),
      },
    }));

    const dir = makeProjectTempDir('gv-remote-gate');
    const path = join(dir, 'remote-artifact.json');
    const remoteRunnerRegistry = getTestRemoteRunnerRegistry();
    const exported = await exportRemoteArtifactForAgent(remoteRunnerRegistry, agent.id, store, path);

    if (exported === null) throw new Error('expected remote artifact export to succeed');
    expect(exported.artifact.runnerContract.trustClass).toBe('self-hosted-acp');
    expect(exported.artifact.task.summary).toContain('Portable remote evidence');
    expect(existsSync(path)).toBe(true);

    const imported = await importRemoteArtifact(remoteRunnerRegistry, path);
    expect(imported.runnerContract.trustClass).toBe('self-hosted-acp');
    expect(imported.task.summary).toContain('Portable remote evidence');
  });

  test('managed hooks can be scaffolded, reloaded, and simulated through the persisted workflow path', async () => {
    const dir = makeProjectTempDir('gv-hooks-gate');
    const path = join(dir, 'hooks.json');
    configManager.set('tools.hooksFile', path);

    const workbench = getTestHookWorkbench();
    workbench.loadManagedConfig(path);
    workbench.scaffoldHook('remote-guard', 'Pre:tool:edit', 'command');
    workbench.scaffoldChain('edit-review', ['Post:tool:edit', 'Fail:tool:edit']);
    await workbench.saveManagedConfig(path);
    await workbench.loadAndApplyManagedHooks(path);

    expect(getTestHookDispatcher().listHooks().length).toBeGreaterThan(0);
    expect(getTestHookDispatcher().getChains().length).toBeGreaterThan(0);

    const simulation = workbench.simulate('Pre:tool:edit');
    expect(simulation.matchedHooks[0]?.name).toBe('remote-guard');
    expect(simulation.matchedChains.length).toBe(0);
  });
});
