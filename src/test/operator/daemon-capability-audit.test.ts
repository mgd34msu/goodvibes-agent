import { describe, expect, test } from 'bun:test';
import {
  AGENT_KNOWLEDGE_STATUS_ROUTE,
  buildDaemonCapabilityAuditAreas,
  buildDaemonCapabilityGapReport,
  buildDaemonCapabilityInventoryReport,
  buildDaemonCapabilityRouteRiskReport,
  buildDaemonCapabilityUxCoverageReport,
  renderDaemonCapabilityInventory,
  renderDaemonCapabilityAudit,
  renderDaemonCapabilityGaps,
  renderDaemonCapabilityRouteRisk,
  renderDaemonCapabilityUxCoverage,
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

  test('summarizes read-only, mutating, authenticated, and dangerous route posture', () => {
    const areas = buildDaemonCapabilityAuditAreas(
      new Set<string>([
        'automation.integration.snapshot',
        'automation.jobs.list',
        'automation.jobs.run',
        'schedules.delete',
      ]),
      true,
      [
        {
          id: 'automation.integration.snapshot',
          access: 'authenticated',
          http: { method: 'GET', path: '/api/automation' },
        },
        {
          id: 'automation.jobs.list',
          access: 'authenticated',
          http: { method: 'GET', path: '/api/automation/jobs' },
        },
        {
          id: 'automation.jobs.run',
          access: 'authenticated',
          http: { method: 'POST', path: '/api/automation/jobs/{jobId}/run' },
        },
        {
          id: 'schedules.delete',
          access: 'authenticated',
          dangerous: true,
          http: { method: 'DELETE', path: '/api/automation/schedules/{scheduleId}' },
        },
      ],
    );
    const automation = areas.find((area) => area.id === 'automation-schedules');

    expect(automation?.routeRisk).toMatchObject({
      readOnlyMethodIds: ['automation.integration.snapshot', 'automation.jobs.list'],
      readOnlyMethodCount: 2,
      mutatingMethodIds: ['automation.jobs.run', 'schedules.delete'],
      mutatingMethodCount: 2,
      authenticatedMethodIds: [
        'automation.integration.snapshot',
        'automation.jobs.list',
        'automation.jobs.run',
        'schedules.delete',
      ],
      authenticatedMethodCount: 4,
      dangerousMethodIds: ['schedules.delete'],
    });
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
    expect(rendered).toContain('route risk:');
    expect(rendered).not.toContain('/api/knowledge/status');
    expect(rendered).not.toContain('/api/homegraph');
  });

  test('builds daemon-measured gap report without default knowledge fallback', () => {
    const areas = buildDaemonCapabilityAuditAreas(
      new Set<string>([
        'automation.integration.snapshot',
        'automation.jobs.list',
        'schedules.delete',
      ]),
      false,
      [
        {
          id: 'automation.integration.snapshot',
          access: 'authenticated',
          http: { method: 'GET', path: '/api/automation' },
        },
        {
          id: 'automation.jobs.list',
          access: 'authenticated',
          http: { method: 'GET', path: '/api/automation/jobs' },
        },
        {
          id: 'schedules.delete',
          access: 'authenticated',
          dangerous: true,
          http: { method: 'DELETE', path: '/api/automation/schedules/{scheduleId}' },
        },
      ],
    );
    const audit: DaemonCapabilityAuditSuccess = {
      ok: true,
      kind: 'daemon.capabilities.audit',
      baseUrl: 'http://127.0.0.1:3421',
      daemonVersion: '0.33.30',
      expectedSdkVersion: '0.33.35',
      daemonCompatible: false,
      methodCatalogRoute: '/api/control-plane/methods',
      methodCount: 3,
      agentKnowledgeRoute: AGENT_KNOWLEDGE_STATUS_ROUTE,
      agentKnowledgeRouteReady: false,
      defaultKnowledgeFallback: false,
      homeGraphFallback: false,
      warnings: [],
      areas,
    };

    const report = buildDaemonCapabilityGapReport(audit);
    const rendered = renderDaemonCapabilityGaps(report);

    expect(report.kind).toBe('daemon.capabilities.gaps');
    expect(report.defaultKnowledgeFallback).toBe(false);
    expect(report.homeGraphFallback).toBe(false);
    expect(report.gaps.some((gap) => gap.kind === 'version_mismatch' && gap.severity === 'blocker')).toBe(true);
    expect(report.gaps.some((gap) => gap.kind === 'agent_route_missing' && gap.detail === AGENT_KNOWLEDGE_STATUS_ROUTE)).toBe(true);
    expect(report.gaps.some((gap) => gap.kind === 'route_risk_review' && gap.detail.includes('schedules.delete'))).toBe(true);
    expect(report.gaps.some((gap) => gap.kind === 'agent_ux_gap')).toBe(true);
    expect(rendered).toContain('GoodVibes daemon capability gaps');
    expect(rendered).toContain('isolation: default Knowledge/Wiki fallback no; HomeGraph fallback no');
    expect(rendered).not.toContain('/api/knowledge/status');
    expect(rendered).not.toContain('/api/homegraph');
  });

  test('builds route-risk report for approval-center posture', () => {
    const areas = buildDaemonCapabilityAuditAreas(
      new Set<string>([
        'approvals.list',
        'approvals.approve',
        'approvals.deny',
        'channels.policies.audit',
      ]),
      true,
      [
        {
          id: 'approvals.list',
          access: 'authenticated',
          http: { method: 'GET', path: '/api/approvals' },
        },
        {
          id: 'approvals.approve',
          access: 'authenticated',
          http: { method: 'POST', path: '/api/approvals/{id}/approve' },
        },
        {
          id: 'approvals.deny',
          access: 'authenticated',
          http: { method: 'POST', path: '/api/approvals/{id}/deny' },
        },
        {
          id: 'channels.policies.audit',
          access: 'authenticated',
          dangerous: true,
          http: { method: 'POST', path: '/api/channels/policies/audit' },
        },
      ],
    );
    const audit: DaemonCapabilityAuditSuccess = {
      ok: true,
      kind: 'daemon.capabilities.audit',
      baseUrl: 'http://127.0.0.1:3421',
      daemonVersion: '0.33.35',
      expectedSdkVersion: '0.33.35',
      daemonCompatible: true,
      methodCatalogRoute: '/api/control-plane/methods',
      methodCount: 4,
      agentKnowledgeRoute: AGENT_KNOWLEDGE_STATUS_ROUTE,
      agentKnowledgeRouteReady: true,
      defaultKnowledgeFallback: false,
      homeGraphFallback: false,
      warnings: [],
      areas,
    };

    const report = buildDaemonCapabilityRouteRiskReport(audit);
    const rendered = renderDaemonCapabilityRouteRisk(report);

    expect(report.kind).toBe('daemon.capabilities.route_risk');
    expect(report.totalReadOnlyMethodCount).toBe(1);
    expect(report.totalMutatingMethodCount).toBe(3);
    expect(report.totalDangerousMethodCount).toBe(1);
    expect(report.defaultKnowledgeFallback).toBe(false);
    expect(rendered).toContain('GoodVibes daemon route risk review');
    expect(rendered).toContain('channels.policies.audit');
    expect(rendered).toContain('ordinary chat never triggers mutating routes');
    expect(rendered).not.toContain('/api/knowledge/status');
  });

  test('builds full daemon inventory report without default knowledge fallback', () => {
    const report = buildDaemonCapabilityInventoryReport(
      { baseUrl: 'http://127.0.0.1:3421', token: 'token', tokenPath: '/tmp/token.json' },
      '0.33.35',
      true,
      [
        {
          id: 'channels.status',
          category: 'channels',
          access: 'authenticated',
          invokable: true,
          http: { method: 'GET', path: '/api/channels/status' },
        },
        {
          id: 'channels.authorize',
          category: 'channels',
          access: 'authenticated',
          invokable: true,
          dangerous: true,
          http: { method: 'POST', path: '/api/channels/authorize' },
        },
        {
          id: 'providers.list',
          access: 'anonymous',
          http: { method: 'GET', path: '/api/providers' },
        },
      ],
    );
    const rendered = renderDaemonCapabilityInventory(report);

    expect(report.kind).toBe('daemon.capabilities.inventory');
    expect(report.methodCount).toBe(3);
    expect(report.readOnlyMethodCount).toBe(2);
    expect(report.mutatingMethodCount).toBe(1);
    expect(report.dangerousMethodCount).toBe(1);
    expect(report.defaultKnowledgeFallback).toBe(false);
    expect(report.homeGraphFallback).toBe(false);
    expect(report.groups[0]?.category).toBe('channels');
    expect(rendered).toContain('GoodVibes daemon method inventory');
    expect(rendered).toContain('channels.authorize');
    expect(rendered).toContain('dangerous');
    expect(rendered).not.toContain('/api/knowledge');
    expect(rendered).not.toContain('/api/homegraph');
  });

  test('maps full daemon inventory to Agent UX coverage without default knowledge fallback', () => {
    const inventory = buildDaemonCapabilityInventoryReport(
      { baseUrl: 'http://127.0.0.1:3421', token: 'token', tokenPath: '/tmp/token.json' },
      '0.33.35',
      true,
      [
        {
          id: 'channels.status',
          category: 'channels',
          access: 'authenticated',
          http: { method: 'GET', path: '/api/channels/status' },
        },
        {
          id: 'approvals.approve',
          category: 'approvals',
          access: 'authenticated',
          http: { method: 'POST', path: '/api/approvals/123/approve' },
        },
        {
          id: 'knowledge.ask',
          category: 'knowledge',
          access: 'authenticated',
          http: { method: 'POST', path: '/api/knowledge/ask' },
        },
        {
          id: 'custom.admin.mutate',
          category: 'custom',
          access: 'admin',
          dangerous: true,
          http: { method: 'POST', path: '/api/custom/mutate' },
        },
      ],
    );

    const report = buildDaemonCapabilityUxCoverageReport(inventory);
    const rendered = renderDaemonCapabilityUxCoverage(report);

    expect(report.kind).toBe('daemon.capabilities.ux_coverage');
    expect(report.defaultKnowledgeFallback).toBe(false);
    expect(report.homeGraphFallback).toBe(false);
    expect(report.usableMethodCount).toBe(1);
    expect(report.explicitConfirmationMethodCount).toBe(1);
    expect(report.blockedMethodCount).toBe(1);
    expect(report.notSurfacedMethodCount).toBe(1);
    expect(report.groups.flatMap((group) => group.methods).find((method) => method.id === 'knowledge.ask')?.uxCoverage).toBe('blocked');
    expect(rendered).toContain('GoodVibes daemon-to-Agent UX coverage');
    expect(rendered).toContain('knowledge.ask [blocked]');
    expect(rendered).toContain('custom.admin.mutate [not_surfaced]');
    expect(rendered).toContain('default Knowledge/Wiki fallback no');
  });
});
