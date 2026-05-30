import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { RuntimeEventBus, startExternalServices } from '@/runtime/index.ts';
import { HookDispatcher } from '@pellux/goodvibes-sdk/platform/hooks';
import { getTestRuntimeServices } from '../helpers/runtime-services.ts';

function createConfig(overrides: {
  daemon?: boolean;
  httpListener?: boolean;
  controlPlaneHost?: string;
  controlPlanePort?: number;
  httpListenerHost?: string;
  httpListenerPort?: number;
} = {}) {
  return {
    get(
      key:
        | 'danger.daemon'
        | 'danger.httpListener'
        | 'controlPlane.host'
        | 'controlPlane.port'
        | 'httpListener.host'
        | 'httpListener.port',
    ): boolean | string | number {
      if (key === 'danger.daemon') return overrides.daemon ?? false;
      if (key === 'danger.httpListener') return overrides.httpListener ?? false;
      if (key === 'controlPlane.host') return overrides.controlPlaneHost ?? '127.0.0.1';
      if (key === 'controlPlane.port') return overrides.controlPlanePort ?? 3421;
      if (key === 'httpListener.host') return overrides.httpListenerHost ?? '127.0.0.1';
      return overrides.httpListenerPort ?? 3422;
    },
  };
}

describe('startExternalServices', () => {
  let runtimeBus: RuntimeEventBus;
  let hookDispatcher: HookDispatcher;
  let runtimeServices: ReturnType<typeof getTestRuntimeServices>;

  beforeEach(() => {
    runtimeBus = new RuntimeEventBus();
    hookDispatcher = new HookDispatcher();
    runtimeServices = getTestRuntimeServices();
  });

  test('does not start embedded daemon or listener even when legacy flags are enabled', async () => {
    const daemonFactory = mock(() => ({
      enable: mock(() => true),
      start: mock(async () => {}),
      stop: mock(async () => {}),
      listRecentControlPlaneEvents: mock(() => []),
    }));
    const listenerFactory = mock(() => ({
      enable: mock(() => true),
      start: mock(async () => {}),
      stop: mock(async () => {}),
    }));
    const probeDaemonPortInUse = mock(async () => false);
    const probeHttpListenerPortInUse = mock(async () => false);

    const services = await startExternalServices(
      createConfig({ daemon: true, httpListener: true }),
      runtimeBus,
      hookDispatcher,
      runtimeServices,
      {
        createDaemonServer: daemonFactory,
        createHttpListener: listenerFactory,
        probeDaemonPortInUse,
        probeHttpListenerPortInUse,
      },
    );

    expect(daemonFactory).not.toHaveBeenCalled();
    expect(listenerFactory).not.toHaveBeenCalled();
    expect(probeDaemonPortInUse).not.toHaveBeenCalled();
    expect(probeHttpListenerPortInUse).not.toHaveBeenCalled();
    expect(services.daemonServer).toBeNull();
    expect(services.httpListener).toBeNull();
    expect(services.daemonStatus.mode).toBe('external');
    expect(services.httpListenerStatus.mode).toBe('disabled');
    expect(services.daemonStatus.reason).toContain('externally managed GoodVibes daemon');
    expect(services.httpListenerStatus.reason).toContain('does not own the HTTP listener lifecycle');

    await services.stop();
    expect(services.listRecentControlPlaneEvents()).toEqual([]);
  });

  test('reports configured external daemon endpoint without binding ports', async () => {
    const services = await startExternalServices(
      createConfig({
        daemon: true,
        httpListener: true,
        controlPlaneHost: '0.0.0.0',
        controlPlanePort: 4444,
        httpListenerHost: '0.0.0.0',
        httpListenerPort: 5555,
      }),
      runtimeBus,
      hookDispatcher,
      runtimeServices,
    );

    expect(services.daemonStatus).toMatchObject({
      mode: 'external',
      host: '0.0.0.0',
      port: 4444,
      baseUrl: 'http://0.0.0.0:4444',
    });
    expect(services.httpListenerStatus).toMatchObject({
      mode: 'disabled',
      host: '0.0.0.0',
      port: 5555,
      baseUrl: 'http://0.0.0.0:5555',
    });
  });

  test('runtime hook dispatcher does not configure local agent hook spawning', async () => {
    runtimeServices.hookDispatcher.clear();
    runtimeServices.hookDispatcher.register('Pre:tool:read', {
      match: 'read',
      type: 'agent',
      prompt: 'spawn a background checker',
    });

    const result = await runtimeServices.hookDispatcher.fire({
      path: 'Pre:tool:read',
      phase: 'Pre',
      category: 'tool',
      specific: 'read',
      sessionId: 'session-agent-hook-block',
      timestamp: Date.now(),
      payload: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('agent hook runner is not configured');
    expect(runtimeServices.agentManager.list()).toHaveLength(0);
  });
});
