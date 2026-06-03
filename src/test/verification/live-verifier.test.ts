import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LiveVerificationReport } from '../../verification/live-verifier.ts';
import { buildAgentKnowledgeLiveSkipCheck, renderLiveVerificationReportMarkdown } from '../../verification/live-verifier.ts';

const projectRoot = resolve(join(import.meta.dir, '..', '..', '..'));

describe('live verification report', () => {
  it('renders summary counts and check rows', () => {
    const report: LiveVerificationReport = {
      generatedAt: '2026-01-01T00:00:00.000Z',
      homeDir: '/tmp/goodvibes',
      binaryPath: '/repo/dist/goodvibes-agent',
      connectedHostBaseUrl: 'http://127.0.0.1:3421',
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
          id: 'agent-knowledge-status',
          title: 'Agent Knowledge CLI status command',
          status: 'warn',
          summary: 'Agent Knowledge route is not available.',
          detail: '/api/goodvibes-agent/knowledge/status returned 404',
        },
      ],
    };

    const markdown = renderLiveVerificationReportMarkdown(report);

    expect(markdown).toContain('| pass | 2 |');
    expect(markdown).toContain('Binary: `/repo/dist/goodvibes-agent`');
    expect(markdown).toContain('Connected host: `http://127.0.0.1:3421`');
    expect(markdown).not.toContain('daemonBaseUrl');
    expect(markdown).toContain('| Agent Knowledge CLI status command | warn | Agent Knowledge route is not available. |');
    expect(markdown).toContain('/api/goodvibes-agent/knowledge/status');
    expect(markdown).toContain('Result: PASS');
  });

  it('does not invoke retired host lifecycle commands during live Agent verification', () => {
    const source = readFileSync(join(projectRoot, 'src/verification/live-verifier.ts'), 'utf8');

    expect(source).toContain("await runCommand(binaryPath, ['status', '--json'], projectRoot)");
    expect(source).toContain("await runCommand(binaryPath, ['knowledge', 'status', '--json'], projectRoot)");
    expect(source).toContain("await runCommand(binaryPath, ['doctor', '--output', 'text'], projectRoot)");
    expect(source).not.toContain("await runCommand(binaryPath, ['control-plane', 'status'], projectRoot)");
    expect(source).not.toContain("await runCommand(binaryPath, ['listener', 'test'], projectRoot)");
    expect(source).not.toContain("await runCommand(binaryPath, ['surfaces', 'check'], projectRoot)");
    expect(source).not.toContain("await runCommand(binaryPath, ['service', 'check'], projectRoot)");
  });

  it('skips Agent Knowledge route validation when the connected host SDK is older than the Agent pin', () => {
    const check = buildAgentKnowledgeLiveSkipCheck(
      'agent-knowledge-status',
      'Agent Knowledge isolated /status',
      '0.33.30',
      '0.33.35',
    );

    expect(check.status).toBe('skip');
    expect(check.summary).toContain('connected host SDK 0.33.30');
    expect(check.summary).toContain('Agent SDK pin 0.33.35');
    expect(check.detail).toContain('must not fall back to default knowledge or non-Agent knowledge segments');
  });
});
