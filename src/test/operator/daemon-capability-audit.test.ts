import { describe, expect, test } from 'bun:test';
import {
  AGENT_KNOWLEDGE_STATUS_ROUTE,
  buildDaemonCapabilityAuditAreas,
  renderDaemonCapabilityAudit,
  type DaemonCapabilityAuditSuccess,
} from '../../operator/daemon-capability-audit.ts';

describe('daemon capability audit', () => {
  test('requires isolated Agent Knowledge route without default wiki or HomeGraph fallback', () => {
    const areas = buildDaemonCapabilityAuditAreas(new Set<string>(), true);
    const knowledge = areas.find((area) => area.id === 'agent-knowledge');

    expect(knowledge?.coverage).toBe('ready');
    expect(knowledge?.agentRoutes).toEqual([{ route: AGENT_KNOWLEDGE_STATUS_ROUTE, coverage: 'ready' }]);
    expect(knowledge?.missingRequiredMethodIds).toEqual([]);
  });

  test('marks daemon groups partial when public method coverage is incomplete', () => {
    const areas = buildDaemonCapabilityAuditAreas(new Set<string>([
      'control.status',
      'control.auth.current',
      'channels.status',
    ]), false);
    const gateway = areas.find((area) => area.id === 'gateway-control');
    const channels = areas.find((area) => area.id === 'channels');
    const knowledge = areas.find((area) => area.id === 'agent-knowledge');

    expect(gateway?.coverage).toBe('partial');
    expect(gateway?.missingRequiredMethodIds).toContain('control.methods.list');
    expect(channels?.coverage).toBe('partial');
    expect(channels?.missingRequiredMethodIds).toContain('channels.capabilities.list');
    expect(knowledge?.coverage).toBe('missing');
    expect(knowledge?.agentRoutes[0]?.coverage).toBe('missing');
  });

  test('renders daemon capability audit with isolation statement', () => {
    const areas = buildDaemonCapabilityAuditAreas(new Set<string>([
      'control.status',
      'control.auth.current',
      'control.methods.list',
      'control.contract',
      'control.snapshot',
    ]), true);
    const audit: DaemonCapabilityAuditSuccess = {
      ok: true,
      kind: 'daemon.capabilities.audit',
      baseUrl: 'http://127.0.0.1:3421',
      daemonVersion: '0.33.35',
      expectedSdkVersion: '0.33.35',
      daemonCompatible: true,
      methodCatalogRoute: '/api/control-plane/methods',
      methodCount: 5,
      agentKnowledgeRoute: AGENT_KNOWLEDGE_STATUS_ROUTE,
      agentKnowledgeRouteReady: true,
      defaultKnowledgeFallback: false,
      homeGraphFallback: false,
      warnings: [],
      areas,
    };

    const rendered = renderDaemonCapabilityAudit(audit);

    expect(rendered).toContain('GoodVibes daemon capability audit');
    expect(rendered).toContain('Agent Knowledge: ready /api/goodvibes-agent/knowledge/status');
    expect(rendered).toContain('isolation: default Knowledge/Wiki fallback no; HomeGraph fallback no');
    expect(rendered).not.toContain('/api/knowledge/status');
    expect(rendered).not.toContain('/api/homegraph');
  });
});
