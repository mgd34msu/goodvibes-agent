import { describe, expect, test } from 'bun:test';
import { createArchivableFleetRegistry } from '@pellux/goodvibes-terminal-shell';
import { AgentManager } from '@pellux/goodvibes-sdk/platform/tools';
import { AgentMessageBus } from '@pellux/goodvibes-sdk/platform/agents';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

/**
 * Verifies the wake-retry path the brief describes as "AgentManager.wakeWithSteer
 * wired into ProcessRegistry.steer" (SDK 1.6.1) actually reaches through THIS
 * fork's own composition, not just the SDK in isolation.
 *
 * This fork does not call `agentManager.wakeWithSteer` directly anywhere in
 * its own source — the wake-retry is entirely inside the SDK's
 * ProcessRegistry.steer() (goodvibes-sdk/platform/runtime/fleet/registry.js),
 * which re-triggers a 'failed' (wedged) agent from its retained context when
 * steered, PROVIDED the registry was constructed with both a real
 * `agentManager` (carrying the real `wakeWithSteer` method — the deps type
 * only requires `list`/`cancel`, so a narrower stub would silently disable
 * this) and a `messageBus` (steer() refuses honestly without one — see
 * ProcessRegistryDeps.messageBus's own doc comment). services.ts constructs
 * `processRegistry` via `createArchivableFleetRegistry` (the SAME
 * terminal-shell wrapper the daemon front-end uses) with
 * `agentManager` and `messageBus: agentMessageBus` passed as the real,
 * unnarrowed instances — this test proves that exact shape wakes a failed
 * agent, so this fork is covered by the SDK's own behavior change with no
 * wiring gap.
 */
describe('processRegistry.steer() wake-retry (SDK 1.6.1, wired via this fork\'s createArchivableFleetRegistry call)', () => {
  test('steering a failed (wedged) agent re-triggers it via wakeWithSteer', async () => {
    const configDir = makeProjectTempDir('gv-fleet-steer');
    const configManager = new ConfigManager({ surfaceRoot: 'tui', configDir });
    const agentMessageBus = new AgentMessageBus();
    const agentManager = new AgentManager({
      configManager,
      messageBus: agentMessageBus,
      executor: { runAgent: () => Promise.reject(new Error('agent went silent for 30s')) },
    });
    const record = agentManager.spawn({ mode: 'spawn', task: 'investigate the flaky test', template: 'engineer' });
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    expect(record.status).toBe('failed');

    // The SAME minimal deps shape services.ts passes: agentManager and
    // messageBus are the real instances (not stubs), the rest are the
    // lightest stubs that satisfy ProcessRegistryDeps' required fields.
    const processRegistry = createArchivableFleetRegistry({
      agentManager,
      wrfcController: { listChains: () => [] },
      processManager: { list: () => [], stop: () => false, getStatus: () => undefined },
      watcherRegistry: { list: () => [], stopWatcher: () => null },
      workflow: {
        workflowManager: { list: () => [], cancel: () => false },
        triggerManager: { list: () => [], remove: () => false, disable: () => false, enable: () => false },
        scheduleManager: { list: () => [], remove: () => false, disable: () => false, enable: () => false },
      },
      messageBus: agentMessageBus,
    });

    const result = processRegistry.steer(record.id, 'try a different approach this time');
    expect(result.queued).toBe(true);
    expect((result as { woke?: boolean }).woke).toBe(true);

    processRegistry.dispose();
  });

  test('steering a failed agent with NO messageBus refuses honestly rather than silently no-op', async () => {
    const configDir = makeProjectTempDir('gv-fleet-steer');
    const configManager = new ConfigManager({ surfaceRoot: 'tui', configDir });
    const agentManager = new AgentManager({
      configManager,
      executor: { runAgent: () => Promise.reject(new Error('agent went silent for 30s')) },
    });
    const record = agentManager.spawn({ mode: 'spawn', task: 'investigate the flaky test', template: 'engineer' });
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    expect(record.status).toBe('failed');

    const processRegistry = createArchivableFleetRegistry({
      agentManager,
      wrfcController: { listChains: () => [] },
      processManager: { list: () => [], stop: () => false, getStatus: () => undefined },
      watcherRegistry: { list: () => [], stopWatcher: () => null },
      workflow: {
        workflowManager: { list: () => [], cancel: () => false },
        triggerManager: { list: () => [], remove: () => false, disable: () => false, enable: () => false },
        scheduleManager: { list: () => [], remove: () => false, disable: () => false, enable: () => false },
      },
      // messageBus deliberately omitted.
    });

    const result = processRegistry.steer(record.id, 'try a different approach this time');
    expect(result.queued).toBe(false);

    processRegistry.dispose();
  });
});
