/**
 * agent-session-mirror-identity.test.ts
 *
 * The agent's local session mirror was filing the agent's own sessions as
 * somebody else's.
 *
 * `bootstrap-core.ts` creates the session twice, on purpose: once in the local
 * shared broker (the mirror at ~/.goodvibes/agent/control-plane/sessions.json)
 * and once in the daemon spine. The spine call named `kind: 'agent'` and the
 * real project. The broker call named neither, so the broker fell back to its
 * documented defaults for a create that says nothing,
 * `classifySessionOriginKind` maps a non-channel surface (this one registers as
 * 'service') to 'tui', and project defaults to 'unknown'.
 *
 * Result: two stores describing one session and disagreeing about what it is.
 * A listing filtered on kind:"agent" missed this process's own sessions; one
 * filtered on kind:"tui" claimed terminal sessions nobody had opened.
 *
 * Two tests: the broker default that made this possible (so the trap is
 * documented rather than rediscovered), and the call site itself.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SharedSessionBroker } from '@pellux/goodvibes-sdk/platform/control-plane';
import { makeProjectTempDir } from '../helpers/project-temp.ts';

function makeBroker(storePath: string): SharedSessionBroker {
  return new SharedSessionBroker({
    storePath,
    routeBindings: { start: async () => {}, patchBinding: async () => null, getBinding: () => null },
    agentStatusProvider: { getStatus: () => null },
    messageSender: { send: () => true },
  } as unknown as ConstructorParameters<typeof SharedSessionBroker>[0]);
}

describe('agent session mirror files its own sessions as its own', () => {
  test('the broker default this fell into: a service participant with no kind is recorded as tui/unknown', async () => {
    const broker = makeBroker(join(makeProjectTempDir('agent-mirror-'), 'sessions.json'));
    const record = await broker.createSession({
      id: 'no-kind-named',
      title: 'GoodVibes Agent session',
      participant: {
        surfaceKind: 'service',
        surfaceId: 'surface:goodvibes-agent',
        displayName: 'GoodVibes Agent',
        lastSeenAt: Date.now(),
      },
    });
    // Not a bug in the broker, a fallback for a caller that says nothing.
    // Saying it is the call site's job, which is what the next test pins.
    expect(record.kind).toBe('tui');
    expect(record.project).toBe('unknown');
  });

  test('naming kind and project produces the same identity the spine registration records', async () => {
    const broker = makeBroker(join(makeProjectTempDir('agent-mirror-'), 'sessions.json'));
    const record = await broker.createSession({
      id: 'named',
      kind: 'agent',
      project: '/home/somebody/project',
      title: 'GoodVibes Agent session',
      participant: {
        surfaceKind: 'service',
        surfaceId: 'surface:goodvibes-agent',
        displayName: 'GoodVibes Agent',
        lastSeenAt: Date.now(),
      },
    });
    expect(record.kind).toBe('agent');
    expect(record.project).toBe('/home/somebody/project');
    // The TRANSPORT axis is unchanged: 'service' is how this process is
    // reached, and it was never the thing that was wrong.
    expect(record.participants[0]?.surfaceKind).toBe('service');
  });

  test('the bootstrap call site names both, so the mirror and the spine cannot drift apart again', () => {
    const source = readFileSync(new URL('../../runtime/bootstrap-core.ts', import.meta.url), 'utf8');
    const call = source.slice(source.indexOf('sharedSessionBroker.createSession('));
    const body = call.slice(0, call.indexOf('participant:'));

    expect(body).toContain("kind: 'agent'");
    expect(body).toContain('project: workingDir');

    // And the spine registration it has to agree with still names the same project.
    const spine = source.slice(source.indexOf('sessionSpineClient.register('));
    expect(spine.slice(0, spine.indexOf('});'))).toContain('project: workingDir');
  });

  test('this is the only createSession call in the agent, so no sibling call site carries the same gap', () => {
    const source = readFileSync(new URL('../../runtime/bootstrap-core.ts', import.meta.url), 'utf8');
    const occurrences = source.split('.createSession(').length - 1;
    expect(occurrences).toBe(1);
  });
});
