import { describe, expect, test } from 'bun:test';
import { RuntimeEventBus } from '@/runtime/index.ts';
import {
  registeredEventTypes,
  validateEvent,
} from '@/runtime/index.ts';
import {
  emitAutomationJobCreated,
  emitControlPlaneClientConnected,
  emitDeliveryQueued,
  emitRouteBindingCreated,
  emitTokenBlocked,
  emitSurfaceEnabled,
  emitUiRenderRequest,
  emitWatcherStarted,
} from '@/runtime/index.ts';
import {
  CONTROL_PLANE_CLIENT_KINDS,
  CONTROL_PLANE_TRANSPORT_KINDS,
  RUNTIME_EVENT_DOMAINS,
  ROUTE_SURFACE_KINDS,
  SURFACE_KINDS,
  isRuntimeEventDomain,
} from '@/runtime/index.ts';

// Drain queued microtasks so bus.emit() listeners (OBS-14 async dispatch) run before assertions.
const flushMicrotasks = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('new runtime event domains', () => {
  test('exports the canonical runtime domain vocabulary', () => {
    expect([...RUNTIME_EVENT_DOMAINS]).toEqual([
      'session',
      'turn',
      'providers',
      'tools',
      'tasks',
      'agents',
      'workflows',
      'orchestration',
      'communication',
      'planner',
      'permissions',
      'plugins',
      'mcp',
      'transport',
      'compaction',
      'ui',
      'ops',
      'forensics',
      'security',
      'automation',
      'routes',
      'control-plane',
      'deliveries',
      'watchers',
      'surfaces',
      'knowledge',
      'workspace',
      // SDK 1.6.1 adds the fleet domain (runtime/fleet/*) — background-agent
      // fleet lifecycle events. Adopted: runtime/services.ts attaches the
      // SDK's attachFleetEmitBridge onto the runtime bus so orchestrator-
      // spawned agents' spawn/progress/attention/completion deltas publish on
      // this domain (see src/test/runtime/fleet-attention.test.ts for the
      // needs-input attention behavior this enables).
      'fleet',
      // SDK 1.21.0 adds the config domain: in-process settings changes become
      // key-level events, so a client whose settings live in the daemon gets
      // live change notices instead of polling for them. Verb-side, and the
      // daemon is what attaches the emit bridge — this surface reads the
      // notices rather than producing them, so the vocabulary is all it needs
      // from this row.
      'config',
    ]);
    expect(isRuntimeEventDomain('agents')).toBe(true);
    expect(isRuntimeEventDomain('not-a-domain')).toBe(false);
  });

  test('registers and validates the new event contracts', () => {
    const samples = [
      { type: 'AUTOMATION_JOB_CREATED', jobId: 'job-1', name: 'nightly', scheduleKind: 'cron', enabled: true },
      { type: 'ROUTE_BINDING_CREATED', bindingId: 'route-1', surfaceKind: 'slack', externalId: 'C123', targetKind: 'session', targetId: 'session-1' },
      { type: 'CONTROL_PLANE_CLIENT_CONNECTED', clientId: 'client-1', clientKind: 'web', transport: 'sse' },
      { type: 'DELIVERY_QUEUED', deliveryId: 'delivery-1', jobId: 'job-1', runId: 'run-1', surfaceKind: 'webhook', targetId: 'hook-1', deliveryKind: 'notification' },
      { type: 'WATCHER_STARTED', watcherId: 'watcher-1', sourceKind: 'poll', name: 'github-issues' },
      { type: 'SURFACE_ENABLED', surfaceKind: 'ntfy', surfaceId: 'surface-1', accountId: 'acct-1' },
    ] as const;

    for (const sample of samples) {
      expect(registeredEventTypes()).toContain(sample.type);
      expect(validateEvent(sample).valid).toBe(true);
    }
  });

  test('emits the new domains through the runtime bus', async () => {
    const bus = new RuntimeEventBus();
    const seen: string[] = [];

    bus.onDomain('automation', (env) => seen.push(env.type));
    bus.onDomain('routes', (env) => seen.push(env.type));
    bus.onDomain('control-plane', (env) => seen.push(env.type));
    bus.onDomain('deliveries', (env) => seen.push(env.type));
    bus.onDomain('watchers', (env) => seen.push(env.type));
    bus.onDomain('surfaces', (env) => seen.push(env.type));

    const ctx = { sessionId: 'session-1', source: 'test', traceId: 'trace-1' };

    emitAutomationJobCreated(bus, ctx, { jobId: 'job-1', name: 'nightly', scheduleKind: 'cron', enabled: true });
    emitRouteBindingCreated(bus, ctx, { bindingId: 'route-1', surfaceKind: 'slack', externalId: 'C123', targetKind: 'session', targetId: 'session-1' });
    emitControlPlaneClientConnected(bus, ctx, { clientId: 'client-1', clientKind: 'tui', transport: 'local' });
    emitDeliveryQueued(bus, ctx, { deliveryId: 'delivery-1', jobId: 'job-1', runId: 'run-1', surfaceKind: 'webhook', targetId: 'hook-1', deliveryKind: 'notification' });
    emitWatcherStarted(bus, ctx, { watcherId: 'watcher-1', sourceKind: 'poll', name: 'github-issues' });
    emitSurfaceEnabled(bus, ctx, { surfaceKind: 'discord', surfaceId: 'surface-1', accountId: 'acct-1' });

    await flushMicrotasks();
    expect(seen).toContain('AUTOMATION_JOB_CREATED');
    expect(seen).toContain('ROUTE_BINDING_CREATED');
    expect(seen).toContain('CONTROL_PLANE_CLIENT_CONNECTED');
    expect(seen).toContain('DELIVERY_QUEUED');
    expect(seen).toContain('WATCHER_STARTED');
    expect(seen).toContain('SURFACE_ENABLED');
  });

  test('event vocabularies cover all first-class GoodVibes surfaces', () => {
    const copiedSurfaceKind = ['home', 'assistant'].join('') as unknown as 'service';
    expect([...ROUTE_SURFACE_KINDS]).toEqual([
      'tui',
      'web',
      'slack',
      'discord',
      'ntfy',
      'webhook',
      copiedSurfaceKind,
      'telegram',
      'google-chat',
      'signal',
      'whatsapp',
      'telephony',
      'imessage',
      'msteams',
      'bluebubbles',
      'mattermost',
      'matrix',
      'service',
    ]);
    // SURFACE_KINDS is a superset of ROUTE_SURFACE_KINDS: the One-Platform effort added
    // first-class platform surfaces (agent, webui, companion, automation) that are
    // not externally routable message channels, so they live in SURFACE_KINDS only.
    expect([...SURFACE_KINDS]).toEqual([...ROUTE_SURFACE_KINDS, 'agent', 'webui', 'companion', 'automation']);
    expect([...CONTROL_PLANE_CLIENT_KINDS]).toContain('daemon');
    expect([...CONTROL_PLANE_CLIENT_KINDS]).toContain('service');
    expect([...CONTROL_PLANE_CLIENT_KINDS]).toContain('telegram');
    expect([...CONTROL_PLANE_CLIENT_KINDS]).toContain('google-chat');
    expect([...CONTROL_PLANE_CLIENT_KINDS]).toContain('signal');
    expect([...CONTROL_PLANE_CLIENT_KINDS]).toContain('whatsapp');
    expect([...CONTROL_PLANE_CLIENT_KINDS]).toContain('telephony');
    expect([...CONTROL_PLANE_CLIENT_KINDS]).toContain('imessage');
    expect([...CONTROL_PLANE_CLIENT_KINDS]).toContain('msteams');
    expect([...CONTROL_PLANE_CLIENT_KINDS]).toContain('bluebubbles');
    expect([...CONTROL_PLANE_CLIENT_KINDS]).toContain('mattermost');
    expect([...CONTROL_PLANE_CLIENT_KINDS]).toContain('matrix');
    expect([...CONTROL_PLANE_TRANSPORT_KINDS]).toContain('ws');
    expect([...CONTROL_PLANE_TRANSPORT_KINDS]).toContain('websocket');

    expect(validateEvent({
      type: 'ROUTE_BINDING_CREATED',
      bindingId: 'route-tui',
      surfaceKind: 'tui',
      externalId: 'local',
      targetKind: 'session',
      targetId: 'session-1',
    }).valid).toBe(true);
    expect(validateEvent({
      type: 'SURFACE_ENABLED',
      surfaceKind: 'service',
      surfaceId: 'surface-service',
      accountId: 'service-account',
    }).valid).toBe(true);
    expect(validateEvent({
      type: 'CONTROL_PLANE_CLIENT_CONNECTED',
      clientId: 'client-service',
      clientKind: 'service',
      transport: 'websocket',
    }).valid).toBe(true);
  });

  test('ui and security event domains have typed emitter wrappers', async () => {
    const bus = new RuntimeEventBus();
    const seen: string[] = [];
    const ctx = { sessionId: 'session-1', source: 'test', traceId: 'trace-1' };

    bus.onDomain('ui', (env) => seen.push(env.type));
    bus.onDomain('security', (env) => seen.push(env.type));

    emitUiRenderRequest(bus, ctx);
    emitTokenBlocked(bus, ctx, {
      tokenId: 'token-1',
      label: 'test-token',
      reason: 'rotation_overdue',
    });

    await flushMicrotasks();
    expect(seen).toEqual(['UI_RENDER_REQUEST', 'TOKEN_BLOCKED']);
  });
});
