import { describe, expect, test } from 'bun:test';
import { buildCliDoctorFindings, renderCliStatus } from '../../cli/status.ts';
import type { CliStatusOptions } from '../../cli/status.ts';

type ConfigValues = Record<string, unknown>;

function makeOptions(overrides: ConfigValues = {}): CliStatusOptions {
  const values: ConfigValues = {
    'provider.provider': 'openai',
    'provider.model': 'openai:gpt-5.4',
    'provider.reasoningEffort': 'high',
    'permissions.mode': 'prompt',
    'storage.secretPolicy': 'preferred_secure',
    'service.enabled': true,
    'service.autostart': true,
    'service.restartOnFailure': true,
    'danger.daemon': true,
    'danger.httpListener': false,
    'web.enabled': false,
    'controlPlane.enabled': true,
    'controlPlane.hostMode': 'local',
    'controlPlane.host': '127.0.0.1',
    'controlPlane.port': 3421,
    'httpListener.hostMode': 'local',
    'httpListener.host': '127.0.0.1',
    'httpListener.port': 3422,
    'web.hostMode': 'local',
    'web.host': '127.0.0.1',
    'web.port': 3423,
    ...overrides,
  };

  return {
    configManager: {
      get: (key: string) => values[key],
    } as CliStatusOptions['configManager'],
    workingDirectory: '/project',
    homeDirectory: '/home/test',
    onboardingMarkers: {
      project: { scope: 'project', path: '/project/.goodvibes/agent/onboarding-checked.json', exists: false, payload: null },
      user: { scope: 'user', path: '/home/test/.goodvibes/agent/onboarding-checked.json', exists: false, payload: null },
      effective: null,
    },
    auth: {
      userStorePath: '/home/test/.goodvibes/agent/auth-users.json',
      userStorePresent: true,
      bootstrapCredentialPath: '/home/test/.goodvibes/agent/auth-bootstrap.txt',
      bootstrapCredentialPresent: false,
      operatorTokenPath: '/home/test/.goodvibes/daemon/operator-tokens.json',
      operatorTokenPresent: true,
    },
  };
}

describe('CLI status and doctor output', () => {
  test('renders operator-friendly labels for permission and secret policies', () => {
    const text = renderCliStatus(makeOptions({
      'permissions.mode': 'allow-all',
      'storage.secretPolicy': 'require_secure',
    }));

    expect(text).toContain('permissions: Allow everything (allow-all)');
    expect(text).toContain('secretPolicy: Require secure storage (require_secure)');
  });

  test('doctor findings include cause, impact, and action', () => {
    const text = renderCliStatus({
      ...makeOptions({
        'permissions.mode': 'allow-all',
        'danger.httpListener': true,
        'httpListener.hostMode': 'network',
        'httpListener.host': '0.0.0.0',
      }),
      doctor: true,
    });

    expect(text).toContain('[risk:security:allow-all-permissions]');
    expect(text).toContain('cause: permissions.mode is allow-all.');
    expect(text).toContain('impact: Powerful write, edit, network, and execution tools can run without a Human-in-the-Loop (HITL) approval prompt.');
    expect(text).toContain('action: Use Ask before powerful actions or Custom rules unless this is an intentionally trusted environment.');
    expect(text).toContain('[warning:network:network-http-listener-enabled]');
  });

  test('service posture findings never instruct Agent to mutate runtime lifecycle', () => {
    const findings = buildCliDoctorFindings(makeOptions({
      'service.enabled': false,
      'service.autostart': false,
      'service.restartOnFailure': false,
      'danger.daemon': true,
      'controlPlane.enabled': true,
    }));
    const text = findings.map((finding) => `${finding.summary}\n${finding.action}`).join('\n');

    expect(text).toContain('Agent service ownership is disabled');
    expect(text).toContain('GoodVibes TUI or the owning host');
    expect(text).not.toContain('Enable service mode');
    expect(text).not.toContain('Enable service.autostart');
    expect(text).not.toContain('Enable service.restartOnFailure');
  });

  test('network auth posture is flagged when LAN surfaces have no local users or bootstrap is still present', () => {
    const findings = buildCliDoctorFindings({
      ...makeOptions({
        'web.enabled': true,
        'web.hostMode': 'network',
        'web.host': '0.0.0.0',
      }),
      auth: {
        userStorePath: '/home/test/.goodvibes/agent/auth-users.json',
        userStorePresent: false,
        bootstrapCredentialPath: '/home/test/.goodvibes/agent/auth-bootstrap.txt',
        bootstrapCredentialPresent: true,
        operatorTokenPath: '/home/test/.goodvibes/daemon/operator-tokens.json',
        operatorTokenPresent: false,
      },
    });

    expect(findings.map((finding) => finding.id)).toContain('network-surface-without-local-users');
    expect(findings.map((finding) => finding.id)).toContain('network-surface-with-bootstrap-credential');
  });

  test('status can render a stable JSON contract with service lifecycle details', () => {
    const text = renderCliStatus({
      ...makeOptions(),
      outputFormat: 'json',
      service: {
        config: {
          enabled: true,
          autostart: true,
          restartOnFailure: true,
          daemonEnabled: true,
        },
        managed: {
          platform: 'manual',
          path: 'external GoodVibes runtime host',
          installed: false,
          autostart: false,
          running: false,
          logPath: '/home/test/.goodvibes/daemon/service/manual.log',
          commandPreview: 'managed outside goodvibes-agent',
          suggestedCommands: [],
          lastAction: 'status',
          pidPath: 'external GoodVibes runtime host',
          lastError: null,
        },
        endpoints: [],
        log: {
          path: '/project/.goodvibes/agent/service/manual.log',
          exists: true,
          size: 128,
          modifiedAt: 1,
        },
        issues: [],
      },
    });

    const parsed = JSON.parse(text) as {
      title: string;
      provider: { provider: string };
      service: { lifecycle: { managed: { running: boolean; commandPreview: string } } };
      surfaces: { controlPlane: { port: number } };
      findings: unknown[];
    };

    expect(parsed.title).toBe('GoodVibes Agent status');
    expect(parsed.provider.provider).toBe('openai');
    expect(parsed.service.lifecycle.managed.running).toBe(false);
    expect(parsed.service.lifecycle.managed.commandPreview).toBe('managed outside goodvibes-agent');
    expect(parsed.surfaces.controlPlane.port).toBe(3421);
    expect(parsed.findings).toBeArray();
  });
});
