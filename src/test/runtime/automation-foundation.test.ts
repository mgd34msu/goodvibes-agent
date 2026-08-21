import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { ConfigManager } from '@pellux/goodvibes-sdk/platform/config';
import { createRuntimeStore } from '../../runtime/store/index.ts';
import {
  createFeatureFlagManager,
  deriveFeatureStates,
  RuntimeEventBus,
  configureRuntimeEventBusDefaults,
  runtimeEventBusOptionsFrom,
} from '@/runtime/index.ts';
import { AutomationRouteStore } from '@pellux/goodvibes-sdk/platform/automation';
import { RouteBindingManager } from '@pellux/goodvibes-sdk/platform/channels';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

describe('automation/control-plane foundation', () => {
  let root = '';
  let configDir = '';

  beforeEach(() => {
    root = makeProjectTempDir('gv-automation-foundation');
    configDir = join(root, '.goodvibes', 'tui');
  });

  afterEach(() => {
    configDir = '';
  });

  test('initial runtime store includes automation, routes, control-plane, and watcher domains', () => {
    const store = createRuntimeStore();
    const state = store.getState();

    expect(state.automation.jobs.size).toBe(0);
    expect(state.routes.bindings.size).toBe(0);
    expect(state.controlPlane.clients.size).toBe(0);
    expect(state.deliveries.deliveryAttempts.size).toBe(0);
    expect(state.watchers.watchers.size).toBe(0);
    expect(state.surfaces.surfaces.size).toBe(0);
    expect(state.routes.bindingIds).toEqual([]);
    expect(state.controlPlane.connectionState).toBe('disabled');
  });

  test('config manager supports deep surface settings and reset for nested keys', () => {
    const config = new ConfigManager({ surfaceRoot: 'tui',  configDir });

    expect(config.get('surfaces.slack.enabled')).toBe(false);
    expect(config.get('automation.maxConcurrentRuns')).toBe(4);

    config.set('surfaces.slack.enabled', true);
    config.set('surfaces.discord.applicationId', 'discord-app');
    config.set('automation.maxConcurrentRuns', 9);

    expect(config.get('surfaces.slack.enabled')).toBe(true);
    expect(config.get('surfaces.discord.applicationId')).toBe('discord-app');
    expect(config.get('automation.maxConcurrentRuns')).toBe(9);

    config.reset('surfaces.slack.enabled');
    config.reset('surfaces.discord.applicationId');
    config.reset('automation.maxConcurrentRuns');

    expect(config.get('surfaces.slack.enabled')).toBe(false);
    expect(config.get('surfaces.discord.applicationId')).toBe('');
    expect(config.get('automation.maxConcurrentRuns')).toBe(4);
  });

  test('feature flag manager registers automation and gateway cutover flags', () => {
    const flags = createFeatureFlagManager();

    // Dissolved feature model: these capabilities default ON (nothing
    // default-on requires a setup step, automation idles with a
    // first-routine empty state, the gateway streams companion chat over SSE
    // without config, route binding activates through its domain key
    // integrations.routeBinding which also defaults true).
    expect(flags.isEnabled('automation-domain')).toBe(true);
    expect(flags.isEnabled('control-plane-gateway')).toBe(true);
    expect(flags.isEnabled('route-binding')).toBe(true);

    flags.loadFromConfig({
      flags: {
        'automation-domain': 'enabled',
        'control-plane-gateway': 'enabled',
        'route-binding': 'enabled',
      },
    });

    expect(flags.isEnabled('automation-domain')).toBe(true);
    expect(flags.isEnabled('control-plane-gateway')).toBe(true);
    expect(flags.isEnabled('route-binding')).toBe(true);
  });

  /**
   * integrations.routeBinding, driven to BOTH values through the real consumer.
   *
   * This setting used to configure nothing in this product. The gate reads
   * through isFeatureGateEnabled, which is permissive when no manager is wired,
   * a narrow embed with no flag manager gets the capability rather than a silent
   * off, so a composition root that omitted featureFlags did not DISABLE route
   * binding. It made the switch inert: the key rendered in settings, accepted a
   * write, reported success, and the manager went on binding either way. That is
   * the same shape as a bot username that lands in the wrong config file, and it
   * is why services.ts now threads featureFlags into RouteBindingManager.
   *
   * The mutation check for this row: remove that argument and the "off" half of
   * the first test below fails, because the manager falls back to permissive.
   */
  function routeBindingManager(enabled: boolean): RouteBindingManager {
    const configManager = new ConfigManager({ surfaceRoot: 'agent', workingDir: root, homeDir: root, configDir });
    configManager.set('integrations.routeBinding', enabled);
    const featureFlags = createFeatureFlagManager();
    featureFlags.loadFromConfig({ flags: deriveFeatureStates(configManager) });
    // Constructed exactly as runtime/services.ts constructs it.
    return new RouteBindingManager({
      store: new AutomationRouteStore({ configManager }),
      runtimeStore: createRuntimeStore(),
      featureFlags,
    });
  }

  test('integrations.routeBinding false turns route binding off, and the manager says so', async () => {
    const manager = routeBindingManager(false);
    // Askable, so a caller can tell "you have no bindings" from "bindings are off".
    expect(manager.isRouteBindingEnabled()).toBe(false);
    expect(manager.listBindings()).toEqual([]);
    // A write REFUSES rather than silently doing nothing, and the refusal names
    // the setting so the reason is diagnosable from the message alone.
    let refusal = '';
    try {
      await manager.upsertBinding({ kind: 'session', surfaceKind: 'telegram', surfaceId: 'surface:telegram', externalId: 'chat-1' });
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    expect(refusal).toContain('integrations.routeBinding');
  });

  test('integrations.routeBinding true binds and resolves a route, and is the shipped default', async () => {
    const manager = routeBindingManager(true);
    expect(manager.isRouteBindingEnabled()).toBe(true);
    const binding = await manager.upsertBinding({ kind: 'session', surfaceKind: 'telegram', surfaceId: 'surface:telegram', externalId: 'chat-1' });
    expect(binding.externalId).toBe('chat-1');
    expect(manager.resolve('telegram', 'chat-1')?.id).toBe(binding.id);

    // The default half: with the key never written, the effective behaviour is
    // the same as true. This is what makes threading featureFlags a fix that
    // changes only whether the switch WORKS, not what an existing install does.
    const configManager = new ConfigManager({ surfaceRoot: 'agent', workingDir: root, homeDir: root, configDir: join(root, '.goodvibes', 'unset') });
    expect(configManager.get('integrations.routeBinding')).toBe(true);
    const flags = createFeatureFlagManager();
    flags.loadFromConfig({ flags: deriveFeatureStates(configManager) });
    const unset = new RouteBindingManager({
      store: new AutomationRouteStore({ configManager }),
      runtimeStore: createRuntimeStore(),
      featureFlags: flags,
    });
    expect(unset.isRouteBindingEnabled()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runtime.eventBus.maxListeners, threaded into a bus built with no options,
// the same way every composition root in this project now calls it
// (bundle-command.ts, management.ts, bootstrap-core.ts):
// `configureRuntimeEventBusDefaults(runtimeEventBusOptionsFrom((key) =>
// configManager.get(key)))` right before the first `new RuntimeEventBus()`.
//
// Before this sweep, none of the three called it: the schema promised a
// tunable listener cap and every bus in this project was built with no
// options, so the cap was always the SDK's hardcoded 100 regardless of the
// setting. This proves the exact call shape used at all three sites reaches
// a freshly-built bus, in both directions (a lower cap refuses sooner, a
// higher cap accepts more).
// ---------------------------------------------------------------------------

describe('runtime.eventBus.maxListeners reaches a bus built with no options', () => {
  let origEnv: string | undefined;
  let tmpRoot: string;

  beforeEach(() => {
    origEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';
    tmpRoot = makeProjectTempDir('gv-event-bus-cap');
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = origEnv;
    }
    // Leave the process-wide default where the rest of the suite expects it.
    configureRuntimeEventBusDefaults({ maxListeners: 100 });
  });

  function configManagerWithCap(cap: number): ConfigManager {
    const manager = new ConfigManager({ surfaceRoot: 'agent', configDir: join(tmpRoot, `config-${cap}`) });
    manager.set('runtime.eventBus.maxListeners', cap);
    return manager;
  }

  test('a configured cap of 4 refuses the 5th listener on a bus built after the call', () => {
    const configManager = configManagerWithCap(4);
    // The exact call shape used at every composition-root site in this project.
    configureRuntimeEventBusDefaults(runtimeEventBusOptionsFrom((key) => configManager.get(key)));

    const bus = new RuntimeEventBus();
    for (let i = 0; i < 4; i++) {
      bus.on('SESSION_STARTED', (() => {}) as Parameters<typeof bus.on>[1]);
    }
    expect(() => {
      bus.on('SESSION_STARTED', (() => {}) as Parameters<typeof bus.on>[1]);
    }).toThrow(RangeError);
  });

  test('a configured cap of 40 accepts a 5th listener and refuses the 41st', () => {
    const configManager = configManagerWithCap(40);
    configureRuntimeEventBusDefaults(runtimeEventBusOptionsFrom((key) => configManager.get(key)));

    const bus = new RuntimeEventBus();
    // The count the previous case refused is fine at this cap.
    expect(() => {
      for (let i = 0; i < 5; i++) bus.on('SESSION_STARTED', (() => {}) as Parameters<typeof bus.on>[1]);
    }).not.toThrow();
    for (let i = 0; i < 35; i++) bus.on('SESSION_STARTED', (() => {}) as Parameters<typeof bus.on>[1]);
    expect(() => {
      bus.on('SESSION_STARTED', (() => {}) as Parameters<typeof bus.on>[1]);
    }).toThrow(RangeError);
  });
});
