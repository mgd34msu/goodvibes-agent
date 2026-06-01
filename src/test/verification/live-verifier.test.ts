import { describe, expect, it } from 'bun:test';
import type { LiveVerificationReport } from '../../verification/live-verifier.ts';
import { buildAgentKnowledgeLiveSkipCheck, renderLiveVerificationReportMarkdown } from '../../verification/live-verifier.ts';

describe('live verification report', () => {
  it('renders summary counts and check rows', () => {
    const report: LiveVerificationReport = {
      generatedAt: '2026-01-01T00:00:00.000Z',
      homeDir: '/tmp/goodvibes',
      binaryPath: '/repo/dist/goodvibes-agent',
      daemonBaseUrl: 'http://127.0.0.1:3421',
      strict: false,
      counts: { pass: 2, warn: 1, fail: 0, skip: 0 },
      ok: true,
      checks: [
        {
          id: 'ledger',
          title: 'Verification inventory ledger',
          status: 'pass',
          summary: '100% local verification signal.',
        },
        {
          id: 'surface',
          title: 'CLI surfaces readiness command',
          status: 'warn',
          summary: 'Web surface is not reachable.',
          detail: 'web enabled but not reachable on 0.0.0.0:3423',
        },
      ],
    };

    const markdown = renderLiveVerificationReportMarkdown(report);

    expect(markdown).toContain('| pass | 2 |');
    expect(markdown).toContain('Binary: `/repo/dist/goodvibes-agent`');
    expect(markdown).toContain('| CLI surfaces readiness command | warn | Web surface is not reachable. |');
    expect(markdown).toContain('web enabled but not reachable');
    expect(markdown).toContain('Result: PASS');
  });

  it('skips Agent Knowledge route validation when the GoodVibes runtime SDK is older than the Agent pin', () => {
    const check = buildAgentKnowledgeLiveSkipCheck(
      'agent-knowledge-status',
      'Agent Knowledge isolated /status',
      '0.33.30',
      '0.33.35',
    );

    expect(check.status).toBe('skip');
    expect(check.summary).toContain('GoodVibes runtime SDK 0.33.30');
    expect(check.summary).toContain('Agent SDK pin 0.33.35');
    expect(check.detail).toContain('must not fall back to default Knowledge/Wiki or non-Agent knowledge segments');
  });
});
