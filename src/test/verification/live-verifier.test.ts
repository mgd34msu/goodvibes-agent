import { describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LiveVerificationReport } from '../../verification/live-verifier.ts';
import {
  buildAgentKnowledgeLiveSkipCheck,
  buildLiveVerificationReport,
  renderLiveVerificationReportMarkdown,
} from '../../verification/live-verifier.ts';

const projectRoot = resolve(join(import.meta.dir, '..', '..', '..'));

interface FakeAgentBinaryOptions {
  readonly compatOutput: string;
  readonly compatExitCode: number;
  readonly knowledgeOutput: string;
  readonly knowledgeExitCode: number;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function writeFakeAgentBinary(root: string, options: FakeAgentBinaryOptions): string {
  const binaryPath = join(root, 'goodvibes-agent-fake');
  const script = [
    '#!/usr/bin/env bash',
    'set -eu',
    'case "$*" in',
    '  "--version") printf "%s\\n" "0.0.0"; exit 0 ;;',
    '  "status --json") printf "%s\\n" \'{"ok":true}\'; exit 0 ;;',
    `  "compat --json") printf "%s\\n" ${shellQuote(options.compatOutput)}; exit ${options.compatExitCode} ;;`,
    `  "knowledge status --json") printf "%s\\n" ${shellQuote(options.knowledgeOutput)}; exit ${options.knowledgeExitCode} ;;`,
    '  "providers") printf "%s\\n" "provider inventory"; exit 0 ;;',
    '  "doctor --output text") printf "%s\\n" "doctor ok"; exit 0 ;;',
    'esac',
    'printf "unexpected command: %s\\n" "$*" >&2',
    'exit 64',
    '',
  ].join('\n');
  writeFileSync(binaryPath, script, 'utf8');
  chmodSync(binaryPath, 0o755);
  return binaryPath;
}

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

  it('fails warn-only JSON command checks when the JSON contract is broken', async () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-live-verifier-'));
    try {
      const binaryPath = writeFakeAgentBinary(root, {
        compatOutput: 'not json',
        compatExitCode: 2,
        knowledgeOutput: '{"status":"unavailable"}',
        knowledgeExitCode: 1,
      });

      const report = await buildLiveVerificationReport({
        homeDir: join(root, 'home'),
        binaryPath,
        projectRoot,
      });
      const compatCheck = report.checks.find((check) => check.id === 'cli-compat-json');

      expect(compatCheck?.status).toBe('fail');
      expect(compatCheck?.summary).toBe('Command exited 2 and did not return valid JSON.');
      expect(report.ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps nonzero JSON command checks warn-only when output remains parseable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'goodvibes-live-verifier-'));
    try {
      const binaryPath = writeFakeAgentBinary(root, {
        compatOutput: '{"compatible":false}',
        compatExitCode: 2,
        knowledgeOutput: '{"status":"unavailable"}',
        knowledgeExitCode: 1,
      });

      const report = await buildLiveVerificationReport({
        homeDir: join(root, 'home'),
        binaryPath,
        projectRoot,
      });
      const compatCheck = report.checks.find((check) => check.id === 'cli-compat-json');
      const knowledgeCheck = report.checks.find((check) => check.id === 'cli-agent-knowledge-status');

      expect(compatCheck?.status).toBe('warn');
      expect(compatCheck?.summary).toBe('Command exited 2.');
      expect(knowledgeCheck?.status).toBe('warn');
      expect(report.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
