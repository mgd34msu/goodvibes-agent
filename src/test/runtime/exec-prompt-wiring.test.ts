/**
 * Fork-mirror contract proof for the exec PTY prompt-answer wiring
 * (src/runtime/exec-prompt-wiring.ts): a terminal prompt rides the approval
 * broker as an execute-category ask; approval with a typed answer feeds the
 * run; denial or an answer-less approval declines honestly (nothing is ever
 * fabricated).
 */
import { describe, expect, test } from 'bun:test';
import type { PermissionPromptDecision, PermissionPromptRequest } from '@pellux/goodvibes-sdk/platform/permissions';
import { buildAgentExecPromptAnswerHandler } from '../../runtime/exec-prompt-wiring.ts';

const ASK = {
  command: 'ssh build-host',
  prompt: "Are you sure you want to continue connecting (yes/no)?",
  recentOutput: 'The authenticity of host build-host cannot be established.',
  workingDirectory: '/tmp/project',
} as const;

function makeHandler(decide: (request: PermissionPromptRequest) => PermissionPromptDecision) {
  const seen: { request: PermissionPromptRequest; metadata?: Record<string, unknown> | undefined }[] = [];
  const handler = buildAgentExecPromptAnswerHandler({
    requestApproval: async (input) => {
      seen.push(input);
      return decide(input.request);
    },
  });
  return { handler, seen };
}

describe('buildAgentExecPromptAnswerHandler', () => {
  test('routes the prompt through the broker as an execute-category exec-prompt ask', async () => {
    const { handler, seen } = makeHandler(() => ({ approved: false }));
    await handler(ASK);
    expect(seen).toHaveLength(1);
    const { request, metadata } = seen[0]!;
    expect(request.tool).toBe('exec:prompt');
    expect(request.category).toBe('execute');
    expect(request.analysis?.classification).toBe('exec-terminal-prompt');
    expect(request.workingDirectory).toBe('/tmp/project');
    expect(request.attribution).toEqual({ kind: 'exec-prompt', command: ASK.command, prompt: ASK.prompt });
    expect(metadata).toEqual({ source: 'exec-prompt', command: ASK.command });
  });

  test('approval with a typed answer feeds that text to the waiting command', async () => {
    const { handler } = makeHandler(() => ({ approved: true, modifiedArgs: { answer: 'yes' } }));
    await expect(handler(ASK)).resolves.toEqual({ answered: true, text: 'yes' });
  });

  test('denial declines the prompt', async () => {
    const { handler } = makeHandler(() => ({ approved: false }));
    await expect(handler(ASK)).resolves.toEqual({ answered: false });
  });

  test('an approval carrying no typed answer declines — nothing is ever fabricated', async () => {
    const { handler } = makeHandler(() => ({ approved: true }));
    await expect(handler(ASK)).resolves.toEqual({ answered: false });
  });

  test('a non-string answer declines rather than coercing', async () => {
    const { handler } = makeHandler(() => ({ approved: true, modifiedArgs: { answer: 42 } }));
    await expect(handler(ASK)).resolves.toEqual({ answered: false });
  });
});
