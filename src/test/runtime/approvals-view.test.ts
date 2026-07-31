/**
 * approvals-view.test.ts
 *
 * The panel's contract after the split: the daemon's record is the list every
 * surface reads, the asks this process still holds are unioned in rather than
 * dropped, and an unreachable host never renders as an empty list.
 */
import { describe, expect, test } from 'bun:test';
import type { SharedApprovalRecord } from '@pellux/goodvibes-sdk/platform/control-plane';
import type { DaemonReachability, DaemonVerbCaller } from '@pellux/goodvibes-sdk/platform/runtime/client';
import {
  createApprovalsView,
  describeApprovalsUnavailable,
  unionApprovalRecords,
} from '../../runtime/client/approvals-view.ts';

function approval(overrides: Partial<SharedApprovalRecord> & { id: string }): SharedApprovalRecord {
  return {
    callId: `call-${overrides.id}`,
    status: 'pending',
    request: {
      callId: `call-${overrides.id}`,
      tool: 'bash',
      args: {},
      category: 'exec',
      analysis: { risk: 'low', reasons: [] },
    } as unknown as SharedApprovalRecord['request'],
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    audit: [],
    ...overrides,
  };
}

function verbs(options: {
  readonly probe: DaemonReachability;
  readonly invoke?: (methodId: string) => Promise<unknown>;
}): DaemonVerbCaller {
  return {
    probe: () => options.probe,
    invoke: async <T,>(methodId: string): Promise<T> => {
      if (!options.invoke) throw new Error(`no invoke wired for '${methodId}'`);
      return await options.invoke(methodId) as T;
    },
  };
}

describe('approvals view: the daemon record is the panel', () => {
  test('a pending ask on the daemon appears in the panel', async () => {
    const view = createApprovalsView({
      verbs: verbs({
        probe: { available: true },
        invoke: async () => ({ approvals: [approval({ id: 'host-1', sessionId: 'session-a' })] }),
      }),
      localBroker: { listApprovals: () => [] },
    });

    // Before any read the panel does NOT claim the host is fine and empty.
    const beforeRead = view.snapshot();
    expect(beforeRead.hostRecordRead).toBe(false);
    expect(beforeRead.unavailableReason).toContain('has not been read yet');

    const snapshot = await view.refresh();
    expect(snapshot.hostRecordRead).toBe(true);
    expect(snapshot.unavailableReason).toBeNull();
    expect(snapshot.approvals.map((row) => row.id)).toEqual(['host-1']);
    expect(describeApprovalsUnavailable(snapshot)).toBeNull();

    // snapshot() serves the same list without a second round trip.
    expect(view.snapshot().approvals.map((row) => row.id)).toEqual(['host-1']);
  });

  test('an ask the local broker still holds is unioned in, not replaced by the host list', async () => {
    const view = createApprovalsView({
      verbs: verbs({
        probe: { available: true },
        invoke: async () => ({ approvals: [approval({ id: 'host-1', sessionId: 'session-a' })] }),
      }),
      localBroker: { listApprovals: () => [approval({ id: 'bridge-1', sessionId: 'session-b' })] },
    });

    const snapshot = await view.refresh();
    expect(snapshot.approvals.map((row) => row.id)).toEqual(['host-1', 'bridge-1']);
    expect(snapshot.localOnlyCount).toBe(1);
  });

  test('an ask both sides know about is counted once', async () => {
    const shared = approval({ id: 'host-1', sessionId: 'session-a', callId: 'call-shared' });
    // Same session and tool call, different record id — the daemon's own
    // coalescing identity, which is how one ask ends up on both sides.
    const deduped = createApprovalsView({
      verbs: verbs({
        probe: { available: true },
        invoke: async () => ({ approvals: [shared] }),
      }),
      localBroker: {
        listApprovals: () => [approval({ id: 'local-mirror', sessionId: 'session-a', callId: 'call-shared' })],
      },
    });

    const snapshot = await deduped.refresh();
    expect(snapshot.approvals.map((row) => row.id)).toEqual(['host-1']);
    expect(snapshot.localOnlyCount).toBe(0);
  });
});

describe('approvals view: an unreachable host is never an empty list', () => {
  test('an unresolvable host renders the reason, not zero', async () => {
    const view = createApprovalsView({
      verbs: verbs({
        probe: {
          available: false,
          reason: 'the connected host is disabled (daemon.enabled=false) — nothing to reach.',
        },
      }),
      localBroker: { listApprovals: () => [] },
    });

    const snapshot = await view.refresh();
    expect(snapshot.hostRecordRead).toBe(false);
    expect(snapshot.approvals).toHaveLength(0);
    expect(snapshot.unavailableReason).toContain('daemon.enabled=false');

    const line = describeApprovalsUnavailable(snapshot);
    expect(line).not.toBeNull();
    expect(line).toContain('could not be read');
    expect(line).toContain('daemon.enabled=false');
    // The load-bearing half: the owner is told the absence is not an answer.
    expect(line).toContain('not the same as nothing waiting');
  });

  test('a verb that throws reports the failure and still shows this process\'s own asks', async () => {
    const view = createApprovalsView({
      verbs: verbs({
        probe: { available: true },
        invoke: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:3421'); },
      }),
      localBroker: { listApprovals: () => [approval({ id: 'bridge-1' })] },
    });

    const snapshot = await view.refresh();
    expect(snapshot.hostRecordRead).toBe(false);
    expect(snapshot.unavailableReason).toContain('ECONNREFUSED');
    expect(snapshot.approvals.map((row) => row.id)).toEqual(['bridge-1']);

    const line = describeApprovalsUnavailable(snapshot);
    expect(line).toContain('ECONNREFUSED');
    expect(line).toContain('1 ask raised in this process is shown below');
  });

  test('a reply this build cannot read is reported, not silently emptied', async () => {
    const view = createApprovalsView({
      verbs: verbs({
        probe: { available: true },
        invoke: async () => ({ approvals: [approval({ id: 'host-1' }), { unexpected: true }] }),
      }),
      localBroker: { listApprovals: () => [] },
    });

    const snapshot = await view.refresh();
    expect(snapshot.approvals.map((row) => row.id)).toEqual(['host-1']);
    expect(snapshot.hostRecordRead).toBe(false);
    expect(snapshot.unavailableReason).toContain('could not read');
  });
});

describe('approvals view: the union rule, driven directly', () => {
  test('host rows come first and local rows are appended, both keys deduping', () => {
    const result = unionApprovalRecords(
      [approval({ id: 'h1', callId: 'c1' }), approval({ id: 'h2', callId: 'c2' })],
      [
        approval({ id: 'h1', callId: 'c1' }),        // same id
        approval({ id: 'mirror', callId: 'c2' }),    // same coalescing key
        approval({ id: 'l1', callId: 'c9' }),        // genuinely local
      ],
    );
    expect(result.approvals.map((row) => row.id)).toEqual(['h1', 'h2', 'l1']);
    expect(result.localOnlyCount).toBe(1);
  });

  test('a record with no call id is never coalesced away by another with no call id', () => {
    const result = unionApprovalRecords(
      [approval({ id: 'h1', callId: '' })],
      [approval({ id: 'l1', callId: '' })],
    );
    expect(result.approvals.map((row) => row.id)).toEqual(['h1', 'l1']);
  });
});
