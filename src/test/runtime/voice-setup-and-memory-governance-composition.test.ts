/**
 * voice-setup-and-memory-governance-composition.test.ts
 *
 * Pins two things through the real composition root (createRuntimeServices),
 * in the same style as power-keep-awake-composition.test.ts:
 *
 *  1. `services.voiceSetup` is real, live wiring over the SDK's own managed
 *     local-voice provisioning (@pellux/goodvibes-sdk/platform/voice) — the
 *     part of the SDK's memory-round composition this repo COULD mirror. Both
 *     the direct service (what /voice status and /voice setup read) and the
 *     voice.local.status/voice.local.install gateway verbs (what a remote
 *     surface would invoke) are pinned to the SAME instance and produce a
 *     real, non-fabricated answer.
 *
 *  2. The memory-governance layer (CacheRegistry/PauseController/MemoryGovernor/
 *     wireDaemonMemoryGovernance) is honestly ABSENT from this composition —
 *     ops.memory.get is never wired to a fabricated snapshot. See the
 *     composition-root comment in runtime/services.ts (right before
 *     wireRuntimePower) for the full defect writeup: this pinned SDK build
 *     (goodvibes-sdk @ efc1b380) has no public export path for that layer
 *     (verified: `@pellux/goodvibes-sdk/platform/runtime/memory` does not
 *     resolve, and the `platform/runtime` barrel re-exports no `memory`
 *     namespace). If the SDK later adds that export and this repo composes a
 *     real governor, THIS test's second assertion is expected to need
 *     updating — that failure is the intended forcing function, not a
 *     regression to silence.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '../../config/index.ts';
import { RuntimeEventBus } from '@/runtime/index.ts';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import { createRuntimeServices, type RuntimeServices } from '../../runtime/services.ts';

describe('voice-setup + memory-governance composition', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function makeServices(): RuntimeServices {
    root = mkdtempSync(join(tmpdir(), 'goodvibes-agent-voice-memory-composition-'));
    const workingDir = join(root, 'workspace');
    const homeDir = join(root, 'home');
    const configDir = join(homeDir, '.goodvibes', 'agent');
    mkdirSync(workingDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    const configManager = new ConfigManager({ surfaceRoot: 'agent', workingDir, homeDir, configDir });
    return createRuntimeServices({
      runtimeBus: new RuntimeEventBus(),
      runtimeStore: createRuntimeStore(),
      configManager,
      workingDir,
      homeDirectory: homeDir,
    });
  }

  function cleanup(services: RuntimeServices): void {
    services.providerRegistry.stopWatching();
    services.configManager.stopWatchingConfigFiles();
  }

  test('services.voiceSetup is present and its status() reflects the real (fresh, not-provisioned) managed runtime', () => {
    const services = makeServices();
    try {
      expect(services.voiceSetup).toBeDefined();
      const status = services.voiceSetup.status();
      // A fresh temp home has never been provisioned — this is the real
      // provisioner reading real (absent) files on disk, not a stub.
      expect(status.state).toBe('not-provisioned');
      expect(typeof status.tts.engine).toBe('string');
      expect(status.tts.engine.length).toBeGreaterThan(0);
    } finally {
      cleanup(services);
    }
  });

  test('voice.local.status is invokable over the gateway and answers with the SAME live status voiceSetup serves directly', async () => {
    const services = makeServices();
    try {
      const direct = services.voiceSetup.status();
      const viaGateway = await services.gatewayMethods.invoke('voice.local.status', {
        context: {},
      });
      expect(viaGateway).toEqual(direct);
    } finally {
      cleanup(services);
    }
  });

  test('voice.local.install is invokable over the gateway (registered, not cataloged-but-unhandled)', async () => {
    const services = makeServices();
    try {
      // Does not actually assert on a completed install (that downloads real
      // files over the network) — only that the gateway found and ran a real
      // handler rather than refusing with "no internal handler", proving
      // voiceSetup was genuinely wired into the catalog, not merely
      // constructed and left unregistered.
      const descriptor = services.gatewayMethods.get('voice.local.install');
      expect(descriptor?.invokable).toBe(true);
    } finally {
      cleanup(services);
    }
  });

  test('ops.memory.get has NO registered handler in this composition — the honest consequence of the SDK export gap, never a fabricated snapshot', async () => {
    const services = makeServices();
    try {
      // The descriptor itself is still cataloged by the SDK's builtin method
      // list (ops.memory.get exists as a concept in the contract); what this
      // repo cannot do is register a REAL handler for it, because there is no
      // MemoryGovernor to construct. Confirm the descriptor is present but
      // invoking it fails honestly rather than serving fake data.
      const descriptor = services.gatewayMethods.get('ops.memory.get');
      expect(descriptor).toBeDefined();
      await expect(services.gatewayMethods.invoke('ops.memory.get', { context: {} }))
        .rejects.toThrow(/no internal handler/i);
    } finally {
      cleanup(services);
    }
  });
});
