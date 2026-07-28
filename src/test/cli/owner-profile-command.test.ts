/**
 * The `owner-profile` CLI command. Same honesty rules as the tool: a write that
 * did not happen prints the daemon's reason and exits non-zero, and a `forget`
 * for a field that was not there is one of those cases — never a reported
 * deletion (docs/owner-profile.md §9.2).
 *
 * The gateway is injected, with the platform runtime's real payload shapes.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '../../config/index.ts';
import { GOODVIBES_AGENT_SURFACE_ROOT } from '../../config/surface.ts';
import { handleOwnerProfileCommand } from '../../cli/owner-profile-command.ts';
import { parseGoodVibesCli } from '../../cli/parser.ts';
import type { ProfileGatewayInvoke, ProfileGatewayResult } from '../../agent/owner-profile-gateway.ts';
import type { ProfileMethodId } from '../../tools/agent-profile-types.ts';

const roots: string[] = [];

function runtime(argv: readonly string[], withToken = true) {
  const root = mkdtempSync(join(tmpdir(), 'gv-agent-owner-profile-cli-'));
  roots.push(root);
  const workingDirectory = join(root, 'workspace');
  const homeDirectory = join(root, 'home');
  mkdirSync(workingDirectory, { recursive: true });
  mkdirSync(join(homeDirectory, '.goodvibes', 'daemon'), { recursive: true });
  if (withToken) {
    writeFileSync(
      join(homeDirectory, '.goodvibes', 'daemon', 'operator-tokens.json'),
      JSON.stringify({ token: 'owner-profile-cli-token' }),
    );
  }
  const configManager = new ConfigManager({
    surfaceRoot: GOODVIBES_AGENT_SURFACE_ROOT,
    workingDir: workingDirectory,
    homeDir: homeDirectory,
  });
  return {
    cli: parseGoodVibesCli(['owner-profile', ...argv]),
    configManager,
    workingDirectory,
    homeDirectory,
  };
}

type Call = { methodId: ProfileMethodId; body: Record<string, unknown> };

function stubInvoke(
  respond: (methodId: ProfileMethodId, body: Record<string, unknown>) => unknown,
  calls: Call[] = [],
): ProfileGatewayInvoke {
  return async (methodId, body): Promise<ProfileGatewayResult> => {
    calls.push({ methodId, body });
    return { ok: true, data: respond(methodId, body), route: 'connected-host' };
  };
}

function refused(reason: string): Record<string, unknown> {
  return { ok: false, reason, changes: [], disclosure: '' };
}

function wrote(disclosure: string): Record<string, unknown> {
  return { ok: true, reason: null, changes: [], disclosure };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('owner-profile CLI command', () => {
  test('parses as its own command rather than the Agent profile homes command', () => {
    expect(parseGoodVibesCli(['owner-profile', 'read']).command).toBe('owner-profile');
    // `profile` still means the isolated Agent profile homes; nothing about it changed.
    expect(parseGoodVibesCli(['profile', 'list']).command).toBe('profiles');
  });

  test('forget for a field that was not there prints the reason and never reports a deletion', async () => {
    const calls: Call[] = [];
    const result = await handleOwnerProfileCommand(
      runtime(['forget', 'contact.phone', '--yes']),
      stubInvoke(() => refused('Your profile has no phone recorded, so there was nothing to forget.'), calls),
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Not done: contact.phone was not deleted.');
    expect(result.output).toContain('there was nothing to forget');
    expect(result.output).not.toContain('Deleted contact.phone');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.methodId).toBe('profile.forget');
  });

  test('an actual deletion exits zero and names what went', async () => {
    const result = await handleOwnerProfileCommand(
      runtime(['forget', 'contact.phone', '--yes']),
      stubInvoke(() => wrote('Deleted contact.phone from your profile.')),
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Deleted contact.phone from your profile.');
  });

  test('a refused write prints the reason and exits non-zero', async () => {
    const result = await handleOwnerProfileCommand(
      runtime(['set', 'contact.email', 'someone@example.com', '--yes']),
      stubInvoke(() => refused('That text overlaps content read this turn from web-page example.com.')),
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Not done: contact.email was not recorded.');
    expect(result.output).toContain('overlaps content read this turn');
  });

  test('a write carries owner-direct authority, the agent surface, and a stand-in for his words', async () => {
    const calls: Call[] = [];
    await handleOwnerProfileCommand(
      runtime(['set', 'location.timezone', 'America/Detroit', '--yes']),
      stubInvoke(() => wrote('Noted.'), calls),
    );

    expect(calls[0]?.body.authority).toBe('owner-direct');
    expect(calls[0]?.body.surface).toBe('agent');
    expect(calls[0]?.body.said).toBe('(edited from the command line)');
    expect(calls[0]?.body.value).toBe('America/Detroit');
  });

  test('--said records his own words instead of the stand-in', async () => {
    const calls: Call[] = [];
    await handleOwnerProfileCommand(
      runtime(['set', 'commerce.shippingAddress', '200 Office Way', '--said', 'ship it to my office instead', '--yes']),
      stubInvoke(() => wrote('Noted.'), calls),
    );

    expect(calls[0]?.body.said).toBe('ship it to my office instead');
    expect(calls[0]?.body.value).toBe('200 Office Way');
  });

  test('set and forget refuse without --yes and never reach the daemon', async () => {
    const calls: Call[] = [];
    const invoke = stubInvoke(() => wrote('Noted.'), calls);

    const set = await handleOwnerProfileCommand(runtime(['set', 'contact.phone', '555']), invoke);
    expect(set.exitCode).toBe(2);
    expect(set.output).toContain('without --yes');

    const forget = await handleOwnerProfileCommand(runtime(['forget', 'contact.phone']), invoke);
    expect(forget.exitCode).toBe(2);
    expect(forget.output).toContain('without --yes');

    expect(calls).toHaveLength(0);
  });

  test('provenance without a field prints usage', async () => {
    const result = await handleOwnerProfileCommand(runtime(['provenance']), stubInvoke(() => ({})));
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('owner-profile provenance <fieldId>');
  });

  test('provenance prints the suffix and every superseded predecessor', async () => {
    const result = await handleOwnerProfileCommand(
      runtime(['provenance', 'commerce.shippingAddress']),
      stubInvoke(() => ({
        fieldId: 'commerce.shippingAddress',
        present: true,
        handEdited: false,
        provenance: { surface: 'agent', date: '2026-07-27', said: 'ship it to my office instead' },
        superseded: [{
          lineIndex: 14,
          fieldId: 'commerce.shippingAddress',
          section: 'Commerce',
          text: 'shipping address: 401 Home St',
          value: '401 Home St',
          supersededOn: '2026-07-27',
          previousLine: 'shipping address: 401 Home St — tui, 2026-07-20, "ship to 401 Home St"',
          provenance: { surface: 'tui', date: '2026-07-20', said: 'ship to 401 Home St' },
        }],
      })),
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('from agent on 2026-07-27, you said: "ship it to my office instead"');
    expect(result.output).toContain('was: 401 Home St, via tui, on 2026-07-20');
    expect(result.output).toContain('superseded 2026-07-27');
  });

  test('a hand-edited line reports no provenance rather than inventing a source', async () => {
    const result = await handleOwnerProfileCommand(
      runtime(['provenance', 'identity.name']),
      stubInvoke(() => ({ fieldId: 'identity.name', present: true, handEdited: true, superseded: [] })),
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('you edited this line by hand');
  });

  test('read prints the document by section, with provenance on learned lines', async () => {
    const result = await handleOwnerProfileCommand(
      runtime(['read']),
      stubInvoke(() => ({
        state: {
          kind: 'loaded',
          path: '/home/owner/.goodvibes/daemon/owner-profile.md',
          exists: true,
          lineCount: 10,
          fieldCount: 1,
          proseLineCount: 1,
          sections: ['Identity', 'Places'],
          invalidFields: [],
        },
        sections: [
          {
            heading: 'Identity',
            tier: 'open',
            fields: [{ fieldId: 'identity.goesBy', label: 'goes by', value: 'Mike', valid: true }],
            prose: [],
          },
          {
            heading: 'Places',
            tier: 'closed',
            fields: [],
            prose: [{
              lineIndex: 20,
              section: 'Places',
              text: 'Gym: the Y on Michigan Ave',
              provenance: { surface: 'agent', date: '2026-07-27', said: 'I go to the Y on Michigan Ave' },
            }],
          },
        ],
      })),
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('## Identity');
    expect(result.output).toContain('goes by: Mike');
    expect(result.output).toContain('Gym: the Y on Michigan Ave — agent, 2026-07-27, "I go to the Y on Michigan Ave"');
  });

  test('an unreadable profile exits non-zero with the reason, never an empty document', async () => {
    const result = await handleOwnerProfileCommand(
      runtime(['read']),
      stubInvoke(() => ({
        state: { kind: 'unavailable', path: '/x/owner-profile.md', reason: 'permission denied' },
        sections: [],
      })),
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('could not be read: permission denied');
  });

  test('status prints load state, counts and invalid fields, and no values', async () => {
    const result = await handleOwnerProfileCommand(
      runtime(['status']),
      stubInvoke(() => ({
        kind: 'loaded',
        path: '/home/owner/.goodvibes/daemon/owner-profile.md',
        exists: true,
        sections: ['Identity', 'Location'],
        lineCount: 24,
        fieldCount: 9,
        proseLineCount: 6,
        invalidFields: [{ fieldId: 'location.timezone', reason: 'not an IANA zone' }],
      })),
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Owner profile: loaded');
    expect(result.output).toContain('fields 9');
    expect(result.output).toContain('invalid location.timezone: not an IANA zone');
  });

  test('an unknown subcommand prints usage', async () => {
    const result = await handleOwnerProfileCommand(runtime(['wipe']), stubInvoke(() => ({})));
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('Usage: goodvibes-agent owner-profile');
  });

  test('with no operator token on disk the default route reports auth_required', async () => {
    const result = await handleOwnerProfileCommand(runtime(['status', '--json'], false));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('auth_required');
  });
});
