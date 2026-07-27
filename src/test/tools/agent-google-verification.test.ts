import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentGoogleTool } from '../../tools/agent-google-tool.ts';
import { getSessionExpectationBook, resetSessionExpectationBookForTests } from '../../agent/signup/session-expectations.ts';
import { resetSessionUntrustedContentLedgerForTests } from '../../trust/untrusted-content.ts';

/**
 * The correlation rule, exercised through the real tool.
 *
 * A verification mail is the one thing arriving by email that can yield
 * something actionable, and only because the agent provoked it. What decides a
 * match is the receiver-written Delivered-To header. `To:` is set by the
 * sender, so if it were accepted, anyone who guessed an open expectation's
 * alias could forge a header and have the agent follow their link.
 */

let home = '';
const ALIAS = 'owner+gv-example-com-abcd1234@example.com';

function writeCredentials(root: string): void {
  const directory = join(root, '.gmail-mcp');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'gcp-oauth.keys.json'),
    JSON.stringify({ installed: { client_id: 'x.apps.googleusercontent.com', client_secret: 's' } }),
  );
  writeFileSync(
    join(directory, 'credentials.json'),
    JSON.stringify({ refresh_token: 'r', access_token: 'a', scope: 'https://mail.google.com/', expiry_date: 4102444800000 }),
  );
}

const VERIFICATION_BODY = 'Confirm here: https://example.com/verify?t=tok123';

/** A Gmail `messages.get` response with the headers this test is about. */
function gmailMessage(headers: readonly { name: string; value: string }[], body: string) {
  return {
    id: 'msg-1',
    threadId: 't-1',
    labelIds: [],
    snippet: '',
    payload: {
      mimeType: 'text/plain',
      headers,
      body: { data: Buffer.from(body).toString('base64url') },
      parts: [],
    },
  };
}

function toolWith(headers: readonly { name: string; value: string }[], body: string = VERIFICATION_BODY) {
  return createAgentGoogleTool({
    homeDirectory: home,
    configGet: () => undefined,
    secretGet: async () => null,
    fetchImpl: async (url: string) =>
      new Response(
        JSON.stringify(url.includes('/messages/') ? gmailMessage(headers, body) : { access_token: 'a', expires_in: 3600, scope: 'https://mail.google.com/', token_type: 'Bearer' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  });
}

function run(tool: ReturnType<typeof createAgentGoogleTool>, args: Record<string, unknown>) {
  return tool.execute(args) as Promise<{ success: boolean; output?: string; error?: string }>;
}

describe('reading a verification mail', () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'google-verify-'));
    writeCredentials(home);
    resetSessionExpectationBookForTests();
    resetSessionUntrustedContentLedgerForTests();
    getSessionExpectationBook().openExpectation({
      serviceDomain: 'example.com',
      recipientAddress: ALIAS,
      purpose: 'signing up at example.com',
    });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    resetSessionExpectationBookForTests();
    resetSessionUntrustedContentLedgerForTests();
  });

  test('a message delivered to the minted alias yields its verification link', async () => {
    const tool = toolWith([
      { name: 'From', value: 'noreply@example.com' },
      { name: 'To', value: ALIAS },
      { name: 'Delivered-To', value: ALIAS },
    ]);

    const result = await run(tool, { action: 'mail.verification', id: 'msg-1' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('https://example.com/verify?t=tok123');
  });

  test('a forged To: header with no delivery evidence is refused', async () => {
    // Exactly the attack the branded type exists to prevent: the sender names
    // the open expectation's alias in a header they control.
    const tool = toolWith([
      { name: 'From', value: 'attacker@evil.test' },
      { name: 'To', value: ALIAS },
    ]);

    const result = await run(tool, { action: 'mail.verification', id: 'msg-1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('no delivery evidence');
    expect(result.error).toContain('Nothing was extracted');
    expect(result.error).not.toContain('tok123');
  });

  test('a message delivered to a different address does not match', async () => {
    const tool = toolWith([
      { name: 'From', value: 'noreply@example.com' },
      { name: 'To', value: ALIAS },
      { name: 'Delivered-To', value: 'someone-else@example.com' },
    ]);

    const result = await run(tool, { action: 'mail.verification', id: 'msg-1' });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('tok123');
  });

  test('with no expectation open, verification mail is not acted on at all', async () => {
    resetSessionExpectationBookForTests();
    const tool = toolWith([
      { name: 'From', value: 'noreply@example.com' },
      { name: 'Delivered-To', value: ALIAS },
    ]);

    const result = await run(tool, { action: 'mail.verification', id: 'msg-1' });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('tok123');
  });
});
