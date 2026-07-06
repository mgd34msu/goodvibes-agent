/**
 * The memory-spine adoption policy (reconcileMemorySpineAdoption): the single
 * decision of whether the agent's memory spine routes over the wire (an adopted
 * daemon owns the store) or stays local. Tested here in isolation against a spy
 * MemorySpineClient double and a scripted probe — no real daemon, no network — so
 * every branch (adopt / deactivate-on-loss / no-op / re-adopt) is exercised fast
 * and deterministically. The real-daemon proof lives in
 * memory-spine-rest-transport.test.ts and memory-spine-agent-wiring.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { reconcileMemorySpineAdoption } from '../../runtime/memory-spine-adoption.ts';
import type { MemorySpineClient, MemoryTransport } from '@pellux/goodvibes-sdk/platform/runtime/memory-spine';

type SpyClient = Pick<MemorySpineClient, 'active' | 'activate' | 'deactivate'> & {
  readonly activateCalls: MemoryTransport[];
  readonly deactivateCalls: string[];
};

function spyClient(initialActive: boolean): SpyClient {
  let active = initialActive;
  const activateCalls: MemoryTransport[] = [];
  const deactivateCalls: string[] = [];
  return {
    get active() { return active; },
    activate: (transport: MemoryTransport) => { active = true; activateCalls.push(transport); },
    deactivate: (reason: string) => { active = false; deactivateCalls.push(reason); },
    activateCalls,
    deactivateCalls,
  };
}

const FAKE_TRANSPORT = {} as MemoryTransport;

describe('reconcileMemorySpineAdoption', () => {
  test('adopts the daemon (activates) when reachable and not yet active', async () => {
    const client = spyClient(false);
    await reconcileMemorySpineAdoption({
      memorySpineClient: client,
      transport: FAKE_TRANSPORT,
      probeReachability: async () => 'online',
    });
    expect(client.active).toBe(true);
    expect(client.activateCalls).toEqual([FAKE_TRANSPORT]);
    expect(client.deactivateCalls).toEqual([]);
  });

  test('deactivates (hands back to local) when a previously-adopted daemon stops answering', async () => {
    const client = spyClient(true);
    await reconcileMemorySpineAdoption({
      memorySpineClient: client,
      transport: FAKE_TRANSPORT,
      probeReachability: async () => 'offline',
    });
    expect(client.active).toBe(false);
    expect(client.deactivateCalls).toEqual(['daemon unreachable on periodic reachability check']);
    expect(client.activateCalls).toEqual([]);
  });

  test('accepts a custom deactivate reason', async () => {
    const client = spyClient(true);
    await reconcileMemorySpineAdoption({
      memorySpineClient: client,
      transport: FAKE_TRANSPORT,
      probeReachability: async () => 'unknown',
      deactivateReason: 'custom reason for this test',
    });
    expect(client.deactivateCalls).toEqual(['custom reason for this test']);
  });

  test('is a no-op when already local and the daemon is still unreachable', async () => {
    const client = spyClient(false);
    await reconcileMemorySpineAdoption({
      memorySpineClient: client,
      transport: FAKE_TRANSPORT,
      probeReachability: async () => 'offline',
    });
    expect(client.active).toBe(false);
    expect(client.activateCalls).toEqual([]);
    expect(client.deactivateCalls).toEqual([]);
  });

  test('is a no-op when already adopted and the daemon is still reachable', async () => {
    const client = spyClient(true);
    await reconcileMemorySpineAdoption({
      memorySpineClient: client,
      transport: FAKE_TRANSPORT,
      probeReachability: async () => 'online',
    });
    expect(client.active).toBe(true);
    expect(client.activateCalls).toEqual([]);
    expect(client.deactivateCalls).toEqual([]);
  });

  test('re-adopts a daemon that reappears after a prior deactivation — the whole-process-lifetime recheck', async () => {
    const client = spyClient(true);
    // First tick: daemon goes away -> deactivate.
    await reconcileMemorySpineAdoption({
      memorySpineClient: client,
      transport: FAKE_TRANSPORT,
      probeReachability: async () => 'offline',
    });
    expect(client.active).toBe(false);
    // Later tick: daemon comes back -> re-activate, without any special-casing.
    await reconcileMemorySpineAdoption({
      memorySpineClient: client,
      transport: FAKE_TRANSPORT,
      probeReachability: async () => 'online',
    });
    expect(client.active).toBe(true);
    expect(client.activateCalls).toEqual([FAKE_TRANSPORT]);
    expect(client.deactivateCalls).toEqual(['daemon unreachable on periodic reachability check']);
  });

  test('a probe rejection propagates rather than being swallowed', async () => {
    const client = spyClient(false);
    await expect(reconcileMemorySpineAdoption({
      memorySpineClient: client,
      transport: FAKE_TRANSPORT,
      probeReachability: async () => { throw new Error('probe exploded'); },
    })).rejects.toThrow('probe exploded');
    // Neither activate nor deactivate ran — the caller (bootstrap.ts's onError /
    // interval catch) is solely responsible for deciding what a failed check means.
    expect(client.activateCalls).toEqual([]);
    expect(client.deactivateCalls).toEqual([]);
  });
});
