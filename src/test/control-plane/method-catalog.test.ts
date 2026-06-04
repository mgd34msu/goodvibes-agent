import { describe, expect, test } from 'bun:test';
import { GatewayMethodCatalog } from '@pellux/goodvibes-sdk/platform/control-plane';
import { buildOperatorContract } from '@pellux/goodvibes-sdk/platform/control-plane';

function schemaProperty(schema: unknown, ...path: string[]): unknown {
  let current: unknown = schema;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    const record = current as Record<string, unknown>;
    const properties = record.properties as Record<string, unknown> | undefined;
    const items = record.items as Record<string, unknown> | undefined;
    const itemProperties = items?.properties as Record<string, unknown> | undefined;
    current = properties?.[segment] ?? itemProperties?.[segment] ?? record[segment];
  }
  return current;
}

describe('GatewayMethodCatalog', () => {
  test('lists built-in gateway methods', () => {
    const catalog = new GatewayMethodCatalog();
    const methods = catalog.list();
    const methodIds = methods.map((method) => method.id);

    expect(methodIds).toEqual(expect.arrayContaining([
      'control.snapshot',
      'control.auth.current',
      'automation.heartbeat.run',
      'telemetry.snapshot',
      'telemetry.stream',
      'remote.node_host.contract',
      'control.events.catalog',
      'local_auth.status',
      'providers.list',
      'providers.usage.get',
      'knowledge.status',
      'knowledge.packet',
      'knowledge.connectors.list',
      'knowledge.connector.doctor',
      'knowledge.extractions.list',
      'knowledge.usage.list',
      'knowledge.candidates.list',
      'knowledge.schedules.list',
      'knowledge.job.run',
      'knowledge.projection.materialize',
      'knowledge.graphql.execute',
      'multimodal.analyze',
      'multimodal.writeback',
    ]));
  });

  test('lists built-in gateway events and matches HTTP route templates', () => {
    const catalog = new GatewayMethodCatalog();
    const events = catalog.listEvents();
    const eventIds = events.map((event) => event.id);

    expect(eventIds).toEqual(expect.arrayContaining([
      'runtime.automation',
      'runtime.knowledge',
      'control.ready',
    ]));

    expect(catalog.findByHttpBinding('GET', '/api/control-plane/methods/control.status')?.id).toBe('control.methods.get');
    expect(catalog.findByHttpBinding('GET', '/api/control-plane/auth')?.id).toBe('control.auth.current');
    expect(catalog.findByHttpBinding('GET', '/api/v1/telemetry')?.id).toBe('telemetry.snapshot');
    expect(catalog.findByHttpBinding('GET', '/api/v1/telemetry/events')?.id).toBe('telemetry.events.list');
    expect(catalog.findByHttpBinding('GET', '/api/artifacts/art-123/content')?.id).toBe('artifacts.content.get');
    expect(catalog.findByHttpBinding('GET', '/api/remote/node-host/contract')?.id).toBe('remote.node_host.contract');
    expect(catalog.findByHttpBinding('GET', '/api/channels/setup/telegram')?.id).toBe('channels.setup.get');
    expect(catalog.findByHttpBinding('POST', '/api/channels/allowlist/signal/edit')?.id).toBe('channels.allowlist.edit');
    expect(catalog.findByHttpBinding('GET', '/api/providers/openai')?.id).toBe('providers.get');
    expect(catalog.findByHttpBinding('GET', '/api/providers/openai/usage')?.id).toBe('providers.usage.get');
    expect(catalog.findByHttpBinding('GET', '/api/knowledge/items/source-123')?.id).toBe('knowledge.item.get');
    expect(catalog.findByHttpBinding('POST', '/api/knowledge/packet')?.id).toBe('knowledge.packet');
    expect(catalog.findByHttpBinding('GET', '/api/knowledge/connectors/bookmark')?.id).toBe('knowledge.connector.get');
    expect(catalog.findByHttpBinding('GET', '/api/knowledge/connectors/bookmark/doctor')?.id).toBe('knowledge.connector.doctor');
    expect(catalog.findByHttpBinding('GET', '/api/knowledge/extractions/extract-123')?.id).toBe('knowledge.extraction.get');
    expect(catalog.findByHttpBinding('GET', '/api/knowledge/usage')?.id).toBe('knowledge.usage.list');
    expect(catalog.findByHttpBinding('GET', '/api/knowledge/candidates')?.id).toBe('knowledge.candidates.list');
    expect(catalog.findByHttpBinding('GET', '/api/knowledge/schedules')?.id).toBe('knowledge.schedules.list');
    expect(catalog.findByHttpBinding('POST', '/api/knowledge/jobs/knowledge-lint/run')?.id).toBe('knowledge.job.run');
    expect(catalog.findByHttpBinding('POST', '/api/knowledge/projections/materialize')?.id).toBe('knowledge.projection.materialize');
    expect(catalog.findByHttpBinding('POST', '/api/knowledge/graphql')?.id).toBe('knowledge.graphql.execute');
    expect(catalog.findByHttpBinding('POST', '/api/multimodal/analyze')?.id).toBe('multimodal.analyze');
  });

  test('registers, invokes, and unregisters plugin methods', async () => {
    const catalog = new GatewayMethodCatalog({ includeBuiltins: false });
    const unregister = catalog.register({
      id: 'plugin.test.echo',
      title: 'Echo',
      description: 'Echo test body',
      category: 'test',
      source: 'plugin',
      access: 'authenticated',
      transport: ['ws', 'internal'],
      scopes: ['test:echo'],
      pluginId: 'test',
    }, async (input) => ({ ok: true, body: input.body }));

    await expect(catalog.invoke('plugin.test.echo', {
      body: { value: 1 },
      context: { principalId: 'tester' },
    })).resolves.toEqual({ ok: true, body: { value: 1 } });

    unregister();
    expect(catalog.get('plugin.test.echo')).toBeNull();
  });

  test('exposes structured operator contract payloads instead of generic objects', () => {
    const catalog = new GatewayMethodCatalog();
    const contract = buildOperatorContract(catalog);

    expect(contract.product.id).toBe('goodvibes');
    expect(contract.operator.methods).toHaveLength(catalog.list().length);
    expect(contract.operator.events).toHaveLength(catalog.listEvents().length);
    expect(contract.operator.schemaCoverage.methods).toBe(catalog.list().length);

    const schemaPaths: readonly [string, ...string[]][] = [
      ['control.contract', 'contract', 'product', 'id'],
      ['control.contract', 'contract', 'auth', 'current', 'path'],
      ['control.contract', 'contract', 'operator', 'methods', 'id'],
      ['control.contract', 'contract', 'operator', 'events', 'id'],
      ['control.auth.current', 'principalId'],
      ['control.methods.list', 'methods', 'id'],
      ['control.methods.get', 'method', 'id'],
      ['control.events.catalog', 'events', 'id'],
      ['control.messages.list', 'messages', 'attachments', 'artifactId'],
      ['control.clients.list', 'clients', 'surface'],
      ['telemetry.snapshot', 'capabilities', 'signals', 'events'],
      ['telemetry.events.list', 'items', 'traceId'],
      ['telemetry.traces.list', 'items', 'spanContext', 'traceId'],
      ['telemetry.metrics.get', 'aggregates', 'totalEvents'],
      ['panels.list', 'panels', 'id'],
      ['surfaces.list', 'surfaces', 'id'],
      ['routes.bindings.list', 'bindings', 'id'],
      ['channels.status', 'channels', 'id'],
      ['channels.capabilities.list', 'capabilities', 'id'],
      ['channels.tools.list', 'tools', 'id'],
      ['channels.actions.list', 'actions', 'id'],
      ['channels.repairs.list', 'actions', 'id'],
      ['channels.policies.list', 'policies', 'surface'],
      ['channels.policies.audit', 'audit', 'id'],
      ['channels.directory.query', 'entries', 'id'],
      ['voice.providers.list', 'providers', 'id'],
      ['voice.voices.list', 'voices', 'id'],
      ['web_search.providers.list', 'providers', 'id'],
      ['media.providers.list', 'providers', 'id'],
    ];
    const missingSchemaPaths = schemaPaths
      .filter(([methodId, ...path]) => schemaProperty(catalog.get(methodId)?.outputSchema, ...path) === undefined)
      .map(([methodId, ...path]) => `${methodId}:${path.join('.')}`);
    expect(missingSchemaPaths).toEqual([]);
  });
});
